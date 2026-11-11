'use strict';

// ================= Speicher =================
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
  return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)) };
})();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#a9825f', '#7f8f6e', '#b46f5a', '#6f7f99', '#9a7aa0', '#c49a3d', '#5f8f8a', '#8a6a55'];

function freshState() {
  const catIds = DEFAULT_CATEGORIES.map((c) => c.id);
  return {
    v: 2,
    members: [
      { id: 'm1', name: 'Ich', color: COLORS[0] },
      { id: 'm2', name: 'Meine Frau', color: COLORS[2] },
    ],
    me: 'm1',
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    stores: EMDEN_STORES.map((s) => ({ id: uid(), ...s, route: [...catIds], fav: s.name === 'Edeka Südbahnhof' })),
    items: [],
    learned: {},
  };
}

let state = freshState();
const ui = { view: 'dash', fStore: 'all', fPerson: 'all', storeType: 'all', storeQuery: '' };

const save = () => DB.set('state', state).catch((e) => toast('Speichern fehlgeschlagen: ' + e));

// Übernimmt Daten aus Version 1 (eine Liste, ein Laden)
function migrate(old) {
  if (old.v === 2) return old;
  const s = freshState();
  if (old.categories) s.categories = old.categories;
  const edeka = s.stores.find((x) => x.name === 'Edeka Südbahnhof');
  edeka.route = s.categories.map((c) => c.id);
  s.items = (old.items || []).map((i) => ({ ...i, storeId: null, who: null }));
  s.learned = old.learned || {};
  return s;
}

// ================= Hilfsfunktionen =================
const member = (id) => state.members.find((m) => m.id === id);
const store = (id) => state.stores.find((s) => s.id === id);
const cat = (id) => state.categories.find((c) => c.id === id) || state.categories.find((c) => c.id === 'sonstiges') || state.categories[0];
const stype = (id) => STORE_TYPES.find((t) => t.id === id) || STORE_TYPES[STORE_TYPES.length - 1];
const openItems = () => state.items.filter((i) => !i.done);

function routeOf(s) {
  // Laufweg des Ladens + neue Abteilungen, die dort noch fehlen, hinten dran
  const ids = state.categories.map((c) => c.id);
  const r = (s?.route || ids).filter((id) => ids.includes(id));
  ids.forEach((id) => { if (!r.includes(id)) r.splice(Math.max(0, r.length - (r.at(-1) === 'sonstiges' ? 1 : 0)), 0, id); });
  return r;
}

const categorize = (name, raw = name) => {
  const c = state.learned[name.toLowerCase().trim()] || guessCategory(raw);
  return state.categories.some((x) => x.id === c) ? c : 'sonstiges';
};

function avatar(m, size = '') {
  if (!m) return `<span class="av none ${size}" title="Nicht zugeteilt">?</span>`;
  return `<span class="av ${size}" style="--c:${m.color}" title="${esc(m.name)}">${esc(m.name.trim()[0] || '?').toUpperCase()}</span>`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function shrinkImage(file, max = 1000) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = rej; img.src = url;
  });
}
function pickPhoto() {
  return new Promise((res) => {
    const inp = $('#photo-input');
    inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; res(f ? await shrinkImage(f) : null); };
    inp.click();
  });
}

// ================= Artikel =================
function parseInput(raw) {
  let name = raw.trim(), note = '';
  const dash = name.split(/\s+[-–]\s+/);
  if (dash.length > 1) { name = dash[0]; note = dash.slice(1).join(' - '); }
  const m = name.match(/^(\d+[.,]?\d*\s*(x|g|kg|l|ml|stk|stück|pck|packungen?|flaschen?|dosen?|gläser|glas|beutel|kisten?)?)\s+(.+)$/i);
  if (m) { note = [m[1], note].filter(Boolean).join(', '); name = m[3]; }
  return { name, note };
}

function addItem(raw, extra = {}) {
  const { name, note } = parseInput(raw);
  if (!name) return;
  const defStore = ui.fStore !== 'all' && ui.fStore !== 'none' ? ui.fStore : null;
  const defWho = ui.fPerson !== 'all' && ui.fPerson !== 'none' ? ui.fPerson : null;
  state.items.unshift({ id: uid(), name, note, cat: categorize(name, raw), photo: null, done: false,
    storeId: defStore, who: defWho, by: state.me, created: Date.now(), ...extra });
  save();
}

function itemRow(it, opts = {}) {
  const s = store(it.storeId), m = member(it.who);
  const meta = [it.note && esc(it.note), opts.showStore && s && `<span class="tag">${stype(s.type).icon} ${esc(s.name)}</span>`, opts.showCat && `<span class="tag">${cat(it.cat).icon} ${esc(cat(it.cat).name)}</span>`].filter(Boolean).join(' ');
  return `<div class="item ${it.done ? 'done' : ''}" data-item="${it.id}">
    <button class="check" data-act="toggle" aria-label="abhaken"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
    <div class="txt" data-act="toggle"><span class="name">${esc(it.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</div>
    ${it.photo ? `<img class="thumb" data-act="photo" src="${it.photo}" alt="Foto">` : ''}
    <button class="who" data-act="who" aria-label="Wer kauft?">${avatar(m)}</button>
    <button class="more" data-act="edit" aria-label="bearbeiten">⋯</button>
  </div>`;
}

function quickAdd(placeholder = 'Was wird gebraucht?') {
  return `<form class="quick" data-form="add" autocomplete="off">
    <input name="q" placeholder="${placeholder}" enterkeyhint="done">
    <button type="button" class="icon-btn" data-act="add-photo" title="Mit Foto hinzufügen">${ICON.cam}</button>
    <button class="icon-btn primary" title="Hinzufügen">${ICON.plus}</button>
  </form>`;
}

const ICON = {
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
};

// ================= Ansicht: Übersicht =================
function renderDash() {
  const open = openItems(), done = state.items.filter((i) => i.done);
  const me = member(state.me);
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const storesWith = state.stores.filter((s) => open.some((i) => i.storeId === s.id));
  const unassigned = open.filter((i) => !i.who);
  const pct = state.items.length ? Math.round((done.length / state.items.length) * 100) : 0;

  const personCard = (m, items) => `<button class="card person-card" data-act="goto-person" data-id="${m ? m.id : 'none'}">
      <div class="row">${avatar(m, 'lg')}<div><h3>${m ? esc(m.name) : 'Noch offen'}</h3><p class="muted">${items.length} ${items.length === 1 ? 'Artikel' : 'Artikel'}</p></div></div>
      <ul class="mini">${items.slice(0, 4).map((i) => `<li>${esc(i.name)}</li>`).join('') || '<li class="muted">Nichts zu tun 🎉</li>'}${items.length > 4 ? `<li class="muted">+ ${items.length - 4} weitere</li>` : ''}</ul>
    </button>`;

  $('#view-dash').innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1>${hello}${me ? ', ' + esc(me.name) : ''}</h1></div>
      <button class="who-me" data-act="switch-me" title="Wer bist du?">${avatar(me, 'lg')}</button>
    </header>
    ${quickAdd()}
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>offen</span></div>
      <div class="stat"><b>${done.length}</b><span>im Wagen</span></div>
      <div class="stat"><b>${storesWith.length}</b><span>Läden</span></div>
      <div class="stat"><b>${pct}%</b><span>erledigt</span><i class="bar"><i style="width:${pct}%"></i></i></div>
    </div>

    <h2 class="sec">Wer kauft was</h2>
    <div class="grid">${state.members.map((m) => personCard(m, open.filter((i) => i.who === m.id))).join('')}
      ${unassigned.length ? personCard(null, unassigned) : ''}</div>

    <h2 class="sec">Wo einkaufen <button class="link" data-act="goto" data-view="stores">Alle Läden</button></h2>
    <div class="grid stores-grid">
      ${storesWith.map((s) => storeCard(s, open.filter((i) => i.storeId === s.id).length)).join('')}
      ${open.some((i) => !i.storeId) ? `<button class="card store-card" data-act="goto-store" data-id="none"><span class="sicon">✳︎</span><div><h3>Egal wo</h3><p class="muted">${open.filter((i) => !i.storeId).length} Artikel ohne Laden</p></div></button>` : ''}
      ${!storesWith.length ? state.stores.filter((s) => s.fav).slice(0, 4).map((s) => storeCard(s, 0)).join('') : ''}
    </div>

    ${open.length ? `<h2 class="sec">Zuletzt hinzugefügt</h2><div class="card list-card">${open.slice(0, 5).map((i) => itemRow(i, { showStore: true })).join('')}</div>` :
      `<div class="empty card"><p class="big">Die Liste ist leer.</p><p class="muted">Oben eintragen: Die App sortiert es automatisch in die richtige Abteilung.</p></div>`}
  `;
}

function storeCard(s, n) {
  return `<button class="card store-card" data-act="goto-store" data-id="${s.id}">
    <span class="sicon">${stype(s.type).icon}</span>
    <div><h3>${esc(s.name)}</h3><p class="muted">${n ? `<b>${n}</b> offen` : esc(s.address || stype(s.type).name)}</p></div>
  </button>`;
}

// ================= Ansicht: Liste =================
function renderList() {
  const matchP = (i) => ui.fPerson === 'all' || (ui.fPerson === 'none' ? !i.who : i.who === ui.fPerson);
  const matchS = (i) => ui.fStore === 'all' || (ui.fStore === 'none' ? !i.storeId : i.storeId === ui.fStore || !i.storeId);
  const items = state.items.filter((i) => matchP(i) && matchS(i));
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);

  const storeChips = [{ id: 'all', label: 'Alle Läden' }, ...state.stores.filter((s) => s.fav || state.items.some((i) => i.storeId === s.id) || ui.fStore === s.id).map((s) => ({ id: s.id, label: `${stype(s.type).icon} ${s.name}` })), { id: 'none', label: 'Egal wo' }];
  const personChips = [{ id: 'all', label: 'Alle' }, ...state.members.map((m) => ({ id: m.id, label: m.name, m })), { id: 'none', label: 'Offen' }];

  const groupByCat = (list, route) => route.map((cid, idx) => {
    const g = list.filter((i) => cat(i.cat).id === cid);
    if (!g.length) return '';
    const c = cat(cid);
    return `<div class="cat-group"><h4><span class="step">${idx + 1}</span>${c.icon} ${esc(c.name)}</h4>${g.map((i) => itemRow(i)).join('')}</div>`;
  }).join('');

  let body = '';
  if (ui.fStore === 'all') {
    // Nach Laden gruppiert, innerhalb des Ladens nach dessen Laufweg
    const groups = [...state.stores.filter((s) => open.some((i) => i.storeId === s.id)).map((s) => ({ s, list: open.filter((i) => i.storeId === s.id) })),
      { s: null, list: open.filter((i) => !i.storeId) }].filter((g) => g.list.length);
    body = groups.map((g) => `<div class="card store-block">
      <div class="store-head">${g.s ? `<span class="sicon sm">${stype(g.s.type).icon}</span><div><h3>${esc(g.s.name)}</h3><p class="muted">${esc(g.s.address || '')}</p></div>
        <button class="link" data-act="goto-store" data-id="${g.s.id}">Einkaufen →</button>` : `<span class="sicon sm">✳︎</span><div><h3>Egal wo</h3><p class="muted">Noch keinem Laden zugeordnet</p></div>`}</div>
      ${groupByCat(g.list, routeOf(g.s))}</div>`).join('');
  } else {
    const s = store(ui.fStore);
    body = open.length ? `<div class="card store-block">${s ? `<div class="store-head"><span class="sicon sm">${stype(s.type).icon}</span><div><h3>${esc(s.name)}</h3><p class="muted">Sortiert nach eurem Laufweg</p></div><button class="link" data-act="edit-store" data-id="${s.id}">Laufweg ✎</button></div>` : ''}${groupByCat(open, routeOf(s))}</div>` : '';
  }

  $('#view-list').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">${open.length} offen · ${done.length} im Wagen</p><h1>Einkaufsliste</h1></div></header>
    ${quickAdd()}
    <div class="chips" data-filter="fStore">${storeChips.map((c) => `<button class="chip ${ui.fStore === c.id ? 'on' : ''}" data-val="${c.id}">${esc(c.label)}</button>`).join('')}</div>
    <div class="chips" data-filter="fPerson">${personChips.map((c) => `<button class="chip ${ui.fPerson === c.id ? 'on' : ''}" data-val="${c.id}">${c.m ? avatar(c.m, 'xs') : ''}${esc(c.label)}</button>`).join('')}</div>
    ${body || `<div class="empty card"><p class="big">Hier ist nichts offen.</p><p class="muted">Trag oben etwas ein oder ändere den Filter.</p></div>`}
    ${done.length ? `<h2 class="sec">Im Wagen <button class="link" data-act="clear-done">Erledigte entfernen</button></h2><div class="card list-card">${done.map((i) => itemRow(i, { showStore: true })).join('')}</div>` : ''}
  `;
}

// ================= Ansicht: Läden =================
function renderStores() {
  const q = ui.storeQuery.toLowerCase();
  const list = state.stores.filter((s) => (ui.storeType === 'all' || s.type === ui.storeType || (ui.storeType === 'fav' && s.fav)) &&
    (!q || (s.name + ' ' + (s.address || '')).toLowerCase().includes(q)));
  const types = STORE_TYPES.filter((t) => state.stores.some((s) => s.type === t.id));
  const byType = types.map((t) => ({ t, list: list.filter((s) => s.type === t.id) })).filter((g) => g.list.length);
  const open = openItems();

  $('#view-stores').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">${state.stores.length} Läden in Emden</p><h1>Läden</h1></div>
      <button class="btn primary" data-act="new-store">${ICON.plus} Laden</button></header>
    <div class="toolbar">
      <input class="search" placeholder="Laden suchen …" value="${esc(ui.storeQuery)}" data-input="storeQuery">
      <button class="btn" data-act="osm">${ICON.pin} Läden in Emden suchen</button>
    </div>
    <div class="chips" data-filter="storeType">
      <button class="chip ${ui.storeType === 'all' ? 'on' : ''}" data-val="all">Alle</button>
      <button class="chip ${ui.storeType === 'fav' ? 'on' : ''}" data-val="fav">★ Favoriten</button>
      ${types.map((t) => `<button class="chip ${ui.storeType === t.id ? 'on' : ''}" data-val="${t.id}">${t.icon} ${t.name}</button>`).join('')}
    </div>
    ${byType.map((g) => `<h2 class="sec">${g.t.icon} ${g.t.name}</h2><div class="card list-card">${g.list.map((s) => {
      const n = open.filter((i) => i.storeId === s.id).length;
      return `<div class="srow" data-store="${s.id}">
        <button class="star ${s.fav ? 'on' : ''}" data-act="fav" aria-label="Favorit">${ICON.star}</button>
        <div class="txt" data-act="goto-store" data-id="${s.id}"><span class="name">${esc(s.name)}</span><span class="meta">${esc(s.address || '')}</span></div>
        ${n ? `<span class="badge">${n}</span>` : ''}
        <button class="more" data-act="edit-store" data-id="${s.id}" aria-label="bearbeiten">⋯</button>
      </div>`;
    }).join('')}</div>`).join('') || '<div class="empty card"><p class="muted">Kein Laden gefunden.</p></div>'}
  `;
}

// ================= Ansicht: Personen =================
function renderPeople() {
  const open = openItems();
  $('#view-people').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">Wer kauft ein?</p><h1>Personen</h1></div>
      <button class="btn primary" data-act="new-member">${ICON.plus} Person</button></header>
    <div class="card list-card">
      ${state.members.map((m) => `<div class="srow">
        ${avatar(m, 'lg')}
        <div class="txt"><span class="name">${esc(m.name)} ${m.id === state.me ? '<span class="tag">Das bin ich</span>' : ''}</span>
          <span class="meta">${open.filter((i) => i.who === m.id).length} offene Artikel</span></div>
        ${m.id !== state.me ? `<button class="btn sm" data-act="set-me" data-id="${m.id}">Das bin ich</button>` : ''}
        <button class="more" data-act="edit-member" data-id="${m.id}" aria-label="bearbeiten">⋯</button>
      </div>`).join('') || '<p class="muted pad">Noch keine Personen.</p>'}
    </div>
    <p class="muted small">„Das bin ich“ legt fest, wer auf diesem Gerät eingeloggt ist. Jeder stellt das auf seinem eigenen Handy ein.</p>
  `;
}

// ================= Ansicht: Mehr =================
function renderSettings() {
  $('#view-settings').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">Einstellungen</p><h1>Mehr</h1></div></header>
    <h2 class="sec">Abteilungen <button class="link" data-act="new-cat">+ Neu</button></h2>
    <p class="muted small">Hier legt ihr fest, welche Abteilungen es gibt. Die Reihenfolge pro Laden stellt ihr beim Laden unter „Laufweg“ ein.</p>
    <div class="card list-card">${state.categories.map((c) => `<div class="srow">
      <span class="sicon sm">${c.icon}</span><div class="txt"><span class="name">${esc(c.name)}</span></div>
      <button class="more" data-act="edit-cat" data-id="${c.id}" aria-label="bearbeiten">⋯</button></div>`).join('')}</div>

    <h2 class="sec">Daten</h2>
    <div class="card pad stack">
      <button class="btn" data-act="export">Sicherung herunterladen</button>
      <button class="btn" data-act="import">Sicherung einspielen</button>
      <button class="btn danger" data-act="reset">Alles zurücksetzen</button>
    </div>
  `;
}

// ================= Dialoge =================
function dialog(html, onClose) {
  const d = $('#dlg'), f = $('#dlg-form');
  f.innerHTML = html;
  d.returnValue = '';
  d.onclose = () => onClose(d.returnValue, new FormData(f), f);
  d.showModal();
  return f;
}
const opts = (list, sel) => list.map((o) => `<option value="${o.v}" ${o.v === sel ? 'selected' : ''}>${esc(o.t)}</option>`).join('');
const swatches = (sel) => `<div class="swatches">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === sel ? 'checked' : ''}><span style="--c:${c}"></span></label>`).join('')}</div>`;

function editItem(it) {
  let photo = it.photo;
  const f = dialog(`
    <h3>Artikel</h3>
    <label>Name<input name="name" value="${esc(it.name)}" required></label>
    <label>Menge / Notiz<input name="note" value="${esc(it.note || '')}" placeholder="z. B. 500 g, die rote Packung"></label>
    <div class="two">
      <label>Wer kauft?<select name="who">${opts([{ v: '', t: '— offen —' }, ...state.members.map((m) => ({ v: m.id, t: m.name }))], it.who || '')}</select></label>
      <label>Wo?<select name="storeId">${opts([{ v: '', t: '— egal wo —' }, ...[...state.stores].sort((a, b) => b.fav - a.fav || a.name.localeCompare(b.name)).map((s) => ({ v: s.id, t: (s.fav ? '★ ' : '') + s.name }))], it.storeId || '')}</select></label>
    </div>
    <label>Abteilung<select name="cat">${opts(state.categories.map((c) => ({ v: c.id, t: c.icon + ' ' + c.name })), cat(it.cat).id)}</select></label>
    <div class="photo-box"></div>
    <menu><button value="delete" class="btn danger ghost">Löschen</button><span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary">Speichern</button></menu>
  `, (v, fd) => {
    if (v === 'delete') state.items = state.items.filter((i) => i !== it);
    if (v === 'save') {
      it.name = fd.get('name').trim() || it.name;
      it.note = fd.get('note').trim();
      it.who = fd.get('who') || null;
      it.storeId = fd.get('storeId') || null;
      if (fd.get('cat') !== it.cat) state.learned[it.name.toLowerCase()] = fd.get('cat');
      it.cat = fd.get('cat');
      it.photo = photo;
    }
    save(); render();
  });
  const box = $('.photo-box', f);
  const drawPhoto = () => {
    box.innerHTML = photo ? `<img src="${photo}" alt=""><button type="button" class="btn sm ghost" data-p="rm">Foto entfernen</button>`
      : `<button type="button" class="btn sm" data-p="add">${ICON.cam} Foto hinzufügen</button>`;
  };
  box.onclick = async (e) => {
    const p = e.target.closest('[data-p]')?.dataset.p;
    if (p === 'rm') photo = null;
    if (p === 'add') photo = (await pickPhoto()) || photo;
    drawPhoto();
  };
  drawPhoto();
}

function editStore(s) {
  const isNew = !s;
  s ||= { id: uid(), name: '', type: 'supermarkt', address: '', route: state.categories.map((c) => c.id), fav: true };
  let route = routeOf(s);
  const f = dialog(`
    <h3>${isNew ? 'Neuer Laden' : 'Laden bearbeiten'}</h3>
    <label>Name<input name="name" value="${esc(s.name)}" required placeholder="z. B. Wochenmarkt"></label>
    <div class="two">
      <label>Art<select name="type">${opts(STORE_TYPES.map((t) => ({ v: t.id, t: t.icon + ' ' + t.name })), s.type)}</select></label>
      <label>Adresse<input name="address" value="${esc(s.address || '')}"></label>
    </div>
    <h4 class="sub">Laufweg <span class="muted small">vom Eingang bis zur Kasse</span></h4>
    <ol class="route"></ol>
    <menu>${isNew ? '' : '<button value="delete" class="btn danger ghost" formnovalidate>Löschen</button>'}<span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary">Speichern</button></menu>
  `, (v, fd) => {
    if (v === 'delete') {
      if (!confirm(`„${s.name}“ löschen? Artikel bleiben erhalten (dann „egal wo“).`)) return;
      state.stores = state.stores.filter((x) => x !== s);
      state.items.forEach((i) => { if (i.storeId === s.id) i.storeId = null; });
      if (ui.fStore === s.id) ui.fStore = 'all';
    }
    if (v === 'save') {
      Object.assign(s, { name: fd.get('name').trim(), type: fd.get('type'), address: fd.get('address').trim(), route });
      if (isNew) state.stores.push(s);
    }
    save(); render();
  });
  const ol = $('.route', f);
  const draw = () => {
    ol.innerHTML = route.map((id, i) => `<li><span class="n">${i + 1}</span><span class="nm">${cat(id).icon} ${esc(cat(id).name)}</span>
      <button type="button" data-r="up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="nach oben">▲</button>
      <button type="button" data-r="down" data-i="${i}" ${i < route.length - 1 ? '' : 'disabled'} aria-label="nach unten">▼</button></li>`).join('');
  };
  ol.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, j = b.dataset.r === 'up' ? i - 1 : i + 1;
    [route[i], route[j]] = [route[j], route[i]];
    draw();
  };
  draw();
}

function editMember(m) {
  const isNew = !m;
  m ||= { id: uid(), name: '', color: COLORS[state.members.length % COLORS.length] };
  dialog(`
    <h3>${isNew ? 'Neue Person' : 'Person bearbeiten'}</h3>
    <label>Name<input name="name" value="${esc(m.name)}" required placeholder="z. B. Anna"></label>
    <label>Farbe</label>${swatches(m.color)}
    <menu>${isNew ? '' : '<button value="delete" class="btn danger ghost" formnovalidate>Entfernen</button>'}<span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary">Speichern</button></menu>
  `, (v, fd) => {
    if (v === 'delete') {
      if (!confirm(`${m.name} entfernen? Ihre/seine Artikel werden wieder „offen“.`)) return;
      state.members = state.members.filter((x) => x !== m);
      state.items.forEach((i) => { if (i.who === m.id) i.who = null; });
      if (state.me === m.id) state.me = state.members[0]?.id || null;
      if (ui.fPerson === m.id) ui.fPerson = 'all';
    }
    if (v === 'save') {
      m.name = fd.get('name').trim(); m.color = fd.get('color') || m.color;
      if (isNew) { state.members.push(m); if (!state.me) state.me = m.id; }
    }
    save(); render();
  });
}

function editCat(c) {
  const isNew = !c;
  c ||= { id: uid(), name: '', icon: '🏷️' };
  dialog(`
    <h3>${isNew ? 'Neue Abteilung' : 'Abteilung bearbeiten'}</h3>
    <div class="two narrow-first"><label>Symbol<input name="icon" value="${esc(c.icon)}" maxlength="4"></label>
    <label>Name<input name="name" value="${esc(c.name)}" required placeholder="z. B. Asia-Regal"></label></div>
    <menu>${isNew || c.id === 'sonstiges' ? '' : '<button value="delete" class="btn danger ghost" formnovalidate>Löschen</button>'}<span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary">Speichern</button></menu>
  `, (v, fd) => {
    if (v === 'delete') {
      if (!confirm(`„${c.name}“ löschen? Artikel daraus landen unter „Sonstiges“.`)) return;
      state.categories = state.categories.filter((x) => x !== c);
      state.items.forEach((i) => { if (i.cat === c.id) i.cat = 'sonstiges'; });
    }
    if (v === 'save') {
      c.name = fd.get('name').trim(); c.icon = fd.get('icon').trim() || '🏷️';
      if (isNew) state.categories.splice(state.categories.length - 1, 0, c);
    }
    save(); render();
  });
}

// Läden live aus OpenStreetMap laden (läuft auf eurem Gerät)
async function osmSearch() {
  const f = dialog(`<h3>Läden in Emden</h3><p class="muted">Suche in OpenStreetMap …</p><div class="osm"><div class="spinner"></div></div>
    <menu><span></span><button value="cancel" class="btn">Schließen</button></menu>`, () => { save(); render(); });
  const shops = Object.keys(OSM_TYPE).join('|');
  const q = `[out:json][timeout:40];area["name"="Emden"]["boundary"="administrative"]["admin_level"="6"]->.a;nwr["shop"~"^(${shops})$"]["name"](area.a);out center tags;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const known = new Set(state.stores.map((s) => (s.name + '|' + (s.address || '')).toLowerCase()));
    const found = data.elements.map((e) => {
      const t = e.tags;
      const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
      return { name: t.name, address, type: OSM_TYPE[t.shop] || 'sonst' };
    }).filter((s, i, a) => a.findIndex((x) => x.name === s.name && x.address === s.address) === i)
      .filter((s) => !known.has((s.name + '|' + s.address).toLowerCase()))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    $('p.muted', f).textContent = found.length ? `${found.length} weitere Läden gefunden. Antippen zum Hinzufügen:` : 'Keine neuen Läden gefunden – ihr habt schon alle.';
    $('.osm', f).innerHTML = (found.length ? `<button type="button" class="btn sm" data-o="all">Alle hinzufügen</button>` : '') +
      found.map((s, i) => `<button type="button" class="osm-row" data-o="${i}"><span>${stype(s.type).icon}</span><span class="txt"><b>${esc(s.name)}</b><small>${esc(s.address)}</small></span><span class="add">+</span></button>`).join('');
    $('.osm', f).onclick = (e) => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      const route = state.categories.map((c) => c.id);
      const add = (s) => state.stores.push({ id: uid(), ...s, route: [...route], fav: false });
      if (b.dataset.o === 'all') { found.forEach(add); $$('.osm-row', f).forEach((x) => x.classList.add('added')); b.remove(); toast(found.length + ' Läden hinzugefügt'); }
      else if (!b.classList.contains('added')) { add(found[+b.dataset.o]); b.classList.add('added'); }
    };
  } catch (err) {
    $('p.muted', f).textContent = 'Konnte OpenStreetMap nicht erreichen (' + err.message + '). Bitte später nochmal versuchen oder Läden von Hand anlegen.';
    $('.osm', f).innerHTML = '';
  }
}

// ================= Ereignisse =================
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.form !== 'add') return;
  e.preventDefault();
  const v = f.q.value.trim();
  if (!v) return;
  addItem(v);
  render();
  toast(`„${parseInput(v).name}“ → ${cat(state.items[0].cat).name}`);
  $(`#view-${ui.view} [data-form=add] input`)?.focus();
});

document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (!k) return;
  ui[k] = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const inp = $(`#view-${ui.view} [data-input=${k}]`);
  inp.focus(); inp.setSelectionRange(pos, pos);
});

document.addEventListener('click', async (e) => {
  const chip = e.target.closest('.chips .chip');
  if (chip) { ui[chip.parentElement.dataset.filter] = chip.dataset.val; render(); return; }
  const nav = e.target.closest('#nav button');
  if (nav) return go(nav.dataset.view);

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  const it = state.items.find((i) => i.id === el.closest('[data-item]')?.dataset.item);
  const st = store(el.closest('[data-store]')?.dataset.store);

  switch (act) {
    case 'toggle': it.done = !it.done; save(); render(); break;
    case 'photo': $('#photo-big').src = it.photo; $('#photo-dialog').showModal(); break;
    case 'edit': editItem(it); break;
    case 'who': { // Antippen wechselt: Ich → Partner → … → offen
      const ids = [...state.members.map((m) => m.id), null];
      it.who = ids[(ids.indexOf(it.who) + 1) % ids.length];
      save(); render(); toast(it.who ? `${it.name} → ${member(it.who).name}` : `${it.name} ist wieder offen`);
      break;
    }
    case 'add-photo': {
      const f = el.closest('form');
      const photo = await pickPhoto();
      if (!photo) return;
      const name = f.q.value.trim() || prompt('Wie heißt der Artikel?');
      if (!name) return;
      addItem(name, { photo }); render(); toast('Mit Foto hinzugefügt');
      break;
    }
    case 'clear-done': state.items = state.items.filter((i) => !i.done || !$(`#view-list [data-item="${i.id}"]`)); save(); render(); break;
    case 'goto': go(el.dataset.view); break;
    case 'goto-store': ui.fStore = id; ui.fPerson = 'all'; go('list'); break;
    case 'goto-person': ui.fPerson = id; ui.fStore = 'all'; go('list'); break;
    case 'switch-me': go('people'); break;
    case 'set-me': state.me = id; save(); render(); toast(`Hallo ${member(id).name}!`); break;
    case 'fav': st.fav = !st.fav; save(); render(); break;
    case 'new-store': editStore(); break;
    case 'edit-store': editStore(store(id)); break;
    case 'osm': osmSearch(); break;
    case 'new-member': editMember(); break;
    case 'edit-member': editMember(member(id)); break;
    case 'new-cat': editCat(); break;
    case 'edit-cat': editCat(cat(id)); break;
    case 'export': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
      a.download = `einkauf-sicherung-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      break;
    }
    case 'import': {
      const inp = $('#import-input');
      inp.onchange = async () => {
        try { const d = JSON.parse(await inp.files[0].text()); if (!d.items || !d.categories) throw 0; state = migrate(d); save(); render(); toast('Sicherung eingespielt'); }
        catch { toast('Diese Datei passt nicht.'); }
        inp.value = '';
      };
      inp.click();
      break;
    }
    case 'reset': if (confirm('Wirklich alles löschen und neu anfangen?')) { state = freshState(); save(); render(); } break;
  }
});

// ================= Navigation & Start =================
const RENDER = { dash: renderDash, list: renderList, stores: renderStores, people: renderPeople, settings: renderSettings };
function render() {
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + ui.view));
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  RENDER[ui.view]();
}
function go(view) { ui.view = view; render(); window.scrollTo({ top: 0 }); }

(async () => {
  try { const saved = await DB.get('state'); if (saved) state = migrate(saved); } catch (e) { console.warn(e); }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
