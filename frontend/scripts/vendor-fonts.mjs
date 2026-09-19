// Vendors the Excalidraw canvas-font tree into public/fonts and extracts the
// per-subset unicode-range metadata from the package bundle into fonts.json.
//
// Why: the DBX sandbox CSP only allows font sources data:/blob:. Excalidraw's
// own runtime loader fetches fonts over HTTP via EXCALIDRAW_ASSET_PATH, which
// the sandbox blocks. The app therefore registers every face itself through
// readAssetUrl() (blob:) using this manifest, which makes Excalidraw's
// document.fonts.check() pass and skips its network path entirely.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function vendorFonts() {
  const pkgRoot = path.resolve("node_modules/@excalidraw/excalidraw/dist/dev");
  const fontSource = path.join(pkgRoot, "fonts");
  const target = path.resolve("public/fonts");

  if (!existsSync(fontSource)) {
    console.error(`[vendor-fonts] missing font source: ${fontSource}`);
    process.exit(1);
  }

  mkdirSync(target, { recursive: true });
  cpSync(fontSource, target, { recursive: true, force: true });

  // Find the bundle chunk that declares the font-face metadata tables.
  let chunk = null;
  for (const file of readdirSync(pkgRoot).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(path.join(pkgRoot, file), "utf8");
    if (source.includes('init("Excalifont"')) {
      chunk = source;
      break;
    }
  }
  if (!chunk) {
    console.error("[vendor-fonts] could not locate font metadata in the package bundle");
    process.exit(1);
  }

  // Map identifier -> "./fonts/<Dir>/<file>.woff2" declarations.
  const varMap = new Map();
  for (const match of chunk.matchAll(/([A-Za-z0-9_$]+)\s*=\s*"(\.\/fonts\/[^"]+\.woff2)"/g)) {
    varMap.set(match[1], match[2].replace("./fonts/", ""));
  }

  // GOOGLE_FONTS_RANGES holds shared unicode-range constants referenced by
  // identifier in descriptor tables.
  const rangeConstants = new Map();
  const rangesIndex = chunk.indexOf("GOOGLE_FONTS_RANGES = {");
  if (rangesIndex >= 0) {
    const rangesBody = chunk.slice(rangesIndex, chunk.indexOf("};", rangesIndex));
    for (const match of rangesBody.matchAll(/([A-Z_0-9]+)\s*:\s*"(U\+[^"]+)"/g)) {
      rangeConstants.set(match[1], match[2]);
    }
  }

  function resolveUri(token) {
    const literal = token.match(/^"([^"]+)"$/);
    if (literal) {
      return literal[1].startsWith("./fonts/") ? literal[1].slice(8) : null;
    }
    return varMap.get(token) ?? null;
  }

  function resolveRange(token) {
    const literal = token.match(/^"([^"]+)"$/);
    if (literal) {
      return literal[1];
    }
    const constant = token.match(/^GOOGLE_FONTS_RANGES\.([A-Z_0-9]+)$/);
    return constant ? rangeConstants.get(constant[1]) : undefined;
  }

  const manifest = [];
  // init("<Family>", ...<Array>FontFaces) declares the runtime registry; the
  // family can also be a constant identifier (e.g. CJK_HAND_DRAWN_FALLBACK_FONT).
  const constants = new Map();
  for (const match of chunk.matchAll(/([A-Za-z0-9_$]+)\s*=\s*"([^"./][^"]*)"/g)) {
    constants.set(match[1], match[2]);
  }
  for (const match of chunk.matchAll(/init\(\s*("([^"]+)"|[A-Za-z0-9_$]+)\s*,\s*\.\.\.([A-Za-z0-9_$]+)\)/g)) {
    const family = match[2] ?? constants.get(match[1]);
    const arrayName = match[3];
    if (!family) {
      continue;
    }
    const start = chunk.indexOf(`${arrayName} = [`);
    if (start < 0) {
      continue;
    }
    const end = chunk.indexOf("];", start);
    const body = chunk.slice(start, end);
    for (const face of body.matchAll(
      /\{\s*uri:\s*([^,}]+?)\s*,\s*descriptors:\s*\{\s*unicodeRange:\s*("[^"]+"|[A-Za-z0-9_$.]+)\s*(?:,\s*weight:\s*("[^"]+"|\d+)\s*)?\}\s*\}|\{\s*uri:\s*([^,}]+?)\s*\}/g,
    )) {
      const uriToken = (face[1] ?? face[4]).trim();
      const file = resolveUri(uriToken);
      if (!file) {
        continue;
      }
      const unicodeRange = face[2] ? resolveRange(face[2].trim()) : undefined;
      const weight = face[3] ? Number(face[3].replace(/"/g, "")) : undefined;
      manifest.push({
        family,
        path: `fonts/${file}`,
        ...(unicodeRange ? { unicodeRange } : {}),
        ...(weight ? { weight } : {}),
      });
    }
  }

  // Assistant (UI font) is only referenced from the package CSS; register it
  // with weight variants derived from the file names.
  const assistantDir = path.join(target, "Assistant");
  if (existsSync(assistantDir)) {
    const weights = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };
    for (const file of readdirSync(assistantDir).filter((name) => name.endsWith(".woff2"))) {
      const weight = Object.entries(weights).find(([name]) => file.includes(name))?.[1] ?? 400;
      manifest.push({ family: "Assistant", path: `fonts/Assistant/${file}`, weight });
    }
  }

  manifest.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(path.join(target, "fonts.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const families = [...new Set(manifest.map((entry) => entry.family))];
  console.log(
    `[vendor-fonts] copied ${manifest.length} font faces (${families.length} families: ${families.join(", ")}) -> public/fonts`,
  );
}
