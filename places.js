'use strict';
// ================= Laden-Suche über mehrere Dienste =================
// Google Maps (optional, eigener Schlüssel) + OpenStreetMap (Nominatim) + Photon (komoot).
// Alle laufen gleichzeitig; Ergebnisse werden zusammengeführt und doppelte entfernt.

const GOOGLE_TYPE = {
  supermarket: 'supermarkt', grocery_store: 'supermarkt', convenience_store: 'supermarkt', food_store: 'supermarkt',
  discount_store: 'discounter', drugstore: 'drogerie', pharmacy: 'drogerie', cosmetics_store: 'drogerie',
  bakery: 'baecker', butcher_shop: 'metzger', liquor_store: 'getraenke', beverage_store: 'getraenke',
  market: 'markt', farmers_market: 'markt', health_food_store: 'markt',
  hardware_store: 'baumarkt', home_improvement_store: 'baumarkt', garden_center: 'baumarkt',
  clothing_store: 'mode', shoe_store: 'mode', electronics_store: 'technik', cell_phone_store: 'technik',
  furniture_store: 'wohnen', home_goods_store: 'wohnen', department_store: 'center', shopping_mall: 'center',
};
const PLACE_HINT = { emden: { lat: 53.367, lon: 7.206 } };

const fold2 = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ': Zeitüberschreitung')), ms))]);
}
function shortAddr(address, place) {
  // "Neutorstraße 45, 26721 Emden, Deutschland" -> "Neutorstraße 45" (Ort weglassen, wenn es der gesuchte ist)
  const parts = String(address || '').split(',').map((x) => x.trim()).filter((x) => x && !/^deutschland|germany$/i.test(x));
  return parts.filter((x, i) => !(i > 0 && fold2(x.replace(/^\d{5}\s*/, '')) === fold2(place))).map((x) => x.replace(/^\d{5}\s+/, '')).join(', ');
}

// ---- OpenStreetMap (Nominatim) ----
async function searchNominatim(term, place) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: `${term} ${place}`.trim(), format: 'jsonv2', addressdetails: '1', limit: '15', countrycodes: 'de', 'accept-language': 'de',
  }));
  if (!r.ok) throw new Error('OpenStreetMap HTTP ' + r.status);
  return (await r.json()).filter((d) => d.name && ['shop', 'amenity', 'craft'].includes(d.category)).map((d) => {
    const a = d.address || {};
    const town = a.city || a.town || a.village || a.municipality || '';
    return { name: d.name, address: shortAddr([[a.road, a.house_number].filter(Boolean).join(' '), town].join(', '), place), type: OSM_TYPE[d.type] || 'sonst', src: 'OSM' };
  });
}

// ---- Photon (komoot, OpenStreetMap-Daten, eigener Server) ----
async function searchPhoton(term, place) {
  const hint = PLACE_HINT[fold2(place)];
  const params = new URLSearchParams({ q: `${term} ${place}`.trim(), lang: 'de', limit: '15' });
  if (hint) { params.set('lat', hint.lat); params.set('lon', hint.lon); }
  const r = await fetch('https://photon.komoot.io/api/?' + params);
  if (!r.ok) throw new Error('Photon HTTP ' + r.status);
  return ((await r.json()).features || []).map((f) => f.properties || {})
    .filter((p) => p.name && ['shop', 'amenity', 'craft'].includes(p.osm_key) && (p.countrycode || 'DE').toUpperCase() === 'DE')
    .map((p) => ({ name: p.name, address: shortAddr([[p.street, p.housenumber].filter(Boolean).join(' '), p.city || p.town || ''].join(', '), place), type: OSM_TYPE[p.osm_value] || 'sonst', src: 'OSM' }));
}

// ---- Google Maps (Places, neue API über Maps JavaScript) ----
let googleLoad = null;
function loadGoogle(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (googleLoad) return googleLoad;
  googleLoad = new Promise((res, rej) => {
    window.__gmReady = res;
    window.gm_authFailure = () => { googleLoad = null; rej(new Error('Google-Schlüssel ungültig oder nicht freigeschaltet')); };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({ key, v: 'weekly', loading: 'async', language: 'de', region: 'DE', callback: '__gmReady' });
    s.async = true;
    s.onerror = () => { googleLoad = null; rej(new Error('Google Maps nicht erreichbar')); };
    document.head.append(s);
  });
  return googleLoad;
}
async function searchGoogle(term, place, key) {
  await loadGoogle(key);
  const { Place } = await google.maps.importLibrary('places');
  const req = { textQuery: `${term} ${place}`.trim(), fields: ['displayName', 'formattedAddress', 'primaryType'], language: 'de', region: 'de', maxResultCount: 10 };
  const hint = PLACE_HINT[fold2(place)];
  if (hint) req.locationBias = { lat: hint.lat, lng: hint.lon };
  const { places } = await Place.searchByText(req);
  return (places || []).map((p) => ({ name: p.displayName, address: shortAddr(p.formattedAddress, place), type: GOOGLE_TYPE[p.primaryType] || 'sonst', src: 'Google' }))
    .filter((p) => p.name);
}

// ---- Alle zusammen ----
async function searchPlaces(term, place) {
  const key = state.settings?.googleKey;
  const jobs = [
    key ? withTimeout(searchGoogle(term, place, key), 12000, 'Google') : null,
    withTimeout(searchNominatim(term, place), 12000, 'OpenStreetMap'),
    withTimeout(searchPhoton(term, place), 12000, 'Photon'),
  ].filter(Boolean);
  const settled = await Promise.allSettled(jobs);
  const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
  const all = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  // Doppelte (gleicher Name + gleiche Straße) zusammenführen; Google zuerst
  const seen = new Map();
  for (const p of all) {
    const k = fold2(p.name) + '|' + fold2((p.address || '').split(',')[0]);
    if (!seen.has(k)) seen.set(k, p);
    else if (seen.get(k).type === 'sonst' && p.type !== 'sonst') seen.get(k).type = p.type;
  }
  if (!all.length && errors.length === settled.length) throw new Error(errors.join(' · '));
  return { results: [...seen.values()], errors };
}
