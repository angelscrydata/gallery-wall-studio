# Gallery Wall Studio

A browser-based tool for planning a gallery wall to scale. Calibrate a photograph of a room using an object of known length, add framed artwork with its real dimensions, and arrange the frames directly on the wall image.

## Requirements

- A recent version of Node.js
- A modern desktop browser
- A straight-on photograph of the wall containing an object with a known length
- PNG, WebP, JPEG, HEIC, or HEIF images of the framed artwork

## Run locally

From the repository root, install the HEIC converter and start the local server:

```bash
npm install
npm run dev
```

Open <http://localhost:4173>.

To use another port:

```bash
PORT=3000 npm run dev
```

## How to use it

1. **Upload a wall photo.** Include a ruler, measuring tape, or another object whose real length you know.
2. **Calibrate the scale.** Draw a line over the known object, enter its length, select centimetres or inches, and apply the scale. Reapplying the scale updates every placed frame together.
3. **Add framed artwork.** Upload PNG, WebP, JPEG, HEIC, or HEIF images and enter each frame's outside width and height using the selected unit.
4. **Prepare a frame.** Double-click a frame in the right rail to move its four crop corners independently, straighten the selected area into a rectangle, fine-tune its angle, or rotate it 90°. Cropping is non-destructive, so reopening the editor lets you expand the crop again or reset to the original upload. The rail previews preserve the frames' relative physical sizes.
5. **Arrange the wall.** Drag frames from the right rail onto the wall. Drag a placed frame to move it, use the arrow keys for precise positioning, or press Delete to remove it. Use **Show distances** to label gaps between directly neighboring frames. Zoom from 50% to 500%; at higher zoom, drag the wall to pan while measurement text stays the same on-screen size.
6. **Export the layout.** Select **Save image** to download the completed wall plan as a PNG.

## Saved walls

Wall projects are saved automatically to `.gallery-wall-data/projects.json` in the local repository. The **Previous walls** tab lets you reopen projects or use the thumbnail’s ••• menu to rename and delete them. Frames can be removed from the right rail with their × button; this also removes their placed copies.

The data directory is intentionally gitignored because it contains the uploaded photos. Saved walls are available from any browser or port running this repository. Existing browser-only projects are copied into the repo-backed store when that browser and origin opens **Previous walls**.

## Privacy

Photos and layouts remain on your computer. The local development server writes projects only to `.gallery-wall-data/`; it does not upload images or project data anywhere.

## Project structure

```text
dist/
  index.html    Application markup
  styles.css    Layout and visual styles
  app.js        Calibration, editing, persistence, and export logic
scripts/
  dev.mjs       Local development server and project storage API
package.json    npm scripts
.gallery-wall-data/  Local saved walls (created automatically, gitignored)
```
