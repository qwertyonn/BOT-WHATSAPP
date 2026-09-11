// utils/jid.js
// Helper terpusat untuk menangani JID & mention/tag WhatsApp.
// - sameUser: bandingkan dua JID cukup dari nomornya (tahan perbedaan
//   domain @lid vs @s.whatsapp.net).
// - getMentionedJids: ekstrak JID target dari contextInfo berbagai tipe
//   pesan (teks, caption gambar/video) + participant pesan yang di-reply.
// - resolveMentionedJids: getMentionedJids + fallback tag manual
//   (@628xxxxxxxxxx yang diketik langsung tanpa picker WA).
// Key DB memakai real JID (angka@lid / angka@s.whatsapp.net) — lihat resolveJid.

// Alias nomor LID -> nomor HP. LID != nomor HP untuk akun yang sama, jadi
// identitas kanonik (HP) tidak bisa diturunkan dari LID; map ini menjembatani.
// Seed owner dulu; lainnya ditambahkan saat runtime dari participantAlt
// (registerJidAlias) untuk mengikuti rotasi LID WhatsApp.
const JID_ALIASES = { '91079495925888': '62895422923900', '234334120329445': '6285129923248' };

// Catat alias baru: JID LID mentah <-> JID nomor HP (dari participantAlt)
function registerJidAlias(lidJid, phoneJid) {
  const lid   = getNumber(lidJid);
  const phone = getNumber(phoneJid);
  if (lid && phone && lid !== phone) JID_ALIASES[lid] = phone;
}

// Ambil nomor (bagian sebelum @) dari sebuah JID, tanpa suffix perangkat (:xx).
// SELALU mentah (tanpa alias) — dipakai untuk teks mention & perbandingan.
function getNumber(jid) {
  if (!jid || typeof jid !== 'string') return '';
  return jid.split('@')[0].replace(/:\d+$/, '');
}

// Nomor kanonik (alias LID->HP diterapkan). Untuk deteksi owner / key pokemon.
function resolveNum(jid) {
  const n = getNumber(jid);
  return (n && JID_ALIASES[n]) || n;
}

// Reverse alias: cari LID yang memetakan ke nomor HP ini (phone -> lid).
// LID menang atas HP untuk key DB: kedua bentuk owner (LID & phone) harus
// resolve ke key yang sama.
function lidForPhone(phone) {
  if (!phone) return '';
  for (const [lid, num] of Object.entries(JID_ALIASES)) {
    if (num === phone) return lid;
  }
  return '';
}

// Bangun real JID dari nomor polos (tanpa domain). Reverse-alias (LID menang)
// dicek dulu; kalau tidak ada, heuristik: awalan 62 = HP -> @s.whatsapp.net,
// selain itu diasumsikan LID -> @lid.
function realJidOfNumber(num) {
  if (!num) return '';
  const lid = lidForPhone(num);
  if (lid) return `${lid}@lid`;
  return num.startsWith('62') ? `${num}@s.whatsapp.net` : `${num}@lid`;
}

// Key kanonik: real JID. Grup/broadcast/status tidak diubah.
// Input tanpa domain -> realJidOfNumber. Input ber-domain dipertahankan,
// kecuali LID yang migrasi lama salah-label jadi @s.whatsapp.net (nomor non-62
// tanpa reverse alias) -> dikoreksi ke @lid. Sufiks perangkat (:xx) dibuang.
function resolveJid(jid) {
  if (!jid || typeof jid !== 'string') return jid;
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.startsWith('status@')) return jid;
  const num = getNumber(jid);
  const lid = lidForPhone(num);
  if (lid) return `${lid}@lid`;
  if (!jid.includes('@')) return realJidOfNumber(num);
  const dom = jid.split('@')[1];
  if (dom === 's.whatsapp.net' && !num.startsWith('62')) return `${num}@lid`;
  return num ? `${num}@${dom}` : jid;
}

// Bandingkan dua JID berdasarkan nomor kanonik saja (alias-aware)
function sameUser(a, b) {
  if (!a || !b) return false;
  return resolveNum(a) === resolveNum(b);
}

// Normalisasi JID USER ke real JID. Grup/broadcast/status TIDAK diubah.
function normalizeUserJid(jid) {
  return resolveJid(jid);
}

// Ekstrak daftar JID yang di-mention dari contextInfo semua tipe pesan
function getMentionedJids(msg) {
  if (!msg?.message) return [];
  const ci = msg.message.extendedTextMessage?.contextInfo
          || msg.message.imageMessage?.contextInfo
          || msg.message.videoMessage?.contextInfo
          || msg.message.audioMessage?.contextInfo
          || msg.message.documentMessage?.contextInfo
          || msg.message.stickerMessage?.contextInfo
          || null;
  const mentioned = ci?.mentionedJid || [];
  // JID mentah apa adanya: untuk mention highlight harus sama persis dengan
  // JID member di grup (mis. @lid). Resolusi ke key DB dilakukan di data/db.js.
  return mentioned.filter(Boolean);
}

// JID pertama yang di-mention, atau null
function getMentionedJid(msg) {
  return getMentionedJids(msg)[0] || null;
}

// Ambil JID pengirim pesan yang di-reply (jika ada)
function getQuotedParticipant(msg) {
  if (!msg?.message) return null;
  const ci = msg.message.extendedTextMessage?.contextInfo
          || msg.message.imageMessage?.contextInfo
          || msg.message.videoMessage?.contextInfo
          || null;
  return ci?.participant ? ci.participant : null;
}

// Extrak tag manual "@628xxxxxxxxxx" dari teks pesan (bukan dari picker)
function parseMentionFromText(body) {
  const nums = [];
  if (!body || typeof body !== 'string') return nums;
  const re = /@(\d{6,16})/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    nums.push(m[1]);
  }
  return [...new Set(nums)];
}

// Resolve daftar JID mention. Prioritas:
// 1. contextInfo (tag native dari picker WA)
// 2. reply participant
// 3. tag manual "@628xxx" yang diketik langsung — cocokkan ke member grup
//    via groupMetadata agar domain JID akurat; fallback terakhir real JID
//    (angka@lid / angka@s.whatsapp.net).
async function resolveMentionedJids(msg, body, sock, chatId) {
  const fromContext = getMentionedJids(msg);
  if (fromContext.length > 0) return fromContext;

  const quoted = getQuotedParticipant(msg);
  if (quoted) return [quoted];

  const manualNums = parseMentionFromText(body);
  if (manualNums.length === 0) return [];

  // Coba cocokkan ke member grup agar JID sesuai domain yang dipakai grup
  // (alias-aware: @628xxx harus cocok juga untuk member LID).
  try {
    if (chatId && chatId.endsWith('@g.us') && sock) {
      const meta = await sock.groupMetadata(chatId);
      const participants = meta?.participants || [];
      const matched = manualNums
        .map(num => participants.find(p => resolveNum(p.id) === num))
        .filter(Boolean)
        .map(p => p.id);
      if (matched.length > 0) return matched;
    }
  } catch (err) {
    console.warn('⚠️ Gagal resolve mention manual via groupMetadata:', err.message);
  }

  // Fallback terakhir: real JID dari nomor polos (dipakai untuk mention & key DB)
  return manualNums.map(realJidOfNumber);
}

// Versi singkat: ambil JID mention pertama (native/reply/manual)
async function resolveMentionedJid(msg, body, sock, chatId) {
  const jids = await resolveMentionedJids(msg, body, sock, chatId);
  return jids[0] || null;
}

// Cek apakah jid adalah admin grup WA ('admin' / 'superadmin'). Alias-aware:
// cocokkan via resolveNum terhadap participant dari groupMetadata.
async function isGroupAdmin(sock, chatId, jid) {
  if (!sock || !chatId || !chatId.endsWith('@g.us') || !jid) return false;
  try {
    const meta = await sock.groupMetadata(chatId);
    const participants = meta?.participants || [];
    const p = participants.find(x => resolveNum(x.id) === resolveNum(jid));
    return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
  } catch (err) {
    console.warn('⚠️ Gagal cek admin grup:', err.message);
    return false;
  }
}

module.exports = {
  getNumber,
  resolveNum,
  resolveJid,
  realJidOfNumber,
  registerJidAlias,
  sameUser,
  normalizeUserJid,
  getMentionedJids,
  getMentionedJid,
  getQuotedParticipant,
  parseMentionFromText,
  resolveMentionedJids,
  resolveMentionedJid,
  isGroupAdmin,
};
