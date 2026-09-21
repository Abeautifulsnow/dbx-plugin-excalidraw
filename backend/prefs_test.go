package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrefsRoundTrip(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}

	values, err := store.setPref("resultRows", float64(500))
	if err != nil {
		t.Fatalf("setPref: %v", err)
	}
	// JSON numbers arrive as float64; what is stored must be the integer the
	// caller meant, not 500.0.
	if rows, ok := values["resultRows"].(int); !ok || rows != 500 {
		t.Fatalf("resultRows = %#v, want int 500", values["resultRows"])
	}

	if _, err := store.setPref("homeSearch", "invoice"); err != nil {
		t.Fatalf("setPref: %v", err)
	}

	// Both values survive a restart, and the second write did not drop the first.
	reopened, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got := reopened.getPrefs()
	if got["resultRows"] != 500 || got["homeSearch"] != "invoice" {
		t.Fatalf("getPrefs = %#v, want both values restored", got)
	}
}

func TestPrefsRejectsUnknownKeysAndBadValues(t *testing.T) {
	store := newTestStore(t)

	if _, err := store.setPref("somethingElse", true); !errors.Is(err, errPrefKey) {
		t.Fatalf("unknown key error = %v, want errPrefKey", err)
	}

	badValues := []struct {
		key   string
		value any
	}{
		{"resultRows", float64(-1)},
		{"resultRows", float64(0)},
		{"resultRows", float64(1.5)},
		{"resultRows", float64(maxPrefRows + 1)},
		{"resultRows", "500"},
		{"resultRows", true},
		{"homeSearch", float64(1)},
		{"homeSearch", true},
		{"homeSearch", nil},
		{"homeSearch", strings.Repeat("x", maxPrefText+1)},
		{"homeSearch", "line\nbreak"},
		{"homeSearch", "tab\there"},
		{"homeSearch", "bell\a"},
	}
	for _, bad := range badValues {
		if _, err := store.setPref(bad.key, bad.value); !errors.Is(err, errPrefValue) {
			t.Fatalf("setPref(%s, %#v) error = %v, want errPrefValue", bad.key, bad.value, err)
		}
	}

	// A refused write must not leave anything behind.
	if got := store.getPrefs(); len(got) != 0 {
		t.Fatalf("getPrefs = %#v, want empty after refused writes", got)
	}

	if _, err := store.setPref("resultRows", float64(maxPrefRows)); err != nil {
		t.Fatalf("the documented maximum must be accepted: %v", err)
	}
	if _, err := store.setPref("homeSearch", strings.Repeat("x", maxPrefText)); err != nil {
		t.Fatalf("a search term at the documented maximum must be accepted: %v", err)
	}
	// Clearing the search box is a real state, not an absent value.
	if _, err := store.setPref("homeSearch", ""); err != nil {
		t.Fatalf("an empty search term must be storable: %v", err)
	}
}

func TestPrefsSurviveADamagedFile(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}

	// Preferences are a convenience: a torn or hand-edited file degrades to
	// defaults rather than keeping the plugin from working.
	if err := os.WriteFile(prefsPath(base), []byte("{not json"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if got := store.getPrefs(); len(got) != 0 {
		t.Fatalf("getPrefs on a damaged file = %#v, want empty", got)
	}

	// And the next write repairs it rather than stacking another failure.
	if _, err := store.setPref("homeSearch", "invoice"); err != nil {
		t.Fatalf("setPref after damage: %v", err)
	}
	if got := store.getPrefs(); got["homeSearch"] != "invoice" {
		t.Fatalf("getPrefs = %#v, want the repaired value", got)
	}
}

func TestPrefsFilterEntriesWrittenByANewerBuild(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}

	// A downgrade must not smuggle unknown keys or wrong-typed values back into
	// the UI, and rewriting the file must not carry them forward either.
	// `exportViaDialog` is a key an earlier build wrote and this one dropped, so
	// it has to be discarded exactly like a key from a future build.
	seeded := `{"resultRows": 25, "homeSearch": "invoice", "futureKey": 1, "exportViaDialog": true}`
	if err := os.WriteFile(prefsPath(base), []byte(seeded), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got := store.getPrefs()
	if len(got) != 2 || got["resultRows"] != 25 || got["homeSearch"] != "invoice" {
		t.Fatalf("getPrefs = %#v, want only the two known keys", got)
	}

	written, err := store.setPref("resultRows", float64(30))
	if err != nil {
		t.Fatalf("setPref: %v", err)
	}
	if _, present := written["futureKey"]; present {
		t.Fatalf("setPref returned an unknown key: %#v", written)
	}

	raw, err := os.ReadFile(prefsPath(base))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var onDisk map[string]any
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("stored file is not valid JSON: %v", err)
	}
	if len(onDisk) != 2 {
		t.Fatalf("stored keys = %#v, want the unknown key dropped", onDisk)
	}
}

func TestPrefsWriteIsAtomicAndLeavesNoScratchFiles(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := store.setPref("resultRows", float64(10+i)); err != nil {
			t.Fatalf("setPref: %v", err)
		}
	}

	entries, err := os.ReadDir(base)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".tmp-") {
			t.Fatalf("scratch file %q was left behind", entry.Name())
		}
	}

	raw, err := os.ReadFile(filepath.Join(base, prefsFileName))
	if err != nil {
		t.Fatalf("read prefs: %v", err)
	}
	if !strings.HasSuffix(string(raw), "\n") {
		t.Fatalf("stored file should end with a newline, got %q", string(raw))
	}
}

func TestPrefsAreAbsentUntilSomethingIsStored(t *testing.T) {
	base := t.TempDir()
	store, err := newStoreAt(base)
	if err != nil {
		t.Fatalf("newStoreAt: %v", err)
	}
	if got := store.getPrefs(); len(got) != 0 {
		t.Fatalf("getPrefs = %#v, want empty", got)
	}
	// Reading must not create the file — a plugin that never stores a
	// preference should not leave one behind.
	if _, err := os.Stat(prefsPath(base)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat prefs = %v, want ErrNotExist", err)
	}
}
