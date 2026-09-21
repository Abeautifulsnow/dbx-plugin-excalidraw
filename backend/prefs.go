package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// Preferences are a small, fixed set of UI choices the frontend keeps across
// sessions. They are stored in the sidecar's own data directory rather than in
// `host.storage`: that directory is already the plugin's (`DBX_PLUGIN_DATA_DIR`
// resolves to the same `plugin-data/<id>` the host KV would use), so this costs
// no extra manifest permission and no first-mover risk on an unproven API.
//
// Keys are an allowlist. The value arrives as JSON from the plugin UI, so an
// open key space would let a bug or a stray call grow the file without bound —
// and every key here has to have a real consumer in the UI, or it is just
// speculative state that has to be migrated later.
const (
	prefsFileName = "prefs.json"
	// Well above the largest row count the result view offers, and low enough
	// that a corrupt value cannot turn into an absurd canvas layout.
	maxPrefRows = 100000
	// A search box is the only free-text preference; nothing longer than this is
	// a real query, and the bound keeps the file from growing with a paste.
	maxPrefText = 200
)

var (
	errPrefKey   = errors.New("unknown preference key")
	errPrefValue = errors.New("invalid preference value")
)

func prefsPath(baseDir string) string { return filepath.Join(baseDir, prefsFileName) }

// normalizePref enforces the allowlist and each value's shape, converting JSON's
// float64 numbers to the integer the caller meant. A value that fails is
// refused rather than stored, so nothing can persist that a later read would
// silently discard.
//
// This switch and `PREF_KEYS` in `frontend/src/prefs.ts` are two halves of one
// list and must be edited together. The frontend cannot be trusted to validate
// on its own, so the duplication is deliberate; a key present on only one side
// is dropped or refused silently, which is why each side points at the other.
func normalizePref(key string, value any) (any, error) {
	switch key {
	case "resultRows":
		rows, ok := value.(float64)
		if !ok || rows != math.Trunc(rows) || rows < 1 || rows > maxPrefRows {
			return nil, errPrefValue
		}
		return int(rows), nil
	case "homeSearch":
		text, ok := value.(string)
		// Control characters never belong in what the home screen filters by, so
		// they are refused rather than stored and rendered back into an input.
		if !ok || utf8.RuneCountInString(text) > maxPrefText || strings.ContainsFunc(text, isControlRune) {
			return nil, errPrefValue
		}
		return text, nil
	default:
		return nil, errPrefKey
	}
}

func isControlRune(char rune) bool {
	return char < 0x20 || char == 0x7f
}

// readPrefs loads the stored values. Callers must hold the store mutex.
//
// Anything unreadable or malformed is dropped rather than surfaced: preferences
// are a convenience, so a damaged file degrades to defaults instead of keeping
// the plugin from starting. Unknown or invalid entries are filtered out here as
// well, so a file written by a newer build cannot smuggle values past the
// allowlist.
func (s *Store) readPrefs() map[string]any {
	values := map[string]any{}
	raw, err := os.ReadFile(prefsPath(s.baseDir))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(os.Stderr, "[excalidraw-studio] ignoring unreadable preferences: %v\n", err)
		}
		return values
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		fmt.Fprintf(os.Stderr, "[excalidraw-studio] ignoring malformed preferences: %v\n", err)
		return values
	}
	for key, value := range stored {
		if normalized, err := normalizePref(key, value); err == nil {
			values[key] = normalized
		}
	}
	return values
}

func (s *Store) getPrefs() map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.readPrefs()
}

// setPref merges one value into the stored set and rewrites the whole file
// atomically, so a crash mid-write cannot leave a torn preference behind. It
// returns the full set so the caller can answer with what is now stored rather
// than what it hoped to store.
func (s *Store) setPref(key string, value any) (map[string]any, error) {
	normalized, err := normalizePref(key, value)
	if err != nil {
		return nil, err
	}
	s.mutex.Lock()
	defer s.mutex.Unlock()
	values := s.readPrefs()
	values[key] = normalized
	encoded, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(prefsPath(s.baseDir), append(encoded, '\n'), 0o644); err != nil {
		return nil, err
	}
	return values, nil
}
