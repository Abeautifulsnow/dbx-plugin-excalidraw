package main

import (
	"crypto/rand"
	"encoding/hex"
	"io"
)

// newUUID returns a random RFC 4122 version 4 UUID string.
func newUUID() string {
	var bytes [16]byte
	if _, err := io.ReadFull(rand.Reader, bytes[:]); err != nil {
		panic(err) // crypto/rand failure is unrecoverable for this process
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
