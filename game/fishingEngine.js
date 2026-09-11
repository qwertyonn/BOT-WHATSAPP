// ============================================================
// FISHING ENGINE
// ============================================================
const { TIERS, LOCATIONS, ALL_FISH, RODS, BAITS } = require('../data/gameData');


function getRodBonus(rodId) {
  const rod = RODS.find(r => r.id === rodId);
  return rod ? rod.bonus : 0;
}

function getBaitBonus(baitId) {
  const bait = BAITS.find(b => b.id === baitId);
  return bait ? bait.bonus : 0;
}

const MIN_ZONK = 5;
const ZONK_REDUCT_PER_BAIT = 1.0;    // 1 poin bonus bait -> -1 poin zonk
const LAMBDA_BASE = 0.85;
const LAMBDA_PER_RARITY = 0.015;     // rarityBonus lokasi melandai kurva decay
const LAMBDA_PER_ROD = 0.0015;       // 1 poin bonus rod -> lambda mengecil (geser ke tier tinggi)
const LAMBDA_MIN = 0.15;

// Roll tier murni formula: zonk = atribut lokasi dikurangi bonus bait,
// distribusi tier = decay eksponensial yang dilandai rarityBonus & digeser bonus rod.
function rollTier(location, rodBonus = 0, baitBonus = 0) {
  const loc = LOCATIONS[location];
  if (!loc) return 1;

  // 1. ZONK — per lokasi, berkurang oleh bonus bait (anti-gagal); lokasi zonk 0 tidak pernah zonk
  const zonk = (loc.zonk || 0) === 0
    ? 0
    : Math.max(MIN_ZONK, (loc.zonk || 0) - baitBonus * ZONK_REDUCT_PER_BAIT);
  if (Math.random() * 100 < zonk) return null;

  // 2. TIER — decay eksponensial seragam
  const lambda = Math.max(LAMBDA_MIN,
    LAMBDA_BASE - loc.rarityBonus * LAMBDA_PER_RARITY - rodBonus * LAMBDA_PER_ROD);

  const pool = [];
  let total = 0;
  for (let t = loc.minTier; t <= loc.maxTier; t++) {
    const w = Math.exp(-lambda * (t - loc.minTier));
    pool.push({ tier: t, w });
    total += w;
  }

  let roll = Math.random() * total;
  for (const { tier, w } of pool) {
    roll -= w;
    if (roll <= 0) return tier;
  }
  return loc.minTier;
}

function pickFish(tier) {
  const fishPool = ALL_FISH.filter(f => f.tier === tier);
  if (fishPool.length === 0) {
    const fallback = ALL_FISH.filter(f => f.tier === 1);
    if (!fallback.length) return null;
    return generateFishStats(fallback[Math.floor(Math.random() * fallback.length)], 1);
  }
  const selected = fishPool[Math.floor(Math.random() * fishPool.length)];
  return generateFishStats(selected, tier);
}

function generateFishStats(fish, tier) {
  const weight = parseFloat(
    (fish.minWeight + Math.random() * (fish.maxWeight - fish.minWeight)).toFixed(2)
  );
  // Harga estimasi mengikuti harga jual nyata (!fishit jual / FISH_SELL_TIERS)
  const price = Math.floor(weight * (FISH_SELL_TIERS[tier] || 10));
  return { name: fish.name, tier, weight, price, tierInfo: TIERS[tier] };
}

function formatWeight(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} ton`;
  if (kg >= 1)    return `${kg.toFixed(2)} kg`;
  return `${(kg * 1000).toFixed(0)} gram`;
}

function formatGold(amount) {
  return new Intl.NumberFormat('id-ID').format(amount) + ' Money';
}

function getFishingDelay() { return 5000; }

const FISHING_COOLDOWN = 0;

// Harga jual per kg per tier — dipakai oleh !fishit jual DAN casino (nilai taruhan ikan)
// Kurva "nilai per ekor" tertambat ke harga jual material RPG tier sama:
//   nilai/ekor ≈ bobotRataRata tier × pengali = material sellPrice tier (kayu 100 → celestial_core 10jt)
// Tier 4 pakai kurva Emas (5.800) agar joran/umpan di sekitarnya konsisten.
const FISH_SELL_TIERS = { 1:192, 2:152, 3:202, 4:264, 5:813, 6:337, 7:240, 8:223, 9:73, 10:1.3, 11:0.34, 12:0.29 };

// Harga per ekor dari stack inventory { count, weight, tier }
function fishUnitPrice(data) {
  if (!data || !data.count || data.count <= 0) return 0;
  const mult       = FISH_SELL_TIERS[data.tier] || 10;
  const avgWeight  = data.weight / data.count;
  return Math.floor(avgWeight * mult);
}

module.exports = {
  getRodBonus, getBaitBonus, rollTier, pickFish,
  formatWeight, formatGold, getFishingDelay, FISHING_COOLDOWN,
  FISH_SELL_TIERS, fishUnitPrice,
};
