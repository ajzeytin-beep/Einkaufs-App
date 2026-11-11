// Ladentypen und Startliste für Emden (aus öffentlichen Verzeichnissen, Stand Nov. 2026 – bitte bei Bedarf anpassen).
const STORE_TYPES = [
  { id: 'supermarkt', name: 'Supermarkt',      icon: '🛒' },
  { id: 'discounter', name: 'Discounter',      icon: '🏷️' },
  { id: 'drogerie',   name: 'Drogerie',        icon: '🧴' },
  { id: 'getraenke',  name: 'Getränke',        icon: '🧃' },
  { id: 'baecker',    name: 'Bäckerei',        icon: '🥖' },
  { id: 'metzger',    name: 'Metzgerei',       icon: '🥩' },
  { id: 'markt',      name: 'Markt & Bio',     icon: '🥕' },
  { id: 'baumarkt',   name: 'Baumarkt & Garten', icon: '🔨' },
  { id: 'mode',       name: 'Mode & Schuhe',   icon: '👕' },
  { id: 'technik',    name: 'Elektronik',      icon: '🔌' },
  { id: 'wohnen',     name: 'Wohnen & Haushalt', icon: '🛋️' },
  { id: 'center',     name: 'Kaufhaus & Center', icon: '🏬' },
  { id: 'sonst',      name: 'Sonstiges',       icon: '📍' },
];

const EMDEN_STORES = [
  { name: 'Edeka Südbahnhof',       type: 'supermarkt', address: 'Am Südbahnhof 40' },
  { name: 'Edeka Hasse Neuer Markt', type: 'supermarkt', address: 'Neuer Markt 25' },
  { name: 'Edeka Geibelstraße',     type: 'supermarkt', address: 'Geibelstraße 27' },
  { name: 'Edeka Wykhoffweg',       type: 'supermarkt', address: 'Wykhoffweg 3-5' },
  { name: 'Edeka Larrelt',          type: 'supermarkt', address: 'Thüringer Straße 9' },
  { name: 'Rewe Center',            type: 'supermarkt', address: 'Fritz-Reuter-Straße 2a' },
  { name: 'Lidl Harsweg',           type: 'discounter', address: 'Fritz-Reuter-Straße 6' },
  { name: 'Lidl Wolthusen',         type: 'discounter', address: 'Folkmar-Allena-Straße 2' },
  { name: 'Lidl Constantia',        type: 'discounter', address: 'Teutonenstraße 1' },
  { name: 'Lidl Ulmenstraße',       type: 'discounter', address: 'Ulmenstraße 3-5' },
  { name: 'Aldi Lookvenne',         type: 'discounter', address: 'Lookvenne 12' },
  { name: 'Aldi Harsweg',           type: 'discounter', address: 'Fritz-Reuter-Straße 11' },
  { name: 'Netto Petkumer Straße',  type: 'discounter', address: 'Petkumer Straße 211' },
  { name: 'Rossmann Innenstadt',    type: 'drogerie',   address: 'Neutorstraße' },
  { name: 'Rossmann Harsweg',       type: 'drogerie',   address: 'Fritz-Reuter-Straße 4' },
  { name: 'dm Ubierstraße',         type: 'drogerie',   address: 'Ubierstraße 2a' },
];

// OpenStreetMap shop=* → Ladentyp (für "Läden in der Nähe suchen")
const OSM_TYPE = {
  supermarket: 'supermarkt', convenience: 'supermarkt', discount: 'discounter',
  chemist: 'drogerie', drugstore: 'drogerie', cosmetics: 'drogerie', beverages: 'getraenke',
  bakery: 'baecker', butcher: 'metzger', greengrocer: 'markt', organic: 'markt', farm: 'markt',
  doityourself: 'baumarkt', hardware: 'baumarkt', garden_centre: 'baumarkt',
  clothes: 'mode', shoes: 'mode', electronics: 'technik', mobile_phone: 'technik', computer: 'technik',
  furniture: 'wohnen', household: 'wohnen', houseware: 'wohnen', variety_store: 'wohnen',
  department_store: 'center', mall: 'center', supermarket_chain: 'supermarkt', bakery_shop: 'baecker', confectionery: 'baecker', pastry: 'baecker', alcohol: 'getraenke', wine: 'getraenke', perfumery: 'drogerie', pharmacy: 'drogerie', marketplace: 'markt', deli: 'markt', butcher_shop: 'metzger', bed: 'wohnen', kitchen: 'wohnen', interior_decoration: 'wohnen', clothing: 'mode', fashion_accessories: 'mode', bag: 'mode', jewelry: 'mode', optician: 'sonst', florist: 'sonst', stationery: 'sonst', gift: 'sonst', toys: 'sonst', pet: 'sonst', books: 'sonst', toys: 'sonst', sports: 'sonst',
};
