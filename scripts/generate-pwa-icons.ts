import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * Regenerate PWA / home-screen icons from the locked Hybrid A square master.
 * Source of truth: brand/jc-homescreen-icon-locked-a-square-1024.png
 * (derived from brand/jc-homescreen-icon-locked-a.jpg via center crop)
 */
const sizes = [32, 48, 72, 96, 128, 144, 152, 180, 192, 384, 512];
const iconsDir = path.join(process.cwd(), 'public', 'icons');
const clientIconsDir = path.join(process.cwd(), 'client', 'public', 'icons');
const masterPath = path.join(
  process.cwd(),
  'brand',
  'jc-homescreen-icon-locked-a-square-1024.png',
);
// Charcoal sampled from Hybrid A canvas corners
const CHARCOAL = { r: 32, g: 32, b: 32, alpha: 1 };

async function writeIconSet(targetDir: string, masterBuffer: Buffer) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const size of sizes) {
    await sharp(masterBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(targetDir, `icon-${size}x${size}.png`));
    console.log(`✓ Generated ${path.basename(targetDir)}/icon-${size}x${size}.png`);

    // Maskable: 80% mark + charcoal safe zone (skip apple-only 180)
    if (size !== 180 && size !== 32 && size !== 48) {
      const paddedSize = Math.round(size * 0.8);
      const padding = Math.round((size - paddedSize) / 2);

      await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: CHARCOAL,
        },
      })
        .composite([
          {
            input: await sharp(masterBuffer).resize(paddedSize, paddedSize).png().toBuffer(),
            top: padding,
            left: padding,
          },
        ])
        .png()
        .toFile(path.join(targetDir, `icon-${size}x${size}-maskable.png`));

      console.log(`✓ Generated ${path.basename(targetDir)}/icon-${size}x${size}-maskable.png`);
    }
  }

  for (const size of [192, 512] as const) {
    fs.writeFileSync(
      path.join(targetDir, `icon-${size}x${size}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n` +
        `  <image href="icon-${size}x${size}.png" width="${size}" height="${size}" />\n` +
        `</svg>\n`,
    );
  }
}

async function writeFavicons(masterBuffer: Buffer) {
  const png32 = await sharp(masterBuffer).resize(32, 32).png().toBuffer();
  const png48 = await sharp(masterBuffer).resize(48, 48).png().toBuffer();
  // sharp doesn't write .ico; keep PNG fallbacks. favicon.ico is produced by
  // scripts/generate-hybrid-a-icons.py (Pillow) alongside this script.
  for (const root of [
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'client', 'public'),
  ]) {
    fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'icons', 'icon-32x32.png'), png32);
    fs.writeFileSync(path.join(root, 'icons', 'icon-48x48.png'), png48);
  }
  console.log('✓ PNG favicon fallbacks written (32/48)');
}

async function generateIcons() {
  console.log('Generating Hybrid A PWA icons...');
  if (!fs.existsSync(masterPath)) {
    throw new Error(`Missing Hybrid A master: ${masterPath}`);
  }
  const masterBuffer = fs.readFileSync(masterPath);

  await writeIconSet(iconsDir, masterBuffer);
  await writeIconSet(clientIconsDir, masterBuffer);
  await writeFavicons(masterBuffer);

  console.log('\n✨ All Hybrid A icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
