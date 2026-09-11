// ============================================================
// RPG COMMANDS HANDLER
// ============================================================
const db = require('../../../data/db');
const {
  getLevelFromExp, getExpForNextLevel, getRegenedStamina,
  getPlayerStats, calcDamage, makeHpBar, applySkill,
  chopWood, mining, formatNum, MINE_TABLE,
} = require('../../../game/rpgEngine');
const {
  MONSTERS, WEAPONS, ARMORS, TOOLS, SHOP_ITEMS, ESSENCE,
  CLASSES, SKILLS, KONTRAK_KELAS, RAID_BOSSES,
  MAX_STAMINA, CHOP_COST, MINE_COST,
  DUEL_TIMEOUT, DUEL_TURN_TIMEOUT, MATERIALS,
  resolveMaterialId, resolveShopItemId, resolveEquipmentId, resolveCategory,
  resolveSkillId,
} = require('../../../data/rpgData');
const ui = require('../../../utils/ui');
const { quickReply, sendMenu, listButton } = require('../../../utils/buttons');
const { sameUser, getNumber, resolveJid } = require('../../../utils/jid');
const { parsePositiveAmount, resolveAmount, isAllAmount } = require('../../../utils/amount');

// Sesi prompt jumlah jual material: botMsgId → { senderJid, matKey }
const rpgSellPrompts = new Map();

function rememberRpgSellPrompt(sentMsg, senderJid, matKey) {
  if (!sentMsg?.key?.id) return;
  rpgSellPrompts.set(sentMsg.key.id, { senderJid, matKey });
  const timer = setTimeout(() => rpgSellPrompts.delete(sentMsg.key.id), 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// Sesi prompt jumlah beli item: botMsgId → { senderJid, itemInput }
const rpgBuyPrompts = new Map();

function rememberRpgBuyPrompt(sentMsg, senderJid, itemInput) {
  if (!sentMsg?.key?.id) return;
  rpgBuyPrompts.set(sentMsg.key.id, { senderJid, itemInput });
  const timer = setTimeout(() => rpgBuyPrompts.delete(sentMsg.key.id), 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// Sesi prompt jumlah pakai item: botMsgId → { senderJid, keyword }
const rpgUsePrompts = new Map();

function rememberRpgUsePrompt(sentMsg, senderJid, keyword) {
  if (!sentMsg?.key?.id) return;
  rpgUsePrompts.set(sentMsg.key.id, { senderJid, keyword });
  const timer = setTimeout(() => rpgUsePrompts.delete(sentMsg.key.id), 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// ─── Helper ──────────────────────────────────────────────
function getSenderId(msg) {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  return resolveJid(isGroup ? msg.key.participant : msg.key.remoteJid);
}

function reply(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
}

function refreshStamina(player) {
  const fresh = getRegenedStamina(player);
  return { ...player, stamina: fresh, lastStaminaRegen: Date.now() };
}

function getStaminaItemRows(player) {
  const inv = player.inventory || {};
  return Object.entries(SHOP_ITEMS)
    .filter(([id, it]) => it.effect === 'stamina' && (inv[id] || 0) > 0)
    .map(([id, it]) => ({
      title: `${it.emoji} ${it.name}`,
      description: `Punya: ${inv[id]}x | ⚡+${it.value}`,
      id: `!rpg pakai ${it.alias} 1`,
    }));
}

async function handleStaminaDepleted(sock, msg, player, cost) {
  const rows = getStaminaItemRows(player);
  const text = ui.box('⚡ STAMINA HABIS', [
    `❌ Stamina tidak cukup! Butuh *${cost}* stamina, sisa *${player.stamina}/${MAX_STAMINA}*.`,
    ``,
    rows.length ? `Pilih item stamina di bawah untuk isi ulang:` : `Beli item stamina di *!rpg shop* atau tunggu regenerasi.`,
  ]);
  if (rows.length) {
    return sendMenu(sock, msg.key.remoteJid, {
      text,
      fallbackText: text,
      footer: '⚡ Pilih item stamina',
      quoted: msg,
      buttons: [listButton('⚡ Isi Stamina', [{ title: 'Item Stamina', rows }])],
    });
  }
  return sendMenu(sock, msg.key.remoteJid, {
    text,
    fallbackText: text,
    footer: '⚡ Stamina habis',
    quoted: msg,
    buttons: [quickReply('!rpg shop', '🛒 Buka Toko')],
  });
}

// ─── MENU ────────────────────────────────────────────────
function handleRpgMenu() {
  return ui.box('⚔️ *RPG MENU*', [
    ui.section(`📝 *INFO*`),
    ``,
    ui.cmd('!rpg profil', 'Lihat profil & status'),
    ui.cmd('!rpg info material', 'Info material RPG'),
    ui.cmd('!rpg menu', 'Tampilkan menu ini'),
    ``,
    ui.section(`🌲 *GATHERING*`),
    ``,
    ui.cmd('!rpg tebang', 'Tebang pohon (10 stamina)'),
    ui.cmd('!rpg tambang', 'Tambang (12 stamina)'),
    ``,
    ui.section(`⚔️ *PERTARUNGAN*`),
    ``,
    ui.cmd('!rpg lawan [1-15]', 'Lawan monster level 1-15'),
    ui.cmd('!rpg raid', 'Raid boss 1-6 pemain'),
    ui.cmd('!rpg duel @nama', 'Tantang duel PvP (grup)'),
    ui.cmd('!rpg terima', 'Terima tantangan duel'),
    ui.cmd('!rpg tolak', 'Tolak tantangan duel'),
    ui.cmd('!rpg serang', 'Serang lawan saat duel'),
    ui.cmd('!rpg kabur', 'Kabur dari duel (kalah)'),
    ``,
    ui.section(`🎭 *KELAS & SKILL*`),
    ``,
    ui.cmd('!rpg kelas', 'Pilih / ganti kelas'),
    ui.cmd('!rpg skill', 'Pilih skill aktif'),
    ui.cmd('!rpg serang skill [nama]', 'Pakai skill saat duel'),
    ``,
    ui.section(`🏪 *TOKO & ITEM*`),
    ``,
    ui.cmd('!rpg shop', 'Lihat toko'),
    ui.cmd('!rpg beli [item] [jml]', 'Beli item'),
    ui.cmd('!rpg jual', 'Lihat item yang bisa dijual'),
    ui.cmd('!rpg jual [item] [jml|all]', 'Jual material jadi Money'),
    ui.cmd('!rpg pakai apel', 'Pulihkan stamina'),
    ui.cmd('!rpg pakai ramuan', 'Pulihkan HP'),
    ui.cmd('!rpg pakai ramuan [jml|all]', 'Pakai dalam jumlah banyak'),
    ``,
    ui.section(`🔨 *TEMPA PERALATAN*`),
    ``,
    ui.cmd('!rpg tempa', 'Lihat semua resep'),
    ui.cmd('!rpg tempa [nama]', 'Tempa peralatan'),
    ui.cmd('!rpg fusi', 'Fusi esensi boss jadi material endgame'),
    ui.cmd('!rpg equip [nama]', 'Pasang peralatan'),
    ui.cmd('!rpg inv', 'Lihat inventori'),
    ``,
    ui.section(`📊 *LEADERBOARD*`),
    ``,
    ui.cmd('!rpg top', 'Peringkat petualang'),
  ], 'Pilih perintah yang kamu butuhkan.');
}

// ─── PROFIL ──────────────────────────────────────────────
async function handleRpgProfile(sock, msg) {
  const userId = getSenderId(msg);
  let player   = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG.');

  player = refreshStamina(player);
  db.updateRpgPlayer(userId, player);

  const stats  = getPlayerStats(player);
  const level  = stats.level;
  const expNow = player.exp;
  const expNext = getExpForNextLevel(level);
  const { LEVEL_EXP: LEX } = require('../../../data/rpgData');
  const prevExp = LEX[level] || 0;
  const expPct  = expNext === Infinity ? 1 : Math.min(1, (expNow - prevExp) / (expNext - prevExp));
  const expBar  = ui.bar(expPct * 100, 100);

  const weaponName = player.equippedWeapon ? (WEAPONS[player.equippedWeapon]?.name || '-') : 'Tangan Kosong';
  const armorName  = player.equippedArmor  ? (ARMORS[player.equippedArmor]?.name  || '-') : 'Pakaian Biasa';
  const axeName    = player.equippedAxe    ? (TOOLS[player.equippedAxe]?.name     || '-') : 'Tidak ada';
  const pickName   = player.equippedPickaxe? (TOOLS[player.equippedPickaxe]?.name || '-') : 'Tidak ada';
  const clsName    = player.class          ? (CLASSES[player.class]?.name || '-')       : 'Belum memilih';
  const clsEmoji   = player.class          ? (CLASSES[player.class]?.emoji || '')      : '🎭';
  const skillName  = player.activeSkill    ? (SKILLS[player.activeSkill]?.name || '-') : '-';

  const baseMaterials = ['wood', 'stone', 'iron'];
  const matList = Object.entries(MATERIALS)
    .filter(([id]) => baseMaterials.includes(id) || (player[id] || 0) > 0)
    .map(([id, m]) => `${m.emoji} ${m.name}: ${player[id] || 0}`);
  const materialLines = [];
  for (let i = 0; i < matList.length; i += 2) materialLines.push('   ' + matList.slice(i, i + 2).join('  |  '));

  const critPct = (stats.critChance * 100).toFixed(1).replace(/\.0$/, '');

  const profText = ui.box('⚔️ PROFIL RPG', [
    ui.kv('🧑 Nama', `*${player.name}*`),
    ui.kv('🎭 Kelas', `${clsEmoji} ${clsName} (skill: ⚡ ${skillName})`),
    ui.kv('⭐ Level', level),
    ui.kv('📊 EXP', `${formatNum(expNow)} ${expBar} ${expNext === Infinity ? 'MAX' : formatNum(expNext)}`),
    ``,
    ui.kv('❤️ HP', `${player.currentHp}/${stats.maxHp}`),
    ui.kv('⚡ Stamina', `${player.stamina}/${MAX_STAMINA}`),
    ui.kv('💰 Money', formatNum(db.getUserMoney(userId))),
    ``,
    `⚔️ ATK: ${stats.atk}  |  🛡️ DEF: ${stats.def}`,
    `✨ Crit: ${critPct}%  |  🛡️ Block: ${(stats.blockChance * 100).toFixed(0)}%`,
    `   💰 Reward: +${Math.round((stats.rewardMult - 1) * 100)}%`,
    ``,
    `🎒 *MATERIAL*`,
    ...materialLines,
    ``,
    `🗡️ *EQUIPPED*`,
    ui.bullet(`Senjata : ${weaponName}`),
    ui.bullet(`Zirah   : ${armorName}`),
    ui.bullet(`Kapak   : ${axeName}`),
    ui.bullet(`Cangkul : ${pickName}`),
    ``,
    `🏆 Menang: ${player.wins}  |  Kalah: ${player.losses}`,
    `🐾 Monster Dibunuh: ${player.monstersKilled}`,
  ]);

  await sendMenu(sock, msg.key.remoteJid, {
    text: profText,
    footer: '⚔️ Petualang RPG',
    quoted: msg,
    fallbackText: profText,
    buttons: [
      quickReply('!rpg tebang', '🪓 Tebang'),
      quickReply('!rpg tambang', '⛏️ Tambang'),
      quickReply('!rpg lawan', '👹 Lawan Monster'),
    ],
  });
}

// ─── TEBANG ──────────────────────────────────────────────
async function handleRpgChop(sock, msg) {
  const userId = getSenderId(msg);
  let player   = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  player = refreshStamina(player);
  if (player.stamina < CHOP_COST) return handleStaminaDepleted(sock, msg, player, CHOP_COST);

  const got = chopWood(player);
  player.wood    = (player.wood || 0) + got;
  player.stamina = player.stamina - CHOP_COST;
  player.lastStaminaRegen = Date.now();
  db.updateRpgPlayer(userId, player);

  const chopText = ui.box('🪓 MENEBANG POHON', [
    `🪵 Mendapat *${got} Kayu*!`,
    ui.kv('⚡ Stamina', `${player.stamina}/${MAX_STAMINA}`),
    ui.kv('🪵 Total Kayu', player.wood),
  ]);
  return sendMenu(sock, msg.key.remoteJid, {
    text: chopText,
    footer: '🪓 Lanjut menebang?',
    quoted: msg,
    fallbackText: chopText,
    buttons: [quickReply('!rpg tebang', '🪓 Tebang Lagi')],
  });
}

// ─── TAMBANG ─────────────────────────────────────────────
async function handleRpgMine(sock, msg) {
  const userId = getSenderId(msg);
  let player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');
  
  // Refresh & Cek Stamina
  player = refreshStamina(player);
  if (player.stamina < MINE_COST) return handleStaminaDepleted(sock, msg, player, MINE_COST);

  const yields = mining(player); 
  let report = [];
  let items  = [];
  
  // Masukkan hasil ke inventory pemain secara dinamis
  for (const [mat, amount] of Object.entries(yields)) {
    if (amount > 0) {
      player[mat] = (player[mat] || 0) + amount;
      const itemInfo = MATERIALS[mat];
      items.push(`${itemInfo?.emoji || '📦'} ${amount} ${itemInfo?.name || mat}`);
    }
  }

  player.stamina -= MINE_COST;
  db.updateRpgPlayer(userId, player);

  report.push(...items.length ? items : ['_(Tidak ada hasil tambang)_']);
  report.push('', ui.kv('⚡ Stamina', `${player.stamina}/${MAX_STAMINA}`));
  const mineText = ui.box('⛏️ HASIL TAMBANG', report);
  return sendMenu(sock, msg.key.remoteJid, {
    text: mineText,
    footer: '⛏️ Lanjut menambang?',
    quoted: msg,
    fallbackText: mineText,
    buttons: [quickReply('!rpg tambang', '⛏️ Tambang Lagi')],
  });
}

// ─── LAWAN MONSTER ───────────────────────────────────────
async function handleRpgFight(sock, msg, args) {
  const userId = getSenderId(msg);
  let player   = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const monsterLevel = parsePositiveAmount(args[0]);

  // --- JIKA TIDAK ADA INPUT LEVEL (Hanya !rpg lawan) ---
  if (monsterLevel === null) {
    const playerStats = getPlayerStats(player);
    const playerLevel = playerStats.level;

    const lines = [`Pilih monster yang ingin kamu lawan:`];
    const rowsOk     = [];
    const rowsStrong = [];
    for (const [lv, m] of Object.entries(MONSTERS)) {
      const tooStrong = parseInt(lv) > playerLevel + 3;
      lines.push(``, `${m.emoji} *[${lv}] ${m.name}* (Lv.${m.level})`, `   ❤️ HP: ${m.hp} | ⚔️ ATK: ${m.atk} | ${tooStrong ? '🛑 _Terlalu kuat_' : '✅ _Bisa dilawan_'}`);
      const row = {
        title: `${m.emoji} Lv.${lv} ${m.name}`,
        description: `❤️ ${m.hp} | ⚔️ ${m.atk} | 💰 ${formatNum(m.goldReward)}`,
        id: `!rpg lawan ${lv}`,
      };
      (tooStrong ? rowsStrong : rowsOk).push(row);
    }
    lines.push(``, ui.bullet('*!rpg lawan [nomor]* untuk menyerang.'), ui.bullet('Contoh: *!rpg lawan 1*'));

    const box = ui.box('⚔️ DAFTAR MONSTER', lines);
    return sendMenu(sock, msg.key.remoteJid, {
      text: box,
      footer: '⚔️ Pilih monster',
      quoted: msg,
      fallbackText: box,
      buttons: [
        listButton('⚔️ Lawan', [
          { title: '✅ Bisa dilawan', rows: rowsOk },
          ...(rowsStrong.length ? [{ title: '🛑 Terlalu kuat', rows: rowsStrong }] : []),
        ]),
      ],
    });
  }

  // --- LOGIKA PERTARUNGAN (Tetap sama seperti sebelumnya) ---
  if (monsterLevel < 1 || monsterLevel > 15)
    return reply(sock, msg, '❌ Pilih level monster 1-15!');

  const playerStats = getPlayerStats(player);
  const playerLevel = playerStats.level;
  
  if (monsterLevel > playerLevel + 3)
    return reply(sock, msg, `❌ Monster terlalu kuat! Level kamu *${playerLevel}*, max tantang level *${playerLevel + 3}*`);

  const monster = { ...MONSTERS[monsterLevel] };
  let monsterHp = monster.hp;
  let playerHp  = Math.min(player.currentHp, playerStats.maxHp);
  
  if (playerHp <= 0) return reply(sock, msg, '❌ HP kamu 0! Gunakan *!rpg pakai ramuan* untuk pulih.');

  // ... (Sisa kode pertarungan ke bawah tetap sama)
  const log = [
    ui.header('⚔️ PERTARUNGAN'),
    ``,
    `🧑 *${player.name}* (Lv.${playerLevel})`,
    `VS`,
    `${monster.emoji} *${monster.name}* (Lv.${monsterLevel})`,
    ``,
  ];

  const weaponTier = player.equippedWeapon ? (WEAPONS[player.equippedWeapon]?.tier || 0) : 0;
  const pveAtk = playerStats.atk + weaponTier * monsterLevel;

  // Skill aktif: dipakai otomatis saat cooldown habis
  const skill = player.activeSkill ? SKILLS[player.activeSkill] : null;
  let skillCd = 0;

  let round = 0;
  const MAX_ROUNDS = 20;
  while (playerHp > 0 && monsterHp > 0 && round < MAX_ROUNDS) {
    round++;
    // Player attacks (pakai skill bila cooldown siap)
    let pAtk;
    if (skill && skillCd <= 0) {
      pAtk = applySkill(skill, playerStats, { def: monster.def });
      skillCd = skill.cooldown;
      if (pAtk.heal > 0) {
        playerHp = Math.min(playerStats.maxHp, playerHp + pAtk.heal);
        log.push(`${skill.emoji} *${skill.name}*: 💗 +${pAtk.heal} HP! | HP Kamu: ${makeHpBar(playerHp, playerStats.maxHp)}`);
      } else {
        monsterHp = Math.max(0, monsterHp - pAtk.dmg);
        log.push(`${skill.emoji} *${skill.name}*: *-${pAtk.dmg}*${pAtk.crit ? ' ✨Kritis!' : ''} | HP Monster: ${makeHpBar(monsterHp, monster.hp)}`);
      }
    } else {
      pAtk = calcDamage(pveAtk, monster.def, { critChance: playerStats.critChance, blockChance: 0 });
      monsterHp  = Math.max(0, monsterHp - pAtk.dmg);
      log.push(`🗡️ Kamu: *-${pAtk.dmg}*${pAtk.crit ? ' ✨Kritis!' : ''}${pAtk.blocked ? ' 🛡️Blokir!' : ''} | HP Monster: ${makeHpBar(monsterHp, monster.hp)}`);
    }
    if (skillCd > 0) skillCd--;

    if (monsterHp <= 0) break;

    // Monster attacks
    const mAtk = calcDamage(monster.atk, playerStats.def, { critChance: 0.12, blockChance: playerStats.blockChance });
    playerHp   = Math.max(0, playerHp - mAtk.dmg);
    log.push(`${monster.emoji} ${monster.name}: *-${mAtk.dmg}*${mAtk.crit ? ' ✨Kritis!' : ''}${mAtk.blocked ? ' 🛡️Blokir!' : ''} | HP Kamu: ${makeHpBar(playerHp, playerStats.maxHp)}`);
  }

  player.currentHp = Math.max(0, playerHp);

  let result = monsterHp <= 0 ? 'win' : playerHp <= 0 ? 'lose' : null;
  if (result === null) {
    const pRatio = playerHp / playerStats.maxHp;
    const mRatio = monsterHp / monster.hp;
    result = pRatio > mRatio ? 'win' : pRatio < mRatio ? 'lose' : 'draw';
  }

  if (result === 'win') {
    const expGain  = Math.floor(monster.expReward * playerStats.rewardMult);
    const goldGain = Math.floor((monster.goldReward + Math.floor(Math.random() * monster.goldReward * 0.5)) * playerStats.rewardMult);
    player.exp             = (player.exp || 0) + expGain;
    db.addMoney(userId, goldGain);
    player.wins            = (player.wins || 0) + 1;
    player.monstersKilled  = (player.monstersKilled || 0) + 1;
    db.updateRpgPlayer(userId, player);

    // Drop esensi boss (monster 13-15)
    let essenceDrop = null;
    for (const e of Object.values(ESSENCE)) {
      if (e.monsterLevel === monsterLevel && Math.random() < e.dropChance) {
        essenceDrop = e;
        break;
      }
    }
    if (essenceDrop) {
      player[essenceDrop.id] = (player[essenceDrop.id] || 0) + 1;
      db.updateRpgPlayer(userId, player);
      log.push(`${essenceDrop.emoji} *+1 ${essenceDrop.name}!* (${player[essenceDrop.id]}x)`);
    }

    const newLevel = getLevelFromExp(player.exp);
    log.push(``, `🏆 *MENANG!*`);
    log.push(`+${expGain} EXP | +${formatNum(goldGain)} Money`);
    log.push(`❤️ HP Tersisa: ${player.currentHp}/${playerStats.maxHp}`);
    if (newLevel > playerLevel) log.push(``, `🎉 *LEVEL UP! Level ${newLevel}!*`);
  } else if (result === 'lose') {
    player.losses = (player.losses || 0) + 1;
    player.currentHp = Math.max(1, Math.floor(playerStats.maxHp * 0.1));
    db.updateRpgPlayer(userId, player);
    log.push(``, `💀 *KALAH!* HP dipulihkan ke 10%.`);
    log.push(`Gunakan *!rpg pakai ramuan* untuk pulih.`);
  } else {
    db.updateRpgPlayer(userId, player);
    log.push(``, `🤝 *SERI!* 20 ronde tanpa pemenang.`);
    log.push(`❤️ HP Kamu: ${player.currentHp}/${playerStats.maxHp} | ${monster.emoji} HP: ${monsterHp}/${monster.hp}`);
  }

  // Send in chunks if too long
  const text = log.join('\n');
  const postButtons = result === 'win'
    ? [
        quickReply(`!rpg lawan ${monsterLevel}`, '👹 Lawan Lagi'),
        quickReply('!rpg pakai ramuan', '🧪 Pulihkan HP'),
        quickReply('!rpg profil', '👤 Profil'),
      ]
    : [
        quickReply('!rpg pakai ramuan', '🧪 Pakai Ramuan'),
        quickReply('!rpg shop', '🏪 Beli Ramuan'),
        quickReply('!rpg profil', '👤 Profil'),
      ];

  if (text.length > 3500) {
    const half = Math.floor(log.length / 2);
    await reply(sock, msg, log.slice(0, half).join('\n'));
    await new Promise(r => setTimeout(r, 500));
    await sendMenu(sock, msg.key.remoteJid, {
      text: log.slice(half).join('\n'),
      footer: '⚔️ Hasil Pertarungan Monster',
      quoted: msg,
      fallbackText: log.slice(half).join('\n'),
      buttons: postButtons,
    });
  } else {
    await sendMenu(sock, msg.key.remoteJid, {
      text,
      footer: '⚔️ Hasil Pertarungan Monster',
      quoted: msg,
      fallbackText: text,
      buttons: postButtons,
    });
  }
}

// ─── DUEL PVP ────────────────────────────────────────────
async function handleRpgDuel(sock, msg, mentionedJid) {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith('@g.us');
  if (!isGroup) return reply(sock, msg, '⚠️ Duel hanya bisa di grup!');

  const userId = getSenderId(msg);
  if (!mentionedJid) return reply(sock, msg, '❌ Tag lawanmu!\nContoh: *!rpg duel @nama*');
  if (sameUser(mentionedJid, userId)) return reply(sock, msg, '❌ Tidak bisa duel dengan dirimu sendiri!');

  let challenger = db.getRpgPlayer(userId);
  let defender   = db.getRpgPlayer(mentionedJid);
  if (!challenger) return reply(sock, msg, '❌ Kamu belum terdaftar!');
  if (!defender)   return reply(sock, msg, '❌ Lawan belum terdaftar di RPG!');

  const existing = db.getRpgDuel(chatId);
  if (existing) {
    if (existing.status === 'waiting' && Date.now() - existing.createdAt > DUEL_TIMEOUT) {
      db.clearRpgDuel(chatId);
    } else if (existing.status === 'active' && Date.now() - existing.lastTurnAt > DUEL_TURN_TIMEOUT) {
      await forfeitByTimeout(sock, chatId, existing, msg);
    } else {
      return reply(sock, msg, '⚠️ Ada duel yang sedang berlangsung di grup ini!');
    }
  }

  db.setRpgDuel(chatId, {
    challenger: userId,
    defender: mentionedJid,
    challengerName: challenger.name,
    defenderName: defender.name,
    createdAt: Date.now(),
    status: 'waiting',
  });

  await sendMenu(sock, chatId, {
    text: ui.box('⚔️ TANTANGAN DUEL', [
      `🧑 *${challenger.name}* menantang *${defender.name}*!`,
      ``,
      `@${getNumber(mentionedJid)}, ketik *!rpg terima* untuk menerima`,
      `atau *!rpg tolak* untuk menolak.`,
    ]),
    fallbackText: ui.box('⚔️ TANTANGAN DUEL', [
      `🧑 *${challenger.name}* menantang *${defender.name}*!`,
      ``,
      `@${getNumber(mentionedJid)}, ketik *!rpg terima* untuk menerima`,
      `atau *!rpg tolak* untuk menolak.`,
      ``,
      `⏰ Tantangan berakhir dalam 5 menit.`,
    ]),
    footer: '⏰ Tantangan berakhir dalam 5 menit.',
    buttons: [
      quickReply('!rpg terima', '🤝 Terima'),
      quickReply('!rpg tolak', '❌ Tolak'),
    ],
    mentions: [mentionedJid],
    quoted: msg,
  });
}

async function handleRpgAcceptDuel(sock, msg) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const duel   = db.getRpgDuel(chatId);

  if (!duel) return reply(sock, msg, '❌ Tidak ada tantangan duel aktif.');
  if (duel.status !== 'waiting') return reply(sock, msg, '❌ Duel sudah dimulai!');
  if (duel.defender !== userId) return reply(sock, msg, '❌ Tantangan ini bukan untukmu!');
  if (Date.now() - duel.createdAt > DUEL_TIMEOUT) {
    db.clearRpgDuel(chatId);
    return reply(sock, msg, '⏰ Tantangan duel sudah kadaluarsa!');
  }

  let challenger = db.getRpgPlayer(duel.challenger);
  let defender   = db.getRpgPlayer(duel.defender);

  const cStats = getPlayerStats(challenger);
  const dStats = getPlayerStats(defender);
  const cHp = cStats.maxHp; // HP penuh sesuai gear saat duel dimulai
  const dHp = dStats.maxHp;

  const turn  = Math.random() < 0.5 ? duel.challenger : duel.defender;
  const first = turn === duel.challenger ? challenger : defender;

  db.setRpgDuel(chatId, {
    challenger: duel.challenger,
    defender: duel.defender,
    challengerName: duel.challengerName,
    defenderName: duel.defenderName,
    createdAt: duel.createdAt,
    acceptedAt: Date.now(),
    status: 'active',
    turn,
    cStats, dStats,
    cHp, dHp, cMaxHp: cStats.maxHp, dMaxHp: dStats.maxHp,
    round: 0,
    maxRounds: 10,
    lastTurnAt: Date.now(),
    skillCooldowns: {},
  });

  await sendMenu(sock, msg.key.remoteJid, {
    text: ui.box('⚔️ DUEL DIMULAI', [
      `🧑 *${challenger.name}* (Lv.${cStats.level})`,
      `VS`,
      `🧑 *${defender.name}* (Lv.${dStats.level})`,
      ``,
      `🎲 *${first.name}* jalan duluan!`,
      `⏰ Tiap giliran 60 detik.`,
    ]),
    fallbackText: ui.box('⚔️ DUEL DIMULAI', [
      `🧑 *${challenger.name}* (Lv.${cStats.level})`,
      `VS`,
      `🧑 *${defender.name}* (Lv.${dStats.level})`,
      ``,
      `🎲 *${first.name}* jalan duluan!`,
      `⏰ Tiap giliran 60 detik.`,
      ``,
      ui.cmd('!rpg serang', 'Serang lawan'),
      ui.cmd('!rpg kabur', 'Kabur (kalah)'),
    ]),
    footer: '⏰ Tiap giliran 60 detik.',
    buttons: [
      quickReply('!rpg serang', '⚔️ Serang'),
      quickReply('!rpg kabur', '🏃 Kabur'),
    ],
    quoted: msg,
  });
}

// ─── Selesaikan duel (menang/kalah/kabur/timeout) ─────────
async function finishDuel(sock, chatId, duel, opts) {
  const { winnerId, loserId, winnerHp, log, quoted } = opts;
  db.clearRpgDuel(chatId);

  const winner = db.getRpgPlayer(winnerId);
  const loser  = db.getRpgPlayer(loserId);
  if (!winner || !loser) return;

  // Stat live mengikuti gear player saat ini
  const wStats = getPlayerStats(winner);
  const lStats = getPlayerStats(loser);

  const goldPrize = Math.floor(db.getUserMoney(loserId) * 0.10);

  // ─── RAMPASAN ITEM (konsumsi + material, TIDAK menyentuh gear) ───
  // Pilih 1-3 jenis acak, tiap jenis diambil 10-30% dari jumlah milik kalah.
  const lootPool = [];
  for (const [id, mat] of Object.entries(MATERIALS)) {
    const qty = loser[id] || 0;
    if (qty > 0) lootPool.push({ kind: 'mat', id, qty });
  }
  const loserInv = loser.inventory || {};
  for (const [id, qty] of Object.entries(loserInv)) {
    if (qty > 0 && SHOP_ITEMS[id]) lootPool.push({ kind: 'item', id, qty });
  }

  const winnerInv = { ...(winner.inventory || {}) };
  const loserInv2 = { ...loserInv };
  const matLootWinner = {};
  const matLootLoser  = {};
  const lootLines = [];
  if (lootPool.length > 0) {
    const takeN = Math.min(lootPool.length, 1 + Math.floor(Math.random() * 3)); // 1-3 jenis
    const shuffled = [...lootPool].sort(() => Math.random() - 0.5).slice(0, takeN);
    for (const entry of shuffled) {
      const pct   = 10 + Math.floor(Math.random() * 21); // 10-30%
      const taken = Math.max(1, Math.floor(entry.qty * pct / 100));
      const info  = entry.kind === 'mat' ? MATERIALS[entry.id] : SHOP_ITEMS[entry.id];
      if (entry.kind === 'mat') {
        matLootLoser[entry.id]  = (loser[entry.id] || 0) - taken;
        matLootWinner[entry.id] = (winner[entry.id] || 0) + taken;
      } else {
        loserInv2[entry.id] = (loserInv2[entry.id] || 0) - taken;
        winnerInv[entry.id] = (winnerInv[entry.id] || 0) + taken;
      }
      lootLines.push(`• ${info.emoji} ${taken} ${info.name}`);
    }
  }

  db.addMoney(winnerId, goldPrize);
  db.updateRpgPlayer(winnerId, {
    wins: (winner.wins || 0) + 1,
    exp: (winner.exp || 0) + Math.floor(30 * wStats.rewardMult),
    currentHp: Math.min(Math.max(1, winnerHp), wStats.maxHp),
    lastStaminaRegen: Date.now(),
    ...(lootLines.length ? { inventory: winnerInv } : {}),
    ...matLootWinner,
  });

  db.deductMoney(loserId, goldPrize);
  db.updateRpgPlayer(loserId, {
    losses: (loser.losses || 0) + 1,
    currentHp: Math.max(1, Math.floor(lStats.maxHp * 0.1)),
    lastStaminaRegen: Date.now(),
    ...(lootLines.length ? { inventory: loserInv2 } : {}),
    ...matLootLoser,
  });

  const winnerName = winnerId === duel.challenger ? duel.challengerName : duel.defenderName;
  const loserName  = loserId === duel.challenger ? duel.challengerName : duel.defenderName;

  const lootSection = lootLines.length
    ? [`📦 Rampas item dari ${loserName}:`, ...lootLines]
    : [];

  const opts2 = quoted ? { quoted } : undefined;
  await sock.sendMessage(chatId, {
    text: ui.box('⚔️ DUEL PVP', [
      ...log,
      ``,
      `🏆 *${winnerName} MENANG!*`,
      `💰 Rampas *${formatNum(goldPrize)} Money* dari ${loserName}!`,
      ...lootSection,
    ]),
  }, opts2);
}

// Pemain yang gilirannya tidak aksi dalam 60 detik → dianggap kabur/kalah
async function forfeitByTimeout(sock, chatId, duel, quoted) {
  const loserId  = duel.turn;
  const winnerId = loserId === duel.challenger ? duel.defender : duel.challenger;
  const winnerHp = winnerId === duel.challenger ? duel.cHp : duel.dHp;
  const loserName = loserId === duel.challenger ? duel.challengerName : duel.defenderName;

  await finishDuel(sock, chatId, duel, {
    winnerId, loserId, winnerHp,
    log: [`⏰ *${loserName}* tidak aksi dalam 60 detik → dianggap kabur!`],
    quoted,
  });
}

// ─── SERANG (turn-based) ─────────────────────────────────
async function handleRpgAttack(sock, msg, args = []) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const duel   = db.getRpgDuel(chatId);
  if (!duel || duel.status !== 'active') return reply(sock, msg, '❌ Tidak ada duel aktif di grup ini!');

  if (Date.now() - duel.lastTurnAt > DUEL_TURN_TIMEOUT) {
    await forfeitByTimeout(sock, chatId, duel, msg);
    return;
  }

  if (userId !== duel.challenger && userId !== duel.defender)
    return reply(sock, msg, '❌ Kamu bukan peserta duel!');
  if (userId !== duel.turn)
    return reply(sock, msg, `❌ Bukan giliranmu! Tunggu giliran *${duel.turn === duel.challenger ? duel.challengerName : duel.defenderName}*.`);

  // Stat live mengikuti gear player saat ini
  duel.cStats = getPlayerStats(db.getRpgPlayer(duel.challenger));
  duel.dStats = getPlayerStats(db.getRpgPlayer(duel.defender));
  duel.cMaxHp = duel.cStats.maxHp;
  duel.dMaxHp = duel.dStats.maxHp;
  duel.cHp = Math.min(duel.cHp, duel.cMaxHp);
  duel.dHp = Math.min(duel.dHp, duel.dMaxHp);

  const attackerId = duel.turn;
  const targetId   = attackerId === duel.challenger ? duel.defender : duel.challenger;
  const aStats = attackerId === duel.challenger ? duel.cStats : duel.dStats;
  const tStats = attackerId === duel.challenger ? duel.dStats : duel.cStats;
  const aName  = attackerId === duel.challenger ? duel.challengerName : duel.defenderName;
  const tName  = attackerId === duel.challenger ? duel.defenderName : duel.challengerName;
  const aMaxHp = attackerId === duel.challenger ? duel.cMaxHp : duel.dMaxHp;
  const tMaxHp = attackerId === duel.challenger ? duel.dMaxHp : duel.cMaxHp;
  let aHp = attackerId === duel.challenger ? duel.cHp : duel.dHp;
  let tHp = attackerId === duel.challenger ? duel.dHp : duel.cHp;

  // Skill manual: !rpg serang skill [nama] — cooldown per pemain disimpan di state duel
  const wantSkill = (args[0] || '').toLowerCase() === 'skill';
  const skillInput = wantSkill ? args.slice(1).join(' ') : '';
  const skillId = wantSkill ? resolveSkillId(skillInput) : null;

  let atk;
  let log;
  if (wantSkill) {
    const player = db.getRpgPlayer(userId);
    const classSkills = player?.class ? CLASSES[player.class].skills : [];
    if (!skillId || !classSkills.includes(skillId))
      return reply(sock, msg, `❌ Skill *${skillInput}* bukan skill kelasmu! Skill: ${classSkills.map(s => SKILLS[s].name).join(', ')}`);
    const cds = duel.skillCooldowns || {};
    const cd = cds[`${userId}:${skillId}`] || 0;
    if (cd > 0)
      return reply(sock, msg, `⏳ Skill *${SKILLS[skillId].name}* masih cooldown ${cd} giliran lagi!`);
    const res = applySkill(SKILLS[skillId], aStats, tStats);
    if (res.heal > 0) {
      aHp = Math.min(aMaxHp, aHp + res.heal);
      log = [`💗 *${aName}* pakai ${SKILLS[skillId].emoji} ${SKILLS[skillId].name}: +${res.heal} HP! | HP: ${makeHpBar(aHp, aMaxHp)}`];
    } else {
      tHp = Math.max(0, tHp - res.dmg);
      log = [`${SKILLS[skillId].emoji} *${aName}* pakai ${SKILLS[skillId].name}: -${res.dmg}${res.crit ? ' ✨Kritis!' : ''} | ${tName} HP: ${makeHpBar(tHp, tMaxHp)}`];
    }
    cds[`${userId}:${skillId}`] = SKILLS[skillId].cooldown;
    duel.skillCooldowns = cds;
  } else {
    atk = calcDamage(aStats.atk, tStats.def, { critChance: aStats.critChance, blockChance: tStats.blockChance });
    tHp = Math.max(0, tHp - atk.dmg);
    log = [`⚔️ *${aName}*: -${atk.dmg}${atk.crit ? ' ✨Kritis!' : ''}${atk.blocked ? ' 🛡️Blokir!' : ''} | ${tName} HP: ${makeHpBar(tHp, tMaxHp)}`];
  }

  // Turunkan cooldown skill milik pemain yang baru saja menyerang
  const turnCds = duel.skillCooldowns || {};
  for (const [key, cd] of Object.entries(turnCds)) {
    if (key.startsWith(`${userId}:`)) turnCds[key] = cd - 1;
  }
  duel.skillCooldowns = turnCds;

  if (tHp <= 0) {
    await finishDuel(sock, chatId, duel, { winnerId: attackerId, loserId: targetId, winnerHp: aHp, log, quoted: msg });
    return;
  }

  const round = duel.round + 1;
  if (round >= duel.maxRounds) {
    db.clearRpgDuel(chatId);
    if (aHp === tHp) {
      await reply(sock, msg, ui.box('⚔️ DUEL PVP', [...log, '', '🤝 *SERI!* 5 kali serang per pemain tanpa pemenang.']));
    } else if (aHp > tHp) {
      await finishDuel(sock, chatId, duel, { winnerId: attackerId, loserId: targetId, winnerHp: aHp, log, quoted: msg });
    } else {
      await finishDuel(sock, chatId, duel, { winnerId: targetId, loserId: attackerId, winnerHp: tHp, log, quoted: msg });
    }
    return;
  }

  const next = { ...duel, turn: targetId, round, lastTurnAt: Date.now() };
  if (attackerId === duel.challenger) next.cHp = aHp; else next.dHp = aHp;
  if (targetId   === duel.challenger) next.cHp = tHp; else next.dHp = tHp;
  db.setRpgDuel(chatId, next);

  await sendMenu(sock, chatId, {
    text: ui.box('⚔️ DUEL PVP', [
      ...log,
      ``,
      `🎲 Giliran *${tName}* — *!rpg serang* / *!rpg kabur*`,
    ]),
    fallbackText: ui.box('⚔️ DUEL PVP', [
      ...log,
      ``,
      `🎲 Giliran *${tName}* — ketik *!rpg serang* atau *!rpg kabur*`,
      `⏰ 60 detik, jika tidak aksi dianggap kabur.`,
    ]),
    footer: '⏰ 60 detik, jika tidak aksi dianggap kabur.',
    buttons: [
      quickReply('!rpg serang', '⚔️ Serang'),
      quickReply('!rpg kabur', '🏃 Kabur'),
    ],
    quoted: msg,
  });
}

// ─── KABUR (kapan saja, yang kabur kalah) ────────────────
async function handleRpgFlee(sock, msg) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const duel   = db.getRpgDuel(chatId);
  if (!duel || duel.status !== 'active') return reply(sock, msg, '❌ Tidak ada duel aktif di grup ini!');

  if (Date.now() - duel.lastTurnAt > DUEL_TURN_TIMEOUT) {
    await forfeitByTimeout(sock, chatId, duel, msg);
    return;
  }

  if (userId !== duel.challenger && userId !== duel.defender)
    return reply(sock, msg, '❌ Kamu bukan peserta duel!');

  const winnerId = userId === duel.challenger ? duel.defender : duel.challenger;
  const loserId  = userId;
  const winnerHp = winnerId === duel.challenger ? duel.cHp : duel.dHp;
  const loserName = loserId === duel.challenger ? duel.challengerName : duel.defenderName;

  await finishDuel(sock, chatId, duel, {
    winnerId, loserId, winnerHp,
    log: [`🏃 *${loserName}* kabur dari duel!`],
    quoted: msg,
  });
}

async function handleRpgRejectDuel(sock, msg) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const duel   = db.getRpgDuel(chatId);

  if (!duel) return reply(sock, msg, '❌ Tidak ada tantangan duel aktif.');
  if (duel.defender !== userId && duel.challenger !== userId)
    return reply(sock, msg, '❌ Tantangan ini bukan untukmu!');
  if (duel.status !== 'waiting')
    return reply(sock, msg, '❌ Duel sudah dimulai! Gunakan *!rpg kabur* untuk menyerah.');

  db.clearRpgDuel(chatId);
  await reply(sock, msg, `❌ Duel antara *${duel.challengerName}* dan *${duel.defenderName}* dibatalkan.`);
}

// ─── SHOP ────────────────────────────────────────────────
async function handleRpgShop(sock, msg, args = []) { 
  const sub = args[0]?.toLowerCase();

  // --- MENU UTAMA TOKO (dropdown seperti FishIt) ---
  if (!sub) {
    const shopText = ui.box('🏪 TOKO RPG', [
      `Silakan pilih kategori toko:`,
      ``,
      ui.cmd('!rpg shop konsumsi', '🍎 Makanan & ramuan'),
      ui.cmd('!rpg shop material', '📦 Bahan mentah'),
      ui.cmd('!rpg shop kelas', '📜 Kontrak Kelas'),
    ]);
    const konsumsiRows = Object.values(SHOP_ITEMS).map(item => ({
      title: `${item.emoji} ${item.name}`,
      description: item.effect === 'stamina'
        ? `💰 ${formatNum(item.price)} | ⚡+${item.value} Stamina`
        : `💰 ${formatNum(item.price)} | ❤️+${item.value}% MaxHP`,
      id: `!rpg beli ${item.alias}`,
    }));
    const materialRows = Object.entries(MATERIALS)
      .filter(([_, m]) => m.canBuy !== false)
      .map(([id, mat]) => ({
        title: `${mat.emoji} ${mat.name}`,
        description: `💰 ${formatNum(mat.price)}`,
        id: `!rpg beli ${mat.alias || id}`,
      }));
    return sendMenu(sock, msg.key.remoteJid, {
      text: shopText,
      footer: '🏪 Pilih toko',
      quoted: msg,
      fallbackText: shopText,
      buttons: [
        listButton('🍎 Konsumsi', [{ title: 'Makanan & Ramuan', rows: konsumsiRows }]),
        listButton('📦 Material', [{ title: 'Bahan Mentah', rows: materialRows }]),
      ],
    });
  }

  // --- SUBMENU: KONSUMSI ---
  if (sub === 'konsumsi') {
    let lines = [];
    for (const item of Object.values(SHOP_ITEMS)) {
      const typeInfo = item.effect === 'stamina' ? `⚡+${item.value} Stamina` : `❤️+${item.value}% MaxHP`;
      lines.push(`• [${item.alias}] ${item.emoji} *${item.name}*`);
      lines.push(`  Harga: ${formatNum(item.price)} Money | ${typeInfo}`);
    }
    lines.push('', ui.bullet('Cara beli: *!rpg beli [nama] [jumlah]*'));
    return reply(sock, msg, ui.box('🍎 TOKO KONSUMSI', lines));
  }

  // --- SUBMENU: MATERIAL ---
  if (sub === 'material') {
    let lines = [];
    const buyableMaterials = Object.entries(MATERIALS).filter(([_, m]) => m.canBuy);
    
    if (buyableMaterials.length === 0) {
      lines.push('_(Saat ini tidak ada material yang dijual)_');
    } else {
      for (const [id, mat] of buyableMaterials) {
        lines.push(`• [${mat.alias}] ${mat.emoji} *${mat.name}*`);
        lines.push(`  Harga: ${formatNum(mat.price)} Money`);
      }
    }
    lines.push('', ui.bullet('Cara beli: *!rpg beli [nama] [jumlah]*'));
    return reply(sock, msg, ui.box('📦 TOKO MATERIAL', lines));
  }

  // --- SUBMENU: KELAS (Kontrak Kelas) ---
  if (sub === 'kelas') {
    return reply(sock, msg, ui.box('📜 TOKO KELAS', [
      `${KONTRAK_KELAS.emoji} *${KONTRAK_KELAS.name}*`,
      ui.kv('💰 Harga', '50,000 Money'),
      '',
      ui.bullet('Ganti kelas butuh 1 kontrak + biaya ganti.'),
      ui.bullet('Beli: *!rpg beli kontrak*'),
    ]));
  }

  return reply(sock, msg, `❌ Kategori *${sub}* tidak ditemukan. Gunakan *konsumsi*, *material*, atau *kelas*.`);
}

async function handleRpgBuy(sock, msg, args) {
  const userId  = getSenderId(msg);
  let player    = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  // Resolve nama: ID Inggris / alias Indonesia (batu, stone, roti, apple, ...)
  const input   = args[0] || '';
  const matKey  = resolveMaterialId(input);
  const shopKey = resolveShopItemId(input);
  const isKontrak = input === 'kontrak' || input === KONTRAK_KELAS.alias || input === KONTRAK_KELAS.name.toLowerCase();
  const item = (matKey && MATERIALS[matKey]) || (shopKey && SHOP_ITEMS[shopKey]) || (isKontrak && { ...KONTRAK_KELAS, price: 50000, effect: 'item', value: 0 });

  if (!item || (matKey && MATERIALS[matKey].canBuy === false)) {
    return reply(sock, msg, `❌ Item *${input}* tidak ditemukan atau tidak untuk dijual!`);
  }

  // Tanpa jumlah → tanya dulu via reply angka / all
  if (!args[1]) {
    const promptText = `❓ Beli *${item.emoji} ${item.name}* berapa?\n\nBalas dengan angka jumlahnya (contoh: *5*) atau *all* untuk beli sebanyak mungkin.`;
    const msgId = await sendMenu(sock, msg.key.remoteJid, {
      text: promptText,
      footer: `🛒 ${item.name}`,
      quoted: msg,
      fallbackText: promptText,
      buttons: [quickReply(`!rpg beli ${input} 1`, '🛒 Beli 1')],
    });
    if (msgId) rememberRpgBuyPrompt({ key: { id: msgId } }, userId, input);
    return;
  }

  const qtyRaw = args[1].toLowerCase();
  if (qtyRaw === 'all' || qtyRaw === 'semua') {
    const amount = Math.floor(db.getUserMoney(userId) / item.price);
    if (amount <= 0) {
      return reply(sock, msg, `❌ Money tidak cukup untuk membeli *${item.emoji} ${item.name}*! Harga ${formatNum(item.price)} per pcs.`);
    }
    args[1] = String(amount);
  }

  const amount = Math.max(1, parsePositiveAmount(args[1]) || 1);

  const total = item.price * amount;
  if (db.getUserMoney(userId) < total) {
    return reply(sock, msg, `❌ Money tidak cukup! Butuh *${formatNum(total)}*, kamu punya *${formatNum(db.getUserMoney(userId))}*.`);
  }

  // Eksekusi Pengurangan Money
  db.deductMoney(userId, total);

  // Logika Penyimpanan: Jika material masuk ke root player, jika konsumsi masuk ke inventory
  if (matKey) {
    player[matKey] = (player[matKey] || 0) + amount;
  } else if (shopKey || isKontrak) {
    player.inventory = player.inventory || {};
    const invKey = isKontrak ? KONTRAK_KELAS.id : shopKey;
    player.inventory[invKey] = (player.inventory[invKey] || 0) + amount;
  }

  db.updateRpgPlayer(userId, player);

  await reply(sock, msg, ui.box('✅ PEMBELIAN', [
    `Berhasil membeli *${amount}x ${item.emoji} ${item.name}*`,
    ui.kv('💰 Biaya', `-${formatNum(total)} Money`),
    ui.kv('💰 Sisa', formatNum(db.getUserMoney(userId))),
  ]));
}

// ─── PAKAI ITEM ──────────────────────────────────────────
async function handleRpgUse(sock, msg, args) {
  const userId = getSenderId(msg);
  let player   = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const keyword = args[0]?.toLowerCase();

  // Tanpa item → dropdown item konsumsi yang dimiliki
  if (!keyword) {
    const inv = player.inventory || {};
    const ownedRows = Object.entries(SHOP_ITEMS)
      .filter(([id, it]) => (inv[id] || 0) > 0)
      .map(([id, it]) => ({
        title: `${it.emoji} ${it.name}`,
        description: `Kamu punya: ${inv[id]}x`,
        id: `!rpg pakai ${it.alias}`,
      }));
    if (!ownedRows.length)
      return reply(sock, msg, '❌ Kamu belum punya item konsumsi!\nBeli di *!rpg shop*.');
    const box = ui.box('🧪 PAKAI ITEM', [
      `Pilih item yang ingin dipakai:`,
      ``,
    ]);
    return sendMenu(sock, msg.key.remoteJid, {
      text: box,
      footer: '🧪 Pilih item',
      quoted: msg,
      fallbackText: box,
      buttons: [listButton('🧪 Item', [{ title: 'Item Konsumsi', rows: ownedRows }])],
    });
  }

  let itemId = null;
  if (['apel', 'apple'].includes(keyword))          itemId = 'apple';
  else if (['roti', 'bread'].includes(keyword))     itemId = 'bread';
  else if (['ramuan', 'potion'].includes(keyword))  itemId = 'potion';
  else if (['ramuan+', 'potion2'].includes(keyword)) itemId = 'potion2';

  if (!itemId) return reply(sock, msg, '❌ Item tidak dikenal!\nContoh: *!rpg pakai apel* / *!rpg pakai ramuan 3* / *!rpg pakai ramuan all*');

  const inv  = player.inventory || {};
  const item = SHOP_ITEMS[itemId];
  const owned = inv[itemId] || 0;
  if (owned <= 0)
    return reply(sock, msg, `❌ Kamu tidak punya *${item.emoji} ${item.name}*!\nBeli di *!rpg shop*`);

  // Tanpa jumlah → tanya dulu via reply (angka atau all)
  if (!args[1]) {
    const promptText = `❓ Pakai *${item.emoji} ${item.name}* berapa?\n\nBalas dengan angka jumlahnya atau *all* untuk semua.\nKamu punya: *${owned}x*.`;
    const msgId = await sendMenu(sock, msg.key.remoteJid, {
      text: promptText,
      footer: `🧪 ${item.name}`,
      quoted: msg,
      fallbackText: promptText,
      buttons: [quickReply(`!rpg pakai ${keyword} 1`, '🧪 Pakai 1')],
    });
    if (msgId) rememberRpgUsePrompt({ key: { id: msgId } }, userId, keyword);
    return;
  }

  const qtyRaw = (args[1] || '').toLowerCase();
  const qty = qtyRaw ? resolveAmount(qtyRaw, owned) : 1;

  if (qty === null)
    return reply(sock, msg, '❌ Jumlah tidak valid! Harus angka positif atau "all".');

  if (qty > owned)
    return reply(sock, msg, `❌ Kamu hanya punya *${owned}x ${item.emoji} ${item.name}*.`);

  player = refreshStamina(player);
  const stats = getPlayerStats(player);

  if (item.effect === 'stamina') {
    const deficit  = MAX_STAMINA - player.stamina;
    if (deficit <= 0) return reply(sock, msg, '⚡ Stamina sudah penuh!');
    const usable   = Math.min(qty, Math.ceil(deficit / item.value));
    const newStamina = Math.min(MAX_STAMINA, player.stamina + usable * item.value);
    inv[itemId] -= usable;
    db.updateRpgPlayer(userId, { stamina: newStamina, inventory: inv, lastStaminaRegen: Date.now() });
    await reply(sock, msg, ui.box('🍎 PAKAI ITEM', [
      `${item.emoji} Menggunakan *${item.name}* x${usable}`,
      ui.kv('⚡ Stamina', `${player.stamina} → *${newStamina}/${MAX_STAMINA}*`),
      ui.kv('📦 Sisa', `${item.emoji} ${item.name}: ${inv[itemId]}`),
    ]));
  } else {
    const deficit = stats.maxHp - player.currentHp;
    if (deficit <= 0) return reply(sock, msg, '❤️ HP sudah penuh!');
    const healEach = Math.ceil(stats.maxHp * item.value / 100);
    const usable  = Math.min(qty, Math.ceil(deficit / healEach));
    const newHp   = Math.min(stats.maxHp, player.currentHp + usable * healEach);
    inv[itemId] -= usable;
    db.updateRpgPlayer(userId, { currentHp: newHp, inventory: inv });
    await reply(sock, msg, ui.box('🧪 PAKAI ITEM', [
      `${item.emoji} Menggunakan *${item.name}* x${usable}`,
      ui.kv('💗 Sembuh', `+${formatNum(healEach * usable)} HP`),
      ui.kv('❤️ HP', `${player.currentHp} → *${newHp}/${stats.maxHp}*`),
      ui.kv('📦 Sisa', `${item.emoji} ${item.name}: ${inv[itemId]}`),
    ]));
  }
}

// ─── TEMPA (CRAFTING) ──────────────────────────────────────
async function handleRpgCraft(sock, msg, args) {
  const userId = getSenderId(msg);
  let player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const subCommand = args[0]?.toLowerCase();

  const costStr = (item) => Object.entries(item.craftCost || {})
    .map(([mat, amt]) => `${MATERIALS[mat]?.emoji || '📦'}${amt}`).join(' ');
  const mkItemRow = (item) => ({
    title: `${item.emoji} ${item.name}${item.tier != null ? ` (T${item.tier})` : ''}`,
    description: costStr(item),
    id: `!rpg tempa ${item.alias}`,
  });

  // 1. Menu Utama — 4 kategori
  if (!subCommand) {
    return sendMenu(sock, msg.key.remoteJid, {
      text: ui.box('⚒️ WORKBENCH', [
        'Pilih kategori untuk membuat item:',
        'Ketuk kategori → pilih item → langsung ditempa.',
      ]),
      fallbackText: ui.box('⚒️ WORKBENCH', [
        `Pilih kategori untuk melihat resep:`,
        ui.cmd('!rpg tempa pedang', '⚔️ Pedang'),
        ui.cmd('!rpg tempa zirah', '🛡️ Zirah'),
        ui.cmd('!rpg tempa kapak', '🪓 Kapak'),
        ui.cmd('!rpg tempa pickaxe', '⛏️ Pickaxe'),
      ], 'Ketik: !rpg tempa [nama] untuk membuat.'),
      buttons: [listButton('⚒️ TEMPA', [{
        title: 'Kategori',
        rows: [
          { title: '⚔️ Pedang',  description: 'Resep senjata',  id: '!rpg tempa pedang' },
          { title: '🛡️ Zirah',   description: 'Resep armor',    id: '!rpg tempa zirah' },
          { title: '🪓 Kapak',   description: 'Resep kapak',    id: '!rpg tempa kapak' },
          { title: '⛏️ Pickaxe', description: 'Resep beliung',  id: '!rpg tempa pickaxe' },
        ],
      }])],
      quoted: msg,
    });
  }

  // 2. Definisi Kategori
  // Kita pastikan filter mencari tipe yang tepat di dalam TOOLS atau data lainnya
  const categoryMap = {
    'sword': { title: '⚔️ DAFTAR PEDANG', data: WEAPONS },
    'armor': { title: '🛡️ DAFTAR ZIRAH', data: ARMORS },
    'axe': { 
      title: '🪓 DAFTAR KAPAK', 
      data: Object.fromEntries(Object.entries(TOOLS).filter(([_, t]) => t.id.startsWith('axe') || t.type === 'axe')) 
    },
    'pickaxe': { 
      title: '⛏️ DAFTAR BELIUNG', 
      data: Object.fromEntries(Object.entries(TOOLS).filter(([_, t]) => t.id.startsWith('pick') || t.type === 'pickaxe')) 
    }
  };

  // Cek item dulu (nama bisa multi-kata: "pedang kayu"), baru kategori
  const fullCmd = args.join(' ').toLowerCase();
  const eqKey   = resolveEquipmentId(fullCmd);
  const catKey  = eqKey ? null : resolveCategory(subCommand);

  if (!eqKey && catKey && categoryMap[catKey]) {
    const cat = categoryMap[catKey];
    const items = Object.values(cat.data);

    if (items.length === 0) {
      return reply(sock, msg, '_(Belum ada resep untuk kategori ini)_');
    }

    const rows = items.map(mkItemRow);
    const fallbackLines = items.map(it => {
      const costs = Object.entries(it.craftCost)
        .map(([mat, amt]) => `${MATERIALS[mat]?.emoji || '📦'}${amt}`).join(' ');
      return `• [${it.alias}] ${it.emoji} *${it.name}* — ${costs}`;
    });
    fallbackLines.push('', ui.bullet('Ketik: *!rpg tempa [nama]* untuk membuat.'));

    const catText = ui.box(cat.title, [`Pilih item untuk ditempa:`, ``]);
    return sendMenu(sock, msg.key.remoteJid, {
      text: catText,
      fallbackText: ui.box(cat.title, fallbackLines),
      footer: 'Ketuk item → langsung ditempa.',
      quoted: msg,
      buttons: [listButton('⚒️ Pilih Item', [{ title: cat.title, rows }])],
    });
  }

  // 3. Logika Eksekusi Pembuatan (Crafting)
  const id = eqKey;
  const recipe = eqKey ? (WEAPONS[eqKey] || ARMORS[eqKey] || TOOLS[eqKey]) : null;
  
  if (!recipe) {
    return reply(sock, msg, `❌ Kategori atau item *${args.join(' ')}* tidak ditemukan!`);
  }

  const costs = recipe.craftCost;
  let canCraft = true;
  let missing = [];

  for (const [mat, requiredAmount] of Object.entries(costs)) {
    const playerAmount = player[mat] || 0;
    if (playerAmount < requiredAmount) {
      canCraft = false;
      const matName = MATERIALS[mat]?.name || mat;
      missing.push(`${MATERIALS[mat]?.emoji || '📦'} ${matName}: ${playerAmount}/${requiredAmount}`);
    }
  }

  if (!canCraft) {
    return reply(sock, msg, ui.box('❌ BAHAN TIDAK CUKUP', missing, 'Kumpulkan material dulu!'));
  }

  // Kurangi bahan dan tambahkan item ke craftedItems
  for (const [mat, requiredAmount] of Object.entries(costs)) {
    player[mat] -= requiredAmount;
  }

  player.craftedItems = player.craftedItems || {};
  player.craftedItems[id] = (player.craftedItems[id] || 0) + 1;

  db.updateRpgPlayer(userId, player);
  await reply(sock, msg, ui.box('✅ TEMPA BERHASIL', [
    `${recipe.emoji} *${recipe.name}* berhasil dibuat!`,
    ui.bullet(`Pasang dengan: *!rpg equip ${recipe.alias}*`),
  ]));
}

// ─── FUSI ESENSI BOSS ────────────────────────────────────
async function handleRpgFusi(sock, msg, args) {
  const userId = getSenderId(msg);
  let player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const q = (args.join(' ') || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Tanpa argumen: tampilkan esensi yang dimiliki + resep fusi
  if (!q) {
    const lines = [`Pilih esensi yang ingin difusi:`, ``];
    let any = false;
    for (const e of Object.values(ESSENCE)) {
      const owned = player[e.id] || 0;
      const target = MATERIALS[e.fusesTo];
      lines.push(ui.bullet(`[${e.name}] ${e.emoji} ${e.name}: ${owned}x →`));
      lines.push(ui.bullet(`   ${target?.emoji || ''} *${target?.name || e.fusesTo}* (${e.needed} esensi)`));
      any = true;
    }
    if (!any) lines.push('_(Belum ada esensi)_');
    lines.push('', 'CARA FUSI', ui.bullet('*!rpg fusi [nama esensi]* — fusi 5 esensi menjadi material'), ui.bullet('Contoh: *!rpg fusi void* / *!rpg fusi dark matter*'));
    return reply(sock, msg, ui.box('🔮 FUSI ESENSI', lines));
  }

  const essences = Object.values(ESSENCE);
  let e = essences.find(x => x.id === q || x.name.toLowerCase() === q);
  if (!e) {
    // Fallback: id-prefix atau nama-substring, hanya jika cocok unik (hindari ambigu)
    const subs = essences.filter(x => x.id.startsWith(q) || x.name.toLowerCase().includes(q));
    e = subs.length === 1 ? subs[0] : null;
  }
  if (!e) return reply(sock, msg, `❌ Esensi *${q}* tidak dikenal!\nKetik *!rpg fusi* untuk daftar.`);

  const owned = player[e.id] || 0;
  if (owned < e.needed)
    return reply(sock, msg, `❌ Esensi tidak cukup! Butuh *${e.needed}* ${e.emoji} ${e.name}, kamu punya *${owned}*.`);

  player[e.id] = owned - e.needed;
  player[e.fusesTo] = (player[e.fusesTo] || 0) + 1;
  db.updateRpgPlayer(userId, player);

  const target = MATERIALS[e.fusesTo];
  await reply(sock, msg, ui.box('🔮 FUSI BERHASIL', [
    `-${e.needed} ${e.emoji} ${e.name}`,
    `+1 ${target?.emoji || '📦'} *${target?.name || e.fusesTo}*`,
    ui.kv('📦 Esensi sisa', `${player[e.id]}`),
  ]));
}

// ─── EQUIP ───────────────────────────────────────────────
async function handleRpgEquip(sock, msg, args) {
  const userId = getSenderId(msg);
  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const duel = db.getRpgDuel(msg.key.remoteJid);
  if (duel && duel.status === 'active' && (duel.challenger === userId || duel.defender === userId))
    return reply(sock, msg, '❌ Tidak bisa ganti peralatan saat duel aktif!');

  const craftedItems = player.craftedItems || {};

  // Mode Dropdown: jika tanpa argumen, tampilkan daftar equipment yang dimiliki
  if (!args || !args.length) {
    const ownedEq = Object.entries(craftedItems).filter(([_, qty]) => qty > 0);
    if (!ownedEq.length) {
      return reply(sock, msg, `❌ Kamu belum memiliki peralatan hasil tempa!\nTempa peralatan di *!rpg tempa*.`);
    }

    const mkRow = (id) => {
      const item = WEAPONS[id] || ARMORS[id] || TOOLS[id];
      if (!item) return null;
      let typeLabel = 'Peralatan';
      if (WEAPONS[id]) typeLabel = `⚔️ ATK +${item.atk || 0}`;
      else if (ARMORS[id]) typeLabel = `🛡️ DEF +${item.def || 0} HP +${item.hp || 0}`;
      else if (item.type === 'axe') typeLabel = `🪓 Kapak T${item.tier || 1}`;
      else if (item.type === 'pickaxe') typeLabel = `⛏️ Beliung T${item.tier || 1}`;

      return {
        title: `${item.emoji} ${item.name}`,
        description: typeLabel,
        id: `!rpg equip ${item.alias}`,
      };
    };

    const rows = ownedEq.map(([id]) => mkRow(id)).filter(Boolean);
    const equipText = ui.box('🛡️ PASANG PERALATAN', [
      'Pilih peralatan yang ingin dipasang dari daftar di bawah:',
      ui.bullet('Ketuk nama peralatan untuk langsung memasangnya.'),
    ], 'Ketik: !rpg equip [nama]');

    return sendMenu(sock, msg.key.remoteJid, {
      text: equipText,
      footer: '🛡️ Pilih peralatan yang dimiliki',
      quoted: msg,
      fallbackText: equipText,
      buttons: [listButton('🛡️ Pilih Equip', [{ title: 'Peralatan Dimiliki', rows }])],
    });
  }

  const id = resolveEquipmentId(args.join(' '));
  if (!id) return reply(sock, msg, '❌ Tentukan peralatan!\nContoh: *!rpg equip pedang kayu*');

  const recipe = WEAPONS[id] || ARMORS[id] || TOOLS[id];
  if (!recipe) return reply(sock, msg, `❌ Peralatan tidak ditemukan!`);

  if (!craftedItems[id] || craftedItems[id] <= 0)
    return reply(sock, msg, `❌ Kamu belum memiliki *${recipe.name}*!\nTempa dulu: *!rpg tempa ${recipe.alias}*`);

  const update = {};
  if (WEAPONS[id]) update.equippedWeapon = id;
  else if (ARMORS[id]) update.equippedArmor = id;
  else if (TOOLS[id] && recipe.type === 'axe')     update.equippedAxe = id;
  else if (TOOLS[id] && recipe.type === 'pickaxe') update.equippedPickaxe = id;

  db.updateRpgPlayer(userId, update);
  const stats = getPlayerStats({ ...player, ...update });
  const critPct   = (stats.critChance * 100).toFixed(1).replace(/\.0$/, '');
  const blockPct  = (stats.blockChance * 100).toFixed(0);
  
  const equipDoneText = ui.box('✅ PERALATAN TERPASANG', [
    `${recipe.emoji} *${recipe.name}* dipasang!`,
    ui.kv('⚔️ ATK', stats.atk, 8),
    ui.kv('🛡️ DEF', stats.def, 8),
    ui.kv('❤️ Max HP', stats.maxHp, 8),
    ``,
    `✨ Crit: ${critPct}% | 🛡️ Block: ${blockPct}%`,
    `💰 Reward: +${Math.round((stats.rewardMult - 1) * 100)}%`,
  ]);

  await sendMenu(sock, msg.key.remoteJid, {
    text: equipDoneText,
    footer: '✅ Peralatan berhasil diubah',
    quoted: msg,
    fallbackText: equipDoneText,
    buttons: [
      quickReply('!rpg profil', '👤 Profil'),
      quickReply('!rpg inv', '🎒 Inventori'),
      quickReply('!rpg lawan', '👹 Lawan Monster'),
    ],
  });
}

// ─── INV ─────────────────────────────────────────────────
async function handleRpgInv(sock, msg) {
  const userId = getSenderId(msg);
  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar!');

  const inv     = player.inventory || {};
  const crafted = player.craftedItems || {};

  const lines = [
    `🪵 *MATERIAL*`,
    `Kayu: ${player.wood || 0} | Batu: ${player.stone || 0} | Besi: ${player.iron || 0}`,
    `🪙 Emas: ${player.gold_ingot || 0} | 💎 Berlian: ${player.diamond || 0}`,
    `🛡️ Adamantium: ${player.adamantium || 0} | 🌌 Uru: ${player.uru || 0}`,
    `✨ Mithril: ${player.mithril || 0} | 🔮 Vibranium: ${player.vibranium || 0}`,
    `⚡ Orichalcum: ${player.orichalcum || 0} | 💫 Aetherium: ${player.aetherium || 0}`,
    `🕳️ Dark Matter: ${player.dark_matter || 0} | 🌟 Celestial Core: ${player.celestial_core || 0}`,
    ``,
  ];

  let hasItems = false;
  for (const [id, qty] of Object.entries(inv)) {
    if (qty > 0 && SHOP_ITEMS[id]) {
      lines.push(`• ${SHOP_ITEMS[id].emoji} ${SHOP_ITEMS[id].name}: ${qty}x`);
      hasItems = true;
    }
  }
  if (!hasItems) lines.push('_(kosong)_');

  lines.push('', `⚒️ *PERALATAN DIMILIKI*`);
  let hasCraft = false;
  for (const [id, qty] of Object.entries(crafted)) {
    if (qty > 0) {
      const r = WEAPONS[id] || ARMORS[id] || TOOLS[id];
      if (r) { lines.push(`• ${r.emoji} ${r.name}: ${qty}x`); hasCraft = true; }
    }
  }
  if (!hasCraft) lines.push('_(belum ada)_');

  lines.push('', `🔮 *ESENSI BOSS*`);
  let hasEssence = false;
  for (const e of Object.values(ESSENCE)) {
    const owned = player[e.id] || 0;
    if (owned > 0) { lines.push(`• ${e.emoji} ${e.name}: ${owned}x`); hasEssence = true; }
  }
  if (!hasEssence) lines.push('_(belum ada — kalahkan monster 13-15)_');

  const invText = ui.box('🎒 INVENTORI RPG', lines);
  await sendMenu(sock, msg.key.remoteJid, {
    text: invText,
    footer: '🎒 Kelola inventori RPG',
    quoted: msg,
    fallbackText: invText,
    buttons: [
      quickReply('!rpg tempa', '⚒️ Tempa'),
      quickReply('!rpg jual', '💸 Jual Material'),
      quickReply('!rpg shop', '🏪 Toko'),
    ],
  });
}

// ─── JUAL MATERIAL ───────────────────────────────────────
async function handleRpgJual(sock, msg, args) {
  const userId = getSenderId(msg);
  let player   = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG.');

  // Nama material bisa multi-kata; jumlah = arg terakhir (angka / all / semua)
  const lastArg  = args[args.length - 1];
  const lastIsQty = lastArg !== undefined && (parsePositiveAmount(lastArg) !== null || isAllAmount(lastArg));
  let target     = args.slice(0, lastIsQty ? args.length - 1 : args.length).join(' ').toLowerCase();
  let qtyRaw     = lastIsQty ? lastArg.toLowerCase() : null;

  // "all" / "semua" di posisi target = jual semua material, bukan sebagai jumlah
  if (!target && qtyRaw && ['all', 'semua'].includes(qtyRaw)) {
    target = qtyRaw;
    qtyRaw = null;
  }
  const rawAmount = qtyRaw || '';

  const sellable = Object.entries(MATERIALS);
  const allOwned = sellable.filter(([id]) => (player[id] || 0) > 0);

  // ─── TANPA ARGUMEN: Dropdown pilih material ───
  if (!target) {
    if (!allOwned.length)
      return reply(sock, msg, '❌ Tidak ada material untuk dijual!\nDapatkan material dari *!rpg tebang* / *!rpg tambang*.');
    const lines = [
      `Pilih item yang ingin dijual:`,
      ``,
    ];
    const sections = [
      { title: '🏷️ Jual Semua', rows: [{ title: '🔁 Jual Semua', description: `Semua ${allOwned.length} jenis material`, id: '!rpg jual all' }] },
      { title: '📦 Material', rows: allOwned.map(([id, mat]) => ({
        title: `${mat.emoji} ${mat.name}`,
        description: `${formatNum(player[id])}x → ${formatNum(mat.sellPrice)}`,
        id: `!rpg jual ${mat.name}`,
      })) },
    ];
    for (const [id, mat] of allOwned) {
      lines.push(ui.bullet(`[${mat.alias}] ${mat.emoji} *${mat.name}*: ${formatNum(player[id])}x → *${formatNum(mat.sellPrice)} Money*`));
    }
    lines.push('', `CARA JUAL`, ui.bullet('*!rpg jual all* — jual semua item'), ui.bullet('*!rpg jual [item]* — pilih jumlah'), ui.bullet('*!rpg jual [item] [jumlah]* — jual sesuai jumlah'), ui.bullet('*!rpg jual [item] all* — jual semua item itu'), ui.bullet('Contoh nama multi-kata: *!rpg jual dark matter 3*'));
    const box = ui.box('💰 JUAL MATERIAL', lines);
    return sendMenu(sock, msg.key.remoteJid, {
      text: box,
      footer: '💰 Pilih material untuk dijual',
      quoted: msg,
      fallbackText: box,
      buttons: [listButton('💰 Jual Material', sections)],
    });
  }

  // ─── JUAL SEMUA MATERIAL ───
  if (target === 'all' || target === 'semua') {
    if (!allOwned.length) return reply(sock, msg, '❌ Tidak ada material untuk dijual!');
    let total = 0;
    const sold = [];
    for (const [id, mat] of allOwned) {
      const qty = player[id];
      const earn = qty * mat.sellPrice;
      total += earn;
      player[id] = 0;
      sold.push(`${mat.emoji} ${mat.name}: ${formatNum(qty)}x → ${formatNum(earn)} Money`);
    }
    db.updateRpgPlayer(userId, player);
    db.addMoney(userId, total);
    return reply(sock, msg, ui.box('✅ JUAL SEMUA MATERIAL', [
      ...sold,
      '',
      ui.kv('💰 Total', `*+${formatNum(total)} Money*`),
      ui.kv('💰 Sisa', `*${formatNum(db.getUserMoney(userId))}*`),
    ]));
  }

  const matKey = resolveMaterialId(target);
  const mat = matKey ? MATERIALS[matKey] : null;
  if (!mat)
    return reply(sock, msg, `❌ Item *${target}* tidak dikenal!\nCek item yang kamu punya: *!rpg jual*`);

  // ─── TANPA JUMLAH → PROMPT ───
  if (!rawAmount) {
    const owned = player[matKey] || 0;
    if (owned <= 0) return reply(sock, msg, `❌ Kamu tidak punya *${mat.name}* untuk dijual.`);
    const promptText = `❓ Jual *${mat.emoji} ${mat.name}* berapa? (maks ${formatNum(owned)})\n\nBalas ketik *!rpg jual ${mat.name} [jumlah]*, ketik *all* utk semua, atau tap tombol di bawah.`;
    const msgId = await sendMenu(sock, msg.key.remoteJid, {
      text: promptText,
      footer: `💰 ${mat.name}`,
      quoted: msg,
      fallbackText: promptText,
      buttons: [quickReply(`!rpg jual ${mat.name} all`, '📦 Jual Semua')],
    });
    if (msgId) rememberRpgSellPrompt({ key: { id: msgId } }, userId, matKey);
    return;
  }

  // ─── TENTUKAN JUMLAH ───
  let amount;
  if (rawAmount === 'all' || rawAmount === 'semua') {
    amount = player[matKey] || 0;
  } else {
    amount = Math.max(1, parsePositiveAmount(rawAmount) || 1);
  }

  if (amount <= 0) return reply(sock, msg, `❌ Kamu tidak punya *${mat.name}* untuk dijual.`);
  if ((player[matKey] || 0) < amount)
    return reply(sock, msg, `❌ Kamu hanya punya *${formatNum(player[matKey] || 0)}* ${mat.name}.`);

  const earn = amount * mat.sellPrice;
  player[matKey] -= amount;
  db.updateRpgPlayer(userId, player);
  db.addMoney(userId, earn);

  return reply(sock, msg, ui.box('✅ TERJUAL', [
    `${mat.emoji} ${mat.name} x${formatNum(amount)}`,
    ui.kv('💰 Dapat', `*+${formatNum(earn)} Money*`),
    ui.kv('💰 Sisa', `*${formatNum(db.getUserMoney(userId))}*`),
  ]));
}

// ─── TOP ─────────────────────────────────────────────────
async function handleRpgTop(sock, msg) {
  const all = db.getAllRpgPlayers();
  const power = (p) => {
    const s = getPlayerStats(p);
    return s.atk + s.def * 0.5 + s.maxHp;
  };
  const sorted = all
    .map(p => ({ p, score: power(p) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const la = getLevelFromExp(a.p.exp), lb = getLevelFromExp(b.p.exp);
      if (lb !== la) return lb - la;
      return b.p.exp - a.p.exp;
    })
    .slice(0, 10);

  const lines = [];
  const medals = ['🥇', '🥈', '🥉'];
  sorted.forEach(({ p, score }, i) => {
    const s = getPlayerStats(p);
    const lv = getLevelFromExp(p.exp);
    lines.push(`${medals[i] || `${i + 1}.`} *${p.name}* — 💪${formatNum(Math.floor(score))} | ⚔️${formatNum(s.atk)} 🛡️${formatNum(s.def)} ❤️${formatNum(s.maxHp)} | Lv.${lv} | 🏆${p.wins}W`);
  });

  await reply(sock, msg, ui.box('🏆 RPG LEADERBOARD', lines));
}

// ─── INFO MATERIAL ───────────────────────────────────────
function sumberMaterial(key) {
  const m = MATERIALS[key];
  const sumber = [];

  if (key === 'wood') {
    sumber.push('Tebang pohon (!rpg tebang)');
  } else if (key === 'stone') {
    sumber.push('Tambang (!rpg tambang)');
  } else if (MINE_TABLE[key]) {
    sumber.push(`Tambang (!rpg tambang, cangkul T${MINE_TABLE[key].gate}+)`);
  }

  for (const e of Object.values(ESSENCE)) {
    if (e.fusesTo === key) {
      sumber.push(`Fusi ${e.needed} ${e.name} (boss ${e.monsterLevel})`);
    }
  }
  if (m.canBuy) sumber.push('Toko material');

  for (const b of Object.values(RAID_BOSSES)) {
    if (b.drop === key) sumber.push(`Raid ${b.name} (!rpg raid)`);
  }

  return sumber.length ? sumber.join(' | ') : '—';
}

async function handleRpgInfo(sock, msg, args) {
  const sub    = (args[0] || '').toLowerCase();
  const target = args.slice(1).join(' ');

  // ─── DAFTAR MATERIAL ───────────────────────────────────
  if (sub === 'material' && !target) {
    const lines = [
      `Ketik *!rpg info material [nama]* untuk detail.`,
      ``,
    ];
    const sorted = Object.entries(MATERIALS).sort((a, b) => a[1].tier - b[1].tier);
    for (const [key, m] of sorted) {
      const beli = m.canBuy ? `Beli:${formatNum(m.price)}` : 'tidak bisa dibeli';
      lines.push(`• ${m.emoji} *${m.name}* — T${m.tier} | ${beli} | Jual:${formatNum(m.sellPrice)} | 📦 ${sumberMaterial(key)}`);
    }
    return reply(sock, msg, ui.box('📦 INFO MATERIAL', lines));
  }

  // ─── DETAIL MATERIAL ───────────────────────────────────
  if (sub === 'material' && target) {
    const key = resolveMaterialId(target);
    if (!key) return reply(sock, msg, `❌ Material *${target}* tidak dikenal!`);
    const m = MATERIALS[key];
    const lines = [
      `${m.emoji} *${m.name}* — Tier ${m.tier}`,
      ``,
      ui.kv('💰 Harga Beli', m.canBuy ? formatNum(m.price) : '— (tidak bisa dibeli)'),
      ui.kv('💰 Harga Jual', formatNum(m.sellPrice)),
      ui.kv('🏷️ Bisa Dibeli', m.canBuy ? '✅ Ya' : '❌ Tidak'),
      ui.kv('📦 Sumber', sumberMaterial(key)),
    ];
    return reply(sock, msg, ui.box('📦 INFO MATERIAL', lines));
  }

  return reply(sock, msg, '❌ Sub-info tidak dikenal.\nGunakan: *!rpg info material* atau *!rpg info material [nama]*');
}

// ─── EXPORTS ─────────────────────────────────────────────
module.exports = {
  handleRpgMenu,
  handleRpgProfile,
  handleRpgChop,
  handleRpgMine,
  handleRpgFight,
  handleRpgDuel,
  handleRpgAcceptDuel,
  handleRpgRejectDuel,
  handleRpgAttack,
  handleRpgFlee,
  handleRpgShop,
  handleRpgBuy,
  handleRpgUse,
  handleRpgCraft,
  handleRpgFusi,
  handleRpgEquip,
  handleRpgInv,
  handleRpgJual,
  handleRpgTop,
  handleRpgInfo,
  rpgSellPrompts,
  rpgBuyPrompts,
  rpgUsePrompts,
};
