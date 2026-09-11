// ============================================================
// GAME DATA - FISHING (Joran, Umpan, Ikan, Lokasi, Tier)
// ============================================================

const TIERS = {
  1:  { name: 'Common',    emoji: '⚪', chance: 40.00 },
  2:  { name: 'Uncommon',  emoji: '🟢', chance: 22.00 },
  3:  { name: 'Rare',      emoji: '🔵', chance: 14.00 },
  4:  { name: 'Epic',      emoji: '🟣', chance: 9.00  },
  5:  { name: 'Legendary', emoji: '🟡', chance: 6.00  },
  6:  { name: 'Mythical',  emoji: '🔴', chance: 3.50  },
  7:  { name: 'Exotic',    emoji: '🟠', chance: 2.00  },
  8:  { name: 'Divine',    emoji: '✨', chance: 1.10  },
  9:  { name: 'Abyssal',   emoji: '🌑', chance: 0.50  },
  10: { name: 'Celestial', emoji: '🌌', chance: 0.20  },
  11: { name: 'Omnipotence', emoji: '♾️', chance: 0.06 },
  12: { name: 'Transcendent', emoji: '🔱', chance: 0.02 },
};

const LOCATIONS = {
  1: { id: 1, name: 'Kolam Desa',       emoji: '🏡', desc: 'Kolam tenang untuk pemula.',                    minTier: 1, maxTier: 2,  rarityBonus: 0,   minRodTier: 1, zonk: 0 },
  2: { id: 2, name: 'Sungai Hutan',     emoji: '🌿', desc: 'Sungai jernih di tengah hutan.',               minTier: 1, maxTier: 3,  rarityBonus: 0.5, minRodTier: 2, zonk: 0 },
  3: { id: 3, name: 'Danau Pegunungan', emoji: '⛰️', desc: 'Danau dingin di ketinggian.',                  minTier: 2, maxTier: 5,  rarityBonus: 1.0, minRodTier: 3, zonk: 0 },
  4: { id: 4, name: 'Teluk Laut',       emoji: '🌊', desc: 'Teluk laut lepas, ikan eksotis.',              minTier: 3, maxTier: 6,  rarityBonus: 1.5, minRodTier: 4, zonk: 12 },
  5: { id: 5, name: 'Kawasan Coral',    emoji: '🪸', desc: 'Terumbu karang, Legendary berkeliaran.',       minTier: 4, maxTier: 7,  rarityBonus: 2.0, minRodTier: 5, zonk: 30 },
  6: { id: 6, name: 'Palung Abadi',     emoji: '🌑', desc: 'Kedalaman gelap, Abyssal & Divine.',           minTier: 6, maxTier: 9,  rarityBonus: 3.0, minRodTier: 7, zonk: 48 },
  7: { id: 7, name: 'Rift Celestial',   emoji: '🌌', desc: 'Celah dimensi. Hanya yang terpilih.',          minTier: 7, maxTier: 10, rarityBonus: 5.0, minRodTier: 10, zonk: 65 },
  8: { id: 8, name: 'The Origin Point', emoji: '🌀', desc: 'Titik awal penciptaan. Segalanya bermula di sini.', minTier: 8, maxTier: 11, rarityBonus: 10.0, minRodTier: 11, zonk: 80 },
  9: { 
    id: 9, 
    name: 'The Transcendent Realm', 
    emoji: '🔱', 
    desc: 'Dimensi di luar ruang dan waktu. Tempat bersemayamnya entitas purba.', 
    minTier: 9, 
    maxTier: 12, 
    rarityBonus: 20.0, 
    minRodTier: 12,
    zonk: 90
},
};

const FISH_DATABASE = {
  common:    [
    { name: 'Ikan Mas',        tier: 1, minWeight: 0.1,  maxWeight: 0.8 },
    { name: 'Ikan Lele',       tier: 1, minWeight: 0.2,  maxWeight: 1.2 },
    { name: 'Ikan Nila',       tier: 1, minWeight: 0.1,  maxWeight: 0.9 },
    { name: 'Ikan Bandeng',    tier: 1, minWeight: 0.3,  maxWeight: 1.5 },
    { name: 'Ikan Mujair',     tier: 1, minWeight: 0.1,  maxWeight: 0.7 },
    { name: 'Udang Sungai',    tier: 1, minWeight: 0.05, maxWeight: 0.3 },
  ],
  uncommon:  [
    { name: 'Ikan Bawal',      tier: 2, minWeight: 0.5,  maxWeight: 2.5 },
    { name: 'Ikan Mujair Sirip Perak', tier: 2, minWeight: 0.6, maxWeight: 2.2 },
    { name: 'Ikan Patin',      tier: 2, minWeight: 0.8,  maxWeight: 3.0 },
    { name: 'Ikan Tawes',      tier: 2, minWeight: 0.4,  maxWeight: 2.0 },
    { name: 'Kepiting Sungai', tier: 2, minWeight: 0.2,  maxWeight: 1.0 },
  ],
  rare:      [
    { name: 'Sidat Listrik Biru', tier: 3, minWeight: 2.5, maxWeight: 8.5 },
    { name: 'Ikan Gabus Loreng',  tier: 3, minWeight: 1.5,  maxWeight: 5.0  },
    { name: 'Ikan Kakap Merah',   tier: 3, minWeight: 2.0,  maxWeight: 7.0  },
    { name: 'Ikan Tapah',         tier: 3, minWeight: 3.0,  maxWeight: 10.0 },
  ],
  epic:      [
    { name: 'Cumi-Cumi Neon Abyssal', tier: 4, minWeight: 15.0, maxWeight: 45.0 },
    { name: 'Pari Listrik Neon',     tier: 4, minWeight: 12.0, maxWeight: 40.0 },
    { name: 'Arapaima Mini',         tier: 4, minWeight: 5.0,  maxWeight: 20.0 },
    { name: 'Ikan Layar Biru',       tier: 4, minWeight: 8.0,  maxWeight: 30.0 },
    { name: 'Hiu Kecil Purba',       tier: 4, minWeight: 10.0, maxWeight: 35.0 },
  ],
  legendary: [
    { name: 'Pari Kristal Kuno', tier: 5, minWeight: 45.0, maxWeight: 130.0 },
    { name: 'Kura-Kura Zamrud Kuno', tier: 5, minWeight: 40.0,  maxWeight: 120.0  },
    { name: 'Ikan Koi Emas', tier: 5, minWeight: 40.0,  maxWeight: 120.0  },
    { name: 'Arwana Platinum Purba', tier: 5, minWeight: 10.0,  maxWeight: 30.0   },
    { name: 'Coelacanth Modern',     tier: 5, minWeight: 20.0,  maxWeight: 60.0   },
  ],
  mythical:  [
    { name: 'Kraken Bayangan Rawa', tier: 6, minWeight: 200.0, maxWeight: 800.0 },
    { name: 'Belut Listrik Ragnarok', tier: 6, minWeight: 150.0, maxWeight: 600.0  },
    { name: 'Hydra Air Tawar',        tier: 6, minWeight: 300.0, maxWeight: 1200.0 },
    { name: 'Naga Laut Merah',        tier: 6, minWeight: 100.0, maxWeight: 500.0  },
    { name: 'Leviathan Kecil',        tier: 6, minWeight: 100.0, maxWeight: 500.0  },
  ],
  exotic:    [
    { name: 'Paus Nebula Mini', tier: 7, minWeight: 600.0, maxWeight: 2500.0 },
    { name: 'Hiu Kristal Prismatik', tier: 7, minWeight: 400.0, maxWeight: 1500.0 },
    { name: 'Kraken Junior',          tier: 7, minWeight: 500.0, maxWeight: 2000.0 },
    { name: 'Ikan Langit',          tier: 7, minWeight: 500.0, maxWeight: 2000.0 },
    { name: 'Ubur-Ubur Gravitasi',          tier: 7, minWeight: 500.0, maxWeight: 2000.0 },
  ],
  divine:    [
    { name: 'Seraphim Maritim', tier: 8, minWeight: 1500.0, maxWeight: 6000.0 },
    { name: 'Phoenix Air Abadi',    tier: 8, minWeight: 200.0,   maxWeight: 1200.0  },
    { name: 'Naga Langit Awan',     tier: 8, minWeight: 1000.0,  maxWeight: 5000.0  },
    { name: 'Dragon Laut Emas',     tier: 8, minWeight: 1000.0,  maxWeight: 5000.0  },
    { name: 'Ikan Surga Bercahaya',     tier: 8, minWeight: 1000.0,  maxWeight: 5000.0  },
  ],
  abyssal:   [
    { name: 'Singa Laut Void', tier: 9, minWeight: 9000.0, maxWeight: 35000.0 },
    { name: 'Kraken Penjaga Gerbang', tier: 9, minWeight: 8000.0,  maxWeight: 30000.0 },
    { name: 'Leviathan Laut Dalam',   tier: 9, minWeight: 8000.0,  maxWeight: 30000.0 },
    { name: 'Iblis Laut Hitam',       tier: 9, minWeight: 1000.0,  maxWeight: 9999.0  },
  ],
  celestial: [
    { name: 'THE ETERNAL SUPERNOVA', tier: 10, minWeight: 150000.0, maxWeight: 1500000.0 },
    { name: 'THE BIG BANG',    tier: 10, minWeight: 999999.0, maxWeight: 9999999.0  },
    { name: 'EL UNIVERSE',     tier: 10, minWeight: 99999.0,  maxWeight: 999999.0   },
    { name: 'VOID OF ETERNITY',     tier: 10, minWeight: 99999.0,  maxWeight: 999999.0   },
  ],
  omnipotence: [
    { name: 'THE TRUE CREATOR', tier: 11, minWeight: 5000000.0, maxWeight: 50000000.0 },
    { name: 'REALITY BENDER',    tier: 11, minWeight: 1000000.0, maxWeight: 10000000.0 },
    { name: 'CHRONOS EXTREMIS',  tier: 11, minWeight: 2000000.0, maxWeight: 20000000.0 },
  ],
  transcendent: [
  { name: 'AXIOM OF REALITY', tier: 12, minWeight: 10000000.0, maxWeight: 99999999.0 },
  { name: 'THE ULTIMATE BEING', tier: 12, minWeight: 5000000.0, maxWeight: 25000000.0 }
]

};

const ALL_FISH = Object.values(FISH_DATABASE).flat();

const RODS = [
  { id: 'rod_1',  name: 'Joran Plastik',       tier: 1,  price: 0,          bonus: 0,    emoji: '🎣' },
  { id: 'rod_2',  name: 'Joran Bambu',          tier: 2,  price: 20000,      bonus: 2.0,  emoji: '🎋' },
  { id: 'rod_3',  name: 'Joran Serat Kaca',     tier: 3,  price: 100000,     bonus: 5.0,  emoji: '🧪' },
  { id: 'rod_4',  name: 'Joran Karbon',         tier: 4,  price: 580000,     bonus: 10.0, emoji: '🖤' },
  { id: 'rod_5',  name: 'Joran Titanium',       tier: 5,  price: 5000000,    bonus: 18.0, emoji: '⛓️' },
  { id: 'rod_6',  name: 'Joran Mithril',        tier: 6,  price: 15000000,   bonus: 28.0, emoji: '🔷' },
  { id: 'rod_7',  name: 'Joran Naga',           tier: 7,  price: 30000000,   bonus: 40.0, emoji: '🐲' },
  { id: 'rod_8',  name: 'Joran Cahaya Ilahi',   tier: 8,  price: 60000000,   bonus: 55.0, emoji: '✨' },
  { id: 'rod_9',  name: 'Joran Void Abyssal',   tier: 9,  price: 120000000,  bonus: 75.0, emoji: '🌑' },
  { id: 'rod_10', name: 'Joran Celestial Omega',tier: 10, price: 240000000,  bonus: 100.0,emoji: '🌌' },
  { 
  id: 'rod_11', 
  name: 'Joran Creator Reality', 
  tier: 11, 
  price: 500000000, // 500 Juta Money
  bonus: 150.0, 
  emoji: '♾️' 
}
  ,{ 
    id: 'rod_12', 
    name: 'Joran Essence of Existence', 
    tier: 12, 
    price: 1000000000, // 1 Miliar Money
    bonus: 225.0, 
    emoji: '🔱' 
}
];

const BAITS = [
  { id: 'bait_1', name: 'Cacing Tanah',         price: 100,       bonus: 0.1,  emoji: '🪱' },
  { id: 'bait_2', name: 'Pelet Ayam',           price: 500,       bonus: 0.5,  emoji: '🧆' },
  { id: 'bait_3', name: 'Udang Segar',          price: 1000,      bonus: 1.5,  emoji: '🦐' },
  { id: 'bait_4', name: 'Ikan Kecil',           price: 5000,      bonus: 3.0,  emoji: '🐟' },
  { id: 'bait_5', name: 'Cumi-Cumi',            price: 29000,     bonus: 6.0,  emoji: '🦑' },
  { id: 'bait_6', name: 'Umpan Luminous',       price: 250000,    bonus: 10.0, emoji: '🔮' },
  { id: 'bait_7', name: 'Daging Monster',       price: 750000,    bonus: 15.0, emoji: '🥩' },
  { id: 'bait_8', name: 'Kristal Energi',       price: 1500000,   bonus: 22.0, emoji: '💠' },
  { id: 'bait_9', name: 'Orb Kegelapan',        price: 3000000,   bonus: 30.0, emoji: '🌀' },
  { id: 'bait_10',name: 'Esensi Galaksi',       price: 6000000,   bonus: 40.0, emoji: '🌌' },
  { 
  id: 'bait_11', 
  name: 'Serpihan Keberadaan', 
  price: 12000000, // 12 Juta Money
  bonus: 60.0, 
  emoji: '💠' 
}
  ,{ 
    id: 'bait_12', 
    name: 'Soul of the Universe', 
    price: 25000000, // 25 Juta Money
    bonus: 100.0, 
    emoji: '🌌' 
}
];

module.exports = { TIERS, LOCATIONS, ALL_FISH, RODS, BAITS };
