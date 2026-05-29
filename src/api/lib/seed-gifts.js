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

// Идемпотентный upsert: обновляет цены, не трогает stock/available вручную.
// Пропускаем, если каталог уже полностью засижен — чтобы не устраивать
// write-burst при каждом старте (API и bot оба зовут migrate()).
export async function seedGifts() {
  const { n } = await db('portals_cache').count('* as n').first().catch(() => ({ n: 0 }));
  if (Number(n) >= GIFTS.length) return 0;
  for (const [name, priceCoins] of GIFTS) {
    const id = slugify(name);
    const priceTon = Math.round(priceCoins * 0.1 * 1000) / 1000;
    const row = {
      id,
      name,
      file: `${id}.png`,
      rarity: rarityFor(priceCoins),
      priceCoins,
      priceTon,
      stock: 999,
      available: true,
      updated_at: db.fn.now()
    };
    const exists = await db('portals_cache').where({ id }).first();
    if (exists) {
      await db('portals_cache').where({ id }).update({
        name, priceCoins, priceTon, rarity: row.rarity, updated_at: db.fn.now()
      });
    } else {
      await db('portals_cache').insert(row);
    }
  }
  return GIFTS.length;
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  seedGifts()
    .then((n) => { console.log(`seeded ${n} gifts`); return db.destroy(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
