// ============================================================
// TOGEL ENGINE — Logika murni, tanpa IO/dependency lain.
// Aturan: tebak 2-4 digit, cocok dari digit belakang nomor keluar.
// Pot = akumulasi semua taruhan; hadiah per taruhan yang cocok
// = pot × prize[jumlah digit cocok]. Besar bet tidak memengaruhi
// hadiah (hanya menentukan kelayakan). 1D tidak dibayar.
// EV sangat tinggi.
// ============================================================
const crypto = require('crypto');
const { TOGEL_CONFIG } = require('../data/togelData');

// Validasi angka taruhan: 2-4 digit angka (tanpa tipe).
function validateBet(numbers) {
  const clean = String(numbers || '').trim();
  if (!/^[0-9]{2,4}$/.test(clean)) {
    return { ok: false, reason: `Tebakan harus berupa *2-4 digit* (0-9).` };
  }
  return { ok: true, numbers: clean };
}

// Acak nomor pemenang 4 digit (pad nol di depan). Pakai crypto agar
// tidak bisa ditebak/diprediksi (anti-manipulasi saat admin buka).
function rollWinningNumber() {
  const n = crypto.randomInt(0, 10000);
  return String(n).padStart(4, '0');
}

// Hitung berapa digit yang cocok berurutan DARI BELAKANG antara
// tebakan dan nomor keluar. Contoh: w=4829, tebak '5829' → 3 (829).
function getMatchCount(numbers, winning) {
  if (!winning) return 0;
  const w = String(winning).padStart(4, '0');
  const t = String(numbers);
  let count = 0;
  for (let i = 0; i < Math.min(t.length, w.length); i++) {
    if (t[t.length - 1 - i] === w[w.length - 1 - i]) count++;
    else break;
  }
  return count;
}

// Hadiah untuk satu pasangan dihitung langsung di summarizeRound
// (1D tidak dibayar).

// Gabungkan beberapa taruhan: { bets: [{numbers,amount}], winning, pot }
// → { totalWin, winners: [{numbers,amount,prize,matchCount}], hasWinner }
// Setiap taruhan yang cocok dibayar penuh pot × prize (tidak dibagi).
// 1D tidak dibayar.
function summarizeRound(bets, winning, pot) {
  const winners = [];
  let totalWin = 0;
  for (const b of bets || []) {
    const matchCount = getMatchCount(b.numbers, winning);
    const prize = matchCount >= 2
      ? Math.floor(pot * (TOGEL_CONFIG.prize[matchCount] || 0))
      : 0;
    if (prize > 0) {
      winners.push({ ...b, prize, matchCount });
      totalWin += prize;
    }
  }
  return { totalWin, winners, hasWinner: winners.length > 0 };
}

module.exports = {
  validateBet, rollWinningNumber, getMatchCount, summarizeRound,
};
