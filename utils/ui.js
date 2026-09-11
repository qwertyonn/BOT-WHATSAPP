// ============================================================
// UI HELPER — Gaya tampilan seragam (Panel Rounded + Estetik)
// ============================================================

const W = 30; // Lebar panel minimum (karakter), aman untuk WhatsApp

// Estimasi lebar tampilan karakter (emoji/CJK = 2 kolom)
function dlen(str) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c >= 0xfe00 && c <= 0xfe0f) continue; // variation selector
    if (
      (c >= 0x1f000 && c <= 0x1ffff) ||
      (c >= 0x2600 && c <= 0x27ff) ||
      (c >= 0x2b00 && c <= 0x2bff) ||
      (c >= 0x3000 && c <= 0x303f) ||
      (c >= 0x20000 && c <= 0x2ffff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

// Rata tengah teks dalam lebar tertentu
function center(str, width = W - 2) {
  const len  = dlen(str);
  const left = Math.max(0, Math.floor((width - len) / 2));
  const right = Math.max(0, width - len - left);
  return ' '.repeat(left) + str + ' '.repeat(right);
}

// Baris judul: bingkai atas dengan judul menempel
function header(title) {
  return `╭━━━〔 ${title} 〕━━━╮`;
}

// Garis penutup panel bawah
function footerBorder() {
  return `╰━━━━━━━━━━━━━━━━╯`;
}

// Panel lengkap: bingkai atas berjudul + isi (prefix ┃) + bingkai bawah
// Baris yang dimulai '┣' otomatis jadi pemisah seksi selebar panel.
function box(title, body = [], footer = null) {
  if (typeof body === 'string') body = body.split('\n');
  const top = header(title);

  // Kumpulkan baris mentah (belum diprefix)
  const raw = [];
  for (const line of body) {
    const l = String(line);
    raw.push(...l.split('\n'));
  }

  const out = [top];
  for (const l of raw) {
    if (l.startsWith('┣')) {
      out.push(l);
    } else if (l.length === 0) {
      out.push('┃');
    } else {
      out.push('┃ ' + l);
    }
  }
  out.push(footerBorder());

  let text = out.join('\n');
  if (footer) text += `\n\n✦ _${footer}_`;
  return text;
}

// Pemisah seksi: ┣━━〔 Judul 〕
function section(...parts) {
  return `┣━━〔 ${parts.filter(p => p !== undefined && p !== null).join(' ')} 〕`;
}

// Baris perintah: ❯ `perintah` + baris deskripsi └ ...
function cmd(command, desc) {
  return desc ? `❯ \`${command}\`\n  └ _${desc}_` : `❯ \`${command}\``;
}

// Baris perintah ringkas satu baris: ❯ `perintah`   — deskripsi
// Deskripsi diratakan ke kolom yang sama (alignment best-effort).
function inlineCmd(command, desc, pad = 24) {
  const l = `❯ \`${command}\``;
  const d = pad - dlen(l);
  return desc ? (d > 0 ? l + ' '.repeat(d) + '— ' + desc : `${l} — ${desc}`) : l;
}

// Baris bullet (menerima beberapa bagian, digabung dengan spasi)
function bullet(...parts) {
  return `• ${parts.filter(p => p !== undefined && p !== null).join(' ')}`;
}

// Pasangan label : nilai, kolon dirata-kanan
function kv(label, value, pad = 13) {
  const l = `${label} :`;
  const diff = pad - dlen(l);
  const padded = diff > 0 ? l + ' '.repeat(diff) : l;
  return `${padded}${value}`;
}

// Progress bar
function bar(current, max, width = 10) {
  const pct = Math.max(0, Math.min(1, current / max));
  const f = Math.round(pct * width);
  return `[${'█'.repeat(f)}${'░'.repeat(width - f)}]`;
}

// Format angka uang id-ID (1.234)
function money(n) {
  return new Intl.NumberFormat('id-ID').format(n || 0);
}

// Garis pemisah
function divider(len = 21) {
  return '─'.repeat(len);
}

// Badge status / label kecil
function badge(text) {
  return `【 ${text} 】`;
}

module.exports = {
  W, dlen, center, header, box,
  section, cmd, inlineCmd, bullet, kv, bar, money, divider, badge,
};
