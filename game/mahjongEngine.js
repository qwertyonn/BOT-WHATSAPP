// ============================================================
// MAHJONG ENGINE — Logika murni, tanpa IO/dependency lain.
// Varian sederhana: 3 suit (Man/Pin/Sou) x 1-9 x 4 = 108 tile.
// Target menang: 4 set (sequence ATAU triplet) + 1 pair.
// Tanpa honor/bonus/flower, tanpa chi/pon/kan/dora/furiten.
// Menang via tsumo (self-draw) atau ron (claim tile discard).
// ============================================================

// TILE_ID = `${suit}${rank}`; suit: m=Man, p=Pin, s=Sou; rank 1-9.
const SUITS = ['m', 'p', 's'];

function tileId(suit, rank) {
  return `${suit}${rank}`;
}

// Baca suit+rank dari tileId ("m5" -> {suit:'m', rank:5})
function parseTile(tile) {
  const s = String(tile || '').trim().toLowerCase();
  const m = /^([mps])([1-9])$/.exec(s);
  if (!m) return null;
  return { suit: m[1], rank: Number(m[2]) };
}

// Tile code → label tampilan ("m5" -> "M5")
function tileLabel(tile) {
  const p = parseTile(tile);
  if (!p) return String(tile);
  return `${p.suit.toUpperCase()}${p.rank}`;
}

// Buat wall 108 tile teracak.
function createWall() {
  const wall = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let i = 0; i < 4; i++) wall.push(tileId(suit, rank));
    }
  }
  // Fisher-Yates shuffle
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// Bagikan 13 tile ke satu pemain (ambil dari wall).
function dealHand(wall) {
  const hand = [];
  for (let i = 0; i < 13; i++) hand.push(wall.pop());
  return sortHand(hand);
}

// Sortir hand: grup per suit, lalu urut rank.
function sortHand(hand) {
  const bySuit = { m: [], p: [], s: [] };
  for (const t of hand) {
    const p = parseTile(t);
    bySuit[p.suit].push(p.rank);
  }
  const out = [];
  for (const suit of SUITS) {
    bySuit[suit].sort((a, b) => a - b);
    for (const rank of bySuit[suit]) out.push(tileId(suit, rank));
  }
  return out;
}

// Pengambilan kartu fisik/numerik: hitung berapa banyak tile yang dipakai dari wall.
// Tapi untuk validasi kemenangan, kita kerjakan dari kumpulan tile arbitrer.

// ─── DETEKSI KEMENANGAN ──────────────────────────────────
// Hand menang bila bisa dipecah jadi 4 set + 1 pair.
// set = meld 3 (sequence m1m2m3 ATAU triplet m5m5m5), pair = 2 identik.
// Strategi: pilih dulu pasangan (2 tile identik), lalu sisa 12 tile harus
// bisa jadi 4 set. Coba semua kemungkinan pasangan.
function isWinningHandString(tiles) {
  const list = tiles.map(parseTile).filter(Boolean);
  if (list.length % 3 !== 2) return { win: false, breakdown: null };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i].suit === list[j].suit && list[i].rank === list[j].rank) {
        const rest = list.map((x, k) => (k === i || k === j ? null : x)).filter(Boolean);
        if (solveSets(rest, new Set(), 0)) {
          return { win: true, breakdown: null };
        }
      }
    }
  }
  return { win: false, breakdown: null };
}

// Backtracking murni set: 12 tile → 4 set (triplet / sequence).
function solveSets(tiles, used, meldsFound) {
  if (used.size === tiles.length) return meldsFound === 4;
  // Mulai dari tile terendah yang belum dipakai.
  let start = -1;
  for (let i = 0; i < tiles.length; i++) {
    if (!used.has(i)) { start = i; break; }
  }
  if (start < 0) return false;

  const s = tiles[start];
  // 1. Triplet.
  let tIdx = [];
  for (let i = start + 1; i < tiles.length; i++) {
    if (!used.has(i) && tiles[i].suit === s.suit && tiles[i].rank === s.rank) tIdx.push(i);
  }
  if (tIdx.length >= 2) {
    used.add(start); used.add(tIdx[0]); used.add(tIdx[1]);
    if (solveSets(tiles, used, meldsFound + 1)) return true;
    used.delete(start); used.delete(tIdx[0]); used.delete(tIdx[1]);
  }

  // 2. Sequence.
  if (s.rank <= 7) {
    const need = [s.rank + 1, s.rank + 2];
    const found = [];
    for (const r of need) {
      let idx = -1;
      for (let i = start + 1; i < tiles.length; i++) {
        if (!used.has(i) && tiles[i].suit === s.suit && tiles[i].rank === r) { idx = i; break; }
      }
      if (idx < 0) { found.length = 0; break; }
      found.push(idx);
    }
    if (found.length === 2) {
      used.add(start); used.add(found[0]); used.add(found[1]);
      if (solveSets(tiles, used, meldsFound + 1)) return true;
      used.delete(start); used.delete(found[0]); used.delete(found[1]);
    }
  }
  return false;
}

// Cek apakah menambah 1 tile membuat hand menang (untuk tsumo/ron).
// hand = hand 13 tile (sebelum tile tambahan); tile = tileId yang ditambah.
function canWinWith(hand, tile) {
  return isWinningHandString([...hand, tile]).win;
}

// Cek apakah hand 14 tile (sudah ada draw) menang → tsumo.
function isWinningHand(hand14) {
  return isWinningHandString(hand14).win;
}

// Cek apakah hand 13 tile valid untuk mulai menang disusun jadi 4 set+pair
// (pakai untuk AI: hand 13 yang "sudah tenpai/siap menang" bila 1 tile muat).
function isTenpai(hand13) {
  // Semua tile yang mungkin bisa melengkapi -> periksa tiap kandidat.
  const candidates = new Set();
  for (const suit of SUITS) {
    for (let r = 1; r <= 9; r++) {
      const t = tileId(suit, r);
      if (canWinWith(hand13, t)) return true;
    }
  }
  return false;
}

// ─── DRAW / DISCARD ──────────────────────────────────────
// Ambil 1 tile dari wall. Return { tile, hand } bila pop.
function draw(wall) {
  if (!wall.length) return { tile: null, empty: true };
  return { tile: wall.pop(), empty: false };
}

// Buang 1 tile dari hand. Return hand baru (tanpa tile tsb).
function discard(hand, tile) {
  const idx = hand.findIndex(t => t === tile);
  if (idx < 0) return { ok: false, hand };
  const nh = [...hand];
  nh.splice(idx, 1);
  return { ok: true, hand: sortHand(nh) };
}

// ─── AI BOT ──────────────────────────────────────────────
// Pilih tile untuk dibuang: prioritaskan tile yang paling tidak berguna
// (tile tunggal / tile yang tidak membentuk sequence/pair potensial).
// Return tileId yang dibuang + hand setelah buang.
function bestDiscard(hand14) {
  // Hitung frekuensi per tile.
  const freq = {};
  for (const t of hand14) freq[t] = (freq[t] || 0) + 1;

  // Skor tiap tile: tile berpasangan (freq 2+) bagus, tile yang jadi
  // bagian sequence potensial bagus. Buang yang skor paling rendah.
  // Skor = jumlah kemunculan + 1 (pair) + dukungan seq (rank-1/rank+1 ada).
  let worst = null;
  let worstTiles = [];
  for (const t of hand14) {
    const p = parseTile(t);
    let score = freq[t]; // lebih banyak = lebih baik (pair/triplet)
    const support = (rank) =>
      hand14.includes(tileId(p.suit, rank)) ? 1 : 0;
    // sequence neighbors
    score += support(p.rank - 1) ? 1 : 0;
    score += support(p.rank + 1) ? 1 : 0;
    score += support(p.rank - 2) ? 0.5 : 0;
    score += support(p.rank + 2) ? 0.5 : 0;
    if (worst === null || score < worst) {
      worst = score;
      worstTiles = [t];
    } else if (score === worst) {
      worstTiles.push(t);
    }
  }
  // Pilih acak dari yang skor sama (biar bot sedikit variasi).
  const tile = worstTiles[Math.floor(Math.random() * worstTiles.length)];
  return { ...discard(hand14, tile), tile };
}

// Bot decide setelah draw: kalau hand menang (14) → declare win; kalau tenpai
// tapi belum menang → discard. API utk handler.
// Return { type:'win' } atau { type:'discard', tile, hand }.
function botTurn(hand14) {
  if (isWinningHand(hand14)) return { type: 'win' };
  return { type: 'discard', ...bestDiscard(hand14) };
}

// ─── UTIL ────────────────────────────────────────────────
function isWallEmpty(wall) {
  return wall.length === 0;
}

// Format hand jadi string label (utk tampilan).
function formatHand(hand) {
  return hand.map(tileLabel).join(' ');
}

module.exports = {
  SUITS, tileId, parseTile, tileLabel,
  createWall, dealHand, sortHand,
  isWinningHand, canWinWith, isTenpai,
  draw, discard, bestDiscard, botTurn,
  isWallEmpty, formatHand,
};

// ─── SELF-CHECK ──────────────────────────────────────────
if (require.main === module) {
  const assert = require('assert');

  // 1. Wall 108 tile.
  const wall = createWall();
  assert.strictEqual(wall.length, 108, 'wall harus 108 tile');

  // 2. Sorting + format.
  assert.deepStrictEqual(sortHand(['m9', 'm1', 'm5']), ['m1', 'm5', 'm9']);
  assert.strictEqual(tileLabel('p3'), 'P3');
  assert.deepStrictEqual(parseTile('s8'), { suit: 's', rank: 8 });
  assert.strictEqual(parseTile('x1'), null);
  assert.strictEqual(parseTile('m0'), null);

  // 3. Hand menang valid: [m1m2m3, p1p2p3, s1s1s1, pair s5].
  const winHand = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's1', 's1', 's5', 's5', 's7', 's8', 's9'];
  assert.ok(isWinningHand(winHand), 'double sequence hand harus menang');

  // 4. Hand menang valid: 2 triplet + 1 sequence + pair.
  const winHand2 = ['m5', 'm5', 'm5', 'p7', 'p7', 'p7', 's2', 's3', 's4', 's9', 's9', 'm3', 'm4', 'm5'];
  assert.ok(isWinningHand(winHand2), 'triplet hand harus menang');

  // 5. Hand 2 set + 3 pair + 2 spare → invalid (butuh 4 set + 1 pair).
  const badHand = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's1', 's5', 's5', 's9', 'm4', 'm5', 's8'];
  assert.ok(!isWinningHand(badHand), 'hand 2set+3pair+2spare harus gagal');

  // 6. Hand 4 pasang + seq → tidak boleh menang (butuh 4 set + 1 pair).
  const pairHand = ['m1', 'm1', 'm2', 'm2', 'm3', 'm3', 'p4', 'p4', 's5', 's5', 's6', 's6', 'm7', 'm7'];
  assert.ok(!isWinningHand(pairHand), 'hand banyak pair tanpa proper 4 set harus gagal');

  // 7. canWinWith: hand 13 + 1 tile jadi menang.
  const thirteen = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's8', 's9', 's5', 's5', 's5', 's9'];
  assert.ok(canWinWith(thirteen, 's9'), 'tambah s9 harus bikin menang (triplet s5 + pair s9)');
  assert.ok(!canWinWith(thirteen, 'm9'), 'tambah m9 tak boleh menang');

  // 8. draw / discard (pakai hand panjang yang jelas tak menang).
  const w2 = createWall();
  const nonWin14 = ['m1', 'm1', 'm1', 'p5', 'p5', 's2', 's2', 's2', 's7', 's7', 's7', 'm4', 's6', 's8'];
  assert.ok(!isWinningHand(nonWin14), 'nonWin14 harus bukan hand menang');
  assert.strictEqual(w2.length, 108);
  const d = draw(w2);
  assert.strictEqual(d.tile.length, 2);
  assert.strictEqual(w2.length, 107);
  const disc = discard(nonWin14, nonWin14[0]);
  assert.ok(disc.ok);
  assert.strictEqual(disc.hand.length, 13);

  // 9. bestDiscard selalu valid (mengurangi hand 14 → 13).
  const bd = bestDiscard(nonWin14);
  assert.ok(bd.ok);
  assert.strictEqual(bd.hand.length, 13);
  assert.ok(nonWin14.includes(bd.tile), 'tile yang dibuang harus ada di hand');

  // 10. botTurn: hand menang → win; non-menang → discard.
  const btWin = botTurn(winHand);
  assert.strictEqual(btWin.type, 'win');
  const bt = botTurn(nonWin14);
  assert.strictEqual(bt.type, 'discard');
  assert.strictEqual(bt.hand.length, 13);

  // 11. isWallEmpty.
  assert.ok(!isWallEmpty(w2));
  assert.ok(isWallEmpty([]));

  console.log('✅ mahjongEngine.js OK — wall 108, win detection, AI discard, all checks pass');
}
