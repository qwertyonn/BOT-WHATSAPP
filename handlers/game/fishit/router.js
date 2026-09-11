// handlers/game/fishit/router.js
// Routing !fishit: pre-handler prompt jual/beli + switch perintah.
const {
  cmdMenu: fishMenu,
  cmdProfil, cmdLokasi, cmdMancing, cmdInv, cmdJual, cmdShop: fishShop,
  cmdBeli, cmdFishdex, cmdTop, getLocationRows, sellPrompts, buyPrompts,
} = require('./commands');
const { sameUser } = require('../../../utils/jid');
const { listButton, sendMenu, quickReply } = require('../../../utils/buttons');
const { getFishingPlayer } = require('../../../data/db');
const { renderAchievements } = require('./achievements');

async function handleFishit(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body, OWNER_JID } = ctx;

  // Pre-handler: reply prompt jual (angka / all / semua) → lanjutkan penjualan
  {
    const ci = msg.message?.extendedTextMessage?.contextInfo;
    const quotedId = ci?.stanzaId;
    const raw = body.trim().toLowerCase();
    const isQty = /^\d+$/.test(raw);
    const isAll = raw === 'all' || raw === 'semua';
    const jid = senderJid;
    if (quotedId && sellPrompts.has(quotedId) && (isQty || isAll)) {
      const sess = sellPrompts.get(quotedId);
      if (!sameUser(sess.senderJid, senderJid)) return false;
      sellPrompts.delete(quotedId);
      const response = await cmdJual(sock, chatId, jid, [sess.fishName, ...(isQty ? [raw] : ['all'])], msg);
      if (response) await sock.sendMessage(chatId, { text: response }, { quoted: msg });
      return true;
    }
    // Pre-handler: reply prompt beli umpan (angka) → lanjutkan pembelian
    if (quotedId && buyPrompts.has(quotedId) && isQty) {
      const sess = buyPrompts.get(quotedId);
      if (!sameUser(sess.senderJid, senderJid)) return false;
      buyPrompts.delete(quotedId);
      const response = await cmdBeli(sock, chatId, jid, ['umpan', sess.baitId, raw], msg);
      if (response) await sock.sendMessage(chatId, { text: response }, { quoted: msg });
      return true;
    }
  }

  if (!body.startsWith('!fishit ')) return false;

  const rawArgs = body.slice(8).split(' ');
  const cmd     = rawArgs[0].toLowerCase();
  const args    = rawArgs.slice(1);
  const jid     = senderJid;

  let response = null;

  switch (cmd) {
    case 'menu':
      await sendMenu(sock, chatId, {
        text: fishMenu(senderName),
        footer: '🎣 FishIt — pilih aksi',
        quoted: msg,
        fallbackText: fishMenu(senderName),
        buttons: [
          listButton('🎣 FishIt', [
            { title: '👤 AKUN PEMAIN', rows: [
              { title: '👤 Profil', id: '!fishit profil' },
              { title: '✏️ Ganti Nama', id: '!gantinama' },
            ] },
            { title: '🎣 AKTIVITAS MANCING', rows: [
              { title: '📍 Lokasi', id: '!fishit lokasi' },
              { title: '🎣 Mancing Spot 1', id: '!fishit mancing 1' },
              { title: '🎒 Inventori', id: '!fishit inv' },
            ] },
            { title: '💼 PASAR & EKONOMI', rows: [
              { title: '💸 Jual Ikan', id: '!fishit jual' },
              { title: '🏪 Toko', id: '!fishit shop' },
            ] },
            { title: '🏆 PAPAN PERINGKAT', rows: [
              { title: '🏆 Top Player', id: '!fishit top player' },
              { title: '🏅 Achievement', id: '!fishit achievement' },
            ] },
            { title: '📖 DATA KOLEKSI', rows: [
              { title: '🐟 Fishdex', id: '!fishit fishdex' },
            ] },
            { title: '❓ LAIN', rows: [
              { title: '💡 Panduan', id: '!fishit help' },
            ] },
          ]),
        ],
      });
      response = null;
      break;

    case 'profil': {
      const profText = cmdProfil(jid);
      await sendMenu(sock, chatId, {
        text: profText,
        footer: '🎣 FishIt Profil',
        quoted: msg,
        fallbackText: profText,
        buttons: [
          quickReply('!fishit mancing 1', '🎣 Mancing Spot 1'),
          quickReply('!fishit inv', '🎒 Inventori'),
          quickReply('!fishit jual all', '💸 Jual Semua'),
        ],
      });
      response = null;
      break;
    }

    case 'lokasi':
      await sendMenu(sock, chatId, {
        text: cmdLokasi(),
        footer: '🎣 Pilih lokasi mancing',
        quoted: msg,
        fallbackText: cmdLokasi(),
        buttons: [
          listButton('🎣 Pilih Lokasi', getLocationRows()),
        ],
      });
      response = null;
      break;

    case 'mancing': {
      const locId = args[0];
      if (!locId) {
        response = `❌ Tentukan lokasi!\nContoh: *!fishit mancing 1*\nKetik *!fishit lokasi*.`;
      } else {
        const r = await cmdMancing(jid, locId, sock, chatId, msg);
        if (typeof r === 'string') response = r;
      }
      break;
    }

    case 'inv': {
      const invText = cmdInv(jid);
      await sendMenu(sock, chatId, {
        text: invText,
        footer: '🎒 FishIt Inventori',
        quoted: msg,
        fallbackText: invText,
        buttons: [
          quickReply('!fishit jual all', '💸 Jual Semua'),
          quickReply('!fishit mancing 1', '🎣 Mancing'),
          quickReply('!fishit shop', '🏪 Toko'),
        ],
      });
      response = null;
      break;
    }

    case 'jual':
      response = await cmdJual(sock, chatId, jid, args, msg);
      break;

    case 'shop':
      response = await fishShop(sock, chatId, args, msg);
      break;

    case 'beli':
      response = await cmdBeli(sock, chatId, jid, args, msg);
      break;

    case 'fishdex':
      response = cmdFishdex(jid);
      break;

    case 'achievement':
    case 'achv':
    case 'misi':
      response = renderAchievements(getFishingPlayer(jid));
      break;

    case 'top': {
      const sub = args[0]?.toLowerCase();
      response  = cmdTop(sub);
      break;
    }

    case 'help':
      response = [
        `❓ *PANDUAN FISHIT*`,
        ``,
        `*🎣 Aktivitas Mancing*`,
        `• *!fishit lokasi* — Lihat spot mancing`,
        `• *!fishit mancing [no]* — Mulai memancing`,
        `• *!fishit inv* — Lihat inventori`,
        `• *!fishit jual all* — Jual semua ikan`,
        `• *!fishit jual [nama] [jml]* — Jual ikan tertentu`,
        ``,
        `*🎯 Cara Mancing*`,
        `• Mancing → tunggu *~5 detik* → hasil muncul`,
        `• Hasil bisa zonk (gagal) atau tangkapan`,
        `• Joran & umpan bagus menaikkan peluang tangkapan langka`,
        `• Gagal = umpan habis, coba lagi`,
        ``,
        `*🏪 Toko*`,
        `• *!fishit shop rod* — Lihat joran`,
        `• *!fishit shop bait* — Lihat umpan`,
        `• *!fishit beli joran [id]* — Beli joran`,
        `• *!fishit beli umpan [id] [jml]* — Beli umpan`,
        ``,
        `*📊 Info & Sosial*`,
        `• *!fishit profil* — Profil pemancing`,
        `• *!gantinama [nama]* — Ubah nama semua game (100k Money)`,
        `• *!fishit fishdex* — Koleksi ikan`,
        `• *!fishit top player* — Leaderboard`,
        `• *!fishit achievement* — Achievement & reward`,
      ].join('\n');
      break;

    default:
      response = `❓ Perintah tidak dikenal.\nKetik *!fishit menu* untuk daftar perintah.`;
  }

  if (response) {
    await sock.sendMessage(chatId, { text: response }, { quoted: msg });
  }
  return true;
}

module.exports = { handleFishit };