// Render launcher/icon.html with headless Chrome and rebuild launcher/GalleryWallStudio.icns + preview.png from it.
// Only needed when you change the icon design (the built files are committed); then rerun make-app.sh.
//   node launcher/render-icon.mjs            # rebuild GalleryWallStudio.icns and preview.png
//   node launcher/render-icon.mjs out.png    # just write the 1024×1024 PNG somewhere
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pngOnly = !!process.argv[2];
const work = mkdtempSync(path.join(tmpdir(), 'gws-build-'));
const out = process.argv[2] || path.join(work, 'icon-1024.png');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9342;
const profile = mkdtempSync(path.join(tmpdir(), 'gws-icon-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    } catch { await sleep(200); }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); })
    .then((m) => { if (m.error) throw new Error(m.error.message); return m.result; });

  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url: 'file://' + path.join(here, 'icon.html') });
  await sleep(1500);
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  ws.close();
  if (pngOnly) {
    console.log('wrote', out);
  } else {
    // macOS icon set: each size at 1x and 2x, then iconutil packs them into one .icns.
    const set = path.join(work, 'GalleryWallStudio.iconset');
    mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', `${s}`, `${s}`, out, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', `${s * 2}`, `${s * 2}`, out, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(here, 'GalleryWallStudio.icns')]);
    execFileSync('sips', ['-Z', '256', out, '--out', path.join(here, 'preview.png')], { stdio: 'ignore' });
    console.log('wrote launcher/GalleryWallStudio.icns and launcher/preview.png');
  }
} finally {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  for (const dir of [profile, work]) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}
