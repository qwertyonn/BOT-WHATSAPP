// handlers/utility/utilityCommands.js
// !getpp, !acc / !unacc, !reset, !afk + deteksi otomatis tag/reply user AFK
const fs = require('fs');
const path = require('path');
const ui = require('../../utils/ui');
const { getUserMoney, deductMoney, resetMoney, getFishingPlayer, updateFishingPlayer, getRpgPlayer, updateRpgPlayer, getPokemonPlayer, savePokemonPlayer, deleteFishingPlayer, deleteRpgPlayer, deletePokemonPlayer } = require('../../data/db');
const { sameUser, normalizeUserJid, resolveJid, resolveMentionedJids, getMentionedJids, getQuotedParticipant, getNumber, resolveNum } = require('../../utils/jid');

// Cache untuk menyimpan daftar user yang diberi izin menggunakan !getpp
const allowedGetPpUsers = new Set();

// ─── PERSISTENSI STATUS AFK ─────────────────────────────
const afkMap = new Map();
const afkStateFile = process.env.BOT_AFK_STATE_PATH ? path.resolve(process.env.BOT_AFK_STATE_PATH) : path.join(__dirname, '..', '..', 'state', 'afk_state.json');

function saveAfkState() {
  try {
    fs.writeFileSync(afkStateFile, JSON.stringify(Object.fromEntries(afkMap), null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ Gagal menyimpan status AFK:', err.message);
  }
}

function loadAfkState() {
  if (!fs.existsSync(afkStateFile)) return;
  try {
    const raw = fs.readFileSync(afkStateFile, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const [jid, data] of Object.entries(parsed)) {
      if (data && data.time) afkMap.set(normalizeUserJid(jid), data);
    }
    if (afkMap.size > 0) console.log(`💤 Memuat ${afkMap.size} status AFK dari file.`);
  } catch (err) {
    console.error('❌ Gagal membaca status AFK:', err.message);
  }
}

loadAfkState();

// ─── FITUR GETPP — Ambil Foto Profil (Wajib Berizin / Khusus yang di-acc) ───
async function handleGetpp(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID } = ctx;

  if (body.toLowerCase().startsWith('!getpp')) {
    // Pengecekan apakah pengirim adalah Admin atau user yang sudah di-acc
    if (!sameUser(senderJid, OWNER_JID) && !allowedGetPpUsers.has(normalizeUserJid(senderJid))) {
      const ownerWaJid = resolveJid(OWNER_JID);
      await sock.sendMessage(chatId, {
        text: `minta izin lah ke raja @${getNumber(ownerWaJid)}`,
        mentions: [ownerWaJid]
      }, { quoted: msg });
      return true;
    }

    let targetJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

    if (!targetJid) {
      await sock.sendMessage(chatId, { text: '📸 Tag atau reply orang yang ingin diambil foto profilnya.\nContoh: !getpp @nama atau balas pesannya dengan !getpp' }, { quoted: msg });
      return true;
    }

    try {
      await sock.sendMessage(chatId, { text: '⏳ Sedang mengambil foto profil...' }, { quoted: msg });
      const ppUrl = await sock.profilePictureUrl(targetJid, 'image');

      if (ppUrl) {
        await sock.sendMessage(chatId, {
          image: { url: ppUrl },
          caption: `✅ Berhasil mengambil foto profil @${getNumber(targetJid)}`,
          mentions: [targetJid]
        }, { quoted: msg });
      } else {
        await sock.sendMessage(chatId, { text: `❌ User @${getNumber(targetJid)} tidak memasang foto profil atau membatasi privasinya.`, mentions: [targetJid] }, { quoted: msg });
      }
    } catch (err) {
      console.error('❌ Error !getpp:', err);
      await sock.sendMessage(chatId, { text: `❌ Gagal mengambil foto profil. User @${getNumber(targetJid)} mungkin menyembunyikannya.`, mentions: [targetJid] }, { quoted: msg });
    }
    return true;
  }

  return false;
}

// ─── !acc / !unacc — Fitur Izin !getpp (Khusus Admin) ────
async function handleAcc(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID } = ctx;

  if (body.toLowerCase().startsWith('!acc') || body.toLowerCase().startsWith('!unacc')) {
    if (!sameUser(senderJid, OWNER_JID)) {
      await sock.sendMessage(chatId, { text: `🚫 Perintah ini hanya untuk owner bot!` }, { quoted: msg });
      return true;
    }

    let targetJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

    if (!targetJid) {
      await sock.sendMessage(chatId, {
        text: `⚠️ Tag atau reply user yang ingin diproses!\nContoh: *!acc @nama* atau reply pesannya dengan *!acc*`
      }, { quoted: msg });
      return true;
    }

    if (body.toLowerCase().startsWith('!acc')) {
      allowedGetPpUsers.add(normalizeUserJid(targetJid));
      await sock.sendMessage(chatId, {
        text: `✅ Berhasil memberikan izin !getpp kepada @${getNumber(targetJid)}.`,
        mentions: [targetJid]
      }, { quoted: msg });
    } else if (body.toLowerCase().startsWith('!unacc')) {
      allowedGetPpUsers.delete(normalizeUserJid(targetJid));
      await sock.sendMessage(chatId, {
        text: `❌ Berhasil menghapus izin !getpp dari @${getNumber(targetJid)}.`,
        mentions: [targetJid]
      }, { quoted: msg });
    }
    return true;
  }

  return false;
}

// ─── RESET AKUN / MONEY — prefix !reset (khusus owner) ───
// Format: !reset rpg | fishit | pokemon | money [@tag | reply]
// Tanpa tag/reply → target = pengirim (owner). Reset satu bagian saja:
// akun game lain & Money tidak tersentuh; reset money hanya nol-kan saldo.
async function handleReset(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID } = ctx;

  const lowBody = body.toLowerCase();
  if (lowBody !== '!reset' && !lowBody.startsWith('!reset ')) return false;

  if (!sameUser(senderJid, OWNER_JID)) {
    await sock.sendMessage(chatId, {
      text: '🚫 Perintah ini hanya untuk owner bot!'
    }, { quoted: msg });
    return true;
  }

  const args = body.trim().split(/ +/).slice(1);
  const category = (args[0] || '').toLowerCase();

  if (!['rpg', 'fishit', 'pokemon', 'money'].includes(category)) {
    await sock.sendMessage(chatId, {
      text: [
        `⚠️ *Format: !reset [kategori]*`,
        ``,
        `📌 *Kategori:*`,
        `• *!reset rpg* — Reset akun RPG (Money & akun lain aman)`,
        `• *!reset fishit* — Reset akun FishIt (Money & akun lain aman)`,
        `• *!reset pokemon* — Reset akun Pokemon (Money & akun lain aman)`,
        `• *!reset money* — Nol-kan saldo Money (akun game aman)`,
        ``,
        `💡 Tag atau reply user untuk mereset akun orang lain.`,
        `   Tanpa tag/reply, target = diri sendiri (owner).`
      ].join('\n')
    }, { quoted: msg });
    return true;
  }

  const mentionedJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;
  const targetJid = mentionedJid || senderJid;
  const targetNum = getNumber(targetJid);

  let detail = '';
  if (category === 'money') {
    resetMoney(targetJid);
    detail = '💰 Saldo Money menjadi *0*. Akun game tetap aman.';
  } else if (category === 'fishit') {
    const p = getFishingPlayer(targetJid);
    if (!p) {
      await sock.sendMessage(chatId, { text: `❌ Akun FishIt @${targetNum} tidak ditemukan.`, mentions: [targetJid] }, { quoted: msg });
      return true;
    }
    deleteFishingPlayer(targetJid);
    detail = `🎣 Akun FishIt *${p.name}* dihapus. Money & akun game lain aman.`;
  } else if (category === 'rpg') {
    const p = getRpgPlayer(targetJid);
    if (!p) {
      await sock.sendMessage(chatId, { text: `❌ Akun RPG @${targetNum} tidak ditemukan.`, mentions: [targetJid] }, { quoted: msg });
      return true;
    }
    deleteRpgPlayer(targetJid);
    detail = `⚔️ Akun RPG *${p.name}* dihapus. Money & akun game lain aman.`;
  } else if (category === 'pokemon') {
    const numKey = resolveNum(targetJid);
    const p = getPokemonPlayer(numKey);
    if (!p) {
      await sock.sendMessage(chatId, { text: `❌ Akun Pokemon @${targetNum} tidak ditemukan.`, mentions: [targetJid] }, { quoted: msg });
      return true;
    }
    deletePokemonPlayer(numKey);
    detail = `🎮 Akun Pokemon *${p.name}* dihapus. Money & akun game lain aman.`;
  }

  await sock.sendMessage(chatId, {
    text: `✅ *RESET BERHASIL!*\n\n👤 Target: @${targetNum}\n${detail}`,
    mentions: [targetJid]
  }, { quoted: msg });
  return true;
}

// ─── GANTI NAMA GLOBAL — prefix !gantinama / !rename ───
// Mengganti nama di SEMUA game (FishIt, Pokemon, RPG) sekali bayar 100k Money.
const GANTI_NAMA_COST = 100000;

async function handleGantiNama(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;

  const lower = body.toLowerCase();
  if (!lower.startsWith('!gantinama') && !lower.startsWith('!rename')) return false;

  const newName = body.split(' ').slice(1).join(' ').trim();
  if (!newName) {
    await sock.sendMessage(chatId, { text: `❌ Masukkan nama baru!\nContoh: *!gantinama NamaBaru*` }, { quoted: msg });
    return true;
  }
  if (newName.length > 20) {
    await sock.sendMessage(chatId, { text: `❌ Nama maksimal 20 karakter!` }, { quoted: msg });
    return true;
  }
  if (getUserMoney(senderJid) < GANTI_NAMA_COST) {
    await sock.sendMessage(chatId, { text: `❌ Money tidak cukup! Ganti nama butuh *${GANTI_NAMA_COST.toLocaleString('id-ID')} Money*.\n💰 Saldo kamu: *${getUserMoney(senderJid).toLocaleString('id-ID')}*` }, { quoted: msg });
    return true;
  }

  const numKey  = resolveNum(senderJid);
  const renamed = [];

  if (getFishingPlayer(senderJid)) {
    updateFishingPlayer(senderJid, { name: newName });
    renamed.push('🎣 FishIt');
  }
  if (getRpgPlayer(senderJid)) {
    updateRpgPlayer(senderJid, { name: newName });
    renamed.push('⚔️ RPG');
  }
  if (getPokemonPlayer(numKey)) {
    savePokemonPlayer(numKey, { name: newName });
    renamed.push('🎮 Pokemon');
  }

  if (!renamed.length) {
    await sock.sendMessage(chatId, { text: `❌ Kamu belum terdaftar di game mana pun.` }, { quoted: msg });
    return true;
  }

  deductMoney(senderJid, GANTI_NAMA_COST);
  await sock.sendMessage(chatId, {
    text: ui.box('✅ GANTI NAMA', [
      `📝 Nama baru: *${newName}*`,
      `🎮 Diubah di: ${renamed.join(', ')}`,
      ui.kv('💰 Biaya', `*${GANTI_NAMA_COST.toLocaleString('id-ID')} Money*`),
      ui.kv('💰 Sisa', `*${getUserMoney(senderJid).toLocaleString('id-ID')} Money*`),
    ]),
  }, { quoted: msg });
  return true;
}

// ─── DETEKSI AFK (berjalan untuk setiap pesan yang tidak tertangkap command) ───
async function runAfkDetection(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body, OWNER_JID } = ctx;

  // 1. Dihapus dari status AFK jika user yang sedang AFK mengirim pesan baru
  const senderNorm = normalizeUserJid(senderJid);
  if (afkMap.has(senderNorm)) {
    const afkData = afkMap.get(senderNorm);
    const durasiMs = Date.now() - afkData.time;
    const durasiMenit = Math.floor(durasiMs / 60000);
    const durasiDetik = Math.floor((durasiMs % 60000) / 1000);
    const timeStr = durasiMenit > 0 ? `${durasiMenit} menit ${durasiDetik} detik` : `${durasiDetik} detik`;

    afkMap.delete(senderNorm);
    saveAfkState();

    if (sameUser(senderJid, OWNER_JID)) {
      // Jika OWNER yang kembali dari AFK (Kirim gambar my.png)
      await sock.sendMessage(chatId, {
        image: { url: path.join(__dirname, '..', '..', 'assets', 'my.png') }, // Pastikan file my.png ada di folder assets
        caption: `haloo sayangkuu cintakuu kamu uda kembali setelah ${timeStr}`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      // Jika user biasa yang kembali
      await sock.sendMessage(chatId, {
        text: `Welcome back *@${getNumber(senderJid)}*! Kamu telah kembali dari AFK.\n⏱️ Durasi AFK: *${timeStr}*`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
  }

  // 2. Cek apakah pesan menyebut/tag ATAU mereply pesan user yang sedang AFK
  const mentionedJidsInMsg = getMentionedJids(msg);
  const quotedParticipant = getQuotedParticipant(msg); // Menangkap JID dari pesan yang di-reply

  // Gabungkan list tag & reply agar terdeteksi dua-duanya
  const targetsToCheck = new Set([...mentionedJidsInMsg]);
  if (quotedParticipant) targetsToCheck.add(quotedParticipant);

  if (targetsToCheck.size > 0) {
    for (const targetJid of targetsToCheck) {
      // Jangan respon jika pengirim membalas pesannya sendiri
      if (sameUser(targetJid, senderJid)) continue;

      if (afkMap.has(normalizeUserJid(targetJid))) {
        const afkData = afkMap.get(normalizeUserJid(targetJid));
        if (sameUser(targetJid, OWNER_JID)) {
          // Jika yang AFK / di-reply / di-tag adalah OWNER
          const alasanText = afkData.reason ? afkData.reason : 'sibuk';
          await sock.sendMessage(chatId, {
            text: `suamiku lagi ${alasanText}`,
            mentions: [targetJid]
          }, { quoted: msg });
        } else {
          // Jika user biasa yang AFK
          const alasanText = afkData.reason ? `Alasan: *${afkData.reason}*` : 'Tanpa alasan';
          await sock.sendMessage(chatId, {
            text: `⚠️ *@${getNumber(targetJid)}* sedang offline/AFK.\n📌 ${alasanText}`,
            mentions: [targetJid]
          }, { quoted: msg });
        }
      }
    }
  }
}

// ─── Command !afk [alasan] ───
async function handleAfkCommand(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID } = ctx;

  if (body.toLowerCase().startsWith('!afk')) {
    const reasonInput = body.slice(4).trim();
    afkMap.set(normalizeUserJid(senderJid), {
      reason: reasonInput || null,
      time: Date.now()
    });
    saveAfkState();

    if (sameUser(senderJid, OWNER_JID)) {
      // Respon khusus saat Owner ketik !afk
      await sock.sendMessage(chatId, {
        text: `dadah sayangkuuu`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      // Respon user biasa
      const statusMsg = reasonInput ? `dengan alasan: *${reasonInput}*` : 'tanpa alasan';
      await sock.sendMessage(chatId, {
        text: `💤 *@${getNumber(senderJid)}* sekarang sedang AFK ${statusMsg}.`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleGetpp,
  handleAcc,
  handleReset,
  handleGantiNama,
  runAfkDetection,
  handleAfkCommand,
};
