import { db } from './db.js';

// Точные цены каталога (priceCoins). priceTON = priceCoins * 0.1 (1 монета = 0.1 TON).
// Источник истины: цена берётся ТОЛЬКО отсюда/из БД, клиент шлёт лишь giftId.
const GIFTS = [
  ['Cookie Heart', 31], ['Crystal Ball', 73], ['Cupid Charm', 138],
  ['Diamond Ring', 193], ["Durov's Cap", 4250], ['Easter Egg', 25],
  ['Electric Skull', 218], ['Eternal Candle', 42], ['Eternal Rose', 173],
  ['Evil Eye', 53], ['Faith Amulet', 37], ['Flying Broom', 73],
  ['Fresh Socks', 27], ['Gem Signet', 519], ['Genie Lamp', 309],
  ['Ginger Cookie', 28], ['Hanging Star', 58], ['Happy Brownie', 28],
  ['Heart Locket', 11490], ['Hex Pot', 29], ['Holiday Drink', 24],
  ['Homemade Cake', 34], ['Hypno Lollipop', 25], ['Ice Cream', 22],
  ['Input Key', 37], ['Instant Ramen', 22], ['Ion Gem', 554],
  ['Ionic Dryer', 110], ['Jack-in-the-Box', 26], ['Jelly Bunny', 55],
  ['Jester Hat', 25], ['Jolly Chimp', 55], ['Joyful Bundle', 48],
  ["Khabib's Papakha", 193], ['Kissed Frog', 353], ['Light Sword', 45],
  ['Lol Pop', 23], ['Loot Bag', 934], ['Love Candle', 65],
  ['Mousse Cake', 29], ['Nail Bracelet', 889], ['Neko Helmet', 294],
  ['Party Sparkler', 27], ['Perfume Bottle', 549], ['Pet Snake', 26],
  ['Plush Pepe', 49970], ['Pool Float', 24], ['Precious Peach', 2380],
  ['Pretty Posy', 31], ['Record Player', 72], ['Restless Jar', 34],
  ['Santa Hat', 27], ['Scared Cat', 1309], ['Sharp Tongue', 340],
  ['Signet Ring', 245], ['Skull Flower', 69], ['Sky Stilettos', 124],
  ['Sleigh Bell', 58], ['Snake Box', 21], ['Snoop Cigar', 80],
  ['Snoop Dogg', 39], ['Snow Globe', 30], ['Snow Mittens', 31],
  ['Spiced Wine', 28], ['Spy Agaric', 40], ['Star Notepad', 29],
  ['Stellar Rocket', 31], ['Swag Bag', 35], ['Tama Gadget', 25],
  ['Timeless Book', 29], ['Top Hat', 65], ['Toy Bear', 316],
  ['Trapped Heart', 96], ['UFC Strike', 103], ['Valentine Box', 62],
  ['Vice Cream', 21], ['Vintage Cigar', 249], ['Voodoo Doll', 224],
  ['Westside Sign', 545], ['Whip Cupcake', 22], ['Winter Wreath', 24],
  ['Witch Hat', 36], ['Xmas Stocking', 21]
];

// Имя → реальный файл картинки (ассеты называются gift-NNN.png, не slug.png).
// Маппинг взят из gifts-catalog.js (где имена уже привязаны к файлам).
const FILE_BY_NAME = {
  'Cookie Heart': 'gift-144.png', 'Crystal Ball': 'gift-046.png', 'Cupid Charm': 'gift-168.png',
  'Diamond Ring': 'gift-169.png', "Durov's Cap": 'gift-089.png', 'Easter Egg': 'gift-249.png',
  'Electric Skull': 'gift-067.png', 'Eternal Candle': 'gift-030.png', 'Eternal Rose': 'gift-085.png',
  'Evil Eye': 'gift-063.png', 'Faith Amulet': 'gift-228.png', 'Flying Broom': 'gift-045.png',
  'Fresh Socks': 'gift-190.png', 'Gem Signet': 'gift-083.png', 'Genie Lamp': 'gift-107.png',
  'Ginger Cookie': 'gift-129.png', 'Hanging Star': 'gift-090.png', 'Happy Brownie': 'gift-230.png',
  'Heart Locket': 'gift-164.png', 'Hex Pot': 'gift-064.png', 'Holiday Drink': 'gift-131.png',
  'Homemade Cake': 'gift-005.png', 'Hypno Lollipop': 'gift-065.png', 'Ice Cream': 'gift-265.png',
  'Input Key': 'gift-188.png', 'Instant Ramen': 'gift-229.png', 'Ion Gem': 'gift-051.png',
  'Ionic Dryer': 'gift-223.png', 'Jack-in-the-Box': 'gift-243.png', 'Jelly Bunny': 'gift-091.png',
  'Jester Hat': 'gift-123.png', 'Jolly Chimp': 'gift-231.png', 'Joyful Bundle': 'gift-185.png',
  "Khabib's Papakha": 'gift-326.png', 'Kissed Frog': 'gift-066.png', 'Light Sword': 'gift-191.png',
  'Lol Pop': 'gift-026.png', 'Loot Bag': 'gift-166.png', 'Love Candle': 'gift-088.png',
  'Mousse Cake': 'gift-209.png', 'Nail Bracelet': 'gift-184.png', 'Neko Helmet': 'gift-224.png',
  'Party Sparkler': 'gift-143.png', 'Perfume Bottle': 'gift-087.png', 'Pet Snake': 'gift-149.png',
  'Plush Pepe': 'gift-104.png', 'Pool Float': 'gift-291.png', 'Precious Peach': 'gift-105.png',
  'Pretty Posy': 'gift-208.png', 'Record Player': 'gift-069.png', 'Restless Jar': 'gift-167.png',
  'Santa Hat': 'gift-127.png', 'Scared Cat': 'gift-043.png', 'Sharp Tongue': 'gift-001.png',
  'Signet Ring': 'gift-108.png', 'Skull Flower': 'gift-002.png', 'Sky Stilettos': 'gift-165.png',
  'Sleigh Bell': 'gift-124.png', 'Snake Box': 'gift-148.png', 'Snoop Cigar': 'gift-284.png',
  'Snoop Dogg': 'gift-271.png', 'Snow Globe': 'gift-126.png', 'Snow Mittens': 'gift-125.png',
  'Spiced Wine': 'gift-103.png', 'Spy Agaric': 'gift-029.png', 'Star Notepad': 'gift-111.png',
  'Stellar Rocket': 'gift-245.png', 'Swag Bag': 'gift-283.png', 'Tama Gadget': 'gift-147.png',
  'Timeless Book': 'gift-305.png', 'Top Hat': 'gift-204.png', 'Toy Bear': 'gift-170.png',
  'Trapped Heart': 'gift-006.png', 'UFC Strike': 'gift-327.png', 'Valentine Box': 'gift-183.png',
  'Vice Cream': 'gift-264.png', 'Vintage Cigar': 'gift-070.png', 'Voodoo Doll': 'gift-044.png',
  'Westside Sign': 'gift-286.png', 'Whip Cupcake': 'gift-210.png', 'Winter Wreath': 'gift-128.png',
  'Witch Hat': 'gift-031.png', 'Xmas Stocking': 'gift-145.png'
};

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')        // апострофы убираем: Durov's -> durovs
    .replace(/[^a-z0-9]+/g, '-') // прочее -> дефис
    .replace(/^-+|-+$/g, '');
}

function rarityFor(coins) {
  if (coins >= 2000) return 'Legendary';
  if (coins >= 500) return 'Epic';
  if (coins >= 150) return 'Rare';
  if (coins >= 50) return 'Uncommon';
  return 'Common';
}

// Идемпотентный upsert. Пропускаем, если каталог уже полностью засижен
// И картинки уже привязаны к реальным файлам (self-healing: переседит один
// раз после правки file-маппинга, потом скипает — без write-burst на каждый старт).
export async function seedGifts() {
  const { n } = await db('portals_cache').count('* as n').first().catch(() => ({ n: 0 }));
  const probe = await db('portals_cache').where({ id: 'plush-pepe' }).first().catch(() => null);
  if (Number(n) >= GIFTS.length && probe && probe.file === FILE_BY_NAME['Plush Pepe']) return 0;

  for (const [name, priceCoins] of GIFTS) {
    const id = slugify(name);
    const priceTon = Math.round(priceCoins * 0.1 * 1000) / 1000;
    const file = FILE_BY_NAME[name] || 'gift-001.png';
    const rarity = rarityFor(priceCoins);
    const exists = await db('portals_cache').where({ id }).first();
    if (exists) {
      await db('portals_cache').where({ id }).update({ name, file, priceCoins, priceTon, rarity, updated_at: db.fn.now() });
    } else {
      await db('portals_cache').insert({ id, name, file, rarity, priceCoins, priceTon, stock: 999, available: true, updated_at: db.fn.now() });
    }
  }
  return GIFTS.length;
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  seedGifts()
    .then((n) => { console.log(`seeded ${n} gifts`); return db.destroy(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
