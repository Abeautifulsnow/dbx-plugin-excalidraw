package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

var (
	errSceneTooLarge = errors.New("scene exceeds maximum size")
	errInvalidScene  = errors.New("scene is not a valid Excalidraw document")
	errAssetNotFound = errors.New("asset not found")
	errAssetChunk    = errors.New("asset chunk rejected")
)

const (
	maxAssetBytes  = int64(64 * 1024 * 1024)
	maxChunkBytes  = int64(1024 * 1024)
	defaultMaxRead = int64(512 * 1024)
)

type AssetMeta struct {
	Hash     string `json:"hash"`
	MimeType string `json:"mimeType"`
	Size     int64  `json:"size"`
}

func validateHash(hash string) error {
	if !hashPattern.MatchString(hash) {
		return errInvalidHash
	}
	return nil
}

// PutAssetChunk appends one sequentially-addressed chunk of an asset upload.
// Chunks are written to a .partial file and atomically promoted once the
// declared size is reached. Re-uploading an existing hash is a dedup no-op.
func (s *Store) PutAssetChunk(hash, mimeType string, size, offset int64, data []byte) (received int64, complete bool, err error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateHash(hash); err != nil {
		return 0, false, err
	}
	if size <= 0 || size > maxAssetBytes {
		return 0, false, fmt.Errorf("%w: bad size", errAssetChunk)
	}
	if offset < 0 || int64(len(data)) > maxChunkBytes || offset+int64(len(data)) > size {
		return 0, false, fmt.Errorf("%w: bad offset or length", errAssetChunk)
	}
	if err := validateMimeType(mimeType); err != nil {
		return 0, false, err
	}

	// Dedup fast path: the identical binary already exists. Patch missing
	// asset metadata so a crash between promote and meta-write self-heals.
	if _, statErr := os.Stat(s.assetPath(hash)); statErr == nil {
		s.ensureAssetMeta(hash, mimeType, size)
		return size, true, nil
	}

	partial, err := os.OpenFile(s.partialPath(hash), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return 0, false, err
	}
	defer partial.Close()
	info, err := partial.Stat()
	if err != nil {
		return 0, false, err
	}
	current := info.Size()
	switch {
	case offset == current:
		if _, err := partial.WriteAt(data, offset); err != nil {
			return 0, false, err
		}
		current += int64(len(data))
	case offset == 0 && int64(len(data)) >= current:
		// Fresh upload restarting over a stale partial: the first chunk alone
		// covers at least what was already received, so redo from scratch.
		if err := partial.Truncate(0); err != nil {
			return 0, false, err
		}
		if _, err := partial.WriteAt(data, 0); err != nil {
			return 0, false, err
		}
		current = int64(len(data))
	case offset+int64(len(data)) <= current:
		// Idempotent replay of an already-received chunk.
	default:
		return 0, false, fmt.Errorf("%w: expected offset %d", errAssetChunk, current)
	}
	if err := partial.Sync(); err != nil {
		return 0, false, err
	}
	if current < size {
		return current, false, nil
	}
	if err := partial.Close(); err != nil {
		return 0, false, err
	}
	if err := os.Rename(s.partialPath(hash), s.assetPath(hash)); err != nil {
		return 0, false, err
	}
	s.ensureAssetMeta(hash, mimeType, size)
	return size, true, nil
}

func (s *Store) ensureAssetMeta(hash, mimeType string, size int64) {
	path := s.assetMetaPath(hash)
	if _, err := os.Stat(path); err == nil {
		return
	}
	encoded, err := json.Marshal(AssetMeta{Hash: hash, MimeType: mimeType, Size: size})
	if err != nil {
		return
	}
	_ = writeFileAtomic(path, encoded, 0o644)
}

func validateMimeType(mimeType string) error {
	if len(mimeType) == 0 || len(mimeType) > 255 {
		return fmt.Errorf("%w: bad mime type", errAssetChunk)
	}
	return nil
}

// GetAssetChunk reads up to length bytes at offset from a committed asset.
func (s *Store) GetAssetChunk(hash string, offset, length int64) (data []byte, total int64, mimeType string, err error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateHash(hash); err != nil {
		return nil, 0, "", err
	}
	file, err := os.Open(s.assetPath(hash))
	if errors.Is(err, os.ErrNotExist) {
		return nil, 0, "", errAssetNotFound
	}
	if err != nil {
		return nil, 0, "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, 0, "", err
	}
	if offset < 0 || offset >= info.Size() {
		return nil, 0, "", fmt.Errorf("%w: bad offset", errAssetChunk)
	}
	if length <= 0 {
		length = defaultMaxRead
	}
	if length > maxChunkBytes {
		length = maxChunkBytes
	}
	if remaining := info.Size() - offset; length > remaining {
		length = remaining
	}
	buffer := make([]byte, length)
	if _, err := file.ReadAt(buffer, offset); err != nil {
		return nil, 0, "", err
	}
	if raw, err := os.ReadFile(s.assetMetaPath(hash)); err == nil {
		var meta AssetMeta
		if json.Unmarshal(raw, &meta) == nil {
			mimeType = meta.MimeType
		}
	}
	return buffer, info.Size(), mimeType, nil
}

// StatAsset reports whether a committed asset exists.
func (s *Store) StatAsset(hash string) (AssetMeta, bool) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if err := validateHash(hash); err != nil {
		return AssetMeta{}, false
	}
	info, err := os.Stat(s.assetPath(hash))
	if err != nil {
		return AssetMeta{}, false
	}
	meta := AssetMeta{Hash: hash, Size: info.Size()}
	if raw, err := os.ReadFile(s.assetMetaPath(hash)); err == nil {
		var parsed AssetMeta
		if json.Unmarshal(raw, &parsed) == nil {
			meta.MimeType = parsed.MimeType
		}
	}
	return meta, true
}
