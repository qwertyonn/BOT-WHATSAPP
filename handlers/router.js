// handlers/router.js
// Dispatch 3 tingkat:
//   1. GLOBAL   — handler pasif yg wajib cek tiap pesan (AFK, Family100, TicTacToe)
//   2. PREFIX   — Map O(1): token pertama pesan → handler (short-circuit)
//   3. FALLBACK — scan sisa handler berurutan (identik dgn alur lama, utk
//                 free-text: jawaban game, reply angka prompt, dll)
// Urutan asli dipertahankan lewat HANDLERS + set `tried` agar tiap handler
// tetap dieksekusi tepat sekali → behavior 100% sama dgn rantai linier lama.
const { handleBanCommands, handleAllowGroup, handleDelete, handleHidetag, handleSw, handleModeCommand } = require('./owner/ownerCommands');
const {
  handleSend, handleTovid, handleChange, handleTiktok, handlePlay,
  handleSticker, handleToaudio, handleToimg, handleSmeme, handlePlayLirik,
} = require('./media/commands');
const { handleFamily100 } = require('./game/minigame/family100');
const { handleTtt } = require('./game/minigame/ttt');
const { handleSnakes } = require('./game/minigame/snakes');
const { handleSuit } = require('./game/minigame/suit');
const { handleBoom } = require('./game/minigame/boom');
const { handleMenu, handleGame } = require('./utility/menuCommands');
const { handleMe, handleTopMoney } = require('./economy/profile');
const { handleClaim } = require('./economy/claim');
const { handleGetpp, handleAcc, handleReset, handleGantiNama, runAfkDetection, handleAfkCommand } = require('./utility/utilityCommands');
const { handleTransfer, handleBansos } = require('./economy/transfer');
const { handleBank, handleRob, handleTopBegal, handleBobol, handleTopBobol } = require('./economy/bank');
const { handleTogel } = require('./game/togel/router');
const { handleFishit } = require('./game/fishit/router');
const { handlePokemon } = require('./game/pokemon/router');
const { handleCasinoRouter, handleBlackjackRouter, handleTopBustRouter } = require('./game/casino/router');
const { handleRpgRouter } = require('./game/rpg/router');
const { handleMahjong } = require('./game/mahjong/router');
const { handleBuckshot } = require('./game/buckshot/router');
const { handlePet } = require('./pet/router');
const { handleGacha } = require('./gacha/router');
const { handleBot } = require('./ai/commands');
const {
  handleJokes, handleQuote, handleDare, handleTruth,
  handleEightball, handleDice, handleBase64, handleCalc, handleJodoh,
  handleTebakAngka,
} = require('./nexa/commands');

// Daftar master (urutan asli dipertahankan untuk fallback).
const HANDLERS = [
  handleBanCommands,
  handleAllowGroup,
  handleHidetag,
  handleSend,
  handleTovid,
  handleMenu,
  handleFamily100,
  handleTtt,
  handleSnakes,
  handleChange,
  handleTiktok,
  handlePlay,
  handlePlayLirik,
  handleGame,
  handleFishit,
  handlePokemon,
  handleSticker,
  handleToaudio,
  handleToimg,
  handleDelete,
  handleSmeme,
  handleMe,
  handleTopMoney,
  handleTopBustRouter,
  handleTopBegal,
  handleTopBobol,
  handleClaim,
  handleGetpp,
  handleAcc,
  handleSuit,
  handleBoom,
  handleCasinoRouter,
  handleBlackjackRouter,
  handleTogel,
  handleReset,
  handleGantiNama,
  handleTransfer,
  handleBansos,
  handleBank,
  handleRob,
  handleBobol,
  runAfkDetection,
  handleAfkCommand,
  handleRpgRouter,
  handlePet,
  handleGacha,
  handleMahjong,
  handleBuckshot,
  handleJokes,
  handleQuote,
  handleDare,
  handleTruth,
  handleEightball,
  handleDice,
  handleBase64,
  handleCalc,
  handleJodoh,
  handleTebakAngka,
  handleBot,
  handleModeCommand,
];

// Handler pasif: selalu dijalankan untuk setiap pesan (tidak saling overlap
// dengan command berprefix — mereka hanya return true di trigger sendiri).
const GLOBAL_HANDLERS = [runAfkDetection, handleFamily100, handleTtt];

// Map token pertama (lowercase) → handler. Satu token bisa multi-handler bila
// bentuk command-nya beragam (mis. !s/!sticker, !toimg/!toimage).
const COMMAND_INDEX = new Map([
  ['!ban', handleBanCommands],
  ['!unban', handleBanCommands],
  ['!banlist', handleBanCommands],
  ['!allowgroup', handleAllowGroup],
  ['!hidetag', handleHidetag],
  ['!send', handleSend],
  ['!tovid', handleTovid],
  ['!change', handleChange],
  ['!tt', handleTiktok],
  ['!ttaudio', handleTiktok],
  ['!ttvideo', handleTiktok],
  ['!play', handlePlay],
  ['!playlirik', handlePlayLirik],
  ['!audio', handlePlay],
  ['!video', handlePlay],
  ['!s', handleSticker],
  ['!sticker', handleSticker],
  ['!toaudio', handleToaudio],
  ['!toimg', handleToimg],
  ['!toimage', handleToimg],
  ['!smeme', handleSmeme],
  ['!del', handleDelete],
  ['!delete', handleDelete],
  ['!sw', handleSw],
  ['!menu', handleMenu],
  ['!game', handleGame],
  ['!me', handleMe],
  ['!top', handleTopMoney],
  ['!topmoney', handleTopMoney],
  ['!claim', handleClaim],
  ['!getpp', handleGetpp],
  ['!acc', handleAcc],
  ['!unacc', handleAcc],
  ['!reset', handleReset],
  ['!gantinama', handleGantiNama],
  ['!rename', handleGantiNama],
  ['!afk', handleAfkCommand],
  ['!tf', handleTransfer],
  ['!transfer', handleTransfer],
  ['!bansos', handleBansos],
  ['!bank', handleBank],
  ['!depo', handleBank],
  ['!deposit', handleBank],
  ['!tarik', handleBank],
  ['!wd', handleBank],
  ['!withdraw', handleBank],
  ['!klaimbunga', handleBank],
  ['!begal', handleRob],
  ['!rob', handleRob],
  ['!bobol', handleBobol],
  ['!family100', handleFamily100],
  ['!ttt', handleTtt],
  ['!snakes', handleSnakes],
  ['!suit', handleSuit],
  ['!tebakboom', handleBoom],
  ['!boom', handleBoom],
  ['!buka', handleBoom],
  ['!fishit', handleFishit],
  ['!p', handlePokemon],
  ['!rpg', handleRpgRouter],
  ['!pet', handlePet],
  ['!gacha', handleGacha],
  ['!casino', handleCasinoRouter],
  ['!bj', handleBlackjackRouter],
  ['!blackjack', handleBlackjackRouter],
  ['!hit', handleBlackjackRouter],
  ['!stand', handleBlackjackRouter],
  ['!togel', handleTogel],
  ['!mahjong', handleMahjong],
  ['!draw', handleMahjong],
  ['!dis', handleMahjong],
  ['!discard', handleMahjong],
  ['!menang', handleMahjong],
  ['!ron', handleMahjong],
  ['!tsumo', handleMahjong],
  ['!lanjut', handleMahjong],
  ['!jokes', handleJokes],
  ['!lucu', handleJokes],
  ['!quote', handleQuote],
  ['!kutipan', handleQuote],
  ['!dare', handleDare],
  ['!tantangan', handleDare],
  ['!truth', handleTruth],
  ['!jujur', handleTruth],
  ['!8ball', handleEightball],
  ['!magic', handleEightball],
  ['!dice', handleDice],
  ['!roll', handleDice],
  ['!base64', handleBase64],
  ['!b64', handleBase64],
  ['!calc', handleCalc],
  ['!kalkulator', handleCalc],
  ['!math', handleCalc],
  ['!jadian', handleJodoh],
  ['!jodoh', handleJodoh],
  ['!jodian', handleJodoh],
  ['!tebak', handleTebakAngka],
  ['!tebakangka', handleTebakAngka],
  ['!buckshot', handleBuckshot],
  ['!br', handleBuckshot],
  ['!tembak', handleBuckshot],
  ['!shoot', handleBuckshot],
  ['!item', handleBuckshot],
  ['!buckshotstats', handleBuckshot],
  ['!brstats', handleBuckshot],
  ['!terima', handleBuckshot],
  ['!tolak', handleBuckshot],
  ['!brterima', handleBuckshot],
  ['!brtolak', handleBuckshot],
  ['!brmulai', handleBuckshot],
  ['!brbatal', handleBuckshot],
  ['!mode', handleModeCommand],
]);

async function route(ctx) {
  const tried = new Set();

  // 1. Global passives (AFK, Family100 aktif, TicTacToe angka) — tiap pesan.
  for (const handler of GLOBAL_HANDLERS) {
    tried.add(handler);
    if (await handler(ctx)) return true;
  }

  // 2. Prefix dispatch O(1) — short-circuit untuk command berprefix.
  const token = (ctx.body || '').trim().split(/\s+/)[0].toLowerCase();
  const direct = COMMAND_INDEX.get(token);
  if (direct) {
    tried.add(direct);
    if (await direct(ctx)) return true;
  }

  // 3. Fallback: scan sisa handler berurutan (sama persis dgn alur lama).
  //    Menangkap free-text: jawaban Family100, reply angka prompt jual/beli,
  //    gerakan ular tangga, dll.
  for (const handler of HANDLERS) {
    if (tried.has(handler)) continue;
    if (await handler(ctx)) return true;
  }
  return false;
}

module.exports = { route, HANDLERS, COMMAND_INDEX, GLOBAL_HANDLERS };
