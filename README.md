# Gallery Wall Studio

A browser-based tool for planning a gallery wall to scale. Calibrate a photograph of a room using an object of known length, add framed artwork with its real dimensions, and arrange the frames directly on the wall image.

![Gallery Wall Studio showing a scaled gallery wall plan](docs/gallery-wall-studio.png)

## Features

- Plan several walls in one project, each in its own browser-style tab with its own photo and calibration.
- Calibrate each wall photo in centimetres or inches using a visible object of known length.
- Import PNG, WebP, JPEG, HEIC, and HEIF frame photos with real outside dimensions.
- Correct frame perspective with four independently movable scanner-style corners, fine straightening, and 90° rotation.
- Remove the background from odd-shaped art and objects (bouquets, mirrors, plates) with a local AI model, then fix mistakes with paint-back and erase brushes.
- Reopen and expand non-destructive crops and cutouts, or reset a frame to its original upload.
- Share one frame collection across every wall in a project; frames are sized to each wall's own scale.
- Arrange accurately scaled frames with dragging, keyboard nudging, zooming, and canvas panning.
- Select a block of frames by dragging a box across the wall, then move, nudge, or delete them together.
- Undo and redo any change with the toolbar buttons or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z on Windows).
- Show readable distances between neighboring frames.
- Automatically save, rename, reopen, and delete local projects.
- Export the finished composition as a PNG.

## Requirements

- A recent version of Node.js
- A modern desktop browser
- A straight-on photograph of the wall containing an object with a known length
- PNG, WebP, JPEG, HEIC, or HEIF images of the framed artwork

## Run locally

From the repository root, install dependencies and start the local server:

```bash
npm install
npm run dev
```

Open <http://localhost:4173>.

To use another port:

```bash
PORT=3000 npm run dev
```

### Desktop app (macOS)

To open the studio with a double-click, build a small launcher app with its own icon:

```bash
./launcher/make-app.sh
```

This puts **Gallery Wall Studio** on your Desktop (use `--dest /Applications` to put it elsewhere). It starts the local server if it isn't already running, then opens the studio in your browser. The first time, macOS may ask to let it access your Documents folder. Server output goes to `~/Library/Logs/gallery-wall-studio.log`. Rerun the script if you move this folder. To change the icon, edit `launcher/icon.html`, run `node launcher/render-icon.mjs`, and rerun `make-app.sh`.

## How to use it

1. **Upload a wall photo.** Include a ruler, measuring tape, or another object whose real length you know.
2. **Calibrate the scale.** Draw a line over the known object, enter its length, select centimetres or inches, and apply the scale. Reapplying the scale updates every placed frame on that wall together.
3. **Add framed artwork.** Frames belong to the project, so every wall can use them. Upload PNG, WebP, JPEG, HEIC, or HEIF images and enter each frame's outside width and height using the selected unit.
4. **Prepare a frame.** Double-click a frame in the right rail to move its four crop corners independently, straighten the selected area into a rectangle, fine-tune its angle, or rotate it 90°. For anything that isn't a rectangular frame, select **Remove background**: the object is cut out and the corners snap to it. Switch to **Paint back** or **Erase** to brush over anything it got wrong; `[` and `]` change the brush size and ⌘Z / Ctrl+Z undoes a stroke. Enter the object's overall width and height as its dimensions. Cropping and cutouts are non-destructive, so reopening the editor lets you adjust them, restore the background, or reset to the original upload. The rail previews preserve the frames' relative physical sizes.
5. **Arrange the wall.** Drag frames from the right rail onto the wall. Drag a placed frame to move it, use the arrow keys for precise positioning (hold Shift for bigger steps), or press Delete to remove it. To work with a group, drag across an empty part of the wall to draw a selection box, Shift-click frames to add or remove them, or press ⌘A / Ctrl+A to select every frame on the wall; dragging any selected frame moves the whole block, and Esc clears the selection. Made a mistake? Use the undo and redo buttons above the wall, or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z). Undo covers placing, moving, and deleting frames, calibration, frame edits, and adding or removing walls, and it jumps to the wall where the change happened. History lasts for the current session, up to 100 steps. Use **Show distances** to label gaps between directly neighboring frames. Zoom from 50% to 500%; when zoomed, drag the dotted area around the photo or hold Space and drag to pan. Measurement text stays the same on-screen size.
6. **Add more walls.** Select **+** beside the wall tabs to add another wall to the same project, then upload its photo and calibrate it separately. A dot on each tab fills in once that wall's scale is set. To rename a wall, click the pencil on its tab, double-click the tab, right-click it and choose **Rename wall**, or press F2 with the tab focused. Use a tab's × to delete that wall. Your frames stay in the project.
7. **Start another project.** Select **New project**. The current project is saved before a blank workspace opens.
8. **Export the layout.** Select **Save image** to download the current wall as a PNG.

## Saved projects

Projects are saved automatically to `.gallery-wall-data/projects/`, one JSON file per project (holding its frames and all of its walls), in the local repository. Older `projects.json` stores are split into this folder automatically on the next launch. The **Projects** tab lets you reopen projects or use the thumbnail’s ••• menu to rename and delete them. Frames can be removed from the right rail with their × button; this also removes their placed copies.

Projects saved by older single-wall versions open as a project with one wall. Deleted projects are moved to `.gallery-wall-data/backups/` and their ids are recorded in `.gallery-wall-data/deleted.json`.

Projects are saved only in the repo, never in the browser, so they're the same from any browser, profile, or port running this repository. The local server must be running for changes to save: if a save fails (for example, the server was stopped), a notice appears, the app keeps retrying, and the browser warns before you close the page with unsaved changes. Older versions also kept copies in the browser; on launch, any such copies are moved into the repo and then removed from the browser.

The data directory is intentionally gitignored because it contains the uploaded photos.

## Privacy

Photos and layouts remain on your computer. The local development server writes projects only to `.gallery-wall-data/`; it does not upload images or project data anywhere.

Background removal runs on your computer too, using [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) (MIT licence) through ONNX Runtime. The first time you use it, the server downloads the model once (about 930 MB, from the [rembg](https://github.com/danielgatis/rembg) project's release files), checks its checksum, and saves it to `.gallery-wall-data/models/`. That download is the only network request the app makes, and no photos are sent. Each cutout takes a few seconds; the first one after starting the server also loads the model, which uses roughly 2 GB of memory.

## Project structure

```text
dist/
  index.html    Application markup
  styles.css    Layout and visual styles
  app.js        Calibration, editing, persistence, and export logic
launcher/
  make-app.sh               Builds the clickable macOS app
  icon.html, render-icon.mjs  The app icon and the script that renders it to GalleryWallStudio.icns
scripts/
  dev.mjs                  Local development server, project storage and background-removal API
  background-removal.mjs   BiRefNet background removal (model download, inference)
docs/
  gallery-wall-studio.png  README screenshot
package.json    npm scripts
.gallery-wall-data/  Local saved projects, deleted-project backups, background-removal model (created automatically, gitignored)
```
