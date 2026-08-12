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
 * The twin treatment is a restrained blue duotone: luminance mapped through a
 * deep-navy -> link-blue -> near-white ramp, lightly posterised so it reads as
 * a rendering rather than a photograph. No scanlines, HUD brackets or glowing
 * eyes -- those belonged to the dark sci-fi theme this app no longer uses.
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
 * in the output, top-down.
 */
const VARIANTS = [
  { file: 'avatar-human.png', side: 0.81, eyeFrac: 0.44, twin: false },
  { file: 'avatar-robot.png', side: 0.86, eyeFrac: 0.46, twin: true, vignette: 0.3 },
  { file: 'avatar-robot-round.png', side: 0.78, eyeFrac: 0.43, twin: true, vignette: 0.75 },
];

/** Duotone ramp: shadows deep navy, midtones the site's link blue, highlights near-white. */
const RAMP = [
  [0.0, [10, 28, 56]],
  [0.25, [30, 69, 133]],
  [0.5, [69, 130, 236]],
  [0.75, [157, 192, 245]],
  [1.0, [244, 248, 254]],
];

const BANDS = 22; // posterisation steps -- fewer than this and skin tones blotch
const BLUR = 3; // box-blur radius applied to luminance before quantising

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const dataUrl = `data:image/jpeg;base64,${(await readFile(SRC)).toString('base64')}`;

for (const v of VARIANTS) {
  const png = await page.evaluate(
    async ({ dataUrl, v, face, size, ramp, bands, blur }) => {
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

      if (v.twin) {
        const id = ctx.getImageData(0, 0, size, size);
        const d = id.data;

        // Luminance, softened with a box blur so JPEG speckle and skin texture
        // don't fracture the posterised bands into blotches.
        const lum = new Float32Array(size * size);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
        const soft = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            let sum = 0, n = 0;
            for (let dy = -blur; dy <= blur; dy++) {
              for (let dx = -blur; dx <= blur; dx++) {
                const yy = y + dy, xx = x + dx;
                if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
                sum += lum[yy * size + xx];
                n++;
              }
            }
            soft[y * size + x] = sum / n;
          }
        }

        const sample = (t) => {
          for (let i = 1; i < ramp.length; i++) {
            if (t <= ramp[i][0]) {
              const [t0, c0] = ramp[i - 1], [t1, c1] = ramp[i];
              const f = (t - t0) / (t1 - t0);
              return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * f);
            }
          }
          return ramp[ramp.length - 1][1];
        };

        const c = (size - 1) / 2;
        const maxR = Math.hypot(c, c);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const p = y * size + x;
            // Mild contrast lift keeps the face from flattening into one band.
            let t = Math.min(1, Math.max(0, (soft[p] - 0.5) * 1.18 + 0.5));
            t = Math.round(t * (bands - 1)) / (bands - 1);
            let [r, g, b] = sample(t);

            // Vignette toward the deep shadow so the busy real-world backdrop
            // recedes and the face carries the icon at 40px.
            if (v.vignette) {
              const rr = Math.hypot(x - c, y - c) / maxR;
              const fade = Math.min(1, Math.max(0, (rr - v.vignette) / (1 - v.vignette)));
              const k = fade * fade * 0.85;
              const [sr, sg, sb] = ramp[0][1];
              r += (sr - r) * k; g += (sg - g) * k; b += (sb - b) * k;
            }
            const i = p * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b;
          }
        }
        ctx.putImageData(id, 0, 0);
      }

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { dataUrl, v, face: FACE, size: SIZE, ramp: RAMP, bands: BANDS, blur: BLUR }
  );

  const path = resolve(OUT_DIR, v.file);
  await writeFile(path, Buffer.from(png, 'base64'));
  console.log(`${v.file}  ${(Buffer.from(png, 'base64').length / 1024).toFixed(1)} KB`);
}

await browser.close();
