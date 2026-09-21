// Generates the files required for a DBX Store submission PR:
//
//   dist/store/publishers/<publisher>.json   (first submission only)
//   dist/store/candidates/<plugin-id>.json   (one per version)
//
// Usage: node scripts/make-store-candidate.mjs <tag>   e.g. v0.2.0
//
// The candidate's `targets` (sha256/size/URL) come from the
// `release-candidates.json` asset that the packaging CI attached to the
// given release, so the hashes always match the published bytes. Display
// fields come from .dbx-store.json / manifest.json. Only the two JSON files
// belong in the PR — never the .dbxp binaries themselves.
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROXY_FALLBACK = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";

function originRepo() {
  const url = execSync("git remote get-url origin", { cwd: repoRoot, encoding: "utf8" }).trim();
  const match = url.match(/github\.com[/:](.+?)(?:\.git)?$/);
  if (!match) {
    console.error(`[store-candidate] cannot parse origin url: ${url}`);
    process.exit(1);
  }
  return match[1];
}

function fetchText(url) {
  for (const proxy of ["", PROXY_FALLBACK]) {
    const args = ["-sS", "-L", url];
    if (proxy) {
      args.push("-x", proxy);
    }
    const result = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (result.status === 0 && result.stdout.trim().startsWith("{")) {
      return result.stdout;
    }
  }
  console.error(`[store-candidate] failed to fetch ${url}`);
  process.exit(1);
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: node scripts/make-store-candidate.mjs <tag>");
    process.exit(1);
  }
  const [owner, repo] = originRepo().split("/");
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const store = JSON.parse(readFileSync(path.join(repoRoot, ".dbx-store.json"), "utf8"));

  // Sanity: the tag must carry exactly the manifest version being submitted.
  if (!tag.endsWith(manifest.version)) {
    console.error(`[store-candidate] tag ${tag} does not match manifest version ${manifest.version}`);
    process.exit(1);
  }

  const releaseCandidates = JSON.parse(
    fetchText(`https://github.com/${owner}/${repo}/releases/download/${tag}/release-candidates.json`),
  );

  const candidate = {
    schemaVersion: 1,
    id: manifest.id,
    publisher: manifest.publisher,
    version: manifest.version,
    releaseNotes: store.releaseNotes,
    name: store.name,
    description: store.description,
    icon: `https://raw.githubusercontent.com/${owner}/${repo}/${tag}/${store.icon}`,
    tags: store.tags,
    source: `https://github.com/${owner}/${repo}`,
    homepage: store.homepage,
    license: store.license,
    localizations: store.localizations,
    // Mirrored from the manifest so the store listing discloses the same
    // permissions the host will show at install time. Omitting this made the
    // catalog claim the plugin requests nothing while the manifest asked for
    // filesystem access.
    permissions: manifest.permissions ?? [],
    targets: releaseCandidates.artifacts.map((artifact) => ({
      target: artifact.target,
      url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${artifact.url}`,
      sha256: artifact.sha256,
      size: artifact.size,
    })),
  };

  const publisher = { id: manifest.publisher, name: manifest.publisher, status: "unverified" };

  const outputDir = path.join(repoRoot, "dist", "store");
  const candidateDir = path.join(outputDir, "candidates");
  const publisherDir = path.join(outputDir, "publishers");
  mkdirSync(candidateDir, { recursive: true });
  mkdirSync(publisherDir, { recursive: true });
  const candidatePath = path.join(candidateDir, `${manifest.id}.json`);
  const publisherPath = path.join(publisherDir, `${manifest.publisher}.json`);
  writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  writeFileSync(publisherPath, `${JSON.stringify(publisher, null, 2)}\n`);

  console.log(`[store-candidate] wrote ${path.relative(repoRoot, candidatePath)}`);
  console.log(`[store-candidate] wrote ${path.relative(repoRoot, publisherPath)} (first submission only)`);
  console.log(`[store-candidate] ${candidate.targets.length} targets @ ${tag}: ${candidate.targets.map((t) => t.target).join(", ")}`);
}

main();
