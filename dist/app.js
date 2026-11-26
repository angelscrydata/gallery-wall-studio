const $ = (selector) => document.querySelector(selector);
const state = {
  wallUrl: null, naturalWidth: 0, naturalHeight: 0,
  scaleLine: null, pixelsPerUnit: null, unit: 'cm',
  art: [], placed: [], selection: new Set(), zoom: 1,
  projectId: null, projectName: null, updatedAt: null, showSpacing: false,
  walls: [], activeWallId: null
};

const els = {
  wallInput: $('#wallInput'), wallInputEmpty: $('#wallInputEmpty'), wallInputLabel: $('#wallInputLabel'),
  wallImage: $('#wallImage'), stage: $('#stage'), stageWrap: $('#stageWrap'), emptyState: $('#emptyState'),
  calibrationStep: $('#calibrationStep'), artStep: $('#artStep'), drawScaleButton: $('#drawScaleButton'),
  knownLength: $('#knownLength'), unitSelect: $('#unitSelect'), applyScaleButton: $('#applyScaleButton'),
  scaleStatus: $('#scaleStatus'), measurementLayer: $('#measurementLayer'), measurementLine: $('#measurementLine'),
  measureStart: $('#measureStart'), measureEnd: $('#measureEnd'), artInput: $('#artInput'),
  pendingArt: $('#pendingArt'), artLibrary: $('#artLibrary'), frameCount: $('#frameCount'), artUnitLabel: $('#artUnitLabel'), placedArt: $('#placedArt'),
  canvasHint: $('#canvasHint'), zoomIn: $('#zoomIn'), zoomOut: $('#zoomOut'), zoomLabel: $('#zoomLabel'),
  spacingToggle: $('#spacingToggle'), spacingLayer: $('#spacingLayer'),
  exportButton: $('#exportButton'), resetButton: $('#resetButton'), confirmDialog: $('#confirmDialog'),
  planTab: $('#planTab'), historyTab: $('#historyTab'), planPanel: $('#planPanel'), historyPanel: $('#historyPanel'),
  projectLibrary: $('#projectLibrary'), gridViewButton: $('#gridViewButton'), listViewButton: $('#listViewButton'),
  frameEditorDialog: $('#frameEditorDialog'), frameEditorForm: $('#frameEditorForm'), editorClose: $('#editorClose'),
  cropCanvas: $('#cropCanvas'), cropPolygon: $('#cropPolygon'), cropCorners: [...document.querySelectorAll('.crop-corner')], editorPreviewImage: $('#editorPreviewImage'),
  frameRotation: $('#frameRotation'), rotationOutput: $('#rotationOutput'), editorReset: $('#editorReset'),
  rotateFrameButton: $('#rotateFrameButton'), selectionStatus: $('#selectionStatus'), undoButton: $('#undoButton'), redoButton: $('#redoButton'),
  cutoutPreview: $('#cutoutPreview'), brushCursor: $('#brushCursor'), removeBackgroundButton: $('#removeBackgroundButton'), cutoutStatus: $('#cutoutStatus'),
  cutoutTools: $('#cutoutTools'), brushSize: $('#brushSize'), cutoutIntro: $('#cutoutIntro'), brushRow: $('#brushRow'), brushPreview: $('#brushPreview'),
  redetectButton: $('#redetectButton'), editorHint: $('#editorHint'), editorEyebrow: $('#editorEyebrow'), editorCancel: $('#editorCancel'), undoStrokeButton: $('#undoStrokeButton'), fitCornersButton: $('#fitCornersButton'), clearCutoutButton: $('#clearCutoutButton'), wallTabs: $('#wallTabs'), wallTabList: $('#wallTabList'), addWallButton: $('#addWallButton')
};

function isHeic(file) {
  return /\.(heic|heif)$/i.test(file.name) || ['image/heic', 'image/heif'].includes(file.type.toLowerCase());
}

async function readFile(file) {
  let blob = file;
  if (isHeic(file)) {
    if (typeof window.heic2any !== 'function') throw new Error('The HEIC converter could not be loaded. Run npm install, then restart the local server.');
    const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: .94 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
  });
}

// ---- Storage -----------------------------------------------------------------
// Projects are saved only in the repo (.gallery-wall-data/), through the local dev server.
// Nothing is kept in the browser. Older versions also stored copies in this browser's IndexedDB;
// on load those are moved into the repo, and each browser copy is removed only after the repo
// confirms it is saved.
async function projectApi(path = '', options = {}) {
  let response;
  try { response = await fetch(`/api/projects${path}`, options); }
  catch { throw new Error('The local server isn’t running. Start it with npm run dev.'); }
  if (!response.ok) throw new Error(await response.text() || `Project storage failed (${response.status}).`);
  return response.json();
}

async function putProject(project) {
  await projectApi('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) });
}

async function getAllProjects() {
  const deleted = new Set(await projectApi('/deleted'));
  return (await projectApi()).filter(project => !deleted.has(project.id));
}

async function deleteProject(id) { await projectApi(`/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

// Opens the old browser store only if it already exists (never creates it).
function openLegacyBrowserStore() {
  return new Promise(resolve => {
    let request;
    try { request = indexedDB.open('gallery-wall-studio'); } catch { resolve(null); return; }
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onsuccess = () => { const db = request.result; if (db.objectStoreNames.contains('projects')) resolve(db); else { db.close(); resolve(null); } };
    request.onerror = () => resolve(null);
  });
}
function legacyStoreRequest(db, mode, action) {
  return new Promise((resolve, reject) => {
    const request = action(db.transaction('projects', mode).objectStore('projects'));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function moveBrowserProjectsToRepo() {
  // Deletes queued by the old version while the server was down.
  let pendingDeletes = [];
  try { pendingDeletes = JSON.parse(localStorage.getItem('gallery-wall-pending-deletes')) || []; } catch {}
  for (const id of pendingDeletes) await deleteProject(id);
  try { localStorage.removeItem('gallery-wall-pending-deletes'); } catch {}

  const db = await openLegacyBrowserStore(); if (!db) return;
  const browserProjects = await legacyStoreRequest(db, 'readonly', store => store.getAll());
  if (!browserProjects.length) { db.close(); indexedDB.deleteDatabase('gallery-wall-studio'); return; }
  const [repoProjects, deletedIds] = await Promise.all([projectApi(), projectApi('/deleted')]);
  const repoById = new Map(repoProjects.map(project => [project.id, project])), deleted = new Set(deletedIds);
  let kept = 0;
  for (const project of browserProjects) {
    const inRepo = repoById.get(project.id);
    try {
      if (!deleted.has(project.id) && (!inRepo || (project.updatedAt || 0) > (inRepo.updatedAt || 0))) await putProject(project);
      await legacyStoreRequest(db, 'readwrite', store => store.delete(project.id));
    } catch (error) { kept += 1; console.warn(`Could not move “${project.name}” from this browser into the repo.`, error); showSaveWarning(error, `Couldn’t move “${project.name}” from this browser into the repo; it’s still in the browser and will be retried next time.`); }
  }
  db.close();
  if (!kept) indexedDB.deleteDatabase('gallery-wall-studio');
}

// ---- Save status ----------------------------------------------------------------
// Since nothing is kept in the browser, a failed save is shown on screen, retried, and guarded on page exit.
const saveWarning = document.createElement('div');
saveWarning.className = 'save-warning'; saveWarning.hidden = true; saveWarning.setAttribute('role', 'alert');
document.body.append(saveWarning);
function showSaveWarning(error, message) {
  saveWarning.textContent = message || `Not saved to the repo yet: ${error?.message || 'unknown error'} Retrying…`; saveWarning.hidden = false;
}
function hideSaveWarning() { saveWarning.hidden = true; }
const saveVersions = { pending: 0, saved: 0 };
let retryTimer;
window.addEventListener('beforeunload', event => {
  if (saveVersions.saved < saveVersions.pending) { event.preventDefault(); event.returnValue = ''; }
});

let saveTimer;
// Every edit calls queueSave, which also records an undo step (unless `record: false`).
// `coalesce` merges rapid repeats of the same kind of edit (arrow nudges, typing a length) into one step.
function queueSave({ record = true, coalesce = null } = {}) {
  if (record) recordHistory(coalesce);
  if (state.projectId) saveVersions.pending += 1;
  clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentProject, 250);
}

// A project shares one frame collection across several walls. Each wall has its own photo,
// calibration, and placed frames. The active wall lives in `state` in on-screen pixels;
// the other walls are kept in `state.walls` in stage-relative (0–1) coordinates.
function blankWall(name) {
  return { id: crypto.randomUUID(), name, wallUrl: null, naturalWidth: 0, naturalHeight: 0, unit: state.unit || 'cm', knownLength: null, pixelsPerUnit: null, scaleLine: null, placed: [] };
}

function activeWall() { return state.walls.find(wall => wall.id === state.activeWallId); }

function serializeActiveWall() {
  const wall = activeWall(); if (!wall) return;
  wall.unit = state.unit; wall.knownLength = Number(els.knownLength.value) || null; wall.pixelsPerUnit = state.pixelsPerUnit;
  if (!state.wallUrl) return;
  const stageWidth = els.stage.clientWidth, stageHeight = els.stage.clientHeight;
  if (!stageWidth || !stageHeight) return;
  Object.assign(wall, {
    wallUrl: state.wallUrl, naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight,
    scaleLine: state.scaleLine ? { x1: state.scaleLine.x1 / stageWidth, y1: state.scaleLine.y1 / stageHeight, x2: state.scaleLine.x2 / stageWidth, y2: state.scaleLine.y2 / stageHeight } : null,
    placed: state.placed.map(item => ({ id: item.id, artId: item.artId, x: item.x / stageWidth, y: item.y / stageHeight, width: item.width / stageWidth, height: item.height / stageHeight }))
  });
}

// Older saves held a single wall at the top level of the project.
function normalizeProject(project) {
  const art = (project.art || []).map(item => ({ ...item }));
  let walls = project.walls;
  if (!Array.isArray(walls) || !walls.length) {
    (project.placed || []).forEach(item => {
      const match = art.find(candidate => candidate.id === item.artId);
      if (match && match.cropZoom === undefined && match.cropWidth === undefined) Object.assign(match, { cropZoom: item.cropZoom || 1, cropX: item.cropX || 0, cropY: item.cropY || 0, rotation: item.rotation || 0 });
    });
    walls = [{ id: `${project.id}-wall-1`, name: 'Wall 1', wallUrl: project.wallUrl || null, naturalWidth: project.naturalWidth || 0, naturalHeight: project.naturalHeight || 0, unit: project.unit || 'cm', knownLength: project.knownLength || null, pixelsPerUnit: project.pixelsPerUnit || null, scaleLine: project.scaleLine || null, placed: (project.placed || []).map(({ id, artId, x, y, width, height }) => ({ id, artId, x, y, width, height })) }];
  }
  walls = walls.map(wall => ({ ...wall, placed: (wall.placed || []).map(item => ({ ...item })) }));
  const activeWallId = walls.some(wall => wall.id === project.activeWallId) ? project.activeWallId : walls[0].id;
  return { id: project.id, name: project.name || 'Untitled project', updatedAt: project.updatedAt, art, walls, activeWallId };
}

function projectThumbnail(project) { return project.walls?.find(wall => wall.wallUrl)?.wallUrl || project.wallUrl || ''; }

async function saveCurrentProject() {
  if (!state.projectId) return true;
  serializeActiveWall();
  const project = {
    id: state.projectId, name: state.projectName || 'Untitled project', updatedAt: Date.now(),
    art: state.art, walls: state.walls.map(wall => ({ ...wall })), activeWallId: state.activeWallId
  };
  state.updatedAt = project.updatedAt;
  const version = saveVersions.pending; clearTimeout(retryTimer);
  try {
    await putProject(project); saveVersions.saved = Math.max(saveVersions.saved, version); hideSaveWarning();
    if (!els.historyPanel.hidden) renderProjects(); return true;
  } catch (error) {
    console.warn('Could not save project', error); showSaveWarning(error);
    retryTimer = setTimeout(() => { if (saveVersions.saved < saveVersions.pending) saveCurrentProject(); }, 5000);
    return false;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => { const probe = new Image(); probe.onload = () => resolve(probe); probe.onerror = () => reject(new Error('The photo could not be loaded.')); probe.src = url; });
}

async function loadWall(file) {
  if (!file) return;
  const url = await readFile(file), probe = await loadImage(url);
  if (!state.projectId) {
    state.projectId = crypto.randomUUID(); state.projectName = file.name.replace(/\.[^.]+$/, '') || 'Untitled project';
    state.art = []; const wall = blankWall('Wall 1'); state.walls = [wall]; state.activeWallId = wall.id;
    clearHistory();
  }
  // Replacing a wall's photo resets that wall's calibration and placements, not the shared frames.
  Object.assign(activeWall(), { wallUrl: url, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight, pixelsPerUnit: null, scaleLine: null, knownLength: null, placed: [] });
  await showWall(activeWall()); queueSave();
}

function fitStage() {
  const maxW = Math.max(300, els.stageWrap.clientWidth - 48), maxH = Math.max(300, els.stageWrap.clientHeight - 48);
  const ratio = Math.min(maxW / state.naturalWidth, maxH / state.naturalHeight, 1);
  els.stage.style.width = `${Math.round(state.naturalWidth * ratio)}px`;
  els.stage.style.height = `${Math.round(state.naturalHeight * ratio)}px`;
}

let wallSwitchToken = 0;
async function showWall(wall) {
  const token = wallSwitchToken += 1;
  if (wall.wallUrl) await loadImage(wall.wallUrl);
  if (token !== wallSwitchToken) return false;
  state.activeWallId = wall.id; state.selection = new Set(); state.showSpacing = false;
  state.wallUrl = wall.wallUrl; state.naturalWidth = wall.naturalWidth; state.naturalHeight = wall.naturalHeight;
  state.unit = wall.unit || 'cm'; state.pixelsPerUnit = wall.pixelsPerUnit || null;
  els.knownLength.value = wall.knownLength || ''; els.unitSelect.value = state.unit; updateUnitLabels(); clearMeasurement();
  const hasPhoto = Boolean(wall.wallUrl), calibrated = hasPhoto && Boolean(state.pixelsPerUnit);
  els.emptyState.hidden = hasPhoto; els.stage.hidden = !hasPhoto;
  if (hasPhoto) {
    els.wallImage.src = wall.wallUrl; setZoom(1); fitStage();
    const stageWidth = els.stage.clientWidth, stageHeight = els.stage.clientHeight;
    state.scaleLine = wall.scaleLine ? { x1: wall.scaleLine.x1 * stageWidth, y1: wall.scaleLine.y1 * stageHeight, x2: wall.scaleLine.x2 * stageWidth, y2: wall.scaleLine.y2 * stageHeight } : null;
    state.placed = (wall.placed || []).map(item => ({ id: item.id, artId: item.artId, x: item.x * stageWidth, y: item.y * stageHeight, width: item.width * stageWidth, height: item.height * stageHeight }));
  } else { state.scaleLine = null; state.placed = []; els.wallImage.removeAttribute('src'); setZoom(1); }
  els.calibrationStep.classList.toggle('is-disabled', !hasPhoto); [els.drawScaleButton, els.knownLength, els.unitSelect].forEach(el => el.disabled = !hasPhoto);
  els.drawScaleButton.textContent = state.scaleLine ? 'Redraw measurement line' : 'Draw measurement line';
  els.applyScaleButton.disabled = !(state.scaleLine && Number(els.knownLength.value) > 0);
  els.scaleStatus.textContent = calibrated ? `Scale set · ${state.pixelsPerUnit.toFixed(1)} px per ${state.unit}` : '';
  els.artStep.classList.toggle('is-disabled', !state.projectId); els.artInput.disabled = !state.projectId;
  els.canvasHint.textContent = !hasPhoto ? `Choose a photo for ${wall.name}` : calibrated ? (state.art.length ? 'Drag frames from the right onto this wall' : 'Add framed art, then drag it onto the wall') : 'Next, draw across the object of known length on this wall';
  els.wallInputLabel.textContent = hasPhoto ? 'Replace wall photo' : 'Choose wall photo';
  els.exportButton.disabled = !hasPhoto; els.zoomIn.disabled = !hasPhoto; els.zoomOut.disabled = !hasPhoto; els.spacingToggle.disabled = !calibrated; updateSpacingToggle();
  renderWallTabs(); renderLibrary(); renderPlaced();
  return true;
}

async function switchWall(wallId) {
  if (wallId === state.activeWallId) return;
  const wall = state.walls.find(candidate => candidate.id === wallId); if (!wall) return;
  serializeActiveWall();
  try { if (await showWall(wall)) { switchSidebarTab('plan'); queueSave({ record: false }); } }
  catch (error) { window.alert(`Could not open ${wall.name}. ${error.message}`); }
}

async function addWall() {
  if (!state.projectId) return;
  serializeActiveWall();
  const usedNumbers = state.walls.map(wall => Number(/^Wall (\d+)$/.exec(wall.name)?.[1]) || 0);
  const wall = blankWall(`Wall ${Math.max(state.walls.length, ...usedNumbers) + 1}`);
  state.walls.push(wall); await showWall(wall); switchSidebarTab('plan'); queueSave();
}

async function removeWall(wallId) {
  const wall = state.walls.find(candidate => candidate.id === wallId); if (!wall || state.walls.length < 2) return;
  if (!window.confirm(`Delete “${wall.name}”? Its photo and layout will be removed. Your frames stay in the project.`)) return;
  serializeActiveWall();
  const index = state.walls.indexOf(wall); state.walls.splice(index, 1);
  if (wallId === state.activeWallId) await showWall(state.walls[Math.max(0, index - 1)]);
  else renderWallTabs();
  queueSave();
}

// Rename a wall in place: the tab's button is swapped for a text field (never nested inside the
// button, which Safari and Firefox won't let you type into). Enter or clicking away saves; Esc cancels.
function renameWall(wallId) {
  const wall = state.walls.find(candidate => candidate.id === wallId); if (!wall) return;
  closeWallTabMenu();
  const tab = els.wallTabList.querySelector(`.wall-tab[data-wall-id="${wallId}"]`); if (!tab || tab.classList.contains('is-renaming')) return;
  const input = document.createElement('input');
  input.className = 'wall-tab-input'; input.value = wall.name; input.maxLength = 40; input.setAttribute('aria-label', 'Wall name');
  tab.classList.add('is-renaming'); tab.querySelector('.wall-tab-select').replaceWith(input); input.focus(); input.select();
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const name = input.value.trim(); if (save && name && name !== wall.name) { wall.name = name; queueSave(); }
    renderWallTabs(); if (!state.wallUrl && wall.id === state.activeWallId) els.canvasHint.textContent = `Choose a photo for ${wall.name}`;
    els.wallTabList.querySelector(`.wall-tab[data-wall-id="${wallId}"] .wall-tab-select`)?.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
}

const wallTabMenu = document.createElement('div');
wallTabMenu.className = 'wall-tab-menu'; wallTabMenu.hidden = true; wallTabMenu.setAttribute('role', 'menu');
wallTabMenu.innerHTML = '<button type="button" role="menuitem" data-action="rename">Rename wall</button><button type="button" role="menuitem" data-action="delete">Delete wall</button>';
document.body.append(wallTabMenu);
function openWallTabMenu(wallId, x, y) {
  wallTabMenu.dataset.wallId = wallId; wallTabMenu.querySelector('[data-action="delete"]').disabled = state.walls.length < 2;
  wallTabMenu.hidden = false;
  const { width, height } = wallTabMenu.getBoundingClientRect();
  Object.assign(wallTabMenu.style, { left: `${Math.min(x, innerWidth - width - 8)}px`, top: `${Math.min(y, innerHeight - height - 8)}px` });
  wallTabMenu.querySelector('button').focus();
}
function closeWallTabMenu() { wallTabMenu.hidden = true; }
wallTabMenu.addEventListener('click', event => {
  const action = event.target.closest('button')?.dataset.action, wallId = wallTabMenu.dataset.wallId; closeWallTabMenu();
  if (action === 'rename') renameWall(wallId); else if (action === 'delete') removeWall(wallId);
});
document.addEventListener('pointerdown', event => { if (!wallTabMenu.hidden && !wallTabMenu.contains(event.target)) closeWallTabMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !wallTabMenu.hidden) closeWallTabMenu(); });
window.addEventListener('resize', closeWallTabMenu); window.addEventListener('blur', closeWallTabMenu);

const pencilIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z"/></svg>';
function renderWallTabs() {
  els.wallTabs.hidden = !state.projectId;
  els.wallTabList.replaceChildren();
  state.walls.forEach(wall => {
    const active = wall.id === state.activeWallId, name = escapeHtml(wall.name);
    const tab = document.createElement('div'); tab.className = `wall-tab${active ? ' is-active' : ''}`; tab.dataset.wallId = wall.id;
    tab.innerHTML = `<button class="wall-tab-select" type="button" role="tab" aria-selected="${active}" title="${name} · double-click or right-click to rename"><span class="wall-tab-dot${wall.pixelsPerUnit ? ' is-set' : ''}" aria-hidden="true"></span><span class="wall-tab-name">${name}</span></button>`
      + `<button class="wall-tab-icon wall-tab-rename" type="button" aria-label="Rename ${name}" title="Rename">${pencilIcon}</button>`
      + (state.walls.length > 1 ? `<button class="wall-tab-icon wall-tab-close" type="button" aria-label="Delete ${name}" title="Delete wall">×</button>` : '');
    const select = tab.querySelector('.wall-tab-select');
    select.addEventListener('click', () => switchWall(wall.id));
    select.addEventListener('keydown', event => { if (event.key === 'F2') { event.preventDefault(); renameWall(wall.id); } });
    tab.querySelector('.wall-tab-rename').addEventListener('click', () => renameWall(wall.id));
    tab.querySelector('.wall-tab-close')?.addEventListener('click', () => removeWall(wall.id));
    els.wallTabList.append(tab);
  });
}
// Double-click a tab to rename it. Listening on the list (not each tab) survives the re-render
// that the first click on an inactive tab causes.
els.wallTabList.addEventListener('dblclick', event => {
  const tab = event.target.closest('.wall-tab'); if (!tab || event.target.closest('.wall-tab-icon, .wall-tab-input')) return;
  renameWall(tab.dataset.wallId);
});
els.wallTabList.addEventListener('contextmenu', event => {
  const tab = event.target.closest('.wall-tab'); if (!tab || event.target.closest('.wall-tab-input')) return;
  event.preventDefault(); openWallTabMenu(tab.dataset.wallId, event.clientX, event.clientY);
});

async function openSavedProject(savedProject) {
  const project = normalizeProject(savedProject);
  const wall = project.walls.find(candidate => candidate.id === project.activeWallId);
  if (state.projectId && state.projectId !== project.id) { clearTimeout(saveTimer); await saveCurrentProject(); }
  state.projectId = project.id; state.projectName = project.name; state.updatedAt = project.updatedAt;
  state.art = project.art; state.walls = project.walls;
  try { await showWall(wall); } catch (error) { window.alert(`Could not open ${project.name}. ${error.message}`); }
  resetHistory(); switchSidebarTab('plan');
}

function switchSidebarTab(tab) {
  const showHistory = tab === 'history';
  els.planPanel.hidden = showHistory; els.historyPanel.hidden = !showHistory;
  els.planTab.classList.toggle('is-active', !showHistory); els.historyTab.classList.toggle('is-active', showHistory);
  els.planTab.setAttribute('aria-selected', String(!showHistory)); els.historyTab.setAttribute('aria-selected', String(showHistory));
  if (showHistory) renderProjects();
}

async function renderProjects() {
  let projects = [];
  try { projects = (await getAllProjects()).sort((a, b) => b.updatedAt - a.updatedAt); }
  catch (error) { els.projectLibrary.innerHTML = `<p class="empty-projects">Couldn’t load projects. ${escapeHtml(error.message)}</p>`; return; }
  if (!projects.length) { els.projectLibrary.innerHTML = '<p class="empty-projects">Projects you work on will appear here automatically.</p>'; return; }
  els.projectLibrary.innerHTML = '';
  projects.forEach(project => {
    const card = document.createElement('article'); card.className = 'project-card';
    card.innerHTML = `<button class="project-open" type="button"><img class="project-thumb" src="${projectThumbnail(project)}" alt=""><span class="project-meta"><span class="project-name">${escapeHtml(project.name)}</span><span class="project-date">${formatProjectDate(project.updatedAt)} · ${wallCountLabel(project)}</span></span></button><div class="project-menu"><button class="project-menu-trigger" type="button" aria-label="Actions for ${escapeHtml(project.name)}" aria-expanded="false">•••</button><div class="project-menu-popover" hidden><button class="project-rename" type="button">Rename</button><button class="project-delete" type="button">Delete</button></div></div>`;
    card.querySelector('.project-open').onclick = () => openSavedProject(project);
    const menuTrigger = card.querySelector('.project-menu-trigger'), menu = card.querySelector('.project-menu-popover');
    menuTrigger.onclick = event => {
      event.stopPropagation(); const willOpen = menu.hidden;
      document.querySelectorAll('.project-menu-popover').forEach(popover => { popover.hidden = true; });
      document.querySelectorAll('.project-menu-trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      menu.hidden = !willOpen; menuTrigger.setAttribute('aria-expanded', String(willOpen));
    };
    card.querySelector('.project-rename').onclick = () => { menu.hidden = true; showRenameForm(card, project); };
    card.querySelector('.project-delete').onclick = async () => {
      if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
      try { await deleteProject(project.id); } catch (error) { window.alert(`Couldn’t delete “${project.name}”. ${error.message}`); return; }
      if (state.projectId === project.id) { clearTimeout(saveTimer); state.projectId = null; location.reload(); return; }
      renderProjects();
    };
    els.projectLibrary.append(card);
  });
}

function showRenameForm(card, project) {
  card.querySelector('.project-rename-form')?.remove();
  const form = document.createElement('form'); form.className = 'project-rename-form';
  form.innerHTML = `<input aria-label="Wall name" maxlength="80"><button type="submit">Save</button>`;
  const input = form.querySelector('input'); input.value = project.name; card.append(form); input.focus(); input.select();
  form.onsubmit = async event => {
    event.preventDefault(); const name = input.value.trim(); if (!name) return;
    const previousName = project.name; project.name = name; project.updatedAt = Date.now();
    try { await putProject(project); } catch (error) { project.name = previousName; window.alert(`Couldn’t rename the project. ${error.message}`); return; }
    if (state.projectId === project.id) { state.projectName = name; state.updatedAt = project.updatedAt; }
    renderProjects();
  };
}

function wallCountLabel(project) { const count = project.walls?.length || 1; return `${count} wall${count === 1 ? '' : 's'}`; }

function formatProjectDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp));
}

function clearMeasurement() {
  [els.measurementLine, els.measureStart, els.measureEnd].forEach(el => el.setAttribute('visibility', 'hidden'));
  els.scaleStatus.textContent = '';
}

function svgPoint(event) {
  const rect = els.measurementLayer.getBoundingClientRect();
  return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)) / state.zoom, y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) / state.zoom };
}

function setLine(line) {
  els.measurementLine.setAttribute('x1', line.x1); els.measurementLine.setAttribute('y1', line.y1);
  els.measurementLine.setAttribute('x2', line.x2); els.measurementLine.setAttribute('y2', line.y2);
  els.measureStart.setAttribute('cx', line.x1); els.measureStart.setAttribute('cy', line.y1);
  els.measureEnd.setAttribute('cx', line.x2); els.measureEnd.setAttribute('cy', line.y2);
  [els.measurementLine, els.measureStart, els.measureEnd].forEach(el => el.setAttribute('visibility', 'visible'));
}

els.drawScaleButton.addEventListener('click', () => {
  els.measurementLayer.classList.add('is-drawing');
  els.canvasHint.textContent = 'Drag from one end of the known length to the other';
  els.drawScaleButton.textContent = 'Drawing…';
});

let measureDraft = null;
els.measurementLayer.addEventListener('pointerdown', (event) => {
  if (!els.measurementLayer.classList.contains('is-drawing')) return;
  const p = svgPoint(event); measureDraft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  els.measurementLayer.setPointerCapture(event.pointerId); setLine(measureDraft);
});
els.measurementLayer.addEventListener('pointermove', (event) => {
  if (!measureDraft) return; const p = svgPoint(event); measureDraft.x2 = p.x; measureDraft.y2 = p.y; setLine(measureDraft);
});
els.measurementLayer.addEventListener('pointerup', (event) => {
  if (!measureDraft) return;
  const distance = Math.hypot(measureDraft.x2 - measureDraft.x1, measureDraft.y2 - measureDraft.y1);
  if (distance > 8) { state.scaleLine = measureDraft; els.applyScaleButton.disabled = !(Number(els.knownLength.value) > 0); els.scaleStatus.textContent = 'Line set. Enter the real length.'; queueSave(); }
  measureDraft = null; els.measurementLayer.classList.remove('is-drawing'); els.drawScaleButton.textContent = 'Redraw measurement line';
});
els.knownLength.addEventListener('input', () => { els.applyScaleButton.disabled = !(state.scaleLine && Number(els.knownLength.value) > 0); queueSave({ coalesce: 'known-length' }); });
els.unitSelect.addEventListener('change', () => {
  updateUnitLabels();
  if (state.pixelsPerUnit) {
    state.pixelsPerUnit = null; renderWallTabs();
    state.showSpacing = false; els.spacingToggle.disabled = true; updateSpacingToggle();
    els.scaleStatus.textContent = 'Unit changed · apply the scale again.';
  }
  queueSave();
});

function updateUnitLabels() {
  const unit = els.unitSelect.value;
  els.artUnitLabel.textContent = unit;
  document.querySelectorAll('.dimension-unit').forEach(label => label.textContent = ` (${unit})`);
}

els.applyScaleButton.addEventListener('click', () => {
  const length = Number(els.knownLength.value); if (!state.scaleLine || length <= 0) return;
  const displayDistance = Math.hypot(state.scaleLine.x2 - state.scaleLine.x1, state.scaleLine.y2 - state.scaleLine.y1);
  const renderedToNatural = state.naturalWidth / els.stage.clientWidth;
  state.pixelsPerUnit = displayDistance * renderedToNatural / length; state.unit = els.unitSelect.value;
  state.art.forEach(resizePlacedCopies); renderPlaced();
  els.scaleStatus.textContent = `Scale set · ${state.pixelsPerUnit.toFixed(1)} px per ${state.unit}`;
  [els.measurementLine, els.measureStart, els.measureEnd].forEach(el => el.setAttribute('visibility', 'hidden'));
  els.artStep.classList.remove('is-disabled'); els.artInput.disabled = false;
  els.spacingToggle.disabled = false;
  els.canvasHint.textContent = state.art.length ? 'Drag frames from the right onto this wall' : 'Add framed art, then drag it onto the wall';
  serializeActiveWall(); renderWallTabs(); queueSave();
});

els.artInput.addEventListener('change', async () => {
  for (const file of [...els.artInput.files]) {
    try { await createPendingArt(file); }
    catch (error) { window.alert(`Could not open ${file.name}. ${error.message}`); }
  }
  els.artInput.value = '';
});

async function createPendingArt(file) {
  const url = await readFile(file); const id = crypto.randomUUID();
  const card = document.createElement('div'); card.className = 'pending-card'; card.dataset.id = id;
  card.innerHTML = `<img class="pending-preview" alt="Preview of ${escapeHtml(file.name)}"><p class="pending-name">${escapeHtml(file.name)}</p><div class="dimension-row"><label>Width<span class="dimension-unit"> (${state.unit})</span><input class="art-width" type="number" min="0.1" step="0.1" placeholder="40"></label><label>Height<span class="dimension-unit"> (${state.unit})</span><input class="art-height" type="number" min="0.1" step="0.1" placeholder="50"></label></div><div class="pending-actions"><button class="button button-outline cancel-art" type="button">Cancel</button><button class="button button-dark add-art" type="button">Add frame</button></div>`;
  card.querySelector('img').src = url;
  card.querySelector('.cancel-art').onclick = () => card.remove();
  card.querySelector('.add-art').onclick = () => {
    const width = Number(card.querySelector('.art-width').value), height = Number(card.querySelector('.art-height').value);
    if (!(width > 0 && height > 0)) { card.querySelector('.art-width').focus(); return; }
    state.art.push({ id, url, sourceUrl: url, originalUrl: url, originalWidth: width, originalHeight: height, cropCorners: fullCropCorners(), name: file.name, width, height, unit: state.unit, cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1, rotation: 0 }); card.remove(); renderLibrary(); queueSave();
  };
  els.pendingArt.append(card);
}

function renderLibrary() {
  els.frameCount.textContent = state.art.length;
  if (!state.art.length) { els.artLibrary.innerHTML = '<div class="empty-library">Your scaled frames will appear here.</div>'; return; }
  els.artLibrary.innerHTML = '';
  const dimensions = state.art.map(art => ({ width: toCentimetres(art.width, art.unit), height: toCentimetres(art.height, art.unit) }));
  const maximum = Math.max(...dimensions.flatMap(size => [size.width, size.height]));
  const railPixelsPerCm = 140 / maximum;
  // Newest frames first: state.art is stored oldest-first, so walk it backwards.
  [...state.art].reverse().forEach(art => {
    const size = dimensions[state.art.indexOf(art)];
    const el = document.createElement('div'); el.className = 'library-frame'; el.draggable = true; el.tabIndex = 0;
    el.innerHTML = `<button class="library-delete" type="button" aria-label="Delete ${escapeHtml(art.name)}">×</button><div class="library-frame-preview" style="width:${size.width * railPixelsPerCm}px;height:${size.height * railPixelsPerCm}px"><img src="${art.url}" alt="${escapeHtml(art.name)}" style="${frameImageStyleText(art)}"></div><span>${art.width} × ${art.height} ${art.unit}</span>`;
    el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', art.id));
    el.addEventListener('dblclick', () => openFrameEditor(art.id));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') openFrameEditor(art.id); });
    el.querySelector('.library-delete').addEventListener('click', event => { event.stopPropagation(); removeArt(art.id); });
    el.querySelector('.library-delete').addEventListener('dblclick', event => event.stopPropagation());
    els.artLibrary.append(el);
  });
}

function toCentimetres(value, unit) { return unit === 'in' ? value * 2.54 : value; }

function removeArt(artId) {
  const art = state.art.find(candidate => candidate.id === artId); if (!art) return;
  if (!window.confirm(`Delete “${art.name}” from this project? It will be removed from every wall.`)) return;
  state.art = state.art.filter(candidate => candidate.id !== artId);
  state.placed = state.placed.filter(item => item.artId !== artId);
  state.walls.forEach(wall => { wall.placed = (wall.placed || []).filter(item => item.artId !== artId); });
  renderLibrary(); renderPlaced(); queueSave();
}

els.stage.addEventListener('dragover', e => e.preventDefault());
els.stage.addEventListener('drop', e => {
  e.preventDefault(); const artId = e.dataTransfer.getData('text/plain'); if (!artId) return;
  const rect = els.stage.getBoundingClientRect(); placeArt(artId, (e.clientX - rect.left) / state.zoom, (e.clientY - rect.top) / state.zoom);
});
function placeArt(artId, centerX, centerY) {
  const art = state.art.find(a => a.id === artId); if (!art) return;
  if (!state.pixelsPerUnit) { els.canvasHint.textContent = 'Set the scale for this wall before placing frames'; els.calibrationStep.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  const naturalToDisplay = els.stage.clientWidth / state.naturalWidth;
  const unitFactor = art.unit === state.unit ? 1 : art.unit === 'in' ? 2.54 : 1 / 2.54;
  const width = art.width * unitFactor * state.pixelsPerUnit * naturalToDisplay, height = art.height * unitFactor * state.pixelsPerUnit * naturalToDisplay;
  const placed = { id: crypto.randomUUID(), artId, x: centerX - width / 2, y: centerY - height / 2, width, height };
  placed.x = Math.max(0, Math.min(els.stage.clientWidth - width, placed.x)); placed.y = Math.max(0, Math.min(els.stage.clientHeight - height, placed.y));
  state.placed.push(placed); state.selection = new Set([placed.id]); renderPlaced(); queueSave();
}

function renderPlaced() {
  els.placedArt.innerHTML = '';
  state.placed.forEach(item => {
    const art = state.art.find(a => a.id === item.artId); if (!art) return;
    const frame = document.createElement('div'); frame.className = 'placed-frame'; frame.dataset.id = item.id; frame.tabIndex = 0;
    const img = document.createElement('img'); img.src = art.url; img.alt = art.name; img.draggable = false; img.className = 'placed-frame-image'; img.style.cssText = frameImageStyleText(art);
    Object.assign(frame.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
    frame.classList.toggle('selected', state.selection.has(item.id));
    frame.append(img); frame.addEventListener('pointerdown', beginFrameDrag);
    els.placedArt.append(frame);
  });
  updateSelectionStatus(); renderSpacing();
}

function updateSpacingToggle() {
  els.spacingToggle.setAttribute('aria-pressed', String(state.showSpacing));
  els.spacingToggle.textContent = state.showSpacing ? 'Hide distances' : 'Show distances';
  renderSpacing();
}

els.spacingToggle.addEventListener('click', () => { state.showSpacing = !state.showSpacing; updateSpacingToggle(); });

function renderSpacing() {
  els.spacingLayer.replaceChildren();
  if (!state.showSpacing || !state.pixelsPerUnit || state.placed.length < 2) return;
  const displayPixelsPerUnit = state.pixelsPerUnit * els.stage.clientWidth / state.naturalWidth;
  for (let index = 0; index < state.placed.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < state.placed.length; otherIndex += 1) {
      const first = state.placed[index], second = state.placed[otherIndex];
      const horizontalOverlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
      const verticalOverlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
      if (verticalOverlap > 0) {
        const left = first.x < second.x ? first : second, right = left === first ? second : first;
        const gap = right.x - (left.x + left.width);
        const overlapTop = Math.max(first.y, second.y), overlapBottom = overlapTop + verticalOverlap;
        if (gap > 0 && framesAreHorizontalNeighbors(left, right, overlapTop, overlapBottom)) addDistanceMarker(left.x + left.width, right.x, overlapTop + verticalOverlap / 2, true, gap / displayPixelsPerUnit);
      }
      if (horizontalOverlap > 0) {
        const top = first.y < second.y ? first : second, bottom = top === first ? second : first;
        const gap = bottom.y - (top.y + top.height);
        const overlapLeft = Math.max(first.x, second.x), overlapRight = overlapLeft + horizontalOverlap;
        if (gap > 0 && framesAreVerticalNeighbors(top, bottom, overlapLeft, overlapRight)) addDistanceMarker(top.y + top.height, bottom.y, overlapLeft + horizontalOverlap / 2, false, gap / displayPixelsPerUnit);
      }
    }
  }
}

function framesAreHorizontalNeighbors(left, right, overlapTop, overlapBottom) {
  const gapLeft = left.x + left.width, gapRight = right.x;
  return !state.placed.some(frame => frame !== left && frame !== right && frame.x < gapRight && frame.x + frame.width > gapLeft && frame.y < overlapBottom && frame.y + frame.height > overlapTop);
}

function framesAreVerticalNeighbors(top, bottom, overlapLeft, overlapRight) {
  const gapTop = top.y + top.height, gapBottom = bottom.y;
  return !state.placed.some(frame => frame !== top && frame !== bottom && frame.y < gapBottom && frame.y + frame.height > gapTop && frame.x < overlapRight && frame.x + frame.width > overlapLeft);
}

function addDistanceMarker(start, end, cross, horizontal, distance) {
  const namespace = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(namespace, 'line'); line.classList.add('spacing-line');
  const tickA = document.createElementNS(namespace, 'line'); tickA.classList.add('spacing-line');
  const tickB = document.createElementNS(namespace, 'line'); tickB.classList.add('spacing-line');
  const label = document.createElementNS(namespace, 'text'); label.classList.add('spacing-label');
  const inverseZoom = 1 / state.zoom;
  label.style.fontSize = `${13 * inverseZoom}px`; label.style.strokeWidth = `${3 * inverseZoom}px`;
  const labelText = `${formatDistance(distance)} ${state.unit}`;
  let labelX, labelY;
  if (horizontal) {
    Object.entries({ x1: start, y1: cross, x2: end, y2: cross }).forEach(([key, value]) => line.setAttribute(key, value));
    Object.entries({ x1: start, y1: cross - 4, x2: start, y2: cross + 4 }).forEach(([key, value]) => tickA.setAttribute(key, value));
    Object.entries({ x1: end, y1: cross - 4, x2: end, y2: cross + 4 }).forEach(([key, value]) => tickB.setAttribute(key, value));
    labelX = (start + end) / 2; labelY = cross;
  } else {
    Object.entries({ x1: cross, y1: start, x2: cross, y2: end }).forEach(([key, value]) => line.setAttribute(key, value));
    Object.entries({ x1: cross - 4, y1: start, x2: cross + 4, y2: start }).forEach(([key, value]) => tickA.setAttribute(key, value));
    Object.entries({ x1: cross - 4, y1: end, x2: cross + 4, y2: end }).forEach(([key, value]) => tickB.setAttribute(key, value));
    labelX = cross; labelY = (start + end) / 2;
  }
  label.setAttribute('x', labelX); label.setAttribute('y', labelY); label.textContent = labelText;
  els.spacingLayer.append(line, tickA, tickB, label);
}

function formatDistance(value) { return value >= 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''); }

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function ensureCrop(art) {
  if (art.cropWidth !== undefined) return;
  const zoom = art.cropZoom || 1, width = 1 / zoom, height = 1 / zoom;
  art.cropWidth = width; art.cropHeight = height;
  art.cropLeft = clamp((1 - width) / 2 - ((art.cropX || 0) / 100) * width, 0, 1 - width);
  art.cropTop = clamp((1 - height) / 2 - ((art.cropY || 0) / 100) * height, 0, 1 - height);
}

function frameImageStyleText(art) {
  ensureCrop(art);
  const originX = (art.cropLeft + art.cropWidth / 2) * 100, originY = (art.cropTop + art.cropHeight / 2) * 100;
  return `left:${-art.cropLeft / art.cropWidth * 100}%;top:${-art.cropTop / art.cropHeight * 100}%;width:${100 / art.cropWidth}%;height:${100 / art.cropHeight}%;transform-origin:${originX}% ${originY}%;transform:rotate(${art.rotation || 0}deg)`;
}

let editingArtId = null;
let cropDraft = null;
let editorDraftUrl = null;
let editorDraftWidth = null;
let editorDraftHeight = null;
function fullCropCorners() { return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]; }
function openFrameEditor(artId) {
  const art = state.art.find(candidate => candidate.id === artId); if (!art) return;
  art.originalUrl ||= art.sourceUrl || art.url;
  art.originalWidth ??= art.width; art.originalHeight ??= art.height;
  ensureCrop(art); editingArtId = artId;
  cropDraft = art.cropCorners?.length === 4 ? art.cropCorners.map(point => ({ ...point })) : [
    { x: art.cropLeft, y: art.cropTop },
    { x: art.cropLeft + art.cropWidth, y: art.cropTop },
    { x: art.cropLeft + art.cropWidth, y: art.cropTop + art.cropHeight },
    { x: art.cropLeft, y: art.cropTop + art.cropHeight }
  ];
  editorDraftUrl = art.sourceUrl || art.url; editorDraftWidth = art.width; editorDraftHeight = art.height;
  editorMask = art.cutout ? cloneCutout(art.cutout) : null; setEditorTool('corners'); setCutoutStatus('');
  els.editorEyebrow.textContent = `${art.name.replace(/\.[^.]+$/, '')} · ${art.width} × ${art.height} ${art.unit}`;
  els.editorPreviewImage.onload = () => { els.cropCanvas.style.aspectRatio = `${els.editorPreviewImage.naturalWidth} / ${els.editorPreviewImage.naturalHeight}`; els.cropCanvas.style.setProperty('--ratio', els.editorPreviewImage.naturalWidth / els.editorPreviewImage.naturalHeight); syncCropPolygon(); buildCutoutPreview(); };
  els.editorPreviewImage.src = editorDraftUrl; els.frameRotation.value = art.rotation || 0; updateRotationOutput();
  els.frameEditorDialog.showModal(); if (els.editorPreviewImage.complete) els.editorPreviewImage.onload();
}

function syncCropPolygon() {
  if (!cropDraft) return;
  els.cropPolygon.setAttribute('points', cropDraft.map(point => `${point.x * 100},${point.y * 100}`).join(' '));
  els.cropCorners.forEach((handle, index) => Object.assign(handle.style, { left: `${cropDraft[index].x * 100}%`, top: `${cropDraft[index].y * 100}%` }));
  updateEditorRotationPreview();
}

function updateEditorRotationPreview() {
  if (!cropDraft) return;
  const center = cropDraft.reduce((total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }), { x: 0, y: 0 });
  [els.editorPreviewImage, els.cutoutPreview].forEach(element => {
    element.style.transformOrigin = `${center.x * 100}% ${center.y * 100}%`;
    element.style.transform = `rotate(${Number(els.frameRotation.value)}deg)`;
  });
}
function updateRotationOutput() { els.rotationOutput.textContent = `${Number(els.frameRotation.value).toFixed(1)}°`; updateEditorRotationPreview(); }
els.frameRotation.addEventListener('input', updateRotationOutput);

let cropDrag = null;
els.cropCorners.forEach(handle => handle.addEventListener('pointerdown', event => {
  event.preventDefault(); event.stopPropagation();
  const handleRect = handle.getBoundingClientRect();
  cropDrag = {
    index: Number(handle.dataset.corner), handle,
    offsetX: event.clientX - (handleRect.left + handleRect.width / 2),
    offsetY: event.clientY - (handleRect.top + handleRect.height / 2)
  };
  handle.setPointerCapture(event.pointerId);
}));
document.addEventListener('pointermove', event => {
  if (!cropDrag) return;
  const rect = els.cropCanvas.getBoundingClientRect(), point = {
    x: clamp((event.clientX - cropDrag.offsetX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - cropDrag.offsetY - rect.top) / rect.height, 0, 1)
  };
  const nextCrop = cropDraft.map(candidate => ({ ...candidate })); nextCrop[cropDrag.index] = point;
  if (isValidCropPolygon(nextCrop)) { cropDraft = nextCrop; syncCropPolygon(); }
});
function endCropDrag(event) { if (!cropDrag) return; if (cropDrag.handle.hasPointerCapture(event.pointerId)) cropDrag.handle.releasePointerCapture(event.pointerId); cropDrag = null; }
document.addEventListener('pointerup', endCropDrag); document.addEventListener('pointercancel', endCropDrag);

els.rotateFrameButton.addEventListener('click', async () => {
  els.rotateFrameButton.disabled = true;
  try {
    editorDraftUrl = await rotateDataUrl90(editorDraftUrl);
    if (editorMask) editorMask = { maskUrl: await rotateDataUrl90(editorMask.maskUrl), strokes: editorMask.strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ x: 1 - point.y, y: point.x })) })) };
    const rotatedCorners = cropDraft.map(point => ({ x: 1 - point.y, y: point.x }));
    cropDraft = [rotatedCorners[3], rotatedCorners[0], rotatedCorners[1], rotatedCorners[2]];
    [editorDraftWidth, editorDraftHeight] = [editorDraftHeight, editorDraftWidth];
    els.editorPreviewImage.src = editorDraftUrl;
  } catch (error) { window.alert(`Could not rotate this frame. ${error.message}`); }
  finally { els.rotateFrameButton.disabled = false; }
});

function rotateDataUrl90(url) {
  return imageFromUrl(url).then(image => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalHeight; canvas.height = image.naturalWidth;
    const context = canvas.getContext('2d'); context.translate(canvas.width, 0); context.rotate(Math.PI / 2); context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  });
}

els.editorReset.addEventListener('click', () => {
  const art = state.art.find(candidate => candidate.id === editingArtId); if (!art) return;
  editorDraftUrl = art.originalUrl || art.sourceUrl || art.url;
  editorDraftWidth = art.originalWidth ?? art.width; editorDraftHeight = art.originalHeight ?? art.height;
  cropDraft = fullCropCorners(); els.frameRotation.value = 0; editorMask = null; setEditorTool('corners'); setCutoutStatus('');
  els.editorPreviewImage.src = editorDraftUrl; syncCropPolygon(); updateRotationOutput(); buildCutoutPreview();
});
els.editorClose.addEventListener('click', () => els.frameEditorDialog.close());
els.frameEditorForm.addEventListener('submit', async event => {
  event.preventDefault(); const art = state.art.find(candidate => candidate.id === editingArtId); if (!art) return;
  const submitButton = els.frameEditorForm.querySelector('[type="submit"]'); submitButton.disabled = true; submitButton.textContent = 'Applying…';
  const oldWidth = art.width, oldHeight = art.height;
  const dimensionsSwapped = nearlyEqual(editorDraftWidth, oldHeight) && nearlyEqual(editorDraftHeight, oldWidth) && !nearlyEqual(oldWidth, oldHeight);
  try {
    const cropSource = editorMask ? await applyCutout(editorDraftUrl, editorMask) : editorDraftUrl;
    art.url = await rectifyDataUrl(cropSource, cropDraft); art.width = editorDraftWidth; art.height = editorDraftHeight;
    art.sourceUrl = editorDraftUrl; art.cropCorners = cropDraft.map(point => ({ ...point }));
    if (editorMask) art.cutout = cloneCutout(editorMask); else delete art.cutout;
    art.cropLeft = 0; art.cropTop = 0; art.cropWidth = 1; art.cropHeight = 1; art.rotation = Number(els.frameRotation.value);
    if (dimensionsSwapped) rotatePlacedCopies(art.id);
    else if (!nearlyEqual(oldWidth, art.width) || !nearlyEqual(oldHeight, art.height)) resizePlacedCopies(art);
    if (dimensionsSwapped || !nearlyEqual(oldWidth, art.width) || !nearlyEqual(oldHeight, art.height)) resizeOnOtherWalls(art);
    els.frameEditorDialog.close(); renderLibrary(); renderPlaced(); queueSave();
  } catch (error) { window.alert(`Could not straighten this frame. ${error.message}`); }
  finally { submitButton.disabled = false; submitButton.textContent = 'Apply'; }
});

// ---- Background removal (cutouts) ---------------------------------------------
// "Remove background" asks the local server for a mask (BiRefNet), then the keep/erase brushes
// refine it. The cutout is non-destructive: the frame keeps its source photo plus
// { maskUrl, strokes } and is re-composited whenever the editor is applied.
// Brush sizes and stroke points are fractions of the image (size = % of its longer side).
let editorMask = null, cutoutPreview = null, editorTool = 'corners', activeStroke = null;

function cloneCutout(cutout) {
  return { maskUrl: cutout.maskUrl, strokes: (cutout.strokes || []).map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) })) };
}
function setCutoutStatus(text) { els.cutoutStatus.textContent = text || ''; els.cutoutStatus.hidden = !text; }
function updateCutoutControls() {
  els.cutoutIntro.hidden = Boolean(editorMask); els.cutoutTools.hidden = !editorMask;
  els.undoStrokeButton.disabled = !editorMask?.strokes.length;
}
function updateEditorHint() {
  const brushKeys = ` <kbd>[</kbd> <kbd>]</kbd> change the size · <kbd>${shortcutModifier}Z</kbd> undoes a stroke.`;
  els.editorHint.innerHTML = editorTool === 'keep' ? `Paint over anything that was removed by mistake.${brushKeys}`
    : editorTool === 'erase' ? `Paint over leftover background.${brushKeys}`
    : editorMask ? 'Drag the corners to the object’s outer edges. Use Paint back or Erase to fix the cutout.'
    : 'Drag the four corners to the outside edges of the frame. Apply straightens it to its real size.';
}
function updateBrushPreview() {
  const diameter = Number(els.brushSize.value) / 100 * Math.max(els.cutoutPreview.clientWidth || 300, els.cutoutPreview.clientHeight || 300);
  els.brushPreview.style.width = els.brushPreview.style.height = `${clamp(diameter, 3, 30)}px`;
  if (!els.brushCursor.hidden) els.brushCursor.style.width = els.brushCursor.style.height = `${diameter}px`;
}
function setEditorTool(tool) {
  editorTool = editorMask ? tool : 'corners';
  els.cutoutTools.querySelectorAll('[data-tool]').forEach(button => { const on = button.dataset.tool === editorTool; button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)); });
  els.cropCanvas.classList.toggle('is-brushing', editorTool !== 'corners');
  els.brushCursor.classList.toggle('is-erase', editorTool === 'erase');
  els.brushRow.hidden = editorTool === 'corners';
  if (editorTool === 'corners') els.brushCursor.hidden = true;
  updateEditorHint(); updateBrushPreview();
}
els.cutoutTools.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setEditorTool(button.dataset.tool)));

function drawStroke(context, stroke, width, height, fromIndex = 0) {
  const diameter = stroke.size / 100 * Math.max(width, height), points = stroke.points;
  context.save(); context.strokeStyle = context.fillStyle = stroke.mode === 'keep' ? '#fff' : '#000';
  context.lineWidth = diameter; context.lineCap = 'round'; context.lineJoin = 'round';
  if (points.length === 1 || fromIndex === points.length - 1 && fromIndex === 0) {
    context.beginPath(); context.arc(points[0].x * width, points[0].y * height, diameter / 2, 0, Math.PI * 2); context.fill();
  } else {
    context.beginPath(); const start = Math.max(0, fromIndex - 1);
    context.moveTo(points[start].x * width, points[start].y * height);
    for (let index = start + 1; index < points.length; index += 1) context.lineTo(points[index].x * width, points[index].y * height);
    context.stroke();
  }
  context.restore();
}

// Draws the photo with the mask (and strokes) applied as transparency, at `width` × `height`.
async function maskedImageData(url, cutout, maxSide) {
  const [base, mask] = await Promise.all([imageFromUrl(url, 'The frame photo'), imageFromUrl(cutout.maskUrl, 'The cutout mask')]);
  const scale = maxSide ? Math.min(1, maxSide / Math.max(base.naturalWidth, base.naturalHeight)) : 1;
  const width = Math.max(1, Math.round(base.naturalWidth * scale)), height = Math.max(1, Math.round(base.naturalHeight * scale));
  const baseCanvas = Object.assign(document.createElement('canvas'), { width, height }), baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  baseContext.drawImage(base, 0, 0, width, height);
  const maskCanvas = Object.assign(document.createElement('canvas'), { width, height }), maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  maskContext.drawImage(mask, 0, 0, width, height);
  cutout.strokes.forEach(stroke => drawStroke(maskContext, stroke, width, height));
  return { width, height, base: baseContext.getImageData(0, 0, width, height), maskCanvas, maskContext };
}
function compositeInto(target, base, maskContext, width, height) {
  const mask = maskContext.getImageData(0, 0, width, height).data, out = target.data;
  out.set(base.data);
  for (let index = 3; index < out.length; index += 4) out[index] = Math.round(base.data[index] * mask[index - 3] / 255);
}

async function applyCutout(url, cutout) {
  const { width, height, base, maskContext } = await maskedImageData(url, cutout);
  const canvas = Object.assign(document.createElement('canvas'), { width, height }), context = canvas.getContext('2d');
  const output = context.createImageData(width, height); compositeInto(output, base, maskContext, width, height);
  context.putImageData(output, 0, 0); return canvas.toDataURL('image/png');
}

let previewBuildToken = 0;
async function buildCutoutPreview() {
  const token = previewBuildToken += 1;
  if (!editorMask) { cutoutPreview = null; els.cutoutPreview.hidden = true; els.editorPreviewImage.style.visibility = ''; updateCutoutControls(); return; }
  const preview = await maskedImageData(editorDraftUrl, editorMask, 1400);
  if (token !== previewBuildToken) return;
  Object.assign(els.cutoutPreview, { width: preview.width, height: preview.height });
  preview.context = els.cutoutPreview.getContext('2d'); preview.output = preview.context.createImageData(preview.width, preview.height);
  cutoutPreview = preview; renderCutoutPreview();
  els.cutoutPreview.hidden = false; els.editorPreviewImage.style.visibility = 'hidden'; updateCutoutControls(); updateEditorRotationPreview();
}
function renderCutoutPreview() {
  if (!cutoutPreview) return;
  const { base, maskContext, width, height, output, context } = cutoutPreview;
  compositeInto(output, base, maskContext, width, height); context.putImageData(output, 0, 0);
}
async function redrawCutoutMask() {
  if (!cutoutPreview || !editorMask) return;
  const mask = await imageFromUrl(editorMask.maskUrl), { maskContext, width, height } = cutoutPreview;
  maskContext.clearRect(0, 0, width, height); maskContext.drawImage(mask, 0, 0, width, height);
  editorMask.strokes.forEach(stroke => drawStroke(maskContext, stroke, width, height));
  renderCutoutPreview(); updateCutoutControls();
}

// Brushing: offsetX/offsetY are in the canvas's own (un-rotated) coordinates, so straightening doesn't skew strokes.
function strokePoint(event) {
  return { x: clamp(event.offsetX / els.cutoutPreview.clientWidth, 0, 1), y: clamp(event.offsetY / els.cutoutPreview.clientHeight, 0, 1) };
}
function moveBrushCursor(event) {
  if (editorTool === 'corners' || !cutoutPreview) { els.brushCursor.hidden = true; return; }
  const rect = els.cropCanvas.getBoundingClientRect(), diameter = Number(els.brushSize.value) / 100 * Math.max(els.cutoutPreview.clientWidth, els.cutoutPreview.clientHeight);
  Object.assign(els.brushCursor.style, { left: `${event.clientX - rect.left}px`, top: `${event.clientY - rect.top}px`, width: `${diameter}px`, height: `${diameter}px` });
  els.brushCursor.hidden = false;
}
els.cutoutPreview.addEventListener('pointerdown', event => {
  if (editorTool === 'corners' || !cutoutPreview || event.button !== 0) return;
  event.preventDefault(); els.cutoutPreview.setPointerCapture(event.pointerId);
  activeStroke = { mode: editorTool, size: Number(els.brushSize.value), points: [strokePoint(event)] };
  drawStroke(cutoutPreview.maskContext, activeStroke, cutoutPreview.width, cutoutPreview.height); renderCutoutPreview();
});
els.cutoutPreview.addEventListener('pointermove', event => {
  moveBrushCursor(event);
  if (!activeStroke) return;
  activeStroke.points.push(strokePoint(event));
  drawStroke(cutoutPreview.maskContext, activeStroke, cutoutPreview.width, cutoutPreview.height, activeStroke.points.length - 1); renderCutoutPreview();
});
function endStroke() {
  if (!activeStroke) return;
  editorMask.strokes.push(activeStroke); activeStroke = null; updateCutoutControls();
}
els.cutoutPreview.addEventListener('pointerup', endStroke); els.cutoutPreview.addEventListener('pointercancel', endStroke);
els.cutoutPreview.addEventListener('pointerleave', () => { els.brushCursor.hidden = true; });
els.brushSize.addEventListener('input', updateBrushPreview);
els.redetectButton.addEventListener('click', () => els.removeBackgroundButton.click());
els.editorCancel.addEventListener('click', () => els.frameEditorDialog.close());
// Inside the editor: ⌘Z / Ctrl+Z undoes the last brush stroke, [ and ] change the brush size.
els.frameEditorDialog.addEventListener('keydown', event => {
  if (event.target.matches?.('input[type="text"], input:not([type]), textarea')) return;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && editorMask?.strokes.length) { event.preventDefault(); els.undoStrokeButton.click(); return; }
  if ((event.key === '[' || event.key === ']') && editorTool !== 'corners') {
    event.preventDefault(); els.brushSize.value = clamp(Number(els.brushSize.value) + (event.key === ']' ? 1 : -1), Number(els.brushSize.min), Number(els.brushSize.max)); updateBrushPreview();
  }
});
els.undoStrokeButton.addEventListener('click', () => { if (editorMask?.strokes.length) { editorMask.strokes.pop(); redrawCutoutMask(); } });
els.clearCutoutButton.addEventListener('click', () => { editorMask = null; setEditorTool('corners'); setCutoutStatus(''); buildCutoutPreview(); });
els.fitCornersButton.addEventListener('click', () => { if (fitCornersToCutout()) setEditorTool('corners'); });

// Puts the four crop corners on the bounding box of what the cutout keeps.
function fitCornersToCutout() {
  if (!cutoutPreview) return false;
  const { width, height, maskContext } = cutoutPreview, mask = maskContext.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (mask[(y * width + x) * 4] > 127) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
  }
  if (right < left || bottom < top) return false;
  const l = left / width, t = top / height, r = (right + 1) / width, b = (bottom + 1) / height;
  cropDraft = [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }]; syncCropPolygon(); return true;
}
const isFullCrop = corners => corners.every((point, index) => Math.abs(point.x - fullCropCorners()[index].x) < .002 && Math.abs(point.y - fullCropCorners()[index].y) < .002);

function blobFromUrl(url, maxSide) {
  return imageFromUrl(url, 'The frame photo').then(image => new Promise((resolve, reject) => {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) });
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the photo.')), 'image/jpeg', .92);
  }));
}
const blobToDataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });

els.removeBackgroundButton.addEventListener('click', async () => {
  const artId = editingArtId, draftUrl = editorDraftUrl, button = els.removeBackgroundButton, label = button.querySelector('span');
  if (button.disabled) return;
  const busy = on => { [button, els.redetectButton, els.clearCutoutButton].forEach(control => { control.disabled = on; }); label.textContent = on ? 'Removing background…' : 'Remove background'; };
  busy(true); setCutoutStatus('Finding the object… this takes a few seconds.');
  let poll = null;
  try {
    const status = await fetch('/api/background-removal/status').then(response => response.json()).catch(() => null);
    if (!status) throw new Error('The local server isn’t running. Start it with npm run dev.');
    if (!status.modelOnDisk) {
      setCutoutStatus('Downloading the background-removal model. This happens once and is about 930 MB…');
      poll = setInterval(async () => {
        const current = await fetch('/api/background-removal/status').then(response => response.json()).catch(() => null);
        if (current?.state === 'downloading' && current.totalBytes) setCutoutStatus(`Downloading the background-removal model (first time only): ${Math.round(100 * current.receivedBytes / current.totalBytes)}%`);
        else if (current?.state === 'loading') setCutoutStatus('Loading the model…');
        else if (current?.state === 'ready') setCutoutStatus('Finding the object…');
      }, 700);
    } else if (status.state !== 'ready') setCutoutStatus('Loading the model, then finding the object…');
    let response;
    try { response = await fetch('/api/background-removal', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await blobFromUrl(draftUrl, 2048) }); }
    catch { throw new Error('The local server isn’t running. Start it with npm run dev.'); }
    if (!response.ok) throw new Error(await response.text() || `The server returned ${response.status}.`);
    const maskUrl = await blobToDataUrl(await response.blob());
    if (editingArtId !== artId || editorDraftUrl !== draftUrl || !els.frameEditorDialog.open) return;
    editorMask = { maskUrl, strokes: [] }; await buildCutoutPreview();
    const fitted = isFullCrop(cropDraft) && fitCornersToCutout();
    setEditorTool('corners'); setCutoutStatus(fitted ? 'Done. The corners now hug the object.' : '');
  } catch (error) { setCutoutStatus(`Couldn’t remove the background. ${error.message}`); }
  finally { clearInterval(poll); busy(false); }
});

function isValidCropPolygon(points) {
  let direction = 0, area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index], next = points[(index + 1) % points.length], after = points[(index + 2) % points.length];
    area += current.x * next.y - next.x * current.y;
    const cross = (next.x - current.x) * (after.y - next.y) - (next.y - current.y) * (after.x - next.x);
    if (Math.abs(cross) < .0005) return false;
    const crossDirection = Math.sign(cross);
    if (direction && direction !== crossDirection) return false;
    direction = crossDirection;
  }
  return Math.abs(area) > .01;
}

async function rectifyDataUrl(url, corners) {
  const image = await imageFromUrl(url), sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth; sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true }); sourceContext.drawImage(image, 0, 0);
  const pixelDistance = (first, second) => Math.hypot((second.x - first.x) * image.naturalWidth, (second.y - first.y) * image.naturalHeight);
  let outputWidth = Math.max(1, Math.round((pixelDistance(corners[0], corners[1]) + pixelDistance(corners[3], corners[2])) / 2));
  let outputHeight = Math.max(1, Math.round((pixelDistance(corners[0], corners[3]) + pixelDistance(corners[1], corners[2])) / 2));
  const outputScale = Math.min(1, 2200 / Math.max(outputWidth, outputHeight), Math.sqrt(4000000 / (outputWidth * outputHeight)));
  outputWidth = Math.max(1, Math.round(outputWidth * outputScale)); outputHeight = Math.max(1, Math.round(outputHeight * outputScale));
  const source = sourceContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight), outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth; outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext('2d'), output = outputContext.createImageData(outputWidth, outputHeight), transform = squareToQuadrilateral(corners);
  for (let y = 0; y < outputHeight; y += 1) {
    const v = (y + .5) / outputHeight;
    for (let x = 0; x < outputWidth; x += 1) {
      const u = (x + .5) / outputWidth, denominator = transform.g * u + transform.h * v + 1;
      const sourceX = clamp(((transform.a * u + transform.b * v + transform.c) / denominator) * (image.naturalWidth - 1), 0, image.naturalWidth - 1);
      const sourceY = clamp(((transform.d * u + transform.e * v + transform.f) / denominator) * (image.naturalHeight - 1), 0, image.naturalHeight - 1);
      const x0 = Math.floor(sourceX), y0 = Math.floor(sourceY), x1 = Math.min(x0 + 1, image.naturalWidth - 1), y1 = Math.min(y0 + 1, image.naturalHeight - 1);
      const weightX = sourceX - x0, weightY = sourceY - y0, destinationIndex = (y * outputWidth + x) * 4;
      const topLeft = (y0 * image.naturalWidth + x0) * 4, topRight = (y0 * image.naturalWidth + x1) * 4;
      const bottomLeft = (y1 * image.naturalWidth + x0) * 4, bottomRight = (y1 * image.naturalWidth + x1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source.data[topLeft + channel] * (1 - weightX) + source.data[topRight + channel] * weightX;
        const bottom = source.data[bottomLeft + channel] * (1 - weightX) + source.data[bottomRight + channel] * weightX;
        output.data[destinationIndex + channel] = top * (1 - weightY) + bottom * weightY;
      }
    }
  }
  outputContext.putImageData(output, 0, 0); return outputCanvas.toDataURL('image/png');
}

function squareToQuadrilateral([topLeft, topRight, bottomRight, bottomLeft]) {
  const dx1 = topRight.x - bottomRight.x, dx2 = bottomLeft.x - bottomRight.x, dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y, dy2 = bottomLeft.y - bottomRight.y, dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-8 || Math.abs(dy3) > 1e-8) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-8) throw new Error('The crop corners are too close together.');
    g = (dx3 * dy2 - dx2 * dy3) / denominator; h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return {
    a: topRight.x - topLeft.x + g * topRight.x, b: bottomLeft.x - topLeft.x + h * bottomLeft.x, c: topLeft.x,
    d: topRight.y - topLeft.y + g * topRight.y, e: bottomLeft.y - topLeft.y + h * bottomLeft.y, f: topLeft.y, g, h
  };
}

function nearlyEqual(first, second) { return Math.abs(Number(first) - Number(second)) < .0001; }

function rotatePlacedCopies(artId) {
  state.placed.filter(item => item.artId === artId).forEach(item => {
    const centerX = item.x + item.width / 2, centerY = item.y + item.height / 2;
    [item.width, item.height] = [item.height, item.width];
    item.x = clamp(centerX - item.width / 2, 0, els.stage.clientWidth - item.width);
    item.y = clamp(centerY - item.height / 2, 0, els.stage.clientHeight - item.height);
  });
}

function resizePlacedCopies(art) {
  const naturalToDisplay = els.stage.clientWidth / state.naturalWidth;
  const unitFactor = art.unit === state.unit ? 1 : art.unit === 'in' ? 2.54 : 1 / 2.54;
  const width = art.width * unitFactor * state.pixelsPerUnit * naturalToDisplay;
  const height = art.height * unitFactor * state.pixelsPerUnit * naturalToDisplay;
  state.placed.filter(item => item.artId === art.id).forEach(item => {
    const centerX = item.x + item.width / 2, centerY = item.y + item.height / 2;
    item.width = width; item.height = height;
    item.x = clamp(centerX - width / 2, 0, els.stage.clientWidth - width);
    item.y = clamp(centerY - height / 2, 0, els.stage.clientHeight - height);
  });
}

// Other walls store placements as fractions of their photo, so size frames from each wall's own calibration.
function resizeOnOtherWalls(art) {
  state.walls.forEach(wall => {
    if (wall.id === state.activeWallId || !wall.pixelsPerUnit || !wall.naturalWidth) return;
    const unitFactor = art.unit === wall.unit ? 1 : art.unit === 'in' ? 2.54 : 1 / 2.54;
    const width = art.width * unitFactor * wall.pixelsPerUnit / wall.naturalWidth, height = art.height * unitFactor * wall.pixelsPerUnit / wall.naturalHeight;
    (wall.placed || []).filter(item => item.artId === art.id).forEach(item => {
      const centerX = item.x + item.width / 2, centerY = item.y + item.height / 2;
      item.width = width; item.height = height;
      item.x = clamp(centerX - width / 2, 0, Math.max(0, 1 - width)); item.y = clamp(centerY - height / 2, 0, Math.max(0, 1 - height));
    });
  });
}

// ---- Selection ----------------------------------------------------------
// Frames can be selected one at a time (click), added or removed with Shift-click,
// or picked up in a block by dragging a box across the wall.
function selectedItems() { return state.placed.filter(item => state.selection.has(item.id)); }

function setSelection(ids) {
  state.selection = new Set(ids);
  els.placedArt.querySelectorAll('.placed-frame').forEach(frame => frame.classList.toggle('selected', state.selection.has(frame.dataset.id)));
  updateSelectionStatus();
}

function updateSelectionStatus() {
  const count = selectedItems().length;
  els.selectionStatus.hidden = count < 2; els.canvasHint.hidden = count >= 2;
  if (count >= 2) els.selectionStatus.textContent = `${count} frames selected · drag to move together`;
}

// Moves a group by (dx, dy) on-screen pixels, stopping at the wall edges so the block keeps its shape.
function clampGroupDelta(items, dx, dy) {
  const left = Math.min(...items.map(item => item.x)), top = Math.min(...items.map(item => item.y));
  const right = Math.max(...items.map(item => item.x + item.width)), bottom = Math.max(...items.map(item => item.y + item.height));
  return { dx: clamp(dx, -left, Math.max(-left, els.stage.clientWidth - right)), dy: clamp(dy, -top, Math.max(-top, els.stage.clientHeight - bottom)) };
}

const isAdditive = event => event.shiftKey || event.metaKey || event.ctrlKey;
let drag = null;
function beginFrameDrag(event) {
  if (event.button !== 0 || spaceHeld) return;
  const frame = event.currentTarget, item = state.placed.find(p => p.id === frame.dataset.id); if (!item) return;
  if (isAdditive(event)) {
    const next = new Set(state.selection); if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
    setSelection(next); event.preventDefault(); return;
  }
  const wasInGroup = state.selection.has(item.id) && state.selection.size > 1;
  if (!state.selection.has(item.id)) setSelection([item.id]);
  const items = selectedItems();
  drag = { item, items, wasInGroup, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0,
    elements: items.map(selected => els.placedArt.querySelector(`.placed-frame[data-id="${selected.id}"]`)).filter(Boolean) };
  frame.setPointerCapture(event.pointerId); drag.elements.forEach(element => element.classList.add('dragging'));
  frame.addEventListener('pointermove', moveFrame); frame.addEventListener('pointerup', endFrame, { once: true }); frame.addEventListener('pointercancel', endFrame, { once: true });
}
function moveFrame(event) {
  if (!drag) return;
  Object.assign(drag, clampGroupDelta(drag.items, (event.clientX - drag.startX) / state.zoom, (event.clientY - drag.startY) / state.zoom));
  drag.elements.forEach(element => { element.style.transform = `translate3d(${drag.dx}px, ${drag.dy}px, 0)`; });
}
function endFrame(event) {
  event.currentTarget.removeEventListener('pointermove', moveFrame);
  if (!drag) return;
  const moved = drag.dx !== 0 || drag.dy !== 0;
  if (moved) drag.items.forEach(item => { item.x += drag.dx; item.y += drag.dy; });
  drag.elements.forEach(element => element.classList.remove('dragging'));
  // A plain click (no drag) on a frame inside a group narrows the selection to that frame.
  if (!moved && drag.wasInGroup) setSelection([drag.item.id]);
  drag = null;
  if (moved) { renderPlaced(); queueSave(); }
}

// Drag across empty wall to draw a selection box. Shift-drag adds to the current selection.
let marquee = null;
els.stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || spaceHeld || !state.wallUrl || event.target.closest('.placed-frame') || els.measurementLayer.classList.contains('is-drawing')) return;
  const rect = els.stage.getBoundingClientRect(), x = (event.clientX - rect.left) / state.zoom, y = (event.clientY - rect.top) / state.zoom;
  const base = isAdditive(event) ? new Set(state.selection) : new Set();
  if (!isAdditive(event)) setSelection([]);
  const box = document.createElement('div'); box.className = 'selection-box'; box.style.borderWidth = `${1 / state.zoom}px`; box.hidden = true;
  els.stage.append(box);
  marquee = { x, y, base, box, rect, pointerId: event.pointerId };
  els.stage.setPointerCapture(event.pointerId); event.preventDefault();
});
els.stage.addEventListener('pointermove', event => {
  if (!marquee) return;
  const x = clamp((event.clientX - marquee.rect.left) / state.zoom, 0, els.stage.clientWidth), y = clamp((event.clientY - marquee.rect.top) / state.zoom, 0, els.stage.clientHeight);
  const left = Math.min(marquee.x, x), top = Math.min(marquee.y, y), width = Math.abs(x - marquee.x), height = Math.abs(y - marquee.y);
  if (marquee.box.hidden && width * state.zoom < 3 && height * state.zoom < 3) return;
  marquee.box.hidden = false; Object.assign(marquee.box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  const hits = state.placed.filter(item => item.x < left + width && item.x + item.width > left && item.y < top + height && item.y + item.height > top).map(item => item.id);
  setSelection([...marquee.base, ...hits]);
});
function endMarquee(event) {
  if (!marquee) return;
  if (els.stage.hasPointerCapture?.(event.pointerId)) els.stage.releasePointerCapture(event.pointerId);
  marquee.box.remove(); marquee = null;
}
els.stage.addEventListener('pointerup', endMarquee); els.stage.addEventListener('pointercancel', endMarquee);

// Clicking outside the wall clears the selection, so Delete/Backspace can't remove frames you're no longer looking at.
// The toolbar above the wall (zoom, distances, tabs) keeps it.
document.addEventListener('pointerdown', event => {
  if (!state.selection.size || event.target.closest?.('.placed-frame, #stage, .workspace-tools')) return;
  setSelection([]);
});

// Space + drag pans when zoomed, like most design tools.
let spaceHeld = false;
const typingTarget = element => element && (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(element.tagName) || element.isContentEditable);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || typingTarget(document.activeElement) || document.querySelector('dialog[open]')) return;
  event.preventDefault(); if (!spaceHeld) { spaceHeld = true; els.stageWrap.classList.add('space-pan'); }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { spaceHeld = false; els.stageWrap.classList.remove('space-pan'); } });
window.addEventListener('blur', () => { spaceHeld = false; els.stageWrap.classList.remove('space-pan'); });

document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || !state.wallUrl) return;
  const active = document.activeElement;
  if (active && active !== document.body && !active.classList.contains('placed-frame')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(state.placed.map(item => item.id)); return; }
  const items = selectedItems(); if (!items.length) return;
  if (event.key === 'Escape') { setSelection([]); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault(); state.placed = state.placed.filter(item => !state.selection.has(item.id)); state.selection = new Set(); renderPlaced(); queueSave(); return;
  }
  const step = event.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]; if (!moves) return;
  event.preventDefault();
  const { dx, dy } = clampGroupDelta(items, moves[0], moves[1]);
  items.forEach(item => { item.x += dx; item.y += dy; }); renderPlaced(); queueSave({ coalesce: 'nudge' });
});

// ---- Undo / redo ------------------------------------------------------------
// History holds snapshots of the project's content (frames + every wall) after each edit.
// Image data URLs are shared strings, so snapshots are cheap. Each entry remembers which wall
// was showing, so undo/redo jumps to the wall where the change happened.
const undoHistory = { entries: [], index: -1, coalesceKey: null, coalesceAt: 0, busy: false };
const HISTORY_LIMIT = 100;

function cloneContent(source) {
  return {
    art: source.art.map(art => ({ ...art, cropCorners: art.cropCorners?.map(point => ({ ...point })) })),
    walls: source.walls.map(wall => ({ ...wall, scaleLine: wall.scaleLine ? { ...wall.scaleLine } : null, placed: (wall.placed || []).map(item => ({ ...item })) }))
  };
}

// Positions round-trip through on-screen pixels, so compare numbers with a small tolerance.
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => sameValue(a[key], b[key]));
}

function clearHistory() { undoHistory.entries = []; undoHistory.index = -1; undoHistory.coalesceKey = null; updateHistoryButtons(); }

function resetHistory() {
  serializeActiveWall();
  undoHistory.entries = [{ ...cloneContent(state), wallId: state.activeWallId }]; undoHistory.index = 0; undoHistory.coalesceKey = null; updateHistoryButtons();
}

function recordHistory(coalesceKey) {
  if (!state.projectId || undoHistory.busy) return;
  if (undoHistory.index < 0) { resetHistory(); return; }
  serializeActiveWall();
  const content = cloneContent(state), current = undoHistory.entries[undoHistory.index];
  if (sameValue(content, { art: current.art, walls: current.walls })) return;
  const entry = { ...content, wallId: state.activeWallId }, now = Date.now();
  const atEnd = undoHistory.index === undoHistory.entries.length - 1;
  if (coalesceKey && coalesceKey === undoHistory.coalesceKey && atEnd && undoHistory.index > 0 && now - undoHistory.coalesceAt < 1500) undoHistory.entries[undoHistory.index] = entry;
  else {
    undoHistory.entries.splice(undoHistory.index + 1); undoHistory.entries.push(entry);
    if (undoHistory.entries.length > HISTORY_LIMIT) undoHistory.entries.shift();
    undoHistory.index = undoHistory.entries.length - 1;
  }
  undoHistory.coalesceKey = coalesceKey; undoHistory.coalesceAt = now; updateHistoryButtons();
}

async function applyHistory(targetIndex, wallId) {
  if (undoHistory.busy || drag || marquee) return;
  undoHistory.busy = true;
  const entry = undoHistory.entries[targetIndex], content = cloneContent(entry);
  const previousWallId = state.activeWallId, previousSelection = [...state.selection];
  const zoom = state.zoom, scroll = [els.stageWrap.scrollLeft, els.stageWrap.scrollTop];
  try {
    undoHistory.index = targetIndex; undoHistory.coalesceKey = null;
    state.art = content.art; state.walls = content.walls;
    const wall = state.walls.find(candidate => candidate.id === wallId) || state.walls.find(candidate => candidate.id === entry.wallId) || state.walls[0];
    els.frameEditorDialog.open && els.frameEditorDialog.close();
    await showWall(wall);
    if (wall.id === previousWallId) {
      // Stay where the user was looking, and keep any selected frames that still exist.
      setZoom(zoom); els.stageWrap.scrollLeft = scroll[0]; els.stageWrap.scrollTop = scroll[1];
      setSelection(previousSelection.filter(id => state.placed.some(item => item.id === id)));
    }
  } catch (error) { console.warn('Could not restore that step.', error); }
  finally { undoHistory.busy = false; updateHistoryButtons(); queueSave({ record: false }); }
}

function undo() { if (undoHistory.index > 0) applyHistory(undoHistory.index - 1, undoHistory.entries[undoHistory.index].wallId); }
function redo() { if (undoHistory.index < undoHistory.entries.length - 1) applyHistory(undoHistory.index + 1, undoHistory.entries[undoHistory.index + 1].wallId); }

const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
function updateHistoryButtons() {
  if (!els.undoButton) return;
  els.undoButton.disabled = undoHistory.index <= 0; els.redoButton.disabled = undoHistory.index < 0 || undoHistory.index >= undoHistory.entries.length - 1;
  els.undoButton.title = `Undo (${shortcutModifier}Z)`; els.redoButton.title = `Redo (${shortcutModifier === '⌘' ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`;
}
els.undoButton.addEventListener('click', undo); els.redoButton.addEventListener('click', redo);

// ⌘Z / Ctrl+Z undo; ⇧⌘Z, Ctrl+Shift+Z or Ctrl+Y redo. Text fields keep their own native undo.
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase(), isUndo = key === 'z' && !event.shiftKey, isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey);
  if (!isUndo && !isRedo) return;
  const active = document.activeElement;
  if (document.querySelector('dialog[open]') || (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable))) return;
  event.preventDefault(); if (isUndo) undo(); else redo();
});
updateHistoryButtons();

function setZoom(value) {
  state.zoom = Math.max(.5, Math.min(5, value));
  els.stage.style.transform = `scale(${state.zoom})`; els.stage.style.transformOrigin = state.zoom > 1 ? 'top left' : 'center center';
  els.stageWrap.classList.toggle('is-zoomed', state.zoom > 1); els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`; renderSpacing();
}
els.zoomIn.addEventListener('click', () => setZoom(state.zoom + .25)); els.zoomOut.addEventListener('click', () => setZoom(state.zoom - .25));

let panDrag = null;
function canBeginPan(event) {
  if (state.zoom <= 1 || els.measurementLayer.classList.contains('is-drawing')) return false;
  if (event.button === 1 || (event.button === 0 && spaceHeld)) return true;
  return event.button === 0 && !event.target.closest('#stage');
}
function beginPan(event) {
  if (panDrag || !canBeginPan(event)) return;
  panDrag = { x: event.clientX, y: event.clientY, scrollLeft: els.stageWrap.scrollLeft, scrollTop: els.stageWrap.scrollTop };
  els.stageWrap.classList.add('is-panning'); event.preventDefault();
}
function movePan(event) {
  if (!panDrag) return;
  els.stageWrap.scrollLeft = panDrag.scrollLeft - (event.clientX - panDrag.x);
  els.stageWrap.scrollTop = panDrag.scrollTop - (event.clientY - panDrag.y);
}
function endPan() {
  if (!panDrag) return;
  panDrag = null; els.stageWrap.classList.remove('is-panning');
}
els.stageWrap.addEventListener('pointerdown', beginPan); document.addEventListener('pointermove', movePan); document.addEventListener('pointerup', endPan); document.addEventListener('pointercancel', endPan);
els.stageWrap.addEventListener('mousedown', beginPan); document.addEventListener('mousemove', movePan); document.addEventListener('mouseup', endPan);

els.exportButton.addEventListener('click', async () => {
  els.exportButton.disabled = true; els.exportButton.textContent = 'Saving…';
  try { await exportWall(); }
  catch (error) { window.alert(`Could not save the image. ${error.message}`); }
  finally { els.exportButton.disabled = false; els.exportButton.textContent = 'Save image'; }
});
async function exportWall() {
  const canvas = document.createElement('canvas'); canvas.width = state.naturalWidth; canvas.height = state.naturalHeight;
  const ctx = canvas.getContext('2d'); const wall = await imageFromUrl(state.wallUrl, 'The wall photo'); ctx.drawImage(wall, 0, 0, canvas.width, canvas.height);
  const ratio = state.naturalWidth / els.stage.clientWidth;
  for (const item of state.placed) {
    const art = state.art.find(a => a.id === item.artId); if (!art) continue;
    const img = await imageFromUrl(art.url, art.name);
    const x = item.x * ratio, y = item.y * ratio, width = item.width * ratio, height = item.height * ratio;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ensureCrop(art); ctx.translate(x + width / 2, y + height / 2); ctx.rotate((art.rotation || 0) * Math.PI / 180);
    ctx.drawImage(img, art.cropLeft * img.naturalWidth, art.cropTop * img.naturalHeight, art.cropWidth * img.naturalWidth, art.cropHeight * img.naturalHeight, -width / 2, -height / 2, width, height); ctx.restore();
  }
  const link = document.createElement('a'); link.download = `${[state.projectName, activeWall()?.name].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').trim() || 'gallery-wall-plan'}.png`; link.href = canvas.toDataURL('image/png'); link.click();
}
function imageFromUrl(url, label = 'an image') {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${label === 'an image' ? 'An image' : `“${label}”`} could not be loaded.`)); img.src = url;
  });
}

els.resetButton.addEventListener('click', () => els.confirmDialog.showModal());
els.confirmDialog.addEventListener('close', async () => {
  if (els.confirmDialog.returnValue !== 'confirm') return;
  clearTimeout(saveTimer);
  els.resetButton.disabled = true;
  els.resetButton.textContent = 'Saving…';
  const saved = await saveCurrentProject();
  if (!saved) {
    els.resetButton.disabled = false;
    els.resetButton.textContent = 'New wall';
    window.alert('This wall could not be saved, so it is still open. Try again before starting a new wall.');
    return;
  }
  location.reload();
});
async function handleWallFile(file) {
  try { await loadWall(file); }
  catch (error) { window.alert(`Could not open ${file?.name || 'that photo'}. ${error.message}`); }
}
els.wallInput.addEventListener('change', () => { handleWallFile(els.wallInput.files[0]); els.wallInput.value = ''; });
els.wallInputEmpty.addEventListener('change', () => { handleWallFile(els.wallInputEmpty.files[0]); els.wallInputEmpty.value = ''; });
els.addWallButton.addEventListener('click', addWall);
els.planTab.addEventListener('click', () => switchSidebarTab('plan'));
els.historyTab.addEventListener('click', () => switchSidebarTab('history'));
els.gridViewButton.addEventListener('click', () => setProjectView('grid'));
els.listViewButton.addEventListener('click', () => setProjectView('list'));
function setProjectView(view) {
  els.projectLibrary.className = `project-library ${view}-view`;
  els.gridViewButton.classList.toggle('is-active', view === 'grid'); els.listViewButton.classList.toggle('is-active', view === 'list');
  localStorage.setItem('gallery-wall-project-view', view);
}
setProjectView(localStorage.getItem('gallery-wall-project-view') === 'list' ? 'list' : 'grid');
moveBrowserProjectsToRepo().catch(error => console.warn('Could not move browser projects into the repo.', error));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refitStage, 120); });
// Placed frames and the scale line are stored in on-screen pixels, so scale them with the stage to keep them in the same spot on the wall.
function refitStage() {
  if (!state.wallUrl || els.stage.hidden) return;
  const oldWidth = els.stage.clientWidth, oldHeight = els.stage.clientHeight; fitStage();
  const scaleX = els.stage.clientWidth / oldWidth, scaleY = els.stage.clientHeight / oldHeight;
  if (!oldWidth || !oldHeight || (scaleX === 1 && scaleY === 1)) return;
  state.placed.forEach(item => { item.x *= scaleX; item.y *= scaleY; item.width *= scaleX; item.height *= scaleY; });
  if (state.scaleLine) { state.scaleLine.x1 *= scaleX; state.scaleLine.x2 *= scaleX; state.scaleLine.y1 *= scaleY; state.scaleLine.y2 *= scaleY; }
  if (state.scaleLine && els.measurementLine.getAttribute('visibility') === 'visible') setLine(state.scaleLine);
  renderPlaced();
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
