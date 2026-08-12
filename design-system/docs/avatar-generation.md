# Avatar generation recipe

The Avatar's icon is derived from the owner's real photo (`knowledge/pic.jpg`). It is produced
programmatically so any site owner gets a matching set from their own photo. Three files are
produced into `assets/`:

- `avatar-human.png` — square crop of the real photo (the **human** icon).
- `avatar-robot.png` — the twin, square, framed slightly wider (hero / showcase use).
- `avatar-robot-round.png` — the twin, cropped tightest for circular chat avatars.

**All three are natural colour**; they differ only in framing. The twin and the human are
distinguished by their rings — see "Twin treatment" below.

## Generating them

```
node scripts/generate-avatars.mjs            # reads knowledge/pic.jpg
node scripts/generate-avatars.mjs other.jpg  # or any other source
```

The script renders in Playwright's bundled Chromium, so there is no image library to install.
It writes all three files into `frontend/public/assets/` at 180×180 — retina-safe for the largest
(72px) rendered avatar, and small enough that the images don't pop in after the surrounding UI.

**Point it at a new face** by editing two constants at the top:

- `FACE` — the eye line and the horizontal centre of the face, as *fractions* of the source image
  (so they survive any resize). Open the photo, note where the eyes sit top-down and where the face
  centres left-right.
- `VARIANTS` — per-file framing: `side` is the crop width as a fraction of the source width (smaller
  = tighter), `eyeFrac` where the eye line lands in the output.

Then check the result at real size (40–72px), not zoomed: an avatar that looks mushy at 400% can be
perfectly legible in the chat.

## Crop
Square, centred on the face, with the eyes at ≈44% from the top. Downscaling is done by repeated
halving — a single >13× `drawImage` step aliases badly.

## Twin treatment (none — natural colour)
**All three images keep the photo's natural colour.** They differ only in framing: the twin crops
slightly wider, the round variant tightest (a circular mask cuts the corners away).

This is the third iteration and the settled one. Earlier revisions rendered the twin as a cyan HUD
portrait (scanlines, paneling seams, glowing eyes, corner brackets), then as a restrained blue
duotone. Both read as *a photo with a filter on it* rather than as a digital twin, and the blue
version sat awkwardly against the owner's real photo a few lines above it in the same thread.

**The twin and the human are separated by their rings, not their colour** — and that separation is
stronger than a tint ever was, because it survives at 28px:

- `.avatar-twin` — 1.5px blue ring, soft blue halo. Quieter.
- `.avatar-human` — 2px yellow ring, yellow halo, **plus a spark badge**. The loudest avatar on
  the page, which is the point: yellow is reserved for the human-in-the-loop.

Each bubble is also name-labelled and tinted (cool for the twin, warm for the human), so the role
is carried three ways over.

## Usage
- Human messages & admin owner chip → `avatar-human.png` in `.avatar-human` (yellow ring + spark badge).
- Avatar messages → `avatar-robot-round.png` in `.avatar-twin` (blue ring).
- Hero / identity showcase → `avatar-robot.png` (framed square).
