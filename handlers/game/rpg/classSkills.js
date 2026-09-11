// ============================================================
// RPG KELAS & SKILL HANDLER
// ============================================================
const db = require('../../../data/db');
const {
  CLASSES, SKILLS, KONTRAK_KELAS,
  resolveClassId, resolveSkillId,
} = require('../../../data/rpgData');
const { getPlayerStats } = require('../../../game/rpgEngine');
const ui = require('../../../utils/ui');
const { sendMenu, listButton } = require('../../../utils/buttons');
const { resolveJid } = require('../../../utils/jid');

function getSenderId(msg) {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  return resolveJid(isGroup ? msg.key.participant : msg.key.remoteJid);
}

function reply(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
}

// ─── MENU KELAS & PILIH / GANTI KELAS ────────────────────
async function handleRpgClass(sock, msg, args) {
  const userId = getSenderId(msg);
  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG!');

  const sub = (args[0] || '').toLowerCase();
  const clsId = resolveClassId(sub);

  // Tanpa argumen → tampilkan kelas saat ini + dropdown kelas
  if (!sub && !clsId) {
    const cur = player.class ? CLASSES[player.class] : null;
    const rows = Object.values(CLASSES).map(c => ({
      title: `${c.emoji} ${c.name}`,
      description: c.desc,
      id: `!rpg kelas ${c.id}`,
    }));
    const lines = [
      cur
        ? `Kelas kamu: ${cur.emoji} *${cur.name}*\nKetuk kelas lain untuk ganti.\n💸 ${formatBiaya(player)} Money + 1 ${KONTRAK_KELAS.emoji} ${KONTRAK_KELAS.name}`
        : `Pilih kelas pertamamu (gratis):`,
      ``,
    ];
    return sendMenu(sock, msg.key.remoteJid, {
      text: ui.box('🎭 PILIH KELAS', lines),
      footer: '🎭 Pilih kelas',
      quoted: msg,
      fallbackText: ui.box('🎭 PILIH KELAS', lines),
      buttons: [listButton('🎭 Kelas', [{ title: 'Kelas Tersedia', rows }])],
    });
  }

  const target = resolveClassId(sub);
  if (!target) return reply(sock, msg, `❌ Kelas *${sub}* tidak dikenal!\nKelas: ${Object.values(CLASSES).map(c => `${c.emoji} ${c.name}`).join(', ')}`);

  // Pertama kali → gratis
  if (!player.class) {
    db.updateRpgPlayer(userId, { class: target, activeSkill: null });
    return reply(sock, msg, ui.box('🎭 KELAS DIPILIH', [
      `${CLASSES[target].emoji} Kamu kini *${CLASSES[target].name}*!`,
      ui.bullet(`Keunggulan: ${CLASSES[target].desc}`),
      '',
      ui.bullet('Pilih skill aktif: *!rpg skill*'),
    ]));
  }

  // Ganti kelas → butuh kontrak + money (progresif)
  const inv = player.inventory || {};
  if (!inv[KONTRAK_KELAS.id] || inv[KONTRAK_KELAS.id] < 1)
    return reply(sock, msg, `❌ Butuh 1 ${KONTRAK_KELAS.emoji} ${KONTRAK_KELAS.name} untuk ganti kelas.\n` +
      `💰 Bisa dibeli di *!rpg shop* atau dapatkan dari raid!`);
  const biaya = biayaGantiKelas(player.classChanges);
  if (db.getUserMoney(userId) < biaya)
    return reply(sock, msg, `❌ Money tidak cukup! Biaya ganti kelas *${ui.money(biaya)}* (punya ${ui.money(db.getUserMoney(userId))}).`);

  inv[KONTRAK_KELAS.id] -= 1;
  db.deductMoney(userId, biaya);
  db.updateRpgPlayer(userId, {
    class: target,
    activeSkill: null,
    inventory: inv,
    classChanges: (player.classChanges || 0) + 1,
  });
  const stats = getPlayerStats({ ...player, class: target });
  return reply(sock, msg, ui.box('🎭 GANTI KELAS', [
    `${CLASSES[player.class].emoji} *${CLASSES[player.class].name}* → ${CLASSES[target].emoji} *${CLASSES[target].name}*`,
    ui.kv('💰 Biaya', `-${formatNum(biaya)} Money`),
    ui.bullet(`+ 1 ${KONTRAK_KELAS.emoji} ${KONTRAK_KELAS.name}`),
    ui.kv('⚔️ ATK', stats.atk),
    ui.kv('✨ Crit', `${(stats.critChance * 100).toFixed(0)}%`),
    '',
    ui.bullet('Pilih skill aktif: *!rpg skill*'),
  ]));
}

// ─── MENU SKILL & PILIH SKILL AKTIF ──────────────────────
async function handleRpgSkill(sock, msg, args) {
  const userId = getSenderId(msg);
  const player = db.getRpgPlayer(userId);
  if (!player) return reply(sock, msg, '❌ Belum terdaftar di RPG!');
  if (!player.class) return reply(sock, msg, '❌ Belum punya kelas!\nPilih dulu: *!rpg kelas*');

  const cls = CLASSES[player.class];
  const input = (args.join(' ') || '').toLowerCase();
  const skillId = resolveSkillId(input);

  // Tanpa argumen → dropdown skill kelas
  if (!input) {
    const ownedRows = cls.skills.map(s => {
      const sk = SKILLS[s];
      const isActive = player.activeSkill === s;
      return {
        title: `${sk.emoji} ${sk.name}${isActive ? ' ✅' : ''}`,
        description: `${sk.desc} | Cooldown ${sk.cooldown}`,
        id: `!rpg skill ${s}`,
      };
    });
    const lines = [
      `Kelas: ${cls.emoji} *${cls.name}*`,
      `Skill aktif: ${player.activeSkill ? `${SKILLS[player.activeSkill].emoji} ${SKILLS[player.activeSkill].name}` : '_(belum dipilih)_'}`,
      '',
      'Pilih skill yang dipakai otomatis saat PvE & manual saat duel:',
    ];
    return sendMenu(sock, msg.key.remoteJid, {
      text: ui.box('⚡ PILIH SKILL', lines),
      footer: '⚡ Pilih skill',
      quoted: msg,
      fallbackText: ui.box('⚡ PILIH SKILL', lines),
      buttons: [listButton('⚡ Skill', [{ title: `Skill ${cls.name}`, rows: ownedRows }])],
    });
  }

  if (!cls.skills.includes(skillId))
    return reply(sock, msg, `❌ ${SKILLS[skillId]?.emoji || ''} Skill *${input}* bukan skill ${cls.emoji} ${cls.name}!\nSkill kamu: ${cls.skills.map(s => SKILLS[s].name).join(', ')}`);

  db.updateRpgPlayer(userId, { activeSkill: skillId });
  const sk = SKILLS[skillId];
  return reply(sock, msg, ui.box('⚡ SKILL DIPILIH', [
    `${sk.emoji} *${sk.name}* kini skill aktifmu.`,
    ui.kv('📖 Efek', sk.desc),
    ui.kv('⏳ Cooldown', `${sk.cooldown} giliran`),
  ]));
}

// ─── HELPER ──────────────────────────────────────────────
function biayaGantiKelas(changes = 0) {
  return 50000 * (changes + 1);
}

function formatBiaya(player) {
  const b = biayaGantiKelas(player.classChanges);
  return new Intl.NumberFormat('id-ID').format(b);
}

function formatNum(n) {
  return new Intl.NumberFormat('id-ID').format(n);
}

module.exports = { handleRpgClass, handleRpgSkill, biayaGantiKelas };