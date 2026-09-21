// Keeps the plugin version identical everywhere it is declared.
//
// manifest.json owns the version; every other occurrence is derived from it.
// Drift here is not cosmetic: the host compares the version the sidecar reports
// in the `plugin/initialize` handshake against the installed manifest and kills
// the backend on a mismatch.
//
//   node scripts/sync-version.mjs           # verify (exit 1 on drift) - used by CI
//   node scripts/sync-version.mjs --write   # rewrite the derived occurrences
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `count` pins how many occurrences each file is expected to hold. A regex that
// silently stops matching after a refactor would otherwise make this gate a
// no-op that always passes.
const targets = [
  {
    file: "backend/main.go",
    describe: "sidecar identity reported in the initialize handshake",
    pattern: /(pluginVersion\s*=\s*)"[^"]*"/g,
    count: 1,
    replace: (_match, prefix) => `${prefix}"{version}"`,
  },
  {
    file: "frontend/package.json",
    describe: "frontend package version",
    pattern: /^(\s*"version"\s*:\s*)"[^"]*"/gm,
    count: 1,
    replace: (_match, prefix) => `${prefix}"{version}"`,
  },
];

function readVersion() {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const version = manifest.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`[sync-version] manifest.json has an unusable version: ${JSON.stringify(version)}`);
    process.exit(1);
  }
  return version;
}

function inspect(target, version) {
  const absolute = path.join(repoRoot, target.file);
  let source;
  try {
    source = readFileSync(absolute, "utf8");
  } catch (error) {
    // A missing target means the layout changed; the raw ENOENT stack buries
    // the actionable part, which is the same thing an unexpected match count
    // reports below.
    console.error(`[sync-version] cannot read ${target.file} (${target.describe}): ${error.code ?? error.message}`);
    console.error("[sync-version] update this script so every tracked file still exists.");
    process.exit(1);
  }
  const matches = [...source.matchAll(target.pattern)];
  // Each pattern ends in a quoted value; a JSON target like `"version": "0.2.1"`
  // also matches its own key, so take the last quoted string in the match.
  const found = matches.map((match) => {
    const quoted = [...match[0].matchAll(/"([^"]*)"/g)];
    return quoted.length > 0 ? quoted[quoted.length - 1][1] : match[0];
  });
  return {
    ...target,
    absolute,
    source,
    matches,
    found,
    drift: matches.length !== target.count || found.some((value) => value !== version),
  };
}

function apply(target, version) {
  const updated = target.source.replace(target.pattern, (...args) =>
    target.replace(...args.slice(0, -2)).replaceAll("{version}", version),
  );
  writeFileSync(target.absolute, updated);
}

function main() {
  const write = process.argv.includes("--write");
  const version = readVersion();
  const results = targets.map((target) => inspect(target, version));

  // A missing match is a broken pattern, not drift; applying would corrupt the
  // file, so refuse before touching anything.
  const mismatched = results.filter((result) => result.matches.length !== result.count);
  if (mismatched.length > 0) {
    console.error(`[sync-version] expected occurrence count changed in:`);
    for (const result of mismatched) {
      console.error(`  ${result.file}: expected ${result.count}, matched ${result.matches.length}`);
    }
    console.error("[sync-version] update the pattern/count in this script to match the new shape.");
    process.exit(1);
  }

  const drifted = results.filter((result) => result.drift);
  if (write) {
    for (const result of drifted) {
      apply(result, version);
      console.log(`[sync-version] ${result.file}: ${result.found.join(", ")} -> ${version}`);
    }
    console.log(
      drifted.length === 0
        ? `[sync-version] already at ${version}`
        : `[sync-version] wrote ${version} to ${drifted.length} file(s)`,
    );
    return;
  }

  if (drifted.length === 0) {
    console.log(`[sync-version] ok - every declaration is ${version}`);
    return;
  }
  console.error(`[sync-version] version drift (manifest.json is ${version}):`);
  for (const result of drifted) {
    console.error(`  ${result.file} (${result.describe}): found ${result.found.join(", ")}`);
  }
  console.error("[sync-version] run `node scripts/sync-version.mjs --write` to fix.");
  process.exit(1);
}

main();
