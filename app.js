'use strict';

// ---------- Speicher (IndexedDB, damit auch Fotos Platz haben) ----------
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('einkauf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  };
})();

let state = {
  store: 'Edeka Südbahnhof Emden',
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  items: [],
  learned: {}, // "tomaten" -> "obst": merkt sich eure Korrekturen
};

const save = () => DB.set('state', state).catch((e) => alert('Speichern fehlgeschlagen: ' + e));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catById = (id) => state.categories.find((c) => c.id === id) || state.categories.find((c) => c.id === 'sonstiges') || state.categories[0];
const categorize = (name, raw = name) => {
  const key = name.toLowerCase().trim();
  const c = state.learned[key] || guessCategory(raw);
  return state.categories.some((x) => x.id === c) ? c : 'sonstiges';
};

// ---------- Fotos verkleinern ----------
function shrinkImage(file, max = 900) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = rej;
    img.src = url;
  });
}

// ---------- Liste ----------
function itemHTML(it) {
  return `<div class="item ${it.done ? 'done' : ''}" data-id="${it.id}">
    <button class="check" aria-label="abhaken">${it.done ? '✔' : ''}</button>
    <div class="txt"><span class="name">${esc(it.name)}</span>${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}</div>
    ${it.photo ? `<img class="thumb" src="${it.photo}" alt="Foto">` : ''}
    <button class="edit" aria-label="bearbeiten">⋯</button>
  </div>`;
}

function renderList() {
  const open = state.items.filter((i) => !i.done);
  const done = state.items.filter((i) => i.done);
  let html = '';
  state.categories.forEach((c, idx) => {
    const items = open.filter((i) => catById(i.cat).id === c.id);
    if (!items.length) return;
    html += `<div class="group"><h2><span class="step">${idx + 1}</span>${c.icon || ''} ${esc(c.name)}</h2>${items.map(itemHTML).join('')}</div>`;
  });
  $('#list').innerHTML = html;
  $('#done').innerHTML = done.map(itemHTML).join('');
  $('#done-wrap').hidden = !done.length;
  $('#empty').hidden = state.items.length > 0;
}

let pendingPhoto = null;
$('#add-photo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  pendingPhoto = await shrinkImage(f);
  $('#add-preview').innerHTML = `<img src="${pendingPhoto}" alt=""><button type="button" class="link" id="rm-photo">Foto entfernen</button>`;
  $('#add-preview').hidden = false;
  e.target.value = '';
});
$('#add-preview').addEventListener('click', (e) => {
  if (e.target.id === 'rm-photo') { pendingPhoto = null; $('#add-preview').hidden = true; }
});

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#add-name').value.trim();
  if (!raw) return;
  // "2 Gurken" oder "Käse - der milde" -> Name + Notiz
  let name = raw, note = '';
  const dash = raw.split(/\s+[-–]\s+/);
  if (dash.length > 1) { name = dash[0]; note = dash.slice(1).join(' - '); }
  const m = name.match(/^(\d+[.,]?\d*\s*(x|g|kg|l|ml|stk|pck|packungen?|flaschen?|dosen?)?)\s+(.+)$/i);
  if (m) { note = [m[1], note].filter(Boolean).join(', '); name = m[3]; }
  state.items.push({ id: uid(), name, note, cat: categorize(name, raw), photo: pendingPhoto, done: false, created: Date.now() });
  pendingPhoto = null;
  $('#add-preview').hidden = true;
  $('#add-name').value = '';
  save(); renderList();
  $('#add-name').focus();
});

function onItemClick(e) {
  const row = e.target.closest('.item');
  if (!row) return;
  const it = state.items.find((i) => i.id === row.dataset.id);
  if (e.target.classList.contains('thumb')) { $('#photo-big').src = it.photo; $('#photo-dialog').showModal(); return; }
  if (e.target.classList.contains('edit')) { openEdit(it); return; }
  it.done = !it.done;
  save(); renderList();
}
$('#list').addEventListener('click', onItemClick);
$('#done').addEventListener('click', onItemClick);
$('#clear-done').addEventListener('click', () => {
  state.items = state.items.filter((i) => !i.done);
  save(); renderList();
});

// ---------- Bearbeiten ----------
let editing = null, editPhoto;
function openEdit(it) {
  editing = it; editPhoto = it.photo;
  $('#d-name').value = it.name;
  $('#d-note').value = it.note || '';
  $('#d-cat').innerHTML = state.categories.map((c) => `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`).join('');
  $('#d-cat').value = catById(it.cat).id;
  showEditPhoto();
  $('#item-dialog').showModal();
}
function showEditPhoto() {
  $('#d-photo').innerHTML = editPhoto ? `<img src="${editPhoto}" alt=""><button type="button" class="link" id="d-rm">Foto entfernen</button>` : '';
}
$('#d-photo').addEventListener('click', (e) => { if (e.target.id === 'd-rm') { editPhoto = null; showEditPhoto(); } });
$('#d-photo-input').addEventListener('change', async (e) => {
  if (e.target.files[0]) { editPhoto = await shrinkImage(e.target.files[0]); showEditPhoto(); }
  e.target.value = '';
});
$('#item-dialog').addEventListener('close', () => {
  const v = $('#item-dialog').returnValue;
  if (!editing) return;
  if (v === 'delete') state.items = state.items.filter((i) => i !== editing);
  if (v === 'save') {
    editing.name = $('#d-name').value.trim() || editing.name;
    editing.note = $('#d-note').value.trim();
    const newCat = $('#d-cat').value;
    if (newCat !== editing.cat) state.learned[editing.name.toLowerCase()] = newCat; // merken
    editing.cat = newCat;
    editing.photo = editPhoto;
  }
  editing = null;
  save(); renderList();
});

// ---------- Laufweg ----------
function renderRoute() {
  $('#store-name').value = state.store;
  $('#route').innerHTML = state.categories.map((c, i) => `<li data-i="${i}">
    <span class="nm">${c.icon || ''} ${esc(c.name)}</span>
    <button data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button>
    <button data-a="down" ${i === state.categories.length - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button>
    <button data-a="ren" aria-label="umbenennen">✎</button>
    ${c.id === 'sonstiges' ? '' : '<button data-a="del" aria-label="löschen">✕</button>'}
  </li>`).join('');
}
$('#route').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = +b.closest('li').dataset.i, cats = state.categories, c = cats[i];
  const a = b.dataset.a;
  if (a === 'up') [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
  if (a === 'down') [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
  if (a === 'ren') { const n = prompt('Neuer Name:', c.name); if (n && n.trim()) c.name = n.trim(); }
  if (a === 'del') {
    if (!confirm(`„${c.name}“ löschen? Artikel daraus landen unter „Sonstiges“.`)) return;
    cats.splice(i, 1);
    state.items.forEach((it) => { if (it.cat === c.id) it.cat = 'sonstiges'; });
  }
  save(); renderRoute();
});
$('#store-name').addEventListener('change', (e) => { state.store = e.target.value; save(); });
$('#add-cat').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = $('#add-cat-name').value.trim();
  if (!n) return;
  state.categories.splice(state.categories.length - 1, 0, { id: uid(), name: n, icon: '🏷️' });
  $('#add-cat-name').value = '';
  save(); renderRoute();
});

// ---------- Navigation ----------
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  $('#view-list').hidden = b.dataset.view !== 'list';
  $('#view-route').hidden = b.dataset.view !== 'route';
  if (b.dataset.view === 'route') renderRoute(); else renderList();
}));

// ---------- Start ----------
(async () => {
  try {
    const saved = await DB.get('state');
    if (saved) state = { ...state, ...saved };
  } catch (e) { console.warn(e); }
  renderList();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
