// One-command release automation for this plugin.
//
//   node scripts/release.mjs [--prerelease] [--notes "extra notes"]
//
// What it does:
//   1. Safety checks: clean worktree, on main, in sync with origin, SemVer
//      without build metadata (the store rejects "+" in versions).
//   2. Reads the version from manifest.json — the single source of truth —
//      and derives the tag v<version> (fails if the tag already exists).
//   3. Creates the GitHub Release via the API using the credentials the
//      git CLI already has (git credential helper; no extra secret needed).
//   4. The published release triggers .github/workflows/plugin-release.yml,
//      which builds the frontend and one unsigned .dbxp candidate per
//      platform, then uploads them together with release-candidates.json.
//
// After it finishes, watch the Actions tab; assets appear on the release
// once every platform job succeeds.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROXY_FALLBACK = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";

function git(args, options = {}) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", ...options }).stdout.trim();
}

function gitRequire(args, label) {
  const output = git(args);
  if (!output && label) {
    console.error(`[release] git ${label} produced no output`);
    process.exit(1);
  }
  return output;
}

function githubToken() {
  const raw = spawnSync("git", ["credential", "fill"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\n\n",
  }).stdout;
  const match = raw.match(/^password=(.+)$/m);
  if (!match) {
    console.error("[release] no stored GitHub credential found (git credential helper)");
    process.exit(1);
  }
  return match[1];
}

function ghApi(method, apiPath, body, token) {
  const payload = body ? JSON.stringify(body) : "";
  const attempts = ["", PROXY_FALLBACK];
  let lastError = "";
  for (const proxy of attempts) {
    const args = ["-sS", "-X", method, "-H", `Authorization: Bearer ${token}`, "-H", "Accept: application/vnd.github+json"];
    if (payload) {
      args.push("-H", "Content-Type: application/json", "-d", payload);
    }
    if (proxy) {
      args.push("-x", proxy);
    }
    args.push(`https://api.github.com${apiPath}`);
    const result = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (result.status === 0 && result.stdout.trim()) {
      return JSON.parse(result.stdout);
    }
    lastError = (result.stderr || `curl exit ${result.status}`).trim();
  }
  console.error(`[release] GitHub API call failed: ${lastError}`);
  process.exit(1);
}

/** Runs a gate script and aborts the release when it fails. */
function requireScript(name, failureMessage) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", name)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`[release] ${failureMessage}`);
    process.exit(1);
  }
}

/**
 * Everything that must hold before a tag is created: a clean, synced main whose
 * manifest and version declarations agree. Exits on the first failure.
 */
function preflight() {
  // 1. Repository safety checks.
  if (git(["status", "--porcelain"])) {
    console.error("[release] worktree is dirty; commit or stash first");
    process.exit(1);
  }
  // The host kills the sidecar when the version it reports in the handshake
  // disagrees with the manifest, so a drifted tree must not be released.
  requireScript("sync-version.mjs", "version declarations disagree; run `node scripts/sync-version.mjs --write` and commit");
  requireScript("check-manifest.mjs", "manifest.json did not pass its structural checks");

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    console.error(`[release] current branch is ${branch}; releases are cut from main`);
    process.exit(1);
  }
  git(["fetch", "origin", "main"]);
  const ahead = git(["rev-list", "--count", "origin/main..HEAD"]);
  const behind = git(["rev-list", "--count", "HEAD..origin/main"]);
  if (ahead !== "0" || behind !== "0") {
    console.error(`[release] main is not in sync with origin (ahead ${ahead}, behind ${behind}); push or pull first`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const prerelease = args.includes("--prerelease");
  const extraNotesIndex = args.indexOf("--notes");
  const extraNotes = extraNotesIndex >= 0 ? args[extraNotesIndex + 1] : "";

  preflight();

  // 2. Version from manifest.json — the store validates against it.
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`[release] manifest version "${version}" is not SemVer without build metadata (+ is rejected by the store)`);
    process.exit(1);
  }
  const tag = `v${version}`;

  const localTag = git(["tag", "-l", tag]);
  const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (localTag || remoteTag) {
    console.error(`[release] tag ${tag} already exists (locally: ${Boolean(localTag)}, remotely: ${Boolean(remoteTag)}). Published bytes are immutable — bump manifest version instead.`);
    process.exit(1);
  }

  const store = JSON.parse(readFileSync(path.join(repoRoot, ".dbx-store.json"), "utf8"));
  const token = githubToken();

  // 3. Release notes: store releaseNotes + commits since the previous tag.
  const previousTag = git(["describe", "--tags", "--abbrev=0", `${tag}^`], { stdio: undefined }) || "";
  const logRange = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const commits = git(["log", "--no-merges", "--pretty=format:- %s", logRange])
    .split("\n")
    .filter((line) => line && !line.startsWith("- Merge"));
  const body = [
    store.releaseNotes || "",
    previousTag ? `### Changes since ${previousTag}` : "### Commits",
    ...commits,
    extraNotes ? `\n${extraNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log(`[release] creating ${prerelease ? "prerelease" : "release"} ${tag} for ${manifest.id}@${version}...`);
  const response = ghApi(
    "POST",
    `/repos/Abeautifulsnow/${path.basename(repoRoot)}/releases`,
    { tag_name: tag, target_commitish: "main", name: `${store.name || manifest.name} ${version}`, prerelease, body },
    token,
  );
  if (!response.html_url) {
    console.error(`[release] GitHub rejected the release: ${response.message ?? JSON.stringify(response).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[release] published: ${response.html_url}`);
  console.log("[release] CI is now building per-platform candidates; watch the Actions tab.");
  console.log("[release] when it finishes, the .dbxp assets and release-candidates.json appear on the release page.");
}

main();
