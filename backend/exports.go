package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	errInvalidJob   = errors.New("invalid export job id")
	errExportName   = errors.New("invalid export file name")
	errExportTooBig = errors.New("export exceeds maximum size")
	errExportChunk  = errors.New("export chunk rejected")
)

const (
	maxExportBytes     = int64(64 * 1024 * 1024)
	maxExportNameRunes = 160
)

// Exports are written by the sidecar because the sandboxed workbench iframe
// cannot deliver <a download> clicks (no allow-downloads) and Host API 1.x
// has no save dialog (PRD R3); the UI surfaces the returned path instead.
//
//	<base>/exports/<name>             finished export files
//	<base>/exports/.partial/<jobId>   in-flight chunked writes
//
// WriteExportChunk appends one sequentially-addressed chunk of an export job
// and promotes the file once the declared size is reached. Re-exporting an
// existing name is an intentional overwrite.
func (s *Store) WriteExportChunk(jobID, name string, size, offset int64, data []byte) (received int64, complete bool, path string, err error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if !uuidPattern.MatchString(jobID) {
		return 0, false, "", errInvalidJob
	}
	if err := validateExportName(name); err != nil {
		return 0, false, "", err
	}
	if size <= 0 || size > maxExportBytes {
		return 0, false, "", fmt.Errorf("%w: bad size", errExportTooBig)
	}
	if offset < 0 || int64(len(data)) > maxChunkBytes || offset+int64(len(data)) > size {
		return 0, false, "", fmt.Errorf("%w: bad offset or length", errExportChunk)
	}

	partial, err := os.OpenFile(s.exportPartialPath(jobID), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return 0, false, "", err
	}
	defer partial.Close()
	info, err := partial.Stat()
	if err != nil {
		return 0, false, "", err
	}
	current := info.Size()
	switch {
	case offset == current:
		if _, err := partial.WriteAt(data, offset); err != nil {
			return 0, false, "", err
		}
		current += int64(len(data))
	case offset == 0 && int64(len(data)) >= current:
		// Restarting over a stale partial from an interrupted attempt.
		if err := partial.Truncate(0); err != nil {
			return 0, false, "", err
		}
		if _, err := partial.WriteAt(data, 0); err != nil {
			return 0, false, "", err
		}
		current = int64(len(data))
	case offset+int64(len(data)) <= current:
		// Idempotent replay of an already-received chunk.
	default:
		return 0, false, "", fmt.Errorf("%w: expected offset %d", errExportChunk, current)
	}
	if err := partial.Sync(); err != nil {
		return 0, false, "", err
	}
	if current < size {
		return current, false, "", nil
	}
	if err := partial.Close(); err != nil {
		return 0, false, "", err
	}
	if err := os.Rename(s.exportPartialPath(jobID), s.exportPath(name)); err != nil {
		return 0, false, "", err
	}
	return size, true, s.exportPath(name), nil
}

// validateExportName accepts any printable single-path filename (CJK
// included) but rejects separators, Windows-reserved characters, control
// characters, dotfiles, and Windows device names so a crafted name cannot
// escape the exports directory, silently address a device, or become an
// unreferenceable file on Windows.
func validateExportName(name string) error {
	if name == "" || utf8.RuneCountInString(name) > maxExportNameRunes {
		return errExportName
	}
	if strings.ContainsAny(name, "/\\:*?\"<>|") || strings.ContainsRune(name, 0) {
		return errExportName
	}
	if strings.HasPrefix(name, ".") || strings.HasPrefix(name, " ") ||
		strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") {
		return errExportName
	}
	if isWindowsDeviceName(name) {
		return errExportName
	}
	for _, r := range name {
		if r < 0x20 {
			return errExportName
		}
	}
	return nil
}

// sweepStaleExportPartials removes export scratch files abandoned by
// interrupted sessions; the frontend mints a fresh jobId per attempt, so
// nothing ever resumes an old partial.
func (s *Store) sweepStaleExportPartials() {
	entries, err := os.ReadDir(s.exportPartial)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil || time.Since(info.ModTime()) < 24*time.Hour {
			continue
		}
		if err := os.Remove(filepath.Join(s.exportPartial, entry.Name())); err == nil {
			fmt.Fprintf(os.Stderr, "[excalidraw-studio] removed stale export partial %q\n", entry.Name())
		}
	}
}
