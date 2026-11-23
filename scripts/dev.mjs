import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const heicVendor = new URL('../node_modules/heic2any/dist/heic2any.min.js', import.meta.url).pathname;
const dataDirectory = process.env.GALLERY_WALL_DATA_DIR ? resolve(process.env.GALLERY_WALL_DATA_DIR) : new URL('../.gallery-wall-data/', import.meta.url).pathname;
const projectsFile = join(dataDirectory, 'projects.json');
const port = Number(process.env.PORT) || 4173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function readProjects() {
  try { return JSON.parse(await readFile(projectsFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function writeProjects(projects) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${projectsFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, projectsFile);
}

async function backupProjects(projects) {
  if (!projects.length) return;
  const backupDirectory = join(dataDirectory, 'backups');
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(join(backupDirectory, `projects-before-delete-${Date.now()}.json`), `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
}

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
  if (pathname === '/api/projects' && request.method === 'PUT') {
    const project = await readJsonBody(request);
    if (!project?.id) { sendJson(response, 400, { error: 'Project id is required.' }); return true; }
    const projects = await readProjects(); const index = projects.findIndex(candidate => candidate.id === project.id);
    if (index === -1) projects.push(project); else projects[index] = project;
    await writeProjects(projects); sendJson(response, 200, project); return true;
  }
  if (pathname.startsWith('/api/projects/') && request.method === 'DELETE') {
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length));
    const projects = await readProjects(); const remainingProjects = projects.filter(project => project.id !== id);
    if (remainingProjects.length === projects.length) { sendJson(response, 404, { error: 'Project not found.' }); return true; }
    await backupProjects(projects); await writeProjects(remainingProjects);
    sendJson(response, 200, { deleted: id, remaining: remainingProjects.length }); return true;
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

server.listen(port, '127.0.0.1', () => {
  console.log(`Gallery Wall Studio: http://localhost:${port}`);
});
