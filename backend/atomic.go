package main

import (
	"os"
	"path/filepath"
)

// writeFileAtomic durably replaces path with data: write to a temp file in the
// same directory, fsync, then rename over the target. A crash mid-write can
// never leave a torn document behind.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() {
		temporary.Close()
		os.Remove(temporaryName)
	}()
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Chmod(temporaryName, perm); err != nil {
		return err
	}
	// os.Rename replaces existing targets on all supported platforms.
	return os.Rename(temporaryName, path)
}
