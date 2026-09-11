// handlers/game/casino/router.js
// Routing !casino & !bj/!blackjack/!hit/!stand.
const { handleCasino, handleBlackjack, handleTopBust } = require('./commands');
const { resolveMentionedJids } = require('../../../utils/jid');

async function handleCasinoRouter(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body } = ctx;

  if (!body.toLowerCase().startsWith('!casino')) return false;

  const rawArgs = body.slice(7).trim().split(' ');
  const args = rawArgs.filter(Boolean);

  try {
    await handleCasino(sock, msg, args, senderJid, chatId, senderName);
  } catch (err) {
    console.error('❌ Error Casino Command:', err);
  }
  return true;
}

async function handleBlackjackRouter(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body } = ctx;

  if (
    !body.toLowerCase().startsWith('!bj') &&
    !body.toLowerCase().startsWith('!blackjack') &&
    body.toLowerCase() !== '!hit' &&
    body.toLowerCase() !== '!stand'
  ) return false;

  let rawArgs = [];
  if (body.toLowerCase().startsWith('!blackjack')) {
    rawArgs = body.slice(10).trim().split(' ');
  } else if (body.toLowerCase().startsWith('!bj')) {
    rawArgs = body.slice(3).trim().split(' ');
  }

  const args = rawArgs.filter(Boolean);
  const mentionedJids = await resolveMentionedJids(msg, body, sock, chatId);

  try {
    await handleBlackjack(sock, msg, args, senderJid, chatId, mentionedJids, body, senderName);
  } catch (err) {
    console.error('❌ Error Blackjack Command:', err);
  }
  return true;
}

async function handleTopBustRouter(ctx) {
  if ((ctx.body || '').toLowerCase() !== '!top bust') return false;

  try {
    await handleTopBust(ctx);
  } catch (err) {
    console.error('❌ Error Top Bust Command:', err);
  }
  return true;
}

module.exports = { handleCasinoRouter, handleBlackjackRouter, handleTopBustRouter };