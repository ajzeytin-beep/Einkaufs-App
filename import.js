'use strict';
// ================= Merkliste einfügen (Text aus iPhone-Texterkennung / Teilen) =================
// Erkennt aus kopiertem Text Produkte, Preise und Läden. Bewusst tolerant: Das Ergebnis wird
// immer erst als Vorschau gezeigt und kann vor dem Übernehmen korrigiert werden.

const CHAINS = [
  ['edeka', 'Edeka', 'supermarkt'], ['e center', 'E center', 'supermarkt'], ['marktkauf', 'Marktkauf', 'supermarkt'],
  ['rewe', 'Rewe', 'supermarkt'], ['kaufland', 'Kaufland', 'supermarkt'], ['globus', 'Globus', 'supermarkt'],
  ['famila', 'famila', 'supermarkt'], ['combi', 'combi', 'supermarkt'], ['jibi', 'jibi', 'supermarkt'], ['tegut', 'tegut', 'supermarkt'],
  ['aldi', 'Aldi', 'discounter'], ['lidl', 'Lidl', 'discounter'], ['netto', 'Netto', 'discounter'], ['penny', 'Penny', 'discounter'],
  ['norma', 'Norma', 'discounter'], ['action', 'Action', 'wohnen'],
  ['rossmann', 'Rossmann', 'drogerie'], ['dm', 'dm', 'drogerie'], ['müller', 'Müller', 'drogerie'], ['budni', 'Budni', 'drogerie'],
  ['trinkgut', 'trinkgut', 'getraenke'], ['hol ab', 'Hol ab!', 'getraenke'], ['getränke hoffmann', 'Getränke Hoffmann', 'getraenke'],
  ['fressnapf', 'Fressnapf', 'sonst'], ['obi', 'OBI', 'baumarkt'], ['hornbach', 'Hornbach', 'baumarkt'], ['toom', 'toom', 'baumarkt'],
  ['hagebau', 'hagebau', 'baumarkt'], ['bauhaus', 'Bauhaus', 'baumarkt'], ['mediamarkt', 'MediaMarkt', 'technik'], ['media markt', 'MediaMarkt', 'technik'],
  ['saturn', 'Saturn', 'technik'], ['tedi', 'TEDi', 'wohnen'], ['kik', 'KiK', 'mode'], ['woolworth', 'Woolworth', 'wohnen'],
];
const NOISE = /^(merkliste|einkaufsliste|angebote?|prospekte?|alle|bearbeiten|teilen|fertig|zurück|filter|sortieren|heute|morgen|neu|top|deals?|coupons?|cashback|mehr|weniger|details?|zum angebot|zum prospekt|online|in der filiale|filiale|markt|nur online|app[- ]?preis|mit app|marktguru|gültig.*|noch \d+ tage?.*|\d+ tage?.*|ab (mo|di|mi|do|fr|sa|so).*|bis (mo|di|mi|do|fr|sa|so).*|(mo|di|mi|do|fr|sa|so)[.,]? \d.*|\d+\s*artikel|\d+\s*angebote?|\d{1,2}:\d{2}.*|lte|5g|wlan)$/i;
const PRICE_RE = /(\d{1,4})[.,](\d{2})(?!\d)\s*(€|eur)?|(\d{1,4})\s*€/i;
const EXTRA_PRICE = /(uvp|statt|vorher|grundpreis|\/\s*(kg|l|100\s*g|100\s*ml|stk)|je\s*(kg|l|100)|1\s*(kg|l)\s*=|kg-preis|l-preis|preis pro)/i;
const SIZE_RE = /^(je\s+)?(ca\.\s*)?\d+([.,]\d+)?\s*(-|x|×)?\s*(\d+([.,]\d+)?\s*)?(g|kg|ml|l|cl|stk|st\.?|stück|er|rollen|tabs|wl|pack|packung|dose|flasche|fl\.)\b.*$/i;

const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

function chainOf(line) {
  const l = ' ' + fold(line).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  for (const [k, name, type] of CHAINS) if (l.includes(' ' + fold(k) + ' ')) return { key: k, name, type };
  return null;
}
// Eine Zeile ist "nur Laden", wenn außer dem Ladennamen kaum etwas drinsteht
function isStoreLine(line, ch) {
  if (PRICE_RE.test(line)) return false;                 // mit Preis ist es ein Produkt
  const rest = fold(line).replace(fold(ch.key), '').replace(/[^a-z]/g, '');
  return rest.length <= 12 || /(markt|center|filiale|discount|drogerie|getranke|supermarkt)/.test(fold(line));
}
function priceIn(line) {
  if (EXTRA_PRICE.test(line)) return null;
  const m = line.match(PRICE_RE);
  if (!m) return null;
  return m[1] != null ? `${+m[1]},${m[2]}` : `${+m[4]},00`;
}

function parseMerkliste(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // 1) Jede Zeile einordnen
  const toks = [];
  for (const raw of lines) {
    const line = raw.replace(/^[•·\-–*✓☐☑□▢◻︎]+\s*/, '');
    if (!line || NOISE.test(line) || /^[-–]?\s*\d+\s*%$/.test(line)) continue;
    const ch = chainOf(line);
    if (ch && isStoreLine(line, ch)) { toks.push({ t: 'store', ch }); continue; }
    const p = priceIn(line);
    const txt = line.replace(PRICE_RE, '').replace(/[*€()]/g, '').replace(/\s+/g, ' ').trim();
    const hasWords = /[a-zäöüß]{3,}/i.test(txt);
    if (p && !hasWords) { toks.push({ t: 'price', p }); continue; }
    if (EXTRA_PRICE.test(line)) continue;                       // Grundpreis, UVP …
    if (SIZE_RE.test(line)) { toks.push({ t: 'size', v: line }); continue; }
    if (!hasWords) continue;
    // Ladenname aus dem Produktnamen entfernen ("Bananen 1,99 Edeka" -> "Bananen")
    const v = ch ? txt.replace(new RegExp('(^|\\s)' + ch.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i'), ' ').replace(/\s+/g, ' ').trim() || txt : txt;
    toks.push({ t: 'name', v, p, ch });
  }
  // 2) Layout: Laden als Überschrift (vor den Produkten) oder unter jedem Produkt?
  const firstStore = toks.findIndex((x) => x.t === 'store'), firstName = toks.findIndex((x) => x.t === 'name');
  const header = firstStore >= 0 && (firstName < 0 || firstStore < firstName);
  // 3) Zu Einträgen zusammensetzen
  const out = [];
  let sticky = null, cur = null;
  const close = () => { if (cur && cur.name) out.push(cur); cur = null; };
  for (const x of toks) {
    if (x.t === 'store') {
      if (header) { close(); sticky = x.ch; } else if (cur) cur.store = x.ch;
      continue;
    }
    if (x.t === 'price') { if (cur && !cur.price) cur.price = x.p; continue; }
    if (x.t === 'size') { if (cur) cur.size = cur.size ? cur.size + ' ' + x.v : x.v; continue; }
    // Name: Fortsetzung eines mehrzeiligen Namens, solange noch kein Preis da ist
    if (cur && !cur.price && !x.p && !x.ch && !cur.size && cur.name.split(' ').length < 8) { cur.name += ' ' + x.v; continue; }
    close();
    cur = { name: x.v, price: x.p, store: x.ch || (header ? sticky : null), size: '' };
  }
  close();
  return out.map((o) => ({ ...o, name: o.name.replace(/\s*[,;:]\s*$/, '').trim() })).filter((o) => o.name.length >= 2);
}

// Laden der App zu einer Kette finden (Lieblingsladen bevorzugt) – sonst neu anlegen
function storeForChain(ch, create) {
  if (!ch) return null;
  const k = fold(ch.key);
  const hits = state.stores.filter((s) => fold(s.name).split(/\s+/)[0] === k.split(' ')[0] || fold(s.name).startsWith(k));
  const hit = hits.find((s) => s.fav) || hits[0];
  if (hit || !create) return hit || null;
  const s = { id: uid(), name: ch.name, type: ch.type, address: '', route: state.categories.map((c) => c.id), fav: false };
  state.stores.push(s);
  return s;
}

function openImport() {
  let rows = [];
  const storeOpts = (sel) => `<option value="">Überall</option>` + [...state.stores].sort((a, b) => b.fav - a.fav || a.name.localeCompare(b.name))
    .map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.fav ? '★ ' : ''}${esc(s.name)}</option>`).join('')
    + CHAINS.filter((c, i, a) => a.findIndex((x) => x[1] === c[1]) === i && !storeForChain({ key: c[0] }))
      .map((c) => `<option value="new:${c[0]}" ${'new:' + c[0] === sel ? 'selected' : ''}>${esc(c[1])} (neu)</option>`).join('');
  const f = dialog(`
    <h3>Aus Merkliste einfügen</h3>
    <ol class="howto">
      <li><a href="https://www.marktguru.de" target="_blank" rel="noopener"><b>marktguru öffnen ↗</b></a>, Merkliste aufrufen und einen <b>Screenshot</b> machen.</li>
      <li>Den Screenshot in <b>Fotos</b> öffnen.</li>
      <li>Unten rechts das <b>Text-Symbol</b> tippen → <b>Alles auswählen</b> → <b>Kopieren</b>.</li>
      <li>Hier einfügen:</li>
    </ol>
    <div class="paste-row">
      <button type="button" class="btn primary" data-i="paste">Einfügen</button>
      <span class="muted small">oder ins Feld tippen &amp; einfügen</span>
    </div>
    <textarea name="txt" rows="4" placeholder="Kopierten Text hier einfügen …"></textarea>
    <div class="imp-rows"></div>
    <label class="switch imp-opt" hidden><input type="checkbox" name="tolist" checked><span class="knob"></span><span class="lbl">Auch auf die Einkaufsliste setzen</span></label>
    <menu><span></span><button value="cancel" class="btn" formnovalidate>Abbrechen</button><button value="save" class="btn primary" data-i="go" disabled>Übernehmen</button></menu>
  `, (v, fd) => {
    if (v !== 'save') return;
    const chosen = rows.filter((r) => r.on && r.name.trim());
    const toList = fd.get('tolist') === 'on';
    let nOffers = 0, nItems = 0, nLinked = 0;
    for (const r of chosen) {
      let sid = r.storeId;
      if (sid?.startsWith('new:')) sid = storeForChain(CHAINS.map(([key, name, type]) => ({ key, name, type })).find((c) => c.key === sid.slice(4)), true).id;
      const name = r.name.trim();
      if (r.price) { state.offers.unshift({ id: uid(), name, storeId: sid || null, price: r.price, until: nextSaturday(), cat: categorize(name) }); nOffers++; }
      if (toList) {
        // Steht es schon auf der Liste (z. B. "Spaghetti" bei "Barilla Spaghetti")? Dann nur den Laden zuordnen.
        const nw = words(name);
        const existing = openItems().find((i) => fold(i.name) === fold(name) || words(i.name).some((a) => nw.some((b) => sameWord(a, b))));
        if (existing) { if (sid && !existing.storeId) { existing.storeId = sid; nLinked++; } }
        else { addItem(name, { storeId: sid || null, note: r.size || '' }); nItems++; }
      }
    }
    save(); render();
    toast([nOffers && `${nOffers} Angebote`, nItems && `${nItems} neu auf der Liste`, nLinked && `${nLinked} Laden zugeordnet`].filter(Boolean).join(' · ') + ' ✓');
  });

  const ta = $('textarea[name=txt]', f), box = $('.imp-rows', f), go = $('[data-i=go]', f), opt = $('.imp-opt', f);
  const draw = () => {
    box.innerHTML = rows.length ? `<p class="muted small">${rows.length} erkannt – bitte kurz prüfen:</p>` + rows.map((r, i) => `
      <div class="imp-row ${r.on ? '' : 'off'}" data-r="${i}">
        <input type="checkbox" data-k="on" ${r.on ? 'checked' : ''} aria-label="übernehmen">
        <input data-k="name" value="${esc(r.name)}" aria-label="Produkt">
        <input data-k="price" value="${esc(r.price || '')}" placeholder="€" inputmode="decimal" aria-label="Preis">
        <select data-k="storeId" aria-label="Laden">${storeOpts(r.storeId)}</select>
      </div>`).join('')
      : (ta.value.trim() ? '<p class="muted small">Nichts erkannt. Stimmt der kopierte Text? Notfalls Zeilen wie „Bananen 1,99 Edeka“ eintippen.</p>' : '');
    go.disabled = !rows.some((r) => r.on);
    opt.hidden = !rows.length;
  };
  const parse = () => {
    rows = parseMerkliste(ta.value).map((o) => {
      const s = storeForChain(o.store);
      return { name: o.name, price: o.price || '', size: o.size, on: true, storeId: s ? s.id : (o.store ? 'new:' + o.store.key : '') };
    });
    draw();
  };
  ta.addEventListener('input', parse);
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k, r = rows[+e.target.closest('[data-r]')?.dataset.r];
    if (!k || !r) return;
    r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'on') { e.target.closest('.imp-row').classList.toggle('off', !r.on); go.disabled = !rows.some((x) => x.on); }
  });
  $('[data-i=paste]', f).onclick = async () => {
    try { ta.value = await navigator.clipboard.readText(); parse(); }
    catch { ta.focus(); toast('Bitte ins Feld tippen und „Einfügen“ wählen'); }
  };
}
