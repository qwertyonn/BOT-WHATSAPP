// handlers/game/minigame/suit.js
// Game Suit otomatis: batu-gunting-kertas.
const { getSuitResult } = require('../../../game/battle');
const { sameUser, resolveMentionedJids, getNumber } = require('../../../utils/jid');

async function handleSuit(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, body } = ctx;

  if (!body.startsWith('!suit')) return false;

  const mentionedJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '⚠️ Fitur ini hanya bisa digunakan di dalam grup!' }, { quoted: msg });
    return true;
  }

  if (!mentionedJid) {
    await sock.sendMessage(chatId, { text: '⚠️ Tag lawan kamu!\nContoh: *!suit @tag*' }, { quoted: msg });
    return true;
  }

  if (sameUser(mentionedJid, senderJid)) {
    await sock.sendMessage(chatId, { text: '❌ Kamu tidak bisa suit melawan diri sendiri!' }, { quoted: msg });
    return true;
  }

  const { move1, move2, result } = getSuitResult(senderJid, mentionedJid);

  const caption = [
    `🎮 *GAME SUIT OTOMATIS* 🎮`,
    ``,
    `@${getNumber(senderJid)}: ${move1}`,
    `@${getNumber(mentionedJid)}: ${move2}`,
    ``,
    result
  ].join('\n');

  await sock.sendMessage(chatId, {
    text: caption,
    mentions: [senderJid, mentionedJid]
  }, { quoted: msg });
  return true;
}

module.exports = { handleSuit };