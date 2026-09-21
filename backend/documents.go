package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

const formatVersion = 1

// The UI->host bridge caps JSON parameters at 2 MiB, and scenes are stored
// with image dataURLs stripped, so anything near this size is already broken.
const maxSceneBytes = 2_000_000
const maxNameRunes = 255

type DocumentMeta struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	LastOpenedAt  string `json:"lastOpenedAt"`
	FormatVersion int    `json:"formatVersion"`
}

func writeMeta(path string, meta DocumentMeta) error {
	encoded, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(encoded, '\n'), 0o644)
}

func (s *Store) readMeta(id string) (DocumentMeta, error) {
	raw, err := os.ReadFile(s.metaPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return DocumentMeta{}, errDocumentNotFound
	}
	if err != nil {
		return DocumentMeta{}, err
	}
	var meta DocumentMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return DocumentMeta{}, fmt.Errorf("corrupt metadata for %s: %w", id, err)
	}
	return meta, nil
}

func (s *Store) ListDocuments() ([]DocumentMeta, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	entries, err := os.ReadDir(s.documentsDir)
	if err != nil {
		return nil, err
	}
	documents := []DocumentMeta{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".meta.json") || entry.IsDir() {
			continue
		}
		id := strings.TrimSuffix(name, ".meta.json")
		if !uuidPattern.MatchString(id) {
			continue
		}
		meta, err := s.readMeta(id)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[excalidraw-studio] skipping unreadable metadata %s: %v\n", id, err)
			continue
		}
		documents = append(documents, meta)
	}
	sortDocuments(documents)
	return documents, nil
}

func (s *Store) CreateDocument(name string) (DocumentMeta, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.createDocumentLocked(name)
}

// createDocumentLocked mints a document, defaulting the name when the caller
// supplies an empty one. Callers must hold the store mutex.
func (s *Store) createDocumentLocked(name string) (DocumentMeta, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = s.nextUntitledName()
	}
	if err := validateName(name); err != nil {
		return DocumentMeta{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	meta := DocumentMeta{
		ID:            newUUID(),
		Name:          name,
		CreatedAt:     now,
		UpdatedAt:     now,
		LastOpenedAt:  now,
		FormatVersion: formatVersion,
	}
	emptyScene := []byte(`{"type":"excalidraw","version":2,"source":"dbx.excalidraw.studio","elements":[],"files":{}}` + "\n")
	if err := writeFileAtomic(s.scenePath(meta.ID), emptyScene, 0o644); err != nil {
		return DocumentMeta{}, err
	}
	if err := writeMeta(s.metaPath(meta.ID), meta); err != nil {
		return DocumentMeta{}, err
	}
	return meta, nil
}

// nextUntitledName returns "Untitled", "Untitled 2", "Untitled 3", ... per the
// PRD naming rule. Callers must hold the store mutex.
func (s *Store) nextUntitledName() string {
	taken := map[string]bool{}
	entries, err := os.ReadDir(s.documentsDir)
	if err == nil {
		for _, entry := range entries {
			name := entry.Name()
			if !strings.HasSuffix(name, ".meta.json") || entry.IsDir() {
				continue
			}
			if meta, err := s.readMeta(strings.TrimSuffix(name, ".meta.json")); err == nil {
				taken[meta.Name] = true
			}
		}
	}
	if !taken["Untitled"] {
		return "Untitled"
	}
	for index := 2; ; index++ {
		candidate := fmt.Sprintf("Untitled %d", index)
		if !taken[candidate] {
			return candidate
		}
	}
}

func validateName(name string) error {
	if name == "" {
		return errInvalidName
	}
	if utf8.RuneCountInString(name) > maxNameRunes {
		return errInvalidName
	}
	return nil
}

func validateDocumentID(id string) error {
	if !uuidPattern.MatchString(id) {
		return errInvalidID
	}
	return nil
}

// validateScene performs light structural validation: the payload must be a
// JSON object and, when "elements" is present, it must be an array. Excalidraw
// itself remains the authority on scene semantics.
func validateScene(scene []byte) error {
	if len(scene) > maxSceneBytes {
		return errSceneTooLarge
	}
	var probe struct {
		Type     string          `json:"type"`
		Elements json.RawMessage `json:"elements"`
	}
	if err := json.Unmarshal(scene, &probe); err != nil {
		return errInvalidScene
	}
	if len(probe.Elements) > 0 {
		var elements []json.RawMessage
		if err := json.Unmarshal(probe.Elements, &elements); err != nil {
			return errInvalidScene
		}
	}
	return nil
}

// GetDocument returns the metadata, raw scene bytes, and whether the stored
// scene failed to parse (corrupt scenes are reported, never overwritten).
func (s *Store) GetDocument(id string) (DocumentMeta, []byte, bool, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateDocumentID(id); err != nil {
		return DocumentMeta{}, nil, false, err
	}
	meta, err := s.readMeta(id)
	if err != nil {
		return DocumentMeta{}, nil, false, err
	}
	scene, err := os.ReadFile(s.scenePath(id))
	if errors.Is(err, os.ErrNotExist) {
		return DocumentMeta{}, nil, false, errDocumentNotFound
	}
	if err != nil {
		return DocumentMeta{}, nil, false, err
	}
	corrupt := !json.Valid(scene)
	if !corrupt {
		meta.LastOpenedAt = time.Now().UTC().Format(time.RFC3339)
		if err := writeMeta(s.metaPath(id), meta); err != nil {
			return DocumentMeta{}, nil, false, err
		}
	}
	return meta, scene, corrupt, nil
}

func (s *Store) SaveScene(id string, scene []byte) (DocumentMeta, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateDocumentID(id); err != nil {
		return DocumentMeta{}, err
	}
	if err := validateScene(scene); err != nil {
		return DocumentMeta{}, err
	}
	meta, err := s.readMeta(id)
	if err != nil {
		return DocumentMeta{}, err
	}
	if err := writeFileAtomic(s.scenePath(id), scene, 0o644); err != nil {
		return DocumentMeta{}, err
	}
	meta.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeMeta(s.metaPath(id), meta); err != nil {
		return DocumentMeta{}, err
	}
	return meta, nil
}

func (s *Store) RenameDocument(id, name string) (DocumentMeta, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateDocumentID(id); err != nil {
		return DocumentMeta{}, err
	}
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return DocumentMeta{}, err
	}
	meta, err := s.readMeta(id)
	if err != nil {
		return DocumentMeta{}, err
	}
	meta.Name = name
	if err := writeMeta(s.metaPath(id), meta); err != nil {
		return DocumentMeta{}, err
	}
	return meta, nil
}

func (s *Store) DeleteDocument(id string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.deleteDocumentLocked(id)
}

// deleteDocumentLocked removes a document's scene and metadata sidecar.
// Callers must hold the store mutex.
func (s *Store) deleteDocumentLocked(id string) error {
	if err := validateDocumentID(id); err != nil {
		return err
	}
	if _, err := s.readMeta(id); err != nil {
		return err
	}
	// Assets are intentionally retained: they are content-addressed and
	// deduplicated, so orphan sweeping can be added later without risk.
	for _, path := range []string{s.scenePath(id), s.metaPath(id)} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
