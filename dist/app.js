const $ = (selector) => document.querySelector(selector);
const state = {
  wallUrl: null, naturalWidth: 0, naturalHeight: 0,
  scaleLine: null, pixelsPerUnit: null, unit: 'cm',
  art: [], placed: [], selectedId: null, zoom: 1
};

const els = {
  wallInput: $('#wallInput'), wallInputEmpty: $('#wallInputEmpty'), wallInputLabel: $('#wallInputLabel'),
  wallImage: $('#wallImage'), stage: $('#stage'), stageWrap: $('#stageWrap'), emptyState: $('#emptyState'),
  calibrationStep: $('#calibrationStep'), artStep: $('#artStep'), drawScaleButton: $('#drawScaleButton'),
  knownLength: $('#knownLength'), unitSelect: $('#unitSelect'), applyScaleButton: $('#applyScaleButton'),
  scaleStatus: $('#scaleStatus'), measurementLayer: $('#measurementLayer'), measurementLine: $('#measurementLine'),
  measureStart: $('#measureStart'), measureEnd: $('#measureEnd'), artInput: $('#artInput'),
  pendingArt: $('#pendingArt'), artLibrary: $('#artLibrary'), frameCount: $('#frameCount'), placedArt: $('#placedArt'),
  canvasHint: $('#canvasHint'), zoomIn: $('#zoomIn'), zoomOut: $('#zoomOut'), zoomLabel: $('#zoomLabel'),
  exportButton: $('#exportButton'), resetButton: $('#resetButton'), confirmDialog: $('#confirmDialog')
};

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

async function loadWall(file) {
  if (!file) return;
  const url = await readFile(file);
  const probe = new Image();
  probe.onload = () => {
    state.wallUrl = url; state.naturalWidth = probe.naturalWidth; state.naturalHeight = probe.naturalHeight;
    state.scaleLine = null; state.pixelsPerUnit = null; state.placed = []; state.zoom = 1;
    els.wallImage.src = url; els.emptyState.hidden = true; els.stage.hidden = false;
    fitStage(); clearMeasurement(); renderPlaced();
    els.calibrationStep.classList.remove('is-disabled');
    [els.drawScaleButton, els.knownLength, els.unitSelect].forEach(el => el.disabled = false);
    els.applyScaleButton.disabled = true; els.artStep.classList.add('is-disabled'); els.artInput.disabled = true;
    els.canvasHint.textContent = 'Next, draw across the object of known length'; els.wallInputLabel.textContent = 'Replace wall photo';
    els.exportButton.disabled = false; els.zoomIn.disabled = false; els.zoomOut.disabled = false; setZoom(1);
  };
  probe.src = url;
}

function fitStage() {
  const maxW = Math.max(300, els.stageWrap.clientWidth - 48), maxH = Math.max(300, els.stageWrap.clientHeight - 48);
  const ratio = Math.min(maxW / state.naturalWidth, maxH / state.naturalHeight, 1);
  els.stage.style.width = `${Math.round(state.naturalWidth * ratio)}px`;
  els.stage.style.height = `${Math.round(state.naturalHeight * ratio)}px`;
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
  if (distance > 8) { state.scaleLine = measureDraft; els.applyScaleButton.disabled = !(Number(els.knownLength.value) > 0); els.scaleStatus.textContent = 'Line set. Enter the real length.'; }
  measureDraft = null; els.measurementLayer.classList.remove('is-drawing'); els.drawScaleButton.textContent = 'Redraw measurement line';
});
els.knownLength.addEventListener('input', () => { els.applyScaleButton.disabled = !(state.scaleLine && Number(els.knownLength.value) > 0); });

els.applyScaleButton.addEventListener('click', () => {
  const length = Number(els.knownLength.value); if (!state.scaleLine || length <= 0) return;
  const displayDistance = Math.hypot(state.scaleLine.x2 - state.scaleLine.x1, state.scaleLine.y2 - state.scaleLine.y1);
  const renderedToNatural = state.naturalWidth / els.stage.clientWidth;
  state.pixelsPerUnit = displayDistance * renderedToNatural / length; state.unit = els.unitSelect.value;
  els.scaleStatus.textContent = `Scale set · ${state.pixelsPerUnit.toFixed(1)} px per ${state.unit}`;
  [els.measurementLine, els.measureStart, els.measureEnd].forEach(el => el.setAttribute('visibility', 'hidden'));
  els.artStep.classList.remove('is-disabled'); els.artInput.disabled = false;
  els.canvasHint.textContent = 'Add framed art, then drag it onto the wall';
});

els.artInput.addEventListener('change', async () => {
  for (const file of [...els.artInput.files]) await createPendingArt(file);
  els.artInput.value = '';
});

async function createPendingArt(file) {
  const url = await readFile(file); const id = crypto.randomUUID();
  const card = document.createElement('div'); card.className = 'pending-card'; card.dataset.id = id;
  card.innerHTML = `<img class="pending-preview" alt="Preview of ${escapeHtml(file.name)}"><p class="pending-name">${escapeHtml(file.name)}</p><div class="dimension-row"><label>Width<input class="art-width" type="number" min="0.1" step="0.1" placeholder="40"></label><label>Height<input class="art-height" type="number" min="0.1" step="0.1" placeholder="50"></label></div><div class="pending-actions"><button class="button button-outline cancel-art" type="button">Cancel</button><button class="button button-dark add-art" type="button">Add frame</button></div>`;
  card.querySelector('img').src = url;
  card.querySelector('.cancel-art').onclick = () => card.remove();
  card.querySelector('.add-art').onclick = () => {
    const width = Number(card.querySelector('.art-width').value), height = Number(card.querySelector('.art-height').value);
    if (!(width > 0 && height > 0)) { card.querySelector('.art-width').focus(); return; }
    state.art.push({ id, url, name: file.name, width, height, unit: state.unit }); card.remove(); renderLibrary();
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
  const placed = { id: crypto.randomUUID(), artId, x: centerX - width / 2, y: centerY - height / 2, width, height };
  placed.x = Math.max(0, Math.min(els.stage.clientWidth - width, placed.x)); placed.y = Math.max(0, Math.min(els.stage.clientHeight - height, placed.y));
  state.placed.push(placed); state.selectedId = placed.id; renderPlaced();
}

function renderPlaced() {
  els.placedArt.innerHTML = '';
  state.placed.forEach(item => {
    const art = state.art.find(a => a.id === item.artId); if (!art) return;
    const img = document.createElement('img'); img.src = art.url; img.alt = art.name; img.draggable = false; img.tabIndex = 0;
    img.className = 'placed-frame' + (state.selectedId === item.id ? ' selected' : ''); img.dataset.id = item.id;
    Object.assign(img.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
    img.addEventListener('pointerdown', beginFrameDrag); img.addEventListener('click', () => { state.selectedId = item.id; renderPlaced(); });
    els.placedArt.append(img);
  });
}

let drag = null;
function beginFrameDrag(event) {
  const item = state.placed.find(p => p.id === event.currentTarget.dataset.id); if (!item) return;
  state.selectedId = item.id; drag = { item, startX: event.clientX, startY: event.clientY, originX: item.x, originY: item.y };
  event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('dragging', 'selected');
  event.currentTarget.addEventListener('pointermove', moveFrame); event.currentTarget.addEventListener('pointerup', endFrame, { once: true });
}
function moveFrame(event) {
  if (!drag) return; const { item } = drag;
  item.x = Math.max(0, Math.min(els.stage.clientWidth - item.width, drag.originX + (event.clientX - drag.startX) / state.zoom));
  item.y = Math.max(0, Math.min(els.stage.clientHeight - item.height, drag.originY + (event.clientY - drag.startY) / state.zoom));
  event.currentTarget.style.left = `${item.x}px`; event.currentTarget.style.top = `${item.y}px`;
}
function endFrame(event) { event.currentTarget.removeEventListener('pointermove', moveFrame); drag = null; renderPlaced(); }

document.addEventListener('keydown', event => {
  if (!state.selectedId || ['INPUT','SELECT'].includes(document.activeElement.tagName)) return;
  const item = state.placed.find(p => p.id === state.selectedId); if (!item) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { state.placed = state.placed.filter(p => p.id !== item.id); state.selectedId = null; renderPlaced(); return; }
  const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') item.x -= step; else if (event.key === 'ArrowRight') item.x += step; else if (event.key === 'ArrowUp') item.y -= step; else if (event.key === 'ArrowDown') item.y += step; else return;
  event.preventDefault(); item.x = Math.max(0, Math.min(els.stage.clientWidth - item.width, item.x)); item.y = Math.max(0, Math.min(els.stage.clientHeight - item.height, item.y)); renderPlaced();
});

function setZoom(value) { state.zoom = Math.max(.5, Math.min(1.5, value)); els.stage.style.transform = `scale(${state.zoom})`; els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`; }
els.zoomIn.addEventListener('click', () => setZoom(state.zoom + .1)); els.zoomOut.addEventListener('click', () => setZoom(state.zoom - .1));

els.exportButton.addEventListener('click', async () => {
  const canvas = document.createElement('canvas'); canvas.width = state.naturalWidth; canvas.height = state.naturalHeight;
  const ctx = canvas.getContext('2d'); const wall = await imageFromUrl(state.wallUrl); ctx.drawImage(wall, 0, 0, canvas.width, canvas.height);
  const ratio = state.naturalWidth / els.stage.clientWidth;
  for (const item of state.placed) { const art = state.art.find(a => a.id === item.artId); const img = await imageFromUrl(art.url); ctx.drawImage(img, item.x * ratio, item.y * ratio, item.width * ratio, item.height * ratio); }
  const link = document.createElement('a'); link.download = 'gallery-wall-plan.png'; link.href = canvas.toDataURL('image/png'); link.click();
});
function imageFromUrl(url) { return new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.src = url; }); }

els.resetButton.addEventListener('click', () => els.confirmDialog.showModal());
els.confirmDialog.addEventListener('close', () => { if (els.confirmDialog.returnValue === 'confirm') location.reload(); });
[els.wallInput, els.wallInputEmpty].forEach(input => input.addEventListener('change', () => loadWall(input.files[0])));
window.addEventListener('resize', () => { if (state.wallUrl && !state.placed.length) fitStage(); });
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
