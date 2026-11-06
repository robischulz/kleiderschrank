'use strict';

/* =========================================================
   Kleiderschrank – virtueller Kleiderschrank als Web-App
   Jedes Foto ist ein Ganzkörper-Spiegelselfie im Format 3:5.
   Die drei Felder zeigen jeweils einen Ausschnitt (Band) des Fotos.
   ========================================================= */

// Bänder als Anteil der Bildhöhe (0 = oben, 1 = unten). Passen zum Umriss in der Kamera.
const BANDS = {
  top:    [0.12, 0.50],
  bottom: [0.48, 0.90],
  shoes:  [0.87, 1.00],
  dress:  [0.12, 0.90],
};
const ASPECT = 3 / 5;              // Breite / Höhe eines Fotos
const IMG_W = 960, IMG_H = 1600;   // gespeicherte Auflösung
const LABELS = { top: 'Oberteil', bottom: 'Beine', shoes: 'Schuhe', dress: 'Kleid' };
const SLOTS = ['top', 'bottom', 'dress', 'shoes'];

const $ = (s, el = document) => el.querySelector(s);

/* ---------------- Speicher (IndexedDB) ---------------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('kleiderschrank', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('items', mode);
      const req = fn(t.objectStore('items'));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', s => s.getAll()),
    put: item => tx('readwrite', s => s.put(item)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
};

/* ---------------- Zustand ---------------- */
let items = [];             // neueste zuerst
let dressMode = false;
const urls = new Map();     // id -> objectURL
const selected = {};        // slot -> id des aktuell sichtbaren Stücks

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

function urlFor(item) {
  if (!urls.has(item.id)) {
    urls.set(item.id, URL.createObjectURL(new Blob([item.data], { type: item.type || 'image/jpeg' })));
  }
  return urls.get(item.id);
}
const pool = slot => items.filter(it => it.parts.includes(slot));
const visibleSlots = () => dressMode ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes'];

/* ---------------- Galerie ---------------- */
const fields = {};
SLOTS.forEach(s => {
  const el = $(`.field[data-slot="${s}"]`);
  fields[s] = { el, track: $('.track', el), label: $('.label', el) };
});

function currentIndex(slot) {
  const t = fields[slot].track;
  return t.clientWidth ? Math.round(t.scrollLeft / t.clientWidth) : 0;
}
function scrollToIndex(slot, i, smooth) {
  const t = fields[slot].track;
  t.scrollTo({ left: i * t.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
}
function updateLabel(slot) {
  const list = pool(slot);
  const i = Math.min(currentIndex(slot), Math.max(list.length - 1, 0));
  if (list[i]) selected[slot] = list[i].id;
  fields[slot].label.textContent = list.length > 1
    ? `${LABELS[slot]} · ${i + 1}/${list.length}` : LABELS[slot];
}

function render() {
  const has = items.length > 0;
  $('#empty').hidden = has;
  $('#outfit').hidden = !has;
  $('#controls').hidden = !has;
  $('#btnDress').setAttribute('aria-pressed', String(dressMode));
  if (!has) return;

  const vis = visibleSlots();
  SLOTS.forEach(slot => {
    const f = fields[slot];
    f.el.hidden = !vis.includes(slot);
    if (f.el.hidden) return;
    const list = pool(slot);
    f.track.replaceChildren(...(list.length ? list.map(it => {
      const d = document.createElement('div');
      d.className = 'slide';
      d.dataset.id = it.id;
      d.style.backgroundImage = `url("${urlFor(it)}")`;
      return d;
    }) : [placeholder(slot)]));
  });
  layout();
  vis.forEach(slot => {
    const list = pool(slot);
    const i = Math.max(0, list.findIndex(it => it.id === selected[slot]));
    scrollToIndex(slot, i, false);
    updateLabel(slot);
  });
}

function placeholder(slot) {
  const d = document.createElement('div');
  d.className = 'slide placeholder';
  d.textContent = slot === 'dress'
    ? 'Noch keine Kleider. Mach ein Foto und tippe danach auf „Ist ein Kleid“.'
    : `Noch keine ${LABELS[slot]}. Tippe oben links auf +.`;
  return d;
}

// Größe der Felder so berechnen, dass alle drei zusammen wie ein Ganzkörperfoto wirken.
function layout() {
  const stage = $('#stage');
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const gap = 8;
  const bandSum = (BANDS.top[1] - BANDS.top[0]) + (BANDS.bottom[1] - BANDS.bottom[0]) + (BANDS.shoes[1] - BANDS.shoes[0]);
  // Höhe gesamt = W / ASPECT * bandSum + 2 * gap
  const W = Math.floor(Math.min(availW, (availH - 2 * gap) * ASPECT / bandSum));
  const imgH = W / ASPECT;
  $('#outfit').style.setProperty('--w', W + 'px');

  const h = s => (BANDS[s][1] - BANDS[s][0]) * imgH;
  const set = (slot, height) => {
    const el = fields[slot].el;
    el.style.height = height + 'px';
    el.style.setProperty('--imgH', imgH + 'px');
    el.style.setProperty('--offY', BANDS[slot][0] * imgH + 'px');
  };
  set('top', h('top'));
  set('bottom', h('bottom'));
  set('shoes', h('shoes'));
  set('dress', h('top') + h('bottom') + gap);
}

SLOTS.forEach(slot => {
  const t = fields[slot].track;
  let raf = 0;
  t.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => updateLabel(slot));
    cancelPress();
  }, { passive: true });
  setupLongPress(slot);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!items.length) return;
    layout();
    visibleSlots().forEach(slot => {
      const i = Math.max(0, pool(slot).findIndex(it => it.id === selected[slot]));
      scrollToIndex(slot, i, false);
    });
  }, 80);
});

$('#btnDress').addEventListener('click', () => {
  dressMode = !dressMode;
  render();
});

$('#btnRandom').addEventListener('click', () => {
  visibleSlots().forEach((slot, k) => {
    const n = pool(slot).length;
    if (n < 2) return;
    const cur = currentIndex(slot);
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === cur);
    setTimeout(() => scrollToIndex(slot, i, true), k * 140);
  });
});

/* ---------------- Langes Drücken: Stück entfernen ---------------- */
let pressTimer = 0, pressStart = null, pressField = null;
function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = 0;
  if (pressField) pressField.classList.remove('pressing');
  pressField = null;
}
function setupLongPress(slot) {
  const { el, track } = fields[slot];
  track.addEventListener('pointerdown', e => {
    const slide = e.target.closest('.slide');
    if (!slide || !slide.dataset.id) return;
    pressStart = { x: e.clientX, y: e.clientY };
    pressField = el;
    el.classList.add('pressing');
    pressTimer = setTimeout(() => {
      cancelPress();
      const item = items.find(it => it.id === slide.dataset.id);
      if (item) openItemSheet(slot, item);
    }, 600);
  });
  track.addEventListener('pointermove', e => {
    if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => track.addEventListener(ev, cancelPress));
  track.addEventListener('contextmenu', e => e.preventDefault());
}

function openItemSheet(slot, item) {
  const name = { top: 'dieses Oberteil', bottom: 'diese Beine', shoes: 'diese Schuhe', dress: 'dieses Kleid' }[slot];
  const actions = [
    { label: `Nur ${name} entfernen`, danger: true, fn: () => removePart(item, slot) },
    { label: 'Ganzes Foto löschen', danger: true, fn: () => removeItem(item) },
  ];
  // Ist nur noch dieser Teil übrig, gibt es nur „Ganzes Foto löschen“.
  openSheet('Was möchtest du tun?', item.parts.length > 1 ? actions : [actions[1]]);
}

async function removePart(item, slot) {
  item.parts = item.parts.filter(p => p !== slot);
  if (!item.parts.length) return removeItem(item);
  await DB.put(item);
  render();
  toast(`${LABELS[slot]} entfernt`);
}
async function removeItem(item) {
  await DB.del(item.id);
  items = items.filter(it => it.id !== item.id);
  if (urls.has(item.id)) { URL.revokeObjectURL(urls.get(item.id)); urls.delete(item.id); }
  render();
  toast('Foto gelöscht');
}

/* ---------------- Aktionsblatt & Toast ---------------- */
function openSheet(title, actions) {
  const sheet = $('#sheet');
  $('.sheet-title', sheet).textContent = title || '';
  $('.sheet-actions', sheet).replaceChildren(...actions.map(a => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.danger) b.className = 'danger';
    b.addEventListener('click', () => { closeSheet(); a.fn(); });
    return b;
  }));
  sheet.hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('.sheet-backdrop').addEventListener('click', closeSheet);
$('.sheet-cancel').addEventListener('click', closeSheet);

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------------- Hilfslinien im Foto ---------------- */
function drawGuides(g, isDress) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };
  const y = v => v * 500;
  const cutTop = BANDS.top[0];
  const cutMid = (BANDS.top[1] + BANDS.bottom[0]) / 2;
  const cutLow = (BANDS.bottom[1] + BANDS.shoes[0]) / 2;
  const nodes = [mk('rect', { x: 0, y: 0, width: 300, height: y(cutTop), fill: 'rgba(0,0,0,.35)' })];
  const lines = isDress ? [cutTop, cutLow] : [cutTop, cutMid, cutLow];
  lines.forEach(v => nodes.push(mk('line', { x1: 0, x2: 300, y1: y(v), y2: y(v) })));
  const labels = isDress
    ? [['Kleid', cutTop], ['Schuhe', cutLow]]
    : [['Oberteil', cutTop], ['Beine', cutMid], ['Schuhe', cutLow]];
  labels.forEach(([text, v]) => {
    const t = mk('text', { x: 292, y: y(v) + 16, 'text-anchor': 'end' });
    t.textContent = text;
    nodes.push(t);
  });
  g.replaceChildren(...nodes);
}

/* ---------------- Kamera ---------------- */
const video = $('#camVideo');
let stream = null;
let facing = 'environment';   // Rückkamera zeigt auf den Spiegel
let shot = null;              // { blob, url }
let shotIsDress = false;

drawGuides($('#camera .guides'), false);

async function openCamera() {
  $('#camera').hidden = false;
  await startStream();
}
async function startStream() {
  stopStream();
  const msg = $('#camMsg');
  msg.hidden = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
    });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
  } catch (e) {
    msg.innerHTML = 'Die Kamera ist gerade nicht verfügbar.<br><br>Erlaube den Kamerazugriff in den Einstellungen – oder wähle unten links ein Foto aus deiner Mediathek.';
    msg.hidden = false;
  }
}
function stopStream() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}
function closeCamera() {
  stopStream();
  discardShot();
  $('#camera').hidden = true;
  $('#review').hidden = true;
}

// Mittleren 3:5-Ausschnitt einer Quelle (Video oder Bild) auf ein Canvas zeichnen.
function cropToCanvas(src, sw, sh, mirror) {
  let cw, ch, cx, cy;
  if (sw / sh > ASPECT) { ch = sh; cw = sh * ASPECT; cx = (sw - cw) / 2; cy = 0; }
  else { cw = sw; ch = sw / ASPECT; cx = 0; cy = (sh - ch) / 2; }
  const c = document.createElement('canvas');
  c.width = IMG_W; c.height = IMG_H;
  const g = c.getContext('2d');
  if (mirror) { g.translate(IMG_W, 0); g.scale(-1, 1); }
  g.drawImage(src, cx, cy, cw, ch, 0, 0, IMG_W, IMG_H);
  return c;
}
const canvasToBlob = c => new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));

$('#camShutter').addEventListener('click', async () => {
  if (!stream || !video.videoWidth) return toast('Kamera ist noch nicht bereit');
  const f = $('#flash');
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  const c = cropToCanvas(video, video.videoWidth, video.videoHeight, facing === 'user');
  showReview(await canvasToBlob(c));
});

$('#camFlip').addEventListener('click', () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  startStream();
});
$('#camClose').addEventListener('click', closeCamera);
$('#camLibrary').addEventListener('click', () => $('#fileLibrary').click());

$('#fileLibrary').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const img = await loadImage(file);
    const c = cropToCanvas(img, img.naturalWidth, img.naturalHeight, false);
    showReview(await canvasToBlob(c));
  } catch {
    toast('Das Foto konnte nicht geladen werden');
  }
});
function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}

/* ---------------- Vorschau nach der Aufnahme ---------------- */
function showReview(blob) {
  discardShot();
  shot = { blob, url: URL.createObjectURL(blob) };
  shotIsDress = false;
  $('#revImg').src = shot.url;
  updateReviewDress();
  $('#review').hidden = false;
  if (video.srcObject) video.pause();
}
function discardShot() {
  if (shot) URL.revokeObjectURL(shot.url);
  shot = null;
}
function updateReviewDress() {
  $('#revDress').setAttribute('aria-pressed', String(shotIsDress));
  drawGuides($('#review .guides'), shotIsDress);
}

$('#revDress').addEventListener('click', () => { shotIsDress = !shotIsDress; updateReviewDress(); });
$('#revRetake').addEventListener('click', () => {
  discardShot();
  $('#review').hidden = true;
  if (video.srcObject) video.play().catch(() => {});
  else startStream();
});
$('#revClose').addEventListener('click', closeCamera);

$('#revAdd').addEventListener('click', async () => {
  if (!shot) return;
  const item = {
    id: uid(),
    created: Date.now(),
    isDress: shotIsDress,
    parts: shotIsDress ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes'],
    type: 'image/jpeg',
    data: await shot.blob.arrayBuffer(),
  };
  try {
    await DB.put(item);
  } catch {
    return toast('Speichern fehlgeschlagen – ist der Speicher voll?');
  }
  items.unshift(item);
  item.parts.forEach(p => { selected[p] = item.id; });
  dressMode = item.isDress;
  closeCamera();
  render();
  toast(item.isDress ? 'Kleid hinzugefügt' : 'Outfit hinzugefügt');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
});

$('#btnAdd').addEventListener('click', openCamera);
$('#btnEmptyAdd').addEventListener('click', openCamera);

/* ---------------- Menü: Backup & Wiederherstellen ---------------- */
function formatDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}
function backupDue() {
  if (!items.length) return false;
  const last = Number(store.get('lastBackup') || 0);
  const newest = items.reduce((m, it) => Math.max(m, it.created), 0);
  return newest > last && Date.now() - last > 14 * 864e5;
}
function updateMenuDot() { $('#menuDot').hidden = !backupDue(); }

$('#btnMenu').addEventListener('click', () => {
  const last = Number(store.get('lastBackup') || 0);
  const nPhotos = items.length;
  const info = `${nPhotos} ${nPhotos === 1 ? 'Foto' : 'Fotos'} im Kleiderschrank · ` +
    (last ? `letztes Backup: ${formatDate(last)}` : 'noch kein Backup');
  openSheet(info, [
    { label: 'Backup sichern', fn: prepareBackup },
    { label: 'Backup wiederherstellen', fn: () => $('#fileRestore').click() },
  ]);
});

const blobToDataURL = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

async function prepareBackup() {
  if (!items.length) return toast('Noch nichts zum Sichern');
  toast('Backup wird erstellt …', 10000);
  const out = { app: 'kleiderschrank', version: 1, exported: new Date().toISOString(), items: [] };
  for (const it of items) {
    out.items.push({
      id: it.id, created: it.created, isDress: it.isDress, parts: it.parts, type: it.type,
      image: await blobToDataURL(new Blob([it.data], { type: it.type })),
    });
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = new File([JSON.stringify(out)], `Kleiderschrank-Backup-${stamp}.json`, { type: 'application/json' });
  const mb = (file.size / 1048576).toFixed(1).replace('.', ',');
  toast('Backup ist bereit', 1200);
  // Teilen braucht einen frischen Tipp, deshalb ein zweiter Schritt.
  openSheet(`Backup bereit: ${items.length} Fotos, ${mb} MB.\nTippe auf „Teilen“ und dann auf „In Dateien sichern“.`, [
    { label: 'Teilen / In Dateien sichern', fn: () => shareBackup(file) },
  ]);
}

async function shareBackup(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Kleiderschrank-Backup' });
      markBackup();
    } catch (e) {
      if (e.name !== 'AbortError') downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
}
function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  markBackup();
}
function markBackup() {
  store.set('lastBackup', String(Date.now()));
  updateMenuDot();
  toast('Backup gesichert');
}

$('#fileRestore').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast('Backup wird geladen …', 10000);
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'kleiderschrank' || !Array.isArray(data.items)) throw new Error('format');
    const have = new Set(items.map(it => it.id));
    let added = 0;
    for (const raw of data.items) {
      if (!raw.id || have.has(raw.id) || !raw.image) continue;
      const buf = await (await fetch(raw.image)).arrayBuffer();
      const item = {
        id: raw.id,
        created: raw.created || Date.now(),
        isDress: !!raw.isDress,
        parts: Array.isArray(raw.parts) && raw.parts.length ? raw.parts
          : (raw.isDress ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes']),
        type: raw.type || 'image/jpeg',
        data: buf,
      };
      await DB.put(item);
      items.push(item);
      added++;
    }
    items.sort((a, b) => b.created - a.created);
    render();
    updateMenuDot();
    toast(added ? `${added} ${added === 1 ? 'Foto' : 'Fotos'} wiederhergestellt`
      : 'Alles aus dem Backup ist schon da');
  } catch {
    toast('Diese Datei ist kein Kleiderschrank-Backup');
  }
});

/* ---------------- Installationshinweis ---------------- */
function maybeShowInstallHint() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone && !store.get('hideInstallHint')) $('#installHint').hidden = false;
}
$('#installHintClose').addEventListener('click', () => {
  $('#installHint').hidden = true;
  store.set('hideInstallHint', '1');
  layout();
});

/* ---------------- Start ---------------- */
(async function init() {
  maybeShowInstallHint();
  try {
    items = (await DB.all()) || [];
    items.sort((a, b) => b.created - a.created);
  } catch {
    toast('Speicher konnte nicht geöffnet werden');
  }
  render();
  updateMenuDot();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
