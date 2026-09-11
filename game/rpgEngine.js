// ============================================================
// RPG ENGINE
// ============================================================
const {
  WEAPONS, ARMORS, TOOLS, CLASSES,
  LEVEL_EXP, MAX_STAMINA, STAMINA_REGEN_PER_HOUR,
} = require('../data/rpgData');

// ─── LEVEL / EXP ─────────────────────────────────────────
function getLevelFromExp(exp) {
  let level = 1;
  for (let i = LEVEL_EXP.length - 1; i >= 1; i--) {
    if (exp >= LEVEL_EXP[i]) { level = i; break; }
  }
  return Math.min(level, 20);
}

function getExpForNextLevel(level) {
  const next = level + 1;
  if (next >= LEVEL_EXP.length) return Infinity;
  return LEVEL_EXP[next];
}

// ─── STAMINA ─────────────────────────────────────────────
function getRegenedStamina(player) {
  const now      = Date.now();
  const elapsed  = now - (player.lastStaminaRegen || now);
  const hours    = elapsed / (60 * 60 * 1000);
  const regened  = Math.floor(hours * STAMINA_REGEN_PER_HOUR);
  return Math.min(MAX_STAMINA, player.stamina + regened);
}

// ─── PLAYER STATS ────────────────────────────────────────
// Stat tempur dari equipment + bonus kelas. Level hanya untuk tampilan & gate monster.
function getPlayerStats(player) {
  const weapon = player.equippedWeapon ? WEAPONS[player.equippedWeapon] : null;
  const armor  = player.equippedArmor  ? ARMORS[player.equippedArmor]  : null;
  const weaponTier = weapon?.tier || 0;
  const armorTier  = armor?.tier  || 0;
  const cls = player.class ? CLASSES[player.class] : null;
  const atkBonus = cls?.atkBonus || 0;
  const critBonus = cls?.critBonus || 0;
  const rewardBonus = cls?.rewardBonus || 0;
  return {
    level: getLevelFromExp(player.exp),
    atk:   Math.floor((300 + (weapon?.atk || 0) * 4) * (1 + atkBonus)),
    def:   (armor?.def || 0) * 2,
    maxHp: 2500 + (armor?.def || 0) * 8,
    critChance:   Math.min(0.45, 0.03 + weaponTier * 0.025 + critBonus),
    blockChance:  Math.min(0.40, 0.03 + armorTier * 0.025),
    rewardMult:   Math.min(1.5, 1 + weaponTier * 0.1 + rewardBonus),
    skillPower:   cls?.skillPower || 1,
    healBonus:    cls?.healBonus || 0,
    mineBonus:    cls?.mineBonus || 0,
    className:    cls?.name || 'Tanpa Kelas',
    classEmoji:   cls?.emoji || '🎭',
  };
}

// ─── SKILL ───────────────────────────────────────────────
// Hasilkan aksi skill: damage (hit lawan) atau heal (pulihkan pemakai).
// opts: { skill, userStats, targetStats } — mengembalikan hasil action.
function applySkill(skill, userStats, targetStats = null) {
  const power = (skill.power || 1) * (userStats.skillPower || 1);
  if (skill.type === 'heal') {
    const heal = Math.floor(userStats.maxHp * power * (1 + (userStats.healBonus || 0)));
    return { dmg: 0, heal };
  }
  const boostCrit = skill.id === 'panah_cepat' ? 0.05 : skill.id === 'bidikan_tepat' ? 0.10 : 0;
  const res = calcDamage(Math.floor(userStats.atk * power), targetStats?.def || 0, {
    critChance: Math.min(0.8, userStats.critChance + boostCrit),
    blockChance: 0,
  });
  res.heal = 0;
  res.skillId = skill.id;
  res.skillName = `${skill.emoji || ''} ${skill.name}`;
  return res;
}

// ─── BATTLE ──────────────────────────────────────────────
function calcDamage(atk, def, opts = {}) {
  const floor  = Math.max(1, Math.floor(atk * 0.10));
  const raw    = Math.max(floor, atk - Math.floor(def * 0.5));
  const spread = Math.floor(raw * 0.25);
  const critChance  = opts.critChance  ?? 0.12;
  const blockChance = opts.blockChance ?? 0;
  const blocked = blockChance > 0 && Math.random() < blockChance;
  const crit    = Math.random() < critChance;
  let dmg       = raw - spread + Math.floor(Math.random() * (spread * 2 + 1));
  if (blocked) dmg = Math.floor(dmg * 0.5);
  if (crit) dmg = Math.floor(dmg * 1.5);
  return { dmg: Math.max(1, dmg), crit, blocked };
}

function makeHpBar(current, max) {
  const pct    = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(pct * 10);
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${current}/${max}`;
}

// ─── GATHERING ───────────────────────────────────────────
function chopWood(player) {
  const axe     = player.equippedAxe ? TOOLS[player.equippedAxe] : null;
  const axeTier = axe ? axe.tier : 0;
  const mineBonus = player.class === 'miner' ? 1.5 : 1;
  const amount  = Math.max(1, Math.floor((2 + axeTier * 1.2 + Math.random() * (2 + axeTier)) * mineBonus));
  return amount;
}

// ─── TABEL TAMBANG (chance terpadu) ──────────────────────
// chance = base + max(0, cangkulTier − materialTier) × bonus
// Gate: cangkul tier P bisa menambang material M jika P ≥ M − 2.
// Menengah ke bawah (≤ T6) mudah; menengah ke atas (T7+) langka:
// jalur utama endgame = esensi boss (mining fallback).
const MINE_TABLE = {
  iron:           { tier: 3,  gate: 1,  base: 13,   bonus: 3.5 },
  gold_ingot:     { tier: 4,  gate: 2,  base: 12,   bonus: 3.2 },
  diamond:        { tier: 4,  gate: 2,  base: 11,   bonus: 2.8 },
  adamantium:     { tier: 5,  gate: 3,  base: 11,   bonus: 2.6 },
  uru:            { tier: 6,  gate: 4,  base: 10,   bonus: 2.4 },
  mithril:        { tier: 7,  gate: 5,  base: 4,    bonus: 1.2 },
  vibranium:      { tier: 8,  gate: 6,  base: 3,    bonus: 0.9 },
  orichalcum:     { tier: 9,  gate: 7,  base: 2.2,  bonus: 0.6 },
  aetherium:      { tier: 10, gate: 8,  base: 1.2,  bonus: 0.35 },
  dark_matter:    { tier: 11, gate: 9,  base: 0.5,  bonus: 0.15 },
  celestial_core: { tier: 12, gate: 10, base: 0.03, bonus: 0.05 },
};

// Jumlah hasil tambang per material (skala tier cangkul)
const MINE_AMOUNTS = {
  iron:           t => Math.max(1, Math.floor(1 + t * 0.8 + Math.random() * (1 + t * 0.8))),
  gold_ingot:     t => Math.max(1, Math.floor(1 + t * 0.6 + Math.random() * (1 + t * 0.6))),
  diamond:        t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.6))),
  adamantium:     t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.5))),
  uru:            t => Math.floor(0.5 + Math.random() * (1 + t * 0.3)),
  mithril:        t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.5))),
  vibranium:      t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.5))),
  orichalcum:     t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.4))),
  aetherium:      t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.4))),
  dark_matter:    t => Math.max(1, Math.floor(1 + Math.random() * (1 + t * 0.3))),
  celestial_core: t => Math.floor(0.5 + Math.random() * (1 + t * 0.2)),
};

function mining(player) {
  const pick  = player.equippedPickaxe ? TOOLS[player.equippedPickaxe] : null;
  const tier  = pick ? pick.tier : 0;
  const mineBonus = player.class === 'miner' ? 1.5 : 1;

  const yields = {};

  // Batu: selalu didapat, jumlah tergantung tier cangkul (minimal 1)
  yields.stone = Math.max(1, Math.floor((1 + tier * 1.2 + Math.random() * (2 + tier)) * mineBonus));

  // Chance & jumlah material dari tabel terpadu (base + bonus per tier di atas)
  for (const [mat, spec] of Object.entries(MINE_TABLE)) {
    if (tier < spec.gate) continue;
    const chance = spec.base + Math.max(0, tier - spec.tier) * spec.bonus;
    if (Math.random() * 100 < chance) yields[mat] = Math.max(1, Math.floor(MINE_AMOUNTS[mat](tier) * mineBonus));
  }

  return yields;
}


function formatNum(n) {
  return new Intl.NumberFormat('id-ID').format(n);
}

module.exports = {
  getLevelFromExp, getExpForNextLevel,
  getRegenedStamina, getPlayerStats,
  calcDamage, makeHpBar, applySkill,
  chopWood, mining, formatNum,
  MINE_TABLE,
};
