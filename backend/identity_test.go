package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The identity returned during plugin/initialize must match manifest.json
// exactly, or the DBX host terminates the sidecar with
// "Sidecar identity or protocol does not match manifest". The values live in
// two files, so this test pins them together.
func TestIdentityMatchesManifest(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "manifest.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest struct {
		ID        string `json:"id"`
		Version   string `json:"version"`
		Publisher string `json:"publisher"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	if pluginID != manifest.ID {
		t.Errorf("pluginID %q != manifest id %q", pluginID, manifest.ID)
	}
	if pluginVersion != manifest.Version {
		t.Errorf("pluginVersion %q != manifest version %q", pluginVersion, manifest.Version)
	}
}
