// Registers the vendored Excalidraw fonts as blob:-backed @font-face rules
// through the DBX asset bridge. The sandbox CSP permits only data:/blob:
// font sources, so Excalidraw's own HTTP font loader cannot work; with the
// faces pre-registered and pre-loaded, its document.fonts.check() passes and
// the network path is skipped entirely.
let done = false;

interface FontEntry {
  family: string;
  path: string;
  unicodeRange?: string;
  weight?: number;
}

// Surfaced through a hidden live region so font-loading problems are
// observable (accessibility tree / diagnostics) without console access.
function reportFontStatus(status: string) {
  let node = document.getElementById("dbx-font-status");
  if (!node) {
    node = document.createElement("div");
    node.id = "dbx-font-status";
    node.className = "visually-hidden";
    node.setAttribute("role", "status");
    document.body.appendChild(node);
  }
  node.textContent = `fonts: ${status}`;
}

// readAsset is documented to return text, but the dev host currently returns
// the raw { dataBase64, contentType } envelope; accept every shape.
function parseManifest(raw: unknown): FontEntry[] {
  if (typeof raw === "string") {
    return JSON.parse(raw) as FontEntry[];
  }
  if (Array.isArray(raw)) {
    return raw as FontEntry[];
  }
  const envelope = raw as { text?: string; dataBase64?: string };
  if (typeof envelope?.text === "string") {
    return JSON.parse(envelope.text) as FontEntry[];
  }
  if (typeof envelope?.dataBase64 === "string") {
    const binary = atob(envelope.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as FontEntry[];
  }
  throw new Error("unsupported readAsset payload");
}

function sampleCharacter(entry: FontEntry): string {
  const first = entry.unicodeRange?.match(/U\+([0-9a-f]+)/i)?.[1];
  if (first) {
    try {
      return String.fromCodePoint(parseInt(first, 16));
    } catch {
      /* fall through */
    }
  }
  return "A";
}

export async function ensureFonts(): Promise<void> {
  if (done || !window.dbxPlugin) {
    return;
  }
  done = true;
  try {
    const bridge = window.dbxPlugin;
    const manifest = parseManifest(await bridge.readAsset("fonts/fonts.json"));

    // Fetch object URLs with bounded concurrency; the manifest can list 200+
    // CJK subset faces and sequential round-trips would delay startup.
    const urls = new Map<string, string>();
    const queue = [...manifest];
    const worker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) {
          break;
        }
        if (!urls.has(entry.path)) {
          urls.set(entry.path, await bridge.readAssetUrl(entry.path));
        }
      }
    };
    await Promise.all(Array.from({ length: 12 }, () => worker()));

    const rules: string[] = [];
    for (const entry of manifest) {
      const url = urls.get(entry.path);
      if (!url) {
        continue;
      }
      const weight = entry.weight ? `font-weight:${entry.weight};` : "";
      const range = entry.unicodeRange ? `unicode-range:${entry.unicodeRange};` : "";
      rules.push(`@font-face{font-family:'${entry.family}';src:url(${url}) format('woff2');font-style:normal;${weight}${range}font-display:block;}`);
    }
    const style = document.createElement("style");
    style.textContent = rules.join("\n");
    document.head.appendChild(style);

    // Load each face eagerly (one representative code point per subset) so
    // the first canvas paint and fonts.check() both succeed without waiting.
    await Promise.allSettled(
      manifest.map((entry) =>
        document.fonts.load(`${entry.weight ?? 400} 16px '${entry.family}'`, sampleCharacter(entry)),
      ),
    );
    reportFontStatus(`ok (${manifest.length} faces)`);
  } catch (error) {
    // Non-fatal: the editor still renders with system fallback fonts.
    console.warn("[fonts] offline font registration failed", error);
    reportFontStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
