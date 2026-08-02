import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function read(relativePath, encoding = null) {
  return readFile(new URL(relativePath, root), encoding || undefined);
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test("PWA 清单提供稳定身份、独立窗口和 Chrome 所需图标", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest", "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);
  const icon192 = manifest.icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
  const icon512 = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
  const maskable = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "maskable");
  assert.ok(icon192 && icon512 && maskable);
  assert.deepEqual(pngDimensions(await read(icon192.src.slice(1))), [192, 192]);
  assert.deepEqual(pngDimensions(await read(icon512.src.slice(1))), [512, 512]);
  assert.deepEqual(pngDimensions(await read(maskable.src.slice(1))), [512, 512]);
});

test("Service Worker 只在 HTTPS 或本机安全来源注册并缓存安装资源", async () => {
  const appSource = await read("src/app.js", "utf8");
  const workerSource = await read("sw.js", "utf8");
  assert.match(appSource, /location\.protocol === "https:"/);
  assert.match(appSource, /\["localhost", "127\.0\.0\.1"\]/);
  assert.match(workerSource, /public\/icon-192\.png/);
  assert.match(workerSource, /public\/icon-512\.png/);
  assert.match(workerSource, /public\/icon-maskable-512\.png/);
});
