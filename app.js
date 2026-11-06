'use strict';

/* =========================================================
   Kleiderschrank der Mua – virtueller Kleiderschrank als Web-App
   Jedes Foto ist ein Ganzkörper-Spiegelselfie im Format 3:5.
   Die Felder zeigen jeweils einen Ausschnitt (Band) des Fotos.
   ========================================================= */

// Bänder als Anteil der Bildhöhe (0 = oben, 1 = unten). Passen zum Umriss in der Kamera.
const BANDS = {
  top:    [0.12, 0.50],
  bottom: [0.48, 0.90],
  shoes:  [0.87, 1.00],
  dress:  [0.12, 0.90],
};
// Welcher Teil des Kamerabilds gespeichert wird (Anteile des Kamerarahmens).
// Hält die Mua das Handy vors Gesicht, erscheint ihr Körper tiefer und kleiner im Bild,
// deshalb liegt der Umriss im unteren, mittleren Bereich.
const SAVE = { x: 0.09, y: 0.18, size: 0.82 };
const ASPECT = 3 / 5;              // Breite / Höhe eines Fotos
const IMG_W = 960, IMG_H = 1600;   // gespeicherte Auflösung
const LABELS = { top: 'Oberteil', bottom: 'Beine', shoes: 'Schuhe', dress: 'Kleid' };
const SLOTS = ['top', 'bottom', 'dress', 'shoes'];

// Passwort: Gespeichert ist nur ein PBKDF2-Hash, nicht das Passwort selbst.
const LOCK = {
  salt: '38acc79a185cc027ec2d6e85face6845',
  iterations: 210000,
  hash: '82c16c7d581968eb6c44ed9131bc14d861749377e18b12be8361ca7a2d13614a',
};

const $ = (s, el = document) => el.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
const wrap = (i, n) => ((i % n) + n) % n;

/* ---------------- Wischfelder ----------------
   Jedes Feld hat drei Bilder nebeneinander (vorheriges, aktuelles, nächstes).
   Beim Wischen wird verschoben, danach wird neu belegt. Am Ende geht es wieder von vorne los. */
const CHEVRON_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEVRON_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const fields = {};

SLOTS.forEach(slot => {
  const el = $(`.field[data-slot="${slot}"]`);
  el.innerHTML = `<div class="track"><div class="slide"></div><div class="slide"></div><div class="slide"></div></div>
    <span class="label"></span>
    <button class="nav prev" aria-label="Vorheriges">${CHEVRON_L}</button>
    <button class="nav next" aria-label="Nächstes">${CHEVRON_R}</button>`;
  const f = fields[slot] = {
    el, track: $('.track', el), label: $('.label', el),
    slides: [...el.querySelectorAll('.slide')], busy: false,
  };
  $('.prev', el).addEventListener('click', () => go(slot, -1));
  $('.next', el).addEventListener('click', () => go(slot, 1));
  el.querySelectorAll('.nav').forEach(b => b.addEventListener('pointerdown', e => e.stopPropagation()));
  setupDrag(slot, f);
});

function currentIndex(slot) {
  const list = pool(slot);
  return Math.max(0, list.findIndex(it => it.id === selected[slot]));
}

function setSlide(div, item, text) {
  div.classList.toggle('placeholder', !item && !!text);
  div.textContent = item ? '' : (text || '');
  div.dataset.id = item ? item.id : '';
  div.style.backgroundImage = item ? `url("${urlFor(item)}")` : 'none';
}

function paint(slot) {
  const f = fields[slot];
  const list = pool(slot);
  const n = list.length;
  f.el.dataset.count = n;
  if (!n) {
    setSlide(f.slides[0]); setSlide(f.slides[2]);
    setSlide(f.slides[1], null, placeholderText(slot));
    delete selected[slot];
  } else {
    const i = currentIndex(slot);
    selected[slot] = list[i].id;
    setSlide(f.slides[0], list[wrap(i - 1, n)]);
    setSlide(f.slides[1], list[i]);
    setSlide(f.slides[2], list[wrap(i + 1, n)]);
  }
  f.label.textContent = n > 1 ? `${LABELS[slot]} · ${currentIndex(slot) + 1}/${n}` : LABELS[slot];
}

function placeholderText(slot) {
  return {
    dress: 'Noch keine Kleider. Die Mua kann ein Foto machen und danach auf „Ist ein Kleid“ tippen.',
    top: 'Noch kein Oberteil im Schrank der Mua.',
    bottom: 'Noch nichts für die Beine im Schrank der Mua.',
    shoes: 'Noch keine Schuhe im Schrank der Mua.',
  }[slot];
}

// Zum nächsten (dir = 1) oder vorherigen (dir = -1) Stück wechseln, optional zu einem bestimmten Index.
function go(slot, dir, targetIndex) {
  const f = fields[slot];
  const list = pool(slot);
  const n = list.length;
  if (f.busy) return Promise.resolve();
  if (n < 2) { snapBack(f); return Promise.resolve(); }
  const target = targetIndex === undefined ? wrap(currentIndex(slot) + dir, n) : targetIndex;
  setSlide(f.slides[dir > 0 ? 2 : 0], list[target]);
  f.busy = true;
  f.track.classList.add('anim');
  f.track.style.transform = `translateX(${dir > 0 ? '-66.6667%' : '0%'})`;
  return sleep(310).then(() => {
    f.track.classList.remove('anim');
    selected[slot] = list[target].id;
    paint(slot);
    f.track.style.transform = '';
    f.busy = false;
  });
}

function snapBack(f) {
  f.track.classList.add('anim');
  f.track.style.transform = '';
  setTimeout(() => f.track.classList.remove('anim'), 310);
}

function setupDrag(slot, f) {
  let drag = null;
  let pressTimer = 0;

  f.el.addEventListener('pointerdown', e => {
    if (f.busy || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, moved: false };
    try { f.el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    const id = f.slides[1].dataset.id;
    clearTimeout(pressTimer);
    if (id) {
      pressTimer = setTimeout(() => {
        if (drag && !drag.moved) {
          drag = null;
          const item = items.find(it => it.id === id);
          if (item) openItemSheet(slot, item);
        }
      }, 600);
    }
  });

  f.el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 8) { drag.moved = true; clearTimeout(pressTimer); }
    if (!drag.moved) return;
    drag.dx = dx;
    const resist = pool(slot).length < 2 ? 0.25 : 1;
    f.track.style.transform = `translateX(calc(-33.3333% + ${dx * resist}px))`;
  });

  const end = () => {
    clearTimeout(pressTimer);
    if (!drag) return;
    const { dx, t, moved } = drag;
    drag = null;
    if (!moved) return;
    const w = f.el.clientWidth;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t);
    if (pool(slot).length > 1 && (Math.abs(dx) > w * 0.18 || (speed > 0.35 && Math.abs(dx) > 20))) {
      go(slot, dx < 0 ? 1 : -1);
    } else {
      snapBack(f);
    }
  };
  f.el.addEventListener('pointerup', end);
  f.el.addEventListener('pointercancel', end);
  f.el.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------------- Galerie ---------------- */
function render() {
  const has = items.length > 0;
  $('#empty').hidden = has;
  $('#outfit').hidden = !has;
  $('#controls').hidden = !has;
  $('#btnDress').setAttribute('aria-pressed', String(dressMode));
  if (!has) return;
  const vis = visibleSlots();
  SLOTS.forEach(slot => {
    fields[slot].el.hidden = !vis.includes(slot);
    if (vis.includes(slot)) paint(slot);
  });
  layout();
}

// Größe der Felder so berechnen, dass alle zusammen wie ein Ganzkörperfoto wirken.
function layout() {
  const stage = $('#stage');
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const gap = 8;
  const len = s => BANDS[s][1] - BANDS[s][0];
  const bandSum = len('top') + len('bottom') + len('shoes');
  const W = Math.floor(Math.min(availW, (availH - 2 * gap) * ASPECT / bandSum));
  const imgH = W / ASPECT;
  $('#outfit').style.setProperty('--w', W + 'px');
  const set = (slot, height) => {
    const el = fields[slot].el;
    el.style.height = height + 'px';
    el.style.setProperty('--imgH', imgH + 'px');
    el.style.setProperty('--offY', BANDS[slot][0] * imgH + 'px');
  };
  set('top', len('top') * imgH);
  set('bottom', len('bottom') * imgH);
  set('shoes', len('shoes') * imgH);
  set('dress', (len('top') + len('bottom')) * imgH + gap);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (items.length) layout(); }, 80);
});

$('#btnDress').addEventListener('click', () => {
  dressMode = !dressMode;
  render();
});

// Zufall: mischt Kleider und Oberteil-plus-Beine untereinander, dazu passende Schuhe.
$('#btnRandom').addEventListener('click', () => {
  const nDress = pool('dress').length;
  const nSeparates = Math.min(pool('top').length, pool('bottom').length);
  let wantDress = dressMode;
  if (nDress && nSeparates) wantDress = Math.random() < nDress / (nDress + nSeparates);
  else wantDress = nDress > 0;
  if (wantDress !== dressMode) { dressMode = wantDress; render(); }

  visibleSlots().forEach((slot, k) => {
    const n = pool(slot).length;
    if (n < 2) return;
    const cur = currentIndex(slot);
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === cur);
    setTimeout(() => go(slot, 1, i), k * 140);
  });
});

/* ---------------- Langes Drücken: Teil entfernen ---------------- */
function openItemSheet(slot, item) {
  const name = { top: 'dieses Oberteil', bottom: 'diese Beine', shoes: 'diese Schuhe', dress: 'dieses Kleid' }[slot];
  const actions = [
    { label: `Nur ${name} entfernen`, danger: true, fn: () => removePart(item, slot) },
    { label: 'Ganzes Foto löschen', danger: true, fn: () => removeItem(item) },
  ];
  // Ist nur noch dieser Teil übrig, gibt es nur „Ganzes Foto löschen“.
  openSheet('Was soll mit diesem Teil passieren?', item.parts.length > 1 ? actions : [actions[1]]);
}

async function removePart(item, slot) {
  item.parts = item.parts.filter(p => p !== slot);
  if (!item.parts.length) return removeItem(item);
  await DB.put(item);
  if (selected[slot] === item.id) delete selected[slot];
  render();
  toast(`${LABELS[slot]} entfernt`);
}
async function removeItem(item) {
  await DB.del(item.id);
  items = items.filter(it => it.id !== item.id);
  SLOTS.forEach(s => { if (selected[s] === item.id) delete selected[s]; });
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
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}
function drawGuides(g, isDress) {
  const y = v => v * 500;
  const cutTop = BANDS.top[0];
  const cutMid = (BANDS.top[1] + BANDS.bottom[0]) / 2;
  const cutLow = (BANDS.bottom[1] + BANDS.shoes[0]) / 2;
  const nodes = [svgEl('rect', { x: 0, y: 0, width: 300, height: y(cutTop), fill: 'rgba(0,0,0,.3)' })];
  const lines = isDress ? [cutTop, cutLow] : [cutTop, cutMid, cutLow];
  lines.forEach(v => nodes.push(svgEl('line', { x1: 0, x2: 300, y1: y(v), y2: y(v) })));
  const labels = isDress
    ? [['Kleid', cutTop], ['Schuhe', cutLow]]
    : [['Oberteil', cutTop], ['Beine', cutMid], ['Schuhe', cutLow]];
  labels.forEach(([text, v]) => {
    const t = svgEl('text', { x: 292, y: y(v) + 16, 'text-anchor': 'end' });
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

(function setupCameraOverlay() {
  const x = SAVE.x * 300, y = SAVE.y * 500, w = SAVE.size * 300, h = SAVE.size * 500;
  $('#camSave').setAttribute('transform', `translate(${x} ${y}) scale(${SAVE.size})`);
  $('#camOutside').setAttribute('d', `M0 0H300V500H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z`);
  drawGuides($('#camera .guides'), false);
})();

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
    msg.innerHTML = 'Die Kamera ist gerade nicht verfügbar.<br><br>Die Mua kann den Kamerazugriff in den Einstellungen erlauben – oder unten links ein Foto aus ihrer Mediathek wählen.';
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

// Mittleren 3:5-Ausschnitt einer Quelle berechnen (so wie die Vorschau ihn zeigt).
function centerCrop(sw, sh) {
  if (sw / sh > ASPECT) { const cw = sh * ASPECT; return { x: (sw - cw) / 2, y: 0, w: cw, h: sh }; }
  const ch = sw / ASPECT;
  return { x: 0, y: (sh - ch) / 2, w: sw, h: ch };
}
function drawToCanvas(src, r, mirror) {
  const c = document.createElement('canvas');
  c.width = IMG_W; c.height = IMG_H;
  const g = c.getContext('2d');
  if (mirror) { g.translate(IMG_W, 0); g.scale(-1, 1); }
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, IMG_W, IMG_H);
  return c;
}
const canvasToBlob = c => new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));

$('#camShutter').addEventListener('click', async () => {
  if (!stream || !video.videoWidth) return toast('Die Kamera ist noch nicht bereit');
  const fl = $('#flash');
  fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  const frame = centerCrop(video.videoWidth, video.videoHeight);
  // Nur den Bereich um den Umriss speichern (horizontal mittig, daher auch gespiegelt gleich).
  const r = {
    x: frame.x + SAVE.x * frame.w, y: frame.y + SAVE.y * frame.h,
    w: SAVE.size * frame.w, h: SAVE.size * frame.h,
  };
  showReview(await canvasToBlob(drawToCanvas(video, r, facing === 'user')));
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
    const c = drawToCanvas(img, centerCrop(img.naturalWidth, img.naturalHeight), false);
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
  toast(item.isDress ? 'Kleid der Mua hinzugefügt' : 'Outfit der Mua hinzugefügt');
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
  const n = items.length;
  const info = `${n} ${n === 1 ? 'Foto' : 'Fotos'} im Kleiderschrank der Mua · ` +
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
  if (!items.length) return toast('Der Schrank der Mua ist noch leer');
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
  openSheet(`Backup bereit: ${items.length} Fotos, ${mb} MB.\nDie Mua tippt auf „Teilen“ und dann auf „In Dateien sichern“.`, [
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
      if (!raw.id || have.has(raw.id) || typeof raw.image !== 'string' || !raw.image.startsWith('data:image/')) continue;
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
      : 'Alles aus dem Backup ist schon im Schrank');
  } catch {
    toast('Diese Datei ist kein Kleiderschrank-Backup');
  }
});

/* ---------------- Passwort ---------------- */
const hexToBytes = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
const bytesToHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function passwordMatches(input) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(input.trim().toUpperCase()), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(LOCK.salt), iterations: LOCK.iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(bits) === LOCK.hash;
}

function setupLock() {
  const lock = $('#lock');
  if (store.get('unlocked') === LOCK.hash.slice(0, 16)) { lock.hidden = true; return; }
  const input = $('#lockInput');
  setTimeout(() => input.focus(), 300);
  $('#lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#lockError');
    err.textContent = '';
    let ok = false;
    try { ok = await passwordMatches(input.value); } catch { ok = false; }
    if (ok) {
      store.set('unlocked', LOCK.hash.slice(0, 16));
      input.blur();
      lock.hidden = true;
      layout();
    } else {
      err.textContent = 'Das stimmt leider nicht.';
      input.select();
      lock.classList.remove('shake'); void lock.offsetWidth; lock.classList.add('shake');
    }
  });
}

/* ---------------- Installationshinweis ---------------- */
function maybeShowInstallHint() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone && !store.get('hideInstallHint')) $('#installHint').hidden = false;
}
$('#installHintClose').addEventListener('click', () => {
  $('#installHint').hidden = true;
  store.set('hideInstallHint', '1');
  if (items.length) layout();
});

/* ---------------- Start ---------------- */
(async function init() {
  setupLock();
  maybeShowInstallHint();
  try {
    items = (await DB.all()) || [];
    items.sort((a, b) => b.created - a.created);
  } catch {
    toast('Der Speicher konnte nicht geöffnet werden');
  }
  render();
  updateMenuDot();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
