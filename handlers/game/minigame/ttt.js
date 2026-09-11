// handlers/game/minigame/ttt.js
// Game Tic Tac Toe: input langsung 1-9.
const { sameUser, resolveMentionedJids, getNumber } = require('../../../utils/jid');

const tttGames = new Map();

async function handleTtt(ctx) {
  const { sock, msg, chatId, body } = ctx;

  const isTttCommand = body.toLowerCase().startsWith('!ttt');
  const isSingleDigitMove = /^[1-9]$/.test(body.trim()) && tttGames.has(chatId) && tttGames.get(chatId).status === 'playing';

  if (!isTttCommand && !isSingleDigitMove) return false;

  const senderJid = msg.key.participant || msg.key.remoteJid;
  const currentGame = tttGames.get(chatId);

  // Helper: Merender papan dengan sekat vertikal saja
  const renderBoard = (board) => {
      return `  ${board[0]} | ${board[1]} | ${board[2]} \n  ${board[3]} | ${board[4]} | ${board[5]} \n  ${board[6]} | ${board[7]} | ${board[8]} `;
  };

  // Helper: Memeriksa kombinasi kemenangan
  const checkWin = (board) => {
      const wins = [
          [0, 1, 2], [3, 4, 5], [6, 7, 8],
          [0, 3, 6], [1, 4, 7], [2, 5, 8],
          [0, 4, 8], [2, 4, 6]
      ];
      return wins.some(([a, b, c]) => board[a] === board[b] && board[b] === board[c]);
  };

  // Helper: Memeriksa hasil seri (Draw)
  const checkDraw = (board) => {
      return board.every(cell => cell === '❌' || cell === '⭕');
  };

  // 1. EVALUASI INPUT LANGKAH (Bisa dari !ttt 1 atau langsung ketik angka 1)
  let moveDigit = null;
  if (isSingleDigitMove) {
      moveDigit = body.trim();
  } else if (isTttCommand) {
      const args = body.trim().split(/ +/).slice(1);
      if (args[0] && /^[1-9]$/.test(args[0])) {
          moveDigit = args[0];
      }
  }

  if (moveDigit) {
      if (!currentGame || currentGame.status !== 'playing') {
          await sock.sendMessage(chatId, { text: '❌ Tidak ada game yang sedang berjalan. Mulai game baru dengan mengetik *!ttt*.' }, { quoted: msg });
          return true;
      }
      if (!sameUser(senderJid, currentGame.player1) && !sameUser(senderJid, currentGame.player2)) {
          await sock.sendMessage(chatId, { text: '⚠️ Kamu penonton, dilarang ikut campur dalam papan permainan!' }, { quoted: msg });
          return true;
      }
      if (!sameUser(senderJid, currentGame.turn)) {
          await sock.sendMessage(chatId, { text: `⏳ *Bukan giliranmu!* Giliran saat ini adalah milik *@${getNumber(currentGame.turn)}*`, mentions: [currentGame.turn] }, { quoted: msg });
          return true;
      }

      const indeksKlip = parseInt(moveDigit) - 1;
      if (currentGame.board[indeksKlip] === '❌' || currentGame.board[indeksKlip] === '⭕') {
          await sock.sendMessage(chatId, { text: '⚠️ Kotak tersebut sudah terisi! Silakan pilih angka kotak lain yang kosong.' }, { quoted: msg });
          return true;
      }

      // Tempatkan simbol pemain di papan (gunakan JID kanonik dari sesi)
      const playerKey = sameUser(senderJid, currentGame.player1) ? currentGame.player1 : currentGame.player2;
      currentGame.board[indeksKlip] = currentGame.symbols[playerKey];

      // Evaluasi Kondisi Menang
      if (checkWin(currentGame.board)) {
          const p1 = currentGame.player1;
          const p2 = currentGame.player2;
          tttGames.delete(chatId);
          await sock.sendMessage(chatId, {
              text: `🎉 *PERMAINAN SELESAI!* 🎉\n\n🏆 Selamat *@${getNumber(senderJid)}* berhasil memenangkan permainan Tic Tac Toe!\n\n👑 *Papan Akhir:*\n${renderBoard(currentGame.board)}`,
              mentions: [p1, p2]
          }, { quoted: msg });
          return true;
      }

      // Evaluasi Kondisi Seri/Draw
      if (checkDraw(currentGame.board)) {
          const p1 = currentGame.player1;
          const p2 = currentGame.player2;
          tttGames.delete(chatId);
          await sock.sendMessage(chatId, {
              text: `🤝 *GAME OVER - DRAW!* 🤝\n\nKedua pemain sama-sama kuat. Seluruh kotak papan permainan telah terisi penuh!\n\n🤖 *Papan Akhir:*\n${renderBoard(currentGame.board)}`,
              mentions: [p1, p2]
          }, { quoted: msg });
          return true;
      }

      // Berganti Giliran Pemain
      currentGame.turn = sameUser(currentGame.turn, currentGame.player1) ? currentGame.player2 : currentGame.player1;
      await sock.sendMessage(chatId, {
          text: `🎮 *Tic Tac Toe* 🎮\n\nGiliran Melangkah: *@${getNumber(currentGame.turn)}* (${currentGame.symbols[currentGame.turn]})\n\n${renderBoard(currentGame.board)}\n\n💡 Ketik angka *1-9* langsung untuk mengisi kotak!`,
          mentions: [currentGame.turn]
      }, { quoted: msg });
      return true;
  }

  // 2. EVALUASI UTAMA PEMBUATAN ROOM / SYSTEM CONTROL (Harus pakai !ttt)
  if (isTttCommand) {
      const tttArgs = body.trim().split(/ +/).slice(1);
      const mentionedJid = await resolveMentionedJids(msg, body, sock, chatId);

      // Fitur Menyerah / Membatalkan game
      if (tttArgs[0]?.toLowerCase() === 'menyerah' || tttArgs[0]?.toLowerCase() === 'batal' || tttArgs[0]?.toLowerCase() === 'quit') {
          if (!currentGame) {
              await sock.sendMessage(chatId, { text: '❌ Tidak ada permainan Tic Tac Toe yang berjalan di chat ini.' }, { quoted: msg });
              return true;
          }
          if (currentGame.status === 'waiting' && sameUser(senderJid, currentGame.player1)) {
              tttGames.delete(chatId);
              await sock.sendMessage(chatId, { text: '⏹️ Antrean tantangan Tic Tac Toe telah dibatalkan.' }, { quoted: msg });
          } else if (currentGame.status === 'playing' && (sameUser(senderJid, currentGame.player1) || sameUser(senderJid, currentGame.player2))) {
              const pemenang = sameUser(senderJid, currentGame.player1) ? currentGame.player2 : currentGame.player1;
              tttGames.delete(chatId);
              await sock.sendMessage(chatId, {
                  text: `🏳️ *@${getNumber(senderJid)}* menyatakan menyerah!\n\n🏆 Kemenangan mutlak diberikan kepada *@${getNumber(pemenang)}*. Game selesai!`,
                  mentions: [senderJid, pemenang]
              }, { quoted: msg });
          } else {
              await sock.sendMessage(chatId, { text: '⚠️ Kamu bukan pemain dari sesi game aktif saat ini!' }, { quoted: msg });
          }
          return true;
      }

      // Jalur Utama Tantangan Langsung (!ttt @tag)
      if (mentionedJid.length > 0) {
          if (currentGame) {
              await sock.sendMessage(chatId, { text: '⚠️ Selesaikan atau batalkan dulu game yang masih aktif saat ini di ruang chat.' }, { quoted: msg });
              return true;
          }

          const lawanJid = mentionedJid[0];
          if (sameUser(lawanJid, senderJid)) {
              await sock.sendMessage(chatId, { text: '❌ Kamu tidak bisa menantang diri sendiri.' }, { quoted: msg });
              return true;
          }

          // Acak giliran pertama secara adil
          const daftarPemain = [senderJid, lawanJid];
          const giliranPertama = daftarPemain[Math.floor(Math.random() * 2)];

          const gameBaru = {
              status: 'playing',
              player1: senderJid,
              player2: lawanJid,
              board: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'],
              turn: giliranPertama,
              symbols: {
                  [senderJid]: '❌',
                  [lawanJid]: '⭕'
              }
          };
          tttGames.set(chatId, gameBaru);

          await sock.sendMessage(chatId, {
              text: `🎮 *Tantangan Tic Tac Toe Dimulai!* 🎮\n\n❌ *@${getNumber(senderJid)}* vs ⭕ *@${getNumber(lawanJid)}*\n\n🎲 Hasil acak giliran pertama jatuh kepada: *@${getNumber(giliranPertama)}*\n\n${renderBoard(gameBaru.board)}\n\nKetik angka *1-9* langsung untuk memilih kotak!`,
              mentions: [senderJid, lawanJid]
          }, { quoted: msg });
          return true;
      }

      // Jalur Utama Antrean Terbuka (!ttt biasa)
      if (!currentGame) {
          tttGames.set(chatId, {
              status: 'waiting',
              player1: senderJid,
              player2: null,
              board: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'],
              turn: null,
              symbols: {}
          });

          await sock.sendMessage(chatId, {
              text: `🎮 *Tic Tac Toe - Room Terbuka* 🎮\n\n*@${getNumber(senderJid)}* membuka room dan siap bertanding!\n\n👉 Siapa saja bisa mengetik *!ttt* untuk langsung masuk ke arena.\n👉 Ketik *!ttt batal* jika ingin membubarkan room antrean.`,
              mentions: [senderJid]
          }, { quoted: msg });
      } else if (currentGame.status === 'waiting') {
          if (sameUser(currentGame.player1, senderJid)) {
              await sock.sendMessage(chatId, { text: '⏳ Kamu sudah ada di dalam antrean. Mohon tunggu pemain lain bergabung.' }, { quoted: msg });
              return true;
          }

          currentGame.player2 = senderJid;
          currentGame.status = 'playing';

          const daftarPemain = [currentGame.player1, currentGame.player2];
          currentGame.turn = daftarPemain[Math.floor(Math.random() * 2)];

          currentGame.symbols[currentGame.player1] = '❌';
          currentGame.symbols[currentGame.player2] = '⭕';

          await sock.sendMessage(chatId, {
              text: `🎮 *Lawan Ditemukan! Pertandingan Dimulai* 🎮\n\n❌ *@${getNumber(currentGame.player1)}* vs ⭕ *@${getNumber(currentGame.player2)}*\n\n🎲 Hasil acak giliran pertama jatuh kepada: *@${getNumber(currentGame.turn)}*\n\n${renderBoard(currentGame.board)}\n\nKetik angka *1-9* langsung untuk mengisi langkah pertamamu!`,
              mentions: [currentGame.player1, currentGame.player2]
          }, { quoted: msg });
      } else {
          await sock.sendMessage(chatId, { text: '⚠️ Room chat sedang penuh dengan pertandingan aktif. Tunggu hingga game usai!' }, { quoted: msg });
      }
      return true;
  }

  return true;
}

module.exports = { handleTtt };