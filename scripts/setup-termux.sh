#!/bin/bash
# ============================================================
# SETUP BOT UNTUK TERMUX (ANDROID)
# Jalankan sekali:  bash setup-termux.sh
#   atau via npm:   npm run termux
# ============================================================
set -e

echo "🔧 Memperbarui paket Termux..."
pkg update -y && pkg upgrade -y

echo "📦 Menginstal Node.js + Git + fontconfig..."
pkg install -y nodejs git fontconfig

# Masuk ke folder proyek dengan benar (parent dari folder scripts/),
# apapun cara script ini dijalankan.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
echo "📂 Folder proyek: $(pwd)"

echo "🧪 Memeriksa versi Node..."
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')"
if [ -z "$NODE_MAJOR" ]; then
  echo "❌ Node.js tidak terpasang!"
  echo "   Jalankan:  pkg install -y nodejs"
  exit 1
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ Node.js v${NODE_MAJOR} terlalu lama — fork Baileys butuh v20+."
  echo "   Upgrade:  pkg install -y nodejs-lts  (pilih LTS/latest)"
  exit 1
fi
echo "✅ Node.js v${NODE_MAJOR} (v20+ OK)"

echo "🔍 Memeriksa ffmpeg di folder proyek (ffmpeg/bin)..."
NEED_FFMPEG=1
if [ -f ffmpeg/bin/ffmpeg ]; then
  SIG="$(head -c 4 ffmpeg/bin/ffmpeg 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  case "$SIG" in
    7f454c46) # ELF (Linux/Android — valid untuk Termux)
      echo "✅ ffmpeg/bin/ffmpeg sudah ELF Termux — tidak perlu instalasi/copy."
      NEED_FFMPEG=0
      ;;
    4d5a*) # MZ = PE Windows (.exe bundel) — tidak bisa jalan di Termux
      echo "⚠️  ffmpeg/bin/ffmpeg adalah binari WINDOWS (.exe) — butuh ffmpeg Termux."
      ;;
    *)
      echo "⚠️  ffmpeg/bin/ffmpeg format tak dikenal — pasang ulang."
      ;;
  esac
fi

if [ "$NEED_FFMPEG" = "1" ]; then
  echo "📥 Menginstal ffmpeg Termux..."
  pkg install -y ffmpeg
  echo "📁 Menyalin ffmpeg & ffprobe ke ffmpeg/bin (lokasi root-only)..."
  mkdir -p ffmpeg/bin
  cp "${PREFIX}/bin/ffmpeg" "${PREFIX}/bin/ffprobe" ffmpeg/bin/
  chmod +x ffmpeg/bin/ffmpeg ffmpeg/bin/ffprobe
  echo "✅ ffmpeg + ffprobe disalin ke ffmpeg/bin"
else
  # Pastikan ffprobe ikut tersedia (dipakai resolveFfmpeg saat scan video).
  if [ ! -f ffmpeg/bin/ffprobe ]; then
    pkg install -y ffmpeg
    cp "${PREFIX}/bin/ffprobe" ffmpeg/bin/ && chmod +x ffmpeg/bin/ffprobe
    echo "✅ ffprobe disalin ke ffmpeg/bin"
  fi
fi

echo "🎬 Menginstal yt-dlp (untuk !play / !tt)..."
if ! pkg install -y yt-dlp; then
  echo "⚠️ Paket yt-dlp tidak tersedia, coba via pip..."
  pkg install -y python python-pip
  pip install -U yt-dlp
fi

echo "📦 Menginstal dependensi npm (tanpa unduh Chromium ~170 MB)..."
PUPPETEER_SKIP_DOWNLOAD=1 npm install
echo "   (Skor !playlirik tetap jalan via mode teks + lirik tanpa kartu gambar)"

echo "🧪 Memverifikasi sharp (wasm32 untuk Android/Termux)..."
if node -e "require('sharp'); console.log('sharp OK')" 2>/dev/null; then
  echo "✅ sharp berjalan (wasm32)"
else
  echo ""
  echo "⚠️  sharp masih gagal! Coba manual:"
  echo "     npm install @img/sharp-wasm32"
  echo "     node -e \"require('sharp'); console.log('ok')\""
fi

if [ ! -f .env ]; then
  echo ""
  echo "⚠️  File .env belum ada — membuat template .env..."
  cat > .env <<'EOF'
OWNER_JID=<owner>@lid
BOT_JID=<bot>@lid
PAIRING_NUMBER=
BUTTON_MODE=on
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=http://localhost:20128/v1
DEEPSEEK_MODEL=oc/x-preview-f-free
EOF
  echo "    ✅ .env dibuat. Isi OWNER_JID & BOT_JID (format JID: <nomor>@lid)."
fi

echo ""
echo "🔍 Verifikasi ffmpeg/ffprobe dari perspektif kode..."
node -e "const fs=require('fs'); const {resolveFfmpeg}=require('./utils/ffmpeg'); const r=resolveFfmpeg(); for (const k of ['ffmpeg','ffprobe']) { if (!fs.existsSync(r[k])) { console.error('❌ '+k+' hilang: '+r[k]); process.exit(1); } } console.log('✅ resolveFfmpeg OK:'); console.log('   ffmpeg :', r.ffmpeg); console.log('   ffprobe:', r.ffprobe);"

echo ""
echo "============================================="
echo " ✅ SETUP SELESAI!"
echo "    Ramp-check cepat (tanpa WhatsApp):  node test/smoke.js"
echo "    Jalankan bot:  npm start"
echo "    Scan QR Code WhatsApp saat muncul di layar"
echo ""
echo " 📲 Login via nomor (opsional):"
echo "    Isi PAIRING_NUMBER di file .env, lalu npm start"
echo "    Kode 8 karakter muncul → WhatsApp > Perangkat Tertaut"
echo "    > Tautkan Perangkat Dengan Nomor Telepon"
echo ""
echo " ⌨️  Saat menunggu login, tombol di konsol:"
echo "    R = buat kode pairing baru (kode lama kadaluarsa ±2 menit)"
echo "    Q = paksa beralih ke QR code"
echo "============================================="