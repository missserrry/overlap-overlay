// Марка машины по пути машины iRacing (CarPath, например "porsche992rgt3") и экранному имени.
// Логотипы лежат в overlays/common/brands/ — чистые знаки без фона, в фирменных цветах (источники — в README).
// Если логотипа для марки нет, ячейка остаётся пустой.

const BRANDS = {
  acura: ['Acura', 'acura.png'],
  alfaromeo: ['Alfa Romeo', 'alfaromeo.png'],
  alpine: ['Alpine', 'alpine.png'],
  astonmartin: ['Aston Martin', 'astonmartin.png'],
  audi: ['Audi', 'audi.png'],
  bentley: ['Bentley', 'bentley.png'],
  bmw: ['BMW', 'bmw.png'],
  bugatti: ['Bugatti', 'bugatti.png'],
  buick: ['Buick', 'buick.png'],
  cadillac: ['Cadillac', 'cadillac.png'],
  carlsson: ['Carlsson', 'carlsson.png'],
  chevrolet: ['Chevrolet', 'chevrolet.png'],
  cupra: ['Cupra', 'cupra.png'],
  dallara: ['Dallara', 'dallara.svg'],
  ferrari: ['Ferrari', 'ferrari.png'],
  ford: ['Ford', 'ford.png'],
  genesis: ['Genesis', 'genesis.png'],
  ginetta: ['Ginetta', 'ginetta.png'],
  gumpert: ['Gumpert', 'gumpert.png'],
  holden: ['Holden', 'holden.png'],
  honda: ['Honda', 'honda.png'],
  hyundai: ['Hyundai', 'hyundai.png'],
  jaguar: ['Jaguar', 'jaguar.png'],
  kia: ['Kia', 'kia.png'],
  koenigsegg: ['Koenigsegg', 'koenigsegg.png'],
  ktm: ['KTM', 'ktm.png'],
  lada: ['Lada', 'lada.png'],
  lamborghini: ['Lamborghini', 'lamborghini.png'],
  lexus: ['Lexus', 'lexus.png'],
  ligier: ['Ligier', 'ligier.png'],
  lotus: ['Lotus', 'lotus.png'],
  lynkandco: ['Lynk & Co', 'lynkandco.png'],
  maserati: ['Maserati', 'maserati.png'],
  mazda: ['Mazda', 'mazda.png'],
  mclaren: ['McLaren', 'mclaren.svg'],
  mercedes: ['Mercedes-AMG', 'mercedes.png'],
  mini: ['Mini', 'mini.png'],
  nissan: ['Nissan', 'nissan.png'],
  opel: ['Opel', 'opel.png'],
  pagani: ['Pagani', 'pagani.png'],
  polestar: ['Polestar', 'polestar.png'],
  pontiac: ['Pontiac', 'pontiac.png'],
  porsche: ['Porsche', 'porsche.png'],
  praga: ['Praga', 'praga.png'],
  radical: ['Radical', 'radical.png'],
  ram: ['Ram', 'ram.png'],
  renault: ['Renault', 'renault.png'],
  ruf: ['RUF', 'ruf.png'],
  seat: ['Seat', 'seat.png'],
  skipbarber: ['Skip Barber', 'skipbarber.svg'],
  subaru: ['Subaru', 'subaru.png'],
  toyota: ['Toyota', 'toyota.png'],
  vauxhall: ['Vauxhall', 'vauxhall.png'],
  volkswagen: ['Volkswagen', 'volkswagen.png'],
  volvo: ['Volvo', 'volvo.png'],
};

// Порядок важен: сначала частные случаи (NSX — это Acura, а не Honda)
const RULES = [
  [/acura|nsx|arx0|arx-0/, 'acura'], [/porsche|cayman|911/, 'porsche'], [/bmw/, 'bmw'], [/audi/, 'audi'],
  [/ferrari/, 'ferrari'], [/mercedes|amg/, 'mercedes'], [/lamborghini|huracan/, 'lamborghini'], [/mclaren/, 'mclaren'],
  [/aston/, 'astonmartin'], [/cadillac|dpi|vseries/, 'cadillac'], [/chev|camaro|corvette|silverado|impala/, 'chevrolet'],
  [/ford|mustang|fiesta/, 'ford'], [/toyota|camry|gr86|supra|tundra/, 'toyota'], [/lexus/, 'lexus'],
  [/mazda|mx5|rx7|miata/, 'mazda'], [/honda|civic/, 'honda'], [/nissan|gtr|370z/, 'nissan'], [/subaru|brz|wrx/, 'subaru'],
  [/hyundai|elantra|veloster/, 'hyundai'], [/\bkia\b|^kia/, 'kia'], [/lotus/, 'lotus'], [/cupra/, 'cupra'],
  [/volkswagen|^vw|beetle|jetta|golf/, 'volkswagen'], [/^seat|seat\s/, 'seat'], [/renault|megane/, 'renault'],
  [/alpine/, 'alpine'], [/opel|calibra/, 'opel'], [/volvo/, 'volvo'], [/buick/, 'buick'], [/pontiac|solstice/, 'pontiac'],
  [/holden|supercar/, 'holden'], [/dallara/, 'dallara'], [/^ruf|ruf\s/, 'ruf'], [/radical/, 'radical'],
  [/ligier/, 'ligier'], [/hpd/, 'acura'], [/bentley/, 'bentley'], [/maserati/, 'maserati'], [/^ram/, 'ram'],
  [/lada/, 'lada'], [/ktm/, 'ktm'], [/jaguar/, 'jaguar'], [/skipbarber|skip barber/, 'skipbarber'],
  [/williams/, 'williams'], [/tatuus/, 'tatuus'],
  [/genesis/, 'genesis'], [/ginetta/, 'ginetta'], [/pagani|huayra|zonda/, 'pagani'], [/lynk/, 'lynkandco'],
  [/alfa|giulia/, 'alfaromeo'], [/koenigsegg/, 'koenigsegg'], [/gumpert/, 'gumpert'], [/praga/, 'praga'],
  [/carlsson/, 'carlsson'], [/^mini|mini|cooper/, 'mini'], [/vauxhall|astra/, 'vauxhall'], [/bugatti/, 'bugatti'],
  [/polestar/, 'polestar'],
];

function brandOf(carPath, carName) {
  for (const text of [String(carPath || '').toLowerCase().replace(/[\/_-]+/g, ''), String(carName || '').toLowerCase()]) {
    if (!text) continue;
    for (const [re, id] of RULES) if (re.test(text)) return id;
  }
  return null;
}

// То, что уходит оверлеям: { id, name, file } или null (марка неизвестна или логотипа нет)
function brandInfo(carPath, carName) {
  const id = brandOf(carPath, carName);
  if (!id || !BRANDS[id]) return null;
  const [name, file] = BRANDS[id];
  return { id, name, file };
}

module.exports = { brandInfo, brandOf };
