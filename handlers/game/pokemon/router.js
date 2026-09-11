// handlers/game/pokemon/router.js
// Routing !p: switch perintah pokemon.
const {
  getPokemonMenuText,
  handleMenu, handleSpawn, handleWildAttack, handleFlee,
  handleCatch, handleCollection, handleProfile, handleLeaderboard,
  handleShop, handleTeam, handleBattle, handleAttack,
  handleBattleCancel, handleFeed, handleEvolution,
  handleCheckPokemon, handleHelp, handlePokedex, handleElement,
} = require('./commands');
const { resolveMentionedJids, resolveNum } = require('../../../utils/jid');
const { listButton, sendMenu } = require('../../../utils/buttons');

async function handlePokemon(ctx) {
  const { sock, msg, chatId, isGroup, groupId, body, OWNER_JID, senderJid } = ctx;

  if (!body.startsWith('!p ')) return false;

  const rawArgs = body.slice(3).split(' ');
  const cmd     = rawArgs[0].toLowerCase();
  const args    = rawArgs.slice(1);

  const mentionedJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

  try {
    switch (cmd) {
      case 'menu':
      case 'start': {
        const fullJid = msg.key.participant || msg.key.remoteJid || senderJid;
        const userId  = resolveNum(fullJid);
        const menuText = getPokemonMenuText(userId, fullJid);
        await sendMenu(sock, chatId, {
          text: menuText,
          footer: '🎮 Pokemon — pilih aksi',
          quoted: msg,
          fallbackText: menuText,
          buttons: [
            listButton('⚡ Menu Pokemon', [
              { title: '⚔️ BATTLE & TANGKAP', rows: [
                { title: '✨ Spawn Pokemon', description: 'Munculkan Pokemon liar', id: '!p spawn' },
                { title: '🗡️ Serang', description: 'Serang Pokemon liar', id: '!p serang' },
                { title: '🎣 Lempar Pokeball', description: 'Tangkap Pokemon liar', id: '!p tangkap' },
                { title: '🏃 Kabur', description: 'Kabur dari pertarungan', id: '!p kabur' },
                { title: '⚔️ PvP Battle', description: 'Tantang pemain lain', id: '!p battle' },
              ] },
              { title: '👤 MANAJEMEN TRAINER', rows: [
                { title: '👤 Profil Trainer', description: 'Status level & statistik', id: '!p profil' },
                { title: '🎒 Koleksi Pokemon', description: 'Lihat daftar pokemonmu', id: '!p koleksi' },
                { title: '👥 Susunan Tim', description: 'Atur 3 pokemon tempur', id: '!p tim' },
                { title: '🍱 Beri Makan', description: 'Tambah exp Pokemon', id: '!p makan' },
                { title: '🦋 Evolusi Pokemon', description: 'Tingkatkan bentuk pokemon', id: '!p evol' },
              ] },
              { title: '📊 INFORMASI & DATA', rows: [
                { title: '🏆 Leaderboard', description: 'Peringkat top trainer', id: '!p rank' },
                { title: '🔬 Pokedex', description: 'Daftar semua spesies', id: '!p pokedex' },
                { title: '🌐 Tabel Elemen', description: 'Kelebihan & kelemahan tipe', id: '!p element' },
                { title: '📖 Panduan Lengkap', description: 'Daftar semua perintah !p', id: '!p help' },
              ] },
              { title: '🛒 TOKO POKEMON', rows: [
                { title: '🏪 Buka Toko', description: 'Beli Pokeball & makanan', id: '!p toko' },
              ] },
            ]),
          ],
        });
        break;
      }

      case 'spawn':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else {
          await handleSpawn(sock, msg, groupId);
        }
        break;

      case 'serang':
      case 'fight':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else {
          await handleWildAttack(sock, msg, groupId);
        }
        break;

      case 'kabur':
      case 'flee':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else {
          await handleFlee(sock, msg, groupId);
        }
        break;

      case 'pokedex':
      case 'dex':
        await handlePokedex(sock, msg, args);
        break;

      case 'tangkap':
      case 'catch':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else {
          await handleCatch(sock, msg, groupId);
        }
        break;

      case 'koleksi':
      case 'collection':
        await handleCollection(sock, msg);
        break;

      case 'profil':
      case 'profile':
      case 'stats':
        await handleProfile(sock, msg);
        break;

      case 'rank':
      case 'leaderboard':
        await handleLeaderboard(sock, msg);
        break;

      case 'toko':
      case 'shop':
        await handleShop(sock, msg, body);
        break;

      case 'tim':
      case 'team':
        await handleTeam(sock, msg);
        break;

      case 'battle':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else if (args[0] === 'cancel' || args[0] === 'batal') {
          await handleBattleCancel(sock, msg);
        } else if (!mentionedJid) {
          await sock.sendMessage(chatId, { text: '⚠️ Tag lawan!\nContoh: *!p battle @nama*' }, { quoted: msg });
        } else {
          await handleBattle(sock, msg, mentionedJid);
        }
        break;

      case 'lawan':
      case 'attack':
        if (!isGroup) {
          await sock.sendMessage(chatId, { text: '⚠️ Command ini hanya bisa di grup!' }, { quoted: msg });
        } else {
          await handleAttack(sock, msg);
        }
        break;

      case 'makan':
      case 'feed':
        await handleFeed(sock, msg);
        break;

      case 'evol':
      case 'evolusi':
        await handleEvolution(sock, msg);
        break;

      case 'cek':
      case 'check':
      case 'info':
        await handleCheckPokemon(sock, msg, args);
        break;

      case 'help':
      case 'bantuan':
        await handleHelp(sock, msg);
        break;

      case 'element':
      case 'elemen':
      case 'tipe':
        await handleElement(sock, msg, args);
        break;

      default:
        await sock.sendMessage(chatId, {
          text: `❓ Perintah tidak dikenal.\nKetik *!p menu* untuk daftar perintah.`,
        }, { quoted: msg });
    }
  } catch (err) {
    console.error(`❌ Error Pokemon command "${cmd}":`, err);
    await sock.sendMessage(chatId, {
      text: `❌ Terjadi error: ${err.message}`,
    }, { quoted: msg });
  }
  return true;
}

module.exports = { handlePokemon };