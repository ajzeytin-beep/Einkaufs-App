// Standard-Abteilungen in typischer Edeka-Reihenfolge (Eingang → Kasse).
// Die echte Reihenfolge im Laden stellt ihr unter "Laufweg" ein.
const DEFAULT_CATEGORIES = [
  { id: 'obst',      name: 'Obst & Gemüse',          icon: '🥬' },
  { id: 'brot',      name: 'Brot & Backwaren',       icon: '🥖' },
  { id: 'fleisch',   name: 'Fleisch, Wurst & Fisch', icon: '🥩' },
  { id: 'kaese',     name: 'Käse',                   icon: '🧀' },
  { id: 'kuehl',     name: 'Milch & Kühlregal',      icon: '🥛' },
  { id: 'fruehst',   name: 'Frühstück & Aufstrich',  icon: '🍯' },
  { id: 'nudeln',    name: 'Nudeln, Reis & Mehl',    icon: '🍝' },
  { id: 'konserven', name: 'Konserven & Saucen',     icon: '🥫' },
  { id: 'gewuerze',  name: 'Gewürze & Öl',           icon: '🧂' },
  { id: 'suess',     name: 'Süßes & Knabbern',       icon: '🍫' },
  { id: 'kaffee',    name: 'Kaffee & Tee',           icon: '☕' },
  { id: 'getraenke', name: 'Getränke',               icon: '🧃' },
  { id: 'tk',        name: 'Tiefkühl',               icon: '🧊' },
  { id: 'drogerie',  name: 'Drogerie & Haushalt',    icon: '🧴' },
  { id: 'sonstiges', name: 'Sonstiges',              icon: '📦' },
];

// Stichwörter zur automatischen Einsortierung (Teilwort-Treffer, klein geschrieben).
const KEYWORDS = {
  obst: ['tomate','gurke','salat','apfel','äpfel','banane','birne','zitrone','limette','orange','mandarine','traube','beere','kiwi','mango','ananas','melone','avocado','paprika','zwiebel','knoblauch','kartoffel','möhre','karotte','zucchini','aubergine','brokkoli','blumenkohl','kohl','spinat','rucola','lauch','porree','sellerie','pilz','champignon','ingwer','petersilie','basilikum','schnittlauch','dill','radieschen','kürbis','mais','obst','gemüse','frühlingszwiebel','süßkartoffel','rote bete','fenchel','spargel'],
  brot: ['brot','brötchen','toast','baguette','croissant','kuchen','laugen','brezel','semmel','fladenbrot','wrap','tortilla','knäcke','zwieback'],
  fleisch: ['fleisch','hähnchen','huhn','pute','rind','schwein','hack','wurst','salami','schinken','speck','bacon','würstchen','bratwurst','aufschnitt','fisch','lachs','thunfischsteak','garnele','krabbe','hering','matjes','steak','schnitzel','gulasch','frikadelle','leberwurst','mett'],
  kaese: ['käse','gouda','emmentaler','mozzarella','feta','parmesan','camembert','brie','frischkäse','hirtenkäse','halloumi','cheddar','raclette'],
  kuehl: ['milch','joghurt','jogurt','quark','sahne','butter','margarine','ei','eier','schmand','creme fraiche','crème fraîche','skyr','pudding','kefir','buttermilch','tofu','hefe','teig','blätterteig','pizzateig','saft frisch'],
  fruehst: ['marmelade','konfitüre','honig','nutella','müsli','cornflakes','haferflocken','flocken','aufstrich','erdnussbutter','nuss-nougat'],
  nudeln: ['nudel','spaghetti','penne','fusilli','lasagne','reis','mehl','zucker','grieß','couscous','bulgur','quinoa','linsen','backpulver','vanillezucker','stärke','paniermehl'],
  konserven: ['dosen','dose','konserve','passata','tomatenmark','gehackte tomaten','mais dose','bohnen','kichererbse','thunfisch','sauce','soße','ketchup','mayo','senf','brühe','suppe','pesto','gurken glas','oliven','essiggurke','sauerkraut','fertig'],
  gewuerze: ['salz','pfeffer','gewürz','paprikapulver','curry','zimt','oregano','öl','olivenöl','essig','balsamico','sojasauce','chili'],
  suess: ['schokolade','chips','keks','gummibärchen','bonbon','süßigkeit','flips','erdnüsse','nüsse','salzstangen','riegel','popcorn','kekse'],
  kaffee: ['kaffee','tee','kakao','espresso','pads','kapseln','filter'],
  getraenke: ['wasser','sprudel','saft','cola','limo','bier','wein','sekt','schorle','fanta','sprite','eistee','energy','mineralwasser','apfelschorle'],
  tk: ['tiefkühl','tk ','eis','pizza','pommes','fischstäbchen','tk-','gefroren','spinat tk','erbsen'],
  drogerie: ['klopapier','toilettenpapier','küchenrolle','zahnpasta','zahnbürste','shampoo','duschgel','seife','deo','spülmittel','waschmittel','müllbeutel','taschentuch','windel','creme','rasierer','tabs','spültabs','schwamm','alufolie','frischhaltefolie','backpapier','batterie','weichspüler','reiniger'],
};

function guessCategory(name) {
  const n = ' ' + name.toLowerCase().trim() + ' ';
  let best = null, bestLen = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      const hit = w.length <= 3 ? new RegExp('(^|\\s)' + w.trim() + '(\\s|$)').test(n) : n.includes(w);
      if (hit && w.length > bestLen) { best = cat; bestLen = w.length; }
    }
  }
  return best || 'sonstiges';
}
