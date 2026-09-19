import { Excalidraw } from "@excalidraw/excalidraw";
// The dev CSS references real font files, so Vite bundles the UI fonts;
// the prod export's CSS points at fonts that are not shipped in the package.
import "@excalidraw/excalidraw/dist/dev/index.css";
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
}

// Thin adapter around the official component: every Excalidraw-specific prop
// lives here instead of spreading through the application (PRD §22).
export function ExcalidrawEditor({ initialData, theme, langCode, onChange, onApi }: ExcalidrawEditorProps) {
  return (
    <div className="excalidraw-host">
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
