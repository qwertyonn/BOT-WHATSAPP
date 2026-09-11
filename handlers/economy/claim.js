// handlers/economy/claim.js
// Claim harian terpadu: !claim
// Sekali sehari (reset jam 00.00 WIB) memberi Money, Umpan, Pokeball,
// Apel, dan peluang kecil mendapat Emas (gold_ingot).
const ui = require('../../utils/ui');
const { resolveNum, getNumber } = require('../../utils/jid');
const { MATERIALS } = require('../../data/rpgData');
const {
  addMoney, getUserMoney,
  getFishingPlayer, updateFishingPlayer,
  getPokemonPlayer, savePokemonPlayer,
  getRpgPlayer, updateRpgPlayer,
  getWibDate, getDailyClaim, setDailyClaim,
} = require('../../data/db');

const MAX_POKEBALLS = 50;
const GOLD_CHANCE   = 3; // persen peluang mendapat 1 Emas
const GOLD_SELL     = MATERIALS.gold_ingot.sellPrice; // nilai jual 1 Emas

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function handleClaim(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;

  if (body.toLowerCase() !== '!claim') return false;

  const today = getWibDate();
  const rec   = getDailyClaim(senderJid);

  if (rec && rec.date === today) {
    await sock.sendMessage(chatId, {
      text: `⏳ *@${getNumber(senderJid)}*, kamu sudah claim hari ini!\n\n🕛 Claim berikutnya reset *jam 00.00 WIB*.`,
      mentions: [senderJid],
    }, { quoted: msg });
    return true;
  }

  const numKey = resolveNum(senderJid);
  const rewards = [];

  // 💰 Money 1250-3300
  const moneyAmt = rnd(1250, 3300);
  addMoney(senderJid, moneyAmt);
  rewards.push(ui.bullet('💰 Money', `+${ui.money(moneyAmt)}`));

  // 🪱 Umpan Cacing (bait_1) 4-7
  const baitAmt = rnd(4, 7);
  const fishPlayer = getFishingPlayer(senderJid);
  if (fishPlayer) {
    const bait = { ...(fishPlayer.bait || {}), bait_1: (fishPlayer.bait?.bait_1 || 0) + baitAmt };
    updateFishingPlayer(senderJid, { bait });
    rewards.push(ui.bullet('🪱 Umpan Cacing', `+${baitAmt}`));
  }

  // 🔴 Pokeball 2-4 (cap 50)
  const ballAmt = rnd(2, 4);
  const pokePlayer = getPokemonPlayer(numKey);
  if (pokePlayer) {
    const newBalls = Math.min(MAX_POKEBALLS, pokePlayer.pokeballs + ballAmt);
    savePokemonPlayer(numKey, { pokeballs: newBalls });
    rewards.push(ui.bullet('🔴 Pokeball', `+${ballAmt} (${newBalls}/${MAX_POKEBALLS})`));
  }

  // 🍎 Apel 1-2 (untuk stamina RPG)
  const appleAmt = rnd(1, 2);
  const rpgPlayer = getRpgPlayer(senderJid);
  if (rpgPlayer) {
    const inv = { ...(rpgPlayer.inventory || {}), apple: (rpgPlayer.inventory?.apple || 0) + appleAmt };
    updateRpgPlayer(senderJid, { inventory: inv });
    rewards.push(ui.bullet('🍎 Apel', `+${appleAmt}`));
  }

  // 🪙 Peluang kecil mendapat Emas (gold_ingot)
  let goldText = '';
  if (Math.random() * 100 < GOLD_CHANCE) {
    updateRpgPlayer(senderJid, { gold_ingot: (rpgPlayer?.gold_ingot || 0) + 1 });
    goldText = `\n\n🌟 *JACKPOT!* Kamu mendapat *1 🪙 Emas*!\n   (bisa dijual ${ui.money(GOLD_SELL)} money)`;
  }

  setDailyClaim(senderJid, today);

  const totalMoney = getUserMoney(senderJid);

  await sock.sendMessage(chatId, {
    text: ui.box('🎁 CLAIM HARIAN', [
      `@${getNumber(senderJid)} mendapat:`,
      ...rewards,
      ui.divider(),
      ui.kv('💰 Total Money', `*${ui.money(totalMoney)}*`),
      goldText,
    ]),
    mentions: [senderJid],
  }, { quoted: msg });

  return true;
}

module.exports = { handleClaim };
