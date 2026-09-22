// Structural gate for manifest.json.
//
// The host rejects an invalid manifest at install time, so shipping one turns
// into "the plugin silently does not appear in the plugin center". This checks
// the invariants that are easy to break while editing by hand and that no other
// script covers: identifier shape, per-contribution required fields, icon files
// that actually exist on disk, localization keys that still resolve to a
// declared contribution after a rename, and the permission set the store
// listing promises to users.
//
// It is deliberately dependency-free so CI can run it before `npm ci`.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const ASSET_PATH = /^(?![\\/])(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/).+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// Required fields per contribution type, mirroring plugins/manifest.schema.json.
const CONTRIBUTIONS = {
  "connection-provider": ["id", "database_type", "fields"],
  workbench: ["id", "label"],
  "filesystem-provider": ["id", "label", "schemes"],
  "context-menu": ["id", "label", "menu"],
  "result-view": ["id", "label"],
};

const FILESYSTEM_CAPABILITIES = ["read", "write", "delete", "rename", "mkdir"];
const PERMISSIONS = ["host.events", "host.binary", "host.workbench", "host.filesystem", "host.plans:read"];

const problems = [];

function fail(message) {
  problems.push(message);
}

/** Reports values that are duplicated where the schema requires uniqueItems. */
function checkUnique(values, where) {
  if (!Array.isArray(values)) {
    return;
  }
  const seen = new Set();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      fail(`${where}: ${key} appears more than once`);
    }
    seen.add(key);
  }
}

function checkAssetPath(value, where) {
  if (typeof value !== "string" || !ASSET_PATH.test(value)) {
    fail(`${where}: ${JSON.stringify(value)} is not a valid relative asset path`);
    return;
  }
  const absolute = path.join(repoRoot, value);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail(`${where}: referenced asset "${value}" does not exist`);
  }
}

function checkTopLevel(manifest) {
  if (manifest.manifest_version !== 1) {
    fail(`manifest_version must be 1, found ${JSON.stringify(manifest.manifest_version)}`);
  }
  if (typeof manifest.id !== "string" || !IDENTIFIER.test(manifest.id)) {
    fail(`id ${JSON.stringify(manifest.id)} must match ${IDENTIFIER}`);
  }
  if (typeof manifest.publisher !== "string" || manifest.publisher.length === 0) {
    fail("publisher must be a non-empty string");
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    fail("name must be a non-empty string");
  }
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version)) {
    fail(`version ${JSON.stringify(manifest.version)} is not semver`);
  }
  if (!manifest.engines || typeof manifest.engines.host_api !== "string" || !manifest.engines.host_api) {
    fail("engines.host_api is required");
  }
  if (manifest.icon !== undefined) {
    checkAssetPath(manifest.icon, "icon");
  }
  checkUnique(manifest.permissions ?? [], "permissions");
  for (const permission of manifest.permissions ?? []) {
    const known = PERMISSIONS.includes(permission) || /^host\.network:https:\/\/[A-Za-z0-9._-]+(?::\d+)?$/.test(permission);
    if (!known) {
      fail(`permissions: ${JSON.stringify(permission)} is not a recognized permission`);
    }
  }
}

/** Validates one contribution against the required fields for its type. */
function checkContribution(contribution, index, contributionIds) {
  const where = `contributions[${index}]`;
  if (!contribution || typeof contribution !== "object") {
    fail(`${where}: must be an object`);
    return;
  }
  // hasOwn, not a bare lookup: a type of "toString" would otherwise resolve on
  // Object.prototype and crash on `...required` instead of reporting the type.
  const required = Object.hasOwn(CONTRIBUTIONS, contribution.type) ? CONTRIBUTIONS[contribution.type] : null;
  if (!required) {
    fail(`${where}: unknown type ${JSON.stringify(contribution.type)}`);
    return;
  }
  for (const field of ["type", ...required]) {
    if (contribution[field] === undefined) {
      fail(`${where} (${contribution.type}): missing required field "${field}"`);
    }
  }
  if (typeof contribution.id === "string") {
    if (!IDENTIFIER.test(contribution.id)) {
      fail(`${where}: id ${JSON.stringify(contribution.id)} must match ${IDENTIFIER}`);
    }
    if (contributionIds.has(contribution.id)) {
      fail(`${where}: duplicate contribution id ${JSON.stringify(contribution.id)}`);
    }
    contributionIds.add(contribution.id);
  }
  if (contribution.icon !== undefined) {
    checkAssetPath(contribution.icon, `${where}.icon`);
  }
  if (contribution.type === "context-menu" && contribution.menu !== "connection") {
    fail(`${where}: menu must be "connection", found ${JSON.stringify(contribution.menu)}`);
  }
  if (contribution.type === "filesystem-provider") {
    checkFilesystemProvider(contribution, where);
  }
}

function checkFilesystemProvider(contribution, where) {
  const schemes = contribution.schemes;
  checkUnique(schemes ?? [], `${where}.schemes`);
  if (!Array.isArray(schemes) || schemes.length === 0) {
    fail(`${where}: schemes must be a non-empty array`);
  } else {
    for (const scheme of schemes) {
      if (typeof scheme !== "string" || !IDENTIFIER.test(scheme)) {
        fail(`${where}: scheme ${JSON.stringify(scheme)} must match ${IDENTIFIER}`);
      }
    }
  }
  if (typeof contribution.root_uri === "string") {
    const scheme = contribution.root_uri.split(":")[0];
    if (Array.isArray(schemes) && !schemes.includes(scheme)) {
      fail(`${where}: root_uri scheme "${scheme}" is not declared in schemes`);
    }
  }
  checkUnique(contribution.capabilities ?? [], `${where}.capabilities`);
  for (const capability of contribution.capabilities ?? []) {
    if (!FILESYSTEM_CAPABILITIES.includes(capability)) {
      fail(`${where}: capabilities contains unknown value ${JSON.stringify(capability)}`);
    }
  }
}

// A localization entry naming a contribution that no longer exists is dead
// weight that the host silently ignores; catch it on rename.
function checkLocalizations(manifest, contributionIds) {
  for (const [locale, entry] of Object.entries(manifest.localizations ?? {})) {
    if (!LOCALE.test(locale)) {
      fail(`localizations: "${locale}" is not a valid locale tag`);
    }
    for (const id of Object.keys(entry?.contributions ?? {})) {
      if (!contributionIds.has(id)) {
        fail(`localizations.${locale}.contributions: "${id}" does not match any declared contribution`);
      }
    }
  }
}

// The marketplace installer refuses a package whose manifest permissions are
// not exactly the set the catalog entry declares. The auto-sync path builds
// that catalog entry from `.dbx-store.json` alone — it takes only id,
// publisher and version from `release-candidates.json` — so a key missing here
// publishes a listing claiming the plugin requests nothing, and every install
// of that version then fails with "Marketplace package permissions ... do not
// match catalog permissions". The manual path (make-store-candidate.mjs) reads
// the manifest directly, which is why this only ever breaks on auto-sync.
function checkStoreListing(manifest) {
  const storePath = path.join(repoRoot, ".dbx-store.json");
  let store;
  try {
    store = JSON.parse(readFileSync(storePath, "utf8"));
  } catch (error) {
    fail(`.dbx-store.json could not be read: ${error.message}`);
    return;
  }

  const declared = manifest.permissions ?? [];
  const listed = store.permissions;
  if (!Array.isArray(listed)) {
    fail(
      `.dbx-store.json has no "permissions" array; the store listing is synced from this file, ` +
        `so it would claim the plugin requests nothing while manifest.json declares ${JSON.stringify(declared)}`,
    );
    return;
  }

  const missing = declared.filter((permission) => !listed.includes(permission));
  const extra = listed.filter((permission) => !declared.includes(permission));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `.dbx-store.json permissions must match manifest.json exactly: ` +
        `missing from the listing ${JSON.stringify(missing)}, not declared in the manifest ${JSON.stringify(extra)}`,
    );
    return;
  }
  return declared.length;
}

function main() {
  const raw = readFileSync(path.join(repoRoot, "manifest.json"), "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    console.error(`[check-manifest] manifest.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  checkTopLevel(manifest);

  const contributions = manifest.contributions ?? [];
  if (!Array.isArray(contributions) || contributions.length === 0) {
    fail("contributions must be a non-empty array");
  }
  const contributionIds = new Set();
  for (const [index, contribution] of contributions.entries()) {
    checkContribution(contribution, index, contributionIds);
  }
  checkLocalizations(manifest, contributionIds);
  const mirroredPermissions = checkStoreListing(manifest);

  if (problems.length > 0) {
    console.error(`[check-manifest] ${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
  console.log(
    `[check-manifest] ok - ${contributions.length} contribution(s), ${contributionIds.size} id(s), ` +
      `${Object.keys(manifest.localizations ?? {}).length} localization(s), ` +
      `${mirroredPermissions ?? 0} permission(s) mirrored to the store listing`,
  );
}

main();
