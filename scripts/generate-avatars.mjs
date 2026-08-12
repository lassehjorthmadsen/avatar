#!/usr/bin/env node
/**
 * Generate the three avatar images from the owner's photo.
 *
 *   node scripts/generate-avatars.mjs [source.jpg]
 *
 * Produces into frontend/public/assets/:
 *   avatar-human.png       natural square crop  (the human icon)
 *   avatar-robot.png       the twin, square     (hero / showcase)
 *   avatar-robot-round.png the twin, tuned for circular chat avatars
 *
 * All three keep the photo's natural colour. Earlier versions tinted the twin
 * (first a cyan HUD treatment, then a blue duotone); both read as a filter
 * rather than a digital twin, so the colour separation was dropped. The twin
 * and the human are told apart by their rings, not their tint -- .avatar-twin
 * carries a blue ring, .avatar-human a yellow ring plus a spark badge (see
 * components.css). The variants differ only in framing.
 *
 * Rendering runs in Playwright's bundled Chromium, so there is no image
 * library to install: the pipeline is plain <canvas>, same as the recipe in
 * design-system/docs/avatar-generation.md.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, process.argv[2] ?? 'knowledge/pic.jpg');
const OUT_DIR = resolve(ROOT, 'frontend/public/assets');
const SIZE = 180; // retina-safe for the largest (72px) rendered avatar

/**
 * Face landmarks, as fractions of the source image so they survive any resize.
 * Re-measure for a new photo: `eyeY` is the eye line down from the top,
 * `centreX` the horizontal centre of the face.
 */
const FACE = { eyeY: 0.285, centreX: 0.48 };

/**
 * Per-variant framing. `side` is the crop width as a fraction of the source
 * width (smaller = tighter on the face); `eyeFrac` is where the eye line lands
 * in the output, top-down. The round variant crops tightest, since a circular
 * mask cuts the corners away.
 */
const VARIANTS = [
  { file: 'avatar-human.png', side: 0.81, eyeFrac: 0.44 },
  { file: 'avatar-robot.png', side: 0.86, eyeFrac: 0.46 },
  { file: 'avatar-robot-round.png', side: 0.78, eyeFrac: 0.43 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const dataUrl = `data:image/jpeg;base64,${(await readFile(SRC)).toString('base64')}`;

for (const v of VARIANTS) {
  const png = await page.evaluate(
    async ({ dataUrl, v, face, size }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      // --- Crop square on the face, clamped to the source bounds -------------
      const side = Math.round(Math.min(v.side * img.width, img.width, img.height));
      const clamp = (n, max) => Math.max(0, Math.min(n, max - side));
      const sx = clamp(Math.round(face.centreX * img.width - side / 2), img.width);
      const sy = clamp(Math.round(face.eyeY * img.height - v.eyeFrac * side), img.height);

      // Downscale by repeated halving: a single >13x drawImage step aliases badly.
      let cur = document.createElement('canvas');
      cur.width = cur.height = side;
      cur.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, side, side);
      while (cur.width > size * 2) {
        const half = document.createElement('canvas');
        half.width = half.height = Math.max(size, Math.round(cur.width / 2));
        const hx = half.getContext('2d');
        hx.imageSmoothingQuality = 'high';
        hx.drawImage(cur, 0, 0, half.width, half.height);
        cur = half;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, size, size);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { dataUrl, v, face: FACE, size: SIZE }
  );

  const path = resolve(OUT_DIR, v.file);
  await writeFile(path, Buffer.from(png, 'base64'));
  console.log(`${v.file}  ${(Buffer.from(png, 'base64').length / 1024).toFixed(1)} KB`);
}

await browser.close();
