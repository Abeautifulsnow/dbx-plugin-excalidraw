package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := newStoreAt(t.TempDir())
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}
	return store
}

func TestDocumentLifecycle(t *testing.T) {
	store := newTestStore(t)

	created, err := store.CreateDocument("")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Name != "Untitled" {
		t.Fatalf("default name = %q, want Untitled", created.Name)
	}

	second, err := store.CreateDocument("")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if second.Name != "Untitled 2" {
		t.Fatalf("second name = %q, want Untitled 2", second.Name)
	}

	scene := []byte(`{"type":"excalidraw","version":2,"elements":[],"files":{}}`)
	if _, err := store.SaveScene(created.ID, scene); err != nil {
		t.Fatalf("save: %v", err)
	}
	meta, raw, corrupt, err := store.GetDocument(created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if corrupt {
		t.Fatal("scene reported corrupt")
	}
	if !bytes.Equal(bytes.TrimSpace(raw), scene) {
		t.Fatalf("scene roundtrip mismatch: %s", raw)
	}
	if meta.UpdatedAt == "" || meta.LastOpenedAt == "" {
		t.Fatal("timestamps missing")
	}

	renamed, err := store.RenameDocument(created.ID, "Architecture")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "Architecture" {
		t.Fatalf("rename = %q", renamed.Name)
	}

	documents, err := store.ListDocuments()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("list count = %d, want 2", len(documents))
	}

	if err := store.DeleteDocument(created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, _, err := store.GetDocument(created.ID); err != errDocumentNotFound {
		t.Fatalf("get after delete = %v, want errDocumentNotFound", err)
	}
}

func TestSceneValidation(t *testing.T) {
	store := newTestStore(t)
	created, err := store.CreateDocument("Validation")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	tooLarge := append(json.RawMessage(`{"elements":[`), bytes.Repeat([]byte(`{},`), 1_000_000)...)
	if _, err := store.SaveScene(created.ID, tooLarge); err != errSceneTooLarge {
		t.Fatalf("oversized save err = %v, want errSceneTooLarge", err)
	}

	if _, err := store.SaveScene(created.ID, []byte(`{"elements":5}`)); err != errInvalidScene {
		t.Fatalf("non-array elements err = %v, want errInvalidScene", err)
	}

	if _, err := store.SaveScene(created.ID, []byte(`not json`)); err != errInvalidScene {
		t.Fatalf("invalid json err = %v, want errInvalidScene", err)
	}
}

func TestReconcileRecoversAndPrunes(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}

	created, err := store.CreateDocument("Keep")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Simulate a crash between scene write and metadata write.
	orphanID := newUUID()
	orphanScene := []byte(`{"type":"excalidraw","version":2,"elements":[{"id":"a"}],"files":{}}`)
	if err := os.WriteFile(filepath.Join(base, "documents", orphanID+".excalidraw"), orphanScene, 0o644); err != nil {
		t.Fatal(err)
	}
	// Simulate an orphan metadata sidecar whose scene disappeared.
	ghostID := newUUID()
	if err := os.WriteFile(filepath.Join(base, "documents", ghostID+".meta.json"), []byte(`{"id":"`+ghostID+`","name":"Ghost"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	reopened, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	documents, err := reopened.ListDocuments()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("list count = %d, want 2 (Keep + recovered)", len(documents))
	}
	foundRecovered := false
	for _, meta := range documents {
		if meta.ID == ghostID {
			t.Fatal("ghost metadata was not pruned")
		}
		if meta.ID == orphanID {
			foundRecovered = true
			if meta.Name != "Recovered "+orphanID[:8] {
				t.Fatalf("recovered name = %q", meta.Name)
			}
		}
	}
	if !foundRecovered {
		t.Fatal("orphan scene was not recovered")
	}
	if _, err := os.Stat(filepath.Join(base, "documents", ghostID+".meta.json")); !os.IsNotExist(err) {
		t.Fatal("ghost meta file still exists")
	}
	_ = created
}

func TestCorruptSceneIsReportedNotClobbered(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}
	created, err := store.CreateDocument("Broken")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	corrupt := []byte("{ this is not json")
	if err := os.WriteFile(filepath.Join(base, "documents", created.ID+".excalidraw"), corrupt, 0o644); err != nil {
		t.Fatal(err)
	}
	_, raw, corruptFlag, err := store.GetDocument(created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !corruptFlag {
		t.Fatal("corrupt flag missing")
	}
	if !bytes.Equal(raw, corrupt) {
		t.Fatal("corrupt scene must be returned untouched")
	}
}

func TestInvalidIDsAndNamesRejected(t *testing.T) {
	store := newTestStore(t)
	if _, _, _, err := store.GetDocument("../../etc/passwd"); err != errInvalidID {
		t.Fatalf("path traversal err = %v, want errInvalidID", err)
	}
	if err := store.DeleteDocument("not-a-uuid"); err != errInvalidID {
		t.Fatalf("bad uuid err = %v, want errInvalidID", err)
	}
	if _, err := store.RenameDocument(newUUID(), "   "); err != errInvalidName {
		t.Fatalf("blank name err = %v, want errInvalidName", err)
	}
}
