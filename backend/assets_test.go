package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestAssetChunkRoundtrip(t *testing.T) {
	store := newTestStore(t)
	document, err := store.CreateDocument("Assets")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	payload := make([]byte, 3*512*1024+123) // three full chunks plus a tail
	if _, err := rand.Read(payload); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	const chunk = 512 * 1024

	var complete bool
	for offset := 0; offset < len(payload); offset += chunk {
		end := offset + chunk
		if end > len(payload) {
			end = len(payload)
		}
		_, complete, err = store.PutAssetChunk(hash, "image/png", int64(len(payload)), int64(offset), payload[offset:end])
		if err != nil {
			t.Fatalf("putChunk at %d: %v", offset, err)
		}
	}
	if !complete {
		t.Fatal("upload never completed")
	}

	meta, exists := store.StatAsset(hash)
	if !exists {
		t.Fatal("committed asset missing")
	}
	if meta.Size != int64(len(payload)) || meta.MimeType != "image/png" {
		t.Fatalf("asset meta = %+v", meta)
	}

	var rebuilt []byte
	for offset := int64(0); offset < int64(len(payload)); {
		data, total, mimeType, err := store.GetAssetChunk(hash, offset, chunk)
		if err != nil {
			t.Fatalf("getChunk at %d: %v", offset, err)
		}
		if total != int64(len(payload)) || mimeType != "image/png" {
			t.Fatalf("chunk meta total=%d mime=%q", total, mimeType)
		}
		rebuilt = append(rebuilt, data...)
		offset += int64(len(data))
	}
	if !bytes.Equal(rebuilt, payload) {
		t.Fatal("downloaded asset differs from upload")
	}
	_ = document
}

func TestAssetDedupAndReplay(t *testing.T) {
	store := newTestStore(t)
	_ = store
	document, err := store.CreateDocument("Dedup")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	data := []byte("duplicate-me")
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	_, complete, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data)
	if err != nil || !complete {
		t.Fatalf("first upload: complete=%v err=%v", complete, err)
	}

	// Re-uploading the same hash is a dedup no-op that reports completion.
	received, complete, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data)
	if err != nil || !complete || received != int64(len(data)) {
		t.Fatalf("dedup upload: received=%d complete=%v err=%v", received, complete, err)
	}
	_ = document
}

func TestAssetChunkOrdering(t *testing.T) {
	store := newTestStore(t)
	data := []byte("0123456789abcdef")
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	if _, _, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 4, data[4:8]); err == nil {
		t.Fatal("out-of-order first chunk must fail")
	}
	if _, _, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data[0:8]); err != nil {
		t.Fatalf("first chunk: %v", err)
	}
	if _, _, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data[0:4]); err != nil {
		t.Fatalf("idempotent replay must be accepted: %v", err)
	}
	if _, _, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 8, data[8:]); err != nil {
		t.Fatalf("final chunk: %v", err)
	}
	if _, exists := store.StatAsset(hash); !exists {
		t.Fatal("asset not committed")
	}

	if _, _, _, err := store.GetAssetChunk(hash, 99, 0); err == nil {
		t.Fatal("offset beyond size must fail")
	}
	if _, _, _, err := store.GetAssetChunk("deadbeef", 0, 0); err != errInvalidHash {
		t.Fatalf("bad hash err = %v", err)
	}
}

func TestPartialRestart(t *testing.T) {
	store := newTestStore(t)
	data := []byte("abcdefgh")
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	if _, _, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data[0:3]); err != nil {
		t.Fatalf("partial: %v", err)
	}
	// A fresh upload restart must truncate the stale partial.
	_, complete, err := store.PutAssetChunk(hash, "image/png", int64(len(data)), 0, data)
	if err != nil || !complete {
		t.Fatalf("restart upload: complete=%v err=%v", complete, err)
	}
	chunk, _, _, err := store.GetAssetChunk(hash, 0, int64(len(data)))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !bytes.Equal(chunk, data) {
		t.Fatalf("restarted asset = %q, want %q", chunk, data)
	}
}
