package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	errDocumentNotFound = errors.New("document not found")
	errInvalidID        = errors.New("invalid document id")
	errInvalidName      = errors.New("invalid document name")
	errInvalidHash      = errors.New("invalid asset hash")
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Store owns all persistence under a single base directory:
//
//	<base>/documents/<uuid>.excalidraw   scene JSON, image dataURLs stripped
//	<base>/documents/<uuid>.meta.json    document metadata sidecar
//	<base>/assets/<sha256>               image binaries, deduplicated
//	<base>/assets/<sha256>.json          asset metadata
//	<base>/assets/.partial/<sha256>      in-flight chunk uploads
//	<base>/exports/<name>                files written by export/write
//	<base>/exports/.partial/<jobId>      in-flight chunked export writes
type Store struct {
	mutex         sync.Mutex
	baseDir       string
	documentsDir  string
	assetsDir     string
	partialDir    string
	exportsDir    string
	exportPartial string
}

// resolveBaseDir picks the plugin data location. Neither the sidecar protocol
// nor the Go SDK currently hands the plugin an official DBX data directory, so
// we honor DBX_PLUGIN_DATA_DIR when the host provides one and fall back to a
// per-user config directory otherwise.
func resolveBaseDir(pluginID string) (string, error) {
	if dir := os.Getenv("DBX_PLUGIN_DATA_DIR"); dir != "" {
		return filepath.Join(dir, pluginID), nil
	}
	if dir := os.Getenv("EXCALIDRAW_STUDIO_DATA_DIR"); dir != "" {
		return dir, nil
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(config, "dbx-plugins", pluginID), nil
}

func NewStore(pluginID string) (*Store, error) {
	base, err := resolveBaseDir(pluginID)
	if err != nil {
		return nil, err
	}
	return newStoreAt(base)
}

func newStoreAt(base string) (*Store, error) {
	store := &Store{
		baseDir:       base,
		documentsDir:  filepath.Join(base, "documents"),
		assetsDir:     filepath.Join(base, "assets"),
		partialDir:    filepath.Join(base, "assets", ".partial"),
		exportsDir:    filepath.Join(base, "exports"),
		exportPartial: filepath.Join(base, "exports", ".partial"),
	}
	for _, dir := range []string{store.documentsDir, store.assetsDir, store.partialDir, store.exportsDir, store.exportPartial} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if err := store.reconcile(); err != nil {
		return nil, err
	}
	store.sweepStaleExportPartials()
	return store, nil
}

// reconcile rebuilds consistency between scenes and metadata sidecars at
// startup: scenes without meta get a recovered meta, metas without a scene
// are dropped. This removes the need for a crash-prone central index file.
func (s *Store) reconcile() error {
	entries, err := os.ReadDir(s.documentsDir)
	if err != nil {
		return err
	}
	scenes := map[string]bool{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".excalidraw") || entry.IsDir() {
			continue
		}
		id := strings.TrimSuffix(name, ".excalidraw")
		if !uuidPattern.MatchString(id) {
			fmt.Fprintf(os.Stderr, "[excalidraw-studio] ignoring foreign file %q\n", name)
			continue
		}
		scenes[id] = true
		if _, err := os.Stat(s.metaPath(id)); errors.Is(err, os.ErrNotExist) {
			info, infoErr := entry.Info()
			modified := time.Now().UTC()
			if infoErr == nil {
				modified = info.ModTime().UTC()
			}
			recovered := DocumentMeta{
				ID:            id,
				Name:          "Recovered " + id[:8],
				CreatedAt:     modified.Format(time.RFC3339),
				UpdatedAt:     modified.Format(time.RFC3339),
				LastOpenedAt:  modified.Format(time.RFC3339),
				FormatVersion: formatVersion,
			}
			if err := writeMeta(s.metaPath(id), recovered); err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "[excalidraw-studio] recovered metadata for %s\n", id)
		}
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".meta.json") || entry.IsDir() {
			continue
		}
		id := strings.TrimSuffix(name, ".meta.json")
		if !uuidPattern.MatchString(id) || scenes[id] {
			continue
		}
		if err := os.Remove(s.metaPath(id)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		fmt.Fprintf(os.Stderr, "[excalidraw-studio] dropped orphan metadata for %s\n", id)
	}
	return nil
}

func (s *Store) scenePath(id string) string { return filepath.Join(s.documentsDir, id+".excalidraw") }
func (s *Store) metaPath(id string) string  { return filepath.Join(s.documentsDir, id+".meta.json") }
func (s *Store) assetPath(hash string) string {
	return filepath.Join(s.assetsDir, hash)
}
func (s *Store) assetMetaPath(hash string) string {
	return filepath.Join(s.assetsDir, hash+".json")
}
func (s *Store) partialPath(hash string) string {
	return filepath.Join(s.partialDir, hash)
}
func (s *Store) exportPath(name string) string {
	return filepath.Join(s.exportsDir, name)
}
func (s *Store) exportPartialPath(jobID string) string {
	return filepath.Join(s.exportPartial, jobID)
}

func sortDocuments(documents []DocumentMeta) {
	sort.Slice(documents, func(i, j int) bool {
		if documents[i].LastOpenedAt != documents[j].LastOpenedAt {
			return documents[i].LastOpenedAt > documents[j].LastOpenedAt
		}
		return documents[i].Name < documents[j].Name
	})
}
