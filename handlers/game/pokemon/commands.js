// ============================================================
// POKEMON COMMAND HANDLERS (Team Battle System)
// ============================================================
const { getRandomPokemon, RARITY_EMOJI, POKEMON_LIST } = require('../../../data/pokemon');
const {
  getPokemonPlayer, savePokemonPlayer,
  getWildSpawn, setWildSpawn, clearWildSpawn,
  getWildBattle, setWildBattle, clearWildBattle,
  getBattle, setBattle, clearBattle,
  getPokemonLeaderboard,
  getUserMoney, addMoney, deductMoney, grantPokemonStarter,
} = require('../../../data/db');
const {
  buildTeamSlots,
  createBattleState, executeTurn,
  createWildBattleState, executeWildTurn, calcCatchRate,
  makeHpBar,
  getExpGain, getWildExpGain, getLevelFromExp, getExpForNextLevel,
} = require('../../../game/battle');
const ui = require('../../../utils/ui');
const { listButton, sendMenu, quickReply } = require('../../../utils/buttons');
const { resolveNum } = require('../../../utils/jid');
const { parsePositiveAmount } = require('../../../utils/amount');


const BATTLE_COOLDOWN = 60 * 1000;
const SPAWN_INTERVAL  = 5 * 60 * 1000;
const MAX_TEAM_SIZE   = 3;
const MAX_POKEBALLS   = 50;
const FOOD_EXP        = 500;
const FOOD_PRICE      = 50;
const PB_PRICE_COIN   = 50;

function getUserId(msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  return resolveNum(sender);
}

function getFullJid(msg) {
  return msg.key.participant || msg.key.remoteJid;
}

function fmtMoney(n) {
  return new Intl.NumberFormat('id-ID').format(n);
}

async function reply(sock, msg, text) {
  const jid     = msg.key.remoteJid;
  const content = Array.isArray(text) ? text.join('\n') : text;
  await sock.sendMessage(jid, { text: content }, { quoted: msg });
}

async function requirePokemonReg(sock, msg) {
  const userId = getUserId(msg);
  const player = getPokemonPlayer(userId);
  if (!player) {
    await reply(sock, msg, `❌ Kamu belum terdaftar di Pokemon.`);
    return null;
  }
  if (!player.jid) grantPokemonStarter(userId, getFullJid(msg));
  return player;
}

function makeExpBar(current, max) {
  const pct    = Math.min(1, current / max);
  const filled = Math.round(pct * 8);
  return `[${'█'.repeat(filled)}${'░'.repeat(8 - filled)}]`;
}

// ─── Helper: tampilkan status tim ringkas ────────────────
function formatTeamStatus(teamSlots) {
  return teamSlots.map((s, i) => {
    const p    = s.pokemon;
    const hp   = s.currentHp;
    const maxHp = p.hp;
    const bar  = makeHpBar(hp, maxHp);
    const dead = hp <= 0 ? ' 💀' : '';
    return `  ${i + 1}. ${p.emoji} *${p.name}*${dead} — ${hp}/${maxHp} ${bar}`;
  }).join('\n');
}

// ─── .p.menu ─────────────────────────────────────────────
function getPokemonMenuText(userId, fullJid) {
  const player = getPokemonPlayer(userId);
  if (!player) {
    return ui.box('⚡ *POKEMON WORLD*', [
      `👋 *Selamat datang di Pokemon World!*`,
      ``,
      `Akun belum terdaftar. Ketik *!p spawn*`,
      `atau pilih di menu bawah untuk mulai!`,
      ui.divider(22),
      ui.cmd('!p spawn', 'Munculkan Pokemon liar'),
      ui.cmd('!p help', 'Panduan bermain lengkap'),
    ], 'Pilih aksi dari menu dropdown di bawah');
  }

  const level = getLevelFromExp(player.exp);
  return ui.box(
    `⚡ *POKEMON — TRAINER ${player.name.toUpperCase()}*`,
    [
      ui.kv(`⭐ Level`, `${level}`),
      ui.kv(`📦 Koleksi`, `${player.collection.length} Pokemon`),
      ui.kv(`🎒 Pokeball`, `${player.pokeballs}/${MAX_POKEBALLS}`),
      ui.kv(`💰 Saldo`, `Rp ${fmtMoney(getUserMoney(fullJid))}`),
      ui.divider(22),
      ui.section(`⚔️ *BATTLE & TANGKAP*`),
      ``,
      ui.cmd('!p spawn', 'Munculkan Pokemon liar'),
      ui.cmd('!p serang', 'Serang Pokemon di area'),
      ui.cmd('!p tangkap', 'Lempar Pokeball'),
      ui.cmd('!p battle @user', 'Tantang duel PvP'),
      ``,
      ui.section(`👤 *MANAJEMEN TRAINER*`),
      ``,
      ui.cmd('!p profil', 'Status lengkap trainer'),
      ui.cmd('!p koleksi', 'Daftar Pokemon milikmu'),
      ui.cmd('!p tim', 'Atur susunan tim battle'),
      ui.cmd('!p rank', 'Papan peringkat trainer'),
      ui.cmd('!p toko', 'Beli Pokeball & makanan'),
    ],
    'Pilih aksi cepat dari menu di bawah'
  );
}

async function handleMenu(sock, msg) {
  const userId  = getUserId(msg);
  const fullJid = getFullJid(msg);
  const text    = getPokemonMenuText(userId, fullJid);
  await reply(sock, msg, text);
}

// ─── .p.spawn ────────────────────────────────────────────
async function handleSpawn(sock, msg, groupId) {
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  const existing = getWildSpawn(groupId);
  if (existing) {
    return reply(sock, msg,
      `⚠️ ${existing.emoji} *${existing.name}* masih ada!\nGunakan *!p serang* atau *!p tangkap*.`
    );
  }

  const pokemon = getRandomPokemon();

  pokemon.spawnedAt = Date.now();
  setWildSpawn(groupId, pokemon);

  const jid = msg.key.remoteJid;
  const spawnText = ui.box(
    `🌿 Pokemon Liar Muncul! 🌿`,
    [
      ui.bullet(`🐾 Pokemon`, `${pokemon.emoji} *${pokemon.name}* ${RARITY_EMOJI[pokemon.rarity]}`),
      ui.bullet(`🏷️ Tipe`, pokemon.type.join('/')),
      ui.bullet(`❤️ HP`, pokemon.hp),
      ui.bullet(`⚔️ ATK`, pokemon.attack),
      ui.bullet(`🛡️ DEF`, pokemon.defense),
      ui.bullet(`💎 Kelangkaan`, pokemon.rarity.toUpperCase()),
      ui.divider(),
      `🗡️ *!p serang* — Lawan dulu`,
      `🎣 *!p tangkap* — Tangkap langsung`,
      `⏳ Kabur dalam 5 menit!`,
    ]
  );

  await sendMenu(sock, jid, {
    text: spawnText,
    footer: `⚡ Tangkap atau Lawan ${pokemon.name}`,
    quoted: msg,
    fallbackText: spawnText,
    buttons: [
      quickReply('!p serang', '⚔️ Serang'),
      quickReply('!p tangkap', '🎣 Tangkap'),
      quickReply('!p kabur', '🏃 Kabur'),
    ],
  });

  setTimeout(async () => {
    const stillThere = getWildSpawn(groupId);
    if (stillThere && stillThere.spawnedAt === pokemon.spawnedAt) {
      clearWildSpawn(groupId);
      await sock.sendMessage(jid, { text: `💨 ${pokemon.emoji} *${pokemon.name}* kabur!` });
    }
  }, SPAWN_INTERVAL);
}

// ─── .p.serang ───────────────────────────────────────────
async function handleWildAttack(sock, msg, groupId) {
  const userId = getUserId(msg);
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  const wildPokemon = getWildSpawn(groupId);
  if (!wildPokemon) return reply(sock, msg, `🌾 Tidak ada Pokemon liar.\nGunakan *!p spawn*!`);
  if (player.activeTeam.length === 0) return reply(sock, msg, `😢 Kamu belum punya Pokemon di tim!`);

  const playerLevel = getLevelFromExp(player.exp);
  let wildBattle    = getWildBattle(userId);

  // Buat atau validasi battle yang ada
  if (!wildBattle || wildBattle.groupId !== groupId || wildBattle.wild.pokemon.spawnedAt !== wildPokemon.spawnedAt) {
    const teamSlots = buildTeamSlots(player.activeTeam, player.collection, playerLevel);
    if (teamSlots.length === 0) return reply(sock, msg, `❌ Pokemon di timmu tidak valid. Atur *!p tim*`);
    wildBattle = createWildBattleState(userId, teamSlots, wildPokemon, groupId);
  }

  if (wildBattle.status !== 'active') {
    clearWildBattle(userId);
    return reply(sock, msg, `❌ Battle sudah selesai! Gunakan *!p serang* lagi.`);
  }

  const { wildBattle: updated, playerDied, wildDied, allFainted, attackLog, switchInfo } = executeWildTurn(wildBattle);

  // Semua pokemon pemain pingsan
  if (allFainted) {
    clearWildBattle(userId);
    return reply(sock, msg, [
      attackLog.join('\n'), ``,
      `💀 *Seluruh tim pokemonmu pingsan!* Kamu melarikan diri...`,
    ].join('\n'));
  }

  // Wild pingsan
  if (wildDied) {
    setWildBattle(userId, updated);
    const baseExp  = getWildExpGain(wildPokemon);
    const expMult  = 1.0;
    const expGain  = Math.round(baseExp * expMult);
    const oldLevel = getLevelFromExp(player.exp);
    player.exp    += expGain;
    const newLevel = getLevelFromExp(player.exp);
    savePokemonPlayer(userId, player);
    const expEventTag = expMult > 1 ? ` _(x${expMult} Event!)_` : '';
    
    const faintedText = ui.box(
      `💥 *POKEMON PINGSAN!*`,
      [
        attackLog.join('\n'),
        ui.divider(22),
        `😵 *${wildPokemon.name}* telah pingsan!`,
        ui.bullet(`✨ EXP`, `+${expGain}${expEventTag}`),
        newLevel > oldLevel ? ui.bullet(`⬆️ Level Up`, `${oldLevel} → ${newLevel}!`) : null,
        ui.divider(22),
        `🎯 *Peluang tangkap MAKSIMAL (98%)!*`,
        `Lempar Pokeball sekarang sebelum kabur!`,
      ].filter(Boolean)
    );

    return sendMenu(sock, msg.key.remoteJid, {
      text: faintedText,
      footer: `🎣 Peluang Tangkap 98% (Maksimal)`,
      quoted: msg,
      fallbackText: faintedText,
      buttons: [
        quickReply('!p tangkap', '🎣 Tangkap Sekarang'),
        quickReply('!p kabur', '🏃 Tinggalkan'),
      ],
    });
  }

  // Lanjut battle
  setWildBattle(userId, updated);
  const activeSlot  = updated.player.teamSlots[updated.player.activeSlot];
  const activePokemon = activeSlot.pokemon;

  // Catch rate
  const baseCatchRate  = calcCatchRate(wildPokemon, updated.wild.currentHp);
  const catchRateBonus = 0;
  const catchRate      = Math.min(95, baseCatchRate + catchRateBonus);
  const catchTag       = '';

  const lines = [];

  if (switchInfo) {
    lines.push(ui.section(`📊 Status Tim`));
    lines.push(formatTeamStatus(updated.player.teamSlots));
    lines.push(``);
    lines.push(`⚔️ Pokemon aktif sekarang: ${activeSlot.pokemon.emoji} *${activeSlot.pokemon.name}*`);
  } else {
    lines.push(ui.section(`📊 Status`));
    lines.push(`${activePokemon.emoji} HP-mu: ${activeSlot.currentHp}/${activePokemon.hp} ${makeHpBar(activeSlot.currentHp, activePokemon.hp)}`);
    lines.push(`${wildPokemon.emoji} HP liar: ${updated.wild.currentHp}/${wildPokemon.hp} ${makeHpBar(updated.wild.currentHp, wildPokemon.hp)}`);
  }

  lines.push(``);
  lines.push(`🎣 Peluang tangkap: *${catchRate}%*${catchTag}`);
  lines.push(`*!p serang* | *!p tangkap* | *!p kabur*`);

  const battleText = ui.box(`⚔️ Battle Liar`, [
    attackLog.join('\n'),
    ...lines,
  ]);

  await sendMenu(sock, msg.key.remoteJid, {
    text: battleText,
    footer: `⚔️ Pilih aksi pertarungan`,
    quoted: msg,
    fallbackText: battleText,
    buttons: [
      quickReply('!p serang', '⚔️ Serang Lagi'),
      quickReply('!p tangkap', '🎣 Lempar Ball'),
      quickReply('!p kabur', '🏃 Kabur'),
    ],
  });
}

// ─── .p.kabur ────────────────────────────────────────────
async function handleFlee(sock, msg, groupId) {
  const userId     = getUserId(msg);
  const player     = await requirePokemonReg(sock, msg);
  if (!player) return;
  const wildBattle = getWildBattle(userId);
  if (!wildBattle || wildBattle.groupId !== groupId) {
    return reply(sock, msg, `❌ Kamu tidak sedang dalam battle liar!`);
  }
  clearWildBattle(userId);
  await reply(sock, msg, `🏃 Kamu berhasil kabur dari ${wildBattle.wild.pokemon.emoji} *${wildBattle.wild.pokemon.name}*!`);
}

// ─── .p.tangkap ──────────────────────────────────────────
async function handleCatch(sock, msg, groupId) {
  const userId      = getUserId(msg);
  const player      = await requirePokemonReg(sock, msg);
  if (!player) return;
  const wildPokemon = getWildSpawn(groupId);
  if (!wildPokemon) return reply(sock, msg, `🌾 Tidak ada Pokemon liar. Gunakan *!p spawn*!`);
  if (player.pokeballs <= 0) return reply(sock, msg, `😢 Pokeball habis! Beli di *!p toko*`);

  const wildBattle    = getWildBattle(userId);
  let wildCurrentHp   = wildPokemon.hp;
  let alreadyFainted  = false;
  if (wildBattle && wildBattle.groupId === groupId && wildBattle.wild.pokemon.spawnedAt === wildPokemon.spawnedAt) {
    wildCurrentHp  = wildBattle.wild.currentHp;
    alreadyFainted = wildBattle.status === 'wild_fainted' || wildCurrentHp <= 0;
  }

  // Catch rate
  const baseCatchRate  = alreadyFainted ? 98 : calcCatchRate(wildPokemon, wildCurrentHp);
  const catchRateBonus = 0;
  const catchRate      = Math.min(99, baseCatchRate + catchRateBonus);
  const roll      = Math.random() * 100;
  player.pokeballs -= 1;

  if (roll < catchRate) {
    clearWildSpawn(groupId);
    clearWildBattle(userId);
    const isDuplicate = player.collection.some(p => p.name === wildPokemon.name);

    if (isDuplicate) {
      const coinReward = 200;
      const baseExp    = Math.round(getWildExpGain(wildPokemon) * 0.5);
      const catchExp   = baseExp;
      addMoney(getFullJid(msg), coinReward);
      player.exp      += catchExp;
      savePokemonPlayer(userId, player);
      
      const duplicateText = ui.box(
        `✅ Tangkap Sukses (Duplikat)`,
        [
          ui.bullet(`🐾 Pokemon`, `${wildPokemon.emoji} *${wildPokemon.name}*`),
          ui.bullet(`📋 Status`, `Sudah ada di koleksi`),
          ui.bullet(`💰 Kompensasi`, `+${coinReward} Money`),
          ui.bullet(`✨ EXP`, `+${catchExp}`),
          ui.bullet(`🎒 Pokeball`, `Sisa ${player.pokeballs}`),
        ]
      );

      return sendMenu(sock, msg.key.remoteJid, {
        text: duplicateText,
        footer: `✨ Kompensasi uang + exp diterima`,
        quoted: msg,
        fallbackText: duplicateText,
        buttons: [
          quickReply('!p spawn', '✨ Spawn Lagi'),
          quickReply('!p koleksi', '🎒 Koleksi'),
          quickReply('!p profil', '👤 Profil'),
        ],
      });
    }

    const pokemonEntry = { ...wildPokemon, id: `${wildPokemon.id}_${Date.now()}`, caughtAt: Date.now(), level: 1, exp: 0 };
    player.collection.push(pokemonEntry);
    addMoney(getFullJid(msg), 100);
    if (player.activeTeam.length < MAX_TEAM_SIZE) player.activeTeam.push(pokemonEntry.id);

    const baseExp   = Math.round(getWildExpGain(wildPokemon) * 0.5);
    const catchExp  = baseExp;
    const oldLevel  = getLevelFromExp(player.exp);
    player.exp     += catchExp;
    const newLevel  = getLevelFromExp(player.exp);
    savePokemonPlayer(userId, player);

    const successText = ui.box(
      `✅ Tangkap Sukses!`,
      [
        ui.bullet(`🐾 Pokemon`, `${wildPokemon.emoji} *${wildPokemon.name}* ${RARITY_EMOJI[wildPokemon.rarity]}`),
        ui.bullet(`✨ EXP`, `+${catchExp}`),
        ui.bullet(`💰 Money`, `+100`),
        newLevel > oldLevel ? ui.bullet(`⬆️ Level Up`, `${oldLevel} → ${newLevel}!`) : null,
        ui.divider(),
        ui.bullet(`📦 Koleksi`, player.collection.length),
        ui.bullet(`🎒 Pokeball`, `Sisa ${player.pokeballs}`),
      ].filter(Boolean)
    );

    await sendMenu(sock, msg.key.remoteJid, {
      text: successText,
      footer: `🎉 Selamat atas tangkapan barumu!`,
      quoted: msg,
      fallbackText: successText,
      buttons: [
        quickReply('!p spawn', '✨ Spawn Lagi'),
        quickReply('!p koleksi', '🎒 Koleksi'),
        quickReply('!p profil', '👤 Profil'),
      ],
    });
  } else {
    savePokemonPlayer(userId, player);
    const failText = ui.box(
      `💨 Gagal Tangkap`,
      [
        ui.bullet(`🐾 Pokemon`, `${wildPokemon.emoji} *${wildPokemon.name}* lolos!`),
        ui.bullet(`🎯 Peluang`, `${catchRate}%`),
        ui.bullet(`🎒 Pokeball`, `Sisa ${player.pokeballs}`),
        ui.divider(),
        `💡 Serang dulu dengan *!p serang* untuk melemahkan!`,
      ]
    );

    await sendMenu(sock, msg.key.remoteJid, {
      text: failText,
      footer: `⚡ Coba lagi atau serang dulu`,
      quoted: msg,
      fallbackText: failText,
      buttons: [
        quickReply('!p serang', '⚔️ Serang Dulu'),
        quickReply('!p tangkap', '🎣 Tangkap Lagi'),
        quickReply('!p kabur', '🏃 Kabur'),
      ],
    });
  }
}

// ─── .p.koleksi (Updated with Evolution Label) ──────────
async function handleCollection(sock, msg) {
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;
  
  if (player.collection.length === 0) {
    return reply(sock, msg, `📦 Koleksimu masih kosong!\nGunakan *!p spawn* → *!p tangkap*`);
  }

  const grouped = {};
  for (const p of player.collection) {
    if (!grouped[p.name]) {
      const baseData = POKEMON_LIST.find(base => base.name === p.name);
      const canEvolve = baseData && baseData.evolution ? ' *(evo)*' : '';
      grouped[p.name] = { count: 0, pokemon: p, evoLabel: canEvolve };
    }
    grouped[p.name].count++;
  }

  const order = { mythic: 0, legendary: 1, rare: 2, uncommon: 3, common: 4 };
  const lines = Object.values(grouped)
    .sort((a, b) => order[a.pokemon.rarity] - order[b.pokemon.rarity])
    .map(({ pokemon, count, evoLabel }) => 
      `${pokemon.emoji} ${RARITY_EMOJI[pokemon.rarity]} *${pokemon.name}*${evoLabel} ×${count}`
    );

  const teamNames = player.activeTeam
    .map(id => player.collection.find(p => p.id === id))
    .filter(Boolean)
    .map(p => `${p.emoji} ${p.name}`)
    .join(', ');

  const koleksiText = ui.box(
    `📦 Koleksi — ${player.name}`,
    [
      ui.section(`🐾 Total ${player.collection.length} Pokemon`),
      ...lines,
      '',
      ui.bullet(`👥 Tim Aktif: ${teamNames || 'Belum ada'}`),
    ]
  );

  await sendMenu(sock, msg.key.remoteJid, {
    text: koleksiText,
    footer: '🎒 Koleksi Pokemon Trainer',
    quoted: msg,
    fallbackText: koleksiText,
    buttons: [
      quickReply('!p spawn', '✨ Spawn Pokemon'),
      quickReply('!p tim', '👥 Atur Tim'),
      quickReply('!p toko', '🏪 Toko'),
    ],
  });
}

// ─── .p.profil ───────────────────────────────────────────
async function handleProfile(sock, msg) {
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;
  const level        = getLevelFromExp(player.exp);
  const nextExp      = getExpForNextLevel(level);
  const progressBar  = makeExpBar(player.exp, nextExp);
  const rarityCount  = {};
  for (const p of player.collection) rarityCount[p.rarity] = (rarityCount[p.rarity] || 0) + 1;
  const winRate = player.wins + player.losses > 0
    ? Math.round(player.wins / (player.wins + player.losses) * 100) : 0;

  // Mengambil total database pokemon secara dinamis dari properti length array POKEMON_LIST
  const totalPokemon = POKEMON_LIST.length; 

  const profText = ui.box(
    `👤 Profil — ${player.name}`,
    [
      ui.kv(`⭐ Level`, level),
      ui.kv(`✨ EXP`, `${player.exp}/${nextExp} ${progressBar}`),
      ui.kv(`🎒 Pokeball`, player.pokeballs),
      ui.kv(`💰 Money`, fmtMoney(getUserMoney(getFullJid(msg)))),
      ui.divider(),
      ui.kv(`⚔️ Menang`, player.wins),
      ui.kv(`💀 Kalah`, player.losses),
      ui.kv(`📊 Win Rate`, `${winRate}%`),
      ui.divider(),
      ui.section(`📦 Koleksi ${player.collection.length}/${totalPokemon}`),
      `⚪ Common: ${rarityCount.common || 0} | 🟢 Uncommon: ${rarityCount.uncommon || 0}`,
      `🔵 Rare: ${rarityCount.rare || 0} | 🟡 Legendary: ${rarityCount.legendary || 0}`,
      `🔴 Mythic: ${rarityCount.mythic || 0}`,
    ]
  );

  await sendMenu(sock, msg.key.remoteJid, {
    text: profText,
    footer: '👤 Trainer Card',
    quoted: msg,
    fallbackText: profText,
    buttons: [
      quickReply('!p spawn', '✨ Cari Pokemon'),
      quickReply('!p koleksi', '🎒 Koleksi'),
      quickReply('!p rank', '🏆 Peringkat'),
    ],
  });
}

// ─── .p.rank ─────────────────────────────────────────────
async function handleLeaderboard(sock, msg) {
  const leaders = getPokemonLeaderboard();
  if (!leaders.length) return reply(sock, msg, `🏆 Belum ada data leaderboard.`);
  const medals = ['🥇','🥈','🥉'];
  const lines  = leaders.map((p, i) => {
    const level = getLevelFromExp(p.exp);
    return `${medals[i] || `${i+1}.`} *${p.name}* — Lv.${level} | 🏆 ${p.wins}W | 📦 ${p.collection.length} Pokémon`;
  });
  await reply(sock, msg, ui.box(`🏆 Leaderboard Pokemon`, lines));
}

// ─── .p.toko ─────────────────────────────────────────────
async function handleShop(sock, msg, bodyFromRouter) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const userId = resolveNum(sender);
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  const body    = bodyFromRouter?.trim()
    || (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  const args    = body.toLowerCase().split(' ').slice(1);
  const command = args[1];
  const itemType = args[2];
  const amount  = parsePositiveAmount(args[3]) || 1;

  if (command === 'beli') {
    if (itemType === 'makanan' || itemType === 'food') {
      const cost = amount * FOOD_PRICE;
      if (getUserMoney(sender) < cost) return reply(sock, msg, `❌ Money tidak cukup! Butuh ${fmtMoney(cost)} Money.`);
      deductMoney(sender, cost);
      player.food   = (player.food || 0) + amount;
      savePokemonPlayer(userId, player);
      return reply(sock, msg, `✅ Beli *${amount} Makanan*! 💰 Sisa: ${fmtMoney(getUserMoney(sender))} | 🍱 Stok: ${player.food}`);
    }
    if (itemType === 'pokeball' || itemType === 'pb') {
      const maxBuy = MAX_POKEBALLS - player.pokeballs;
      const buy    = Math.min(amount, maxBuy);
      if (buy <= 0) return reply(sock, msg, `🎒 Pokeball sudah penuh! (Max: ${MAX_POKEBALLS})`);
      const cost = buy * PB_PRICE_COIN;
      if (getUserMoney(sender) < cost) return reply(sock, msg, `💸 Money tidak cukup! Butuh ${fmtMoney(cost)} Money.`);
      player.pokeballs += buy;
      deductMoney(sender, cost);
      savePokemonPlayer(userId, player);
      return reply(sock, msg, `✅ Beli *${buy} Pokeball*! 💰 Sisa: ${fmtMoney(getUserMoney(sender))}`);
    }
  }

  await showShopMenu(sock, msg);
}

// ─── .p.toko interaktif (dropdown) ───────────────────────
async function showShopMenu(sock, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;
  const money = getUserMoney(sender);

  const makeQtyRows = (itemCmd) => [1, 5, 10].map(q => ({
    title: `${itemCmd === 'pokeball' ? '🎒' : '🍱'} ${itemCmd.toUpperCase()} x${q}`,
    description: itemCmd === 'pokeball'
      ? `💰 ${fmtMoney(PB_PRICE_COIN * q)}`
      : `💰 ${fmtMoney(FOOD_PRICE * q)} | +${FOOD_EXP * q} EXP`,
    id: `!p toko beli ${itemCmd} ${q}`,
  }));

  const text = ui.box(`🛒 Toko Pokemon`, [
    ui.section(`📦 Barang`),
    ui.bullet(`🎒 Pokeball — ${PB_PRICE_COIN}/biji`),
    ui.bullet(`🍱 Makanan — ${FOOD_PRICE}/biji (+${FOOD_EXP} EXP)`),
    ui.divider(),
    ui.bullet(`💰 Saldo: ${fmtMoney(money)}`),
    ui.bullet(`🍱 Makanan: ${player.food || 0}`),
    ui.divider(),
    `Pilih jumlah dari dropdown di bawah!`,
  ]);

  await sendMenu(sock, msg.key.remoteJid, {
    text,
    footer: `🛒 Saldo: ${fmtMoney(money)}`,
    quoted: msg,
    fallbackText: text,
    buttons: [
      listButton('🎒 Pokeball', [{ title: 'Belanja Pokeball', rows: makeQtyRows('pokeball') }]),
      listButton('🍱 Makanan', [{ title: 'Belanja Makanan', rows: makeQtyRows('makanan') }]),
    ],
  });
}

// ─── .p.tim ──────────────────────────────────────────────
async function handleTeam(sock, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const userId = resolveNum(sender);
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  const args = body.split(' ').slice(2);

  if (args[0] === 'del' || args[0] === 'reset' || args[0] === 'hapus') {
    player.activeTeam = [];
    savePokemonPlayer(userId, player);
    return reply(sock, msg, `✅ Tim dikosongkan!`);
  }

  if (!args.length) {
    const team = player.activeTeam
      .map((id, i) => {
        const p = player.collection.find(pk => pk.id === id);
        return p ? `${i+1}. ${p.emoji} *${p.name}* ${RARITY_EMOJI[p.rarity]} (Lv.${getLevelFromExp(p.exp||0)})` : null;
      }).filter(Boolean);
    return reply(sock, msg, ui.box(
      `👥 Tim Aktif — ${player.name}`,
      [
        ui.section(`🐾 Maks ${MAX_TEAM_SIZE} Pokemon`),
        team.length ? team.join('\n') : 'Tim kosong!',
        ui.divider(),
        `*!p tim [nama]* — Tambah/Hapus`,
        `*!p tim del* — Kosongkan`,
        ui.divider(),
        `💡 Tim slot 1 = Pokemon pertama saat battle dimulai.`,
        `   Jika pingsan, otomatis diganti ke slot berikutnya.`,
      ]
    ));
  }

  const pokemonName = args.join(' ').toLowerCase();
  const found       = player.collection.find(p => p.name.toLowerCase() === pokemonName);
  if (!found) return reply(sock, msg, `❌ Pokemon "${args.join(' ')}" tidak ada di koleksimu!`);

  if (player.activeTeam.includes(found.id)) {
    player.activeTeam = player.activeTeam.filter(id => id !== found.id);
    savePokemonPlayer(userId, player);
    return reply(sock, msg, `✅ *${found.name}* dihapus dari tim! (${player.activeTeam.length}/${MAX_TEAM_SIZE})`);
  }
  if (player.activeTeam.length >= MAX_TEAM_SIZE) {
    return reply(sock, msg, `⚠️ Tim penuh! Hapus dulu dengan *!p tim [nama]*`);
  }
  player.activeTeam.push(found.id);
  savePokemonPlayer(userId, player);
  await reply(sock, msg, `✅ *${found.name}* ditambahkan ke tim! (${player.activeTeam.length}/${MAX_TEAM_SIZE})`);
}

// ─── .p.battle ───────────────────────────────────────────
async function handleBattle(sock, msg, mentionedJid) {
  const jid          = msg.key.remoteJid;
  const sender       = msg.key.participant || msg.key.remoteJid;
  const challengerId = resolveNum(sender);
  const defenderId   = resolveNum(mentionedJid);

  if (challengerId === defenderId) return reply(sock, msg, `😅 Tidak bisa battle sendiri!`);

  const challenger = await requirePokemonReg(sock, msg);
  if (!challenger) return;
  const defender   = getPokemonPlayer(defenderId);
  if (!defender) return reply(sock, msg, `❌ Pemain yang ditag belum pernah pakai bot!`);

  const now = Date.now();
  if (challenger.lastBattle && (now - challenger.lastBattle) < BATTLE_COOLDOWN) {
    const sisa = Math.ceil((BATTLE_COOLDOWN - (now - challenger.lastBattle)) / 1000);
    return reply(sock, msg, `⏳ Cooldown! Tunggu *${sisa} detik* lagi.`);
  }
  if (!challenger.activeTeam.length) return reply(sock, msg, `😢 Kamu belum punya Pokemon di tim!`);
  if (!defender.activeTeam.length)   return reply(sock, msg, `😢 *${defender.name}* belum punya Pokemon di tim!`);

  const cl = getLevelFromExp(challenger.exp);
  const dl = getLevelFromExp(defender.exp);

  const challengerSlots = buildTeamSlots(challenger.activeTeam, challenger.collection, cl);
  const defenderSlots   = buildTeamSlots(defender.activeTeam,   defender.collection,   dl);

  if (!challengerSlots.length) return reply(sock, msg, `❌ Data Pokemon challenger tidak valid.`);
  if (!defenderSlots.length)   return reply(sock, msg, `❌ Data Pokemon defender tidak valid.`);

  const battleId = `${jid}_battle`;
  if (getBattle(battleId)?.status === 'active') return reply(sock, msg, `⚠️ Sudah ada battle di grup ini!`);

  const battle = createBattleState(challengerId, challengerSlots, defenderId, defenderSlots);
  battle.status = 'active';
  battle.groupJid = jid;
  battle.battleId = battleId;
  setBattle(battleId, battle);
  challenger.lastBattle = now;
  savePokemonPlayer(challengerId, challenger);

  const cpFirst = challengerSlots[0].pokemon;
  const dpFirst = defenderSlots[0].pokemon;

  const challengerTeamLine = challengerSlots.map((s, i) =>
    `  ${i+1}. ${s.pokemon.emoji} *${s.pokemon.name}* (Lv.${s.level})`
  ).join('\n');
  const defenderTeamLine = defenderSlots.map((s, i) =>
    `  ${i+1}. ${s.pokemon.emoji} *${s.pokemon.name}* (Lv.${s.level})`
  ).join('\n');

  const coinMult = 1.0;
  const coinEventTag = coinMult > 1 ? `\n🎉 *EVENT: Money PvP x${coinMult}!*` : '';

  const battleStartText = ui.box(
    `⚔️ Team Battle Dimulai!`,
    [
      ui.section(`🔴 ${challenger.name}`),
      challengerTeamLine,
      `▶️ Tampil: ${cpFirst.emoji} *${cpFirst.name}*`,
      ui.section(`🔵 ${defender.name}`),
      defenderTeamLine,
      `▶️ Tampil: ${dpFirst.emoji} *${dpFirst.name}*`,
      ui.divider(),
      `🎯 Giliran pertama: *${challenger.name}*`,
      `📋 Pokemon pingsan → otomatis ganti`,
      `🏆 Menang jika seluruh tim lawan pingsan!`,
      coinEventTag,
      ui.divider(),
      `Tekan tombol atau ketik *!p lawan*!`,
    ].filter(s => s !== '')
  );

  await sendMenu(sock, jid, {
    text: battleStartText,
    footer: `⚔️ PvP Battle — Giliran ${challenger.name}`,
    quoted: msg,
    fallbackText: battleStartText,
    buttons: [
      quickReply('!p lawan', '💥 Serang Lawan'),
      quickReply('!p bcancel', '🏳️ Batalkan Duel'),
    ],
  });
}

// ─── .p.lawan ────────────────────────────────────────────
async function handleAttack(sock, msg) {
  const jid      = msg.key.remoteJid;
  const sender   = msg.key.participant || msg.key.remoteJid;
  const userId   = resolveNum(sender);
  const battleId = `${jid}_battle`;
  const battle   = getBattle(battleId);

  const player = await requirePokemonReg(sock, msg);
  if (!player) return;
  if (!battle || battle.status !== 'active') {
    return reply(sock, msg, `❌ Tidak ada battle PvP.\nGunakan *!p battle @pemain*`);
  }

  const currentTurnId = battle.turn === 'challenger' ? battle.challenger.userId : battle.defender.userId;
  if (userId !== currentTurnId) {
    const cp = getPokemonPlayer(currentTurnId);
    return reply(sock, msg, `⏳ Bukan giliranmu! Giliran *${cp ? cp.name : 'lawan'}*`);
  }

  const { battle: updated, switchInfo } = executeTurn(battle);
  setBattle(battleId, updated);

  const lastLog     = updated.log[updated.log.length - 1];
  let responseText  = lastLog + '\n';

  if (updated.status === 'finished') {
    clearBattle(battleId);
    const winner     = getPokemonPlayer(updated.winner);
    const loser      = getPokemonPlayer(updated.loser);
    const loserSide  = updated.loser === updated.challenger.userId ? updated.challenger : updated.defender;

    let totalExpGain = 0;
    for (const slot of loserSide.teamSlots) {
      if (slot.currentHp <= 0) {
        totalExpGain += getExpGain(getLevelFromExp(winner.exp), slot.pokemon);
      }
    }

    const baseCoin   = 200 + (loserSide.teamSlots.length - 1) * 50;
    const coinMult   = 1.0;
    const coinGain   = Math.round(baseCoin * coinMult);
    const coinTag    = coinMult > 1 ? ` _(x${coinMult} Event!)_` : '';

    const expMult    = 1.0;
    const finalExp   = Math.round(totalExpGain * expMult);
    const expTag     = expMult > 1 ? ` _(x${expMult} Event!)_` : '';

    const oldLevel = getLevelFromExp(winner.exp);
    winner.exp    += finalExp;
    addMoney(winner.jid || updated.winner, coinGain);
    winner.wins   += 1;
    loser.losses  += 1;
    const newLevel = getLevelFromExp(winner.exp);
    savePokemonPlayer(updated.winner, winner);
    savePokemonPlayer(updated.loser,  loser);

    const winnerSide = updated.winner === updated.challenger.userId ? updated.challenger : updated.defender;
    const teamStatus = formatTeamStatus(winnerSide.teamSlots);

    const resultLines = [
      `🥇 Pemenang: *${winner.name}*`,
      ui.bullet(`✨ EXP`, `+${finalExp}${expTag}`),
      ui.bullet(`💰 Money`, `+${coinGain}${coinTag}`),
      newLevel > oldLevel ? ui.bullet(`⬆️ Level Up`, `${oldLevel} → ${newLevel}!`) : null,
      ui.bullet(`💀 Kalah`, `*${loser.name}*`),
      ui.divider(),
      ui.section(`📊 Tim ${winner.name}`),
      teamStatus,
    ].filter(Boolean);

    responseText += `\n` + ui.box(`🏆 Battle Selesai!`, resultLines);
    await sendMenu(sock, jid, {
      text: responseText,
      footer: `🏆 Duel PvP Selesai`,
      quoted: msg,
      fallbackText: responseText,
      buttons: [
        quickReply('!p spawn', '✨ Cari Pokemon'),
        quickReply('!p tim', '👥 Susunan Tim'),
        quickReply('!p rank', '🏆 Peringkat'),
      ],
    });
  } else {
    const nextSide   = updated.turn === 'challenger' ? updated.challenger : updated.defender;
    const nextPlayer = getPokemonPlayer(nextSide.userId);
    const nextActive = nextSide.teamSlots[nextSide.activeSlot];
    const turnLines = [];
    if (switchInfo) {
      const justSwitchedSide = battle.turn === 'challenger' ? updated.defender : updated.challenger;
      turnLines.push(ui.section(`📊 Status Tim Lawan`));
      turnLines.push(formatTeamStatus(justSwitchedSide.teamSlots));
    }
    turnLines.push(`🎯 Giliran: *${nextPlayer ? nextPlayer.name : 'lawan'}*`);
    turnLines.push(`▶️ Pokemon aktif: ${nextActive.pokemon.emoji} *${nextActive.pokemon.name}*`);
    turnLines.push(`Gunakan *!p lawan*!`);
    responseText += `\n` + ui.box(`⚔️ Lanjut Battle`, turnLines);

    await sendMenu(sock, jid, {
      text: responseText,
      footer: `⚔️ Giliran ${nextPlayer ? nextPlayer.name : 'lawan'}`,
      quoted: msg,
      fallbackText: responseText,
      buttons: [
        quickReply('!p lawan', '💥 Serang'),
        quickReply('!p bcancel', '🏳️ Batal'),
      ],
    });
  }
}

// ─── .p.makan ────────────────────────────────────────────
async function handleFeed(sock, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const userId = resolveNum(sender);
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  const args = body.split(' ');
  let amount = parsePositiveAmount(args[2]) || 1;

  if ((player.food || 0) <= 0) {
    return reply(sock, msg, `❌ Kamu tidak punya makanan! Beli di *!p toko beli makanan [jml]*`);
  }
  if (player.food < amount) {
    return reply(sock, msg, `❌ Makanan tidak cukup! Kamu hanya punya *${player.food}* makanan.`);
  }
  if (!player.activeTeam.length) {
    return reply(sock, msg, `❌ Tidak ada Pokemon di tim!`);
  }

  const activePokemon = player.collection.find(p => p.id === player.activeTeam[0]);
  if (!activePokemon) return reply(sock, msg, `❌ Pokemon tidak ditemukan.`);

  const totalExpGain = FOOD_EXP * amount;
  activePokemon.exp = (activePokemon.exp || 0) + totalExpGain;
  player.food -= amount;
  savePokemonPlayer(userId, player);

  await reply(sock, msg, ui.box(
    `🍱 Pemberian Makan`,
    [
      ui.bullet(`🐾 Pokemon`, `${activePokemon.emoji} *${activePokemon.name}*`),
      ui.bullet(`✨ EXP`, `+${totalExpGain}`),
      ui.bullet(`🍱 Makanan`, `Terpakai ${amount}`),
      ui.bullet(`📊 Stok`, `Sisa ${player.food}`),
    ]
  ));
}

// ─── .p.evol ─────────────────────────────────────────────
async function handleEvolution(sock, msg) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const userId = resolveNum(sender);
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;

  if (!player.activeTeam.length) return reply(sock, msg, `❌ Pilih pokemon di tim utama dulu!`);

  const activePokemon = player.collection.find(p => p.id === player.activeTeam[0]);
  if (!activePokemon) return reply(sock, msg, `❌ Pokemon tidak ditemukan.`);

  const speciesData = POKEMON_LIST.find(p => p.name === activePokemon.name);
  if (!speciesData || !speciesData.evolution) return reply(sock, msg, `❌ Pokemon ini tidak bisa berevolusi!`);

  const evolutionData = POKEMON_LIST.find(p => p.name === speciesData.evolution);
  if (!evolutionData) return reply(sock, msg, `❌ Data evolusi tidak ditemukan.`);

  const lvl = getLevelFromExp(activePokemon.exp || 0);
  const isSecondEvolution = evolutionData.evolution ? true : false;
  const requiredLevel = isSecondEvolution ? 25 : 50;

  if (lvl < requiredLevel) {
    return reply(sock, msg, `❌ Level Pokemon belum cukup! Butuh Level *${requiredLevel}* untuk evolusi ini. (Sekarang: Lv.${lvl})`);
  }

  const oldEmoji = activePokemon.emoji;

  activePokemon.name    = evolutionData.name;
  activePokemon.hp     += 25;
  activePokemon.attack += 20;
  activePokemon.type    = evolutionData.type;
  activePokemon.emoji   = evolutionData.emoji;
  activePokemon.rarity  = evolutionData.rarity;
  activePokemon.exp     = 0;

  savePokemonPlayer(userId, player);
  await reply(sock, msg, ui.box(
    `✨ CONGRATS!`,
    [
      ui.bullet(`🐾 Evolusi`, `${oldEmoji} → ${evolutionData.emoji}`),
      ui.bullet(`✨ Pokemon`, `*${evolutionData.name}*`),
    ]
  ));
}

// ─── .p.cek ──────────────────────────────────────────────
async function handleCheckPokemon(sock, msg, args) {
  const player = await requirePokemonReg(sock, msg);
  if (!player) return;
  if (!args.length) return reply(sock, msg, `⚠️ Contoh: *!p cek Pikachu*`);

  const pokemonName = args.join(' ').toLowerCase();
  const found = player.collection.find(p => p.name.toLowerCase() === pokemonName);

  if (found) {
    const rarity  = RARITY_EMOJI[found.rarity];
    const level   = getLevelFromExp(found.exp || 0);
    const nextExp = getExpForNextLevel(level);
    return reply(sock, msg, ui.box(
      `📊 ${found.emoji} ${found.name}`,
      [
        ui.bullet(`📋 Status`, `Milikmu • ${rarity} Lv.${level}`),
        ui.bullet(`✨ EXP`, `${found.exp || 0} / ${nextExp}`),
        ui.bullet(`🏷️ Tipe`, found.type ? found.type.join('/') : 'Tidak diketahui'),
        ui.divider(),
        ui.bullet(`❤️ HP`, found.hp),
        ui.bullet(`⚔️ ATK`, found.attack),
        ui.bullet(`🛡️ DEF`, found.defense),
        ui.bullet(`💨 SPD`, found.speed),
      ]
    ));
  }

  const base = POKEMON_LIST.find(p => p.name.toLowerCase() === pokemonName);
  if (base) {
    return reply(sock, msg, ui.box(
      `🔍 ${base.emoji} ${base.name}`,
      [
        ui.bullet(`📋 Status`, `${RARITY_EMOJI[base.rarity]} ${base.rarity.toUpperCase()}`),
        ui.bullet(`🏷️ Tipe`, base.type.join('/')),
        ui.divider(),
        ui.bullet(`❤️ HP`, base.hp),
        ui.bullet(`⚔️ ATK`, base.attack),
        ui.bullet(`🛡️ DEF`, base.defense),
        ui.divider(),
        `💡 Kamu belum memiliki Pokemon ini.`,
      ]
    ));
  }
  return reply(sock, msg, `❌ Pokemon "${args.join(' ')}" tidak ditemukan!`);
}

// ─── .p.help ─────────────────────────────────────────────
async function handleHelp(sock, msg) {
  await reply(sock, msg, ui.box(
    `❓ *Panduan Pokemon Bot*`,
    [
      ui.section(`🌿 Tangkap Pokemon`),
      ``,
      ui.cmd('!p spawn', 'Munculkan Pokemon liar (grup)'),
      ui.cmd('!p serang', 'Serang Pokemon liar'),
      ui.cmd('!p tangkap', 'Lempar Pokeball'),
      ui.cmd('!p kabur', 'Kabur dari battle'),
      ui.section(`⚔️ PvP Battle (Tim 3v3)`),
      ``,
      ui.cmd('!p battle @user', 'Tantang pemain'),
      ui.cmd('!p lawan', 'Serang lawan'),
      ui.cmd('!p battle cancel', 'Batalkan battle'),
      ui.bullet('Pokemon pingsan → otomatis ganti ke yang hidup'),
      ui.bullet('Menang jika semua pokemon lawan pingsan!'),
      ui.section(`📦 Manajemen`),
      ``,
      ui.cmd('!p koleksi / !p tim / !p cek [nama]'),
      ui.cmd('!p makan', 'Beri makan Pokemon aktif'),
      ui.cmd('!p evol', 'Evolusi Pokemon'),
      ui.section(`📊 Info`),
      ``,
      ui.cmd('!p profil / !p rank / !p toko'),
      ui.cmd('!p element', 'Elemen & kelemahan'),
      ui.cmd('!p element [nama]', 'Detail satu elemen'),
      ui.cmd('!p pokedex [nama]', 'Pokedex & progres koleksi'),
      ui.divider(),
      `⭐ Rarity: ⚪ Common → 🟢 Uncommon → 🔵 Rare → 🟡 Legendary → 🔴 Mythic`,
    ]
  ));
}

// ─── .p.pokedex ──────────────────────────────────────────
async function handlePokedex(sock, msg, args) {
  const subCmd = args[0]?.toLowerCase();
  const rarities = ['mythic', 'legendary', 'rare', 'uncommon', 'common'];

  if (subCmd === 'evo' || subCmd === 'evolusi') {
    const evoPokemon = POKEMON_LIST.filter(p => p.evolution);
    const evoLines = evoPokemon.map(p =>
      `${p.emoji} *${p.name}* ➔ ${p.evolution}`
    );
    const body = [
      ui.bullet(`📊 Total`, `${evoPokemon.length} Pokemon ditemukan`),
      ui.divider(),
      ...(evoPokemon.length > 0 ? evoLines : ['_(Tidak ada data evolusi)_']),
      ui.divider(),
      `💡 Ketik *!p cek [nama]* untuk syarat level.`,
    ];
    return reply(sock, msg, ui.box(`🧬 Pokedex: Evolusi`, body));
  }

  if (!subCmd || !rarities.includes(subCmd)) {
    return reply(sock, msg, ui.box(
      `📖 Pokedex — Menu`,
      [
        ui.section(`📌 Pilih kategori`),
        `🧬 *!p dex evo* — Daftar evolusi`,
        `🔴 *!p dex mythic*`,
        `🟡 *!p dex legendary*`,
        `🔵 *!p dex rare*`,
        `🟢 *!p dex uncommon*`,
        `⚪ *!p dex common*`,
        ui.divider(),
        `💡 Contoh: Ketik *!p dex evo*`,
      ]
    ));
  }

  const filteredPokemon = POKEMON_LIST.filter(p => p.rarity === subCmd);
  const emojiTier = RARITY_EMOJI[subCmd] || '🐾';
  const pokeLines = filteredPokemon.map(p => `${p.emoji} *${p.name}*`);
  const body = [
    ui.bullet(`📊 Total`, `${filteredPokemon.length} Pokemon`),
    ui.divider(),
    ...(filteredPokemon.length > 0 ? pokeLines : ['_(Belum ada data Pokemon untuk tier ini)_']),
    ui.divider(),
    `💡 Ketik *!p cek [nama]* untuk info detail.`,
  ];
  await reply(sock, msg, ui.box(`${emojiTier} Pokedex: ${subCmd.toUpperCase()}`, body));
}

// ─── .p.element ──────────────────────────────────────────
const TYPE_CHART = {
  Normal:   { weaknesses: ['Fighting'],                        resistances: ['Ghost'] },
  Fire:     { weaknesses: ['Water', 'Ground', 'Rock'],         resistances: ['Fire', 'Grass', 'Ice', 'Bug', 'Steel', 'Fairy'] },
  Water:    { weaknesses: ['Electric', 'Grass'],               resistances: ['Fire', 'Water', 'Ice', 'Steel'] },
  Electric: { weaknesses: ['Ground'],                          resistances: ['Electric', 'Flying', 'Steel'] },
  Grass:    { weaknesses: ['Fire', 'Ice', 'Poison', 'Flying', 'Bug'], resistances: ['Water', 'Electric', 'Grass', 'Ground'] },
  Ice:      { weaknesses: ['Fire', 'Fighting', 'Rock', 'Steel'],      resistances: ['Ice'] },
  Fighting: { weaknesses: ['Flying', 'Psychic', 'Fairy'],     resistances: ['Bug', 'Rock', 'Dark'] },
  Poison:   { weaknesses: ['Ground', 'Psychic'],               resistances: ['Grass', 'Fighting', 'Poison', 'Bug', 'Fairy'] },
  Ground:   { weaknesses: ['Water', 'Grass', 'Ice'],           resistances: ['Poison', 'Rock', 'Electric'] },
  Flying:   { weaknesses: ['Electric', 'Ice', 'Rock'],         resistances: ['Grass', 'Fighting', 'Bug'] },
  Psychic:  { weaknesses: ['Bug', 'Ghost', 'Dark'],            resistances: ['Fighting', 'Psychic'] },
  Bug:      { weaknesses: ['Fire', 'Flying', 'Rock'],          resistances: ['Grass', 'Fighting', 'Ground'] },
  Rock:     { weaknesses: ['Water', 'Grass', 'Fighting', 'Ground', 'Steel'], resistances: ['Normal', 'Fire', 'Poison', 'Flying'] },
  Ghost:    { weaknesses: ['Ghost', 'Dark'],                   resistances: ['Poison', 'Bug', 'Normal', 'Fighting'] },
  Dragon:   { weaknesses: ['Ice', 'Dragon', 'Fairy'],          resistances: ['Fire', 'Water', 'Electric', 'Grass'] },
  Dark:     { weaknesses: ['Fighting', 'Bug', 'Fairy'],        resistances: ['Ghost', 'Dark', 'Psychic'] },
  Steel:    { weaknesses: ['Fire', 'Fighting', 'Ground'],      resistances: ['Normal', 'Grass', 'Ice', 'Flying', 'Psychic', 'Bug', 'Rock', 'Dragon', 'Steel', 'Fairy'] },
  Fairy:    { weaknesses: ['Poison', 'Steel'],                 resistances: ['Fighting', 'Bug', 'Dark', 'Dragon'] },
};

const TYPE_EMOJI = {
  Normal: '⬜', Fire: '🔥', Water: '💧', Electric: '⚡', Grass: '🌿',
  Ice: '❄️', Fighting: '🥊', Poison: '☠️', Ground: '🏜️', Flying: '🌪️',
  Psychic: '🔮', Bug: '🐛', Rock: '🪨', Ghost: '👻', Dragon: '🐉',
  Dark: '🌑', Steel: '⚙️', Fairy: '✨',
};

async function handleElement(sock, msg, args) {
  const allTypes = Object.keys(TYPE_CHART);

  if (args.length > 0) {
    const typeName = args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase();

    if (!TYPE_CHART[typeName]) {
      return reply(sock, msg, `❌ Elemen *"${args[0]}"* tidak ditemukan!`);
    }

    const data = TYPE_CHART[typeName];
    const emoji = TYPE_EMOJI[typeName];
    const weakList = data.weaknesses.join(', ');
    const resList = data.resistances.join(', ');

    return reply(sock, msg, ui.box(
      `📊 Detail Elemen: ${typeName.toUpperCase()} ${emoji}`,
      [
        ui.section(`⚔️ Kelemahan`),
        `${typeName} <<< ${weakList}`,
        ui.section(`🛡️ Ketahanan`),
        `${typeName} >>> ${resList}`,
        ui.divider(),
        `💡 Gunakan tipe di sisi kanan (setelah <<<) untuk damage 2x lipat!`,
      ]
    ));
  }

  const lines = [
    `_Format: Elemen <<< Lemah Terhadap_`,
    ui.divider(),
  ];

  for (const type of allTypes) {
    const { weaknesses } = TYPE_CHART[type];
    const emoji = TYPE_EMOJI[type];
    const weakStr = weaknesses.join(', ');
    lines.push(`${emoji} *${type}* <<< ${weakStr}`);
  }

  lines.push(
    ui.divider(),
    `💡 Detail lengkap: *!p element [nama]*`,
    `Contoh: *!p element Dragon*`
  );

  await reply(sock, msg, ui.box(`🌐 Daftar Kelemahan Elemen`, lines));
}

// ─── .p.battle cancel ────────────────────────────────────
async function handleBattleCancel(sock, msg) {
  const jid      = msg.key.remoteJid;
  const sender   = msg.key.participant || msg.key.remoteJid;
  const userId   = resolveNum(sender);
  const battleId = `${jid}_battle`;
  const battle   = getBattle(battleId);

  if (!battle || battle.status !== 'active') {
    return reply(sock, msg, `❌ Tidak ada battle aktif yang bisa dibatalkan di grup ini.`);
  }

  const isChallenger = battle.challenger.userId === userId;
  const isDefender   = battle.defender.userId === userId;
  if (!isChallenger && !isDefender) {
    return reply(sock, msg, `⚠️ Hanya pemain yang sedang bertanding yang bisa membatalkan battle!`);
  }

  clearBattle(battleId);
  await reply(sock, msg, `🏳️ Battle telah dibatalkan oleh pemain. Grup sekarang bebas untuk battle baru!`);
}

module.exports = {
  getPokemonMenuText,
  handleMenu, handleSpawn, handleWildAttack, handleFlee,
  handleCatch, handleCollection, handleProfile, handleLeaderboard,
  handleShop, handleTeam, handleBattle, handleAttack, handleBattleCancel,
  handleFeed, handleEvolution, handleCheckPokemon, handleHelp,
  handlePokedex, handleElement,
};
