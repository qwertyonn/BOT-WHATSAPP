// handlers/gacha/commands.js
// Logika perintah gacha: tarik 1x/10x, info, pemberian hadiah ke pemain.
const ui = require('../../utils/ui');
const { listButton } = require('../../utils/buttons');
const {
  autoRegisterUser, getUserMoney, addMoney, deductMoney,
  getFishingPlayer, updateFishingPlayer,
  getRpgPlayer, updateRpgPlayer,
  getPokemonPlayer, savePokemonPlayer,
  getGachaStats, updateGachaStats,
} = require('../../data/db');
const { resolveNum } = require('../../utils/jid');
const { GACHA_PRICE, GACHA_MULTI, GACHA_PITY, RARITIES } = require('../../data/gachaData');
const { MATERIALS, SHOP_ITEMS, KONTRAK_KELAS } = require('../../data/rpgData');
const { rollRarity, pickReward, moneyAmount, rarityInfo } = require('../../game/gachaEngine');
const { pickFish, FISH_SELL_TIERS } = require('../../game/fishingEngine');

// Teks hadiah untuk box hasil.
function rewardText(reward) {
  switch (reward.type) {
    case 'money':
      return `💰 *${ui.money(moneyAmount(reward))}* Money`;
    case 'material': {
      const m = MATERIALS[reward.id];
      return `${m?.emoji || '🪨'} *${m?.name || reward.id}* x${reward.count}`;
    }
    case 'shopItem': {
      const item = reward.id === 'kontrak_kelas' ? KONTRAK_KELAS : SHOP_ITEMS[reward.id];
      return `${item?.emoji || '📦'} *${item?.name || reward.id}* x${reward.count}`;
    }
    case 'fish':
      return `🐟 *Ikan Tier ${reward.tier}* x${reward.count}`;
    case 'pokeball':
      return `🔴 *Pokeball* x${reward.count}`;
    case 'bait': {
      const pool = require('../../data/gameData').BAITS;
      const b = pool.find(x => x.id === reward.id);
      return `${b?.emoji || '🪱'} *${b?.name || reward.id}* x${reward.count}`;
    }
    default:
      return `${reward.type} x${reward.count || 1}`;
  }
}

// Beri satu hadiah ke pemain. Auto-register bila player game belum ada.
function grantReward(jid, senderName, reward) {
  autoRegisterUser(jid, senderName);

  switch (reward.type) {
    case 'money':
      addMoney(jid, moneyAmount(reward));
      return null;

    case 'material': {
      const p = getRpgPlayer(jid);
      if (!p) return null;
      p[reward.id] = (p[reward.id] || 0) + reward.count;
      updateRpgPlayer(jid, p);
      return null;
    }

    case 'shopItem': {
      const p = getRpgPlayer(jid);
      if (!p) return null;
      p.inventory = p.inventory || {};
      p.inventory[reward.id] = (p.inventory[reward.id] || 0) + reward.count;
      updateRpgPlayer(jid, p);
      return null;
    }

    case 'fish': {
      const p = getFishingPlayer(jid);
      if (!p) return null;
      const inv = { ...(p.inventory || {}) };
      for (let i = 0; i < (reward.count || 1); i++) {
        const f = pickFish(reward.tier);
        if (!f) continue;
        if (inv[f.name]) { inv[f.name].count++; inv[f.name].weight += f.weight; }
        else inv[f.name] = { count: 1, weight: f.weight, tier: f.tier };
      }
      updateFishingPlayer(jid, { inventory: inv });
      return null;
    }

    case 'pokeball': {
      const key = resolveNum(jid);
      const p = getPokemonPlayer(key);
      if (!p) return null;
      p.pokeballs = (p.pokeballs || 0) + reward.count;
      savePokemonPlayer(key, p);
      return null;
    }

    case 'bait': {
      const p = getFishingPlayer(jid);
      if (!p) return null;
      p.bait = p.bait || {};
      p.bait[reward.id] = (p.bait[reward.id] || 0) + reward.count;
      updateFishingPlayer(jid, { bait: p.bait });
      return null;
    }

    default:
      return null;
  }
}

// Tarik `count` kali (1 atau GACHA_MULTI). Mengembalikan box hasil.
function pull(jid, senderName, count) {
  autoRegisterUser(jid, senderName);
  const total = GACHA_PRICE * count;
  if (getUserMoney(jid) < total) {
    return ui.box('🎰 GACHA', [
      `❌ Money tidak cukup!`,
      ui.kv('💰 Butuh', `*${ui.money(total)}*`),
      ui.kv('💰 Punya', `*${ui.money(getUserMoney(jid))}*`),
      '',
      `Harga: *${ui.money(GACHA_PRICE)}*/tarik`,
      `\t\t*${ui.money(GACHA_PRICE * GACHA_MULTI)}*/10x`,
    ]);
  }

  if (!deductMoney(jid, total)) {
    return ui.box('🎰 GACHA', [`❌ Money tidak cukup! Butuh *${ui.money(total)}*.`]);
  }

  let stats = getGachaStats(jid) || { pity: 0, pulls: 0 };
  const lines = [];
  let gotMythic = false;

  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(stats.pity || 0);
    const reward = pickReward(rarity);
    grantReward(jid, senderName, reward);

    stats.pity = (stats.pity || 0) + 1;
    stats.pulls = (stats.pulls || 0) + 1;
    if (rarity === 'legendary' || rarity === 'mythic') { stats.pity = 0; if (rarity === 'mythic') gotMythic = true; }

    const info = rarityInfo(rarity);
    lines.push(`${info.emoji} ${info.name} → ${rewardText(reward)}`);
  }

  updateGachaStats(jid, stats);

  const boxLines = [
    `🎉 *${senderName}* melakukan gacha *${count}x*!`,
    ui.divider(22),
    ...lines,
    ui.divider(22),
    ui.kv('💸 Biaya', `-Rp ${ui.money(total)}`),
    ui.kv('💰 Sisa Saldo', `Rp ${ui.money(getUserMoney(jid))}`),
    ui.kv('🎯 Pity', `${stats.pity}/${GACHA_PITY}`),
  ];
  if (gotMythic) boxLines.push('', `🔮 *MYTHIC REWARD!* Keberuntungan luar biasa!`);
  else if (lines.some(l => l.includes('🟡 Legendary'))) boxLines.push('', `🟡 *LEGENDARY REWARD!* Tarikan sangat langka!`);
  return ui.box('🎰 *HASIL GACHA*', boxLines, 'Ketik !gacha 1 atau !gacha 10 untuk main lagi');
}

// Info peluang & pity.
function info(jid) {
  const stats = getGachaStats(jid) || { pity: 0, pulls: 0 };
  const lines = [
    `💸 Biaya: *Rp ${ui.money(GACHA_PRICE)}* / 1x`,
    `         *Rp ${ui.money(GACHA_PRICE * GACHA_MULTI)}* / 10x`,
    '',
    ui.section('PELUANG DROP'),
    ...RARITIES.map(r => `${r.emoji} ${r.name} — *${r.chance}%*`),
    `\n💡 _Legendary dijamin pada tarikan ke-${GACHA_PITY} (pity count)_`,
    '',
    ui.divider(22),
    ui.kv('📊 Total Tarikan', `${stats.pulls}x`),
    ui.kv('🎯 Status Pity', `${stats.pity}/${GACHA_PITY}`),
  ];
  return ui.box('🎰 *INFO & RATE GACHA*', lines, 'Ketik !gacha untuk mulai');
}

module.exports = { pull, info };
