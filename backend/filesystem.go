package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Filesystem provider: exposes the plugin's own document store as a browsable
// `excalidraw:` filesystem so DBX can list and open diagrams without going
// through the plugin UI, and so other tools can read standard .excalidraw files
// out of it.
//
//	excalidraw:/                     documents/, exports/
//	excalidraw:/documents/<uuid>.excalidraw
//	excalidraw:/exports/<name>
//
// Documents are stored with image dataURLs stripped (see persistence.ts), so
// reads rehydrate the referenced assets back into dataURLs — a file copied out
// of this filesystem is a standard, self-contained .excalidraw document. Writes
// run the same stripping in reverse. Reads that would exceed the byte budget the
// host asked for fail loudly rather than handing back a half-document.
const (
	filesystemScheme     = "excalidraw"
	filesystemProviderID = "io.dbx.excalidraw.documents"

	// The host rejects an inline filesystem write above 4 MiB before it ever
	// reaches us; mirror the bound so an oversized write is a typed protocol
	// error instead of a transport failure.
	maxFSWriteBytes = int64(4 * 1024 * 1024)
	maxFSListLimit  = 1000
)

var (
	errFSPath        = errors.New("filesystem path is not valid")
	errFSNotFound    = errors.New("filesystem entry not found")
	errFSExists      = errors.New("filesystem entry already exists")
	errFSTooLarge    = errors.New("filesystem entry is too large")
	errFSReadOnly    = errors.New("filesystem path is read-only")
	errFSUnsupported = errors.New("filesystem operation is not supported here")
	errFSStale       = errors.New("filesystem entry changed since it was read")
)

// FSEntry mirrors the host's PluginFilesystemEntry: camelCase keys, and a kind
// drawn from the host's kebab-case enum.
type FSEntry struct {
	Name        string `json:"name"`
	URI         string `json:"uri"`
	Kind        string `json:"kind"`
	Size        *int64 `json:"size,omitempty"`
	ModifiedAt  string `json:"modifiedAt,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

const (
	fsKindFile      = "file"
	fsKindDirectory = "directory"
	fsDocumentMIME  = "application/json"
)

// fsPath is a parsed URI: one of the two top-level directories, optionally with
// a leaf name. The provider has no nesting, so the grammar stays small enough
// to validate by construction and a crafted name cannot escape the store.
type fsPath struct {
	dir  string // "", "documents", "exports"
	name string // "" addresses the directory itself
}

func hasControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

// windowsDeviceNames are resolved by Windows regardless of the directory they
// appear in, so `exports\NUL` never creates a file — it addresses the null
// device. The extension is ignored too (`NUL.txt` is still the device), which
// is why the base name is what gets compared.
var windowsDeviceNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

func isWindowsDeviceName(name string) bool {
	base := name
	if dot := strings.IndexByte(base, '.'); dot >= 0 {
		base = base[:dot]
	}
	return windowsDeviceNames[strings.ToUpper(strings.TrimRight(base, " "))]
}

func isAddressableSegment(segment string) bool {
	if segment == "" || strings.ContainsAny(segment, "\\") {
		return false
	}
	// Leading dots are refused outright, which keeps the exports scratch
	// directory (`.partial`) unaddressable. Whitespace and trailing dots are
	// refused because Windows strips them when resolving a name, so a
	// permissive check would let two different URIs hit one file.
	if strings.HasPrefix(segment, ".") || segment != strings.TrimSpace(segment) || strings.HasSuffix(segment, ".") {
		return false
	}
	return !isWindowsDeviceName(segment)
}

func parseFSPath(uri string) (fsPath, error) {
	if len(uri) > 4096 || hasControl(uri) {
		return fsPath{}, errFSPath
	}
	rest, ok := strings.CutPrefix(uri, filesystemScheme+":")
	if !ok {
		return fsPath{}, errFSPath
	}
	trimmed := strings.Trim(rest, "/")
	if trimmed == "" {
		return fsPath{}, nil
	}
	segments := strings.Split(trimmed, "/")
	if len(segments) > 2 {
		return fsPath{}, errFSPath
	}
	for _, segment := range segments {
		if !isAddressableSegment(segment) {
			return fsPath{}, errFSPath
		}
	}
	path := fsPath{dir: segments[0]}
	if path.dir != "documents" && path.dir != "exports" {
		return fsPath{}, errFSPath
	}
	if len(segments) == 2 {
		path.name = segments[1]
		if path.name != filepath.Base(path.name) {
			return fsPath{}, errFSPath
		}
	}
	return path, nil
}

// documentIDFromName maps `<uuid>.excalidraw` back to a document id.
func documentIDFromName(name string) (string, bool) {
	id, ok := strings.CutSuffix(name, ".excalidraw")
	if !ok || !uuidPattern.MatchString(id) {
		return "", false
	}
	return id, true
}

// entryNameFor keeps the user-facing file name close to the diagram title while
// guaranteeing it is a single, printable path component.
func entryNameFor(title, id string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		if strings.ContainsRune(`/\:*?"<>|`, r) {
			return '-'
		}
		return r
	}, strings.TrimSpace(title))
	cleaned = strings.Trim(cleaned, ". ")
	if cleaned == "" {
		cleaned = id[:8]
	}
	if utf8.RuneCountInString(cleaned) > 120 {
		cleaned = string([]rune(cleaned)[:120])
	}
	return cleaned + ".excalidraw"
}

func contentTypeForExport(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	case ".json", ".excalidraw":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}

func modifiedAtOf(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return info.ModTime().UTC().Format(time.RFC3339)
}

func dirEntry(name string) FSEntry {
	return FSEntry{
		Name: name,
		URI:  fmt.Sprintf("%s:/%s/", filesystemScheme, name),
		Kind: fsKindDirectory,
	}
}

// FSList returns one page of entries. `cursor` is an opaque offset into the
// name-sorted listing for the directory being read.
func (s *Store) FSList(uri, cursor string, limit int) ([]FSEntry, string, error) {
	path, err := parseFSPath(uri)
	if err != nil {
		return nil, "", err
	}
	offset, err := parseFSCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	if limit <= 0 || limit > maxFSListLimit {
		limit = maxFSListLimit
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	var entries []FSEntry
	switch {
	case path.dir == "":
		entries = []FSEntry{dirEntry("documents"), dirEntry("exports")}
	case path.name != "":
		// Listing a leaf is a host-side mistake, not an empty directory.
		return nil, "", errFSNotFound
	case path.dir == "documents":
		entries, err = s.listFSDocuments()
	default:
		entries, err = s.listFSExports()
	}
	if err != nil {
		return nil, "", err
	}
	page, next := paginateFS(entries, offset, limit)
	return page, next, nil
}

func parseFSCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(cursor)
	if err != nil || offset < 0 {
		return 0, errFSPath
	}
	return offset, nil
}

// paginateFS slices one page out of the name-sorted listing. Callers hold the
// store mutex; the sort is applied here so every caller pages a stable order.
func paginateFS(entries []FSEntry, offset, limit int) ([]FSEntry, string) {
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	if offset > len(entries) {
		offset = len(entries)
	}
	page := entries[offset:]
	next := ""
	if len(page) > limit {
		page = page[:limit]
		next = strconv.Itoa(offset + limit)
	}
	if page == nil {
		page = []FSEntry{}
	}
	return page, next
}

// listFSDocuments exposes one entry per document. Callers hold the store mutex.
func (s *Store) listFSDocuments() ([]FSEntry, error) {
	return s.listFSPath(s.documentsDir, func(name string) *FSEntry {
		id, ok := documentIDFromName(name)
		if !ok {
			return nil
		}
		meta, err := s.readMeta(id)
		if err != nil {
			return nil
		}
		entry := s.documentEntry(id, meta)
		return &entry
	})
}

// listFSExports exposes finished exports. The scratch directory used by
// interrupted writes is skipped; it is an implementation detail and is not
// addressable through a URI either. Callers hold the store mutex.
func (s *Store) listFSExports() ([]FSEntry, error) {
	return s.listFSPath(s.exportsDir, func(name string) *FSEntry {
		if strings.HasPrefix(name, ".") {
			return nil
		}
		entry := s.exportEntry(name)
		return &entry
	})
}

// listFSPath reads a directory and maps every accepted file to an entry.
// Callers must hold the store mutex.
func (s *Store) listFSPath(dir string, build func(string) *FSEntry) ([]FSEntry, error) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	entries := []FSEntry{}
	for _, item := range items {
		if item.IsDir() {
			continue
		}
		// Document metadata sidecars are an implementation detail; the scene
		// file is the entry. Foreign files (and the .excalidraw name of a
		// document with no metadata) are skipped rather than exposed.
		if strings.HasSuffix(item.Name(), ".meta.json") {
			continue
		}
		if entry := build(item.Name()); entry != nil {
			entries = append(entries, *entry)
		}
	}
	return entries, nil
}

// FSRead returns a file's bytes. Documents are rehydrated into standard,
// self-contained .excalidraw JSON.
func (s *Store) FSRead(uri string, maxBytes int64) ([]byte, string, string, error) {
	path, err := parseFSPath(uri)
	if err != nil {
		return nil, "", "", err
	}
	if path.name == "" {
		return nil, "", "", errFSPath
	}
	if maxBytes <= 0 {
		maxBytes = 256 * 1024
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	var (
		data        []byte
		contentType string
		// The etag is taken over the bytes on disk, never over the rehydrated
		// output: FSWrite's optimistic-concurrency check compares against the
		// stored scene, so hashing what was returned here would mean a token
		// that could never match and a read-modify-write that always failed.
		etagSource []byte
	)
	switch path.dir {
	case "documents":
		id, ok := documentIDFromName(path.name)
		if !ok {
			return nil, "", "", errFSNotFound
		}
		raw, readErr := os.ReadFile(s.scenePath(id))
		if errors.Is(readErr, os.ErrNotExist) {
			return nil, "", "", errFSNotFound
		}
		if readErr != nil {
			return nil, "", "", readErr
		}
		etagSource = raw
		data, err = s.rehydrateScene(raw, maxBytes)
		if err != nil {
			return nil, "", "", err
		}
		contentType = fsDocumentMIME
	case "exports":
		absolute := filepath.Join(s.exportsDir, path.name)
		data, err = os.ReadFile(absolute)
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", "", errFSNotFound
		}
		if err != nil {
			return nil, "", "", err
		}
		etagSource = data
		contentType = contentTypeForExport(path.name)
	}
	if int64(len(data)) > maxBytes {
		return nil, "", "", fmt.Errorf(
			"%w: %s is %d bytes but only %d bytes were requested", errFSTooLarge, path.name, len(data), maxBytes,
		)
	}
	sum := sha256.Sum256(etagSource)
	return data, contentType, hex.EncodeToString(sum[:]), nil
}

// FSWrite replaces a document from a standard .excalidraw payload, stripping
// image dataURLs into the content-addressed asset store the same way the editor
// does. Exports are produced by the export flow and are not writable here.
func (s *Store) FSWrite(uri string, data []byte, create, overwrite bool, etag string) (FSEntry, error) {
	path, err := parseFSPath(uri)
	if err != nil {
		return FSEntry{}, err
	}
	if path.dir == "exports" {
		return FSEntry{}, errFSReadOnly
	}
	if path.name == "" {
		return FSEntry{}, errFSPath
	}
	if int64(len(data)) > maxFSWriteBytes {
		return FSEntry{}, fmt.Errorf("%w: filesystem writes are limited to %d bytes", errFSTooLarge, maxFSWriteBytes)
	}

	// Normalise and validate the payload before anything is minted or replaced.
	// Doing this after minting meant every rejected create still deposited an
	// empty document in the library: the caller saw a failure while the store
	// had already changed. The assets the payload contributed are held back and
	// only committed once the guards below have passed, so a rejected write
	// moves no bytes at all.
	stripped, assets, err := s.stripSceneFiles(data)
	if err != nil {
		return FSEntry{}, err
	}
	if err := validateScene(stripped); err != nil {
		return FSEntry{}, err
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	id, minted, err := s.resolveWriteTarget(path.name, create)
	if err != nil {
		return FSEntry{}, err
	}
	if err := s.checkWriteGuards(id, minted, create, overwrite, etag); err != nil {
		return FSEntry{}, err
	}

	// Read the metadata before touching anything. Reading it after the scene was
	// replaced meant a damaged sidecar produced a failure response *after* the
	// content had already changed, so the caller saw "not written" while the
	// document on disk was in fact the new one.
	meta, err := s.readMeta(id)
	if err != nil {
		return FSEntry{}, err
	}
	// Assets are content-addressed, so committing one that is already present is
	// a no-op.
	for _, asset := range assets {
		if err := s.putAssetBlob(asset.hash, asset.mimeType, asset.blob); err != nil {
			return FSEntry{}, err
		}
	}
	if err := writeFileAtomic(s.scenePath(id), stripped, 0o644); err != nil {
		return FSEntry{}, err
	}
	meta.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeMeta(s.metaPath(id), meta); err != nil {
		return FSEntry{}, err
	}
	return s.documentEntry(id, meta), nil
}

// resolveWriteTarget maps the leaf of a write URI to a document id, minting one
// when the host asked to create and the leaf is not already uuid-addressed; the
// mutation result carries the canonical uuid-based URI. Callers must hold the
// store mutex.
func (s *Store) resolveWriteTarget(name string, create bool) (string, bool, error) {
	if id, ok := documentIDFromName(name); ok {
		return id, false, nil
	}
	if !create {
		return "", false, errFSNotFound
	}
	title := strings.TrimSuffix(name, filepath.Ext(name))
	if err := validateName(title); err != nil {
		return "", false, errFSPath
	}
	meta, err := s.createDocumentLocked(title)
	if err != nil {
		return "", false, err
	}
	return meta.ID, true, nil
}

// checkWriteGuards enforces the existence, overwrite and etag rules. A freshly
// minted document already owns an empty scene file, which is not a pre-existing
// entry the caller failed to ask to overwrite, so its guards are skipped.
// Callers must hold the store mutex.
func (s *Store) checkWriteGuards(id string, minted, create, overwrite bool, etag string) error {
	if minted {
		return nil
	}
	existing, err := os.ReadFile(s.scenePath(id))
	exists := err == nil
	if !exists && !create {
		return errFSNotFound
	}
	if exists && !overwrite {
		return errFSExists
	}
	if etag == "" {
		return nil
	}
	if !exists {
		return errFSStale
	}
	sum := sha256.Sum256(existing)
	if hex.EncodeToString(sum[:]) != etag {
		return errFSStale
	}
	return nil
}

func (s *Store) documentEntry(id string, meta DocumentMeta) FSEntry {
	entry := FSEntry{
		Name:        entryNameFor(meta.Name, id),
		URI:         fmt.Sprintf("%s:/documents/%s.excalidraw", filesystemScheme, id),
		Kind:        fsKindFile,
		ModifiedAt:  modifiedAtOf(s.scenePath(id)),
		ContentType: fsDocumentMIME,
	}
	size := s.readSize(id)
	entry.Size = &size
	return entry
}

// base64Length is the encoded length of n raw bytes.
func base64Length(n int64) int64 {
	return (n + 2) / 3 * 4
}

// rehydratedEntryOverhead bounds the fixed JSON cost of swapping a hash
// reference for an inlined dataURL: the keys, the `data:` prefix, `;base64,`
// and the surrounding quoting.
const rehydratedEntryOverhead = 512

// inlinedEntryCost is the byte cost of inlining one asset, as the JSON
// serializer will emit it. readSize and rehydrateScene must agree on this:
// two independent formulas is exactly how the listed size stopped being an
// upper bound on what a read returns.
func inlinedEntryCost(assetBytes int64, mimeType string) int64 {
	return base64Length(assetBytes) + int64(len(mimeType)) + rehydratedEntryOverhead
}

// readSize reports an upper bound on the byte count FSRead would return for a
// document: the stored scene plus every referenced asset expanded back into a
// dataURL.
//
// Reporting the on-disk scene size instead was actively misleading — that file
// holds hash references, so a document with images listed as a few hundred
// bytes while a read produced megabytes.
func (s *Store) readSize(id string) int64 {
	raw, err := os.ReadFile(s.scenePath(id))
	if err != nil {
		return 0
	}
	var doc struct {
		Files map[string]struct {
			Hash     string `json:"hash"`
			MimeType string `json:"mimeType"`
			Size     *int64 `json:"size"`
		} `json:"files"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return int64(len(raw))
	}
	total := int64(len(raw))
	for _, entry := range doc.Files {
		// Without a hash nothing gets inlined, so the entry costs only its own
		// JSON — which is already inside len(raw).
		if entry.Hash == "" {
			continue
		}
		var assetBytes int64
		if entry.Size != nil && *entry.Size > 0 {
			assetBytes = *entry.Size
		}
		// The stored size is only a hint: an entry written without one is still
		// inlined, and the asset on disk is authoritative. Taking the larger of
		// the two keeps this an upper bound; a missing asset keeps the hint,
		// which errs high and is therefore safe.
		if err := validateHash(entry.Hash); err == nil {
			if info, statErr := os.Stat(s.assetPath(entry.Hash)); statErr == nil && info.Size() > assetBytes {
				assetBytes = info.Size()
			}
		}
		total += inlinedEntryCost(assetBytes, entry.MimeType)
	}
	return total
}

// FSDelete removes a document or an exported file. Directories are refused:
// the host exposes no confirmation for "delete the whole library".
func (s *Store) FSDelete(uri string, recursive bool) error {
	path, err := parseFSPath(uri)
	if err != nil {
		return err
	}
	if path.name == "" {
		return errFSUnsupported
	}
	s.mutex.Lock()
	defer s.mutex.Unlock()

	switch path.dir {
	case "documents":
		id, ok := documentIDFromName(path.name)
		if !ok {
			return errFSNotFound
		}
		if _, err := os.Stat(s.scenePath(id)); errors.Is(err, os.ErrNotExist) {
			return errFSNotFound
		}
		return s.deleteDocumentLocked(id)
	default:
		absolute := filepath.Join(s.exportsDir, path.name)
		if err := os.Remove(absolute); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return errFSNotFound
			}
			return err
		}
		return nil
	}
}

// exportEntry describes one finished export. Unlike a document, the file on
// disk and the bytes a read returns are the same, so the on-disk size is the
// honest one.
func (s *Store) exportEntry(name string) FSEntry {
	entry := FSEntry{
		Name:        name,
		URI:         fmt.Sprintf("%s:/exports/%s", filesystemScheme, name),
		Kind:        fsKindFile,
		ModifiedAt:  modifiedAtOf(filepath.Join(s.exportsDir, name)),
		ContentType: contentTypeForExport(name),
	}
	if info, err := os.Stat(filepath.Join(s.exportsDir, name)); err == nil {
		size := info.Size()
		entry.Size = &size
	}
	return entry
}

// FSRename renames within one directory. For documents the leaf of targetURI is
// read as the new diagram title, while the stable uuid-based URI is unchanged —
// the mutation result carries the entry the host should display.
func (s *Store) FSRename(sourceURI, targetURI string, overwrite bool) (FSEntry, error) {
	source, err := parseFSPath(sourceURI)
	if err != nil {
		return FSEntry{}, err
	}
	target, err := parseFSPath(targetURI)
	if err != nil {
		return FSEntry{}, err
	}
	if source.dir != target.dir || source.name == "" || target.name == "" {
		return FSEntry{}, errFSUnsupported
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	if source.dir == "documents" {
		id, ok := documentIDFromName(source.name)
		if !ok {
			return FSEntry{}, errFSNotFound
		}
		title, ok := strings.CutSuffix(target.name, ".excalidraw")
		if !ok {
			title = target.name
		}
		title = strings.TrimSpace(title)
		if err := validateName(title); err != nil {
			return FSEntry{}, errFSPath
		}
		meta, err := s.readMeta(id)
		if err != nil {
			return FSEntry{}, errFSNotFound
		}
		meta.Name = title
		if err := writeMeta(s.metaPath(id), meta); err != nil {
			return FSEntry{}, err
		}
		return s.documentEntry(id, meta), nil
	}

	from := filepath.Join(s.exportsDir, source.name)
	to := filepath.Join(s.exportsDir, target.name)
	if err := validateExportName(target.name); err != nil {
		return FSEntry{}, errFSPath
	}
	if _, err := os.Stat(from); errors.Is(err, os.ErrNotExist) {
		return FSEntry{}, errFSNotFound
	}
	if _, err := os.Stat(to); err == nil && !overwrite {
		return FSEntry{}, errFSExists
	}
	if err := os.Rename(from, to); err != nil {
		return FSEntry{}, err
	}
	return s.exportEntry(target.name), nil
}

// rehydrateScene turns the stored (image-stripped) scene back into a standard
// .excalidraw document by inlining every referenced asset. An asset that cannot
// be read is left as its hash reference rather than failing the whole read: the
// element degrades to Excalidraw's placeholder instead of the file being
// unreadable.
//
// maxBytes is enforced while the document is assembled, not after. A scene that
// references one large asset many times is tiny on disk but enormous once
// inlined, so measuring afterwards would let a few-kilobyte file drive an
// allocation limited only by how many references it can hold.
func (s *Store) rehydrateScene(raw []byte, maxBytes int64) ([]byte, error) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		// Corrupt scenes are surfaced verbatim; the editor reports them.
		return raw, nil
	}
	filesRaw, ok := doc["files"]
	if !ok {
		return raw, nil
	}
	var files map[string]map[string]any
	if err := json.Unmarshal(filesRaw, &files); err != nil {
		return raw, nil
	}
	changed := false
	projected := int64(len(raw))
	for fileID, entry := range files {
		hash, _ := entry["hash"].(string)
		if hash == "" {
			continue
		}
		// The stored scene is attacker-reachable: importing a crafted
		// .excalidraw file persists whatever hash strings it contains, and
		// assetPath joins that value onto the asset directory. Without this
		// check a hash of `..\..\secret` reads an arbitrary file and inlines it
		// into the document returned to the host.
		if err := validateHash(hash); err != nil {
			continue
		}
		blob, err := os.ReadFile(s.assetPath(hash))
		if err != nil {
			continue
		}
		mimeType, _ := entry["mimeType"].(string)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		// The same accounting readSize advertises, so a listing stays a valid
		// upper bound for the caller's read budget.
		projected += inlinedEntryCost(int64(len(blob)), mimeType)
		if projected > maxBytes {
			return nil, fmt.Errorf(
				"%w: embedding image data would exceed the %d byte budget", errFSTooLarge, maxBytes,
			)
		}
		entry["dataURL"] = "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(blob)
		delete(entry, "hash")
		delete(entry, "size")
		files[fileID] = entry
		changed = true
	}
	if !changed {
		return raw, nil
	}
	encodedFiles, err := json.Marshal(files)
	if err != nil {
		return raw, nil
	}
	doc["files"] = encodedFiles
	out, err := json.Marshal(doc)
	if err != nil {
		return raw, nil
	}
	if int64(len(out)) > maxBytes {
		return nil, fmt.Errorf("%w: rehydrated document exceeds the %d byte budget", errFSTooLarge, maxBytes)
	}
	return out, nil
}

// stripSceneFiles is rehydrateScene's inverse: image dataURLs are moved into the
// content-addressed asset store and replaced by their hash reference, keeping
// the persisted scene small.
// strippedAsset is an asset the payload contributed, held back until the write
// is known to be valid.
type strippedAsset struct {
	hash     string
	mimeType string
	blob     []byte
}

// stripSceneFiles is rehydrateScene's inverse: image dataURLs are replaced by
// their content hash and the resulting bytes are returned ready to persist.
//
// The assets those hashes refer to are *returned* rather than written, so a
// caller can normalise and validate a payload before deciding whether the
// request is allowed. Committing them here instead would mean a rejected write
// still moved bytes into the asset store — the same "failed operation left a
// side effect" defect the write path was just fixed for.
func (s *Store) stripSceneFiles(scene []byte) ([]byte, []strippedAsset, error) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(scene, &doc); err != nil {
		return nil, nil, errInvalidScene
	}
	filesRaw, ok := doc["files"]
	if !ok {
		return scene, nil, nil
	}
	var files map[string]map[string]any
	if err := json.Unmarshal(filesRaw, &files); err != nil {
		return nil, nil, errInvalidScene
	}
	var assets []strippedAsset
	changed := false
	for fileID, entry := range files {
		dataURL, _ := entry["dataURL"].(string)
		if !strings.HasPrefix(dataURL, "data:") {
			continue
		}
		mimeType, blob, err := decodeDataURL(dataURL)
		if err != nil || len(blob) == 0 {
			// Zero-length assets cannot be content-addressed, so they stay
			// inline — matching how the editor persists them.
			continue
		}
		sum := sha256.Sum256(blob)
		hash := hex.EncodeToString(sum[:])
		assets = append(assets, strippedAsset{hash: hash, mimeType: mimeType, blob: blob})
		entry["hash"] = hash
		entry["size"] = len(blob)
		if _, present := entry["mimeType"]; !present {
			entry["mimeType"] = mimeType
		}
		delete(entry, "dataURL")
		files[fileID] = entry
		changed = true
	}
	if !changed {
		return scene, nil, nil
	}
	encodedFiles, err := json.Marshal(files)
	if err != nil {
		return nil, nil, err
	}
	doc["files"] = encodedFiles
	stripped, err := json.Marshal(doc)
	if err != nil {
		return nil, nil, err
	}
	return stripped, assets, nil
}

func decodeDataURL(dataURL string) (string, []byte, error) {
	header, payload, ok := strings.Cut(dataURL, ",")
	if !ok {
		return "", nil, errInvalidScene
	}
	mimeType, ok := strings.CutPrefix(header, "data:")
	if !ok {
		return "", nil, errInvalidScene
	}
	mimeType, ok = strings.CutSuffix(mimeType, ";base64")
	if !ok {
		return "", nil, errInvalidScene
	}
	blob, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", nil, errInvalidScene
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return mimeType, blob, nil
}

// putAssetBlob commits a complete asset in a single step. The chunked path in
// assets.go exists for the size-bounded bridge; a filesystem write already
// carries the whole payload. Assets are content-addressed, so a rewrite is
// byte-identical and safe.
func (s *Store) putAssetBlob(hash, mimeType string, blob []byte) error {
	if _, err := os.Stat(s.assetPath(hash)); err == nil {
		s.ensureAssetMeta(hash, mimeType, int64(len(blob)))
		return nil
	}
	if err := writeFileAtomic(s.assetPath(hash), blob, 0o644); err != nil {
		return err
	}
	s.ensureAssetMeta(hash, mimeType, int64(len(blob)))
	return nil
}
