// handlers/game/rpg/router.js
// Routing !rpg: pre-handler prompt jual/beli/pakai + switch perintah.
const {
  handleRpgMenu, handleRpgProfile,
  handleRpgChop, handleRpgMine, handleRpgFight, handleRpgDuel,
  handleRpgAcceptDuel, handleRpgRejectDuel, handleRpgShop, handleRpgBuy,
  handleRpgUse, handleRpgCraft, handleRpgFusi, handleRpgEquip, handleRpgInv,
  handleRpgTop, handleRpgJual, handleRpgAttack, handleRpgFlee,
  handleRpgInfo, rpgSellPrompts, rpgBuyPrompts, rpgUsePrompts,
} = require('./commands');
const { handleRpgClass, handleRpgSkill } = require('./classSkills');
const { handleRaid } = require('./raid');
const { MATERIALS } = require('../../../data/rpgData');
const { resolveMentionedJids, sameUser } = require('../../../utils/jid');
const { listButton, sendMenu } = require('../../../utils/buttons');

async function handleRpgRouter(ctx) {
  const { sock, msg, chatId, body, senderJid } = ctx;

  // Pre-handler: reply prompt jual material angka (angka/all/semua)
  {
    const ci = msg.message?.extendedTextMessage?.contextInfo;
    const quotedId = ci?.stanzaId;
    const raw = body.trim().toLowerCase();
    const isQty = /^\d+$/.test(raw);
    const isAll = raw === 'all' || raw === 'semua';
    if (quotedId && rpgSellPrompts.has(quotedId) && (isQty || isAll)) {
      const sess = rpgSellPrompts.get(quotedId);
      if (!sameUser(sess.senderJid, senderJid)) return false;
      rpgSellPrompts.delete(quotedId);
      await handleRpgJual(sock, msg, [MATERIALS[sess.matKey]?.name || sess.matKey, ...(isQty ? [raw] : ['all'])]);
      return true;
    }
    // Pre-handler: reply prompt beli item (angka) → lanjutkan pembelian
    if (quotedId && rpgBuyPrompts.has(quotedId) && isQty) {
      const sess = rpgBuyPrompts.get(quotedId);
      if (!sameUser(sess.senderJid, senderJid)) return false;
      rpgBuyPrompts.delete(quotedId);
      await handleRpgBuy(sock, msg, [sess.itemInput, raw]);
      return true;
    }
    // Pre-handler: reply prompt pakai item (angka/all) → lanjutkan pemakaian
    if (quotedId && rpgUsePrompts.has(quotedId) && (isQty || isAll)) {
      const sess = rpgUsePrompts.get(quotedId);
      if (!sameUser(sess.senderJid, senderJid)) return false;
      rpgUsePrompts.delete(quotedId);
      await handleRpgUse(sock, msg, [sess.keyword, raw]);
      return true;
    }
  }

  if (!body.startsWith('!rpg ') && body.toLowerCase() !== '!rpg') return false;

  const rawArgs = body.slice(5).split(' ').filter(Boolean);
  const cmd     = (rawArgs[0] || 'menu').toLowerCase();
  const args    = rawArgs.slice(1);

  const mentionedJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

  try {
    switch (cmd) {
      case 'menu':
      case 'help':
      case 'start':
        await sendMenu(sock, chatId, {
          text: handleRpgMenu(),
          footer: '⚔️ RPG — pilih aksi',
          quoted: msg,
          fallbackText: handleRpgMenu(),
          buttons: [
            listButton('⚔️ RPG', [
              { title: '📝 INFO', rows: [
                { title: '👤 Profil', id: '!rpg profil' },
                { title: '📖 Info Material', id: '!rpg info material' },
                { title: '📋 Menu', id: '!rpg menu' },
              ] },
              { title: '🌲 GATHERING', rows: [
                { title: '🌲 Tebang', id: '!rpg tebang' },
                { title: '⛏️ Tambang', id: '!rpg tambang' },
              ] },
              { title: '⚔️ PERTARUNGAN', rows: [
                { title: '👹 Lawan Monster', id: '!rpg lawan' },
                { title: '👹 Raid Boss', id: '!rpg raid' },
                { title: '⚔️ Duel', id: '!rpg duel' },
                { title: '🤝 Terima', id: '!rpg terima' },
                { title: '❌ Tolak', id: '!rpg tolak' },
                { title: '🗡️ Serang', id: '!rpg serang' },
                { title: '🏃 Kabur', id: '!rpg kabur' },
              ] },
              { title: '🏆 KELAS & SKILL', rows: [
                { title: '🎭 Pilih Kelas', id: '!rpg kelas' },
                { title: '⚡ Pilih Skill', id: '!rpg skill' },
              ] },
              { title: '🏪 TOKO & ITEM', rows: [
                { title: '🏪 Toko', id: '!rpg shop' },
                { title: '💸 Jual Material', id: '!rpg jual' },
                { title: '🧪 Pakai Item', id: '!rpg pakai' },
                { title: '🎒 Inventori', id: '!rpg inv' },
              ] },
              { title: '🔨 TEMPA PERALATAN', rows: [
                { title: '⚒️ Tempa', id: '!rpg tempa' },
                { title: '🔮 Fusi', id: '!rpg fusi' },
                { title: '🛡️ Equip', id: '!rpg equip' },
              ] },
              { title: '📊 LEADERBOARD', rows: [
                { title: '🏆 Top', id: '!rpg top' },
              ] },
            ]),
          ],
        });
        break;

        // ─── UTALITAS FITUR JUAL BARU ──────────────────
      case 'jual':
      case 'sell':
        await handleRpgJual(sock, msg, args);
        break;

      case 'profil':
      case 'profile':
      case 'status':
        await handleRpgProfile(sock, msg);
        break;

      case 'tebang':
      case 'chop':
      case 'nebang':
        await handleRpgChop(sock, msg);
        break;

      case 'tambang':
      case 'mine':
        await handleRpgMine(sock, msg);
        break;

      case 'lawan':
      case 'fight':
      case 'monster':
        await handleRpgFight(sock, msg, args);
        break;

      case 'duel':
        await handleRpgDuel(sock, msg, mentionedJid);
        break;

      case 'terima':
      case 'accept':
        await handleRpgAcceptDuel(sock, msg);
        break;

      case 'serang':
      case 'attack':
        await handleRpgAttack(sock, msg, args);
        break;

      case 'kabur':
      case 'flee':
      case 'lari':
      case 'run':
        await handleRpgFlee(sock, msg);
        break;

      case 'tolak':
      case 'decline':
      case 'cancel':
        await handleRpgRejectDuel(sock, msg, args);
        break;

      case 'shop':
      case 'toko':
        await handleRpgShop(sock, msg, args);
        break;

      case 'beli':
      case 'buy':
        await handleRpgBuy(sock, msg, args);
        break;

      case 'pakai':
      case 'use':
        await handleRpgUse(sock, msg, args);
        break;

      case 'tempa':
      case 'craft':
      case 'forge':
        await handleRpgCraft(sock, msg, args);
        break;

      case 'fusi':
      case 'fuse':
        await handleRpgFusi(sock, msg, args);
        break;

      case 'equip':
      case 'pasang':
        await handleRpgEquip(sock, msg, args);
        break;

      case 'inv':
      case 'inventori':
      case 'inventory':
        await handleRpgInv(sock, msg);
        break;

      case 'top':
      case 'leaderboard':
      case 'rank':
        await handleRpgTop(sock, msg);
        break;

      case 'info':
      case 'informasi':
        await handleRpgInfo(sock, msg, args);
        break;

      case 'kelas':
      case 'class':
        await handleRpgClass(sock, msg, args);
        break;

      case 'skill':
        await handleRpgSkill(sock, msg, args);
        break;

      case 'raid':
        await handleRaid(sock, msg, args);
        break;

      default:
        await sock.sendMessage(chatId, { text: `❓ Perintah RPG tidak dikenal.\nKetik *!rpg menu* untuk daftar perintah.` }, { quoted: msg });
    }
  } catch (err) {
    console.error(`❌ Error RPG command "${cmd}":`, err);
    await sock.sendMessage(chatId, { text: `❌ Terjadi error RPG: ${err.message}` }, { quoted: msg });
  }
  return true;
}

module.exports = { handleRpgRouter };