// Background removal with BiRefNet (MIT licence), run locally by the dev server.
// The model (~928 MB) downloads once, on first use, into the gitignored data folder.
// Photos never leave this computer: the only network request is that one-time model download.
//
// Preprocessing and postprocessing mirror rembg's "birefnet-general" session, which is what
// the side-by-side test in .gallery-wall-data/background-test used.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx';
const MODEL_MD5 = '7a35a0141cbbc80de11d9c9a28f52697';
const INPUT_SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function createBackgroundRemover(modelDirectory) {
  const modelPath = join(modelDirectory, 'birefnet-general.onnx');
  const status = { state: 'idle', receivedBytes: 0, totalBytes: 0, error: null };
  let sessionPromise = null;
  let queue = Promise.resolve();

  async function downloadModel() {
    await mkdir(modelDirectory, { recursive: true });
    const partialPath = `${modelPath}.download`;
    Object.assign(status, { state: 'downloading', receivedBytes: 0, totalBytes: 0, error: null });
    console.log(`Downloading background-removal model to ${modelPath}…`);
    const response = await fetch(MODEL_URL);
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`);
    status.totalBytes = Number(response.headers.get('content-length')) || 0;
    const hash = createHash('md5');
    const body = Readable.fromWeb(response.body);
    body.on('data', chunk => { hash.update(chunk); status.receivedBytes += chunk.length; });
    try { await pipeline(body, createWriteStream(partialPath)); }
    catch (error) { await unlink(partialPath).catch(() => {}); throw error; }
    if (hash.digest('hex') !== MODEL_MD5) { await unlink(partialPath).catch(() => {}); throw new Error('The downloaded model did not match its checksum.'); }
    await rename(partialPath, modelPath);
  }

  function getSession() {
    sessionPromise ||= (async () => {
      try { await stat(modelPath); } catch { await downloadModel(); }
      status.state = 'loading';
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
      status.state = 'ready';
      return session;
    })().catch(error => {
      sessionPromise = null; Object.assign(status, { state: 'error', error: error.message });
      throw error;
    });
    return sessionPromise;
  }

  // Returns a greyscale PNG mask the same size as the (EXIF-oriented) input: white keeps, black removes.
  async function createMask(imageBuffer) {
    const session = await getSession();
    const metadata = await sharp(imageBuffer).metadata();
    const swapped = (metadata.orientation || 1) >= 5;
    const width = swapped ? metadata.height : metadata.width, height = swapped ? metadata.width : metadata.height;

    const { data: pixels } = await sharp(imageBuffer).rotate().removeAlpha()
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    let maximum = 1;
    for (const value of pixels) if (value > maximum) maximum = value;
    const plane = INPUT_SIZE * INPUT_SIZE, input = new Float32Array(3 * plane);
    for (let index = 0; index < plane; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        input[channel * plane + index] = (pixels[index * 3 + channel] / maximum - MEAN[channel]) / STD[channel];
      }
    }

    const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
    const logits = results[session.outputNames[0]].data;
    const probabilities = new Float32Array(plane);
    let low = Infinity, high = -Infinity;
    for (let index = 0; index < plane; index += 1) {
      const value = 1 / (1 + Math.exp(-logits[index]));
      probabilities[index] = value; if (value < low) low = value; if (value > high) high = value;
    }
    const range = high - low || 1, mask = Buffer.alloc(plane);
    for (let index = 0; index < plane; index += 1) mask[index] = Math.round(((probabilities[index] - low) / range) * 255);

    return sharp(mask, { raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  }

  return {
    status: () => ({ ...status, modelPresent: status.state === 'ready' || status.state === 'loading' }),
    async modelOnDisk() { try { await stat(modelPath); return true; } catch { return false; } },
    // One image at a time: the model uses a lot of memory and CPU.
    createMask(imageBuffer) { const run = queue.then(() => createMask(imageBuffer)); queue = run.catch(() => {}); return run; }
  };
}
