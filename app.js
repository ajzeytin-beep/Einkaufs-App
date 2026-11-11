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

const APP_VERSION = 17; // bei jeder Änderung zusammen mit sw.js hochzählen
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
    offers: [],
    learned: {},
  };
}

let state = freshState();
const ui = { view: 'dash', fStore: 'all', fPerson: 'all', storeType: 'all', storeQuery: '', draft: '', addWho: null };

const save = () => { DB.set('state', state).catch((e) => toast('Speichern fehlgeschlagen: ' + e)); Sync.push(); };

// Übernimmt Daten aus Version 1 (eine Liste, ein Laden)
function migrate(old) {
  if (old.v === 2) { old.offers ||= []; return old; }
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

// ================= Angebote =================
const today = () => new Date().toISOString().slice(0, 10);
const nextSaturday = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };
const activeOffers = () => state.offers.filter((o) => !o.until || o.until >= today());
const words = (t) => t.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
function sameWord(a, b) {
  const n = Math.min(5, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n) && (a.startsWith(b) || b.startsWith(a) || n >= 5);
}
function offersFor(it) {
  const iw = words(it.name), strong = [], soft = [];
  for (const o of activeOffers()) {
    const ow = words(o.name);
    if (iw.some((a) => ow.some((b) => sameWord(a, b)))) strong.push(o);
    else if (o.cat === cat(it.cat).id && o.cat !== 'sonstiges') soft.push(o);
  }
  return { strong, soft };
}
const euro = (p) => (p || p === 0) && p !== '' ? Number(String(p).replace(',', '.')).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '';
const untilTxt = (d) => d ? 'bis ' + new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '';
function offerLine(o) {
  const st = store(o.storeId);
  return [st ? st.name : 'Überall', euro(o.price), untilTxt(o.until)].filter(Boolean).join(' · ');
}
// Prospekt-Links nach Kette (offizielle Seiten der Händler)
const CHAIN_LINKS = [
  ['edeka', 'Edeka', 'https://www.edeka.de'], ['rewe', 'Rewe', 'https://www.rewe.de/angebote/'], ['lidl', 'Lidl', 'https://www.lidl.de'],
  ['aldi', 'Aldi Nord', 'https://www.aldi-nord.de'], ['netto', 'Netto', 'https://www.netto-online.de'], ['penny', 'Penny', 'https://www.penny.de'],
  ['kaufland', 'Kaufland', 'https://www.kaufland.de'], ['rossmann', 'Rossmann', 'https://www.rossmann.de'], ['dm', 'dm', 'https://www.dm.de'],
];
function chainLinks() {
  const names = state.stores.filter((s) => s.fav || state.items.some((i) => i.storeId === s.id)).map((s) => s.name.toLowerCase());
  const mine = CHAIN_LINKS.filter(([k]) => names.some((n) => n.split(/\s+/)[0] === k));
  return mine.length ? mine : CHAIN_LINKS.slice(0, 4);
}

function avatar(m, size = '') {
  if (!m) return `<span class="av none ${size}" title="Nicht zugeteilt">?</span>`;
  return `<span class="av ${size}" style="--c:${m.color}" title="${esc(m.name)}">${esc(m.name.trim()[0] || '?').toUpperCase()}</span>`;
}

function syncPill() {
  const st = Sync.status;
  const txt = { off: 'Nur auf diesem Gerät', connecting: 'Verbinde …', on: 'Gemeinsam · synchron', offline: 'Offline · wird später abgeglichen', error: 'Abgleich gestört' }[st];
  return `<button class="sync-pill ${st}" data-act="goto" data-view="settings" title="${esc(Sync.error || txt)}"><i></i>${txt}</button>`;
}

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : '');
  t.classList.toggle('deal-toast', !!action?.deal);
  if (action) $('button', t).onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2200);
}

function shrinkImage(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
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
  const defWho = ui.addWho || null;
  state.items.unshift({ id: uid(), name, note, cat: categorize(name, raw), photo: null, done: false,
    storeId: defStore, who: defWho, by: state.me, created: Date.now(), ...extra });
  save();
}

function itemRow(it, opts = {}) {
  const s = store(it.storeId), m = member(it.who);
  let deal = '';
  if (!it.done && state.offers.length) {
    const { strong, soft } = offersFor(it);
    if (strong.length) deal = `<button class="deal" data-act="deal">% ${strong.length > 1 ? strong.length + ' Angebote' : 'Angebot: ' + esc(offerLine(strong[0]))}</button>`;
    else if (soft.length) deal = `<button class="deal soft" data-act="deal">% ${soft.length} ${soft.length > 1 ? 'Angebote' : 'Angebot'} in ${esc(cat(it.cat).name)}</button>`;
  }
  const meta = [deal, it.note && esc(it.note), opts.showStore && s && `<span class="tag">${stype(s.type).icon} ${esc(s.name)}</span>`, opts.showCat && `<span class="tag">${cat(it.cat).icon} ${esc(cat(it.cat).name)}</span>`].filter(Boolean).join(' ');
  return `<div class="item ${it.done ? 'done' : ''}" data-item="${it.id}">
    <button class="check" data-act="toggle" aria-label="abhaken"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
    <div class="txt" data-act="toggle"><span class="name">${esc(it.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</div>
    ${it.photo ? `<img class="thumb" data-act="photo" src="${it.photo}" alt="Foto">` : ''}
    <button class="who" data-act="who" aria-label="Wer kauft?">${avatar(m)}</button>
    <button class="more" data-act="edit" aria-label="bearbeiten">⋯</button>
  </div>`;
}

function quickAdd(placeholder = 'Was wird gebraucht?') {
  // Gewählte Person bleibt bestehen (mehrere Sachen hintereinander für dieselbe Person)
  if (ui.addWho && !member(ui.addWho)) ui.addWho = null;
  const chip = (id, label, m) => `<button type="button" class="chip sm ${ui.addWho === id ? 'on' : ''}" data-act="add-who" data-id="${id ?? ''}">${m ? avatar(m, 'xs') : ''}${esc(label)}</button>`;
  return `<form class="quick-form" data-form="add" autocomplete="off">
    <div class="quick">
      <input name="q" placeholder="${placeholder}" enterkeyhint="done" value="${esc(ui.draft)}">
      <button type="button" class="icon-btn" data-act="add-photo" title="Mit Foto hinzufügen">${ICON.cam}</button>
      <button class="icon-btn primary" title="Hinzufügen">${ICON.plus}</button>
    </div>
    ${state.members.length ? `<div class="for-row"><span>Wer kauft?</span>${state.members.map((m) => chip(m.id, m.name, m)).join('')}${chip(null, 'Offen')}</div>` : ''}
  </form>`;
}

const ICON = {
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3"/></svg>',
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
  // Läden mit offenen Artikeln + Lieblingsläden; Favoriten zuerst, dann nach Anzahl
  const dashStores = state.stores.filter((s) => s.fav || open.some((i) => i.storeId === s.id))
    .map((s) => ({ s, n: open.filter((i) => i.storeId === s.id).length }))
    .sort((a, b) => (b.n > 0) - (a.n > 0) || b.s.fav - a.s.fav || b.n - a.n || a.s.name.localeCompare(b.s.name)).map((x) => x.s);
  const pct = state.items.length ? Math.round((done.length / state.items.length) * 100) : 0;

  const personCard = (m, items) => `<button class="card person-card" data-act="goto-person" data-id="${m ? m.id : 'none'}">
      <div class="row">${avatar(m, 'lg')}<div><h3>${m ? esc(m.name) : 'Noch offen'}</h3><p class="muted">${items.length} ${items.length === 1 ? 'Artikel' : 'Artikel'}</p></div></div>
      <ul class="mini">${items.slice(0, 4).map((i) => `<li>${esc(i.name)}</li>`).join('') || '<li class="muted">Nichts zu tun 🎉</li>'}${items.length > 4 ? `<li class="muted">+ ${items.length - 4} weitere</li>` : ''}</ul>
    </button>`;

  $('#view-dash').innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1>${hello}${me ? ', ' + esc(me.name) : ''}</h1>${syncPill()}</div>
      <button class="who-me" data-act="switch-me" title="Wer bist du?">${avatar(me, 'lg')}</button>
    </header>
    ${quickAdd()}
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>offen</span></div>
      <div class="stat"><b>${done.length}</b><span>im Wagen</span></div>
      <div class="stat"><b>${storesWith.length}</b><span>Läden</span></div>
      <div class="stat"><b>${pct}%</b><span>erledigt</span><i class="bar"><i style="width:${pct}%"></i></i></div>
    </div>

    ${dealsBanner(open)}
    <h2 class="sec">Wer kauft was</h2>
    <div class="grid">${state.members.map((m) => personCard(m, open.filter((i) => i.who === m.id))).join('')}
      ${unassigned.length ? personCard(null, unassigned) : ''}</div>

    <h2 class="sec">Meine Läden <button class="link" data-act="goto" data-view="stores">Alle Läden</button></h2>
    <div class="grid stores-grid">
      ${dashStores.map((s) => storeCard(s, open.filter((i) => i.storeId === s.id).length)).join('')}
      ${open.some((i) => !i.storeId) ? `<button class="card store-card" data-act="goto-store" data-id="none"><span class="sicon">✳︎</span><div><h3>Egal wo</h3><p class="muted">${open.filter((i) => !i.storeId).length} Artikel ohne Laden</p></div></button>` : ''}
      ${!dashStores.length ? `<button class="card store-card" data-act="goto" data-view="stores"><span class="sicon">★</span><div><h3>Lieblingsläden wählen</h3><p class="muted">Bei „Läden“ den Stern antippen</p></div></button>` : ''}
    </div>

    ${open.length ? `<h2 class="sec">Zuletzt hinzugefügt</h2><div class="card list-card">${open.slice(0, 5).map((i) => itemRow(i, { showStore: true })).join('')}</div>` :
      `<div class="empty card"><p class="big">Die Liste ist leer.</p><p class="muted">Oben eintragen: Die App sortiert es automatisch in die richtige Abteilung.</p></div>`}
  `;
}

function storeCard(s, n) {
  return `<button class="card store-card" data-act="goto-store" data-id="${s.id}">
    <span class="sicon">${stype(s.type).icon}</span>
    <div><h3>${esc(s.name)}</h3><p class="muted">${n ? `<b>${n}</b> offen` : esc(s.address || stype(s.type).name)}</p></div>
    ${s.fav ? `<span class="fav-mark">${ICON.star}</span>` : ''}
  </button>`;
}

// ================= Ansicht: Liste =================
function renderList() {
  const matchP = (i) => ui.fPerson === 'all' || (ui.fPerson === 'none' ? !i.who : i.who === ui.fPerson);
  const matchS = (i) => ui.fStore === 'all' || (ui.fStore === 'none' ? !i.storeId : i.storeId === ui.fStore || !i.storeId);
  const items = state.items.filter((i) => matchP(i) && matchS(i));
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);

  const storeChips = [{ id: 'all', label: 'Alle Läden' }, ...state.stores.filter((s) => s.fav || state.items.some((i) => i.storeId === s.id) || ui.fStore === s.id).sort((a, b) => b.fav - a.fav).map((s) => ({ id: s.id, label: `${s.fav ? '★' : stype(s.type).icon} ${s.name}` })), { id: 'none', label: 'Egal wo' }];
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
  const showFavBlock = ui.storeType === 'all' && !q;
  const favs = state.stores.filter((s) => s.fav);
  const rest = showFavBlock ? list.filter((s) => !s.fav) : list;
  const byType = [
    ...(showFavBlock && favs.length ? [{ t: { icon: '★', name: 'Meine Lieblingsläden' }, list: favs }] : []),
    ...types.map((t) => ({ t, list: rest.filter((s) => s.type === t.id) })),
  ].filter((g) => g.list.length);
  const open = openItems();

  $('#view-stores').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">${state.stores.length} Läden · ${state.stores.filter((s) => s.fav).length} Favoriten</p><h1>Läden</h1></div>
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
    ${!favs.length && showFavBlock ? `<div class="card hint-card"><span class="sicon sm">★</span><p>Tippe den Stern vor einem Laden an, um ihn zu favorisieren. Lieblingsläden stehen dann ganz oben und in der Übersicht.</p></div>` : ''}
    ${ui.storeType === 'fav' && !list.length ? `<div class="empty card"><p class="muted">Noch keine Lieblingsläden. Tippe bei einem Laden auf den Stern ★.</p></div>` : ''}
    ${byType.map((g) => `<h2 class="sec">${g.t.icon} ${g.t.name}</h2><div class="card list-card">${g.list.map((s) => {
      const n = open.filter((i) => i.storeId === s.id).length;
      return `<div class="srow" data-store="${s.id}">
        <button class="star ${s.fav ? 'on' : ''}" data-act="fav" aria-label="Favorit">${ICON.star}</button>
        <div class="txt" data-act="goto-store" data-id="${s.id}"><span class="name">${esc(s.name)}</span><span class="meta">${g.t.name === 'Meine Lieblingsläden' ? stype(s.type).icon + ' ' + stype(s.type).name + ' · ' : ''}${esc(s.address || '')}</span></div>
        ${n ? `<span class="badge">${n}</span>` : ''}
        <button class="more" data-act="edit-store" data-id="${s.id}" aria-label="bearbeiten">⋯</button>
      </div>`;
    }).join('')}</div>`).join('') || (ui.storeType === 'fav' ? '' : '<div class="empty card"><p class="muted">Kein Laden gefunden.</p></div>')}
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
    <h2 class="sec">Gemeinsam nutzen</h2>
    ${syncSection()}
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
    <p class="small muted">App-Version ${APP_VERSION}</p>
  `;
}

function dealsBanner(open) {
  const hits = open.map((i) => ({ i, ...offersFor(i) })).filter((x) => x.strong.length);
  if (!hits.length) return '';
  return `<button class="card deal-card" data-act="goto" data-view="list">
    <span class="sicon">%</span>
    <div><h3>${hits.length} ${hits.length === 1 ? 'Artikel ist' : 'Artikel sind'} im Angebot</h3>
    <p class="muted">${hits.slice(0, 3).map((x) => esc(x.i.name) + ' bei ' + esc(store(x.strong[0].storeId)?.name || 'überall')).join(' · ')}</p></div>
  </button>`;
}

// ================= Ansicht: Angebote =================
function renderOffers() {
  const act = activeOffers(), expired = state.offers.length - act.length;
  const open = openItems();
  // Karten: Lieblingsläden immer, andere Läden nur mit Angeboten, "Überall" falls vorhanden
  const sids = [...new Set([...state.stores.filter((s) => s.fav).map((s) => s.id), ...act.map((o) => o.storeId || '')])];
  const cards = sids.map((sid) => ({ s: store(sid), list: act.filter((o) => (o.storeId || '') === sid) }))
    .filter((c) => c.s || c.list.length)
    .sort((a, b) => b.list.length - a.list.length || (b.s?.fav || 0) - (a.s?.fav || 0));
  const link = (s) => { const k = s?.name.toLowerCase().split(/\s+/)[0]; return CHAIN_LINKS.find(([c]) => c === k); };
  $('#view-offers').innerHTML = `
    <header class="page-head"><div><p class="eyebrow">${act.length ? act.length + ' Angebote diese Woche' : 'Diese Woche'}</p><h1>Angebote</h1></div>
      <div class="head-actions">
        <a class="btn" href="https://www.kaufda.de" target="_blank" rel="noopener">kaufDA ↗</a>
        <button class="btn primary" data-act="import">${ICON.paste} Aus Merkliste</button>
      </div></header>
    <div class="offer-grid">
      ${cards.map(({ s, list }) => {
        const l = link(s);
        return `<div class="card offer-card">
          <div class="oc-head">
            <span class="sicon sm">${s ? stype(s.type).icon : '🏷️'}</span>
            <div><h3>${s ? esc(s.name) : 'Überall'}</h3>${l ? `<a class="muted small-link" href="${l[2]}" target="_blank" rel="noopener">Prospekt ansehen ↗</a>` : ''}</div>
          </div>
          ${list.length ? `<ul class="oc-list">${list.map((o) => {
            const fits = open.some((i) => offersFor(i).strong.includes(o));
            return `<li data-act="edit-offer" data-id="${o.id}"><span class="on">${esc(o.name)}${fits ? ' <span class="fit" title="Steht auf eurer Liste">✓</span>' : ''}</span>${o.price ? `<span class="price">${euro(o.price)}</span>` : ''}</li>`;
          }).join('')}</ul>` : '<p class="muted oc-empty">Noch keine Angebote</p>'}
          <button class="oc-add" data-act="new-offer" data-id="${s ? s.id : ''}">${ICON.plus} Angebot</button>
        </div>`;
      }).join('')}
      <button class="card offer-card oc-other" data-act="new-offer" data-id="">${ICON.plus}<span>Angebot in einem<br>anderen Laden</span></button>
    </div>
    <p class="small muted">✓ = steht auf eurer Liste. Angebote gelten bis Samstag und verschwinden danach von selbst.
      ${expired ? `<button class="link" data-act="clean-offers">${expired} abgelaufene löschen</button>` : ''}</p>
  `;
}

function showDeals(it) {
  const { strong, soft } = offersFor(it);
  const row = (o) => `<div class="osm-row"><span>${cat(o.cat).icon}</span><span class="txt"><b>${esc(o.name)}</b><small>${esc(offerLine(o))}${o.note ? ' · ' + esc(o.note) : ''}</small></span>
    ${o.storeId ? `<button type="button" class="btn sm ${it.storeId === o.storeId ? '' : 'primary'}" data-take="${o.id}">${it.storeId === o.storeId ? '✓ Dort' : 'Dort holen'}</button>` : ''}</div>`;
  const f = dialog(`<h3>Angebote für „${esc(it.name)}“</h3>
    ${strong.length ? `<div class="osm">${strong.map(row).join('')}</div>` : ''}
    ${soft.length ? `<h4 class="sub">Ähnliches in ${esc(cat(it.cat).name)}</h4><div class="osm">${soft.map(row).join('')}</div>` : ''}
    <menu><span></span><button value="cancel" class="btn">Schließen</button></menu>`, () => { save(); render(); });
  f.onclick = (e) => {
    const b = e.target.closest('[data-take]'); if (!b) return;
    const o = state.offers.find((x) => x.id === b.dataset.take);
    it.storeId = o.storeId; $('#dlg').close(); toast(`${it.name} → ${store(o.storeId).name}`);
  };
}

function editOffer(o, presetStore) {
  const isNew = !o;
  o ||= { id: uid(), name: '', storeId: presetStore ?? '', price: '', until: nextSaturday() };
  const favs = state.stores.filter((s) => s.fav), others = state.stores.filter((s) => !s.fav).sort((a, b) => a.name.localeCompare(b.name));
  const fixed = isNew && presetStore;
  dialog(`
    <h3>${isNew ? (fixed ? 'Angebot bei ' + esc(store(presetStore).name) : 'Neues Angebot') : 'Angebot'}</h3>
    <div class="two wide-first">
      <label>Was?<input name="name" value="${esc(o.name)}" required placeholder="z. B. Spaghetti" autofocus></label>
      <label>Preis<input name="price" value="${esc(String(o.price ?? ''))}" inputmode="decimal" placeholder="0,99 €"></label>
    </div>
    ${fixed ? `<input type="hidden" name="storeId" value="${presetStore}">` : `<label>Wo?<select name="storeId"><option value="">Überall</option>
        ${favs.length ? `<optgroup label="★ Lieblingsläden">${opts(favs.map((s) => ({ v: s.id, t: s.name })), o.storeId)}</optgroup>` : ''}
        <optgroup label="Alle Läden">${opts(others.map((s) => ({ v: s.id, t: s.name })), o.storeId)}</optgroup></select></label>`}
    <details class="more-opts"${isNew ? '' : ' open'}><summary>Gültig ${untilTxt(o.until) || 'ohne Ende'}</summary>
      <label>Gültig bis<input type="date" name="until" value="${o.until || ''}"></label></details>
    <menu>${isNew ? '' : '<button value="delete" class="btn danger ghost" formnovalidate>Löschen</button>'}<span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary">${isNew ? 'Hinzufügen' : 'Speichern'}</button></menu>
  `, (v, fd) => {
    if (v === 'delete') state.offers = state.offers.filter((x) => x !== o);
    if (v === 'save') {
      const name = fd.get('name').trim();
      Object.assign(o, { name, storeId: fd.get('storeId') || null, price: fd.get('price').replace('€', '').trim(), until: fd.get('until') ?? o.until, cat: categorize(name) });
      if (isNew) state.offers.unshift(o);
      const fits = openItems().filter((i) => offersFor(i).strong.includes(o) || offersFor(i).soft.includes(o));
      if (fits.length) toast(`Passt zu eurer Liste: ${fits.map((i) => i.name).join(', ')}`);
    }
    save(); render();
  });
}

function joinBlock(title) {
  return `<div class="card pad stack join-card">
      <h3>${title}</h3>
      <p class="muted">Den Einladungslink (z. B. aus WhatsApp) <b>kopieren</b> und hier einfügen – fertig.</p>
      <div class="row wide"><input id="join-code" placeholder="Einladungslink oder Code" autocapitalize="off" autocorrect="off">
        <button class="btn primary" data-act="sync-join">Beitreten</button></div>
      <button class="link" data-act="sync-join-paste">📋 Aus Zwischenablage einfügen &amp; beitreten</button>
    </div>`;
}

function syncSection() {
  if (!Sync.hasConfig) return joinBlock('Einladung bekommen?') + `
    <p class="small muted sync-or">— oder selbst einen neuen gemeinsamen Haushalt einrichten: —</p>
    <div class="card pad stack">
      <p class="muted">Damit ihr beide dieselbe Liste live auf euren Handys habt, braucht die App ein kostenloses
        <b>Supabase</b>-Projekt (einmalig ca. 5 Minuten, Anleitung: <a href="SUPABASE.md" target="_blank" rel="noopener">SUPABASE.md</a>).
        Danach hier <b>Project URL</b> und <b>anon/publishable Key</b> einfügen.</p>
      <textarea id="fb-config" rows="4" placeholder="https://abcdefgh.supabase.co&#10;eyJhbGciOiJIUzI1NiIsInR5cCI6…"></textarea>
      <p class="muted small" style="margin:0">Lieber Firebase? Dann hier den <code>firebaseConfig</code>-Block einfügen (<a href="FIREBASE.md" target="_blank" rel="noopener">FIREBASE.md</a>).</p>
      <button class="btn primary" data-act="sync-config">Konfiguration speichern</button>
    </div>`;
  if (!Sync.code) return `<div class="card pad stack">
      ${syncPill()}
      <p class="muted">${Sync.provider === 'supabase' ? 'Supabase' : 'Firebase'} ist eingerichtet. Startet jetzt einen gemeinsamen Haushalt – oder tretet mit dem Code
        des anderen Handys bei.</p>
      <button class="btn primary" data-act="sync-create">Gemeinsamen Haushalt starten</button>
    </div>
    ${joinBlock('Oder: Einladung eines anderen Handys annehmen')}
    ${Sync.hasOwnConfig ? '<p class="small"><button class="link" data-act="sync-forget">Eingefügte Zugangsdaten entfernen</button></p>' : ''}`;
  return `<div class="card pad stack">
      ${syncPill()}
      ${Sync.status === 'error' ? `<p class="err">${esc(Sync.error)}</p>` : ''}
      <p class="muted">Alle Änderungen erscheinen sofort auf allen verbundenen Handys. Ohne Netz geht alles weiter und wird
        später abgeglichen. Server: ${Sync.provider === 'supabase' ? 'Supabase' : 'Firebase'}.</p>
      <div><p class="eyebrow">Haushalts-Code</p><p class="code">${esc(Sync.fmtCode)}</p></div>
      <div class="row wide"><button class="btn primary" data-act="sync-share">Einladung teilen</button>
        <button class="btn" data-act="sync-copy">Link kopieren</button></div>
      <p class="muted small" style="margin:0">Auf dem anderen Handy: Link öffnen → in Safari <b>Teilen → Zum Home-Bildschirm</b> →
        App vom Home-Bildschirm öffnen → <b>Mehr</b> → Link einfügen → <b>Beitreten</b>.</p>
      <p class="muted small" style="margin:0">Der Code ist wie ein Schlüssel: Wer ihn hat, sieht und ändert eure Liste. Nur an Familie weitergeben.</p>
      <button class="link danger" data-act="sync-leave">Auf diesem Gerät trennen</button>
    </div>`;
}

async function runSync(label, fn) {
  toast(label + ' …');
  try { await fn(); render(); return true; }
  catch (e) { render(); toast('Fehler: ' + (e.message || e)); return false; }
}

function askWhoAmI() {
  if (!state.members.length) return;
  dialog(`<h3>Wer bist du?</h3><p class="muted">Damit die App weiß, wer auf diesem Handy einkauft.</p>
    <div class="stack">${state.members.map((m) => `<button value="${m.id}" class="osm-row">${avatar(m, 'lg')}<span class="txt"><b>${esc(m.name)}</b></span></button>`).join('')}</div>
    <menu><span></span><button value="" class="btn ghost">Später</button></menu>`, (v) => {
    if (v && member(v)) { state.me = v; DB.set('state', state); toast(`Hallo ${member(v).name}!`); }
    render();
  });
}

// Liest eine Einladung aus einem Link ("…#join=CODE&cfg=…") oder einem reinen Code
function parseInvite(text) {
  text = String(text || '').trim();
  const i = text.indexOf('join=');
  if (i < 0) return { code: text, conf: null };
  const h = new URLSearchParams(text.slice(text.lastIndexOf('#', i) >= 0 ? text.lastIndexOf('#', i) + 1 : i));
  let conf = null;
  const cfg = h.get('cfg');
  if (cfg) { try { conf = JSON.parse(decodeURIComponent(escape(atob(cfg.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'))))); } catch { } }
  return { code: h.get('join') || '', conf };
}

async function joinFromInvite(text, fromLink) {
  const { code, conf } = parseInvite(text);
  if (!code) return toast('Bitte den Einladungslink oder Code einfügen');
  if (!conf && !Sync.hasConfig) return toast('Bitte den ganzen Einladungslink einfügen (nicht nur den Code).');
  if (Sync.code === code.toLowerCase().replace(/[^a-z0-9]/g, '')) return toast('Schon verbunden ✓');
  const local = state.items.length;
  if (local && !confirm(`Der gemeinsamen Einkaufsliste beitreten?\n\nDie ${local} Artikel auf diesem Gerät werden durch die gemeinsame Liste ersetzt.`)) return;
  if (await runSync('Verbinde', () => Sync.join(code, conf))) {
    toast('Verbunden ✓');
    setTimeout(askWhoAmI, 1200);
  }
}

async function handleJoinLink() {
  if (!location.hash.includes('join=')) return;
  const link = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  return joinFromInvite(link, true);
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
      <label>Wo?<select name="storeId"><option value="">— egal wo —</option>${state.stores.some((s) => s.fav) ? `<optgroup label="★ Lieblingsläden">${opts(state.stores.filter((s) => s.fav).map((s) => ({ v: s.id, t: s.name })), it.storeId)}</optgroup>` : ''}<optgroup label="Alle Läden">${opts(state.stores.filter((s) => !s.fav).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ v: s.id, t: s.name })), it.storeId)}</optgroup></select></label>
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
    <label class="switch"><input type="checkbox" name="fav" ${s.fav ? 'checked' : ''}><span class="knob"></span><span class="lbl">★ Lieblingsladen</span></label>
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
      Object.assign(s, { name: fd.get('name').trim(), type: fd.get('type'), address: fd.get('address').trim(), route, fav: fd.get('fav') === 'on' });
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
  ui.draft = '';
  render();
  afterAdd(state.items[0]);
  $(`#view-${ui.view} [data-form=add] input`)?.focus();
});

// Rückmeldung nach dem Eintragen (inkl. Angebots-Hinweis)
function afterAdd(it) {
  const { strong, soft } = offersFor(it);
  const hit = strong[0] || soft[0];
  if (hit) {
    const st = store(hit.storeId);
    toast(strong[0] ? `% ${it.name} im Angebot: ${offerLine(hit)}` : `% Ähnliches im Angebot: ${hit.name} · ${offerLine(hit)}`, {
      deal: true, label: st ? 'Dort holen' : 'Ansehen',
      fn: () => { if (st) { it.storeId = st.id; save(); render(); toast(`${it.name} → ${st.name}`); } else showDeals(it); },
    });
  } else toast(`„${it.name}“ → ${cat(it.cat).name}${it.who ? ' · ' + member(it.who).name : ''}`);
}

document.addEventListener('input', (e) => {
  if (e.target.name === 'q' && e.target.closest('[data-form=add]')) { ui.draft = e.target.value; return; } // Entwurf merken
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
    case 'deal': showDeals(it); break;
    case 'new-offer': editOffer(null, id || ''); break;
    case 'import': openImport(); break;
    case 'edit-offer': editOffer(state.offers.find((o) => o.id === id)); break;
    case 'clean-offers': state.offers = activeOffers(); save(); render(); toast('Abgelaufene Angebote entfernt'); break;
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
      addItem(name, { photo }); ui.draft = ''; render(); toast('Mit Foto hinzugefügt');
      break;
    }
    case 'clear-done': state.items = state.items.filter((i) => !i.done || !$(`#view-list [data-item="${i.id}"]`)); save(); render(); break;
    case 'goto': go(el.dataset.view); break;
    case 'goto-store': ui.fStore = id; ui.fPerson = 'all'; go('list'); break;
    case 'goto-person':
      if (ui.draft.trim()) { // Eingetipptes direkt dieser Person geben
        addItem(ui.draft, { who: id === 'none' ? null : id }); ui.draft = '';
        render(); afterAdd(state.items[0]); break;
      }
      ui.fPerson = id; ui.fStore = 'all'; go('list'); break;
    case 'add-who': ui.addWho = id || null; render(); $(`#view-${ui.view} [data-form=add] input`)?.focus(); break;
    case 'switch-me': go('people'); break;
    case 'set-me': state.me = id; save(); render(); toast(`Hallo ${member(id).name}!`); break;
    case 'fav': st.fav = !st.fav; save(); render(); toast(st.fav ? `★ ${st.name} ist jetzt Lieblingsladen` : `${st.name} ist kein Favorit mehr`); break;
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
    case 'reset': if (confirm(Sync.code ? 'Wirklich alles löschen? Das löscht die Liste auch auf allen verbundenen Handys!' : 'Wirklich alles löschen und neu anfangen?')) { const me = state.me; state = freshState(); if (Sync.code) state.me = me; save(); render(); } break;
    case 'sync-config':
      try { await Sync.saveConfig($('#fb-config').value); toast((Sync.provider === 'supabase' ? 'Supabase' : 'Firebase') + ' eingerichtet ✓'); render(); }
      catch (err) { toast('Das passt noch nicht: ' + err.message); }
      break;
    case 'sync-forget': await Sync.disconnect(true); render(); break;
    case 'sync-create':
      if (await runSync('Haushalt wird angelegt', () => Sync.create())) toast('Gemeinsamer Haushalt gestartet ✓ Jetzt die Einladung teilen.');
      break;
    case 'sync-join': await joinFromInvite($('#join-code').value); break;
    case 'sync-join-paste': {
      try { const t = await navigator.clipboard.readText(); $('#join-code').value = t; await joinFromInvite(t); }
      catch { $('#join-code').focus(); toast('Bitte ins Feld tippen und „Einfügen“ wählen'); }
      break;
    }
    case 'sync-copy': {
      const url = Sync.inviteLink();
      try { await navigator.clipboard.writeText(url); toast('Einladungslink kopiert ✓'); } catch { prompt('Diesen Link kopieren:', url); }
      break;
    }
    case 'sync-share': {
      const url = Sync.inviteLink();
      const text = 'Komm in unsere gemeinsame Einkaufsliste:';
      try {
        if (navigator.share) await navigator.share({ title: 'Einkauf', text, url });
        else { await navigator.clipboard.writeText(url); toast('Einladungslink kopiert ✓'); }
      } catch (err) { if (err.name !== 'AbortError') prompt('Diesen Link schicken:', url); }
      break;
    }
    case 'sync-leave':
      if (confirm('Dieses Gerät vom gemeinsamen Haushalt trennen? Die Liste bleibt hier als Kopie erhalten.')) { await Sync.disconnect(); render(); toast('Getrennt'); }
      break;
  }
});

// ================= Navigation & Start =================
const RENDER = { dash: renderDash, list: renderList, offers: renderOffers, stores: renderStores, people: renderPeople, settings: renderSettings };
function render() {
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + ui.view));
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  RENDER[ui.view]();
}
function go(view) { ui.view = view; render(); window.scrollTo({ top: 0 }); }

(async () => {
  try { const saved = await DB.get('state'); if (saved) state = migrate(saved); } catch (e) { console.warn(e); }
  render();
  try { navigator.storage?.persist?.(); } catch { } // Speicher dauerhaft behalten (iOS räumt sonst evtl. auf)
  await Sync.init();
  document.addEventListener('sync-status', () => { if (ui.view === 'dash' || ui.view === 'settings') render(); });
  handleJoinLink();
  window.addEventListener('hashchange', handleJoinLink);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
})();
