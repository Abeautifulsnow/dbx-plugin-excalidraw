// Builds a local .dbxp for verification, without cutting a release.
//
//   node scripts/package.mjs [--skip-ui]
//
// What it does:
//   1. Runs the two gates release.mjs runs, for the same reason: the host kills
//      the sidecar when the version it reports in the handshake disagrees with
//      the installed manifest, and a structurally broken manifest fails at
//      install time instead of here.
//   2. Builds the frontend into ui/. `dbx-plugin package` stages directories
//      and never builds the UI itself — dbx-plugin.toml declares no ui_build
//      for it — so a stale ui/ ships stale code. That is the mistake this
//      wrapper exists to prevent.
//   3. Runs `dbx-plugin package .`, which builds the Go sidecar and writes
//      dist/<id>-<version>-<target>.dbxp plus matching artifact metadata.
//
// There is deliberately no --target passthrough. The packager accepts one, but
// for a Go backend it only changes the artifact name and the manifest's
// bin/<target>/ path: the build itself never sets GOOS or GOARCH, so asking for
// another platform on this machine would produce a host-native binary wearing
// that platform's label — a package that installs and then fails to run. The
// per-platform set is built by the release workflow, one native runner each.
//
// The result is always an unsigned review candidate: DBX refuses those until
// the plugin center's "allow unsigned development packages" switch is on.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// On Windows the CLI is an npm .cmd shim, which CreateProcess cannot launch
// directly; a shell is what makes the bare name `dbx-plugin` resolve.
const useShell = process.platform === "win32";
const USAGE = [
  "usage: node scripts/package.mjs [--skip-ui]",
  "",
  "Builds dist/<id>-<version>-<target>.dbxp for local verification: runs the",
  "version and manifest gates, rebuilds the UI into ui/, then packages.",
  "",
  "  --skip-ui   reuse the ui/ already on disk instead of rebuilding it, for a",
  "              backend-only change; the package then carries the UI as it was",
  "              last built, not as frontend/ reads now",
  "  -h, --help  print this message",
].join("\n");

/**
 * A shell re-splits the command line, so anything with a space has to be
 * quoted; without one the array reaches the process untouched and a quote would
 * become part of the argument itself.
 */
function commandLine(command, args) {
  if (!useShell) {
    return [command, args];
  }
  const quote = (argument) => (/\s/.test(argument) ? `"${argument}"` : argument);
  return [quote(command), args.map(quote)];
}

/** Runs one step to completion with inherited output, aborting the run on failure. */
function run(command, args, label) {
  const [file, argv] = commandLine(command, args);
  const result = spawnSync(file, argv, { cwd: repoRoot, stdio: "inherit", shell: useShell });
  if (result.error) {
    console.error(`[package] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[package] ${label} failed (exit ${result.status})`);
    process.exit(1);
  }
}

/** Fails early with something actionable, instead of cmd.exe's "not recognized". */
function requireCli() {
  const probe = spawnSync("dbx-plugin", ["--version"], { cwd: repoRoot, encoding: "utf8", shell: useShell });
  if (probe.status !== 0) {
    console.error("[package] the dbx-plugin CLI is not on PATH; install it first:");
    console.error("[package]   npm install --global @dbx-app/plugin-cli");
    process.exit(1);
  }
  console.log(`[package] ${(probe.stdout || "").trim()}`);
}

function parseArgs(argv) {
  const options = { help: false, skipUi: false };
  for (const argument of argv) {
    if (argument === "--skip-ui") {
      options.skipUi = true;
    } else if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else {
      console.error(`[package] unknown argument: ${argument}`);
      console.error(USAGE);
      process.exit(1);
    }
  }
  return options;
}

/**
 * When the ui/ on disk was last built, or null if it never was. The mtime is
 * the only honest answer to "is what I am about to package current?", and it
 * belongs in the --skip-ui message for exactly that reason: the flag's whole
 * risk is packaging a UI older than the sources beside it.
 */
function uiBuiltAt() {
  try {
    return statSync(path.join(repoRoot, "ui", "index.html")).mtime;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function safeReaddir(directory) {
  try {
    return readdirSync(directory);
  } catch (error) {
    // dist/ does not exist until the first package run; that is not a failure.
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * This version's .dbxp files, each identified by the size and mtime that pin
 * down one particular build. Diffing before against after is what lets the
 * report name the artifact this run wrote instead of every same-version target
 * an earlier run happened to leave in dist/.
 */
function snapshotArtifacts(distDir, prefix) {
  const found = new Map();
  for (const name of safeReaddir(distDir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".dbxp")) {
      continue;
    }
    const info = statSync(path.join(distDir, name));
    found.set(name, `${info.size}:${info.mtimeMs}`);
  }
  return found;
}

function describe(distDir, name) {
  const absolute = path.join(distDir, name);
  const size = statSync(absolute).size;
  const sha256 = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  console.log(`[package] ${path.relative(repoRoot, absolute)}`);
  console.log(`[package]   ${size} bytes  sha256 ${sha256}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const scripts = path.join(repoRoot, "scripts");

  requireCli();
  run(process.execPath, [path.join(scripts, "sync-version.mjs")], "version check");
  run(process.execPath, [path.join(scripts, "check-manifest.mjs")], "manifest check");

  if (options.skipUi) {
    const builtAt = uiBuiltAt();
    console.log(
      builtAt
        ? `[package] --skip-ui: reusing ui/, last built ${builtAt.toLocaleString()}`
        : "[package] --skip-ui: ui/ was never built here; the packager will fail on its ui include",
    );
  } else {
    run(process.execPath, [path.join(repoRoot, "frontend", "scripts", "build.mjs")], "frontend build");
  }

  const distDir = path.join(repoRoot, "dist");
  const prefix = `${manifest.id}-${manifest.version}-`;
  const before = snapshotArtifacts(distDir, prefix);

  run("dbx-plugin", ["package", "."], "dbx-plugin package");

  const produced = [...snapshotArtifacts(distDir, prefix)].filter(([name, signature]) => before.get(name) !== signature);
  if (produced.length === 0) {
    console.error(`[package] dbx-plugin exited 0 but no ${prefix}*.dbxp changed in dist/`);
    process.exit(1);
  }
  for (const [name] of produced) {
    describe(distDir, name);
  }
  console.log("[package] unsigned review candidate: turn on the plugin center's");
  console.log("[package] \"allow unsigned development packages\" switch before installing it.");
  console.log("[package] install with \"Install .dbxp\" in the plugin center, or drop the file on that page.");
}

main();
