// handlers/game/buckshot/router.js
// Router dan handler aksi permainan Buckshot Roulette.
const { addMoney, deductMoney, getUserMoney } = require('../../../data/db');
const { sameUser, resolveMentionedJids, getNumber } = require('../../../utils/jid');
const { parsePositiveAmount } = require('../../../utils/amount');
const ui = require('../../../utils/ui');
const { sendMenu } = require('../../../utils/buttons');
const {
  buckshotGames,
  DEFAULT_HP,
  generateShells,
  giveItemsToAlivePlayers,
  getAlivePlayers,
  advanceTurn,
  scheduleGameTimer,
  clearGameTimer,
  refundAllBets,
  deleteGame,
} = require('./state');
const {
  ITEM_ICONS,
  renderHp,
  playerName,
  renderInviteMessage,
  buildInviteButtons,
  renderReloadMessage,
  renderGameStatus,
  buildGameButtons,
  renderVictoryMessage,
} = require('./render');
const { decideBotTurn } = require('./bot');

/**
 * Cek apakah pemain sedang aktif di sesi game lain
 */
function isPlayerInAnyGame(targetJid) {
  for (const [_, game] of buckshotGames.entries()) {
    if (game.players.some(p => sameUser(p, targetJid))) return true;
    if (game.invited && game.invited.some(p => sameUser(p, targetJid))) return true;
  }
  return false;
}

/**
 * Petakan JID target yang di-mention (atau berasal dari tombol list) ke
 * pemain yang benar-benar ada di game secara alias-aware. Ini penting sebab
 * JID hasil resolve bisa beda domain dari key game.hp / game.players (mis.
 * fallback @s.whatsapp.net vs member asli @lid) — tanpa ini tembakan/borgol
 * tidak mengenai pemain yang dimaksud dan mention `@nomor` tidak ter-highlight.
 */
function resolveTargetInGame(game, targetJid, senderJid = null) {
  if (!targetJid) return targetJid;
  const candidates = getAlivePlayers(game).filter(j => !senderJid || !sameUser(j, senderJid));
  const exact = candidates.find(j => j === targetJid);
  if (exact) return exact;
  const matched = candidates.find(j => sameUser(j, targetJid));
  return matched || targetJid;
}

/**
 * Memulai ronde / reload shotgun baru
 */
async function startNewRound(sock, chatId, game) {
  const shellsInfo = generateShells();
  game.shells = shellsInfo.shells;
  game.doubleNext = false;
  game.handcuffed = null;
  game.handcuffedLastRound = null;
  game.knownShells = {};

  const itemsGiven = giveItemsToAlivePlayers(game, 2);

  const reloadMsg = renderReloadMessage(shellsInfo, itemsGiven);
  await sock.sendMessage(chatId, {
    text: reloadMsg,
    mentions: game.players.filter(j => j !== 'DEALER_BOT'),
  });

  const statusMsg = renderGameStatus(game, '🎯 Siap memulai ronde baru!');
  const buttons = buildGameButtons(game);
  await sendMenu(sock, chatId, {
    text: statusMsg,
    footer: `🎲 Giliran: ${playerName(game.turn)}`,
    buttons,
    fallbackText: statusMsg,
    mentions: game.players.filter(j => j !== 'DEALER_BOT'),
  });

  scheduleTurnTimeout(sock, chatId, game);

  // Jika giliran awal adalah Dealer Bot
  if (game.turn === 'DEALER_BOT') {
    await processBotTurn(sock, chatId, game);
  }
}

/**
 * Atur timer timeout giliran (2 menit)
 */
function scheduleTurnTimeout(sock, chatId, game) {
  scheduleGameTimer(sock, chatId, async (g) => {
    if (g.stage !== 'playing') return;
    const afkJid = g.turn;
    const msgText = `⏰ Waktu giliran ${playerName(afkJid)} habis (2 menit)! Pemain dinyatakan gugur karena AFK.`;
    g.hp[afkJid] = 0;
    await checkGameEndOrAdvance(sock, chatId, g, msgText);
  });
}

/**
 * Cek kondisi akhir game atau lanjut giliran berikutnya
 */
async function checkGameEndOrAdvance(sock, chatId, game, note = '') {
  const alive = getAlivePlayers(game);

  // 1. Pemenang ditemukan (sisa 1 orang)
  if (alive.length <= 1) {
    clearGameTimer(game);
    buckshotGames.delete(chatId);

    const winnerJid = alive[0];
    if (winnerJid && winnerJid !== 'DEALER_BOT') {
      const pot = game.pot || (game.bet * game.players.length);
      if (pot > 0) addMoney(winnerJid, pot);
      const vicMsg = renderVictoryMessage(winnerJid, pot, game.bet);
      await sock.sendMessage(chatId, {
        text: vicMsg,
        mentions: [winnerJid],
      });
    } else if (winnerJid === 'DEALER_BOT') {
      const text = [
        `💀 *GAME OVER — DEALER MENANG!* 💀`,
        ``,
        `Semua pemain telah gugur di hadapan sang Dealer.`,
        game.bet > 0 ? `Uang taruhan disita oleh meja maut!` : `Coba lagi lain kali!`,
      ].join('\n');
      await sock.sendMessage(chatId, { text });
    } else {
      await sock.sendMessage(chatId, { text: '💀 Semua pemain gugur! Meja maut berakhir seri tanpa pemenang.' });
    }
    return;
  }

  // 2. Jika peluru di senapan sudah habis -> reload ronde baru
  if (game.shells.length === 0) {
    if (note) {
      await sock.sendMessage(chatId, {
        text: note,
        mentions: game.players.filter(j => j !== 'DEALER_BOT'),
      });
    }
    await startNewRound(sock, chatId, game);
    return;
  }

  // 3. Game masih berjalan normal -> update status
  const statusMsg = renderGameStatus(game, note);
  const buttons = buildGameButtons(game);
  await sendMenu(sock, chatId, {
    text: statusMsg,
    footer: `🎲 Giliran: ${playerName(game.turn)}`,
    buttons,
    fallbackText: statusMsg,
    mentions: game.players.filter(j => j !== 'DEALER_BOT'),
  });

  scheduleTurnTimeout(sock, chatId, game);

  // Jika giliran jatuh ke Dealer Bot
  if (game.turn === 'DEALER_BOT') {
    await processBotTurn(sock, chatId, game);
  }
}

/**
 * Proses aksi giliran Dealer Bot
 */
async function processBotTurn(sock, chatId, game) {
  if (game.turn !== 'DEALER_BOT' || game.stage !== 'playing') return;

  // Jeda sedikit untuk memberi kesan berpikir
  await new Promise(res => setTimeout(res, 1200));

  const actions = decideBotTurn(game);

  for (const act of actions) {
    if (game.stage !== 'playing' || game.shells.length === 0) break;

    if (act.type === 'item') {
      const itemNote = await useItemLogic(sock, chatId, game, 'DEALER_BOT', act.item, act.target);
      await sock.sendMessage(chatId, {
        text: itemNote,
        mentions: game.players.filter(j => j !== 'DEALER_BOT'),
      });
      await new Promise(res => setTimeout(res, 1000));
    } else if (act.type === 'shoot') {
      await executeShoot(sock, chatId, game, 'DEALER_BOT', act.target);
      return; // Setelah nembak, executeShoot akan menghandle pergantian giliran / reload
    }
  }

  // Fallback jika tidak ada aksi shoot yang dihasilkan bot
  if (game.stage === 'playing' && game.turn === 'DEALER_BOT' && game.shells.length > 0) {
    const aliveOpp = getAlivePlayers(game).filter(j => j !== 'DEALER_BOT');
    const target = aliveOpp[0] || 'self';
    await executeShoot(sock, chatId, game, 'DEALER_BOT', target);
  }
}

/**
 * Logika eksekusi penggunaan item
 */
async function useItemLogic(sock, chatId, game, userJid, itemName, optionalTargetJid = null) {
  const itemIdx = (game.items[userJid] || []).indexOf(itemName);
  if (itemIdx === -1) return null;

  // Hapus item dari saku
  game.items[userJid].splice(itemIdx, 1);

  if (itemName === 'kaca') {
    const topShell = game.shells[0];
    if (!game.knownShells) game.knownShells = {};
    game.knownShells[userJid] = topShell;

    if (userJid === 'DEALER_BOT') {
      return `🔍 *Dealer* menggunakan Kaca Pembesar dan memeriksa isi senapan...`;
    }

    const typeStr = topShell === 'live' ? '🔴 PELURU TAJAM' : '⚪ PELURU KOSONG';
    return `🔍 ${playerName(userJid)} mengintip ruang peluru senapan!\n(Hasil intip untukmu: *${typeStr}*)`;
  }

  if (itemName === 'rokok') {
    const oldHp = game.hp[userJid];
    if (game.hp[userJid] < game.maxHp) {
      game.hp[userJid] += 1;
      return `🚬 ${playerName(userJid)} mengisap Rokok dan merasa tenang. HP bertambah +1 (${renderHp(game.hp[userJid], game.maxHp)})!`;
    }
    return `🚬 ${playerName(userJid)} mengisap Rokok, tapi HP sudah penuh (${renderHp(game.hp[userJid], game.maxHp)})!`;
  }

  if (itemName === 'gergaji') {
    game.doubleNext = true;
    return `🪚 ${playerName(userJid)} memotong laras senapan dengan Gergaji!\nTembakan berikutnya bernilai *2 DAMAGE*!`;
  }

  if (itemName === 'borgol') {
    let target = optionalTargetJid;
    if (!target) {
      const alive = getAlivePlayers(game).filter(j => !sameUser(j, userJid));
      target = alive[0];
    }
    game.handcuffed = target;
    return `⛓️ ${playerName(userJid)} memborgol tangan ${playerName(target)}!\nGiliran ${playerName(target)} akan dilewati 1 putaran.`;
  }

  if (itemName === 'bir') {
    const ejected = game.shells.shift();
    // Reset info intip jika ada
    game.knownShells = {};
    const ejStr = ejected === 'live' ? '🔴 PELURU TAJAM' : '⚪ PELURU KOSONG';
    return `🍺 ${playerName(userJid)} menenggak Bir dan mengokang senapan!\nShell teratas terlontar keluar: *${ejStr}* dibuang ke lantai!`;
  }

  return null;
}

/**
 * Eksekusi aksi tembak (Shoot)
 */
async function executeShoot(sock, chatId, game, shooterJid, targetChoice) {
  const currentShell = game.shells.shift();
  // Reset intip shell
  game.knownShells = {};

  const damage = game.doubleNext ? 2 : 1;
  game.doubleNext = false; // Efek gergaji habis setelah 1 tembakan

  const isLive = currentShell === 'live';
  let targetJid = null;
  const isShootSelf = targetChoice === 'self' || targetChoice === 'me' || targetChoice === 'diri';

  if (isShootSelf) {
    targetJid = shooterJid;
  } else {
    // Tembak target spesifik atau lawan default
    targetJid = targetChoice;
    if (!targetJid || sameUser(targetJid, shooterJid)) {
      const aliveOpp = getAlivePlayers(game).filter(j => !sameUser(j, shooterJid));
      targetJid = aliveOpp[0];
    }
    // JID hasil resolve bisa beda domain dari key game (mis. fallback
    // @s.whatsapp.net vs member @lid) — petakan ke pemain asli agar damage,
    // HP, dan mention di pesan konsisten.
    targetJid = resolveTargetInGame(game, targetJid, shooterJid);
  }

  let note = '';

  if (isShootSelf) {
    if (isLive) {
      // Tembak diri sendiri + TAJAM -> Kena damage, giliran pindah
      game.hp[shooterJid] = Math.max(0, game.hp[shooterJid] - damage);
      note = `💥 *DORRR!* Peluru 🔴 TAJAM meledak!\n${playerName(shooterJid)} menembak diri sendiri dan terkena *${damage} Damage*! (Sisa HP: ${game.hp[shooterJid]})`;
      advanceTurn(game);
    } else {
      // Tembak diri sendiri + KOSONG -> Aman, DAPAT BONUS TURN!
      note = `💨 *KLIK!* Peluru ⚪ KOSONG.\n${playerName(shooterJid)} menembak diri sendiri dan selamat!\n✨ *Bonus Giliran:* ${playerName(shooterJid)} mendapat giliran lagi!`;
      // Giliran tidak pindah
    }
  } else {
    // Tembak lawan
    if (isLive) {
      // Tembak lawan + TAJAM -> Lawan kena damage, giliran pindah
      game.hp[targetJid] = Math.max(0, game.hp[targetJid] - damage);
      note = `💥 *DORRR!* Peluru 🔴 TAJAM meledak tepat di wajah ${playerName(targetJid)}!\nKena *${damage} Damage*! (Sisa HP: ${game.hp[targetJid]})`;
      advanceTurn(game);
    } else {
      // Tembak lawan + KOSONG -> Tidak kena apa-apa, giliran pindah normal
      note = `💨 *KLIK!* Peluru ⚪ KOSONG.\n${playerName(shooterJid)} menembak ${playerName(targetJid)} tapi tidak terjadi apa-apa!\nGiliran berpindah.`;
      advanceTurn(game);
    }
  }

  await checkGameEndOrAdvance(sock, chatId, game, note);
}

/**
 * Main handler router untuk Buckshot Roulette
 */
async function handleBuckshot(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, body } = ctx;
  if (!body) return false;

  const rawTokens = body.trim().split(/\s+/);
  const firstToken = (rawTokens[0] || '').toLowerCase();

  const VALID_TOKENS = [
    '!buckshot', '!br', '!tembak', '!shoot', '!item',
    '!terima', '!tolak', '!brterima', '!brtolak',
    '!buckshotstats', '!brstats', '!brmulai', '!brbatal',
  ];

  if (!VALID_TOKENS.includes(firstToken)) return false;

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '⚠️ Buckshot Roulette hanya dapat dimainkan di dalam grup!' }, { quoted: msg });
    return true;
  }

  const currentGame = buckshotGames.get(chatId);

  // ─────────────────────────────────────────────────────────────
  // 1. BUAT TANTANGAN BARU (!buckshot / !br)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!buckshot' || firstToken === '!br') {
    const subArg = (rawTokens[1] || '').toLowerCase();

    // Menu panduan jika "!br help" atau "!buckshot help"
    if (subArg === 'help' || subArg === 'bantuan') {
      const helpText = [
        `🔫 *PANDUAN BUCKSHOT ROULETTE* 🔫`,
        ``,
        `Rolet senapan shotgun maut 1v1 vs Bot atau 2-4 pemain!`,
        ``,
        `📋 *Cara Memulai:*`,
        `• *!br bot [taruhan]* → Main solo melawan Dealer Bot.`,
        `• *!br @user [taruhan]* → Tantang 1 lawan.`,
        `• *!br @user1 @user2 [taruhan]* → Tantang hingga 3 lawan (maks 4 pemain).`,
        `• *!terima* / *!tolak* → Terima/tolak tantangan yang masuk.`,
        `• *!brmulai* → Mulai langsung jika minimal 2 orang sudah terima.`,
        `• *!brbatal* → Batalkan tantangan yang belum mulai.`,
        ``,
        `🎮 *Saat Bermain:*`,
        `• *!tembak diri* → Tembak diri sendiri (bonus giliran jika kosong).`,
        `• *!tembak dia* / *!tembak @lawan* → Tembak lawan.`,
        `• *!item [kaca/rokok/gergaji/borgol/bir]* → Pakai item saku.`,
        `• *!brstats* → Lihat status senapan & HP saat ini.`,
        ``,
        `🎒 *Daftar Item:*`,
        `• 🔍 *kaca* : Intip isi peluru teratas shotgun.`,
        `• 🚬 *rokok* : Pulihkan +1 HP sendiri (maks 3 HP).`,
        `• 🪚 *gergaji* : Tembakan berikutnya x2 Damage (2 damage).`,
        `• ⛓️ *borgol* : Lewati 1 giliran lawan.`,
        `• 🍺 *bir* : Buang (eject) peluru teratas tanpa ditembak.`,
      ].join('\n');

      await sock.sendMessage(chatId, { text: helpText }, { quoted: msg });
      return true;
    }

    // Cek jika sudah ada game berjalan di grup ini
    if (currentGame) {
      await sock.sendMessage(chatId, {
        text: '⚠️ Sudah ada permainan Buckshot Roulette yang sedang berjalan di grup ini!\nSelesaikan atau batalkan dulu dengan *!brbatal*.',
      }, { quoted: msg });
      return true;
    }

    // Cek apakah pembuat game sedang aktif di grup lain
    if (isPlayerInAnyGame(senderJid)) {
      await sock.sendMessage(chatId, {
        text: '⚠️ Kamu masih memiliki sesi permainan aktif di grup lain!',
      }, { quoted: msg });
      return true;
    }

    // Parsing tag & taruhan
    const mentionedJids = await resolveMentionedJids(msg, body, sock, chatId);
    // Hapus diri sendiri dari daftar mention jika sengaja ditag
    const filteredMentions = mentionedJids.filter(j => !sameUser(j, senderJid));

    // Ekstrak taruhan dari argumen terakhir jika berupa angka
    let betAmount = 0;
    const lastToken = rawTokens[rawTokens.length - 1];
    const parsedBet = parsePositiveAmount(lastToken);
    if (parsedBet !== null) {
      betAmount = parsedBet;
    }

    // Validasi saldo pembuat game jika ada taruhan
    if (betAmount > 0) {
      const myMoney = getUserMoney(senderJid);
      if (myMoney < betAmount) {
        await sock.sendMessage(chatId, {
          text: `❌ Saldo kamu tidak cukup untuk taruhan ini! Saldo: *${ui.money(myMoney)} Money*.`,
        }, { quoted: msg });
        return true;
      }
    }

    // A. Mode VS DEALER BOT (!br bot [taruhan] atau !br tanpa tag)
    const isBotMatch = subArg === 'bot' || filteredMentions.length === 0;
    if (isBotMatch) {
      if (betAmount > 0) {
        if (!deductMoney(senderJid, betAmount)) {
          await sock.sendMessage(chatId, { text: '❌ Gagal memotong saldo taruhan.' }, { quoted: msg });
          return true;
        }
      }

      const newGame = {
        stage: 'playing',
        chatId,
        creator: senderJid,
        isBotMatch: true,
        players: [senderJid, 'DEALER_BOT'],
        paidPlayers: betAmount > 0 ? [senderJid] : [],
        turn: senderJid, // Pemain duluan
        hp: {
          [senderJid]: DEFAULT_HP,
          DEALER_BOT: DEFAULT_HP,
        },
        maxHp: DEFAULT_HP,
        items: {
          [senderJid]: [],
          DEALER_BOT: [],
        },
        shells: [],
        bet: betAmount,
        pot: betAmount * 2,
        doubleNext: false,
        handcuffed: null,
        handcuffedLastRound: null,
        knownShells: {},
        timer: null,
      };

      buckshotGames.set(chatId, newGame);

      await sock.sendMessage(chatId, {
        text: `🎲 *BUCKSHOT ROULETTE — DUEL MELAWAN SANG DEALER!* 🎲\n\n@${getNumber(senderJid)} menantang Meja Maut sang Dealer!\nTaruhan: *${betAmount > 0 ? `${ui.money(betAmount)} Money` : 'Gratis'}*`,
        mentions: [senderJid],
      }, { quoted: msg });

      await startNewRound(sock, chatId, newGame);
      return true;
    }

    // B. Mode PVP (2 - 4 Pemain)
    if (filteredMentions.length > 3) {
      await sock.sendMessage(chatId, {
        text: '❌ Maksimal pemain yang bisa ditantang adalah 3 orang (total 4 pemain)!',
      }, { quoted: msg });
      return true;
    }

    // Cek apakah ada pemain yang ditantang sedang aktif di game lain
    for (const oppJid of filteredMentions) {
      if (isPlayerInAnyGame(oppJid)) {
        await sock.sendMessage(chatId, {
          text: `❌ Pemain @${getNumber(oppJid)} masih memiliki sesi game aktif di tempat lain.`,
          mentions: [oppJid],
        }, { quoted: msg });
        return true;
      }
    }

    const newGame = {
      stage: 'waiting',
      chatId,
      creator: senderJid,
      isBotMatch: false,
      invited: filteredMentions,
      accepted: { [senderJid]: true },
      players: [senderJid],
      paidPlayers: [],
      turn: null,
      hp: {},
      maxHp: DEFAULT_HP,
      items: {},
      shells: [],
      bet: betAmount,
      pot: 0,
      doubleNext: false,
      handcuffed: null,
      handcuffedLastRound: null,
      knownShells: {},
      timer: null,
    };

    buckshotGames.set(chatId, newGame);

    // Jadwalkan timeout undangan (2 menit)
    scheduleGameTimer(sock, chatId, async (g) => {
      if (g.stage !== 'waiting') return;
      refundAllBets(g);
      deleteGame(chatId);
      await sock.sendMessage(chatId, {
        text: '⏰ Waktu konfirmasi tantangan Buckshot Roulette telah habis. Permainan dibatalkan.',
      });
    });

    const inviteText = renderInviteMessage(newGame);
    const buttons = buildInviteButtons(newGame);
    await sendMenu(sock, chatId, {
      text: inviteText,
      footer: `🎲 Buckshot Roulette Challenge`,
      buttons,
      fallbackText: inviteText,
      mentions: [senderJid, ...filteredMentions],
      quoted: msg,
    });

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 2. TERIMA TANTANGAN (!terima / !brterima)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!terima' || firstToken === '!brterima') {
    if (!currentGame || currentGame.stage !== 'waiting') return false;

    // Pastikan hanya orang yang diundang yang bisa menerima
    const isInvited = currentGame.invited.some(j => sameUser(j, senderJid));
    if (!isInvited) {
      await sock.sendMessage(chatId, {
        text: '❌ Kamu tidak termasuk dalam daftar pemain yang diundang untuk game ini!',
      }, { quoted: msg });
      return true;
    }

    if (currentGame.accepted[senderJid]) {
      await sock.sendMessage(chatId, {
        text: '✅ Kamu sudah menerima tantangan ini sebelumnya!',
      }, { quoted: msg });
      return true;
    }

    // Validasi saldo
    if (currentGame.bet > 0) {
      const myMoney = getUserMoney(senderJid);
      if (myMoney < currentGame.bet) {
        await sock.sendMessage(chatId, {
          text: `❌ Saldo kamu tidak cukup untuk menerima taruhan ini! Butuh: *${ui.money(currentGame.bet)} Money*, Saldo: *${ui.money(myMoney)} Money*.`,
        }, { quoted: msg });
        return true;
      }

      if (!deductMoney(senderJid, currentGame.bet)) {
        await sock.sendMessage(chatId, { text: '❌ Gagal memotong saldo taruhan.' }, { quoted: msg });
        return true;
      }
      currentGame.paidPlayers.push(senderJid);
    }

    currentGame.accepted[senderJid] = true;
    currentGame.players.push(senderJid);

    const totalAccepted = Object.keys(currentGame.accepted).length;
    const totalRequired = currentGame.invited.length + 1;

    // Jika semua yang diundang sudah menerima -> Langsung mulai game!
    if (totalAccepted >= totalRequired) {
      // Potong saldo creator juga jika ada taruhan
      if (currentGame.bet > 0 && !currentGame.paidPlayers.some(p => sameUser(p, currentGame.creator))) {
        if (!deductMoney(currentGame.creator, currentGame.bet)) {
          refundAllBets(currentGame);
          deleteGame(chatId);
          await sock.sendMessage(chatId, {
            text: '❌ Saldo pembuat game tiba-tiba tidak cukup! Tantangan dibatalkan dan taruhan dikembalikan.',
          });
          return true;
        }
        currentGame.paidPlayers.push(currentGame.creator);
      }

      currentGame.stage = 'playing';
      currentGame.pot = currentGame.bet * currentGame.players.length;
      for (const p of currentGame.players) {
        currentGame.hp[p] = DEFAULT_HP;
        currentGame.items[p] = [];
      }
      // Tentukan giliran pertama secara acak
      currentGame.turn = currentGame.players[Math.floor(Math.random() * currentGame.players.length)];

      await sock.sendMessage(chatId, {
        text: `🎲 *SEMUA PEMAIN SIAP! BUCKSHOT ROULETTE DIMULAI!* 🎲\nTotal Pot: *${ui.money(currentGame.pot)} Money*\nGiliran Pertama: ${playerName(currentGame.turn)}`,
        mentions: currentGame.players,
      }, { quoted: msg });

      await startNewRound(sock, chatId, currentGame);
      return true;
    }

    // Belum semua, berikan notifikasi status
    const inviteText = renderInviteMessage(currentGame);
    const buttons = buildInviteButtons(currentGame);
    await sendMenu(sock, chatId, {
      text: `✅ @${getNumber(senderJid)} telah menerima tantangan!\n\n${inviteText}`,
      footer: `🎲 Buckshot Roulette Challenge`,
      buttons,
      fallbackText: `✅ @${getNumber(senderJid)} telah menerima tantangan!\n\n${inviteText}`,
      mentions: [senderJid, ...currentGame.invited],
      quoted: msg,
    });

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 3. TOLAK / BATALKAN TANTANGAN (!tolak / !brtolak / !brbatal)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!tolak' || firstToken === '!brtolak' || firstToken === '!brbatal') {
    if (!currentGame) return false;

    // Creator membatalkan saat waiting
    if (sameUser(currentGame.creator, senderJid)) {
      if (currentGame.stage === 'waiting') {
        refundAllBets(currentGame);
        deleteGame(chatId);
        await sock.sendMessage(chatId, {
          text: '❌ Tantangan Buckshot Roulette telah dibatalkan oleh pembuat game. Seluruh taruhan dikembalikan.',
        }, { quoted: msg });
        return true;
      }
      if (currentGame.stage === 'playing') {
        await sock.sendMessage(chatId, {
          text: '⚠️ Permainan sedang berlangsung! Tidak bisa dibatalkan di tengah jalan.',
        }, { quoted: msg });
        return true;
      }
    }

    // Lawan menolak tantangan
    if (currentGame.stage === 'waiting') {
      const isInvited = currentGame.invited.some(j => sameUser(j, senderJid));
      if (!isInvited) return false;

      refundAllBets(currentGame);
      deleteGame(chatId);
      await sock.sendMessage(chatId, {
        text: `❌ @${getNumber(senderJid)} menolak tantangan! Permainan dibatalkan dan taruhan dikembalikan.`,
        mentions: [senderJid],
      }, { quoted: msg });
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. MULAI MANUAL (!brmulai)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!brmulai') {
    if (!currentGame || currentGame.stage !== 'waiting') return false;

    if (!sameUser(currentGame.creator, senderJid)) {
      await sock.sendMessage(chatId, { text: '⚠️ Hanya pembuat game yang dapat mengetik *!brmulai*!' }, { quoted: msg });
      return true;
    }

    if (currentGame.players.length < 2) {
      await sock.sendMessage(chatId, { text: '❌ Minimal harus ada 2 pemain yang sudah menerima tantangan!' }, { quoted: msg });
      return true;
    }

    // Potong saldo creator jika belum
    if (currentGame.bet > 0 && !currentGame.paidPlayers.some(p => sameUser(p, currentGame.creator))) {
      if (!deductMoney(currentGame.creator, currentGame.bet)) {
        refundAllBets(currentGame);
        deleteGame(chatId);
        await sock.sendMessage(chatId, {
          text: '❌ Saldo pembuat game tidak cukup! Tantangan dibatalkan dan taruhan dikembalikan.',
        });
        return true;
      }
      currentGame.paidPlayers.push(currentGame.creator);
    }

    currentGame.stage = 'playing';
    currentGame.pot = currentGame.bet * currentGame.players.length;
    for (const p of currentGame.players) {
      currentGame.hp[p] = DEFAULT_HP;
      currentGame.items[p] = [];
    }
    currentGame.turn = currentGame.players[Math.floor(Math.random() * currentGame.players.length)];

    await sock.sendMessage(chatId, {
      text: `🎲 *BUCKSHOT ROULETTE DIMULAI DENGAN ${currentGame.players.length} PEMAIN!* 🎲\nTotal Pot: *${ui.money(currentGame.pot)} Money*\nGiliran Pertama: ${playerName(currentGame.turn)}`,
      mentions: currentGame.players,
    }, { quoted: msg });

    await startNewRound(sock, chatId, currentGame);
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. LIHAT STATUS GAME (!brstats / !buckshotstats)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!buckshotstats' || firstToken === '!brstats') {
    if (!currentGame || currentGame.stage !== 'playing') {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada game Buckshot Roulette yang sedang aktif di grup ini.' }, { quoted: msg });
      return true;
    }

    const statusMsg = renderGameStatus(currentGame);
    await sock.sendMessage(chatId, {
      text: statusMsg,
      mentions: currentGame.players.filter(j => j !== 'DEALER_BOT'),
    }, { quoted: msg });
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 6. PAKAI ITEM (!item [kaca/rokok/gergaji/borgol/bir])
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!item') {
    if (!currentGame || currentGame.stage !== 'playing') {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada game Buckshot Roulette yang aktif.' }, { quoted: msg });
      return true;
    }

    if (!sameUser(currentGame.turn, senderJid)) {
      await sock.sendMessage(chatId, {
        text: `⚠️ Bukan giliranmu! Saat ini giliran ${playerName(currentGame.turn)}.`,
        mentions: currentGame.players.filter(j => j !== 'DEALER_BOT'),
      }, { quoted: msg });
      return true;
    }

    const chosenItem = (rawTokens[1] || '').toLowerCase();
    const VALID_ITEMS = ['kaca', 'rokok', 'gergaji', 'borgol', 'bir'];

    if (!VALID_ITEMS.includes(chosenItem)) {
      await sock.sendMessage(chatId, {
        text: '⚠️ Item tidak valid!\nPilihan: *!item kaca* | *!item rokok* | *!item gergaji* | *!item borgol* | *!item bir*',
      }, { quoted: msg });
      return true;
    }

    const userItems = currentGame.items[senderJid] || [];
    if (!userItems.includes(chosenItem)) {
      await sock.sendMessage(chatId, {
        text: `❌ Kamu tidak memiliki item *${ITEM_ICONS[chosenItem] || chosenItem}* di sakumu!`,
      }, { quoted: msg });
      return true;
    }

    // Cek anti-spam borgol
    if (chosenItem === 'borgol' && currentGame.handcuffed) {
      await sock.sendMessage(chatId, {
        text: '⚠️ Sudah ada lawan yang diborgol putaran ini!',
      }, { quoted: msg });
      return true;
    }

    // Resolusi target untuk borgol jika multiplayer
    let targetJid = null;
    if (chosenItem === 'borgol') {
      const mentions = await resolveMentionedJids(msg, body, sock, chatId);
      const aliveOpp = getAlivePlayers(currentGame).filter(j => !sameUser(j, senderJid));
      if (mentions.length > 0) {
        targetJid = resolveTargetInGame(currentGame, mentions[0], senderJid);
      } else {
        targetJid = aliveOpp[0];
      }

      if (!targetJid || !getAlivePlayers(currentGame).some(j => sameUser(j, targetJid))) {
        await sock.sendMessage(chatId, {
          text: '❌ Target borgol tidak valid! Tag pemain lawan yang masih hidup.',
        }, { quoted: msg });
        return true;
      }

      if (currentGame.handcuffedLastRound && sameUser(currentGame.handcuffedLastRound, targetJid)) {
        await sock.sendMessage(chatId, {
          text: `❌ ${playerName(targetJid)} baru saja diborgol di round sebelumnya! Tidak bisa diborgol 2x berturut-turut.`,
          mentions: [targetJid],
        }, { quoted: msg });
        return true;
      }
    }

    const note = await useItemLogic(sock, chatId, currentGame, senderJid, chosenItem, targetJid);
    if (note) {
      await sock.sendMessage(chatId, {
        text: note,
        mentions: currentGame.players.filter(j => j !== 'DEALER_BOT'),
      }, { quoted: msg });
    }

    // Cek jika bir melontarkan peluru terakhir
    if (currentGame.shells.length === 0) {
      await startNewRound(sock, chatId, currentGame);
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 7. TEMBAK (!tembak / !shoot)
  // ─────────────────────────────────────────────────────────────
  if (firstToken === '!tembak' || firstToken === '!shoot') {
    if (!currentGame || currentGame.stage !== 'playing') {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada game Buckshot Roulette yang sedang berjalan!' }, { quoted: msg });
      return true;
    }

    if (!sameUser(currentGame.turn, senderJid)) {
      await sock.sendMessage(chatId, {
        text: `⚠️ Bukan giliranmu! Saat ini giliran ${playerName(currentGame.turn)}.`,
        mentions: currentGame.players.filter(j => j !== 'DEALER_BOT'),
      }, { quoted: msg });
      return true;
    }

    const subArg = (rawTokens[1] || '').toLowerCase();
    const isShootSelf = subArg === 'diri' || subArg === 'me' || subArg === 'myself';

    let targetChoice = 'self';
    if (!isShootSelf) {
      const mentions = await resolveMentionedJids(msg, body, sock, chatId);
      const aliveOpp = getAlivePlayers(currentGame).filter(j => !sameUser(j, senderJid));

      if (mentions.length > 0) {
        targetChoice = resolveTargetInGame(currentGame, mentions[0], senderJid);
        // Pastikan target masih hidup dan bukan diri sendiri
        if (sameUser(targetChoice, senderJid)) {
          targetChoice = 'self';
        } else if (currentGame.hp[targetChoice] <= 0) {
          await sock.sendMessage(chatId, { text: '❌ Pemain tersebut sudah gugur! Pilih target lain yang masih hidup.' }, { quoted: msg });
          return true;
        }
      } else if (aliveOpp.length === 1) {
        // Mode 1v1 (atau tersisa 1 lawan)
        targetChoice = aliveOpp[0];
      } else {
        // Multiplayer > 2 pemain harus spesifikasikan target
        await sock.sendMessage(chatId, {
          text: `⚠️ Tag lawan yang ingin kamu tembak!\nContoh: *!tembak @lawan* atau ketik *!tembak diri*.`,
        }, { quoted: msg });
        return true;
      }
    }

    await executeShoot(sock, chatId, currentGame, senderJid, targetChoice);
    return true;
  }

  return false;
}

module.exports = {
  handleBuckshot,
  resolveTargetInGame,
};
