// handlers/economy/transfer.js
// Universal transfer Money: !transfer / !tf @user <jumlah|all>
const { getUserMoney, deductMoney, addMoney } = require('../../data/db');
const ui = require('../../utils/ui');
const { sameUser, resolveMentionedJids, getNumber } = require('../../utils/jid');
const { parsePositiveAmount, resolveAmount } = require('../../utils/amount');

async function handleTransfer(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body, OWNER_JID } = ctx;

  const isTransfer = body.toLowerCase().startsWith('!transfer');
  const isTf = body.toLowerCase().startsWith('!tf ');
  const isTfOnly = body.toLowerCase() === '!tf';

  if (!isTransfer && !isTf && !isTfOnly) return false;

  const prefixLen = isTransfer ? 9 : 3;
  const rawArgs = body.slice(prefixLen).trim().split(' ');
  const args = rawArgs.filter(Boolean);

  // Ambil target JID dari mention ATAU reply (native WA) + fallback tag manual
  const mentionedJids = await resolveMentionedJids(msg, body, sock, chatId);
  const targetJid = mentionedJids[0] || null;

  if (!targetJid) {
    await sock.sendMessage(chatId, {
      text: `❌ Tag atau reply user yang ingin dikirim Money!\nContoh: *!transfer @nama 500* atau *!tf @nama all*`,
    }, { quoted: msg });
    return true;
  }

  if (sameUser(targetJid, senderJid)) {
    await sock.sendMessage(chatId, { text: `❌ Tidak bisa transfer ke diri sendiri!` }, { quoted: msg });
    return true;
  }

  // Jumlah diambil dari arg pertama selain tag; validasi penuh cegah parseInt parsial.
  const amountArg = args.find(a => !a.startsWith('@'));
  const amount = resolveAmount(amountArg, getUserMoney(senderJid));
  if (!amount) {
    if (amountArg?.toLowerCase() === 'all') {
      await sock.sendMessage(chatId, { text: `❌ Saldo kamu *0*, tidak ada yang bisa dikirim.` }, { quoted: msg });
      return true;
    }
    await sock.sendMessage(chatId, { text: `❌ Jumlah tidak valid!\nContoh: *!transfer @nama 500* atau *!tf @nama all*` }, { quoted: msg });
    return true;
  }

  const senderBalance = getUserMoney(senderJid);
  if (senderBalance < amount) {
    await sock.sendMessage(chatId, {
      text: `❌ Saldo tidak cukup!\nKamu punya: *${ui.money(senderBalance)}* money`,
    }, { quoted: msg });
    return true;
  }

  // Proses transfer
  if (!deductMoney(senderJid, amount)) {
    await sock.sendMessage(chatId, { text: `❌ Gagal memotong saldo. Coba lagi.` }, { quoted: msg });
    return true;
  }
  addMoney(targetJid, amount);

  const newBalance = getUserMoney(senderJid);

  await sock.sendMessage(chatId, {
    text: ui.box('💸 TRANSFER BERHASIL', [
      `*@${getNumber(senderJid)}* kirim *${ui.money(amount)}* money ke *@${getNumber(targetJid)}*`,
      ui.kv('💰 Sisa Saldo', `*${ui.money(newBalance)}* money`),
    ]),
    mentions: [senderJid, targetJid],
  }, { quoted: msg });

  return true;
}

// ─── BANSOS — Khusus Owner: beri Money gratis (tidak mengurangi saldo owner) ───
async function handleBansos(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body, OWNER_JID } = ctx;

  if (!body.toLowerCase().startsWith('!bansos')) return false;

  if (!sameUser(senderJid, OWNER_JID)) {
    await sock.sendMessage(chatId, { text: '🚫 Perintah ini hanya untuk owner bot!' }, { quoted: msg });
    return true;
  }

  const mentionedJids = await resolveMentionedJids(msg, body, sock, chatId);
  const targets = mentionedJids.filter(j => !sameUser(j, senderJid));

  if (targets.length === 0) {
    await sock.sendMessage(chatId, {
      text: '⚠️ Tag atau reply pemain yang ingin diberi Money!\nContoh:\n• *!bansos @nama 500*\n• *!bansos @a @b @c 500*\n• reply pesan seseorang dengan *!bansos 500*',
    }, { quoted: msg });
    return true;
  }

  const rawArgs = body.slice(7).trim().split(/\s+/).filter(Boolean);
  const amountArg = rawArgs.find(a => !a.startsWith('@'));
  const amount = parsePositiveAmount(amountArg);
  if (!amount) {
    await sock.sendMessage(chatId, { text: '⚠️ Masukkan jumlah Money!\nContoh: *!bansos @nama 500*' }, { quoted: msg });
    return true;
  }

  for (const jid of targets) addMoney(jid, amount);

  const lines = [
    `*@${getNumber(senderJid)}* memberi bansos *${ui.money(amount)}* money ke:`,
    '',
    ...targets.map(j => `• @${getNumber(j)} — saldo ${ui.money(getUserMoney(j))}`),
  ];

  await sock.sendMessage(chatId, {
    text: ui.box('🎁 BANSOS', lines),
    mentions: [senderJid, ...targets],
  }, { quoted: msg });

  return true;
}

module.exports = { handleTransfer, handleBansos };
