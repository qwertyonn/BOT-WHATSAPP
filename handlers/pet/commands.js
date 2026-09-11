// handlers/pet/commands.js
// Logika perintah fitur Pet: adopsi, status, makan (snack / ikan FishIt),
// ganti nama, release, battle PvP 1v1 (serang/bertahan), top, menu.
// State battle & tantangan transient (Map in-memory) seperti ttt/suit.
const ui = require('../../utils/ui');
const {
  getPetPlayer, createPetPlayer, updatePetPlayer, deletePetPlayer,
  getPetLeaderboard, getFishingPlayer, updateFishingPlayer,
} = require('../../data/db');
const {
  PET_SPECIES, SPECIES_IDS, getStageName, getEvoReq,
} = require('../../data/petData');
const {
  getPetStats, fishExp, feedFish, applyExp, tryEvolve, computeDamage,
} = require('../../game/petEngine');
const { sameUser } = require('../../utils/jid');
const { TIERS } = require('../../data/gameData');
const { parsePositiveAmount } = require('../../utils/amount');

const SNACK_COOLDOWN_MS = 30 * 60 * 1000; // snack gratis: 30 menit
const PENDING_TTL_MS    = 2 * 60 * 1000;  // tantangan kadaluarsa: 2 menit

// State battle & tantangan per grup
const petBattles = new Map();  // groupId -> { a, b, turn, ts }
const petPending = new Map();  // groupId -> { challenger, target, ts }

function petTitle(p) {
  const sp = PET_SPECIES[p.species];
  const st = getStageName(p);
  return p.nickname ? `${p.nickname} (${sp.emoji} ${st})` : `${sp.emoji} ${st}`;
}

// ─── !pet adopt — adopsi pet acak (gratis, 1 per user) ───
async function cmdAdopt(sock, chatId, jid, name, msg) {
  if (getPetPlayer(jid)) {
    await sock.sendMessage(chatId, { text: '❌ Kamu sudah punya pet! Gunakan *!pet lepas ya* untuk melepasnya dulu.' }, { quoted: msg });
    return;
  }
  const species = SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)];
  const sp = PET_SPECIES[species];
  const pet = createPetPlayer(jid, name, species);
  await sock.sendMessage(chatId, {
    text: ui.box('🐾 PET BARU', [
      `Selamat! Kamu mengadopsi pet acak:`,
      ``,
      ui.kv('Spesies', `${sp.emoji} ${sp.name}`),
      ui.kv('Bentuk', sp.stages[0]),
      ui.kv('Tier', '⚪ Common'),
      '',
      `Beri makan ikan FishIt agar tumbuh!`,
      ui.bullet('!pet makan <ikan>', 'makan ikan (naikkan exp)'),
      ui.bullet('!pet profil', 'lihat detail'),
    ]),
  }, { quoted: msg });
  return pet;
}

// ─── !pet profil/status ───
async function cmdProfile(sock, chatId, jid, msg) {
  const p = getPetPlayer(jid);
  if (!p) {
    await sock.sendMessage(chatId, { text: '❌ Kamu belum punya pet.\nAdopsi gratis dengan *!pet adopt*.' }, { quoted: msg });
    return;
  }
  const sp  = PET_SPECIES[p.species];
  const s   = getPetStats(p);
  const req = getEvoReq(p.stage);
  const nextEvo = req !== null
    ? `• level *${req.level}* + makan ikan tier ≥${req.fishTier}`
    : null;

  const lines = [
    ui.kv('👤 Owner', p.ownerName),
    ui.kv('🐾 Nama', p.nickname || '—'),
    ui.kv('🎀 Bentuk', getStageName(p)),
    ui.kv('📈 Level', `${p.level} (${p.exp}/${p.level * 60} exp)`),
    ui.kv('🌟 Stage', `${p.stage}/4`),
    '',
    ui.section('STAT'),
    ...(() => {
      const rows = [
        ui.kv('❤️ HP', s.maxHp),
        ui.kv('⚔️ ATK', s.atk),
        ui.kv('🛡️ DEF', s.def),
        ui.kv('💨 SPD', s.spd),
      ];
      return rows;
    })(),
    '',
    ui.section('PERTARUNGAN'),
    ui.kv('✅ Menang', p.wins),
    ui.kv('❌ Kalah', p.losses),
    '',
    ui.section('EVOLUSI'),
    ...(nextEvo
      ? [ ui.bullet(p.evoReqMet ? '✅ Ikan tinggi ✓' : '⛔ Belum makan ikan tier tinggi'), ui.bullet(`   ${nextEvo}`) ]
      : [ ui.bullet('Stage maksimal!') ]),
  ];

  await sock.sendMessage(chatId, {
    text: ui.box(`🐾 ${sp.emoji} PROFIL PET`, lines),
    mentions: [jid],
  }, { quoted: msg });
}

// ─── !pet makan — snack gratis / makan ikan FishIt ───
async function cmdFeed(sock, chatId, jid, args, msg) {
  const p = getPetPlayer(jid);
  if (!p) {
    await sock.sendMessage(chatId, { text: '❌ Belum punya pet. *!pet adopt* dulu!' }, { quoted: msg });
    return;
  }

  // Tanpa arg → snack gratis kecil (cooldown 30m), tidak menyentuh evoReqMet
  if (!args.length) {
    if (Date.now() - (p.lastFed || 0) < SNACK_COOLDOWN_MS) {
      const rem = Math.ceil((SNACK_COOLDOWN_MS - (Date.now() - p.lastFed)) / 60000);
      await sock.sendMessage(chatId, { text: `⏳ Pet masih kenyang. Coba lagi dalam *${rem} menit* atau kasih ikan!\nContoh: *!pet makan lele*` }, { quoted: msg });
      return;
    }
    const result = applyExp(p, 5);
    p.lastFed = Date.now();
    updatePetPlayer(jid, { exp: p.exp, level: p.level, lastFed: p.lastFed });
    await sock.sendMessage(chatId, {
      text: `🍖 ${petTitle(p)} makan snack gratis (+5 exp).\n${levelUpText(p, result.levelUpCount)}`,
    }, { quoted: msg });
    return;
  }

  // Dengan arg → makan ikan dari inventori FishIt
  const eat = consumeFishForPet(jid, args);
  if (eat.error) {
    await sock.sendMessage(chatId, { text: `❌ ${eat.error}` }, { quoted: msg });
    return;
  }

  const gained = fishExp(eat.tier, eat.weight);
  feedFish(p, eat.tier);
  const result = applyExp(p, gained);
  const evo    = tryEvolve(p);
  p.lastFed = Date.now();
  updatePetPlayer(jid, {
    level: p.level, exp: p.exp, stage: p.stage,
    evoReqMet: p.evoReqMet, lastFed: p.lastFed,
  });

  const tierEmoji = TIERS[eat.tier]?.emoji || '🐟';
  const lines = [
    `🍽️ ${petTitle(p)} memakan *${eat.qty}x ${tierEmoji} ${eat.name}* (tier ${eat.tier})`,
    ui.kv('➕ Exp', `+${gained}`),
    '',
    ...(result.levelUpCount > 0 ? [ui.kv('📈 Level', `Naik ke level ${p.level}!`) , ''] : []),
    ...(p.evoReqMet
      ? [ui.bullet('✅ Ikan tier tinggi dimakan — syarat evolusi terpenuhi!')]
      : evoBlockedHint(p)),
    ...(evo?.maxStage
      ? [ui.bullet('✨ Sudah stage maksimal!')]
      : [evo?.can
        ? [ui.bullet(`🎉 EVOLUSI! Menjadi *${getStageName(p)}* (stage ${p.stage}/4)!`)]
        : evo?.reason
          ? [ui.bullet(`⏳ Belum evolusi: ${evo.reason}`)]
          : []]).flat(),
  ];

  await sock.sendMessage(chatId, { text: ui.box('🍽️ PET MAKAN', lines) }, { quoted: msg });
}

// Konsumsi ikan FishIt dari inventori (logika match persis !fishit jual)
function consumeFishForPet(jid, args) {
  const p = getFishingPlayer(jid);
  if (!p) return { error: 'Belum terdaftar di FishIt.' };
  const inv = { ...(p.inventory || {}) };
  if (!Object.keys(inv).length) return { error: 'Inventori ikan kosong. Mancing dulu dengan *!fishit mancing*.' };

  const lastArg = args[args.length - 1];
  const lastIsAll = lastArg?.toLowerCase() === 'all' || lastArg?.toLowerCase() === 'semua';
  let qty = 1;
  let fishArgs = [...args];
  if (lastIsAll) { fishArgs = fishArgs.slice(0, -1); }
  else if (parsePositiveAmount(lastArg) !== null) { qty = parsePositiveAmount(lastArg); fishArgs = fishArgs.slice(0, -1); }

  const fishName = fishArgs.join(' ');
  const keys = Object.keys(inv);
  const matchKey = keys.find(k => k.toLowerCase() === fishName.toLowerCase())
                || keys.find(k => k.toLowerCase().includes(fishName.toLowerCase()));
  if (!matchKey) return { error: `Ikan "${fishName}" tidak ditemukan di inventori.` };

  const fd = inv[matchKey];
  if (lastIsAll) qty = fd.count;
  if (fd.count < qty) return { error: `Kamu hanya punya *${fd.count}x ${matchKey}*.` };

  const avgWeight = fd.weight / fd.count;
  const eatenWeight = avgWeight * qty;
  fd.count -= qty;
  fd.weight -= eatenWeight;
  if (fd.count <= 0) delete inv[matchKey]; else inv[matchKey] = fd;
  updateFishingPlayer(jid, { inventory: inv });

  return { ok: true, name: matchKey, tier: fd.tier, weight: eatenWeight, qty };
}

function levelUpText(p, count) {
  if (count <= 0) return '';
  return `📈 Naik *${count}x* level → level ${p.level}!`;
}

function evoBlockedHint(p) {
  const req = getEvoReq(p.stage);
  if (!req) return [];
  const spec = PET_SPECIES[p.species];
  return [
    ui.bullet(`⏳ Evolusi stage ${p.stage + 1} butuh ikan tier ≥${req.fishTier}`),
    '',
  ];
}

// ─── !pet ganti <nama> — ganti nama panggilan ───
async function cmdRename(sock, chatId, jid, args, msg) {
  const p = getPetPlayer(jid);
  if (!p) {
    await sock.sendMessage(chatId, { text: '❌ Belum punya pet. *!pet adopt* dulu!' }, { quoted: msg });
    return;
  }
  const nickname = (args.join(' ') || '').trim().slice(0, 15);
  if (!nickname) {
    await sock.sendMessage(chatId, { text: '⚠️ Format: *!pet ganti [nama]*\nContoh: *!pet ganti Ciko*' }, { quoted: msg });
    return;
  }
  updatePetPlayer(jid, { nickname });
  await sock.sendMessage(chatId, { text: `✏️ Nama pet diubah menjadi *${nickname}*.` }, { quoted: msg });
}

// ─── !pet lepas [ya] — release pet (butuh konfirmasi) ───
async function cmdRelease(sock, chatId, jid, args, msg) {
  const p = getPetPlayer(jid);
  if (!p) {
    await sock.sendMessage(chatId, { text: '❌ Belum punya pet.' }, { quoted: msg });
    return;
  }
  const confirm = (args[0] || '').toLowerCase();
  if (confirm !== 'ya' && confirm !== 'yakin' && confirm !== 'sure') {
    await sock.sendMessage(chatId, { text: `⚠️ Yakin lepas ${petTitle(p)}? Semua progress hilang.\nKetik *!pet lepas ya* untuk konfirmasi.` }, { quoted: msg });
    return;
  }
  deletePetPlayer(jid);
  await sock.sendMessage(chatId, { text: '👋 Pet telah dilepas. Bisa adopsi baru dengan *!pet adopt*.' }, { quoted: msg });
}

// ─── !pet lawan @user — tantang pet pemain lain ───
async function cmdBattle(sock, chatId, jid, targetJid, msg) {
  const me = getPetPlayer(jid);
  const them = getPetPlayer(targetJid);
  if (!me) { await sock.sendMessage(chatId, { text: '❌ Kamu belum punya pet.' }, { quoted: msg }); return; }
  if (!them) { await sock.sendMessage(chatId, { text: `❌ Target belum punya pet/Terdaftar pet.` }, { quoted: msg }); return; }
  if (sameUser(jid, targetJid)) { await sock.sendMessage(chatId, { text: '❌ Tidak bisa menantang diri sendiri.' }, { quoted: msg }); return; }
  if (petBattles.has(chatId)) { await sock.sendMessage(chatId, { text: '⚠️ Masih ada battle berlangsung di grup ini. Selesaikan dulu.' }, { quoted: msg }); return; }

  petPending.set(chatId, { challenger: jid, target: targetJid, ts: Date.now() });
  await sock.sendMessage(chatId, {
    text: `⚔️ ${me.ownerName} menantang *${them.ownerName}*!\n\n${petTitle(me)} (Lv${me.level}) vs ${petTitle(them)} (Lv${them.level})\n\nKetik *!pet terima* untuk menerima.`,
    mentions: [targetJid],
  }, { quoted: msg });
}

// ─── !pet terima — terima tantangan ───
async function cmdAccept(sock, chatId, jid, msg) {
  const pending = petPending.get(chatId);
  if (!pending) { await sock.sendMessage(chatId, { text: '⚠️ Tidak ada tantangan untuk grup ini.' }, { quoted: msg }); return; }
  if (!sameUser(pending.target, jid)) { await sock.sendMessage(chatId, { text: '⚠️ Tantangan ini bukan untukmu.' }, { quoted: msg }); return; }
  if (Date.now() - pending.ts > PENDING_TTL_MS) { petPending.delete(chatId); await sock.sendMessage(chatId, { text: '⏰ Tantangan kadaluarsa.' }, { quoted: msg }); return; }

  const pa = getPetPlayer(pending.challenger);
  const pb = getPetPlayer(jid);
  if (!pa || !pb) { petPending.delete(chatId); await sock.sendMessage(chatId, { text: '❌ Salah satu pet tidak ditemukan.' }, { quoted: msg }); return; }

  const statsA = getPetStats(pa);
  const statsB = getPetStats(pb);
  petPending.delete(chatId);
  petBattles.set(chatId, {
    a: { jid: pending.challenger, name: pa.ownerName, pet: petTitle(pa), hp: statsA.maxHp, def: statsA.def, guard: false },
    b: { jid, name: pb.ownerName, pet: petTitle(pb), hp: statsB.maxHp, def: statsB.def, guard: false },
    turn: 'a',
    ts: Date.now(),
  });
  await sock.sendMessage(chatId, {
    text: ui.box('⚔️ PET BATTLE', [
      `🔥 ${pa.ownerName}: ${petTitle(pa)} ❤️${statsA.maxHp}`,
      `⚡ vs`,
      `🔥 ${pb.ownerName}: ${petTitle(pb)} ❤️${statsB.maxHp}`,
      '',
      `Giliran pertama: *${pa.ownerName}*`,
      ui.bullet('!pet serang', 'serang lawan'),
      ui.bullet('!pet bertahan', 'bertahan (halau damage giliran ini)'),
    ]),
    mentions: [pa.jid, pb.jid],
  }, { quoted: msg });
}

// ─── !pet serang — serang giliran sendiri ───
async function cmdAttack(sock, chatId, jid, msg) {
  const b = petBattles.get(chatId);
  if (!b) { await sock.sendMessage(chatId, { text: '⚠️ Tidak ada battle aktif.' }, { quoted: msg }); return; }
  const me  = b[b.turn];
  if (!sameUser(me.jid, jid)) { await sock.sendMessage(chatId, { text: '⏳ Bukan giliranmu.' }, { quoted: msg }); return; }
  const foe = b[b.turn === 'a' ? 'b' : 'a'];
  const myStats   = getPetStats(getPetPlayer(me.jid));
  const { damage, crit } = computeDamage(myStats.atk, foe.def);
  const finalDmg = foe.guard ? Math.max(1, Math.round(damage * 0.5)) : damage;
  foe.guard = false;
  foe.hp -= finalDmg;

  if (foe.hp <= 0) {
    const winner = me, loser = foe;
    const wp = getPetPlayer(winner.jid), lp = getPetPlayer(loser.jid);
    if (wp) updatePetPlayer(winner.jid, { wins: wp.wins + 1 });
    if (lp) updatePetPlayer(loser.jid, { losses: lp.losses + 1 });
    petBattles.delete(chatId);
    await sock.sendMessage(chatId, {
      text: ui.box('🏆 PET BATTLE SELESAI', [
        `${crit ? '💥 CRIT! ' : ''}${winner.pet} menyerang → *${finalDmg}* damage`,
        '',
        `🎉 *${winner.name}* menang! ${winner.pet}`,
        `💔 ${loser.pet} milik ${loser.name} tumbang.`,
      ]),
      mentions: [winner.jid, loser.jid],
    }, { quoted: msg });
    return;
  }

  b.turn = b.turn === 'a' ? 'b' : 'a';
  petBattles.set(chatId, b);
  await sock.sendMessage(chatId, {
    text: `⚔️ ${crit ? '💥 CRIT! ' : ''}${me.pet} menyerang → *${finalDmg}* damage\n\n❤️ ${me.pet}: ${me.hp}\n❤️ ${foe.pet}: ${foe.hp}\n\nGiliran *${b[b.turn].name}*: !pet serang / !pet bertahan`,
    mentions: [me.jid, foe.jid],
  }, { quoted: msg });
}

// ─── !pet bertahan — bertahan untuk giliran ini ───
async function cmdGuard(sock, chatId, jid, msg) {
  const b = petBattles.get(chatId);
  if (!b) { await sock.sendMessage(chatId, { text: '⚠️ Tidak ada battle aktif.' }, { quoted: msg }); return; }
  const me = b[b.turn];
  if (!sameUser(me.jid, jid)) { await sock.sendMessage(chatId, { text: '⏳ Bukan giliranmu.' }, { quoted: msg }); return; }
  me.guard = true;
  b.turn = b.turn === 'a' ? 'b' : 'a';
  petBattles.set(chatId, b);
  await sock.sendMessage(chatId, {
    text: `🛡️ ${me.pet} bersiap bertahan (damage berikutnya dipotong 50%).\n\nGiliran *${b[b.turn].name}*.`,
    mentions: [me.jid, b[b.turn].jid],
  }, { quoted: msg });
}

// ─── !pet top — papan peringkat ───
async function cmdTop(sock, chatId, msg) {
  const list = getPetLeaderboard(10);
  if (!list.length) {
    await sock.sendMessage(chatId, { text: '📭 Belum ada pet yang terdaftar.' }, { quoted: msg });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = list.map((p, i) => {
    const sp = PET_SPECIES[p.species];
    return `${medals[i] || `${i + 1}.`} *${p.ownerName}* — ${sp.emoji} ${getStageName(p)} (Lv${p.level}/Stage ${p.stage})\n   ⚔️ ${p.wins}W-${p.losses}L`;
  });
  await sock.sendMessage(chatId, { text: ui.box('🏆 TOP PET', lines) }, { quoted: msg });
}

// ─── [!pet / !pet menu] — menu bantuan ───
async function cmdMenu(sock, chatId, msg) {
  await sock.sendMessage(chatId, {
    text: ui.box('🐾 PET MENU', [
      `*Evolusi*: 4 stage — tiap stage butuh level + makan ikan tier tinggi.`,
      ``,
      ui.section('PERAWATAN'),
      ui.cmd('!pet adopt', 'Adopsi pet acak (gratis)'),
      ui.cmd('!pet profil', 'Lihat detail pet'),
      ui.cmd('!pet makan [ikan] [jml]', 'Makan ikan FishIt (tanpa arg = snack kecil)'),
      ui.cmd('!pet ganti [nama]', 'Ganti nama panggilan'),
      ui.cmd('!pet lepas ya', 'Lepas pet (progress hilang)'),
      '',
      ui.section('BATTLE (PvP 1v1)'),
      ui.cmd('!pet lawan @user', 'Tantang pet pemain lain'),
      ui.cmd('!pet terima', 'Terima tantangan'),
      ui.cmd('!pet serang', 'Serang saat giliran'),
      ui.cmd('!pet bertahan', 'Bertahan & potong damage 50%'),
      '',
      ui.section('INFO'),
      ui.cmd('!pet top', 'Papan peringkat pet'),
      ui.cmd('!pet menu', 'Menu ini'),
    ]),
  }, { quoted: msg });
}

// Batal battle (jika lawan tidak merespons) — admin/kedua pihak bisa
async function cmdCancel(sock, chatId, jid, msg) {
  const b = petBattles.get(chatId);
  if (!b) { await sock.sendMessage(chatId, { text: '⚠️ Tidak ada battle aktif.' }, { quoted: msg }); return; }
  if (!sameUser(b.a.jid, jid) && !sameUser(b.b.jid, jid)) {
    await sock.sendMessage(chatId, { text: '❌ Hanya peserta battle yang bisa membatalkan.' }, { quoted: msg });
    return;
  }
  petBattles.delete(chatId);
  petPending.delete(chatId);
  await sock.sendMessage(chatId, { text: '⏹️ Battle dibatalkan oleh peserta.' }, { quoted: msg });
}

module.exports = {
  petBattles, petPending,
  cmdAdopt, cmdProfile, cmdFeed, cmdRename, cmdRelease,
  cmdBattle, cmdAccept, cmdAttack, cmdGuard, cmdCancel, cmdTop, cmdMenu,
  consumeFishForPet,
};