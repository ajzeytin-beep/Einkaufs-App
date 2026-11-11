'use strict';
// ================= Gemeinsamer Abgleich (Supabase oder Firebase) =================
// Jedes Gerät behält seine lokale Kopie (offline nutzbar). Änderungen werden pro Artikel/Laden/Person
// als einzelne Dokumente unter households/{code}/… gespeichert und live an alle Geräte verteilt.

const Sync = (() => {
  const COLS = ['items', 'members', 'stores', 'offers', 'categories'];
  let cfg = { config: null, hid: null };        // auf dem Gerät gespeichert
  let backend = null, unsubs = [], status = 'off', lastError = '';
  let shadow = {};                              // zuletzt abgeglichener Stand: col -> { id: json }
  let metaShadow = '';
  let renderTimer, retryTimer, fbCtx = null;
  const inflight = new Map();                   // "col/id" -> Anzahl laufender Schreibvorgänge
  const busyKey = (col, id) => col + '/' + id;

  // ---------- Hilfen ----------
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v ?? null);
  };
  const clean = (o) => JSON.parse(JSON.stringify(o));
  const ordered = (col) => col !== 'items';
  const docOf = (col, obj, i) => { const d = clean(obj); if (ordered(col)) d._o = i; return d; };
  const config = () => cfg.config || window.SYNC_CONFIG;
  const provider = (c = config()) => (c && (c.provider || (c.url && c.key ? 'supabase' : 'firebase'))) || null;
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
    text = String(text);
    const url = text.match(/https:\/\/[a-z0-9-]+\.supabase\.(co|in)/i);
    if (url || /supabase|sb_publishable_|^\s*eyJ/i.test(text)) {
      const key = text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+/);
      if (!url && key && window.SYNC_CONFIG?.url) return { provider: 'supabase', url: window.SYNC_CONFIG.url, key: key[0] };
      if (!url) throw new Error('Project URL (https://….supabase.co) fehlt');
      if (!key) throw new Error('anon/publishable Key fehlt');
      return { provider: 'supabase', url: url[0], key: key[0] };
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Keine Konfiguration gefunden');
    let s = m[0].replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,\s*}/g, '}');
    const c = JSON.parse(s);
    if (!c.apiKey || !c.projectId) throw new Error('apiKey oder projectId fehlt');
    return { provider: 'firebase', ...c };
  }

  // ---------- Firebase-Anbindung ----------
  async function firebaseBackend(conf, hid) {
    const fb = await import('./vendor/firebase.js');
    if (!fbCtx) {
      const { provider: _p, ...fbConf } = conf;
      const app = fb.initializeApp(fbConf, 'einkauf');
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
        return fb.onSnapshot(fb.collection(root, col), (snap) => cb(snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() })), false), onErr);
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
  // ---------- Supabase-Anbindung ----------
  // Daten: Tabelle einkauf_docs (siehe supabase.sql), Zugriff per Header x-household + Row Level Security.
  // Live: Realtime-Broadcast auf dem Kanal des Haushalts meldet "geändert", die anderen laden die Zeilen nach.
  async function supabaseBackend(conf, hid) {
    const { createClient } = await import('./vendor/supabase.js');
    const sb = createClient(conf.url, conf.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-household': hid } },
    });
    const T = 'einkauf_docs', subs = {};
    const nice = (e) => {
      const m = e?.message || String(e);
      if (e?.code === '42P01' || /einkauf_docs/.test(m)) return new Error('Tabelle fehlt – bitte supabase.sql im Supabase SQL Editor ausführen.');
      if (/Invalid API key|JWT/i.test(m)) return new Error('Supabase-Key ungültig – bitte den anon/publishable Key verwenden.');
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return new Error('Keine Verbindung zum Server.');
      return new Error(m);
    };
    const check = ({ data, error }) => { if (error) throw nice(error); return data; };

    async function fetchRows(filter) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let q = sb.from(T).select('col,id,data').eq('hid', hid);
        if (filter) q = filter(q);
        const rows = check(await q.order('col').order('id').range(from, from + 999));
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }
    function deliverRows(rows, full, wanted) {
      for (const [col, cb] of Object.entries(subs)) {
        if (col === '__meta') { const m = rows.find((r) => r.col === 'meta'); if (m || full) cb(m ? m.data : null); continue; }
        if (!full && !wanted?.[col]) continue;
        const got = rows.filter((r) => r.col === col);
        const changes = got.map((r) => ({ type: full ? 'added' : 'modified', id: r.id, data: r.data }));
        if (!full) for (const id of wanted[col]) if (!got.some((r) => r.id === id)) changes.push({ type: 'removed', id });
        if (full || changes.length) cb(changes, full);
      }
    }
    let refreshTimer, onErr = () => {};
    const fullRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => {
      try { deliverRows(await fetchRows(), true); } catch (e) { onErr(e); }
    }, 30); };
    async function partial(changed) {
      const wanted = {};
      for (const c of changed || []) (wanted[c.col] ||= []).push(c.id);
      const rows = [];
      for (const [col, ids] of Object.entries(wanted)) rows.push(...await fetchRows((q) => q.eq('col', col).in('id', ids)));
      deliverRows(rows, false, wanted);
    }
    const onVisible = () => { if (document.visibilityState === 'visible') fullRefresh(); };

    let joined = false;
    const channel = sb.channel('einkauf-' + hid, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'changed' }, ({ payload }) => partial(payload?.changed).catch((e) => onErr(e)))
      .subscribe((st) => {
        if (st === 'SUBSCRIBED') { if (joined) fullRefresh(); joined = true; }  // nach Verbindungsabbruch alles neu laden
      });
    window.addEventListener('online', fullRefresh);
    document.addEventListener('visibilitychange', onVisible);
    // Sicherheitsnetz, falls eine Live-Meldung verloren geht: jede Minute nachladen, solange die App offen ist
    const poll = setInterval(() => { if (document.visibilityState === 'visible') fullRefresh(); }, 60000);

    return {
      async exists() { return check(await sb.from(T).select('id').eq('hid', hid).eq('col', 'meta').limit(1)).length > 0; },
      subscribe(col, cb, err) { subs[col] = cb; onErr = err || onErr; fullRefresh(); return () => { delete subs[col]; }; },
      subscribeMeta(cb, err) { subs.__meta = cb; onErr = err || onErr; fullRefresh(); return () => { delete subs.__meta; }; },
      async write(ops) {
        const now = new Date().toISOString();
        const ups = ops.filter((o) => !o.del).map((o) => o.meta ? { hid, col: 'meta', id: 'meta', data: o.meta, updated_at: now } : { hid, col: o.col, id: o.id, data: o.data, updated_at: now });
        for (let i = 0; i < ups.length; i += 50) check(await sb.from(T).upsert(ups.slice(i, i + 50), { onConflict: 'hid,col,id' }));
        const dels = {};
        ops.filter((o) => o.del).forEach((o) => (dels[o.col] ||= []).push(o.id));
        for (const [col, ids] of Object.entries(dels)) check(await sb.from(T).delete().eq('hid', hid).eq('col', col).in('id', ids));
        const changed = ops.map((o) => (o.meta ? { col: 'meta', id: 'meta' } : { col: o.col, id: o.id }));
        channel.send({ type: 'broadcast', event: 'changed', payload: { changed } }).catch(() => {});
      },
      close() {
        sb.removeChannel(channel);
        clearInterval(poll);
        window.removeEventListener('online', fullRefresh);
        document.removeEventListener('visibilitychange', onVisible);
      },
    };
  }

  const makeBackend = (conf, hid) => (window.__syncBackend || (provider(conf) === 'supabase' ? supabaseBackend : firebaseBackend))(conf, hid);

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
    if (!backend || status === 'off' || status === 'connecting') return;
    const ops = diffOps();
    if (!ops.length) return;
    persist();
    send(ops);
  }
  function send(ops) {
    const keys = ops.filter((o) => !o.meta).map((o) => busyKey(o.col, o.id));
    keys.forEach((k) => inflight.set(k, (inflight.get(k) || 0) + 1));
    const done = () => keys.forEach((k) => { const n = inflight.get(k) - 1; n > 0 ? inflight.set(k, n) : inflight.delete(k); });
    return backend.write(ops)
      .finally(done)
      .then(() => { if (status === 'error') setStatus('on'); })
      .catch((e) => {
        // Nicht angekommen: als "noch offen" markieren, damit es beim nächsten Versuch erneut geschickt wird
        for (const op of ops) {
          if (op.meta) metaShadow = '';
          else if (op.del) (shadow[op.col] ||= {})[op.id] = '__retry__';
          else delete (shadow[op.col] || {})[op.id];
        }
        persist();
        setStatus('error', e.message || String(e));
        clearTimeout(retryTimer); retryTimer = setTimeout(push, 15000);
      });
  }

  // ---------- Änderungen der anderen übernehmen ----------
  function applyChanges(col, changes, replaceAll) {
    const list = state[col] || (state[col] = []);
    const sh = (shadow[col] ||= {});
    // Was gerade hochgeladen wird, nicht mit (evtl. älterem) Serverstand überschreiben
    const busy = (id) => inflight.has(busyKey(col, id));
    if (replaceAll) {
      const ids = new Set(changes.filter((c) => c.type !== 'removed').map((c) => c.id));
      for (let i = list.length - 1; i >= 0; i--) if (!ids.has(list[i].id) && !busy(list[i].id)) list.splice(i, 1);
      for (const id of Object.keys(sh)) if (!ids.has(id) && !busy(id)) delete sh[id];
    }
    let changed = replaceAll;
    for (const c of changes) {
      if (busy(c.id)) continue;
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
      await persist();
      unsubs.forEach((u) => u()); unsubs = [];
      status = 'on';
      if (!fresh && !join) { const ops = diffOps(); if (ops.length) send(ops); } // offline Geändertes nachreichen (ohne zu warten)
      const onErr = (e) => setStatus('error', e.message);
      for (const col of COLS) {
        let first = true;
        unsubs.push(backend.subscribe(col, (ch, full) => { applyChanges(col, ch, first || full); first = false; }, onErr));
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
    get status() { return navigator.onLine === false && (status === 'on' || status === 'error') ? 'offline' : status; },
    get provider() { return provider(); },
    get error() { return lastError; },
    get code() { return cfg.hid; },
    get fmtCode() { return fmtCode(cfg.hid); },
    get hasConfig() { return !!config(); },
    get configFromFile() { return !!window.SYNC_CONFIG; },
    get hasOwnConfig() { return !!cfg.config; },
    push,
    parseConfig,
    async init() {
      try { const s = await DB.get('sync'); if (s) { cfg = s.cfg || cfg; shadow = s.shadow || {}; metaShadow = s.metaShadow || ''; } } catch {}
      window.addEventListener('online', () => { document.dispatchEvent(new CustomEvent('sync-status')); push(); });
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
      if (cfg.config) h += '&cfg=' + btoa(unescape(encodeURIComponent(JSON.stringify(cfg.config)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); // URL-sicher (base64url)
      return u.toString() + '#' + h;
    },
    async disconnect(forgetConfig = false) {
      unsubs.forEach((u) => u()); unsubs = []; backend?.close?.(); backend = null;
      cfg.hid = null; if (forgetConfig) cfg.config = null;
      shadow = {}; metaShadow = '';
      await persist();
      setStatus('off');
    },
  };
})();
