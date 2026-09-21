// End-to-end smoke test for the Go sidecar: builds the binary, spawns it, and
// drives the real stdio JSON-RPC protocol the same way the DBX host does —
// handshake, document create/save/get, and chunked asset upload/download.
//
// Usage: node scripts/sidecar-smoke.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(repoRoot, "backend");

function globalSdkRoot() {
  if (process.env.DBX_PLUGIN_SDK_ROOT) {
    return process.env.DBX_PLUGIN_SDK_ROOT;
  }
  // shell is required on Windows for .cmd shims (Node ≥18.20 spawn policy).
  const npmRoot = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).stdout.trim();
  return path.join(npmRoot, "@dbx-app", "plugin-cli", "sdk-root");
}

function buildBinary(outputPath) {
  // backend/go.mod replaces the SDK with the vendored copy, so a local build is
  // offline and needs no workspace file.
  spawnSync("go", ["build", "-o", outputPath, "."], { cwd: backendDir, stdio: "inherit" });
  if (!existsSync(outputPath)) {
    console.error("[smoke] backend build failed");
    process.exit(1);
  }
  warnOnSdkDrift();
}

// `dbx-plugin package` rewrites the replace directive to the SDK bundled with
// the installed CLI, so the vendored copy is what local tooling compiles against
// while the CLI's copy is what ships. Drift between them is silent otherwise.
function warnOnSdkDrift() {
  const installedSdk = path.join(globalSdkRoot(), "plugins", "sdk", "go", "dbx-plugin-sdk", "sdk.go");
  const vendoredSdk = path.join(backendDir, "third_party", "dbx-plugin-sdk", "sdk.go");
  if (!existsSync(installedSdk) || !existsSync(vendoredSdk)) {
    return;
  }
  // Compare with line endings normalised. There is no .gitattributes here, so a
  // Windows checkout can have the vendored file with CRLF while the CLI's copy
  // has LF, which would make a byte comparison warn on every run.
  const normalize = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (normalize(installedSdk) !== normalize(vendoredSdk)) {
    console.warn(
      `[smoke] warning: vendored SDK (backend/third_party/dbx-plugin-sdk) differs from ` +
        `the installed CLI SDK at ${installedSdk}. Local tests use the vendored copy while ` +
        `\`dbx-plugin package\` builds against the CLI's — re-vendor before releasing.`,
    );
  }
}

class SidecarClient {
  constructor(binary, dataDir) {
    this.child = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DBX_PLUGIN_DATA_DIR: dataDir },
    });
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[sidecar] ${chunk}`));
  }

  #onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 15_000);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.error) {
          reject(new Error(`${response.error.code}: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`smoke assertion failed: ${message}`);
  }
}

async function handshake(client, manifest) {
  console.log("[smoke] initialize handshake");
  const init = await client.request("plugin/initialize", {
    host: { protocolVersions: [1] },
    plugin: { id: manifest.id, version: manifest.version },
    permissions: [],
  });
  assert(init.protocolVersion === 1, "protocolVersion is 1");
  assert(
    init.plugin.id === manifest.id && init.plugin.version === manifest.version,
    `binary identity ${init.plugin.id}@${init.plugin.version} matches manifest ${manifest.id}@${manifest.version}`,
  );
}

/** Documents and the chunked asset bridge: create, save, and re-read. */
async function checkDocumentAndAssetBridge(client) {
  console.log("[smoke] document create");
  const created = await client.request("document/create", { name: "Smoke" });
  assert(created.id && created.name === "Smoke", "document created");

  console.log("[smoke] chunked asset upload (1.2 MiB image, 3 chunks)");
  const image = new Uint8Array(1_200_000);
  for (let index = 0; index < image.length; index += 1) {
    image[index] = index % 251;
  }
  const hash = createHash("sha256").update(image).digest("hex");
  const chunkSize = 512 * 1024;
  let complete = false;
  for (let offset = 0; offset < image.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, image.length);
    const result = await client.request("asset/putChunk", {
      documentId: created.id,
      hash,
      mimeType: "image/png",
      size: image.length,
      offset,
      dataBase64: Buffer.from(image.subarray(offset, end)).toString("base64"),
    });
    complete = result.complete;
  }
  assert(complete, "asset upload completed");

  console.log("[smoke] save scene referencing the asset");
  await client.request("document/saveScene", {
    id: created.id,
    scene: {
      type: "excalidraw",
      version: 2,
      elements: [{ id: "e1", type: "image", fileId: "img1" }],
      files: { img1: { id: "img1", mimeType: "image/png", created: 1, hash, size: image.length } },
    },
  });

  console.log("[smoke] re-read the document and the asset");
  const loaded = await client.request("document/get", { id: created.id });
  assert(loaded.corrupt === false, "scene parses");
  assert(loaded.scene.files.img1.hash === hash, "scene references the asset hash");
  // Same reassembly loop the frontend persistence adapter uses.
  const parts = [];
  let received = 0;
  while (received < image.length) {
    const chunk = await client.request("asset/getChunk", { hash, offset: received, length: chunkSize });
    const part = Buffer.from(chunk.dataBase64, "base64");
    assert(part.length > 0, "chunk returns bytes");
    parts.push(part);
    received += part.length;
  }
  const roundtrip = Buffer.concat(parts);
  assert(roundtrip.length === image.length, "asset size round-trips");
  assert(createHash("sha256").update(roundtrip).digest("hex") === hash, "asset bytes round-trip");

  console.log("[smoke] list documents");
  const listing = await client.request("document/list", {});
  assert(listing.items.length === 1 && listing.items[0].name === "Smoke", "listing shows the document");

  return { created, image };
}

async function main() {
  const outputDir = mkdtempSync(path.join(tmpdir(), "excalidraw-smoke-"));
  const dataDir = path.join(outputDir, "data");
  const binary = path.join(outputDir, "sidecar.exe");
  // The manifest is the authority on identity, so the handshake is compared
  // against it rather than against a third hardcoded copy of the version.
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  // Declared outside the try so the finally below can always shut the sidecar
  // down. Leaving it inside meant a failing assertion left the binary mapped,
  // and the cleanup then threw EPERM — which replaces the assertion message
  // with a misleading filesystem error at the moment it is most needed.
  let client = null;
  try {
    console.log("[smoke] building backend...");
    buildBinary(binary);
    client = new SidecarClient(binary, dataDir);

    await handshake(client, manifest);
    const { created, image } = await checkDocumentAndAssetBridge(client);
    const documentUri = await checkFilesystemProvider(client, created, image);
    await checkFilesystemMutations(client, documentUri);

    console.log("[smoke] OK — all protocol assertions passed");
  } finally {
    client?.close();
    // The sidecar may take a moment to release the binary on Windows.
    rmSync(outputDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/**
 * The filesystem provider: the host drives these six methods, so the wire
 * shapes (camelCase keys, kebab-case entry kinds) are asserted here rather
 * than only in the Go unit tests.
 */
async function checkFilesystemProvider(client, created, image) {
  const provider = "io.dbx.excalidraw.documents";
  console.log("[smoke] filesystem/list root");
  const root = await client.request("filesystem/list", { providerId: provider, uri: "excalidraw:/", limit: 50 });
  assert(
    root.entries.map((entry) => entry.name).join(",") === "documents,exports",
    "root lists the two directories",
  );
  assert(
    root.entries.every((entry) => entry.kind === "directory" && entry.uri.startsWith("excalidraw:/")),
    "root entries are directories with scheme-qualified uris",
  );

  console.log("[smoke] filesystem/list documents");
  const documents = await client.request("filesystem/list", { providerId: provider, uri: "excalidraw:/documents/", limit: 50 });
  assert(documents.entries.length === 1, "one document entry");
  assert(documents.entries[0].kind === "file", "document entry is a file");
  const documentUri = documents.entries[0].uri;

  console.log("[smoke] filesystem/read rehydrates the image dataURL");
  const read = await client.request("filesystem/read", { providerId: provider, uri: documentUri, maxBytes: 4 * 1024 * 1024 });
  assert(read.truncated === false, "read is not truncated");
  assert(typeof read.etag === "string" && read.etag.length === 64, "read returns a sha256 etag");
  const rehydrated = JSON.parse(Buffer.from(read.dataBase64, "base64").toString("utf8"));
  assert(rehydrated.files.img1.hash === undefined, "rehydrated scene drops the hash reference");
  assert(
    rehydrated.files.img1.dataURL === `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
    "rehydrated scene inlines the exact image bytes",
  );

  console.log("[smoke] filesystem/read rejects an oversized request");
  let oversizedRejected = false;
  try {
    await client.request("filesystem/read", { providerId: provider, uri: documentUri, maxBytes: 64 });
  } catch (error) {
    oversizedRejected = /TOO_LARGE/.test(error.message);
  }
  assert(oversizedRejected, "an over-budget read fails loudly instead of truncating");

  return documentUri;
}

/** The write, delete and rename paths, plus the guards around them. */
async function checkFilesystemMutations(client, documentUri) {
  const provider = "io.dbx.excalidraw.documents";

  console.log("[smoke] filesystem/write round-trips through the store");
  const rewritten = {
    type: "excalidraw",
    version: 2,
    elements: [],
    files: { img2: { id: "img2", mimeType: "image/png", dataURL: "data:image/png;base64,AQIDBA==" } },
  };
  const writeResult = await client.request("filesystem/write", {
    providerId: provider,
    uri: documentUri,
    dataBase64: Buffer.from(JSON.stringify(rewritten)).toString("base64"),
    create: false,
    overwrite: true,
  });
  assert(writeResult.success === true, "write reports success");
  const afterWrite = await client.request("filesystem/read", { providerId: provider, uri: documentUri, maxBytes: 4 * 1024 * 1024 });
  const roundTripped = JSON.parse(Buffer.from(afterWrite.dataBase64, "base64").toString("utf8"));
  assert(
    roundTripped.files.img2.dataURL === "data:image/png;base64,AQIDBA==",
    "filesystem write strips and rehydrates image dataURLs unchanged",
  );

  console.log("[smoke] filesystem guards");
  let staleRejected = false;
  try {
    await client.request("filesystem/write", {
      providerId: provider,
      uri: documentUri,
      dataBase64: Buffer.from(JSON.stringify(rewritten)).toString("base64"),
      create: false,
      overwrite: true,
      etag: "0".repeat(64),
    });
  } catch (error) {
    staleRejected = /DOCUMENT_SAVE_FAILED|CONFLICT/.test(error.message);
  }
  assert(staleRejected, "a stale etag is rejected");

  let providerRejected = false;
  try {
    await client.request("filesystem/list", { providerId: "io.dbx.other", uri: "excalidraw:/", limit: 10 });
  } catch (error) {
    providerRejected = /INVALID_REQUEST/.test(error.message);
  }
  assert(providerRejected, "an unknown provider id is rejected");

  console.log("[smoke] filesystem/rename and filesystem/delete");
  const renamed = await client.request("filesystem/rename", {
    providerId: provider,
    sourceUri: documentUri,
    targetUri: "excalidraw:/documents/Smoke Renamed.excalidraw",
    overwrite: false,
  });
  assert(renamed.entry.name === "Smoke Renamed.excalidraw", "rename returns the new display name");
  assert(renamed.entry.uri === documentUri, "rename keeps the uuid-addressed uri stable");

  await client.request("filesystem/delete", { providerId: provider, uri: documentUri, recursive: false });
  const emptied = await client.request("filesystem/list", { providerId: provider, uri: "excalidraw:/documents/", limit: 50 });
  assert(emptied.entries.length === 0, "delete empties the documents directory");
  const remaining = await client.request("document/list", {});
  assert(remaining.items.length === 0, "filesystem delete removes it from the document library too");
}

main().catch((error) => {
  console.error(`[smoke] FAILED: ${error.message}`);
  process.exit(1);
});
