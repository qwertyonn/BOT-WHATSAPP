// ============================================================
// GACHA DATA
// Pool hadiah gacha umum. Didefinisikan deklaratif agar mudah
// di-rebalance tanpa menyentuh engine/handler.
//
// Reward shape:
//   { type: 'money',      min, max }               → addMoney
//   { type: 'material',   id, count }              → root field RPG (p.wood dll)
//   { type: 'shopItem',   id, count }              → p.inventory RPG (apel/roti/ramuan/kontrak)
//   { type: 'fish',       tier, count }            → inventory FishIt (pickFish)
//   { type: 'pokeball',   count }                  → pokemon player pokeballs
//   { type: 'bait',       id, count }              → p.bait FishIt
// ============================================================

const GACHA_PRICE = 50000;      // harga 1 tarikan
const GACHA_MULTI = 10;         // jumlah tarikan sekali jalan (10x)
const GACHA_PITY  = 50;         // tarikan tanpa Legendary → dijamin L

// Peluang dasar per rarity (persen, total 100). Pity menggantikan roll
// bila sudah GACHA_PITY tarikan berturut-turut tanpa Legendary.
const RARITIES = [
  { id: 'common',    emoji: '🟢', name: 'Common',    chance: 55, color: 'hijau' },
  { id: 'rare',      emoji: '🔵', name: 'Rare',      chance: 30, color: 'biru' },
  { id: 'epic',      emoji: '🟣', name: 'Epic',      chance: 11, color: 'ungu' },
  { id: 'legendary', emoji: '🟡', name: 'Legendary', chance: 2,  color: 'emas' },
  { id: 'mythic',    emoji: '🔮', name: 'Mythic',    chance: 1,  color: 'ungu tua' },
];

// Pool per rarity. Tiap entri: reward + weight (makin besar, makin sering).
// Batas atas reward: material RPG tier 1-15, ikan tier 1-10, umpan bait_1-10.
// EV disetel jauh di bawah GACHA_PRICE biar bot tidak jebol. Reward tier
// sangat tinggi (star_shatter dll) memakai count/weight kecil agar EV aman.
const GACHA_POOL = {
  common: [
    { reward: { type: 'money',    min: 2000, max: 8000 },  weight: 4 },
    { reward: { type: 'material', id: 'wood', count: 3 },  weight: 3 },
    { reward: { type: 'material', id: 'stone', count: 3 }, weight: 3 },
    { reward: { type: 'material', id: 'iron', count: 2 },  weight: 2 },
    { reward: { type: 'shopItem', id: 'apple', count: 2 }, weight: 2 },
    { reward: { type: 'shopItem', id: 'bread', count: 2 }, weight: 2 },
    { reward: { type: 'fish',     tier: 1, count: 2 },     weight: 2 },
    { reward: { type: 'fish',     tier: 2, count: 2 },     weight: 2 },
    { reward: { type: 'bait',     id: 'bait_1', count: 5 },weight: 1 },
  ],
  rare: [
    { reward: { type: 'material', id: 'iron', count: 5 },  weight: 3 },
    { reward: { type: 'material', id: 'gold_ingot', count: 1 }, weight: 2 },
    { reward: { type: 'material', id: 'diamond', count: 1 },    weight: 1 },
    { reward: { type: 'material', id: 'adamantium', count: 1 }, weight: 1 },
    { reward: { type: 'shopItem', id: 'potion', count: 2 },weight: 2 },
    { reward: { type: 'shopItem', id: 'potion2', count: 1 },weight: 1 },
    { reward: { type: 'fish',     tier: 3, count: 2 },     weight: 2 },
    { reward: { type: 'fish',     tier: 4, count: 1 },     weight: 2 },
    { reward: { type: 'pokeball', count: 2 },              weight: 2 },
    { reward: { type: 'bait',     id: 'bait_2', count: 5 },weight: 2 },
    { reward: { type: 'bait',     id: 'bait_3', count: 3 },weight: 1 },
  ],
  epic: [
    { reward: { type: 'material', id: 'gold_ingot', count: 5 }, weight: 2 },
    { reward: { type: 'material', id: 'diamond', count: 2 },    weight: 2 },
    { reward: { type: 'material', id: 'adamantium', count: 2 }, weight: 2 },
    { reward: { type: 'material', id: 'uru', count: 1 },        weight: 1 },
    { reward: { type: 'material', id: 'mithril', count: 1 },    weight: 1 },
    { reward: { type: 'material', id: 'vibranium', count: 1 },  weight: 1 },
    { reward: { type: 'shopItem', id: 'kontrak_kelas', count: 1 }, weight: 2 },
    { reward: { type: 'fish',     tier: 5, count: 1 },          weight: 2 },
    { reward: { type: 'fish',     tier: 6, count: 1 },          weight: 1 },
    { reward: { type: 'fish',     tier: 7, count: 1 },          weight: 1 },
    { reward: { type: 'pokeball', count: 10 },                  weight: 2 },
    { reward: { type: 'bait',     id: 'bait_4', count: 5 },     weight: 2 },
    { reward: { type: 'bait',     id: 'bait_5', count: 2 },     weight: 1 },
  ],
  legendary: [
    { reward: { type: 'material', id: 'mithril', count: 2 },     weight: 2 },
    { reward: { type: 'material', id: 'vibranium', count: 1 },   weight: 2 },
    { reward: { type: 'material', id: 'orichalcum', count: 1 },  weight: 2 },
    { reward: { type: 'material', id: 'aetherium', count: 1 },   weight: 1 },
    { reward: { type: 'material', id: 'dark_matter', count: 1 }, weight: 1 },
    { reward: { type: 'material', id: 'celestial_core', count: 1 }, weight: 1 },
    { reward: { type: 'fish',     tier: 8, count: 1 },           weight: 2 },
    { reward: { type: 'fish',     tier: 9, count: 1 },           weight: 1 },
    { reward: { type: 'fish',     tier: 10, count: 1 },          weight: 1 },
    { reward: { type: 'money',    min: 100000, max: 250000 },    weight: 2 },
    { reward: { type: 'bait',     id: 'bait_6', count: 2 },      weight: 1 },
    { reward: { type: 'bait',     id: 'bait_7', count: 2 },      weight: 1 },
    { reward: { type: 'bait',     id: 'bait_8', count: 1 },      weight: 1 },
  ],
  mythic: [
    { reward: { type: 'material', id: 'celestial_core', count: 2 }, weight: 2 },
    { reward: { type: 'material', id: 'dragon_heart', count: 1 },   weight: 1 },
    { reward: { type: 'material', id: 'phoenix_feather', count: 1 },weight: 1 },
    { reward: { type: 'material', id: 'star_shatter', count: 1 },   weight: 1 },
    { reward: { type: 'fish',     tier: 10, count: 2 },             weight: 2 },
    { reward: { type: 'money',    min: 500000, max: 1000000 },      weight: 2 },
    { reward: { type: 'pokeball', count: 25 },                      weight: 2 },
    { reward: { type: 'bait',     id: 'bait_9', count: 2 },         weight: 1 },
    { reward: { type: 'bait',     id: 'bait_10', count: 1 },        weight: 1 },
  ],
};

module.exports = { GACHA_PRICE, GACHA_MULTI, GACHA_PITY, RARITIES, GACHA_POOL };
