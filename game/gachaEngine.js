// ============================================================
// GACHA ENGINE
// Logika murni (tanpa socket/UI): roll rarity + pity, pilih hadiah.
// Pemberian hadiah ke pemain dilakukan di handler (perlu akses db).
// Self-check: node game/gachaEngine.js
// ============================================================
const { GACHA_PITY, RARITIES, GACHA_POOL } = require('../data/gachaData');

// Roll satu rarity. `pity` = jumlah tarikan berturut-turut tanpa
// Legendary. Bila sudah GACHA_PITY - 1 (berarti tarikan ke-GACHA_PITY)
// → dipaksa Legendary.
function rollRarity(pity = 0) {
  if (pity >= GACHA_PITY - 1) return 'legendary';
  let roll = Math.random() * 100;
  for (const r of RARITIES) {
    roll -= r.chance;
    if (roll <= 0) return r.id;
  }
  return RARITIES[RARITIES.length - 1].id;
}

// Pilih satu hadiah acak dari pool rarity (bobot).
function pickReward(rarity) {
  const pool = GACHA_POOL[rarity] || GACHA_POOL.common;
  let total = pool.reduce((s, e) => s + (e.weight || 1), 0);
  let roll = Math.random() * total;
  for (const entry of pool) {
    roll -= (entry.weight || 1);
    if (roll <= 0) return entry.reward;
  }
  return pool[pool.length - 1].reward;
}

// Nilai money acak dalam rentang reward money.
function moneyAmount(reward) {
  const min = reward.min || 0;
  const max = reward.max || min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Rarity metadata dari id.
function rarityInfo(id) {
  return RARITIES.find(r => r.id === id) || RARITIES[0];
}

module.exports = { rollRarity, pickReward, moneyAmount, rarityInfo };

// ─── SELF-CHECK ───────────────────────────────────────────
if (require.main === module) {
  // 1. Pity memaksa legendary
  let forced = rollRarity(GACHA_PITY - 1);
  if (forced !== 'legendary') {
    console.error(`❌ pity ${GACHA_PITY - 1} harus legendary, dapat ${forced}`);
    process.exit(1);
  }

  // 2. Distribusi masuk akal (50k roll, pity 0)
  const counts = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
  for (let i = 0; i < 50000; i++) counts[rollRarity(0)]++;
  const lRate = counts.legendary / 50000;
  const mRate = counts.mythic / 50000;
  if (lRate < 0.01 || lRate > 0.035) {
    console.error(`❌ rate legendary di luar 1-3.5%: ${(lRate * 100).toFixed(2)}%`);
    process.exit(1);
  }
  if (mRate < 0.005 || mRate > 0.02) {
    console.error(`❌ rate mythic di luar 0.5-2%: ${(mRate * 100).toFixed(2)}%`);
    process.exit(1);
  }
  console.log(`  dist: ${JSON.stringify(counts)} (L ${(lRate * 100).toFixed(2)}%, M ${(mRate * 100).toFixed(2)}%)`);

  // 3. Semua reward punya shape valid
  for (const [rarity, entries] of Object.entries(GACHA_POOL)) {
    for (const e of entries) {
      const r = e.reward;
      if (!r || !r.type) { console.error(`❌ ${rarity}: reward tanpa type`); process.exit(1); }
      if (r.type === 'material' && !r.id) { console.error(`❌ ${rarity}: material tanpa id`); process.exit(1); }
    }
  }

  // 4. pickReward selalu menghasilkan hadiah valid
  for (const rarity of Object.keys(GACHA_POOL)) {
    for (let i = 0; i < 1000; i++) {
      const r = pickReward(rarity);
      if (!r || !r.type) { console.error(`❌ ${rarity}: pickReward kosong`); process.exit(1); }
    }
  }

  console.log('✅ gachaEngine.js OK — pity, distribusi, pool valid');
}
