// Frontend build entry used by dbx-plugin.toml [dev] ui_build/ui_watch.
// Vendors Excalidraw fonts into public/ (offline requirement), then builds.
// The DBX_UI_BUILD_SUCCESS signal is printed by the vite plugin in vite.config.ts.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(frontendDir);

const { vendorFonts } = await import("./vendor-fonts.mjs");
vendorFonts();

const { build } = await import("vite");
const watch = process.argv.includes("--watch");

try {
  await build({
    build: watch ? { watch: {} } : {},
    mode: watch ? "development" : "production",
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
