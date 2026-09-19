import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

// DBX dev host contract: a standalone "DBX_UI_BUILD_SUCCESS" line on stdout
// after every successful build (including watch rebuilds) triggers UI reload.
// closeBundle also runs after failed builds, so gate on buildEnd's error.
function dbxUiBuildSuccess(): Plugin {
  let failed = false;
  return {
    name: "dbx-ui-build-success",
    apply: "build",
    buildEnd(error) {
      failed = Boolean(error);
    },
    closeBundle() {
      if (!failed) {
        console.log("DBX_UI_BUILD_SUCCESS");
      }
      failed = false;
    },
  };
}

export default defineConfig({
  // The plugin UI is loaded from the package root; keep every emitted URL relative.
  base: "./",
  plugins: [react(), dbxUiBuildSuccess()],
  resolve: {
    alias: [
      {
        // The package exports map blocks deep imports; point straight at the
        // dev CSS, which is the only variant whose referenced font files
        // actually ship in the package.
        find: /^@excalidraw\/excalidraw\/dist\/dev\/index\.css$/,
        replacement: fileURLToPath(
          new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.css", import.meta.url),
        ),
      },
    ],
  },
  build: {
    outDir: "../ui",
    emptyOutDir: true,
    assetsDir: "assets",
    chunkSizeWarningLimit: 15000,
    reportCompressedSize: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
