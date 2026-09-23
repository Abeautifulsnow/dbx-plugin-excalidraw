package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const (
	pluginID       = "io.dbx.excalidraw"
	pluginVersion  = "0.3.0"
	maxBase64Chunk = 2 * 1024 * 1024
)

type plugin struct {
	store *Store
}

// appError renders protocol errors as "CATEGORY: message" so the frontend can
// react to the category without parsing prose. Messages must not leak OS paths.
func appError(code int, category, message string) *dbxpluginsdk.PluginError {
	return dbxpluginsdk.NewError(code, category+": "+message)
}

func mapStoreError(err error) *dbxpluginsdk.PluginError {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errDocumentNotFound):
		return appError(-32000, "DOCUMENT_NOT_FOUND", "The diagram does not exist.")
	case errors.Is(err, errInvalidID):
		return appError(-32602, "INVALID_REQUEST", "Invalid document id.")
	case errors.Is(err, errInvalidName):
		return appError(-32602, "INVALID_REQUEST", "Diagram names must be 1-255 characters.")
	case errors.Is(err, errSceneTooLarge):
		return appError(-32000, "DOCUMENT_TOO_LARGE", "The diagram is too large to save.")
	case errors.Is(err, errInvalidScene):
		return appError(-32602, "INVALID_SCENE", "The scene is not a valid Excalidraw document.")
	case errors.Is(err, errInvalidHash):
		return appError(-32602, "INVALID_REQUEST", "Invalid asset hash.")
	case errors.Is(err, errAssetNotFound):
		return appError(-32000, "ASSET_NOT_FOUND", "The image data is missing.")
	case errors.Is(err, errAssetChunk):
		return appError(-32602, "INVALID_ASSET_CHUNK", err.Error())
	case errors.Is(err, errInvalidJob):
		return appError(-32602, "INVALID_REQUEST", "Invalid export job.")
	case errors.Is(err, errExportName):
		return appError(-32602, "INVALID_REQUEST", "Invalid export file name.")
	case errors.Is(err, errExportTooBig):
		return appError(-32000, "DOCUMENT_TOO_LARGE", "The export is too large.")
	case errors.Is(err, errExportChunk):
		return appError(-32602, "INVALID_EXPORT_CHUNK", err.Error())
	case errors.Is(err, errFSPath):
		return appError(-32602, "INVALID_PATH", "That path is not a valid Excalidraw Studio path.")
	case errors.Is(err, errFSNotFound):
		return appError(-32000, "NOT_FOUND", "That item no longer exists.")
	case errors.Is(err, errFSExists):
		return appError(-32000, "ALREADY_EXISTS", "An item with that name already exists.")
	case errors.Is(err, errFSTooLarge):
		return appError(-32000, "TOO_LARGE", err.Error())
	case errors.Is(err, errFSReadOnly):
		return appError(-32000, "READ_ONLY", "Exports are produced by the editor and cannot be written here.")
	case errors.Is(err, errFSUnsupported):
		return appError(-32000, "NOT_SUPPORTED", err.Error())
	case errors.Is(err, errFSStale):
		return appError(-32000, "CONFLICT", "The item changed since it was read; reopen it and retry.")
	default:
		return appError(-32000, "DOCUMENT_SAVE_FAILED", "A local storage error occurred.")
	}
}

func decodeParams(params json.RawMessage, target any) *dbxpluginsdk.PluginError {
	if err := json.Unmarshal(params, target); err != nil {
		return appError(-32602, "INVALID_REQUEST", "Malformed request parameters.")
	}
	return nil
}

// requireFilesystemProvider rejects requests aimed at a provider this plugin
// does not declare, so a stale host binding cannot silently address a
// different mount.
func requireFilesystemProvider(providerID string) *dbxpluginsdk.PluginError {
	if providerID != filesystemProviderID {
		return appError(-32602, "INVALID_REQUEST", "Unknown filesystem provider.")
	}
	return nil
}

func (p *plugin) Handle(
	_ dbxpluginsdk.RequestContext,
	method string,
	params json.RawMessage,
	_ *dbxpluginsdk.Emitter,
) (any, *dbxpluginsdk.PluginError) {
	// Routing by family keeps each handler small; the method names are already
	// namespaced ("document/list", "asset/putChunk").
	switch {
	case strings.HasPrefix(method, "document/"):
		return p.handleDocument(method, params)
	case strings.HasPrefix(method, "asset/"):
		return p.handleAsset(method, params)
	case strings.HasPrefix(method, "export/"):
		return p.handleExport(method, params)
	case strings.HasPrefix(method, "filesystem/"):
		return p.handleFilesystem(method, params)
	case strings.HasPrefix(method, "prefs/"):
		return p.handlePrefs(method, params)
	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func (p *plugin) handleDocument(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "document/list":
		documents, err := p.store.ListDocuments()
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"items": documents}, nil

	case "document/create":
		var request struct {
			Name string `json:"name"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		meta, err := p.store.CreateDocument(request.Name)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return meta, nil

	case "document/get":
		var request struct {
			ID string `json:"id"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		meta, scene, corrupt, err := p.store.GetDocument(request.ID)
		if err != nil {
			return nil, mapStoreError(err)
		}
		var scenePayload json.RawMessage
		if len(scene) > 0 && json.Valid(scene) {
			scenePayload = json.RawMessage(scene)
		}
		return map[string]any{
			"document": meta,
			"scene":    scenePayload,
			"corrupt":  corrupt,
		}, nil

	case "document/saveScene":
		var request struct {
			ID    string          `json:"id"`
			Scene json.RawMessage `json:"scene"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		meta, err := p.store.SaveScene(request.ID, request.Scene)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return meta, nil

	case "document/rename":
		var request struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		meta, err := p.store.RenameDocument(request.ID, request.Name)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return meta, nil

	case "document/delete":
		var request struct {
			ID string `json:"id"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if err := p.store.DeleteDocument(request.ID); err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"success": true}, nil

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func (p *plugin) handleAsset(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "asset/stat":
		var request struct {
			Hash string `json:"hash"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		meta, exists := p.store.StatAsset(request.Hash)
		return map[string]any{"exists": exists, "asset": meta}, nil

	case "asset/putChunk":
		var request struct {
			DocumentID string `json:"documentId"`
			Hash       string `json:"hash"`
			MimeType   string `json:"mimeType"`
			Size       int64  `json:"size"`
			Offset     int64  `json:"offset"`
			DataBase64 string `json:"dataBase64"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if len(request.DataBase64) > maxBase64Chunk {
			return nil, appError(-32600, "DOCUMENT_TOO_LARGE", "Asset chunk exceeds the bridge limit.")
		}
		data, err := base64.StdEncoding.DecodeString(request.DataBase64)
		if err != nil {
			return nil, appError(-32602, "INVALID_ASSET_CHUNK", "Asset chunk is not valid base64.")
		}
		if err := validateDocumentID(request.DocumentID); err != nil {
			return nil, appError(-32602, "INVALID_REQUEST", "Invalid document id.")
		}
		received, complete, err := p.store.PutAssetChunk(request.Hash, request.MimeType, request.Size, request.Offset, data)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"received": received, "complete": complete}, nil

	case "asset/getChunk":
		var request struct {
			Hash   string `json:"hash"`
			Offset int64  `json:"offset"`
			Length int64  `json:"length"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		data, total, mimeType, err := p.store.GetAssetChunk(request.Hash, request.Offset, request.Length)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{
			"dataBase64": base64.StdEncoding.EncodeToString(data),
			"size":       total,
			"mimeType":   mimeType,
		}, nil

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func (p *plugin) handleExport(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "export/write":
		// The sandboxed UI cannot trigger browser downloads, so rendered
		// exports are streamed here and written under <base>/exports/.
		var request struct {
			JobID      string `json:"jobId"`
			Name       string `json:"name"`
			Size       int64  `json:"size"`
			Offset     int64  `json:"offset"`
			DataBase64 string `json:"dataBase64"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if len(request.DataBase64) > maxBase64Chunk {
			return nil, appError(-32600, "DOCUMENT_TOO_LARGE", "Export chunk exceeds the bridge limit.")
		}
		data, err := base64.StdEncoding.DecodeString(request.DataBase64)
		if err != nil {
			return nil, appError(-32602, "INVALID_EXPORT_CHUNK", "Export chunk is not valid base64.")
		}
		received, complete, path, err := p.store.WriteExportChunk(request.JobID, request.Name, request.Size, request.Offset, data)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"received": received, "complete": complete, "path": path}, nil

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

// handleFilesystem serves the `excalidraw:` filesystem provider, dispatched
// along the same line the host's capability model uses: reads and mutations are
// separately declared, so they are separately handled.
func (p *plugin) handleFilesystem(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "filesystem/list", "filesystem/read":
		return p.handleFilesystemRead(method, params)
	case "filesystem/write", "filesystem/delete", "filesystem/rename", "filesystem/createDirectory":
		return p.handleFilesystemMutate(method, params)
	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

// handleFilesystemRead serves the operations gated by the provider's `read`
// capability. Every method carries the provider id the host resolved, which is
// checked so a stale host binding cannot silently address a different mount.
func (p *plugin) handleFilesystemRead(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "filesystem/list":
		var request struct {
			ProviderID string `json:"providerId"`
			URI        string `json:"uri"`
			Cursor     string `json:"cursor"`
			Limit      int    `json:"limit"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if pluginError := requireFilesystemProvider(request.ProviderID); pluginError != nil {
			return nil, pluginError
		}
		entries, nextCursor, err := p.store.FSList(request.URI, request.Cursor, request.Limit)
		if err != nil {
			return nil, mapStoreError(err)
		}
		response := map[string]any{"entries": entries}
		if nextCursor != "" {
			response["nextCursor"] = nextCursor
		}
		return response, nil

	case "filesystem/read":
		var request struct {
			ProviderID string `json:"providerId"`
			URI        string `json:"uri"`
			MaxBytes   int64  `json:"maxBytes"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if pluginError := requireFilesystemProvider(request.ProviderID); pluginError != nil {
			return nil, pluginError
		}
		data, contentType, etag, err := p.store.FSRead(request.URI, request.MaxBytes)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{
			"dataBase64":  base64.StdEncoding.EncodeToString(data),
			"contentType": contentType,
			// An oversized file is rejected above rather than truncated, so a
			// partial document can never be mistaken for a complete one.
			"truncated": false,
			"etag":      etag,
		}, nil

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

// handleFilesystemMutate serves the operations gated by the provider's write,
// delete and rename capabilities. Like the read handler, each method re-checks
// the provider id the host resolved.
func (p *plugin) handleFilesystemMutate(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "filesystem/write":
		var request struct {
			ProviderID string `json:"providerId"`
			URI        string `json:"uri"`
			DataBase64 string `json:"dataBase64"`
			Create     bool   `json:"create"`
			Overwrite  bool   `json:"overwrite"`
			ETag       string `json:"etag"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if pluginError := requireFilesystemProvider(request.ProviderID); pluginError != nil {
			return nil, pluginError
		}
		data, err := base64.StdEncoding.DecodeString(request.DataBase64)
		if err != nil {
			return nil, appError(-32602, "INVALID_REQUEST", "Filesystem write is not valid base64.")
		}
		entry, err := p.store.FSWrite(request.URI, data, request.Create, request.Overwrite, request.ETag)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"success": true, "entry": entry}, nil

	case "filesystem/delete":
		var request struct {
			ProviderID string `json:"providerId"`
			URI        string `json:"uri"`
			Recursive  bool   `json:"recursive"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if pluginError := requireFilesystemProvider(request.ProviderID); pluginError != nil {
			return nil, pluginError
		}
		if err := p.store.FSDelete(request.URI, request.Recursive); err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"success": true}, nil

	case "filesystem/rename":
		var request struct {
			ProviderID string `json:"providerId"`
			SourceURI  string `json:"sourceUri"`
			TargetURI  string `json:"targetUri"`
			Overwrite  bool   `json:"overwrite"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		if pluginError := requireFilesystemProvider(request.ProviderID); pluginError != nil {
			return nil, pluginError
		}
		entry, err := p.store.FSRename(request.SourceURI, request.TargetURI, request.Overwrite)
		if err != nil {
			return nil, mapStoreError(err)
		}
		return map[string]any{"success": true, "entry": entry}, nil

	case "filesystem/createDirectory":
		// The provider exposes a flat two-directory layout; offering folder
		// creation would imply a hierarchy that does not exist.
		return nil, appError(-32000, "NOT_SUPPORTED", "Excalidraw Studio has no folders.")

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func mapPrefError(err error) *dbxpluginsdk.PluginError {
	switch {
	case errors.Is(err, errPrefKey):
		return appError(-32602, "INVALID_REQUEST", "Unknown preference key.")
	case errors.Is(err, errPrefValue):
		return appError(-32602, "INVALID_REQUEST", "Invalid preference value.")
	default:
		return appError(-32000, "PREFS_SAVE_FAILED", "The preference could not be saved.")
	}
}

// handlePrefs serves the UI's small persisted preferences. The whole set is
// returned on both calls, so the frontend never has to guess whether its local
// copy still matches what is stored.
func (p *plugin) handlePrefs(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "prefs/get":
		return map[string]any{"values": p.store.getPrefs()}, nil

	case "prefs/set":
		var request struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		}
		if pluginError := decodeParams(params, &request); pluginError != nil {
			return nil, pluginError
		}
		var value any
		if err := json.Unmarshal(request.Value, &value); err != nil {
			return nil, appError(-32602, "INVALID_REQUEST", "Malformed preference value.")
		}
		values, err := p.store.setPref(request.Key, value)
		if err != nil {
			return nil, mapPrefError(err)
		}
		return map[string]any{"values": values}, nil

	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func main() {
	store, err := NewStore(pluginID)
	if err != nil {
		log.Fatalf("[excalidraw-studio] storage initialization failed: %v", err)
	}
	fmt.Fprintf(os.Stderr, "[excalidraw-studio] storage at %s\n", store.baseDir)
	metadata := dbxpluginsdk.Metadata{
		ID:           pluginID,
		Version:      pluginVersion,
		Capabilities: []string{"documents"},
	}
	server := dbxpluginsdk.NewServer(metadata, &plugin{store: store})
	if err := server.Serve(); err != nil {
		log.Fatal(err)
	}
}
