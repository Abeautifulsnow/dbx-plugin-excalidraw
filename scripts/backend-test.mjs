// Runs `go vet` and `go test` for the backend sidecar.
//
// backend/go.mod replaces github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk with
// the vendored copy under backend/third_party, so vet, test and a local `go
// build` all resolve the SDK offline with no CLI install and no workspace file.
// (An earlier version wired a temporary go.work at the CLI's bundled SDK sources
// instead, which meant the tests and a local build could compile against two
// different SDK revisions.)
//
// Note this is *not* what ships: `dbx-plugin package` copies go.mod and rewrites
// the replace to the SDK bundled with the installed CLI (plugins/sdk/cli/src/
// lib.rs `build_go_backend`). The vendored copy and the CLI's copy therefore have
// to be kept in step, which sidecar-smoke.mjs warns about.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  if (!existsSync(path.join(repoRoot, "backend", "go.mod"))) {
    console.error("[backend-test] backend/go.mod not found; run from the repo root");
    process.exit(1);
  }
  execSync("go vet ./...", { cwd: path.join(repoRoot, "backend"), stdio: "inherit" });
  execSync("go test ./...", { cwd: path.join(repoRoot, "backend"), stdio: "inherit" });
}

main();
