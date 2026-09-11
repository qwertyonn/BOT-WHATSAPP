// handlers/pet/router.js
// Routing !pet: switch sub-perintah, kirim ke handler masing-masing.
const {
  cmdAdopt, cmdProfile, cmdFeed, cmdRename, cmdRelease,
  cmdBattle, cmdAccept, cmdAttack, cmdGuard, cmdCancel, cmdTop, cmdMenu,
} = require('./commands');
const { resolveMentionedJid } = require('../../utils/jid');

async function handlePet(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body } = ctx;
  const low = body.toLowerCase();

  if (low !== '!pet' && !low.startsWith('!pet ')) return false;

  const rawArgs = body.slice(4).trim().split(' ');
  const cmd = (rawArgs[0] || '').toLowerCase();
  const args = cmd ? rawArgs.slice(1) : [];

  switch (cmd) {
    case '':
    case 'menu':
    case 'help':
      await cmdMenu(sock, chatId, msg);
      break;

    case 'adopt':
      await cmdAdopt(sock, chatId, senderJid, senderName, msg);
      break;

    case 'profil':
    case 'status':
      await cmdProfile(sock, chatId, senderJid, msg);
      break;

    case 'makan':
    case 'feed':
      await cmdFeed(sock, chatId, senderJid, args, msg);
      break;

    case 'ganti':
    case 'rename':
      await cmdRename(sock, chatId, senderJid, args, msg);
      break;

    case 'lepas':
    case 'release':
      await cmdRelease(sock, chatId, senderJid, args, msg);
      break;

    case 'lawan':
    case 'battle': {
      const targetJid = await resolveMentionedJid(msg, body, sock, chatId);
      if (!targetJid) {
        await sock.sendMessage(chatId, { text: '⚠️ Tag pemain dulu!\nContoh: *!pet lawan @nama*' }, { quoted: msg });
      } else {
        await cmdBattle(sock, chatId, senderJid, targetJid, msg);
      }
      break;
    }

    case 'terima':
    case 'accept':
      await cmdAccept(sock, chatId, senderJid, msg);
      break;

    case 'serang':
    case 'attack':
      await cmdAttack(sock, chatId, senderJid, msg);
      break;

    case 'bertahan':
    case 'guard':
      await cmdGuard(sock, chatId, senderJid, msg);
      break;

    case 'batal':
    case 'cancel':
      await cmdCancel(sock, chatId, senderJid, msg);
      break;

    case 'top':
    case 'rank':
      await cmdTop(sock, chatId, msg);
      break;

    default:
      await sock.sendMessage(chatId, {
        text: `❓ Sub-perintah *!pet ${cmd}* tidak dikenal.\nKetik *!pet menu* untuk daftar perintah.`,
      }, { quoted: msg });
  }

  return true;
}

module.exports = { handlePet };