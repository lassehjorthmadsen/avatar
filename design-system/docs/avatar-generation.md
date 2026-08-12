# Avatar generation recipe

The Avatar's icon is the owner's real photo (`knowledge/pic.jpg`) rebuilt as a **synthetic digital
twin**. It is produced programmatically so any site owner gets a matching twin from their own photo.
Three files are produced into `assets/`:

- `avatar-human.png` — natural square crop of the real photo (the **human** icon).
- `avatar-robot.png` — the twin, square, with a HUD frame (hero / showcase use).
- `avatar-robot-round.png` — the twin tuned for circular chat avatars (inner ring, vignette,
  no corner brackets).

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

## Twin treatment (restrained blue duotone)
1. **Duotone** the cropped face through a deep-navy → link-blue → near-white ramp
   (`#0a1c38 → #1e4585 → #4582ec → #9dc0f5 → #f4f8fe`). The midtone is the host site's own link
   blue, which is what ties the twin to the page.
2. **Smooth then posterise** luminance — box-blur radius 3 to kill JPEG speckle and skin texture,
   then quantise to ~22 bands. Blur too little or band too coarsely and the face breaks into
   blotches rather than deliberate contours.
3. **Vignette** toward the deep shadow so a busy real-world backdrop recedes and the face carries
   the icon at 40px. The round variant vignettes hard (0.75), the square one gently (0.3).

Earlier revisions of this system also called for scanlines, paneling seams, glowing eyes and HUD
corner brackets. Those belonged to the dark sci-fi theme; the current light theme drops them.

Tune ramp and levels to taste, but keep the result **recognisably the person**, clearly
**synthetic**, and **blue** to read as the twin against the full-colour human photo.

## Usage
- Human messages & admin owner chip → `avatar-human.png` in `.avatar-human` (yellow ring).
- Avatar messages → `avatar-robot-round.png` in `.avatar-twin` (cyan ring).
- Hero / identity showcase → `avatar-robot.png` (framed square).
