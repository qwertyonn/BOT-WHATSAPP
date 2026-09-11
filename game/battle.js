// ============================================================
// BATTLE ENGINE - Pokemon (Team Battle System)
// ============================================================
const { RARITY_EMOJI } = require('../data/pokemon');

const TYPE_CHART = {
  Fire:     { Grass: 2, Ice: 2, Bug: 2, Steel: 2, Water: 0.5, Rock: 0.5, Fire: 0.5, Dragon: 0.5 },
  Water:    { Fire: 2, Ground: 2, Rock: 2, Water: 0.5, Grass: 0.5, Dragon: 0.5 },
  Grass:    { Water: 2, Ground: 2, Rock: 2, Fire: 0.5, Poison: 0.5, Flying: 0.5, Bug: 0.5, Steel: 0.5, Grass: 0.5, Dragon: 0.5 },
  Electric: { Water: 2, Flying: 2, Ground: 0, Electric: 0.5, Grass: 0.5, Dragon: 0.5 },
  Ice:      { Grass: 2, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5, Water: 0.5, Ice: 0.5, Fire: 0.5 },
  Fighting: { Normal: 2, Rock: 2, Steel: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5 },
  Poison:   { Grass: 2, Fairy: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
  Ground:   { Fire: 2, Electric: 2, Poison: 2, Rock: 2, Steel: 2, Grass: 0.5, Bug: 0.5, Flying: 0 },
  Flying:   { Grass: 2, Fighting: 2, Bug: 2, Electric: 0.5, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Steel: 0.5, Psychic: 0.5, Dark: 0 },
  Bug:      { Grass: 2, Psychic: 2, Dark: 2, Fire: 0.5, Fighting: 0.5, Flying: 0.5, Ghost: 0.5, Steel: 0.5, Fairy: 0.5 },
  Rock:     { Fire: 2, Ice: 2, Flying: 2, Bug: 2, Fighting: 0.5, Ground: 0.5, Steel: 0.5 },
  Ghost:    { Psychic: 2, Ghost: 2, Normal: 0, Dark: 0.5 },
  Dragon:   { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Steel:    { Ice: 2, Rock: 2, Fairy: 2, Fire: 0.5, Water: 0.5, Electric: 0.5, Steel: 0.5 },
  Fairy:    { Fighting: 2, Dragon: 2, Dark: 2, Poison: 0.5, Steel: 0.5, Fire: 0.5 },
  Normal:   { Rock: 0.5, Steel: 0.5, Ghost: 0 },
  Dark:     { Psychic: 2, Ghost: 2, Fighting: 0.5, Dark: 0.5, Fairy: 0.5 },
};

function getTypeMultiplier(attackerTypes, defenderTypes) {
  let multiplier = 1;
  for (const atkType of attackerTypes) {
    for (const defType of defenderTypes) {
      if (TYPE_CHART[atkType] && TYPE_CHART[atkType][defType] !== undefined) {
        multiplier *= TYPE_CHART[atkType][defType];
      }
    }
  }
  return multiplier;
}

function getLevelBonus(level) { return 1 + (level - 1) * 0.05; }

function calculateDamage(attacker, defender, attackerLevel = 1) {
  const base       = attacker.attack;
  const def        = Math.max(1, defender.defense);
  const levelBonus = getLevelBonus(attackerLevel);
  const typeMult   = getTypeMultiplier(attacker.type, defender.type);
  const critChance = Math.random() < 0.1;
  const critMult   = critChance ? 1.5 : 1;
  const randomMult = 0.85 + Math.random() * 0.15;
  const damage = Math.max(1, Math.round((base / def) * 20 * levelBonus * typeMult * critMult * randomMult));
  return { damage, typeMult, crit: critChance };
}

function getEffectivenessText(mult) {
  if (mult >= 2)  return '⚡ Super efektif!';
  if (mult === 0) return '❌ Tidak berpengaruh!';
  if (mult < 1)   return '😐 Kurang efektif...';
  return '';
}

function makeHpBar(current, max) {
  const pct    = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(pct * 10);
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
}

function formatPokemonStats(pokemon, level = 1, currentHp = null) {
  const hp     = currentHp !== null ? currentHp : pokemon.hp;
  const maxHp  = pokemon.hp;
  const hpBar  = makeHpBar(hp, maxHp);
  const rarity = RARITY_EMOJI[pokemon.rarity] || '⚪';
  return [
    `${pokemon.emoji} *${pokemon.name}* ${rarity}`,
    `Tipe: ${pokemon.type.join('/')}`,
    `❤️ HP: ${hp}/${maxHp} ${hpBar}`,
    `⚔️ ATK: ${pokemon.attack} | 🛡️ DEF: ${pokemon.defense} | 💨 SPD: ${pokemon.speed}`,
    `🎓 Level: ${level}`,
  ].join('\n');
}

// ─── Helper: cari pokemon aktif yang masih hidup di tim ──
// teamSlots: array of { pokemon, currentHp, slotIndex }
// currentSlot: index slot yang sekarang aktif
// returns: slotIndex berikutnya yang masih hidup, atau -1 jika semua mati
function getNextAliveSlot(teamSlots, currentSlot) {
  for (let i = 0; i < teamSlots.length; i++) {
    if (i !== currentSlot && teamSlots[i].currentHp > 0) return i;
  }
  return -1;
}

function isTeamAllFainted(teamSlots) {
  return teamSlots.every(s => s.currentHp <= 0);
}

// ─── PvP Battle (Team) ───────────────────────────────────
// teamSlots: [ { pokemon, currentHp, level, slotIndex } ]
function buildTeamSlots(teamIds, collection, level) {
  return teamIds.map((id, i) => {
    const p = collection.find(pk => pk.id === id);
    if (!p) return null;
    return { pokemon: { ...p }, currentHp: p.hp, level, slotIndex: i };
  }).filter(Boolean);
}

function createBattleState(challenger, challengerTeamSlots, defender, defenderTeamSlots) {
  return {
    challenger: {
      userId: challenger,
      teamSlots: challengerTeamSlots,
      activeSlot: 0,
    },
    defender: {
      userId: defender,
      teamSlots: defenderTeamSlots,
      activeSlot: 0,
    },
    turn: 'challenger',
    log: [],
    status: 'waiting',
    createdAt: Date.now(),
  };
}

// Manggil executeTurn dari luar (pokemonCommands)
// Returns { battle, switchInfo }
// switchInfo: null | { side: 'challenger'|'defender', oldName, newName, newEmoji }
function executeTurn(battle) {
  const attackerSide = battle.turn === 'challenger' ? battle.challenger : battle.defender;
  const targetSide   = battle.turn === 'challenger' ? battle.defender   : battle.challenger;
  const nextTurn     = battle.turn === 'challenger' ? 'defender'        : 'challenger';

  const attacker = attackerSide.teamSlots[attackerSide.activeSlot];
  const target   = targetSide.teamSlots[targetSide.activeSlot];

  const { damage, typeMult, crit } = calculateDamage(attacker.pokemon, target.pokemon, attacker.level);
  target.currentHp = Math.max(0, target.currentHp - damage);

  const lines = [];
  lines.push(`${attacker.pokemon.emoji} *${attacker.pokemon.name}* menyerang!`);
  lines.push(`💥 Damage: *${damage}*${crit ? ' ✨ KRITIK!' : ''}`);
  const effText = getEffectivenessText(typeMult);
  if (effText) lines.push(effText);
  lines.push(`❤️ HP ${target.pokemon.name}: ${target.currentHp}/${target.pokemon.hp} ${makeHpBar(target.currentHp, target.pokemon.hp)}`);

  battle.log.push(lines.join('\n'));
  battle.turn = nextTurn;

  let switchInfo = null;

  // Cek apakah pokemon target pingsan
  if (target.currentHp <= 0) {
    lines.push(`\n💀 *${target.pokemon.name}* pingsan!`);

    if (isTeamAllFainted(targetSide.teamSlots)) {
      // Seluruh tim lawan habis — selesai
      battle.status = 'finished';
      battle.winner = attackerSide.userId;
      battle.loser  = targetSide.userId;
    } else {
      // Auto-switch ke pokemon hidup berikutnya
      const nextSlot = getNextAliveSlot(targetSide.teamSlots, targetSide.activeSlot);
      const oldName  = target.pokemon.name;
      targetSide.activeSlot = nextSlot;
      const newPokemon = targetSide.teamSlots[nextSlot].pokemon;
      lines.push(`🔄 *${newPokemon.name}* ${newPokemon.emoji} masuk menggantikan!`);
      switchInfo = {
        side: battle.turn === 'challenger' ? 'challenger' : 'defender', // sisi yang baru diganti (sudah swap turn)
        oldName,
        newName: newPokemon.name,
        newEmoji: newPokemon.emoji,
      };
    }
    // Update log terakhir dengan baris switch
    battle.log[battle.log.length - 1] = lines.join('\n');
  }

  return { battle, switchInfo };
}

// ─── Wild Battle (Team) ──────────────────────────────────
function createWildBattleState(userId, playerTeamSlots, wildPokemon, groupId) {
  return {
    userId,
    groupId,
    player: {
      teamSlots: playerTeamSlots,
      activeSlot: 0,
    },
    wild: { pokemon: { ...wildPokemon }, currentHp: wildPokemon.hp },
    status: 'active',
    turn: 'player',
    log: [],
    createdAt: Date.now(),
  };
}

// Returns { wildBattle, playerDied, wildDied, allFainted, attackLog, switchInfo }
function executeWildTurn(wildBattle) {
  const { player, wild } = wildBattle;
  const activeSlot   = player.teamSlots[player.activeSlot];
  const playerPokemon = activeSlot.pokemon;
  const playerLevel   = activeSlot.level;

  // Serangan pemain ke wild
  const playerAtk  = calculateDamage(playerPokemon, wild.pokemon, playerLevel);
  wild.currentHp   = Math.max(0, wild.currentHp - playerAtk.damage);

  const log = [];
  log.push(`${playerPokemon.emoji} *${playerPokemon.name}* menyerang ${wild.pokemon.emoji} *${wild.pokemon.name}*!`);
  log.push(`💥 Damage: *${playerAtk.damage}*${playerAtk.crit ? ' ✨ KRITIK!' : ''}`);
  const effP = getEffectivenessText(playerAtk.typeMult);
  if (effP) log.push(effP);
  log.push(`❤️ HP ${wild.pokemon.name}: ${wild.currentHp}/${wild.pokemon.hp} ${makeHpBar(wild.currentHp, wild.pokemon.hp)}`);

  if (wild.currentHp <= 0) {
    wildBattle.status = 'wild_fainted';
    wildBattle.log.push(log.join('\n'));
    return { wildBattle, playerDied: false, wildDied: true, allFainted: false, attackLog: log, switchInfo: null };
  }

  // Serangan wild balik
  const wildAtk       = calculateDamage(wild.pokemon, playerPokemon, 1);
  activeSlot.currentHp = Math.max(0, activeSlot.currentHp - wildAtk.damage);

  log.push('');
  log.push(`${wild.pokemon.emoji} *${wild.pokemon.name}* balas menyerang!`);
  log.push(`💥 Damage: *${wildAtk.damage}*${wildAtk.crit ? ' ✨ KRITIK!' : ''}`);
  const effW = getEffectivenessText(wildAtk.typeMult);
  if (effW) log.push(effW);
  log.push(`❤️ HP ${playerPokemon.name}: ${activeSlot.currentHp}/${playerPokemon.hp} ${makeHpBar(activeSlot.currentHp, playerPokemon.hp)}`);

  let switchInfo = null;

  if (activeSlot.currentHp <= 0) {
    log.push(`\n💀 *${playerPokemon.name}* pingsan!`);

    if (isTeamAllFainted(player.teamSlots)) {
      // Seluruh tim pemain habis
      wildBattle.status = 'player_fainted';
      wildBattle.log.push(log.join('\n'));
      return { wildBattle, playerDied: true, wildDied: false, allFainted: true, attackLog: log, switchInfo: null };
    }

    // Auto-switch ke pokemon hidup berikutnya
    const nextSlot = getNextAliveSlot(player.teamSlots, player.activeSlot);
    const oldName  = playerPokemon.name;
    player.activeSlot = nextSlot;
    const newPokemon = player.teamSlots[nextSlot].pokemon;
    log.push(`🔄 *${newPokemon.name}* ${newPokemon.emoji} masuk menggantikan!`);
    switchInfo = { oldName, newName: newPokemon.name, newEmoji: newPokemon.emoji };

    wildBattle.log.push(log.join('\n'));
    return { wildBattle, playerDied: false, wildDied: false, allFainted: false, attackLog: log, switchInfo };
  }

  wildBattle.log.push(log.join('\n'));
  return { wildBattle, playerDied: false, wildDied: false, allFainted: false, attackLog: log, switchInfo: null };
}

function calcCatchRate(wildPokemon, currentHp) {
  const baseRates = { common: 85, uncommon: 65, rare: 40, legendary: 18, mythic: 5 };
  const base      = baseRates[wildPokemon.rarity] || 60;
  const hpRatio   = currentHp / wildPokemon.hp;
  const hpBonus   = Math.round((1 - hpRatio) * 30);
  return Math.min(95, base + hpBonus);
}

// ─── EXP & Level ─────────────────────────────────────────
function getExpGain(winnerLevel, loserPokemon) {
  const base = loserPokemon.hp + loserPokemon.attack + loserPokemon.defense;
  const rarityBonus = { common: 1, uncommon: 1.5, rare: 2, legendary: 3, mythic: 5 };
  return Math.round(base * (rarityBonus[loserPokemon.rarity] || 1) * 0.5);
}

function getWildExpGain(wildPokemon) {
  const base = wildPokemon.hp + wildPokemon.attack + wildPokemon.defense;
  const rarityBonus = { common: 0.6, uncommon: 0.9, rare: 1.3, legendary: 2, mythic: 3.5 };
  return Math.round(base * (rarityBonus[wildPokemon.rarity] || 0.6) * 0.4);
}

function getSuitResult(p1, p2) {
  const choices = ['Batu ✊', 'Gunting ✌️', 'Kertas ✋'];
  const move1 = choices[Math.floor(Math.random() * choices.length)];
  const move2 = choices[Math.floor(Math.random() * choices.length)];
  
  let result = '';
  if (move1 === move2) {
    result = "Hasilnya: *SERI* 🤝";
  } else if (
    (move1.includes('Batu') && move2.includes('Gunting')) ||
    (move1.includes('Gunting') && move2.includes('Kertas')) ||
    (move1.includes('Kertas') && move2.includes('Batu'))
  ) {
    result = `Pemenangnya adalah: *@${p1.split('@')[0]}* 🏆`;
  } else {
    result = `Pemenangnya adalah: *@${p2.split('@')[0]}* 🏆`;
  }

  return { move1, move2, result };
}

function getLevelFromExp(exp) { return Math.floor(1 + Math.sqrt(exp / 100)); }
function getExpForNextLevel(level) { return Math.pow(level, 2) * 100; }

module.exports = {
  buildTeamSlots,
  createBattleState, executeTurn,
  createWildBattleState, executeWildTurn, calcCatchRate,
  formatPokemonStats, makeHpBar, getSuitResult,
  getExpGain, getWildExpGain, getLevelFromExp, getExpForNextLevel, calculateDamage,
};
