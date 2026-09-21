package main

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

// The RPC dispatch layer is what the host actually talks to, and the Go
// coverage report cannot see it exercised by scripts/sidecar-smoke.mjs (that
// drives a separately built binary). These tests call Handle directly so the
// routing, the provider check and — most importantly — the error categories the
// UI reacts to are covered.
func call(t *testing.T, store *Store, method string, params any) (any, *dbxpluginsdk.PluginError) {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal params for %s: %v", method, err)
	}
	return (&plugin{store: store}).Handle(dbxpluginsdk.RequestContext{}, method, raw, nil)
}

func mustCall(t *testing.T, store *Store, method string, params any) any {
	t.Helper()
	result, pluginError := call(t, store, method, params)
	if pluginError != nil {
		t.Fatalf("%s: unexpected error %s", method, pluginError.Message)
	}
	return result
}

func errorCode(t *testing.T, store *Store, method string, params any) string {
	t.Helper()
	result, pluginError := call(t, store, method, params)
	if pluginError == nil {
		t.Fatalf("%s: expected an error, got %#v", method, result)
	}
	category, _, found := strings.Cut(pluginError.Message, ":")
	if !found {
		t.Fatalf("%s: error message %q has no CATEGORY: prefix", method, pluginError.Message)
	}
	return category
}

func TestDispatchRejectsUnknownMethods(t *testing.T) {
	store := newTestStore(t)
	for _, method := range []string{"", "nope", "documents/list", "filesystem/unknown", "document/"} {
		if code := errorCode(t, store, method, map[string]any{}); code != "Method not found" && !strings.HasPrefix(code, "Method") {
			t.Fatalf("%s: category = %q, want a method-not-found error", method, code)
		}
	}
}

func TestDispatchDocumentFamily(t *testing.T) {
	store := newTestStore(t)

	created := mustCall(t, store, "document/create", map[string]any{"name": "Dispatch"}).(DocumentMeta)
	if created.Name != "Dispatch" {
		t.Fatalf("created name = %q", created.Name)
	}

	scene := map[string]any{"type": "excalidraw", "version": 2, "elements": []any{}, "files": map[string]any{}}
	if _, pluginError := call(t, store, "document/saveScene", map[string]any{"id": created.ID, "scene": scene}); pluginError != nil {
		t.Fatalf("saveScene: %s", pluginError.Message)
	}

	got := mustCall(t, store, "document/get", map[string]any{"id": created.ID}).(map[string]any)
	if got["corrupt"] != false || got["scene"] == nil {
		t.Fatalf("document/get returned %+v", got)
	}

	renamed := mustCall(t, store, "document/rename", map[string]any{"id": created.ID, "name": "Renamed"}).(DocumentMeta)
	if renamed.Name != "Renamed" {
		t.Fatalf("renamed name = %q", renamed.Name)
	}

	listed := mustCall(t, store, "document/list", map[string]any{}).(map[string]any)
	if items := listed["items"].([]DocumentMeta); len(items) != 1 {
		t.Fatalf("document/list returned %d items", len(items))
	}

	if _, pluginError := call(t, store, "document/delete", map[string]any{"id": created.ID}); pluginError != nil {
		t.Fatalf("delete: %s", pluginError.Message)
	}
	if code := errorCode(t, store, "document/get", map[string]any{"id": created.ID}); code != "DOCUMENT_NOT_FOUND" {
		t.Fatalf("get after delete: category = %q", code)
	}
}

// Every category below is one the frontend branches on, so a routing change
// that collapses them into the generic storage error has to fail here.
func TestDispatchErrorCategories(t *testing.T) {
	store := newTestStore(t)
	doc := mustCall(t, store, "document/create", map[string]any{"name": "Errors"}).(DocumentMeta)
	docURI := "excalidraw:/documents/" + doc.ID + ".excalidraw"

	cases := []struct {
		name   string
		method string
		params any
		want   string
	}{
		{"malformed params", "document/create", "not an object", "INVALID_REQUEST"},
		{"invalid document id", "document/get", map[string]any{"id": "nope"}, "INVALID_REQUEST"},
		{"missing document", "document/get", map[string]any{"id": "11111111-1111-1111-1111-111111111111"}, "DOCUMENT_NOT_FOUND"},
		{"null scene", "document/saveScene", map[string]any{"id": doc.ID, "scene": []any{}}, "INVALID_SCENE"},
		{"invalid export job", "export/write", map[string]any{"jobId": "x", "name": "a.png", "size": 1, "offset": 0, "dataBase64": ""}, "INVALID_REQUEST"},
		{"traversing path", "filesystem/list", map[string]any{"providerId": filesystemProviderID, "uri": "excalidraw:/../etc"}, "INVALID_PATH"},
		{"unknown provider", "filesystem/list", map[string]any{"providerId": "io.dbx.other", "uri": fsRoot}, "INVALID_REQUEST"},
		{"missing entry", "filesystem/read", map[string]any{"providerId": filesystemProviderID, "uri": "excalidraw:/documents/" + "11111111-1111-1111-1111-111111111111" + ".excalidraw"}, "NOT_FOUND"},
		{"write to exports", "filesystem/write", map[string]any{"providerId": filesystemProviderID, "uri": "excalidraw:/exports/a.png", "dataBase64": ""}, "READ_ONLY"},
		{"bad base64 write", "filesystem/write", map[string]any{"providerId": filesystemProviderID, "uri": docURI, "dataBase64": "!!!not base64!!!"}, "INVALID_REQUEST"},
		{"delete a directory", "filesystem/delete", map[string]any{"providerId": filesystemProviderID, "uri": fsRoot}, "NOT_SUPPORTED"},
		{"folder creation", "filesystem/createDirectory", map[string]any{"providerId": filesystemProviderID, "uri": fsRoot}, "NOT_SUPPORTED"},
		{"stale etag", "filesystem/write", map[string]any{
			"providerId": filesystemProviderID, "uri": docURI, "overwrite": true, "etag": strings.Repeat("0", 64),
			"dataBase64": base64.StdEncoding.EncodeToString([]byte(`{"type":"excalidraw","version":2,"elements":[]}`)),
		}, "CONFLICT"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if code := errorCode(t, store, testCase.method, testCase.params); code != testCase.want {
				t.Fatalf("category = %q, want %q", code, testCase.want)
			}
		})
	}

	// An unusable hash reports "absent" rather than an error: the editor then
	// attempts the upload, which is where the hash is actually validated. The
	// important part is that it does not claim the asset exists.
	for _, hash := range []string{"short", "", strings.Repeat("Z", 64)} {
		result := mustCall(t, store, "asset/stat", map[string]any{"hash": hash}).(map[string]any)
		if result["exists"] != false {
			t.Fatalf("asset/stat(%q) claimed the asset exists: %+v", hash, result)
		}
	}

	// The successful path through the same method must still work afterwards.
	if _, pluginError := call(t, store, "filesystem/write", map[string]any{
		"providerId": filesystemProviderID, "uri": docURI, "overwrite": true,
		"dataBase64": base64.StdEncoding.EncodeToString([]byte(`{"type":"excalidraw","version":2,"elements":[],"files":{}}`)),
	}); pluginError != nil {
		t.Fatalf("overwrite with no etag: %s", pluginError.Message)
	}
	if _, pluginError := call(t, store, "filesystem/createDirectory", map[string]any{
		"providerId": filesystemProviderID, "uri": fsRoot,
	}); pluginError == nil {
		t.Fatal("createDirectory unexpectedly succeeded")
	}
}

func TestDispatchFilesystemReadWriteRoundTrip(t *testing.T) {
	store := newTestStore(t)
	doc := mustCall(t, store, "document/create", map[string]any{"name": "Round"}).(DocumentMeta)
	uri := "excalidraw:/documents/" + doc.ID + ".excalidraw"
	scene := []byte(`{"type":"excalidraw","version":2,"elements":[{"id":"a"}],"files":{}}`)
	encoded := base64.StdEncoding.EncodeToString(scene)

	written := mustCall(t, store, "filesystem/write", map[string]any{
		"providerId": filesystemProviderID, "uri": uri, "overwrite": true, "dataBase64": encoded,
	}).(map[string]any)
	if written["success"] != true {
		t.Fatalf("write result = %+v", written)
	}

	read := mustCall(t, store, "filesystem/read", map[string]any{
		"providerId": filesystemProviderID, "uri": uri, "maxBytes": 1 << 20,
	}).(map[string]any)
	decoded, err := base64.StdEncoding.DecodeString(read["dataBase64"].(string))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(string(decoded), `"id":"a"`) {
		t.Fatalf("read back %s", decoded)
	}
	if read["truncated"] != false {
		t.Fatal("read reported truncation")
	}

	root := mustCall(t, store, "filesystem/list", map[string]any{
		"providerId": filesystemProviderID, "uri": fsRoot, "limit": 10,
	}).(map[string]any)
	if entries := root["entries"].([]FSEntry); len(entries) != 2 {
		t.Fatalf("root listed %d entries", len(entries))
	}

	// Renaming through the filesystem must be visible to the document library.
	renamed := mustCall(t, store, "filesystem/rename", map[string]any{
		"providerId": filesystemProviderID, "sourceUri": uri, "targetUri": "excalidraw:/documents/Round Renamed.excalidraw",
	}).(map[string]any)
	entry := renamed["entry"].(FSEntry)
	if entry.Name != "Round Renamed.excalidraw" {
		t.Fatalf("renamed entry = %+v", entry)
	}
	if entry.URI != uri {
		t.Fatalf("rename changed the uuid-addressed uri: %q", entry.URI)
	}
	listing := mustCall(t, store, "document/list", map[string]any{}).(map[string]any)
	if items := listing["items"].([]DocumentMeta); items[0].Name != "Round Renamed" {
		t.Fatalf("document library shows %q", items[0].Name)
	}
}

func TestDispatchExportWriteIsChunked(t *testing.T) {
	store := newTestStore(t)
	jobID := "22222222-2222-2222-2222-222222222222"
	payload := []byte("export-bytes")
	result := mustCall(t, store, "export/write", map[string]any{
		"jobId":      jobID,
		"name":       "out.png",
		"size":       len(payload),
		"offset":     0,
		"dataBase64": base64.StdEncoding.EncodeToString(payload),
	}).(map[string]any)
	if result["complete"] != true || result["received"] != int64(len(payload)) {
		t.Fatalf("export/write result = %+v", result)
	}
	entry := mustCall(t, store, "filesystem/list", map[string]any{
		"providerId": filesystemProviderID, "uri": "excalidraw:/exports/", "limit": 10,
	}).(map[string]any)["entries"].([]FSEntry)
	if len(entry) != 1 || entry[0].Name != "out.png" {
		t.Fatalf("exports listed %+v", entry)
	}
}

func TestDispatchAssetChunkRoundTrip(t *testing.T) {
	store := newTestStore(t)
	doc := mustCall(t, store, "document/create", map[string]any{"name": "Chunks"}).(DocumentMeta)
	blob := []byte("0123456789abcdef")
	hash := strings.Repeat("b", 64)

	// A first chunk leaves the upload incomplete; the last one promotes it.
	first := mustCall(t, store, "asset/putChunk", map[string]any{
		"documentId": doc.ID, "hash": hash, "mimeType": "image/png",
		"size": len(blob), "offset": 0, "dataBase64": base64.StdEncoding.EncodeToString(blob[:8]),
	}).(map[string]any)
	if first["complete"] != false || first["received"] != int64(8) {
		t.Fatalf("first chunk = %+v", first)
	}
	second := mustCall(t, store, "asset/putChunk", map[string]any{
		"documentId": doc.ID, "hash": hash, "mimeType": "image/png",
		"size": len(blob), "offset": 8, "dataBase64": base64.StdEncoding.EncodeToString(blob[8:]),
	}).(map[string]any)
	if second["complete"] != true {
		t.Fatalf("second chunk = %+v", second)
	}

	stat := mustCall(t, store, "asset/stat", map[string]any{"hash": hash}).(map[string]any)
	if stat["exists"] != true {
		t.Fatalf("asset/stat after upload = %+v", stat)
	}

	read := mustCall(t, store, "asset/getChunk", map[string]any{"hash": hash, "offset": 0, "length": 1024}).(map[string]any)
	decoded, err := base64.StdEncoding.DecodeString(read["dataBase64"].(string))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(decoded) != string(blob) || read["size"] != int64(len(blob)) {
		t.Fatalf("asset read back %q size %v", decoded, read["size"])
	}

	// Traversal through the asset id must not reach outside the asset store.
	if code := errorCode(t, store, "asset/getChunk", map[string]any{"hash": `..\..\secret`, "offset": 0, "length": 16}); code != "INVALID_REQUEST" {
		t.Fatalf("traversing asset hash: category = %q", code)
	}
	if code := errorCode(t, store, "asset/putChunk", map[string]any{
		"documentId": doc.ID, "hash": strings.Repeat("c", 64), "mimeType": "image/png",
		"size": 16, "offset": 0, "dataBase64": "!!!",
	}); code != "INVALID_ASSET_CHUNK" {
		t.Fatalf("bad base64 chunk: category = %q", code)
	}
	if code := errorCode(t, store, "asset/putChunk", map[string]any{
		"documentId": "not-a-uuid", "hash": strings.Repeat("c", 64), "mimeType": "image/png",
		"size": 4, "offset": 0, "dataBase64": base64.StdEncoding.EncodeToString([]byte("abcd")),
	}); code != "INVALID_REQUEST" {
		t.Fatalf("bad document id: category = %q", code)
	}
}

func TestDispatchDocumentSizeAndCorruptionErrors(t *testing.T) {
	store := newTestStore(t)
	doc := mustCall(t, store, "document/create", map[string]any{"name": "Big"}).(DocumentMeta)

	// A scene past the accepted size reports its own category rather than the
	// generic storage failure, so the UI can say something accurate.
	huge := `{"type":"excalidraw","version":2,"elements":[],"files":{},"pad":"` +
		strings.Repeat("x", maxSceneBytes) + `"}`
	if code := errorCode(t, store, "document/saveScene", map[string]any{"id": doc.ID, "scene": json.RawMessage(huge)}); code != "DOCUMENT_TOO_LARGE" {
		t.Fatalf("oversized scene: category = %q", code)
	}

	// A damaged sidecar must surface as a storage failure, not as success.
	if err := writeFileAtomic(store.metaPath(doc.ID), []byte("{ not json"), 0o644); err != nil {
		t.Fatalf("damage meta: %v", err)
	}
	if code := errorCode(t, store, "document/rename", map[string]any{"id": doc.ID, "name": "x"}); code != "DOCUMENT_SAVE_FAILED" {
		t.Fatalf("damaged metadata: category = %q", code)
	}
	// The library deliberately skips a document whose metadata will not parse
	// rather than failing the whole listing — one damaged sidecar must not hide
	// every other diagram.
	listed := mustCall(t, store, "document/list", map[string]any{}).(map[string]any)
	if items := listed["items"].([]DocumentMeta); len(items) != 0 {
		t.Fatalf("document/list returned %d items for a damaged document", len(items))
	}
}
