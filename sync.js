'use strict';
// ================= Gemeinsamer Abgleich (Firebase Firestore) =================
// Jedes Gerät behält seine lokale Kopie (offline nutzbar). Änderungen werden pro Artikel/Laden/Person
// als einzelne Dokumente unter households/{code}/… gespeichert und live an alle Geräte verteilt.

const Sync = (() => {
  const COLS = ['items', 'members', 'stores', 'offers', 'categories'];
  let cfg = { config: null, hid: null };        // auf dem Gerät gespeichert
  let backend = null, unsubs = [], status = 'off', lastError = '';
  let shadow = {};                              // zuletzt abgeglichener Stand: col -> { id: json }
  let metaShadow = '';
  let renderTimer, fbCtx = null;

  // ---------- Hilfen ----------
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v ?? null);
  };
  const clean = (o) => JSON.parse(JSON.stringify(o));
  const ordered = (col) => col !== 'items';
  const docOf = (col, obj, i) => { const d = clean(obj); if (ordered(col)) d._o = i; return d; };
  const config = () => window.FIREBASE_CONFIG || cfg.config;
  const fmtCode = (h) => (h || '').toUpperCase().match(/.{1,4}/g)?.join('-') || '';
  const newCode = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(24)); return [...r].map((x) => a[x % a.length]).join(''); };
  const normCode = (c) => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  async function persist() {
    try { await DB.set('sync', { cfg, shadow, metaShadow }); } catch (e) { console.warn(e); }
  }
  function setStatus(s, err = '') {
    status = s; lastError = err;
    document.dispatchEvent(new CustomEvent('sync-status'));
  }

  // Firebase-Konfiguration aus eingefügtem Text lesen (JSON oder JS-Schnipsel aus der Firebase-Konsole)
  function parseConfig(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Keine Konfiguration gefunden');
    let s = m[0].replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,\s*}/g, '}');
    const c = JSON.parse(s);
    if (!c.apiKey || !c.projectId) throw new Error('apiKey oder projectId fehlt');
    return c;
  }

  // ---------- Firebase-Anbindung ----------
  async function firebaseBackend(conf, hid) {
    const fb = await import('./vendor/firebase.js');
    if (!fbCtx) {
      const app = fb.initializeApp(conf, 'einkauf');
      let db;
      try { db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }); }
      catch { db = fb.getFirestore(app); }
      fbCtx = { app, db };
    }
    const { app, db } = fbCtx;
    await fb.signInAnonymously(fb.getAuth(app));
    const root = fb.doc(db, 'households', hid);
    return {
      async exists() { return (await fb.getDoc(root)).exists(); },
      subscribe(col, cb, onErr) {
        return fb.onSnapshot(fb.collection(root, col), (snap) => cb(snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() }))), onErr);
      },
      subscribeMeta(cb, onErr) { return fb.onSnapshot(root, (s) => cb(s.exists() ? s.data() : null), onErr); },
      async write(ops) { // ops: [{col,id,data}|{col,id,del:true}|{meta:data}]
        for (let i = 0; i < ops.length; i += 400) {
          const b = fb.writeBatch(db);
          for (const op of ops.slice(i, i + 400)) {
            if (op.meta) b.set(root, op.meta, { merge: true });
            else if (op.del) b.delete(fb.doc(root, op.col, op.id));
            else b.set(fb.doc(root, op.col, op.id), op.data);
          }
          await b.commit();
        }
      },
    };
  }
  const makeBackend = (conf, hid) => (window.__syncBackend || firebaseBackend)(conf, hid);

  // ---------- Lokale Änderungen hochladen ----------
  function diffOps() {
    const ops = [];
    for (const col of COLS) {
      const sh = (shadow[col] ||= {}), seen = new Set();
      (state[col] || []).forEach((obj, i) => {
        const d = docOf(col, obj, i), j = stable(d);
        seen.add(obj.id);
        if (sh[obj.id] !== j) { sh[obj.id] = j; ops.push({ col, id: obj.id, data: d }); }
      });
      for (const id of Object.keys(sh)) if (!seen.has(id)) { delete sh[id]; ops.push({ col, id, del: true }); }
    }
    const meta = stable({ learned: state.learned || {} });
    if (meta !== metaShadow) { metaShadow = meta; ops.push({ meta: { learned: clean(state.learned || {}), updated: Date.now() } }); }
    return ops;
  }
  function push() {
    if (!backend || status === 'off') return;
    const ops = diffOps();
    if (!ops.length) return;
    persist();
    backend.write(ops).catch((e) => setStatus('error', e.message));
  }

  // ---------- Änderungen der anderen übernehmen ----------
  function applyChanges(col, changes, replaceAll) {
    const list = state[col] || (state[col] = []);
    const sh = (shadow[col] ||= {});
    if (replaceAll) {
      const ids = new Set(changes.filter((c) => c.type !== 'removed').map((c) => c.id));
      for (let i = list.length - 1; i >= 0; i--) if (!ids.has(list[i].id)) list.splice(i, 1);
      for (const id of Object.keys(sh)) if (!ids.has(id)) delete sh[id];
    }
    let changed = replaceAll;
    for (const c of changes) {
      const idx = list.findIndex((x) => x.id === c.id);
      if (c.type === 'removed') {
        delete sh[c.id];
        if (idx >= 0) { list.splice(idx, 1); changed = true; }
        continue;
      }
      const data = { ...c.data, id: c.id };
      sh[c.id] = stable(data);
      if (idx >= 0) {
        const cur = list[idx];
        if (stable({ ...clean(cur), _o: data._o }) === stable(data)) { cur._o = data._o; continue; }
        for (const k of Object.keys(cur)) delete cur[k];   // gleiche Objekt-Referenz behalten (offene Dialoge)
        Object.assign(cur, data);
      } else list.push(data);
      changed = true;
    }
    if (ordered(col)) list.sort((a, b) => (a._o ?? 1e9) - (b._o ?? 1e9));
    else list.sort((a, b) => (b.created || 0) - (a.created || 0));
    if (changed) onRemoteChange();
  }
  function onRemoteChange() {
    if (state.me && !state.members.some((m) => m.id === state.me)) state.me = null;
    DB.set('state', state).catch(() => {});
    persist();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { render(); document.dispatchEvent(new CustomEvent('sync-remote')); }, 60);
  }

  // ---------- Verbinden ----------
  async function connect({ fresh = false, join = false } = {}) {
    const conf = config();
    if (!conf || !cfg.hid) return;
    setStatus('connecting');
    try {
      backend = await makeBackend(conf, cfg.hid);
      if (join && !(await backend.exists())) throw new Error('Diesen Haushalts-Code gibt es nicht.');
      if (join) { // Liste dieses Geräts durch die gemeinsame ersetzen
        COLS.forEach((c) => (state[c] = []));
        shadow = {}; metaShadow = '';
      }
      if (fresh) { shadow = {}; metaShadow = ''; await backend.write(diffOps()); }
      else if (!join) { const ops = diffOps(); if (ops.length) await backend.write(ops); } // offline Geändertes nachreichen
      await persist();
      unsubs.forEach((u) => u()); unsubs = [];
      const onErr = (e) => setStatus('error', e.message);
      for (const col of COLS) {
        let first = true;
        unsubs.push(backend.subscribe(col, (ch) => { applyChanges(col, ch, first); first = false; }, onErr));
      }
      unsubs.push(backend.subscribeMeta((m) => {
        if (!m) return;
        metaShadow = stable({ learned: m.learned || {} });
        if (stable(state.learned || {}) !== stable(m.learned || {})) { state.learned = m.learned || {}; onRemoteChange(); }
      }, onErr));
      setStatus('on');
      return true;
    } catch (e) {
      console.error(e);
      setStatus('error', e.message || String(e));
      if (join || fresh) { cfg.hid = null; await persist(); }
      throw e;
    }
  }

  return {
    get status() { return navigator.onLine === false && status === 'on' ? 'offline' : status; },
    get error() { return lastError; },
    get code() { return cfg.hid; },
    get fmtCode() { return fmtCode(cfg.hid); },
    get hasConfig() { return !!config(); },
    get configFromFile() { return !!window.FIREBASE_CONFIG; },
    push,
    parseConfig,
    async init() {
      try { const s = await DB.get('sync'); if (s) { cfg = s.cfg || cfg; shadow = s.shadow || {}; metaShadow = s.metaShadow || ''; } } catch {}
      window.addEventListener('online', () => document.dispatchEvent(new CustomEvent('sync-status')));
      window.addEventListener('offline', () => document.dispatchEvent(new CustomEvent('sync-status')));
      if (config() && cfg.hid) connect().catch(() => {});
    },
    async saveConfig(text) { cfg.config = parseConfig(text); await persist(); },
    async create() { cfg.hid = newCode(); return connect({ fresh: true }); },
    async join(code, conf) {
      if (conf) cfg.config = conf;
      cfg.hid = normCode(code);
      if (cfg.hid.length < 20) { cfg.hid = null; throw new Error('Der Code ist zu kurz.'); }
      return connect({ join: true });
    },
    inviteLink() {
      const u = new URL(location.href); u.hash = '';
      let h = 'join=' + cfg.hid;
      if (!window.FIREBASE_CONFIG && cfg.config) h += '&cfg=' + btoa(unescape(encodeURIComponent(JSON.stringify(cfg.config)))).replace(/=+$/, '');
      return u.toString() + '#' + h;
    },
    async disconnect(forgetConfig = false) {
      unsubs.forEach((u) => u()); unsubs = []; backend = null;
      cfg.hid = null; if (forgetConfig) cfg.config = null;
      shadow = {}; metaShadow = '';
      await persist();
      setStatus('off');
    },
  };
})();
