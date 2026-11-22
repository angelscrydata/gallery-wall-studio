const $ = (selector) => document.querySelector(selector);
const state = {
  wallUrl: null, naturalWidth: 0, naturalHeight: 0,
  scaleLine: null, pixelsPerUnit: null, unit: 'cm',
  art: [], placed: [], selectedId: null, zoom: 1,
  projectId: null, projectName: null, updatedAt: null
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
  exportButton: $('#exportButton'), resetButton: $('#resetButton'), confirmDialog: $('#confirmDialog'),
  planTab: $('#planTab'), historyTab: $('#historyTab'), planPanel: $('#planPanel'), historyPanel: $('#historyPanel'),
  projectLibrary: $('#projectLibrary'), gridViewButton: $('#gridViewButton'), listViewButton: $('#listViewButton'),
  frameEditorDialog: $('#frameEditorDialog'), frameEditorForm: $('#frameEditorForm'), editorClose: $('#editorClose'),
  editorPreview: $('#editorPreview'), editorPreviewImage: $('#editorPreviewImage'), cropZoom: $('#cropZoom'),
  cropX: $('#cropX'), cropY: $('#cropY'), frameRotation: $('#frameRotation'), cropZoomOutput: $('#cropZoomOutput'),
  rotationOutput: $('#rotationOutput'), editorReset: $('#editorReset')
};

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('gallery-wall-studio', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});

async function projectStore(mode, action) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', mode); const store = transaction.objectStore('projects');
    const request = action(store); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

const putProject = project => projectStore('readwrite', store => store.put(project));
const getAllProjects = () => projectStore('readonly', store => store.getAll());
let saveTimer;
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentProject, 250); }

async function saveCurrentProject() {
  if (!state.projectId || !state.wallUrl || !els.stage.clientWidth) return;
  const stageWidth = els.stage.clientWidth, stageHeight = els.stage.clientHeight;
  const project = {
    id: state.projectId, name: state.projectName || 'Untitled wall', updatedAt: Date.now(), wallUrl: state.wallUrl,
    naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight, unit: state.unit,
    knownLength: Number(els.knownLength.value) || null, pixelsPerUnit: state.pixelsPerUnit,
    scaleLine: state.scaleLine ? { x1: state.scaleLine.x1 / stageWidth, y1: state.scaleLine.y1 / stageHeight, x2: state.scaleLine.x2 / stageWidth, y2: state.scaleLine.y2 / stageHeight } : null,
    art: state.art, placed: state.placed.map(item => ({ id: item.id, artId: item.artId, x: item.x / stageWidth, y: item.y / stageHeight, width: item.width / stageWidth, height: item.height / stageHeight, cropZoom: item.cropZoom || 1, cropX: item.cropX || 0, cropY: item.cropY || 0, rotation: item.rotation || 0 }))
  };
  state.updatedAt = project.updatedAt;
  try { await putProject(project); if (!els.historyPanel.hidden) renderProjects(); } catch (error) { console.warn('Could not save project', error); }
}

async function loadWall(file, newProject = false) {
  if (!file) return;
  const url = await readFile(file);
  const probe = new Image();
  probe.onload = () => {
    if (newProject || !state.projectId) {
      state.projectId = crypto.randomUUID(); state.projectName = file.name.replace(/\.[^.]+$/, '') || 'Untitled wall';
      state.art = [];
    }
    state.wallUrl = url; state.naturalWidth = probe.naturalWidth; state.naturalHeight = probe.naturalHeight;
    state.scaleLine = null; state.pixelsPerUnit = null; state.placed = []; state.zoom = 1;
    els.wallImage.src = url; els.emptyState.hidden = true; els.stage.hidden = false;
    fitStage(); clearMeasurement(); renderPlaced();
    els.calibrationStep.classList.remove('is-disabled');
    [els.drawScaleButton, els.knownLength, els.unitSelect].forEach(el => el.disabled = false);
    els.applyScaleButton.disabled = true; els.artStep.classList.add('is-disabled'); els.artInput.disabled = true;
    els.canvasHint.textContent = 'Next, draw across the object of known length'; els.wallInputLabel.textContent = 'Replace wall photo';
    els.exportButton.disabled = false; els.zoomIn.disabled = false; els.zoomOut.disabled = false; setZoom(1);
    renderLibrary(); queueSave();
  };
  probe.src = url;
}

function fitStage() {
  const maxW = Math.max(300, els.stageWrap.clientWidth - 48), maxH = Math.max(300, els.stageWrap.clientHeight - 48);
  const ratio = Math.min(maxW / state.naturalWidth, maxH / state.naturalHeight, 1);
  els.stage.style.width = `${Math.round(state.naturalWidth * ratio)}px`;
  els.stage.style.height = `${Math.round(state.naturalHeight * ratio)}px`;
}

async function openSavedProject(project) {
  const probe = new Image();
  await new Promise((resolve, reject) => { probe.onload = resolve; probe.onerror = reject; probe.src = project.wallUrl; });
  state.projectId = project.id; state.projectName = project.name; state.updatedAt = project.updatedAt;
  state.wallUrl = project.wallUrl; state.naturalWidth = project.naturalWidth || probe.naturalWidth; state.naturalHeight = project.naturalHeight || probe.naturalHeight;
  state.unit = project.unit || 'cm'; state.pixelsPerUnit = project.pixelsPerUnit || null; state.art = project.art || []; state.zoom = 1; state.selectedId = null;
  els.wallImage.src = state.wallUrl; els.emptyState.hidden = true; els.stage.hidden = false; fitStage();
  const stageWidth = els.stage.clientWidth, stageHeight = els.stage.clientHeight;
  state.scaleLine = project.scaleLine ? { x1: project.scaleLine.x1 * stageWidth, y1: project.scaleLine.y1 * stageHeight, x2: project.scaleLine.x2 * stageWidth, y2: project.scaleLine.y2 * stageHeight } : null;
  state.placed = (project.placed || []).map(item => ({ id: item.id, artId: item.artId, x: item.x * stageWidth, y: item.y * stageHeight, width: item.width * stageWidth, height: item.height * stageHeight, cropZoom: item.cropZoom || 1, cropX: item.cropX || 0, cropY: item.cropY || 0, rotation: item.rotation || 0 }));
  els.knownLength.value = project.knownLength || ''; els.unitSelect.value = state.unit; updateUnitLabels(); clearMeasurement();
  els.calibrationStep.classList.remove('is-disabled'); [els.drawScaleButton, els.knownLength, els.unitSelect].forEach(el => el.disabled = false);
  els.applyScaleButton.disabled = !state.scaleLine; els.artStep.classList.toggle('is-disabled', !state.pixelsPerUnit); els.artInput.disabled = !state.pixelsPerUnit;
  els.scaleStatus.textContent = state.pixelsPerUnit ? `Scale set · ${state.pixelsPerUnit.toFixed(1)} px per ${state.unit}` : '';
  els.canvasHint.textContent = state.pixelsPerUnit ? 'Add framed art, then drag it onto the wall' : 'Next, draw across the object of known length';
  els.wallInputLabel.textContent = 'Replace wall photo'; els.exportButton.disabled = false; els.zoomIn.disabled = false; els.zoomOut.disabled = false; setZoom(1);
  renderLibrary(); renderPlaced(); switchSidebarTab('plan');
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
  try { projects = (await getAllProjects()).sort((a, b) => b.updatedAt - a.updatedAt); } catch (error) { console.warn('Could not load projects', error); }
  if (!projects.length) { els.projectLibrary.innerHTML = '<p class="empty-projects">Walls you work on will appear here automatically.</p>'; return; }
  els.projectLibrary.innerHTML = '';
  projects.forEach(project => {
    const card = document.createElement('article'); card.className = 'project-card';
    card.innerHTML = `<button class="project-open" type="button"><img class="project-thumb" src="${project.wallUrl}" alt=""><span class="project-meta"><span class="project-name">${escapeHtml(project.name)}</span><span class="project-date">${formatProjectDate(project.updatedAt)}</span></span></button><button class="project-rename" type="button">Rename</button>`;
    card.querySelector('.project-open').onclick = () => openSavedProject(project);
    card.querySelector('.project-rename').onclick = () => showRenameForm(card, project);
    els.projectLibrary.append(card);
  });
}

function showRenameForm(card, project) {
  const oldButton = card.querySelector('.project-rename');
  const form = document.createElement('form'); form.className = 'project-rename-form';
  form.innerHTML = `<input aria-label="Wall name" maxlength="80"><button type="submit">Save</button>`;
  const input = form.querySelector('input'); input.value = project.name; oldButton.replaceWith(form); input.focus(); input.select();
  form.onsubmit = async event => {
    event.preventDefault(); const name = input.value.trim(); if (!name) return;
    project.name = name; project.updatedAt = Date.now(); await putProject(project);
    if (state.projectId === project.id) { state.projectName = name; state.updatedAt = project.updatedAt; }
    renderProjects();
  };
}

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
els.knownLength.addEventListener('input', () => { els.applyScaleButton.disabled = !(state.scaleLine && Number(els.knownLength.value) > 0); queueSave(); });
els.unitSelect.addEventListener('change', () => {
  updateUnitLabels();
  if (state.pixelsPerUnit) {
    state.pixelsPerUnit = null;
    els.artStep.classList.add('is-disabled'); els.artInput.disabled = true;
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
  els.scaleStatus.textContent = `Scale set · ${state.pixelsPerUnit.toFixed(1)} px per ${state.unit}`;
  [els.measurementLine, els.measureStart, els.measureEnd].forEach(el => el.setAttribute('visibility', 'hidden'));
  els.artStep.classList.remove('is-disabled'); els.artInput.disabled = false;
  els.canvasHint.textContent = 'Add framed art, then drag it onto the wall';
  queueSave();
});

els.artInput.addEventListener('change', async () => {
  for (const file of [...els.artInput.files]) await createPendingArt(file);
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
    state.art.push({ id, url, name: file.name, width, height, unit: state.unit }); card.remove(); renderLibrary(); queueSave();
  };
  els.pendingArt.append(card);
}

function renderLibrary() {
  els.frameCount.textContent = state.art.length;
  if (!state.art.length) { els.artLibrary.innerHTML = '<div class="empty-library">Your scaled frames will appear here.</div>'; return; }
  els.artLibrary.innerHTML = '';
  state.art.forEach(art => {
    const el = document.createElement('div'); el.className = 'library-frame'; el.draggable = true; el.tabIndex = 0;
    el.innerHTML = `<img src="${art.url}" alt="${escapeHtml(art.name)}"><span>${art.width} × ${art.height} ${art.unit}</span>`;
    el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', art.id));
    el.addEventListener('dblclick', () => placeAtCenter(art.id));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') placeAtCenter(art.id); });
    els.artLibrary.append(el);
  });
}

els.stage.addEventListener('dragover', e => e.preventDefault());
els.stage.addEventListener('drop', e => {
  e.preventDefault(); const artId = e.dataTransfer.getData('text/plain'); if (!artId) return;
  const rect = els.stage.getBoundingClientRect(); placeArt(artId, (e.clientX - rect.left) / state.zoom, (e.clientY - rect.top) / state.zoom);
});
function placeAtCenter(artId) { placeArt(artId, els.stage.clientWidth / 2, els.stage.clientHeight / 2); }
function placeArt(artId, centerX, centerY) {
  const art = state.art.find(a => a.id === artId); if (!art) return;
  const naturalToDisplay = els.stage.clientWidth / state.naturalWidth;
  const width = art.width * state.pixelsPerUnit * naturalToDisplay, height = art.height * state.pixelsPerUnit * naturalToDisplay;
  const placed = { id: crypto.randomUUID(), artId, x: centerX - width / 2, y: centerY - height / 2, width, height, cropZoom: 1, cropX: 0, cropY: 0, rotation: 0 };
  placed.x = Math.max(0, Math.min(els.stage.clientWidth - width, placed.x)); placed.y = Math.max(0, Math.min(els.stage.clientHeight - height, placed.y));
  state.placed.push(placed); state.selectedId = placed.id; renderPlaced(); queueSave();
}

function renderPlaced() {
  els.placedArt.innerHTML = '';
  state.placed.forEach(item => {
    const art = state.art.find(a => a.id === item.artId); if (!art) return;
    const frame = document.createElement('div'); frame.className = 'placed-frame'; frame.dataset.id = item.id; frame.tabIndex = 0;
    const img = document.createElement('img'); img.src = art.url; img.alt = art.name; img.draggable = false; img.className = 'placed-frame-image'; img.style.transform = frameImageTransform(item);
    Object.assign(frame.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
    frame.append(img); frame.addEventListener('pointerdown', beginFrameDrag);
    frame.addEventListener('click', () => { state.selectedId = item.id; }); frame.addEventListener('dblclick', () => openFrameEditor(item.id));
    els.placedArt.append(frame);
  });
}

function frameImageTransform(item) {
  return `translate(${item.cropX || 0}%, ${item.cropY || 0}%) rotate(${item.rotation || 0}deg) scale(${item.cropZoom || 1})`;
}

let editingFrameId = null;
function openFrameEditor(itemId) {
  const item = state.placed.find(placed => placed.id === itemId), art = item && state.art.find(candidate => candidate.id === item.artId);
  if (!item || !art) return;
  editingFrameId = itemId; els.editorPreviewImage.src = art.url; els.editorPreview.style.aspectRatio = `${item.width} / ${item.height}`;
  els.cropZoom.value = Math.round((item.cropZoom || 1) * 100); els.cropX.value = item.cropX || 0; els.cropY.value = item.cropY || 0; els.frameRotation.value = item.rotation || 0;
  updateEditorPreview(); els.frameEditorDialog.showModal();
}

function updateEditorPreview() {
  const draft = { cropZoom: Number(els.cropZoom.value) / 100, cropX: Number(els.cropX.value), cropY: Number(els.cropY.value), rotation: Number(els.frameRotation.value) };
  els.editorPreviewImage.style.transform = frameImageTransform(draft); els.cropZoomOutput.textContent = `${els.cropZoom.value}%`; els.rotationOutput.textContent = `${Number(els.frameRotation.value).toFixed(1)}°`;
}

[els.cropZoom, els.cropX, els.cropY, els.frameRotation].forEach(input => input.addEventListener('input', updateEditorPreview));
els.editorReset.addEventListener('click', () => { els.cropZoom.value = 100; els.cropX.value = 0; els.cropY.value = 0; els.frameRotation.value = 0; updateEditorPreview(); });
els.editorClose.addEventListener('click', () => els.frameEditorDialog.close());
els.frameEditorForm.addEventListener('submit', event => {
  event.preventDefault(); const item = state.placed.find(placed => placed.id === editingFrameId); if (!item) return;
  item.cropZoom = Number(els.cropZoom.value) / 100; item.cropX = Number(els.cropX.value); item.cropY = Number(els.cropY.value); item.rotation = Number(els.frameRotation.value);
  els.frameEditorDialog.close(); renderPlaced(); queueSave();
});

let drag = null;
function beginFrameDrag(event) {
  const item = state.placed.find(p => p.id === event.currentTarget.dataset.id); if (!item) return;
  state.selectedId = item.id; drag = { item, startX: event.clientX, startY: event.clientY, originX: item.x, originY: item.y };
  event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('dragging', 'selected');
  event.currentTarget.addEventListener('pointermove', moveFrame); event.currentTarget.addEventListener('pointerup', endFrame, { once: true });
}
function moveFrame(event) {
  if (!drag) return; const { item } = drag;
  drag.nextX = Math.max(0, Math.min(els.stage.clientWidth - item.width, drag.originX + (event.clientX - drag.startX) / state.zoom));
  drag.nextY = Math.max(0, Math.min(els.stage.clientHeight - item.height, drag.originY + (event.clientY - drag.startY) / state.zoom));
  event.currentTarget.style.transform = `translate3d(${drag.nextX - drag.originX}px, ${drag.nextY - drag.originY}px, 0)`;
}
function endFrame(event) {
  event.currentTarget.removeEventListener('pointermove', moveFrame);
  if (drag) { drag.item.x = drag.nextX ?? drag.originX; drag.item.y = drag.nextY ?? drag.originY; }
  drag = null; renderPlaced(); queueSave();
}

document.addEventListener('keydown', event => {
  if (!state.selectedId || ['INPUT','SELECT'].includes(document.activeElement.tagName)) return;
  const item = state.placed.find(p => p.id === state.selectedId); if (!item) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { state.placed = state.placed.filter(p => p.id !== item.id); state.selectedId = null; renderPlaced(); queueSave(); return; }
  const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') item.x -= step; else if (event.key === 'ArrowRight') item.x += step; else if (event.key === 'ArrowUp') item.y -= step; else if (event.key === 'ArrowDown') item.y += step; else return;
  event.preventDefault(); item.x = Math.max(0, Math.min(els.stage.clientWidth - item.width, item.x)); item.y = Math.max(0, Math.min(els.stage.clientHeight - item.height, item.y)); renderPlaced(); queueSave();
});

function setZoom(value) { state.zoom = Math.max(.5, Math.min(1.5, value)); els.stage.style.transform = `scale(${state.zoom})`; els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`; }
els.zoomIn.addEventListener('click', () => setZoom(state.zoom + .1)); els.zoomOut.addEventListener('click', () => setZoom(state.zoom - .1));

els.exportButton.addEventListener('click', async () => {
  const canvas = document.createElement('canvas'); canvas.width = state.naturalWidth; canvas.height = state.naturalHeight;
  const ctx = canvas.getContext('2d'); const wall = await imageFromUrl(state.wallUrl); ctx.drawImage(wall, 0, 0, canvas.width, canvas.height);
  const ratio = state.naturalWidth / els.stage.clientWidth;
  for (const item of state.placed) {
    const art = state.art.find(a => a.id === item.artId), img = await imageFromUrl(art.url);
    const x = item.x * ratio, y = item.y * ratio, width = item.width * ratio, height = item.height * ratio;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ctx.translate(x + width / 2 + (item.cropX || 0) * width / 100, y + height / 2 + (item.cropY || 0) * height / 100);
    ctx.rotate((item.rotation || 0) * Math.PI / 180); ctx.scale(item.cropZoom || 1, item.cropZoom || 1);
    ctx.drawImage(img, -width / 2, -height / 2, width, height); ctx.restore();
  }
  const link = document.createElement('a'); link.download = 'gallery-wall-plan.png'; link.href = canvas.toDataURL('image/png'); link.click();
});
function imageFromUrl(url) { return new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.src = url; }); }

els.resetButton.addEventListener('click', () => els.confirmDialog.showModal());
els.confirmDialog.addEventListener('close', () => { if (els.confirmDialog.returnValue === 'confirm') location.reload(); });
els.wallInput.addEventListener('change', () => loadWall(els.wallInput.files[0], false));
els.wallInputEmpty.addEventListener('change', () => loadWall(els.wallInputEmpty.files[0], true));
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
window.addEventListener('resize', () => { if (state.wallUrl && !state.placed.length) fitStage(); });
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
