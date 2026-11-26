import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const heicVendor = new URL('../node_modules/heic2any/dist/heic2any.min.js', import.meta.url).pathname;
const dataDirectory = process.env.GALLERY_WALL_DATA_DIR ? resolve(process.env.GALLERY_WALL_DATA_DIR) : new URL('../.gallery-wall-data/', import.meta.url).pathname;
const projectsDirectory = join(dataDirectory, 'projects');
const legacyProjectsFile = join(dataDirectory, 'projects.json');
const deletedFile = join(dataDirectory, 'deleted.json');
const port = Number(process.env.PORT) || 4173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const projectFile = id => join(projectsDirectory, `${id}.json`);
let temporaryCounter = 0;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJsonAtomic(file, value) {
  const temporaryFile = `${file}.${process.pid}.${temporaryCounter += 1}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporaryFile, file);
}

// Writes for one project are serialised so an older save can never land after a newer one.
const projectLocks = new Map();
function withProjectLock(id, task) {
  const previous = projectLocks.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  projectLocks.set(id, next);
  next.finally(() => { if (projectLocks.get(id) === next) projectLocks.delete(id); }).catch(() => {});
  return next;
}
let deletedLock = Promise.resolve();

async function migrateLegacyProjects() {
  await mkdir(projectsDirectory, { recursive: true });
  const legacyProjects = await readJson(legacyProjectsFile, null);
  if (!Array.isArray(legacyProjects)) return;
  for (const project of legacyProjects) if (validId(project?.id)) await writeJsonAtomic(projectFile(project.id), project);
  await rename(legacyProjectsFile, `${legacyProjectsFile}.migrated`);
  console.log(`Migrated ${legacyProjects.length} saved wall(s) to ${projectsDirectory}`);
}

async function readProjects() {
  const files = (await readdir(projectsDirectory)).filter(name => name.endsWith('.json'));
  const projects = await Promise.all(files.map(name => readJson(join(projectsDirectory, name), null).catch(() => null)));
  return projects.filter(Boolean);
}

const readDeletedIds = () => readJson(deletedFile, []);

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 100 * 1024 * 1024) { reject(new Error('Project is too large to save.')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function handleProjectsApi(request, response, pathname) {
  if (pathname === '/api/projects' && request.method === 'GET') { sendJson(response, 200, await readProjects()); return true; }
  if (pathname === '/api/projects/deleted' && request.method === 'GET') { sendJson(response, 200, await readDeletedIds()); return true; }
  if (pathname === '/api/projects' && request.method === 'PUT') {
    const project = await readJsonBody(request);
    if (!validId(project?.id)) { sendJson(response, 400, { error: 'A valid project id is required.' }); return true; }
    if ((await readDeletedIds()).includes(project.id)) { sendJson(response, 410, { error: 'This project was deleted.' }); return true; }
    const saved = await withProjectLock(project.id, async () => {
      const existing = await readJson(projectFile(project.id), null);
      if (existing && (existing.updatedAt || 0) > (project.updatedAt || 0)) return existing;
      await writeJsonAtomic(projectFile(project.id), project); return project;
    });
    sendJson(response, 200, saved); return true;
  }
  if (pathname.startsWith('/api/projects/') && request.method === 'DELETE') {
    const id = pathname.slice('/api/projects/'.length);
    if (!validId(id)) { sendJson(response, 400, { error: 'Invalid project id.' }); return true; }
    const removed = await withProjectLock(id, async () => {
      const backupDirectory = join(dataDirectory, 'backups');
      await mkdir(backupDirectory, { recursive: true });
      try { await rename(projectFile(id), join(backupDirectory, `${id}-deleted-${Date.now()}.json`)); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    });
    deletedLock = deletedLock.catch(() => {}).then(async () => {
      const deletedIds = await readDeletedIds();
      if (!deletedIds.includes(id)) await writeJsonAtomic(deletedFile, [...deletedIds, id]);
    });
    await deletedLock;
    sendJson(response, 200, { deleted: id, existed: removed }); return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    if (await handleProjectsApi(request, response, pathname)) return;
    const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = pathname === '/vendor/heic2any.min.js' ? heicVendor : join(root, safePath === '/' ? 'index.html' : safePath);
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': types[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) {
    const status = request.url?.startsWith('/api/') ? 500 : 404;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(status === 500 ? error.message : 'Not found');
  }
});

await migrateLegacyProjects();
server.listen(port, '127.0.0.1', () => {
  console.log(`Gallery Wall Studio: http://localhost:${port}`);
});
