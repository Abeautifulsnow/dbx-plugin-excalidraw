package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const (
	pluginID       = "io.dbx.excalidraw"
	pluginVersion  = "0.2.0"
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

func (p *plugin) Handle(
	_ dbxpluginsdk.RequestContext,
	method string,
	params json.RawMessage,
	_ *dbxpluginsdk.Emitter,
) (any, *dbxpluginsdk.PluginError) {
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
		if err := validateDocumentIDForAsset(request.DocumentID); err != nil {
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

func validateDocumentIDForAsset(id string) error {
	return validateDocumentID(id)
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
