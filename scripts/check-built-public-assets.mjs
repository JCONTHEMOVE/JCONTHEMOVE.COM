import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const root = resolve(process.argv[2] || "dist/public");
const readAsset = (url) => {
  assert.ok(url.startsWith("/") && !url.startsWith("//"), `Expected local asset: ${url}`);
  const file = resolve(root, `.${url}`);
  assert.ok(file.startsWith(root + sep), `Asset escapes public directory: ${url}`);
  return readFileSync(file);
};

const manifest = JSON.parse(readAsset("/manifest.json").toString("utf8"));
assert.equal(manifest.name, "JC ON THE MOVE");
assert.ok(manifest.icons?.length > 0, "Manifest must declare icons");
for (const icon of manifest.icons) {
  const bytes = readAsset(icon.src);
  assert.equal(icon.type, "image/png");
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Invalid PNG: ${icon.src}`);
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes, `Wrong dimensions: ${icon.src}`);
}
const favicon = readAsset("/favicon.ico");
assert.ok(favicon.subarray(0, 6).equals(Buffer.from([0, 0, 1, 0, 1, 0])), "Favicon must be a single-image ICO, not mislabeled SVG/HTML");
assert.equal(favicon.readUInt32LE(14) + favicon.readUInt32LE(18), favicon.length, "Invalid favicon directory");
assert.match(readAsset("/offline.html").toString("utf8"), /<title>JC ON THE MOVE - Offline<\/title>/);
assert.match(readAsset("/sw.js").toString("utf8"), /addEventListener\(['"]push['"]/);
console.log(`Built PWA assets verified: manifest, ${manifest.icons.length} PNG icons, favicon, offline page, and push service worker.`);
