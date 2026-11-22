# Gallery Wall Studio

A browser-based tool for planning a gallery wall to scale. Calibrate a photograph of a room using an object of known length, add framed artwork with its real dimensions, and arrange the frames directly on the wall image.

## Requirements

- A recent version of Node.js
- A modern desktop browser
- A straight-on photograph of the wall containing an object with a known length
- Transparent PNG or WebP images of the framed artwork

## Run locally

The project has no third-party dependencies. From the repository root, run:

```bash
npm run dev
```

Open <http://localhost:4173>.

To use another port:

```bash
PORT=3000 npm run dev
```

## How to use it

1. **Upload a wall photo.** Include a ruler, measuring tape, or another object whose real length you know.
2. **Calibrate the scale.** Draw a line over the known object, enter its length, select centimetres or inches, and apply the scale.
3. **Add framed artwork.** Upload transparent PNG or WebP images and enter each frame's outside width and height using the selected unit.
4. **Prepare a frame.** Double-click a frame in the right rail to open the crop and straighten editor. Move or resize the freeform crop box, adjust rotation, and apply the result.
5. **Arrange the wall.** Drag frames from the right rail onto the wall. Drag a placed frame to move it, use the arrow keys for precise positioning, or press Delete to remove it.
6. **Export the layout.** Select **Save image** to download the completed wall plan as a PNG.

## Saved walls

Wall projects are saved automatically in the browser using IndexedDB. The **Previous walls** tab lets you reopen, rename, and view saved projects as a grid or list.

Saved walls are local to the current browser and device. They are not stored in the repository or synchronized to another device, and clearing browser storage will remove them.

## Privacy

Photos and layouts remain in the browser. The local development server only serves the files in `dist/`; it does not upload images or project data.

## Project structure

```text
dist/
  index.html    Application markup
  styles.css    Layout and visual styles
  app.js        Calibration, editing, persistence, and export logic
scripts/
  dev.mjs       Dependency-free local development server
package.json    npm scripts
```
