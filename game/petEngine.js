// game/petEngine.js
// Engine murni fitur Pet: menghitung stat dari base+level+stage, exp ikan,
// pertumbuhan (level up) + evolusi bersyarat (level & ikan tier tinggi),
// serta kerusakan battle.
const { STAGE_MULT, nextFishTierRequirement, getEvoReq } = require('../data/petData');

// HP/ATK/DEF/SPD = base × (1 + level×0.08) × pengali stage
function getPetStats(pet) {
  const spec = require('../data/petData').PET_SPECIES[pet.species];
  const base = spec ? spec.base : { hp: 80, atk: 12, def: 8, spd: 8 };
  const mult = STAGE_MULT[Math.max(0, Math.min(pet.stage - 1, STAGE_MULT.length - 1))];
  const scale = 1 + pet.level * 0.08;
  return {
    maxHp: Math.round(base.hp * scale * mult),
    atk:   Math.round(base.atk * scale * mult),
    def:   Math.round(base.def * scale * mult),
    spd:   Math.round(base.spd * scale * mult),
  };
}

// Exp yang dibutuhkan untuk naik dari level l ke l+1
function expNeeded(level) {
  return level * 60;
}

// Exp ikan: makin tinggi tier & makin berat = makin besar
function fishExp(tier, weight) {
  return tier * 25 + Math.round(weight || 0);
}

// Tandai evoReqMet bila ikan tier cukup untuk evolusi stage berikutnya
function feedFish(pet, fishTier) {
  const required = nextFishTierRequirement(pet.stage);
  if (required !== null && fishTier >= required) {
    pet.evoReqMet = true;
    return true;
  }
  return false;
}

// Naikkan level sebanyak mungkin dari sebuah jumlah exp. Return info.
function applyExp(pet, amount) {
  let levels = 0;
  pet.exp += amount;
  while (pet.exp >= expNeeded(pet.level)) {
    pet.exp -= expNeeded(pet.level);
    pet.level++;
    levels++;
  }
  return { levelUpCount: levels };
}

// Coba evolusi pet. Kembalikan hasil/penolakan.
// stage1→2: level 10 + ikan tier≥6; stage2→3: level 20 + tier≥10;
// stage3→4: level 30 + tier≥12. Syarat ikan dikonsumsi saat evolusi.
function tryEvolve(pet) {
  const req = getEvoReq(pet.stage);
  if (!req) return { can: false, maxStage: true }; // sudah maksimal
  if (pet.level < req.level) {
    return { can: false, reason: `Level masih ${pet.level}, butuh level *${req.level}*` };
  }
  if (!pet.evoReqMet) {
    return { can: false, reason: `Pet harus makan ikan tier ≥${req.fishTier} duluan` };
  }
  pet.stage++;
  pet.evoReqMet = false; // syarat ikan dipakai untuk evolusi ini
  return { can: true, newStage: pet.stage };
}

// Damage: max(1, atk - def×0.5) × acak(0.85..1.15); crit 15% ×1.8
function computeDamage(atk, def, opts = {}) {
  const isCrit = opts.forceCrit !== undefined ? opts.forceCrit : Math.random() < 0.15;
  const base   = Math.max(1, atk - def * 0.5);
  const roll   = base * (0.85 + Math.random() * 0.3);
  return { damage: Math.round(roll * (isCrit ? 1.8 : 1)), crit: isCrit };
}

// ─── Self-check kecil (jalankan: node game/petEngine.js) ───
if (require.main === module) {
  const assert = require('assert');
  const { PET_SPECIES } = require('../data/petData');

  // ikan tier 6 memenuhi syarat stage1, tier 5 tidak
  const pet = { species: 'api', level: 10, exp: 0, stage: 1, evoReqMet: false };
  assert.strictEqual(feedFish({ ...pet }, 5), false);
  assert.strictEqual(feedFish({ ...pet }, 6), true);
  assert.strictEqual(feedFish({ ...pet }, 11), true);

  // evolusi stage1→2 sukses, syarat ikan dikonsumsi
  const p2 = { ...pet, evoReqMet: true };
  const r2 = tryEvolve(p2);
  assert.ok(r2.can && p2.stage === 2 && p2.evoReqMet === false);

  // tanpa makan ikan tinggi → ditolak
  const p3 = { ...pet, evoReqMet: false };
  assert.strictEqual(tryEvolve(p3).can, false);

  // level kurang → ditolak walau sudah makan ikan
  const p4 = { species: 'api', level: 9, exp: 0, stage: 1, evoReqMet: true };
  assert.strictEqual(tryEvolve(p4).can, false);

  // stage sudah max
  const pm = { ...pet, stage: 4, evoReqMet: true };
  assert.strictEqual(tryEvolve(pm).can, false);

  // level up + syarat tier 10 utk stage2
  const pk = { species: 'kilat', level: 20, exp: 0, stage: 2, evoReqMet: true };
  assert.strictEqual(feedFish(pk, 10), true);
  assert.ok(tryEvolve(pk).can && pk.stage === 3);

  // stat naik seiring level/stage
  const s1 = getPetStats({ species: 'api', level: 1, stage: 1 });
  const s4 = getPetStats({ species: 'api', level: 30, stage: 4 });
  assert.ok(s4.atk > s1.atk && s4.maxHp > s1.maxHp);

  // damage selalu >= 1, crit x1.8
  const d = computeDamage(50, 10, { forceCrit: true });
  assert.ok(d.damage > 0);

  console.log('✅ petEngine self-check lulus');
}

module.exports = {
  getPetStats,
  expNeeded,
  fishExp,
  feedFish,
  applyExp,
  tryEvolve,
  computeDamage,
};