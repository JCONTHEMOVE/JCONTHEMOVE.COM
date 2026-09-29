import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

if (process.platform === "linux") {
  const family = execFileSync("fc-match", ["--format=%{family}", "DejaVu Sans:style=Bold"], { encoding: "utf8" });
  assert.match(family, /DejaVu Sans/, "Production must resolve the installed marketing font");
}

// Check actual SVG pixels, not just installed packages or image dimensions.
const glyphs = [];
for (const letter of ["I", "M", "W"]) {
  const { data, info } = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="5" y="75" font-family="DejaVu Sans" font-weight="700" font-size="64" fill="white">${letter}</text></svg>`,
  )).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] > 128) visiblePixels += 1;
  }
  assert.ok(visiblePixels > 300, `Marketing font rendered ${letter} too small or blank (${visiblePixels} pixels)`);
  glyphs.push(data);
}
assert.ok(!glyphs[0].equals(glyphs[1]) && !glyphs[1].equals(glyphs[2]), "Marketing font rendered identical missing-glyph boxes");
console.log("Marketing SVG fonts render readable, distinct glyphs");
