// ============================================================
// RPG RAID GROUP (1-6 pemain vs boss)
// ============================================================
const db = require('../../../data/db');
const {
  RAID_BOSSES, MATERIALS, WEAPONS, ARMORS,
  RAID_MIN_PLAYERS, RAID_MAX_PLAYERS, RAID_MAX_ROUNDS,
  RAID_JOIN_WINDOW, RAID_TURN_TIMEOUT,
} = require('../../../data/rpgData');
const {
  getPlayerStats, calcDamage, makeHpBar, applySkill, formatNum,
} = require('../../../game/rpgEngine');
const ui = require('../../../utils/ui');
const { quickReply, sendMenu, listButton } = require('../../../utils/buttons');
const { resolveJid } = require('../../../utils/jid');

function getSenderId(msg) {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  return resolveJid(isGroup ? msg.key.participant : msg.key.remoteJid);
}

function reply(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
}

// Gate tier gear: senjata & zirah wajib, tier min = boss.level - 5
function checkRaidGear(player, boss) {
  const weapon = player?.equippedWeapon ? WEAPONS[player.equippedWeapon] : null;
  const armor  = player?.equippedArmor ? ARMORS[player.equippedArmor] : null;
  if (!weapon || !armor) return { ok: false, reason: '❌ Senjata & zirah wajib di-equip untuk raid!' };
  const reqTier = boss.level - 5;
  const gearTier = Math.min(weapon.tier, armor.tier);
  if (gearTier < reqTier)
    return { ok: false, reason: `❌ Gear kurang! Butuh min T${reqTier} (senjata & zirah). Kamu: Senjata T${weapon.tier} / Zirah T${armor.tier}.` };
  return { ok: true };
}

// ─── ROUTER RAID ─────────────────────────────────────────
async function handleRaid(sock, msg, args) {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith('@g.us');
  if (!isGroup) return reply(sock, msg, '⚠️ Raid hanya bisa di grup!');

  const sub = (args[0] || '').toLowerCase();

  switch (sub) {
    case 'help':
      return reply(sock, msg, ui.box('👹 RAID GUIDE', [
        ui.cmd('!rpg raid', 'Lihat menu raid'),
        ui.cmd('!rpg raid mulai [boss]', 'Mulai raid (pilih boss 3)'),
        ui.cmd('!rpg raid join', 'Gabung raid (1-6 pemain)'),
        ui.cmd('!rpg raid serang', 'Serang boss di giliranmu'),
        ui.cmd('!rpg raid skill [nama]', 'Serang pakai skill'),
        ui.cmd('!rpg raid info', 'Status boss & giliran'),
        ui.cmd('!rpg raid kabur', 'Keluar dari raid'),
      ], 'Raid boss 1-6 pemain. Semua peserta menang dapat material + reward.'));
    case 'mulai':
    case 'start':
      return handleRaidStart(sock, msg, args.slice(1));
    case 'join':
    case 'gabung':
      return handleRaidJoin(sock, msg);
    case 'serang':
    case 'attack':
      return handleRaidAttack(sock, msg, args.slice(1));
    case 'skill':
      return handleRaidSkill(sock, msg, args.slice(1));
    case 'info':
    case 'status':
      return handleRaidInfo(sock, msg);
    case 'kabur':
    case 'flee':
    case 'leave':
      return handleRaidLeave(sock, msg);
    default:
      return handleRaidMenu(sock, msg, args);
  }
}

// ─── MENU RAID ───────────────────────────────────────────
async function handleRaidMenu(sock, msg, args = []) {
  const chatId = msg.key.remoteJid;
  const raid   = db.getRpgRaid(chatId);
  if (!raid) {
    const rows = Object.values(RAID_BOSSES).map(b => ({
      title: `${b.emoji} Lv.${b.level} ${b.name}`,
      description: `❤️ ${formatNum(b.hp)} | ⚔️ ${formatNum(b.atk)} | 🎁 ${MATERIALS[b.drop]?.name}`,
      id: `!rpg raid mulai ${b.id}`,
    }));
    const lines = [
      `Raid boss untuk 1-${RAID_MAX_PLAYERS} pemain.`,
      `Semua peserta menang dapat *${Object.values(RAID_BOSSES).map(b => MATERIALS[b.drop].emoji).join('')} material endgame*!`,
      '',
      'Pilih boss untuk mulai:',
    ];
    return sendMenu(sock, chatId, {
      text: ui.box('👹 RAID MENU', lines),
      footer: '👹 Pilih boss',
      quoted: msg,
      fallbackText: ui.box('👹 RAID MENU', lines),
      buttons: [listButton('👹 Boss', [{ title: 'Boss Raid', rows }])],
    });
  }
  return handleRaidInfo(sock, msg);
}

// ─── MULAI RAID ──────────────────────────────────────────
async function handleRaidStart(sock, msg, args) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG!');

  const existing = db.getRpgRaid(chatId);
  if (existing) return reply(sock, msg, '⚠️ Masih ada raid aktif di grup ini!\nKetik *!rpg raid info* untuk melihat status.');

  const bossId = (args[0] || '').toLowerCase();
  if (!RAID_BOSSES[bossId]) return reply(sock, msg, `❌ Pilih boss dulu!\nBoss: ${Object.values(RAID_BOSSES).map(b => `${b.id} (${b.name})`).join(', ')}\nContoh: *!rpg raid mulai dragon*`);
  const boss = RAID_BOSSES[bossId];

  const gate = checkRaidGear(player, boss);
  if (!gate.ok) return reply(sock, msg, gate.reason);

  db.setRpgRaid(chatId, {
    bossId,
    boss,
    bossHp: boss.hp,
    status: 'menunggu',
    hostId: userId,
    hostName: player.name,
    players: [userId],
    playerNames: { [userId]: player.name },
    playerStats: {},
    createdAt: Date.now(),
    skillCooldowns: {},
  });

  await sendMenu(sock, chatId, {
    text: ui.box('👹 RAID DIMULAI', [
      `${boss.emoji} *${boss.name}* (Lv.${boss.level})`,
      `❤️ HP: ${formatNum(boss.hp)} | ⚔️ ATK: ${formatNum(boss.atk)}`,
      '',
      `🧑 *${player.name}* membuka raid!`,
      `Ketik *!rpg raid join* untuk gabung (1-${RAID_MAX_PLAYERS} pemain).`,
      `⏰ 1 menit untuk join.`,
    ]),
    fallbackText: ui.box('👹 RAID DIMULAI', [
      `${boss.emoji} *${boss.name}* (Lv.${boss.level})`,
      `❤️ HP: ${formatNum(boss.hp)} | ⚔️ ATK: ${formatNum(boss.atk)}`,
      '',
      `🧑 *${player.name}* membuka raid!`,
      `Ketik *!rpg raid join* untuk gabung (1-${RAID_MAX_PLAYERS} pemain).`,
      `⏰ 1 menit untuk join.`,
    ]),
    buttons: [quickReply('!rpg raid join', '🤝 Gabung')],
    quoted: msg,
  });

  // Auto-bubar jika tak cukup pemain dalam 1 menit
  setTimeout(async () => {
    const cur = db.getRpgRaid(chatId);
    if (!cur || cur.status !== 'menunggu') return;
    if (cur.players.length < RAID_MIN_PLAYERS) {
      db.clearRpgRaid(chatId);
      await sock.sendMessage(chatId, { text: `👹 Raid *${boss.name}* dibatalkan — pemain kurang dari ${RAID_MIN_PLAYERS}.` });
    } else {
      db.setRpgRaid(chatId, { ...cur, status: 'aktif', turnIdx: 0, round: 0, lastTurnAt: Date.now() });
      await sendMenu(sock, chatId, {
        text: ui.box('👹 RAID DIMULAI!', [
          `🎲 Giliran *${cur.playerNames[cur.players[0]]}* — ketik *!rpg raid serang*!`,
          `⚔️ Sisa ronde: ${RAID_MAX_ROUNDS}.`,
        ]),
        fallbackText: ui.box('👹 RAID DIMULAI!', [
          `🎲 Giliran *${cur.playerNames[cur.players[0]]}* — ketik *!rpg raid serang*!`,
          `⚔️ Sisa ronde: ${RAID_MAX_ROUNDS}.`,
        ]),
        buttons: [
          quickReply('!rpg raid serang', '⚔️ Serang'),
          quickReply('!rpg raid kabur', '🏃 Kabur'),
        ],
      });
    }
  }, RAID_JOIN_WINDOW);
}

// ─── JOIN RAID ───────────────────────────────────────────
async function handleRaidJoin(sock, msg) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const raid   = db.getRpgRaid(chatId);
  if (!raid) return reply(sock, msg, '❌ Tidak ada raid aktif di grup ini!\nMulai: *!rpg raid mulai*');
  if (raid.status !== 'menunggu') return reply(sock, msg, '⏳ Raid sudah dimulai! Tidak bisa join lagi.');

  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG!');
  if (raid.players.includes(userId)) return reply(sock, msg, '✅ Kamu sudah tergabung!');

  const gate = checkRaidGear(player, raid.boss);
  if (!gate.ok) return reply(sock, msg, gate.reason);

  if (raid.players.length >= RAID_MAX_PLAYERS)
    return reply(sock, msg, `❌ Pemain sudah penuh (${RAID_MAX_PLAYERS})!`);

  raid.players.push(userId);
  raid.playerNames[userId] = player.name;
  db.setRpgRaid(chatId, raid);

  await reply(sock, msg, `${player.name} bergabung! Peserta: *${raid.players.length}/${RAID_MAX_PLAYERS}*.`);
}

// ─── INFO RAID ───────────────────────────────────────────
async function handleRaidInfo(sock, msg) {
  const chatId = msg.key.remoteJid;
  const raid   = db.getRpgRaid(chatId);
  if (!raid) return reply(sock, msg, '❌ Tidak ada raid aktif di grup ini!\nMulai: *!rpg raid mulai*');

  const b = raid.boss;
  const lines = [
    `${b.emoji} *${b.name}*`,
    ui.kv('❤️ HP', `${formatNum(raid.bossHp)}/${formatNum(b.hp)} ${makeHpBar(raid.bossHp, b.hp)}`),
    ui.kv('💣 Status', raid.status === 'menunggu' ? '⏳ Menunggu pemain' : '⚔️ Berlangsung'),
    ui.kv('🎮 Peserta', raid.players.map(j => raid.playerNames[j]).join(', ')),
  ];
  if (raid.status === 'aktif') {
    const cur = raid.players[raid.turnIdx || 0];
    lines.push(ui.kv('🎲 Giliran', raid.playerNames[cur] || '?'));
    lines.push(ui.kv('⚔️ Ronde', `${raid.round + 1}/${RAID_MAX_ROUNDS}`));
    lines.push('', ui.cmd('!rpg raid serang', 'Serang boss'), ui.cmd('!rpg raid kabur', 'Keluar'));
  } else {
    lines.push('', ui.cmd('!rpg raid join', 'Gabung raid'));
  }
  return reply(sock, msg, ui.box('👹 RAID', lines));
}

// ─── SERANG BOSS ─────────────────────────────────────────
async function handleRaidAttack(sock, msg, args) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const raid   = db.getRpgRaid(chatId);
  if (!raid || raid.status !== 'aktif') return reply(sock, msg, '❌ Tidak ada raid aktif yang berlangsung!');

  if (Date.now() - raid.lastTurnAt > RAID_TURN_TIMEOUT && raid.status === 'aktif') {
    const log = [`⏰ *${raid.playerNames[raid.players[raid.turnIdx || 0]]}* timeout!`, `   Damage dianggap nol, giliran dilewati.`];
    return finishTurn(sock, chatId, raid, log, null);
  }
  const turnIdx = raid.turnIdx || 0;
  const turnJid = raid.players[turnIdx];
  if (userId !== turnJid) return reply(sock, msg, `❌ Bukan giliranmu! Giliran *${raid.playerNames[turnJid]}*.`);

  const stats = getPlayerStats(db.getRpgPlayer(userId));
  raid.playerStats[userId] = stats;

  const res = calcDamage(stats.atk, raid.boss.def, { critChance: stats.critChance, blockChance: 0 });
  raid.bossHp = Math.max(0, raid.bossHp - res.dmg);
  const log = [`${raid.boss.emoji} ${raid.playerNames[userId]} *-${res.dmg}*${res.crit ? ' ✨Kritis!' : ''} | Boss HP: ${makeHpBar(raid.bossHp, raid.boss.hp)}`];
  db.setRpgRaid(chatId, raid);

  if (raid.bossHp <= 0) return finishRaid(sock, chatId, raid, 'win', log);
  return finishTurn(sock, chatId, raid, log, null);
}

// ─── SERANG PAKAI SKILL ──────────────────────────────────
async function handleRaidSkill(sock, msg, args) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const raid   = db.getRpgRaid(chatId);
  if (!raid || raid.status !== 'aktif') return reply(sock, msg, '❌ Tidak ada raid aktif yang berlangsung!');

  if (Date.now() - raid.lastTurnAt > RAID_TURN_TIMEOUT) {
    return finishTurn(sock, chatId, raid, [`⏰ *${raid.playerNames[raid.players[raid.turnIdx || 0]]}* timeout! Giliran dilewati.`], null);
  }

  const turnIdx = raid.turnIdx || 0;
  const turnJid = raid.players[turnIdx];
  if (userId !== turnJid) return reply(sock, msg, `❌ Bukan giliranmu! Giliran *${raid.playerNames[turnJid]}*.`);

  const input = args.join(' ');
  const cls = db.getRpgPlayer(userId)?.class;
  const { SKILLS, CLASSES, resolveSkillId } = require('../../../data/rpgData');
  const skillId = resolveSkillId(input);
  const classSkills = cls ? CLASSES[cls].skills : [];
  if (!skillId || !classSkills.includes(skillId))
    return reply(sock, msg, `❌ Pilih skill kelasmu!\nSkill: ${classSkills.length ? classSkills.map(s => SKILLS[s].name).join(', ') : '(belum punya kelas — pilih !rpg kelas)'}`);

  const cds = raid.skillCooldowns || {};
  const cd = cds[`${userId}:${skillId}`] || 0;
  if (cd > 0) return reply(sock, msg, `⏳ Skill cooldown ${cd} giliran lagi!`);

  const stats = getPlayerStats(db.getRpgPlayer(userId));
  raid.playerStats[userId] = stats;
  const res = applySkill(SKILLS[skillId], stats, { def: raid.boss.def });
  let log;
  if (res.heal > 0) {
    // Heal di raid memulihkan seluruh peserta berdasarkan MaxHP masing-masing (tidak menyerang boss)
    const power = (SKILLS[skillId].power || 1) * (stats.skillPower || 1) * (1 + (stats.healBonus || 0));
    const healed = [];
    for (const jid of raid.players) {
      const p = db.getRpgPlayer(jid);
      if (!p) continue;
      const pStats = getPlayerStats(p);
      const healAmt = Math.floor(pStats.maxHp * power);
      db.updateRpgPlayer(jid, { currentHp: Math.min(pStats.maxHp, (p.currentHp || 0) + healAmt) });
      healed.push(`${raid.playerNames[jid]} 💗 +${formatNum(healAmt)}`);
    }
    log = [`${SKILLS[skillId].emoji} *${raid.playerNames[userId]}* ${SKILLS[skillId].name}: seluruh tim dipulihkan!\n   ${healed.join('\n   ')}`];
  } else {
    raid.bossHp = Math.max(0, raid.bossHp - res.dmg);
    log = [`${SKILLS[skillId].emoji} *${raid.playerNames[userId]}* ${SKILLS[skillId].name}: -${res.dmg}${res.crit ? ' ✨Kritis!' : ''} | Boss HP: ${makeHpBar(raid.bossHp, raid.boss.hp)}`];
  }
  cds[`${userId}:${skillId}`] = SKILLS[skillId].cooldown;
  raid.skillCooldowns = cds;
  db.setRpgRaid(chatId, raid);

  if (raid.bossHp <= 0) return finishRaid(sock, chatId, raid, 'win', log);
  return finishTurn(sock, chatId, raid, log, null);
}

// ─── GANTI GILIRAN ───────────────────────────────────────
// Serangan boss + advance giliran + cek boss kalah/seri
async function finishTurn(sock, chatId, raid, log, opts) {
  const turnIdx = raid.turnIdx || 0;
  const curJid  = raid.players[turnIdx];
  const originalLen = raid.players.length;

  // Boss membalas penyerang
  const curStats = raid.playerStats[curJid] || getPlayerStats(db.getRpgPlayer(curJid));
  const bossAtk  = calcDamage(raid.boss.atk, curStats.def, { critChance: 0.10, blockChance: curStats.blockChance });
  const player = db.getRpgPlayer(curJid);
  const maxHp = player ? getPlayerStats(player).maxHp : curStats.maxHp;
  const curHp = player?.currentHp || maxHp;
  const newHpVal = Math.max(0, curHp - bossAtk.dmg);
  db.updateRpgPlayer(curJid, { currentHp: newHpVal });

  let died = false;
  if (newHpVal <= 0) {
    died = true;
    log.push(`💀 ${raid.boss.emoji} ${raid.boss.name}: *-${bossAtk.dmg}* | ☠️ *${raid.playerNames[curJid]}* GUGUR!`);
    raid.players = raid.players.filter(j => j !== curJid);
    delete raid.playerNames[curJid];
  } else {
    log.push(`${raid.boss.emoji} ${raid.boss.name}: *-${bossAtk.dmg}* | HP *${raid.playerNames[curJid]}* tersisa ${Math.round(newHpVal / maxHp * 100)}%`);
  }

  // Gandakan cooldown skill di akhir giliran
  for (const [key, cd] of Object.entries(raid.skillCooldowns || {})) {
    if (key.startsWith(`${curJid}:`)) raid.skillCooldowns[key] = Math.max(0, cd - 1);
  }

  // Advance giliran (hitung ulang jika ada yang gugur)
  if (raid.players.length === 0) {
    db.setRpgRaid(chatId, { ...raid, status: 'selesai' });
    return finishRaid(sock, chatId, raid, 'lose', [...log, `☠️ Semua peserta gugur!`]);
  }
  if (raid.players.length < RAID_MIN_PLAYERS) {
    db.setRpgRaid(chatId, { ...raid, status: 'selesai' });
    return finishRaid(sock, chatId, raid, 'lose', [...log, `👥 Peserta sisa kurang dari ${RAID_MIN_PLAYERS} — raid gagal.`]);
  }

  let nextIdx, round;
  if (died) {
    const wasLast = (turnIdx === originalLen - 1);
    nextIdx = wasLast ? 0 : turnIdx;
    round = wasLast ? (raid.round || 0) + 1 : (raid.round || 0);
  } else {
    nextIdx = (turnIdx + 1) % raid.players.length;
    round = turnIdx === raid.players.length - 1 ? (raid.round || 0) + 1 : (raid.round || 0);
  }

  if (round >= RAID_MAX_ROUNDS) {
    const pct = raid.bossHp / raid.boss.hp;
    db.setRpgRaid(chatId, { ...raid, status: 'selesai' });
    const result = pct < 0.5 ? 'win' : 'lose';
    return finishRaid(sock, chatId, raid, result, [...log, `${raid.boss.emoji} Boss HP sisa ${Math.round(pct * 100)}%. ${result === 'win' ? 'Boss melemah!' : 'Boss terlalu kuat!'}`]);
  }

  raid.turnIdx = nextIdx;
  raid.round = round;
  raid.lastTurnAt = Date.now();
  db.setRpgRaid(chatId, raid);

  const nextName = raid.playerNames[raid.players[nextIdx]];
  await sendMenu(sock, chatId, {
    text: ui.box('👹 RAID', [
      ...log,
      '',
      `🎲 Giliran *${nextName}* — *!rpg raid serang* / *!rpg raid skill [nama]*`,
      `⚔️ Ronde ${round + 1}/${RAID_MAX_ROUNDS}`,
    ]),
    fallbackText: ui.box('👹 RAID', [
      ...log,
      '',
      `🎲 Giliran *${nextName}* — *!rpg raid serang* / *!rpg raid skill [nama]*`,
      `⚔️ Ronde ${round + 1}/${RAID_MAX_ROUNDS}`,
    ]),
    buttons: [
      quickReply('!rpg raid serang', '⚔️ Serang'),
      quickReply('!rpg raid kabur', '🏃 Kabur'),
    ],
  });
}

// ─── KABUR DARI RAID ─────────────────────────────────────
async function handleRaidLeave(sock, msg) {
  const chatId = msg.key.remoteJid;
  const userId = getSenderId(msg);
  const raid   = db.getRpgRaid(chatId);
  if (!raid) return reply(sock, msg, '❌ Tidak ada raid aktif di grup ini!');

  if (!raid.players.includes(userId)) return reply(sock, msg, '❌ Kamu tidak ada di raid ini.');

  raid.players = raid.players.filter(j => j !== userId);
  delete raid.playerNames[userId];
  if (raid.players.length < RAID_MIN_PLAYERS) {
    db.clearRpgRaid(chatId);
    return reply(sock, msg, `🚪 *${msg.pushName || 'Pemain'}* keluar. Raid dibubarkan — peserta kurang dari ${RAID_MIN_PLAYERS}.`);
  }
  if (raid.turnIdx >= raid.players.length) raid.turnIdx = 0;
  db.setRpgRaid(chatId, raid);
  return reply(sock, msg, `🚪 Peserta keluar. Sisa: *${raid.players.length}/${RAID_MAX_PLAYERS}*.`);
}

// ─── SELESAI RAID (menang/kalah) ─────────────────────────
async function finishRaid(sock, chatId, raid, result, log) {
  const b = raid.boss;
  db.clearRpgRaid(chatId);

  if (result === 'win') {
    const drop = MATERIALS[b.drop];
    const perPlayer = [
      `Selamat! ${raid.players.length} pemain mengalahkan ${b.emoji} *${b.name}*!`,
    ];
    for (const jid of raid.players) {
      const p = db.getRpgPlayer(jid);
      if (!p) continue;
      p.exp = (p.exp || 0) + b.expReward;
      const jumlahDrop = jid === raid.hostId ? 2 : 1;
      p[b.drop] = (p[b.drop] || 0) + jumlahDrop;
      db.addMoney(jid, b.goldReward);
      db.updateRpgPlayer(jid, {
        exp: p.exp,
        [b.drop]: p[b.drop],
        currentHp: Math.max(1, Math.floor((db.getRpgPlayer(jid)?.currentHp || 1) * 0.7)),
        monstersKilled: (p.monstersKilled || 0) + 1,
      });
      perPlayer.push(`• ${raid.playerNames[jid]}: ${drop.emoji} ${jumlahDrop} ${drop.name} + ${formatNum(b.goldReward)} Money`);
    }
    return sock.sendMessage(chatId, { text: ui.box('👹 RAID MENANG', [...log, '', ...perPlayer]) });
  }

  await sock.sendMessage(chatId, { text: ui.box('👹 RAID GAGAL', [
    ...log,
    '',
    `Boss ${b.emoji} *${b.name}* terlalu kuat. Coba lagi nanti.`,
    `Semua peserta pullihkan HP 20%.`,
  ]) });
  for (const jid of raid.players) {
    const p = db.getRpgPlayer(jid);
    if (!p) continue;
    const stats = getPlayerStats(p);
    db.updateRpgPlayer(jid, { currentHp: Math.max(1, Math.floor(stats.maxHp * 0.2)) });
  }
  return true;
}

module.exports = { handleRaid };