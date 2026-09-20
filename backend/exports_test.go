package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExportChunkedWrite(t *testing.T) {
	store := newTestStore(t)
	jobID := newUUID()

	first := []byte(strings.Repeat("A", 700_000))
	second := []byte("tail")

	received, complete, path, err := store.WriteExportChunk(jobID, "架构图.png", int64(len(first)+len(second)), 0, first)
	if err != nil {
		t.Fatalf("first chunk: %v", err)
	}
	if complete || received != int64(len(first)) {
		t.Fatalf("after first chunk: complete=%v received=%d", complete, received)
	}

	received, complete, path, err = store.WriteExportChunk(jobID, "架构图.png", int64(len(first)+len(second)), int64(len(first)), second)
	if err != nil {
		t.Fatalf("final chunk: %v", err)
	}
	if !complete || received != int64(len(first)+len(second)) {
		t.Fatalf("after final chunk: complete=%v received=%d", complete, received)
	}
	if want := filepath.Join(store.exportsDir, "架构图.png"); path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("exported file missing: %v", err)
	}
	if _, err := os.Stat(store.exportPartialPath(jobID)); !os.IsNotExist(err) {
		t.Fatalf("partial file not promoted: %v", err)
	}
}

func TestExportChunkReplayAndRestart(t *testing.T) {
	store := newTestStore(t)
	jobID := newUUID()
	size := int64(10)

	if _, _, _, err := store.WriteExportChunk(jobID, "a.png", size, 0, []byte("01234")); err != nil {
		t.Fatalf("first chunk: %v", err)
	}
	// Idempotent replay of the already-received prefix is a no-op.
	if _, _, _, err := store.WriteExportChunk(jobID, "a.png", size, 1, []byte("1234")); err != nil {
		t.Fatalf("replay: %v", err)
	}
	// A gap is rejected with the expected offset reported.
	_, _, _, err := store.WriteExportChunk(jobID, "a.png", size, 7, []byte("789"))
	if err == nil || !strings.Contains(err.Error(), "expected offset 5") {
		t.Fatalf("gap error = %v, want expected offset 5", err)
	}
	// Restarting from zero over the stale partial succeeds.
	if _, complete, _, err := store.WriteExportChunk(jobID, "a.png", size, 0, []byte("0123456789")); err != nil || !complete {
		t.Fatalf("restart: complete=%v err=%v", complete, err)
	}
}

func TestExportOverwrite(t *testing.T) {
	store := newTestStore(t)
	if _, _, _, err := store.WriteExportChunk(newUUID(), "d.svg", 2, 0, []byte("v1")); err != nil {
		t.Fatalf("first export: %v", err)
	}
	path, err := writeWholeExport(store, "d.svg", "v2-longer")
	if err != nil {
		t.Fatalf("second export: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(raw) != "v2-longer" {
		t.Fatalf("content = %q, want overwritten v2-longer", raw)
	}
}

func TestExportValidation(t *testing.T) {
	store := newTestStore(t)
	cases := []struct {
		name   string
		jobID  string
		file   string
		size   int64
		offset int64
		data   string
	}{
		{"bad job id", "not-a-uuid", "a.png", 1, 0, "x"},
		{"empty name", newUUID(), "", 1, 0, "x"},
		{"path separator", newUUID(), "a/b.png", 1, 0, "x"},
		{"backslash", newUUID(), `a\b.png`, 1, 0, "x"},
		{"windows colon", newUUID(), "a:b.png", 1, 0, "x"},
		{"windows reserved", newUUID(), "a*b.png", 1, 0, "x"},
		{"trailing space", newUUID(), "a.png ", 1, 0, "x"},
		{"dotfile", newUUID(), ".hidden", 1, 0, "x"},
		{"trailing dot", newUUID(), "a.png.", 1, 0, "x"},
		{"control char", newUUID(), "a\x01.png", 1, 0, "x"},
		{"zero size", newUUID(), "a.png", 0, 0, ""},
		{"size beyond cap", newUUID(), "a.png", maxExportBytes + 1, 0, "x"},
		{"offset beyond size", newUUID(), "a.png", 2, 1, "xx"},
		{"chunk beyond cap", newUUID(), "a.png", maxChunkBytes * 2, 0, strings.Repeat("x", int(maxChunkBytes)+1)},
	}
	for _, tc := range cases {
		_, _, _, err := store.WriteExportChunk(tc.jobID, tc.file, tc.size, tc.offset, []byte(tc.data))
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
	}
}

func TestSweepStaleExportPartials(t *testing.T) {
	store := newTestStore(t)

	staleID, freshID := newUUID(), newUUID()
	for _, jobID := range []string{staleID, freshID} {
		// Declared size exceeds the seed data so the partial stays in-flight
		// instead of being promoted on this very chunk.
		if _, _, _, err := store.WriteExportChunk(jobID, "sweep.png", 100, 0, []byte("partial!")); err != nil {
			t.Fatalf("seed partial %s: %v", jobID, err)
		}
	}
	staleTime := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(store.exportPartialPath(staleID), staleTime, staleTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	store.sweepStaleExportPartials()

	if _, err := os.Stat(store.exportPartialPath(staleID)); !os.IsNotExist(err) {
		t.Fatalf("stale partial survived sweep: %v", err)
	}
	if _, err := os.Stat(store.exportPartialPath(freshID)); err != nil {
		t.Fatalf("fresh partial wrongly removed: %v", err)
	}
}

func writeWholeExport(store *Store, name, content string) (string, error) {
	_, complete, path, err := store.WriteExportChunk(newUUID(), name, int64(len(content)), 0, []byte(content))
	if err != nil {
		return "", err
	}
	if !complete {
		return "", errExportChunk
	}
	return path, nil
}
