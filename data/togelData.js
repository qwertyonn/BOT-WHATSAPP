// ============================================================
// TOGEL GAME DATA
// ============================================================
const TOGEL_CONFIG = {
  minBet: 100,
  // Hadiah per jumlah digit yang cocok dari belakang.
  // Tebak 2-4 digit; hadiah mengikuti digit cocok terbanyak.
  // 1D (hanya 1 digit cocok) tidak dibayar.
  prize: { 2: 70, 3: 400, 4: 3000 },
  maxDigits: 4,
  historyLimit: 20,
};

module.exports = { TOGEL_CONFIG };
