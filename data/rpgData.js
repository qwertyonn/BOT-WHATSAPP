// ============================================================
// RPG GAME DATA
// ============================================================
const MATERIALS = {
  wood:       { name: 'Kayu',       alias: 'kayu',       emoji: '🪵', tier: 1, price: 170,     sellPrice: 100,    canBuy: false },
  stone:      { name: 'Batu',       alias: 'batu',       emoji: '🪨', tier: 2, price: 350,     sellPrice: 200,    canBuy: true },
  iron:       { name: 'Besi',       alias: 'besi',       emoji: '⚙️', tier: 3, price: 1700,    sellPrice: 1000,   canBuy: true },
  gold_ingot: { name: 'Emas',       alias: 'emas',       emoji: '🪙', tier: 4, price: 10000,   sellPrice: 5800,   canBuy: false }, // Hanya bisa dijual
  diamond:    { name: 'Berlian',    alias: 'berlian',    emoji: '💎', tier: 4, price: 34000,   sellPrice: 20000,  canBuy: true },
  adamantium: { name: 'Adamantium', alias: 'adamantium', emoji: '🛡️', tier: 5, price: 85000,   sellPrice: 50000,  canBuy: true },
  uru:        { name: 'Uru',        alias: 'uru',        emoji: '🌌', tier: 6, price: 250000,  sellPrice: 150000, canBuy: false }, // Rare, tidak bisa dibeli
  mithril:       { name: 'Mithril',       alias: 'mithril',       emoji: '✨', tier: 7,  price: 500000,   sellPrice: 300000,   canBuy: false },
  vibranium:     { name: 'Vibranium',     alias: 'vibranium',     emoji: '🔮', tier: 8,  price: 1000000,  sellPrice: 600000,   canBuy: false },
  orichalcum:    { name: 'Orichalcum',    alias: 'orichalcum',    emoji: '⚡', tier: 9,  price: 2000000,  sellPrice: 1200000,  canBuy: false },
  aetherium:     { name: 'Aetherium',     alias: 'aetherium',     emoji: '💫', tier: 10, price: 4000000,  sellPrice: 2400000,  canBuy: false },
  dark_matter:   { name: 'Dark Matter',   alias: 'dark matter',   emoji: '🕳️', tier: 11, price: 8350000,  sellPrice: 5000000,  canBuy: false },
  celestial_core:{ name: 'Celestial Core', alias: 'celestial core', emoji: '🌟', tier: 12, price: 16700000, sellPrice: 10000000, canBuy: false },
  // ─── MATERIAL RAID (tier 13-15) — hanya dari raid boss ───
  dragon_heart:  { name: 'Jantung Naga',        alias: 'jantung naga',        emoji: '🔥', tier: 13, price: 32000000, sellPrice: 19000000, canBuy: false },
  phoenix_feather:{ name: 'Bulu Phoenix',       alias: 'bulu phoenix',       emoji: '🪶', tier: 14, price: 64000000, sellPrice: 38000000, canBuy: false },
  star_shatter:  { name: 'Pecahan Bintang',     alias: 'pecahan bintang',     emoji: '💫', tier: 15, price: 128000000, sellPrice: 76000000, canBuy: false },
  // ─── MATERIAL RAID ENDGAME (tier 16-20) — hanya dari raid boss baru ───
  void_crown:    { name: 'Mahkota Void',    alias: 'mahkota void',    emoji: '👑', tier: 16, price: 300000000,  sellPrice: 150000000,  canBuy: false },
  immortal_soul: { name: 'Jiwa Abadi',      alias: 'jiwa abadi',      emoji: '👻', tier: 17, price: 600000000,  sellPrice: 300000000,  canBuy: false },
  time_crystal:  { name: 'Kristal Waktu',   alias: 'kristal waktu',   emoji: '⏳', tier: 18, price: 1200000000, sellPrice: 600000000,  canBuy: false },
  dimension_essence: { name: 'Esens Dimensi', alias: 'esens dimensi', emoji: '🌀', tier: 19, price: 2400000000, sellPrice: 1200000000, canBuy: false },
  cosmic_core:   { name: 'Inti Semesta',    alias: 'inti semesta',    emoji: '🌌', tier: 20, price: 5000000000, sellPrice: 2500000000, canBuy: false }
};

const MONSTERS = {
  1:  { name: 'Tikus Raksasa',     emoji: '🐀', hp: 4000,     atk: 150,     def: 40,      expReward: 20,  goldReward: 250,    level: 1  },
  2:  { name: 'Goblin Liar',       emoji: '👺', hp: 5500,     atk: 240,     def: 90,      expReward: 35,  goldReward: 500,    level: 2  },
  3:  { name: 'Serigala Hutan',    emoji: '🐺', hp: 7600,     atk: 350,     def: 140,     expReward: 55,  goldReward: 850,    level: 3  },
  4:  { name: 'Orc Pengembara',    emoji: '👹', hp: 10500,    atk: 500,     def: 200,     expReward: 85,  goldReward: 1300,   level: 4  },
  5:  { name: 'Troll Batu',        emoji: '🧌', hp: 14500,    atk: 720,     def: 280,     expReward: 130, goldReward: 2000,   level: 5  },
  6:  { name: 'Naga Muda',         emoji: '🐉', hp: 20000,    atk: 1030,    def: 380,     expReward: 200, goldReward: 3000,   level: 6  },
  7:  { name: 'Penyihir Gelap',    emoji: '🧙', hp: 27500,    atk: 1480,    def: 520,     expReward: 300, goldReward: 4300,   level: 7  },
  8:  { name: 'Golem Api',         emoji: '🔥', hp: 38000,    atk: 2120,    def: 710,     expReward: 440, goldReward: 6300,   level: 8  },
  9:  { name: 'Vampire Tua',       emoji: '🧛', hp: 53000,    atk: 3040,    def: 970,     expReward: 620, goldReward: 8900,   level: 9  },
  10: { name: 'Hydra Kuno',        emoji: '🐲', hp: 74000,    atk: 4360,    def: 1320,    expReward: 880, goldReward: 12500,  level: 10 },
  11: { name: 'Iblis Abyssal',     emoji: '😈', hp: 103000,   atk: 6250,    def: 1800,    expReward: 1200, goldReward: 17500,  level: 11 },
  12: { name: 'Raja Kegelapan',    emoji: '💀', hp: 143000,   atk: 8950,    def: 2450,    expReward: 1800, goldReward: 26500,  level: 12 },
  13: { name: 'Titan Void',        emoji: '👾', hp: 199000,   atk: 12800,   def: 3330,    expReward: 2600, goldReward: 40000,  level: 13 },
  14: { name: 'Naga Celestial',    emoji: '🌌', hp: 276000,   atk: 18300,   def: 4520,    expReward: 3800, goldReward: 60000,  level: 14 },
  15: { name: 'Penguasa Kosmik',   emoji: '👁️', hp: 384000,   atk: 26200,   def: 6150,    expReward: 5500, goldReward: 90000,  level: 15 },
};

// ─── ESENSI BOSS ─────────────────────────────────────────
// Esensi dijatuhkan monster 12-14, tidak bisa dijual/dijudi/dibeli.
// 5 esensi difusi (via !rpg fusi) menjadi material endgame.
// Rantai: M12→aetherium(t10) → M13→dark matter(t11) → M14→celestial core(t12).
const ESSENCE = {
  void_essence:      { id: 'void_essence',      name: 'Esensi Dark Matter', emoji: '🕳️', monsterLevel: 13, dropChance: 0.25, fusesTo: 'dark_matter',   needed: 5 },
  aether_essence:    { id: 'aether_essence',    name: 'Esensi Aether',      emoji: '💠', monsterLevel: 12, dropChance: 0.20, fusesTo: 'aetherium',     needed: 5 },
  celestial_essence: { id: 'celestial_essence', name: 'Esensi Celestial',   emoji: '🌟', monsterLevel: 14, dropChance: 0.15, fusesTo: 'celestial_core', needed: 5 },
};

const WEAPONS = {
  sword_wood:   { id: 'sword_wood',   alias: 'pedang kayu',       name: 'Pedang Kayu',       emoji: '🪵', atk: 50,   tier: 1, craftCost: { wood: 10 } },
  sword_stone:  { id: 'sword_stone',  alias: 'pedang batu',       name: 'Pedang Batu',       emoji: '🪨', atk: 100,  tier: 2, craftCost: { stone: 15, wood: 15 } },
  sword_iron:   { id: 'sword_iron',   alias: 'pedang besi',       name: 'Pedang Besi',       emoji: '⚔️', atk: 200,  tier: 3, craftCost: { iron: 20, wood: 20 } },
  sword_diamond: { id: 'sword_diamond', alias: 'pedang berlian',    name: 'Pedang Berlian',    emoji: '💎', atk: 400,  tier: 4, craftCost: { diamond: 20, iron: 5, wood: 25 } },
  sword_adamantium: { id: 'sword_adamantium', alias: 'pedang adamantium', name: 'Pedang Adamantium', emoji: '🛡️', atk: 750,  tier: 5, craftCost: { adamantium: 15, diamond: 5, wood: 30 } },
  sword_uru:    { id: 'sword_uru',    alias: 'pedang uru',        name: 'Pedang Uru',        emoji: '🌌', atk: 1400, tier: 6, craftCost: { uru: 10, adamantium: 2, wood: 35 } },
  sword_mithril:    { id: 'sword_mithril',    alias: 'pedang mithril',    name: 'Pedang Mithril',    emoji: '✨', atk: 2600,   tier: 7,  craftCost: { mithril: 15, uru: 2, wood: 40 } },
  sword_vibranium:  { id: 'sword_vibranium',  alias: 'pedang vibranium',  name: 'Pedang Vibranium',  emoji: '🔮', atk: 4800,   tier: 8,  craftCost: { vibranium: 15, mithril: 5, wood: 45 } },
  sword_orichalcum: { id: 'sword_orichalcum', alias: 'pedang orichalcum', name: 'Pedang Orichalcum', emoji: '⚡', atk: 9000,   tier: 9,  craftCost: { orichalcum: 15, vibranium: 5, wood: 50 } },
  sword_aetherium:  { id: 'sword_aetherium',  alias: 'pedang aetherium',  name: 'Pedang Aetherium',  emoji: '💫', atk: 17000,  tier: 10, craftCost: { aetherium: 15, orichalcum: 5, wood: 55 } },
  sword_dark_matter:{ id: 'sword_dark_matter', alias: 'pedang dark matter', name: 'Pedang Dark Matter', emoji: '🕳️', atk: 32000, tier: 11, craftCost: { dark_matter: 15, aetherium: 5, wood: 60 } },
  sword_celestial:  { id: 'sword_celestial',  alias: 'pedang celestial',  name: 'Pedang Celestial',  emoji: '🌟', atk: 59000,  tier: 12, craftCost: { celestial_core: 15, dark_matter: 5, wood: 65 } },
  sword_dragon:  { id: 'sword_dragon',  alias: 'pedang naga',  name: 'Pedang Naga',  emoji: '🐲', atk: 108000,  tier: 13, craftCost: { dragon_heart: 15, celestial_core: 5, wood: 70 } },
  sword_phoenix: { id: 'sword_phoenix', alias: 'pedang phoenix', name: 'Pedang Phoenix', emoji: '🦅', atk: 199000, tier: 14, craftCost: { phoenix_feather: 15, dragon_heart: 5, wood: 75 } },
  sword_star:    { id: 'sword_star',    alias: 'pedang bintang', name: 'Pedang Bintang',   emoji: '💫', atk: 365000, tier: 15, craftCost: { star_shatter: 15, phoenix_feather: 5, wood: 80 } },
  sword_void:      { id: 'sword_void',      alias: 'pedang void',        name: 'Pedang Void',        emoji: '👑', atk: 668000,  tier: 16, craftCost: { void_crown: 15, star_shatter: 5, wood: 85 } },
  sword_soul:      { id: 'sword_soul',      alias: 'pedang jiwa abadi',  name: 'Pedang Jiwa Abadi',  emoji: '👻', atk: 1220000, tier: 17, craftCost: { immortal_soul: 15, void_crown: 5, wood: 90 } },
  sword_time:      { id: 'sword_time',      alias: 'pedang waktu',       name: 'Pedang Waktu',       emoji: '⏳', atk: 2240000, tier: 18, craftCost: { time_crystal: 15, immortal_soul: 5, wood: 95 } },
  sword_dimension: { id: 'sword_dimension', alias: 'pedang dimensi',     name: 'Pedang Dimensi',     emoji: '🌀', atk: 4100000, tier: 19, craftCost: { dimension_essence: 15, time_crystal: 5, wood: 100 } },
  sword_cosmic:    { id: 'sword_cosmic',    alias: 'pedang kosmik',      name: 'Pedang Kosmik',      emoji: '🌌', atk: 7500000, tier: 20, craftCost: { cosmic_core: 15, dimension_essence: 5, wood: 105 } }
};

const TOOLS = {
  // --- CANGKUL (PICKAXE) ---
  pickaxe_wood:    { id: 'pickaxe_wood',    alias: 'cangkul kayu',       name: 'Cangkul Kayu',       emoji: '🪵', type: 'pickaxe', tier: 1, bonus: 1,   craftCost: { wood: 10 } },
  pickaxe_stone:   { id: 'pickaxe_stone',   alias: 'cangkul batu',       name: 'Cangkul Batu',       emoji: '🪨', type: 'pickaxe', tier: 2, bonus: 3,   craftCost: { stone: 12, wood: 15 } },
  pickaxe_iron:    { id: 'pickaxe_iron',    alias: 'cangkul besi',       name: 'Cangkul Besi',       emoji: '⚙️', type: 'pickaxe', tier: 3, bonus: 8,   craftCost: { iron: 15, wood: 20 } },
  pickaxe_diamond: { id: 'pickaxe_diamond', alias: 'cangkul berlian',    name: 'Cangkul Berlian',    emoji: '💎', type: 'pickaxe', tier: 4, bonus: 20,  craftCost: { diamond: 10, iron: 5, wood: 25 } },
  pickaxe_adamantium: { id: 'pickaxe_adamantium', alias: 'cangkul adamantium', name: 'Cangkul Adamantium', emoji: '⛏️', type: 'pickaxe', tier: 5, bonus: 50,  craftCost: { adamantium: 8, diamond: 2, wood: 30 } },
  pickaxe_uru:     { id: 'pickaxe_uru',     alias: 'cangkul uru',        name: 'Cangkul Uru',        emoji: '🌌', type: 'pickaxe', tier: 6, bonus: 150, craftCost: { uru: 5, wood: 35 } },
  pickaxe_mithril:    { id: 'pickaxe_mithril',    alias: 'cangkul mithril',    name: 'Cangkul Mithril',    emoji: '✨', type: 'pickaxe', tier: 7,  bonus: 400,   craftCost: { mithril: 8, uru: 2, wood: 40 } },
  pickaxe_vibranium:  { id: 'pickaxe_vibranium',  alias: 'cangkul vibranium',  name: 'Cangkul Vibranium',  emoji: '🔮', type: 'pickaxe', tier: 8,  bonus: 1000,  craftCost: { vibranium: 8, mithril: 2, wood: 45 } },
  pickaxe_orichalcum: { id: 'pickaxe_orichalcum', alias: 'cangkul orichalcum', name: 'Cangkul Orichalcum', emoji: '⚡', type: 'pickaxe', tier: 9,  bonus: 2700,  craftCost: { orichalcum: 8, vibranium: 2, wood: 50 } },
  pickaxe_aetherium:  { id: 'pickaxe_aetherium',  alias: 'cangkul aetherium',  name: 'Cangkul Aetherium',  emoji: '💫', type: 'pickaxe', tier: 10, bonus: 7000,  craftCost: { aetherium: 8, orichalcum: 2, wood: 55 } },
  pickaxe_dark_matter:{ id: 'pickaxe_dark_matter', alias: 'cangkul dark matter', name: 'Cangkul Dark Matter', emoji: '🕳️', type: 'pickaxe', tier: 11, bonus: 18000, craftCost: { dark_matter: 8, aetherium: 2, wood: 60 } },
  pickaxe_celestial:  { id: 'pickaxe_celestial',  alias: 'cangkul celestial',  name: 'Cangkul Celestial',  emoji: '🌟', type: 'pickaxe', tier: 12, bonus: 48000, craftCost: { celestial_core: 8, dark_matter: 2, wood: 65 } },
  pickaxe_dragon:     { id: 'pickaxe_dragon',     alias: 'cangkul naga',       name: 'Cangkul Naga',       emoji: '🐲', type: 'pickaxe', tier: 13, bonus: 120000, craftCost: { dragon_heart: 8, celestial_core: 2, wood: 70 } },
  pickaxe_phoenix:    { id: 'pickaxe_phoenix',    alias: 'cangkul phoenix',    name: 'Cangkul Phoenix',    emoji: '🦅', type: 'pickaxe', tier: 14, bonus: 300000, craftCost: { phoenix_feather: 8, dragon_heart: 2, wood: 75 } },
  pickaxe_star:       { id: 'pickaxe_star',       alias: 'cangkul bintang',    name: 'Cangkul Bintang',    emoji: '💫', type: 'pickaxe', tier: 15, bonus: 800000, craftCost: { star_shatter: 8, phoenix_feather: 2, wood: 80 } },
  pickaxe_void:       { id: 'pickaxe_void',       alias: 'cangkul void',       name: 'Cangkul Void',       emoji: '👑', type: 'pickaxe', tier: 16, bonus: 1440000,  craftCost: { void_crown: 8, star_shatter: 2, wood: 85 } },
  pickaxe_soul:       { id: 'pickaxe_soul',       alias: 'cangkul jiwa abadi', name: 'Cangkul Jiwa Abadi', emoji: '👻', type: 'pickaxe', tier: 17, bonus: 2600000,  craftCost: { immortal_soul: 8, void_crown: 2, wood: 90 } },
  pickaxe_time:       { id: 'pickaxe_time',       alias: 'cangkul waktu',      name: 'Cangkul Waktu',      emoji: '⏳', type: 'pickaxe', tier: 18, bonus: 4700000,  craftCost: { time_crystal: 8, immortal_soul: 2, wood: 95 } },
  pickaxe_dimension:  { id: 'pickaxe_dimension',  alias: 'cangkul dimensi',    name: 'Cangkul Dimensi',    emoji: '🌀', type: 'pickaxe', tier: 19, bonus: 8400000,  craftCost: { dimension_essence: 8, time_crystal: 2, wood: 100 } },
  pickaxe_cosmic:     { id: 'pickaxe_cosmic',     alias: 'cangkul kosmik',     name: 'Cangkul Kosmik',     emoji: '🌌', type: 'pickaxe', tier: 20, bonus: 15000000, craftCost: { cosmic_core: 8, dimension_essence: 2, wood: 105 } },

  // --- KAPAK (AXE) ---
  axe_wood:    { id: 'axe_wood',    alias: 'kapak kayu',       name: 'Kapak Kayu',       emoji: '🪓', type: 'axe', tier: 1, bonus: 1,   craftCost: { wood: 10 } },
  axe_stone:   { id: 'axe_stone',   alias: 'kapak batu',       name: 'Kapak Batu',       emoji: '🪓', type: 'axe', tier: 2, bonus: 3,   craftCost: { stone: 12, wood: 15 } },
  axe_iron:    { id: 'axe_iron',    alias: 'kapak besi',       name: 'Kapak Besi',       emoji: '🪓', type: 'axe', tier: 3, bonus: 8,   craftCost: { iron: 15, wood: 20 } },
  axe_diamond: { id: 'axe_diamond', alias: 'kapak berlian',    name: 'Kapak Berlian',    emoji: '💎', type: 'axe', tier: 4, bonus: 20,  craftCost: { diamond: 10, iron: 5, wood: 25 } },
  axe_adamantium: { id: 'axe_adamantium', alias: 'kapak adamantium', name: 'Kapak Adamantium', emoji: '🪓', type: 'axe', tier: 5, bonus: 50,  craftCost: { adamantium: 8, diamond: 2, wood: 30 } },
  axe_uru:     { id: 'axe_uru',     alias: 'kapak uru',        name: 'Kapak Uru',        emoji: '🌌', type: 'axe', tier: 6, bonus: 150, craftCost: { uru: 5, wood: 35 } },
  axe_mithril:    { id: 'axe_mithril',    alias: 'kapak mithril',    name: 'Kapak Mithril',    emoji: '🪓', type: 'axe', tier: 7,  bonus: 400,   craftCost: { mithril: 8, uru: 2, wood: 40 } },
  axe_vibranium:  { id: 'axe_vibranium',  alias: 'kapak vibranium',  name: 'Kapak Vibranium',  emoji: '🪓', type: 'axe', tier: 8,  bonus: 1000,  craftCost: { vibranium: 8, mithril: 2, wood: 45 } },
  axe_orichalcum: { id: 'axe_orichalcum', alias: 'kapak orichalcum', name: 'Kapak Orichalcum', emoji: '🪓', type: 'axe', tier: 9,  bonus: 2700,  craftCost: { orichalcum: 8, vibranium: 2, wood: 50 } },
  axe_aetherium:  { id: 'axe_aetherium',  alias: 'kapak aetherium',  name: 'Kapak Aetherium',  emoji: '🪓', type: 'axe', tier: 10, bonus: 7000,  craftCost: { aetherium: 8, orichalcum: 2, wood: 55 } },
  axe_dark_matter:{ id: 'axe_dark_matter', alias: 'kapak dark matter', name: 'Kapak Dark Matter', emoji: '🪓', type: 'axe', tier: 11, bonus: 18000, craftCost: { dark_matter: 8, aetherium: 2, wood: 60 } },
  axe_celestial:  { id: 'axe_celestial',  alias: 'kapak celestial',  name: 'Kapak Celestial',  emoji: '🪓', type: 'axe', tier: 12, bonus: 48000, craftCost: { celestial_core: 8, dark_matter: 2, wood: 65 } },
  axe_dragon:     { id: 'axe_dragon',     alias: 'kapak naga',       name: 'Kapak Naga',       emoji: '🐲', type: 'axe', tier: 13, bonus: 120000, craftCost: { dragon_heart: 8, celestial_core: 2, wood: 70 } },
  axe_phoenix:    { id: 'axe_phoenix',    alias: 'kapak phoenix',    name: 'Kapak Phoenix',    emoji: '🦅', type: 'axe', tier: 14, bonus: 300000, craftCost: { phoenix_feather: 8, dragon_heart: 2, wood: 75 } },
  axe_star:       { id: 'axe_star',       alias: 'kapak bintang',    name: 'Kapak Bintang',    emoji: '🪓', type: 'axe', tier: 15, bonus: 800000, craftCost: { star_shatter: 8, phoenix_feather: 2, wood: 80 } },
  axe_void:       { id: 'axe_void',       alias: 'kapak void',       name: 'Kapak Void',       emoji: '🪓', type: 'axe', tier: 16, bonus: 1440000,  craftCost: { void_crown: 8, star_shatter: 2, wood: 85 } },
  axe_soul:       { id: 'axe_soul',       alias: 'kapak jiwa abadi', name: 'Kapak Jiwa Abadi', emoji: '🪓', type: 'axe', tier: 17, bonus: 2600000,  craftCost: { immortal_soul: 8, void_crown: 2, wood: 90 } },
  axe_time:       { id: 'axe_time',       alias: 'kapak waktu',      name: 'Kapak Waktu',      emoji: '🪓', type: 'axe', tier: 18, bonus: 4700000,  craftCost: { time_crystal: 8, immortal_soul: 2, wood: 95 } },
  axe_dimension:  { id: 'axe_dimension',  alias: 'kapak dimensi',    name: 'Kapak Dimensi',    emoji: '🪓', type: 'axe', tier: 19, bonus: 8400000,  craftCost: { dimension_essence: 8, time_crystal: 2, wood: 100 } },
  axe_cosmic:     { id: 'axe_cosmic',     alias: 'kapak kosmik',     name: 'Kapak Kosmik',     emoji: '🪓', type: 'axe', tier: 20, bonus: 15000000, craftCost: { cosmic_core: 8, dimension_essence: 2, wood: 105 } }
};

const ARMORS = {
  armor_stone:  { id: 'armor_stone',  alias: 'zirah batu',       name: 'Zirah Batu',       emoji: '🪨', def: 100,   tier: 2, craftCost: { stone: 30 } },
  armor_iron:   { id: 'armor_iron',   alias: 'zirah besi',       name: 'Zirah Besi',       emoji: '👕', def: 250,   tier: 3, craftCost: { iron: 40 } },
  armor_diamond: { id: 'armor_diamond', alias: 'zirah berlian',    name: 'Zirah Berlian',    emoji: '💠', def: 600,   tier: 4, craftCost: { diamond: 30, iron: 10 } },
  armor_adamantium: { id: 'armor_adamantium', alias: 'zirah adamantium', name: 'Zirah Adamantium', emoji: '🛡️', def: 1500,  tier: 5, craftCost: { adamantium: 25, diamond: 5 } },
  armor_uru:    { id: 'armor_uru',    alias: 'zirah uru',        name: 'Zirah Uru',        emoji: '🌌', def: 3500,  tier: 6, craftCost: { uru: 20, adamantium: 5 } },
  armor_mithril:    { id: 'armor_mithril',    alias: 'zirah mithril',    name: 'Zirah Mithril',    emoji: '✨', def: 8000,    tier: 7,  craftCost: { mithril: 25, uru: 5 } },
  armor_vibranium:  { id: 'armor_vibranium',  alias: 'zirah vibranium',  name: 'Zirah Vibranium',  emoji: '🔮', def: 18000,   tier: 8,  craftCost: { vibranium: 25, mithril: 5 } },
  armor_orichalcum: { id: 'armor_orichalcum', alias: 'zirah orichalcum', name: 'Zirah Orichalcum', emoji: '⚡', def: 42000,   tier: 9,  craftCost: { orichalcum: 25, vibranium: 5 } },
  armor_aetherium:  { id: 'armor_aetherium',  alias: 'zirah aetherium',  name: 'Zirah Aetherium',  emoji: '💫', def: 90000,   tier: 10, craftCost: { aetherium: 25, orichalcum: 5 } },
  armor_dark_matter:{ id: 'armor_dark_matter', alias: 'zirah dark matter', name: 'Zirah Dark Matter', emoji: '🕳️', def: 170000,  tier: 11, craftCost: { dark_matter: 25, aetherium: 5 } },
  armor_celestial:  { id: 'armor_celestial',  alias: 'zirah celestial',  name: 'Zirah Celestial',  emoji: '🌟', def: 240000,  tier: 12, craftCost: { celestial_core: 25, dark_matter: 5 } },
  armor_dragon:  { id: 'armor_dragon',  alias: 'zirah naga',  name: 'Zirah Naga',  emoji: '🐲', def: 340000,  tier: 13, craftCost: { dragon_heart: 25, celestial_core: 5 } },
  armor_phoenix: { id: 'armor_phoenix', alias: 'zirah phoenix', name: 'Zirah Phoenix', emoji: '🦅', def: 470000, tier: 14, craftCost: { phoenix_feather: 25, dragon_heart: 5 } },
  armor_star:    { id: 'armor_star',    alias: 'zirah bintang', name: 'Zirah Bintang',   emoji: '💫', def: 650000, tier: 15, craftCost: { star_shatter: 25, phoenix_feather: 5 } },
  armor_void:      { id: 'armor_void',      alias: 'zirah void',        name: 'Zirah Void',        emoji: '👑', def: 1170000, tier: 16, craftCost: { void_crown: 25, star_shatter: 5 } },
  armor_soul:      { id: 'armor_soul',      alias: 'zirah jiwa abadi',  name: 'Zirah Jiwa Abadi',  emoji: '👻', def: 2100000, tier: 17, craftCost: { immortal_soul: 25, void_crown: 5 } },
  armor_time:      { id: 'armor_time',      alias: 'zirah waktu',       name: 'Zirah Waktu',       emoji: '⏳', def: 3780000, tier: 18, craftCost: { time_crystal: 25, immortal_soul: 5 } },
  armor_dimension: { id: 'armor_dimension', alias: 'zirah dimensi',     name: 'Zirah Dimensi',     emoji: '🌀', def: 6800000, tier: 19, craftCost: { dimension_essence: 25, time_crystal: 5 } },
  armor_cosmic:    { id: 'armor_cosmic',    alias: 'zirah kosmik',      name: 'Zirah Kosmik',      emoji: '🌌', def: 12200000, tier: 20, craftCost: { cosmic_core: 25, dimension_essence: 5 } }
};

const SHOP_ITEMS = {
  apple:  { id: 'apple',  alias: 'apel',     name: 'Apel',           emoji: '🍎', price: 100,   effect: 'stamina', value: 30  },
  potion: { id: 'potion', alias: 'ramuan',   name: 'Ramuan Darah',    emoji: '🧪', price: 400,   effect: 'hp',      value: 25 },
  potion2:{ id: 'potion2',alias: 'ramuan+',  name: 'Ramuan Darah+',   emoji: '💊', price: 1500,  effect: 'hp',      value: 50 },
  bread:  { id: 'bread',  alias: 'roti',     name: 'Roti',            emoji: '🍞', price: 250,   effect: 'stamina', value: 60  },
};

// ─── KELAS (6 kelas, pilih gratis saat pertama, ganti berbayar) ──
const CLASSES = {
  fighter: { id: 'fighter', name: 'Petarung',  emoji: '⚔️', desc: 'Bonus ATK +20%',                atkBonus: 0.20, skills: ['tebasan', 'badai_pedang'] },
  miner:   { id: 'miner',   name: 'Penambang', emoji: '⛏️', desc: 'Hasil tambang +50%, ATK +5%', mineBonus: 0.50, atkBonus: 0.05, skills: ['guncang_tanah', 'runtuhan'] },
  hunter:  { id: 'hunter',  name: 'Pemburu',   emoji: '🏹', desc: 'Crit +10%, ATK +10%',          critBonus: 0.10, atkBonus: 0.10, skills: ['panah_cepat', 'bidikan_tepat'] },
  mage:    { id: 'mage',    name: 'Penyihir',  emoji: '🔮', desc: 'ATK +15%, skill +30% dmg',     atkBonus: 0.15, skillPower: 1.30, skills: ['peluru_sihir', 'meteor'] },
  healer:  { id: 'healer',  name: 'Penyembuh', emoji: '💚', desc: 'Heal +50%, ATK +5%',           healBonus: 0.50, atkBonus: 0.05, skills: ['sentuhan_sembuh', 'berkah_kehidupan'] },
  thief:   { id: 'thief',   name: 'Perampok',  emoji: '🗡️', desc: 'Reward +25%, Crit +5%',       rewardBonus: 0.25, critBonus: 0.05, skills: ['bacokan_liar', 'jarum_pembunuh'] },
};

// ─── SKILL AKTIF (2 per kelas) ──
// type: damage | heal. cooldown = jumlah giliran tunggu setelah dipakai (0 = siap).
const SKILLS = {
  tebasan:         { id: 'tebasan',         name: 'Tebasan',           emoji: '🗡️', type: 'damage', power: 1.6, cooldown: 2, desc: 'Damage 160% ATK' },
  badai_pedang:    { id: 'badai_pedang',    name: 'Badai Pedang',      emoji: '🌪️', type: 'damage', power: 2.6, cooldown: 4, desc: 'Damage 260% ATK' },
  guncang_tanah:   { id: 'guncang_tanah',   name: 'Guncang Tanah',     emoji: '⛏️', type: 'damage', power: 1.4, cooldown: 2, desc: 'Damage 140% ATK' },
  runtuhan:        { id: 'runtuhan',        name: 'Runtuhan Batu',     emoji: '🪨', type: 'damage', power: 2.4, cooldown: 4, desc: 'Damage 240% ATK' },
  panah_cepat:     { id: 'panah_cepat',     name: 'Panah Cepat',       emoji: '🏹', type: 'damage', power: 1.7, cooldown: 2, desc: 'Damage 170% ATK (crit+5%)' },
  bidikan_tepat:   { id: 'bidikan_tepat',   name: 'Bidikan Tepat',     emoji: '🎯', type: 'damage', power: 2.8, cooldown: 4, desc: 'Damage 280% ATK (crit+10%)' },
  peluru_sihir:    { id: 'peluru_sihir',    name: 'Peluru Sihir',      emoji: '✨', type: 'damage', power: 1.8, cooldown: 2, desc: 'Damage 180% ATK' },
  meteor:          { id: 'meteor',          name: 'Meteor',            emoji: '☄️', type: 'damage', power: 3.0, cooldown: 4, desc: 'Damage 300% ATK' },
  sentuhan_sembuh: { id: 'sentuhan_sembuh', name: 'Sentuhan Sembuh',   emoji: '💗', type: 'heal',   power: 0.20, cooldown: 2, desc: 'Pulihkan 20% MaxHP' },
  berkah_kehidupan:{ id: 'berkah_kehidupan', name: 'Berkah Kehidupan', emoji: '🌿', type: 'heal',   power: 0.45, cooldown: 4, desc: 'Pulihkan 45% MaxHP' },
  bacokan_liar:    { id: 'bacokan_liar',    name: 'Bacokan Liar',      emoji: '🗡️', type: 'damage', power: 1.5, cooldown: 2, desc: 'Damage 150% ATK' },
  jarum_pembunuh:  { id: 'jarum_pembunuh',  name: 'Jarum Pembunuh',    emoji: '🪓', type: 'damage', power: 2.5, cooldown: 4, desc: 'Damage 250% ATK' },
};

// Item raid untuk ganti kelas
const KONTRAK_KELAS = { id: 'kontrak_kelas', alias: 'kontrak', name: 'Kontrak Kelas', emoji: '📜' };

// ─── RAID BOSS (tier 13-15, sumber material endgame) ──
// Boss baris: HP besar (untuk 1-6 pemain), maks 12 ronde.
const RAID_BOSSES = {
  dragon:   { id: 'dragon',   name: 'Naga Kuno Api',  emoji: '🐲', level: 13, hp: 6200000, atk: 360000,  def: 180000,  drop: 'dragon_heart',   expReward: 15000, goldReward: 120000 },
  phoenix:  { id: 'phoenix',  name: 'Phoenix Legenda', emoji: '🦅', level: 14, hp: 11500000, atk: 580000, def: 260000, drop: 'phoenix_feather', expReward: 24000, goldReward: 200000 },
  star:     { id: 'star',     name: 'Bintang Jatuh',  emoji: '💫', level: 15, hp: 21000000, atk: 920000,  def: 380000,  drop: 'star_shatter',   expReward: 38000, goldReward: 330000 },
  // ─── RAID BOSS ENDGAME (tier 16-20) ──────────────────────
  void:     { id: 'void',     name: 'Penguasa Void',        emoji: '👾', level: 16, hp: 38000000,  atk: 1450000, def: 550000,  drop: 'void_crown',        expReward: 60000,  goldReward: 520000 },
  soul:     { id: 'soul',     name: 'Raja Jiwa Kelam',      emoji: '☠️', level: 17, hp: 68000000,  atk: 2300000, def: 800000,  drop: 'immortal_soul',     expReward: 95000,  goldReward: 820000 },
  time:     { id: 'time',     name: 'Penjaga Waktu',        emoji: '⏳', level: 18, hp: 120000000, atk: 3600000, def: 1200000, drop: 'time_crystal',      expReward: 150000, goldReward: 1300000 },
  dimension:{ id: 'dimension', name: 'Deva Pemecah Dimensi', emoji: '🧿', level: 19, hp: 210000000, atk: 5500000, def: 1750000, drop: 'dimension_essence', expReward: 240000, goldReward: 2100000 },
  cosmic:   { id: 'cosmic',   name: 'Pencipta Kosmik',      emoji: '👁️', level: 20, hp: 360000000, atk: 8500000, def: 2500000, drop: 'cosmic_core',       expReward: 380000, goldReward: 3300000 },
};

const RAID_MIN_PLAYERS = 1;
const RAID_MAX_PLAYERS = 6;
const RAID_MAX_ROUNDS  = 12;
const RAID_JOIN_WINDOW = 60 * 1000;    // 1 menit untuk join
const RAID_TURN_TIMEOUT = 60 * 1000;   // 60 detik per giliran

const LEVEL_EXP = [0, 0, 100, 250, 450, 700, 1020, 1420, 1920, 2550, 3300,
  4200, 5300, 6600, 8100, 9900, 12000, 14500, 17500, 21000, 25000];

const MAX_STAMINA  = 100;
const CHOP_COST    = 10;
const MINE_COST    = 12;
const STAMINA_REGEN_PER_HOUR = 20;
const DUEL_TIMEOUT  = 5 * 60 * 1000; // 5 menit
const DUEL_TURN_TIMEOUT = 60 * 1000; // 60 detik per giliran

// ─── RESOLVER NAMA (dukung ID Inggris + alias Indonesia) ──
function norm(q) { return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function matchEntry(input, entry) {
  const q = norm(input);
  if (!q || !entry) return false;
  return (
    norm(entry.id) === q ||
    norm(entry.alias) === q ||
    norm(entry.name) === q
  );
}

function resolveMaterialId(input) {
  const q = norm(input);
  if (!q) return null;
  const key = Object.keys(MATERIALS).find(k => norm(k) === q || matchEntry(q, MATERIALS[k]));
  return key || null;
}

function resolveShopItemId(input) {
  const q = norm(input);
  if (!q) return null;
  const key = Object.keys(SHOP_ITEMS).find(k => norm(k) === q || matchEntry(q, SHOP_ITEMS[k]));
  return key || null;
}

function resolveEquipmentId(input) {
  const q = norm(input);
  if (!q) return null;
  let key = Object.keys(WEAPONS).find(k => norm(k) === q || matchEntry(q, WEAPONS[k]));
  if (key) return key;
  key = Object.keys(ARMORS).find(k => norm(k) === q || matchEntry(q, ARMORS[k]));
  if (key) return key;
  key = Object.keys(TOOLS).find(k => norm(k) === q || matchEntry(q, TOOLS[k]));
  return key || null;
}

// Alias kategori menu tempa (kunci categoryMap lama + nama Indonesia)
const CATEGORY_ALIASES = {
  sword:    ['sword', 'pedang'],
  armor:    ['armor', 'zirah', 'baju'],
  axe:      ['axe', 'kapak'],
  pickaxe:  ['pickaxe', 'pick', 'cangkul', 'beliung'],
};

function resolveCategory(input) {
  const q = norm(input);
  if (!q) return null;
  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(q)) return cat;
  }
  return null;
}

// ─── RESOLVER KELAS & SKILL ──────────────────────────────
function resolveClassId(input) {
  const q = norm(input);
  if (!q) return null;
  const key = Object.keys(CLASSES).find(k => norm(k) === q || norm(CLASSES[k].name) === q || norm(CLASSES[k].emoji) === q);
  return key || null;
}

function resolveSkillId(input) {
  const q = norm(input);
  if (!q) return null;
  const key = Object.keys(SKILLS).find(k => norm(k) === q || norm(SKILLS[k].name) === q || norm(SKILLS[k].emoji) === q);
  return key || null;
}

module.exports = {
  MONSTERS, WEAPONS, ARMORS, TOOLS, SHOP_ITEMS, ESSENCE,
  CLASSES, SKILLS, KONTRAK_KELAS, RAID_BOSSES,
  RAID_MIN_PLAYERS, RAID_MAX_PLAYERS, RAID_MAX_ROUNDS,
  RAID_JOIN_WINDOW, RAID_TURN_TIMEOUT,
  LEVEL_EXP, MAX_STAMINA, CHOP_COST, MINE_COST,
  STAMINA_REGEN_PER_HOUR,
  DUEL_TIMEOUT, DUEL_TURN_TIMEOUT, MATERIALS,
  resolveMaterialId, resolveShopItemId, resolveEquipmentId, resolveCategory,
  resolveClassId, resolveSkillId,
};
