// Runs `go vet` and `go test` for the backend sidecar.
//
// The Go SDK module (github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk) is not
// published to public Go proxies; the dbx-plugin CLI normally patches it via
// DBX_PLUGIN_SDK_ROOT at build time. `go test` has no such hook, so this script
// wires a temporary go.work at the repo root pointing at the CLI's bundled SDK
// sources, runs the tests, and removes the file again (it is also gitignored).
import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  if (!existsSync(path.join(repoRoot, "backend", "go.mod"))) {
    console.error("[backend-test] backend/go.mod not found; run from the repo root");
    process.exit(1);
  }

  let sdkRoot = process.env.DBX_PLUGIN_SDK_ROOT ?? "";
  if (!sdkRoot) {
    try {
      sdkRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      sdkRoot = path.join(sdkRoot, "@dbx-app", "plugin-cli", "sdk-root");
    } catch {
      console.error("[backend-test] could not resolve the global npm root; set DBX_PLUGIN_SDK_ROOT");
      process.exit(1);
    }
  }
  const sdkModule = path.join(sdkRoot, "plugins", "sdk", "go", "dbx-plugin-sdk");
  if (!existsSync(path.join(sdkModule, "go.mod"))) {
    console.error(`[backend-test] Go SDK sources not found at ${sdkModule}`);
    process.exit(1);
  }

  const goWorkPath = path.join(repoRoot, "go.work");
  const sdkPath = sdkModule.split(path.sep).join("/");
  writeFileSync(
    goWorkPath,
    `go 1.22\n\nuse ./backend\nuse ${sdkPath}\n`,
  );
  try {
    execSync("go -C backend vet .", { cwd: repoRoot, stdio: "inherit" });
    execSync("go -C backend test .", { cwd: repoRoot, stdio: "inherit" });
  } finally {
    rmSync(goWorkPath, { force: true });
    rmSync(path.join(repoRoot, "go.work.sum"), { force: true });
  }
}

main();
