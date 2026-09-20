import { Excalidraw, MIME_TYPES } from "@excalidraw/excalidraw";
// The dev CSS references real font files, so Vite bundles the UI fonts;
// the prod export's CSS points at fonts that are not shipped in the package.
import "@excalidraw/excalidraw/dist/dev/index.css";
import type { DragEvent } from "react";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

interface ExcalidrawEditorProps {
  initialData: ExcalidrawInitialDataState;
  theme: "light" | "dark";
  langCode: string;
  onChange: (elements: readonly ExcalidrawElement[], appState: AppState) => void;
  onApi: (api: ExcalidrawImperativeAPI) => void;
  onExternalFileDrop?: () => void;
}

// Thin adapter around the official component: every Excalidraw-specific prop
// lives here instead of spreading through the application (PRD §22).
export function ExcalidrawEditor({
  initialData,
  theme,
  langCode,
  onChange,
  onApi,
  onExternalFileDrop,
}: ExcalidrawEditorProps) {
  // Excalidraw's own drop handler loads a dropped .excalidraw file straight
  // onto the canvas, silently replacing the open DBX document — intercept
  // scene documents at the host boundary. Image drops are Excalidraw's
  // supported insert path and pass through untouched; internal element and
  // library drags carry no files and also pass through.
  const handleDropCapture = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    const isSceneFile = files.some(
      (file) => file.type === MIME_TYPES.excalidraw || file.name.toLowerCase().endsWith(".excalidraw"),
    );
    if (isSceneFile) {
      event.preventDefault();
      event.stopPropagation();
      onExternalFileDrop?.();
    }
  };

  return (
    <div className="excalidraw-host" onDropCapture={handleDropCapture}>
      <Excalidraw
        excalidrawAPI={onApi}
        theme={theme}
        langCode={langCode}
        initialData={initialData}
        onChange={onChange}
        UIOptions={{
          canvasActions: {
            // Scene loading/saving goes through the DBX document model instead.
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
}
