// handlers/gacha/router.js
// Routing !gacha: menu dropdown + tarik 1x/10x + info.
const { listButton, sendMenu, quickReply } = require('../../utils/buttons');
const { pull, info } = require('./commands');

async function handleGacha(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body } = ctx;
  if (!body.startsWith('!gacha')) return false;

  const rawArgs = body.slice(6).trim();
  const args = rawArgs ? rawArgs.split(' ') : [];
  const cmd = (args[0] || '').toLowerCase();

  // ─── MENU ───
  if (!cmd || cmd === 'menu' || cmd === 'help') {
    const text = [
      `✦ *GACHA* ✦`,
      ``,
      `Tarik hadiah acak dari semua game!`,
      ``,
      `💸 Harga: *50.000* / 1x, *500.000* / 10x`,
      `🟡 Pity: tarikan ke-50 dijamin *Legendary*`,
      ``,
      `Hadiah: money, material RPG, item shop, ikan langka, pokeball, umpan.`,
      ``,
      `Ketik *!gacha 1* atau *!gacha 10* untuk tarik.`,
    ].join('\n');
    await sendMenu(sock, chatId, {
      text,
      footer: '🎰 Pilih aksi gacha',
      quoted: msg,
      fallbackText: text,
      buttons: [
        quickReply('!gacha 1', '🎰 Tarik 1x'),
        quickReply('!gacha 10', '🎰 Tarik 10x'),
        quickReply('!gacha info', 'ℹ️ Info'),
      ],
    });
    return true;
  }

  // ─── INFO ───
  if (cmd === 'info' || cmd === 'peluang') {
    await sock.sendMessage(chatId, { text: info(senderJid) }, { quoted: msg });
    return true;
  }

  // ─── TARIK 1x ───
  if (cmd === '1' || cmd === 'tarik') {
    const result = pull(senderJid, senderName, 1);
    await sock.sendMessage(chatId, { text: result }, { quoted: msg });
    return true;
  }

  // ─── TARIK 10x ───
  if (cmd === '10' || cmd === 'tarik10' || cmd === 'gacha10') {
    const result = pull(senderJid, senderName, 10);
    await sock.sendMessage(chatId, { text: result }, { quoted: msg });
    return true;
  }

  await sock.sendMessage(chatId, {
    text: `❓ Perintah tidak dikenal.\nKetik *!gacha* untuk menu.`,
  }, { quoted: msg });
  return true;
}

module.exports = { handleGacha };
