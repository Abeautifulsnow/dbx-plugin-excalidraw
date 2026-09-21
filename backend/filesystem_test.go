package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fsRoot = "excalidraw:/"

func mustWriteDoc(t *testing.T, store *Store, name, dataURL string) DocumentMeta {
	t.Helper()
	meta, err := store.CreateDocument(name)
	if err != nil {
		t.Fatalf("create %q: %v", name, err)
	}
	scene := map[string]any{
		"type":     "excalidraw",
		"version":  2,
		"elements": []any{},
		"files":    map[string]any{},
	}
	if dataURL != "" {
		scene["files"] = map[string]any{
			"img-1": map[string]any{"id": "img-1", "mimeType": "image/png", "dataURL": dataURL},
		}
	}
	encoded, err := json.Marshal(scene)
	if err != nil {
		t.Fatalf("marshal scene: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, encoded); err != nil {
		t.Fatalf("save %q: %v", name, err)
	}
	return meta
}

func TestFilesystemRootListsBothDirectories(t *testing.T) {
	store := newTestStore(t)
	entries, next, err := store.FSList(fsRoot, "", 100)
	if err != nil {
		t.Fatalf("list root: %v", err)
	}
	if next != "" {
		t.Fatalf("unexpected cursor %q", next)
	}
	names := []string{}
	for _, entry := range entries {
		if entry.Kind != fsKindDirectory {
			t.Fatalf("root entry %q kind = %q, want directory", entry.Name, entry.Kind)
		}
		names = append(names, entry.Name)
	}
	if strings.Join(names, ",") != "documents,exports" {
		t.Fatalf("root entries = %v, want [documents exports]", names)
	}
}

func TestFilesystemURIsRejectTraversal(t *testing.T) {
	for _, uri := range []string{
		"excalidraw:/../secrets",
		"excalidraw:/documents/../exports/x.png",
		"excalidraw:/documents/..",
		"excalidraw:/documents/a/b/c.excalidraw",
		`excalidraw:/documents/a\b.excalidraw`,
		"excalidraw:/unknown/",
		"https://example.com/",
		"excalidraw:/documents/bad\x01name",
	} {
		if _, err := parseFSPath(uri); !errors.Is(err, errFSPath) {
			t.Fatalf("parseFSPath(%q) error = %v, want errFSPath", uri, err)
		}
	}
	if path, err := parseFSPath("excalidraw:/documents/"); err != nil || path.dir != "documents" || path.name != "" {
		t.Fatalf("document directory did not parse: %+v %v", path, err)
	}
}

func TestFilesystemListDocumentsAndPagination(t *testing.T) {
	store := newTestStore(t)
	for _, name := range []string{"Alpha", "Beta", "Gamma"} {
		mustWriteDoc(t, store, name, "")
	}
	entries, next, err := store.FSList("excalidraw:/documents/", "", 2)
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	if len(entries) != 2 || next != "2" {
		t.Fatalf("first page = %d entries, cursor %q; want 2, \"2\"", len(entries), next)
	}
	if entries[0].Name != "Alpha.excalidraw" {
		t.Fatalf("first entry = %q, want Alpha.excalidraw", entries[0].Name)
	}
	page2, next2, err := store.FSList("excalidraw:/documents/", next, 2)
	if err != nil {
		t.Fatalf("list page 2: %v", err)
	}
	if len(page2) != 1 || next2 != "" {
		t.Fatalf("second page = %d entries, cursor %q; want 1, \"\"", len(page2), next2)
	}
	if _, _, err := store.FSList(fsRoot, "not-a-cursor", 10); !errors.Is(err, errFSPath) {
		t.Fatalf("malformed cursor error = %v, want errFSPath", err)
	}
}

// The editor persists scenes with image dataURLs replaced by hash references
// into the content-addressed asset store. A file read out of the filesystem
// must be a self-contained, standard .excalidraw document again.
func TestFilesystemReadRehydratesAssets(t *testing.T) {
	store := newTestStore(t)
	blob := []byte{0x89, 'P', 'N', 'G', 1, 2, 3, 4, 5}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(blob)
	sum := sha256.Sum256(blob)
	hash := hex.EncodeToString(sum[:])

	meta := mustWriteDoc(t, store, "WithImage", "")
	// Seed the exact shape the editor writes: a hash reference, no dataURL.
	stripped, err := json.Marshal(map[string]any{
		"type":     "excalidraw",
		"version":  2,
		"elements": []any{},
		"files": map[string]any{
			"img-1": map[string]any{
				"id": "img-1", "mimeType": "image/png", "hash": hash, "size": len(blob),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, stripped); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := store.putAssetBlob(hash, "image/png", blob); err != nil {
		t.Fatalf("put asset: %v", err)
	}

	_, stored, _, err := store.GetDocument(meta.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Contains(string(stored), "data:image/png") {
		t.Fatal("stored scene still embeds the dataURL")
	}

	data, contentType, etag, err := store.FSRead(
		fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), 1<<20,
	)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if contentType != fsDocumentMIME || etag == "" {
		t.Fatalf("contentType = %q etag = %q", contentType, etag)
	}
	var scene struct {
		Files map[string]struct {
			DataURL string `json:"dataURL"`
			Hash    string `json:"hash"`
		} `json:"files"`
	}
	if err := json.Unmarshal(data, &scene); err != nil {
		t.Fatalf("rehydrated scene is not valid JSON: %v", err)
	}
	entry := scene.Files["img-1"]
	if entry.DataURL != dataURL {
		t.Fatalf("rehydrated dataURL = %q, want %q", entry.DataURL, dataURL)
	}
	if entry.Hash != "" {
		t.Fatalf("rehydrated entry kept the hash reference %q", entry.Hash)
	}
}

// An asset that has gone missing must not make its document unreadable: the
// reference survives and the element degrades to Excalidraw's placeholder.
func TestFilesystemReadToleratesMissingAssets(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Orphaned", "")
	stripped := []byte(`{"type":"excalidraw","version":2,"elements":[],` +
		`"files":{"img-1":{"id":"img-1","mimeType":"image/png","hash":"` +
		strings.Repeat("a", 64) + `","size":5}}}`)
	if _, err := store.SaveScene(meta.ID, stripped); err != nil {
		t.Fatalf("save: %v", err)
	}
	data, _, _, err := store.FSRead(fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), 1<<20)
	if err != nil {
		t.Fatalf("read with missing asset: %v", err)
	}
	if !strings.Contains(string(data), strings.Repeat("a", 64)) {
		t.Fatalf("hash reference was dropped: %s", data)
	}
}

func TestFilesystemReadRejectsOversizedDocuments(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Big", "")
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)
	if _, _, _, err := store.FSRead(uri, 16); !errors.Is(err, errFSTooLarge) {
		t.Fatalf("oversized read error = %v, want errFSTooLarge", err)
	}
}

// A scene written through the filesystem is stripped on the way in and comes
// back byte-identical, so a round trip through DBX's file browser does not lose
// images.
func TestFilesystemWriteRoundTrips(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Target", "")
	blob := []byte{9, 8, 7, 6, 5, 4}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(blob)
	scene, err := json.Marshal(map[string]any{
		"type":     "excalidraw",
		"version":  2,
		"elements": []any{map[string]any{"type": "image", "id": "e1"}},
		"files":    map[string]any{"img-1": map[string]any{"id": "img-1", "mimeType": "image/png", "dataURL": dataURL}},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)
	entry, err := store.FSWrite(uri, scene, false, true, "")
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if entry.URI != uri {
		t.Fatalf("entry uri = %q, want %q", entry.URI, uri)
	}

	_, stored, _, err := store.GetDocument(meta.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Contains(string(stored), "data:image/png") {
		t.Fatal("stored scene still embeds the dataURL after a filesystem write")
	}

	back, _, _, err := store.FSRead(uri, 1<<20)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var round struct {
		Files map[string]struct {
			DataURL string `json:"dataURL"`
		} `json:"files"`
	}
	if err := json.Unmarshal(back, &round); err != nil {
		t.Fatalf("round-tripped scene is not valid JSON: %v", err)
	}
	if round.Files["img-1"].DataURL != dataURL {
		t.Fatalf("round-tripped dataURL = %q, want %q", round.Files["img-1"].DataURL, dataURL)
	}
}

func TestFilesystemWriteGuards(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Guarded", "")
	scene := []byte(`{"type":"excalidraw","version":2,"elements":[],"files":{}}`)
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)

	if _, err := store.FSWrite(uri, scene, false, false, ""); !errors.Is(err, errFSExists) {
		t.Fatalf("overwrite=false error = %v, want errFSExists", err)
	}
	if _, err := store.FSWrite("excalidraw:/documents/missing.excalidraw", scene, false, true, ""); !errors.Is(err, errFSNotFound) {
		t.Fatalf("create=false error = %v, want errFSNotFound", err)
	}
	if _, err := store.FSWrite("excalidraw:/exports/report.png", scene, false, true, ""); !errors.Is(err, errFSReadOnly) {
		t.Fatalf("exports write error = %v, want errFSReadOnly", err)
	}
	if _, err := store.FSWrite(uri, []byte("not json"), false, true, ""); !errors.Is(err, errInvalidScene) {
		t.Fatalf("invalid scene error = %v, want errInvalidScene", err)
	}

	_, _, etag, err := store.FSRead(uri, 1<<20)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if _, err := store.FSWrite(uri, scene, false, true, "stale-etag"); !errors.Is(err, errFSStale) {
		t.Fatalf("stale etag error = %v, want errFSStale", err)
	}
	if _, err := store.FSWrite(uri, scene, false, true, etag); err != nil {
		t.Fatalf("matching etag write: %v", err)
	}
}

// Creating through the filesystem mints a document and reports the canonical
// uuid URI, so the host can address it afterwards.
func TestFilesystemWriteCreatesDocument(t *testing.T) {
	store := newTestStore(t)
	scene := []byte(`{"type":"excalidraw","version":2,"elements":[],"files":{}}`)
	entry, err := store.FSWrite("excalidraw:/documents/Quarterly Plan.excalidraw", scene, true, false, "")
	if err != nil {
		t.Fatalf("create via filesystem: %v", err)
	}
	if !strings.HasPrefix(entry.URI, "excalidraw:/documents/") || !strings.HasSuffix(entry.URI, ".excalidraw") {
		t.Fatalf("created entry uri = %q", entry.URI)
	}
	if entry.Name != "Quarterly Plan.excalidraw" {
		t.Fatalf("created entry name = %q", entry.Name)
	}
	id, ok := documentIDFromName(strings.TrimPrefix(entry.URI, "excalidraw:/documents/"))
	if !ok {
		t.Fatalf("created uri is not uuid-addressed: %q", entry.URI)
	}
	meta, err := store.readMeta(id)
	if err != nil {
		t.Fatalf("read meta: %v", err)
	}
	if meta.Name != "Quarterly Plan" {
		t.Fatalf("document name = %q, want Quarterly Plan", meta.Name)
	}
}

func TestFilesystemDeleteAndRename(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Before", "")
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)

	renamed, err := store.FSRename(uri, "excalidraw:/documents/After.excalidraw", false)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "After.excalidraw" || renamed.URI != uri {
		t.Fatalf("renamed entry = %+v, want name After.excalidraw and stable uri %q", renamed, uri)
	}
	after, err := store.readMeta(meta.ID)
	if err != nil {
		t.Fatalf("read meta: %v", err)
	}
	if after.Name != "After" {
		t.Fatalf("document name = %q, want After", after.Name)
	}

	if err := store.FSDelete(fsRoot, true); !errors.Is(err, errFSUnsupported) {
		t.Fatalf("delete root error = %v, want errFSUnsupported", err)
	}
	if err := store.FSDelete(uri, false); err != nil {
		t.Fatalf("delete document: %v", err)
	}
	if _, err := store.readMeta(meta.ID); !errors.Is(err, errDocumentNotFound) {
		t.Fatalf("metadata survived delete: %v", err)
	}
	if err := store.FSDelete(uri, false); !errors.Is(err, errFSNotFound) {
		t.Fatalf("second delete error = %v, want errFSNotFound", err)
	}
}

// A document whose stored scene is unreadable is still listed and readable: the
// editor reports the damage, and a corrupt file must not disappear from the
// filesystem.
func TestFilesystemSurfacesCorruptScenes(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Broken", "")
	if err := writeFileAtomic(store.scenePath(meta.ID), []byte("{not json"), 0o644); err != nil {
		t.Fatalf("corrupt scene: %v", err)
	}
	entries, _, err := store.FSList("excalidraw:/documents/", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	data, _, _, err := store.FSRead(fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), 1<<20)
	if err != nil {
		t.Fatalf("read corrupt scene: %v", err)
	}
	if string(data) != "{not json" {
		t.Fatalf("corrupt scene read back as %q", data)
	}
}

func TestFilesystemExportsAreListedAndReadable(t *testing.T) {
	store := newTestStore(t)
	if err := writeFileAtomic(store.exportPath("diagram.png"), []byte("png-bytes"), 0o644); err != nil {
		t.Fatalf("seed export: %v", err)
	}
	entries, _, err := store.FSList("excalidraw:/exports/", "", 10)
	if err != nil {
		t.Fatalf("list exports: %v", err)
	}
	if len(entries) != 1 || entries[0].ContentType != "image/png" {
		t.Fatalf("exports = %+v", entries)
	}
	data, _, _, err := store.FSRead("excalidraw:/exports/diagram.png", 1<<20)
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	if string(data) != "png-bytes" {
		t.Fatalf("export bytes = %q", data)
	}
	if err := store.FSDelete("excalidraw:/exports/diagram.png", false); err != nil {
		t.Fatalf("delete export: %v", err)
	}
	if _, _, _, err := store.FSRead("excalidraw:/exports/diagram.png", 1<<20); !errors.Is(err, errFSNotFound) {
		t.Fatalf("read deleted export error = %v, want errFSNotFound", err)
	}
}

func TestFilesystemEntryNamesStaySingleComponents(t *testing.T) {
	store := newTestStore(t)
	meta, err := store.CreateDocument("a/b\\c:d*e?f\"g<h>i|j")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	entries, _, err := store.FSList("excalidraw:/documents/", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	name := entries[0].Name
	if strings.ContainsAny(name, `/\:*?"<>|`) || strings.Contains(name, "..") {
		t.Fatalf("entry name %q is not a safe single path component", name)
	}
	if entries[0].URI != fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID) {
		t.Fatalf("entry uri = %q", entries[0].URI)
	}
}

// A stored scene is attacker-reachable: importing a crafted .excalidraw file
// persists whatever hash strings it carries. An unvalidated hash is joined onto
// the asset directory, so reading it back would inline an arbitrary local file
// into the document handed to the host.
func TestFilesystemReadRefusesTraversingHashes(t *testing.T) {
	store := newTestStore(t)
	secret := filepath.Join(store.baseDir, "SECRET.txt")
	if err := os.WriteFile(secret, []byte("TOP-SECRET"), 0o644); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	meta := mustWriteDoc(t, store, "Crafted", "")

	for _, hash := range []string{
		`..\SECRET.txt`,
		`..\..\..\SECRET.txt`,
		"../../SECRET.txt",
		`C:\Windows\win.ini`,
		strings.Repeat("a", 63), // right shape, wrong length
		strings.ToUpper(strings.Repeat("a", 64)),
	} {
		scene, err := json.Marshal(map[string]any{
			"type": "excalidraw", "version": 2, "elements": []any{},
			"files": map[string]any{"i": map[string]any{"mimeType": "text/plain", "hash": hash}},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if _, err := store.SaveScene(meta.ID, scene); err != nil {
			t.Fatalf("save: %v", err)
		}
		data, _, _, err := store.FSRead(fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), 1<<20)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if strings.Contains(string(data), "TOP-SECRET") || strings.Contains(string(data), "data:text/plain") {
			t.Fatalf("hash %q leaked file contents: %s", hash, data)
		}
		if !strings.Contains(string(data), "hash") {
			t.Fatalf("hash %q: reference was dropped instead of passed through: %s", hash, data)
		}
	}
}

// A scene that references one large asset many times is a few kilobytes on disk
// but enormous once inlined. The byte budget must be enforced while assembling
// the document, not after, or a tiny file drives a multi-hundred-MB allocation.
func TestFilesystemReadBoundsRehydrationMemory(t *testing.T) {
	store := newTestStore(t)
	blob := make([]byte, 1<<20)
	sum := sha256.Sum256(blob)
	hash := hex.EncodeToString(sum[:])
	if err := store.putAssetBlob(hash, "image/png", blob); err != nil {
		t.Fatalf("put asset: %v", err)
	}
	meta := mustWriteDoc(t, store, "Bomb", "")

	files := map[string]any{}
	for index := range 200 {
		files[fmt.Sprintf("f%04d", index)] = map[string]any{"mimeType": "image/png", "hash": hash}
	}
	scene, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{}, "files": files,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, scene); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Sanity: the on-disk scene is tiny, the inlined one would be ~270 MiB.
	if len(scene) > 100_000 {
		t.Fatalf("scene fixture is %d bytes; expected a small file holding many references", len(scene))
	}

	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)
	if _, _, _, err := store.FSRead(uri, 1<<10); !errors.Is(err, errFSTooLarge) {
		t.Fatalf("1 KiB budget error = %v, want errFSTooLarge", err)
	}

	// The same asset referenced once is legitimately readable, so the budget
	// rejects the size of the output rather than the fact that images are
	// involved.
	single, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{},
		"files": map[string]any{"only": map[string]any{"mimeType": "image/png", "hash": hash}},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, single); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, _, _, err := store.FSRead(uri, 4<<20); err != nil {
		t.Fatalf("a single 1 MiB asset should fit a 4 MiB budget: %v", err)
	}
}

func TestFilesystemPathsRejectWindowsNameAliasing(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Alias", "")
	for _, uri := range []string{
		// Windows strips these when resolving a name, so two distinct URIs
		// would otherwise address one file.
		fmt.Sprintf("excalidraw:/documents/%s.excalidraw ", meta.ID),
		fmt.Sprintf("excalidraw:/documents/ %s.excalidraw", meta.ID),
		// The exports scratch directory must not be addressable.
		"excalidraw:/exports/.partial",
		"excalidraw:/documents/.meta.json",
		// Trailing dot is stripped by Windows too.
		"excalidraw:/documents/x.excalidraw.",
	} {
		if _, err := parseFSPath(uri); !errors.Is(err, errFSPath) {
			t.Fatalf("parseFSPath(%q) error = %v, want errFSPath", uri, err)
		}
		if _, _, _, err := store.FSRead(uri, 1<<20); err == nil {
			t.Fatalf("FSRead(%q) succeeded", uri)
		}
		if err := store.FSDelete(uri, false); err == nil {
			t.Fatalf("FSDelete(%q) succeeded", uri)
		}
		if _, err := store.FSRename(uri, "excalidraw:/exports/x.png", false); err == nil {
			t.Fatalf("FSRename(%q) succeeded", uri)
		}
	}
	// The exports scratch directory must survive all of that.
	if _, err := os.Stat(store.exportPartial); err != nil {
		t.Fatalf("exports .partial directory is gone: %v", err)
	}
}

// Windows resolves device names regardless of directory, so `exports\NUL`
// addresses the null device rather than creating a file. Such a name must be
// refused at the boundary instead of producing a phantom entry.
func TestFilesystemPathsRejectWindowsDeviceNames(t *testing.T) {
	store := newTestStore(t)
	for _, name := range []string{"NUL", "nul", "CON", "COM1", "LPT9", "AUX.txt", "PRN.log", "NUL "} {
		uri := fmt.Sprintf("excalidraw:/exports/%s", name)
		if _, err := parseFSPath(uri); !errors.Is(err, errFSPath) {
			t.Fatalf("parseFSPath(%q) error = %v, want errFSPath", uri, err)
		}
		if err := validateExportName(name); !errors.Is(err, errExportName) {
			t.Fatalf("validateExportName(%q) error = %v, want errExportName", name, err)
		}
	}
	// Ordinary names that merely start with the same letters are still fine.
	for _, name := range []string{"NULLABLE.png", "console.svg", "COM10.png"} {
		if err := validateExportName(name); err != nil {
			t.Fatalf("validateExportName(%q) = %v, want nil", name, err)
		}
	}
	if err := writeFileAtomic(store.exportPath("real.png"), []byte("bytes"), 0o644); err != nil {
		t.Fatalf("seed export: %v", err)
	}
	if _, err := store.FSRename("excalidraw:/exports/real.png", "excalidraw:/exports/NUL", true); !errors.Is(err, errFSPath) {
		t.Fatalf("rename onto NUL error = %v, want errFSPath", err)
	}
	if _, err := os.Stat(store.exportPath("real.png")); err != nil {
		t.Fatalf("source export was disturbed by the refused rename: %v", err)
	}
}

// FSRead's etag must be a token FSWrite accepts. An earlier version hashed the
// rehydrated bytes on read and the stored bytes on write, so every read-modify-
// write of a document containing an image was rejected as stale — and retrying
// produced the same never-matching token. The original guard test missed this
// because it used a document with no assets.
func TestFilesystemEtagIsSymmetricWithAssets(t *testing.T) {
	store := newTestStore(t)
	blob := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9}
	sum := sha256.Sum256(blob)
	hash := hex.EncodeToString(sum[:])
	if err := store.putAssetBlob(hash, "image/png", blob); err != nil {
		t.Fatalf("put asset: %v", err)
	}
	meta := mustWriteDoc(t, store, "Illustrated", "")
	stored, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{},
		"files": map[string]any{"img-1": map[string]any{"mimeType": "image/png", "hash": hash}},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, stored); err != nil {
		t.Fatalf("save: %v", err)
	}
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)

	// Read-modify-write, exactly as a host or external tool would.
	read, _, etag, err := store.FSRead(uri, 1<<20)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	edited := strings.Replace(string(read), `"version":2`, `"version":2,"edited":true`, 1)
	if edited == string(read) {
		t.Fatal("fixture did not contain the marker to edit")
	}
	if _, err := store.FSWrite(uri, []byte(edited), false, true, etag); err != nil {
		t.Fatalf("read-modify-write with the etag from FSRead was rejected: %v", err)
	}

	// The write changed the stored bytes, so the previous token must now be stale.
	if _, err := store.FSWrite(uri, stored, false, true, etag); !errors.Is(err, errFSStale) {
		t.Fatalf("stale etag after a write = %v, want errFSStale", err)
	}
	// And the new token must be accepted.
	_, _, fresh, err := store.FSRead(uri, 1<<20)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if fresh == etag {
		t.Fatal("etag did not change after the stored bytes changed")
	}
	if _, err := store.FSWrite(uri, stored, false, true, fresh); err != nil {
		t.Fatalf("write with the refreshed etag: %v", err)
	}
}

// A damaged metadata sidecar must stop a write *before* the scene is replaced,
// so a failure response never describes a document that actually changed.
func TestFilesystemWriteDoesNotMutateOnDamagedMetadata(t *testing.T) {
	store := newTestStore(t)
	meta := mustWriteDoc(t, store, "Damaged", "")
	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)

	original, err := os.ReadFile(store.scenePath(meta.ID))
	if err != nil {
		t.Fatalf("read scene: %v", err)
	}
	if err := os.WriteFile(store.metaPath(meta.ID), []byte("{ not json"), 0o644); err != nil {
		t.Fatalf("damage meta: %v", err)
	}

	replacement := []byte(`{"type":"excalidraw","version":2,"elements":[{"id":"new"}],"files":{}}`)
	if _, err := store.FSWrite(uri, replacement, false, true, ""); err == nil {
		t.Fatal("write with a damaged sidecar reported success")
	}
	after, err := os.ReadFile(store.scenePath(meta.ID))
	if err != nil {
		t.Fatalf("read scene after refused write: %v", err)
	}
	if !bytes.Equal(after, original) {
		t.Fatalf("scene was replaced despite the write failing: %s", after)
	}
}

// The listing must describe what a read returns. Reporting the on-disk scene
// size made a document with images look like a few hundred bytes while a read
// produced megabytes, so a caller sizing its request from the listing was
// refused with TOO_LARGE.
func TestFilesystemListingSizeMatchesReadSize(t *testing.T) {
	store := newTestStore(t)
	blob := make([]byte, 200*1024)
	sum := sha256.Sum256(blob)
	hash := hex.EncodeToString(sum[:])
	if err := store.putAssetBlob(hash, "image/png", blob); err != nil {
		t.Fatalf("put asset: %v", err)
	}
	meta := mustWriteDoc(t, store, "Illustrated", "")
	stored, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{},
		"files": map[string]any{
			"img-1": map[string]any{"mimeType": "image/png", "hash": hash, "size": len(blob)},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, stored); err != nil {
		t.Fatalf("save: %v", err)
	}

	entries, _, err := store.FSList("excalidraw:/documents/", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0].Size == nil {
		t.Fatalf("entries = %+v", entries)
	}
	listed := *entries[0].Size
	onDisk, err := os.Stat(store.scenePath(meta.ID))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if listed <= onDisk.Size() {
		t.Fatalf("listed size %d does not account for the inlined asset (disk %d)", listed, onDisk.Size())
	}

	// The listing must be a usable upper bound for the caller's read budget.
	data, _, _, err := store.FSRead(
		fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), listed,
	)
	if err != nil {
		t.Fatalf("read with the listed size as budget: %v", err)
	}
	if int64(len(data)) > listed {
		t.Fatalf("read returned %d bytes, more than the listed %d", len(data), listed)
	}
	// ...and a budget taken from the on-disk size must be refused, which is
	// exactly what the host's 256 KiB preview budget does to this document.
	if _, _, _, err := store.FSRead(
		fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID), onDisk.Size(),
	); !errors.Is(err, errFSTooLarge) {
		t.Fatalf("read at the on-disk size = %v, want errFSTooLarge", err)
	}
}

// A rejected write must leave nothing behind. Minting the document before the
// payload was validated deposited an empty diagram for every failure, so a
// caller that retried accumulated them without bound while being told each
// attempt had failed.
func TestFilesystemWriteDoesNotMintOnRejectedPayload(t *testing.T) {
	store := newTestStore(t)
	for _, payload := range []string{"not json", "", "[]", `{"elements":"nope"}`} {
		if _, err := store.FSWrite(
			"excalidraw:/documents/Broken.excalidraw", []byte(payload), true, false, "",
		); err == nil {
			t.Fatalf("payload %q was accepted", payload)
		}
	}
	documents, err := store.ListDocuments()
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	if len(documents) != 0 {
		t.Fatalf("rejected writes left %d document(s): %+v", len(documents), documents)
	}
	entries, _, err := store.FSList("excalidraw:/documents/", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("filesystem lists %d orphan entry(ies): %+v", len(entries), entries)
	}
}

// The listed size is an upper bound on what a read returns. It stopped being
// one when readSize and rehydrateScene each carried their own cost formula:
// an entry with a hash but no size was skipped by one and inlined by the other,
// and neither counted the mimeType that gets copied into the dataURL header.
func TestFilesystemListingSizeStaysAnUpperBound(t *testing.T) {
	store := newTestStore(t)
	blob := make([]byte, 300*1024)
	for index := range blob {
		blob[index] = byte(index)
	}
	sum := sha256.Sum256(blob)
	hash := hex.EncodeToString(sum[:])
	if err := store.putAssetBlob(hash, "image/png", blob); err != nil {
		t.Fatalf("put asset: %v", err)
	}

	meta := mustWriteDoc(t, store, "Hintless", "")
	longMimeType := "application/" + strings.Repeat("x", 4000)
	stored, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{},
		"files": map[string]any{
			// No size field at all, and a mimeType far longer than the fixed
			// overhead constant could cover.
			"a": map[string]any{"mimeType": "image/png", "hash": hash},
			"b": map[string]any{"mimeType": longMimeType, "hash": hash},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := store.SaveScene(meta.ID, stored); err != nil {
		t.Fatalf("save: %v", err)
	}

	entries, _, err := store.FSList("excalidraw:/documents/", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0].Size == nil {
		t.Fatalf("entries = %+v", entries)
	}
	listed := *entries[0].Size

	uri := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", meta.ID)
	data, _, _, err := store.FSRead(uri, listed)
	if err != nil {
		t.Fatalf("read with the listed size as budget: %v", err)
	}
	if int64(len(data)) > listed {
		t.Fatalf("read returned %d bytes, more than the listed %d", len(data), listed)
	}
}

// A rejected write must move no bytes at all — neither a document nor the
// assets the payload carried. Normalising the payload before the guards (so a
// malformed one cannot mint a document) briefly made stripping a side effect of
// *failed* requests too, which turned an error response into an unbounded write
// into the asset store.
func TestFilesystemRejectedWriteCommitsNoAssets(t *testing.T) {
	store := newTestStore(t)
	blob := make([]byte, 64*1024)
	for index := range blob {
		blob[index] = byte(index)
	}
	payload, err := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "elements": []any{},
		"files": map[string]any{
			"img": map[string]any{
				"mimeType": "image/png",
				"dataURL":  "data:image/png;base64," + base64.StdEncoding.EncodeToString(blob),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	assetCount := func() int {
		entries, readErr := os.ReadDir(store.assetsDir)
		if readErr != nil {
			t.Fatalf("read assets dir: %v", readErr)
		}
		count := 0
		for _, entry := range entries {
			if !entry.IsDir() && !strings.HasSuffix(entry.Name(), ".json") {
				count++
			}
		}
		return count
	}
	if before := assetCount(); before != 0 {
		t.Fatalf("assets present before any write: %d", before)
	}

	existing := mustWriteDoc(t, store, "Existing", "")
	existingURI := fmt.Sprintf("excalidraw:/documents/%s.excalidraw", existing.ID)

	rejections := []struct {
		name string
		uri  string
	}{
		{"create=false against a missing document", "excalidraw:/documents/missing.excalidraw"},
		{"overwrite=false against an existing document", existingURI},
		{"read-only exports path", "excalidraw:/exports/out.excalidraw"},
	}
	for _, rejection := range rejections {
		if _, err := store.FSWrite(rejection.uri, payload, false, false, ""); err == nil {
			t.Fatalf("%s: expected the write to be rejected", rejection.name)
		}
		if _, err := store.FSWrite(rejection.uri, payload, false, true, strings.Repeat("0", 64)); err == nil {
			t.Fatalf("%s: expected the stale-etag write to be rejected", rejection.name)
		}
		if after := assetCount(); after != 0 {
			t.Fatalf("%s: rejected writes committed %d asset(s)", rejection.name, after)
		}
	}

	// The same payload through an accepted write must commit the asset, so the
	// test cannot pass by never writing anything.
	if _, err := store.FSWrite(existingURI, payload, false, true, ""); err != nil {
		t.Fatalf("accepted write: %v", err)
	}
	if after := assetCount(); after != 1 {
		t.Fatalf("accepted write committed %d assets, want 1", after)
	}
	data, _, _, err := store.FSRead(existingURI, 1<<20)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(data), base64.StdEncoding.EncodeToString(blob)) {
		t.Fatal("the committed asset did not round-trip through FSRead")
	}
}
