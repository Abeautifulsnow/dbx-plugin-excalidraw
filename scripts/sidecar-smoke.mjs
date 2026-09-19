// End-to-end smoke test for the Go sidecar: builds the binary, spawns it, and
// drives the real stdio JSON-RPC protocol the same way the DBX host does —
// handshake, document create/save/get, and chunked asset upload/download.
//
// Usage: node scripts/sidecar-smoke.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const sdkModule = path
    .join(globalSdkRoot(), "plugins", "sdk", "go", "dbx-plugin-sdk")
    .split(path.sep)
    .join("/");
  if (!existsSync(path.join(sdkModule, "go.mod"))) {
    console.error(`[smoke] Go SDK sources not found at ${sdkModule}`);
    process.exit(1);
  }
  const goWorkPath = path.join(repoRoot, "go.work");
  writeFileSync(goWorkPath, `go 1.22\n\nuse ./backend\nuse ${sdkModule}\n`);
  try {
    spawnSync("go", ["build", "-o", outputPath, "."], { cwd: backendDir, stdio: "inherit" });
  } finally {
    rmSync(goWorkPath, { force: true });
    rmSync(path.join(repoRoot, "go.work.sum"), { force: true });
  }
  if (!existsSync(outputPath)) {
    console.error("[smoke] backend build failed");
    process.exit(1);
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

async function main() {
  const outputDir = mkdtempSync(path.join(tmpdir(), "excalidraw-smoke-"));
  const dataDir = path.join(outputDir, "data");
  const binary = path.join(outputDir, "sidecar.exe");
  try {
    console.log("[smoke] building backend...");
    buildBinary(binary);

    const client = new SidecarClient(binary, dataDir);
    console.log("[smoke] initialize handshake");
    const init = await client.request("plugin/initialize", {
      host: { protocolVersions: [1] },
      plugin: { id: "io.dbx.excalidraw", version: "0.2.0" },
      permissions: [],
    });
    assert(init.protocolVersion === 1, "protocolVersion is 1");
    assert(init.plugin.id === "io.dbx.excalidraw" && init.plugin.version === "0.2.0", "identity matches manifest");

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

    client.close();
    console.log("[smoke] OK — all protocol assertions passed");
  } finally {
    // The sidecar may take a moment to release the binary on Windows.
    rmSync(outputDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// Placeholder guard: previously this file had an unfinished draft body.
void readFileSync;
main().catch((error) => {
  console.error(`[smoke] FAILED: ${error.message}`);
  process.exit(1);
});
