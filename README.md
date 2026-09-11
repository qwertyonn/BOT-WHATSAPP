# Bot WhatsApp 1.18

Bot WhatsApp multipemain berbasis Node.js + Baileys. Menggabungkan game, ekonomi, media downloader, dan AI asisten dalam satu bot.

**Versi saat ini:** 1.18 | **Runtime:** Node.js v20+ | **Prefix:** `!`

---

## Persyaratan

| Kebutuhan | Keterangan |
|-----------|------------|
| **Node.js v20+** | Wajib v20 atau lebih baru (syarat fork Baileys) |
| **ffmpeg** | Untuk fitur video, stiker, download — binary harus di `ffmpeg/bin/` |
| **yt-dlp** | Untuk download YouTube/TikTok — Windows: `yt-dlp.exe` di root; Termux: `pkg install yt-dlp` |
| **Akun WhatsApp** | Satu nomor khusus bot (scan QR atau login via nomor) |

---

## Instalasi

### Windows

```bash
# 1. Clone / buka folder project

# 2. Jalankan setup (cek Node.js + install npm deps)
scripts\setup-windows.bat

# 3. Install ffmpeg ke folder project
scripts\install-ffmpeg.bat

# 4. Buat file .env (lihat bagian Konfigurasi)
copy NUL .env
```

### Termux / Android

```bash
# Jalankan satu command — otomatis install semua dependensi
npm run termux
# atau
bash scripts/setup-termux.sh
```

Script akan menginstal: Node.js, Git, ffmpeg, yt-dlp, dependensi npm, dan membuat template `.env` jika belum ada.

---

## Konfigurasi `.env`

Buat file `.env` di root project:

```env
# ─── WhatsApp ──────────────────────────────────
OWNER_JID=628xxxxxxxxxx@lid       # JID owner (format @lid)
BOT_JID=628xxxxxxxxxx@lid         # JID bot (format @lid)
PAIRING_NUMBER=628xxxxxxxxxx      # (opsional) Login via nomor tanpa QR
BUTTON_MODE=on                    # on = tombol interaktif, off = teks biasa

# ─── AI Asisten ────────────────────────────────
DEEPSEEK_API_KEY=                 # API key untuk AI (kosong jika pakai proxy lokal)
DEEPSEEK_BASE_URL=http://localhost:20128/v1   # Endpoint AI
DEEPSEEK_MODEL=oc/x-preview-f-free            # Model AI
```

**Penting:**
- `OWNER_JID` dan `BOT_JID` harus format **LID** (`@lid`), bukan nomor telepon
- Untuk mendapatkan JID: jalankan bot, kirim pesan ke bot, cek log konsol
- `PAIRING_NUMBER` diisi jika ingin login via nomor (muncul kode 8 karakter → WhatsApp > Perangkat Tertaut > Tautkan Dengan Nomor Telepon)
- `BUTTON_MODE=off` membuat bot pakai teks biasa (lebih kompatibel)

---

## Menjalankan Bot

```bash
npm start
```

### Login QR Code
1. Jalankan `npm start`
2. Scan QR Code yang muncul di konsol dengan WhatsApp di HP
3. Bot langsung aktif setelah scan berhasil

### Login via Nomor
1. Isi `PAIRING_NUMBER` di `.env`
2. Jalankan `npm start`
3. Kode 8 karakter muncul di konsol
4. Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat Dengan Nomor Telepon > Masukkan kode

### Tombol Konsol
Saat menunggu login:
- **R** = Buat kode pairing baru (kode lama kadaluarsa ~2 menit)
- **Q** = Paksa beralih ke QR code

### Reconnect Otomatis
Jika koneksi terputus, bot otomatis menyambung ulang dengan backoff eksponensial (3 detik → maks 5 menit). Proses tidak mati saat internet padam.

---

## Daftar Fitur & Command

### 💰 Money & Ekonomi

| Command | Fungsi |
|---------|--------|
| `!me` | Profil, saldo, foto profil, nomor WA |
| `!claim` | Klaim reward harian gratis |
| `!transfer @user [jumlah\|all]` / `!tf` | Kirim Money ke pemain lain |
| `!gantinama [nama]` / `!rename` | Ganti nama di semua game (100k) |
| `!bank` | Lihat saldo tabungan & bunga |
| `!depo [jumlah\|all]` | Setor uang ke bank |
| `!tarik [jumlah\|all]` | Tarik uang dari bank |
| `!klaimbunga` | Klaim bunga bank (1%/24 jam) |
| `!begal @user` / `!rob` | Rampok cash lawan (50% sukses) |
| `!bobol @user` | Bobol tabungan bank lawan (25% sukses) |
| `!gacha [1\|10]` | Gacha hadiah uang & item langka |
| `!top money` | Peringkat pemain terkaya |
| `!top bust` | Top 5 kerugian Blackjack per grup |
| `!top begal` | Leaderboard pembegal |
| `!top bobol` | Leaderboard pembobol bank |

### 🎣 FishIt (Mancing)

| Command | Fungsi |
|---------|--------|
| `!fishit` | Menu utama FishIt |
| `!fishit daftar` | Daftar jadi pemancing |
| `!fishit mancing` | Mulai memancing (pilih lokasi) |
| `!fishit lokasi` | Lihat daftar lokasi mancing |
| `!fishit inv` | Lihat inventori ikan & umpan |
| `!fishit jual [ikan] [jumlah\|all]` | Jual ikan |
| `!fishit fishdex` | Koleksi ikan yang sudah ditangkap |
| `!fishit profil` | Profil mancing |
| `!fishit top` | Peringkat pemancing |
| `!fishit achievement` / `!fishit misi` | Lihat achievement |
| `!fishit shop` | Toko joran & umpan |
| `!fishit claim` | Klaim reward harian mancing |

### 🎮 Pokemon

| Command | Fungsi |
|---------|--------|
| `!p` | Menu utama Pokemon |
| `!p spawn` | Cari Pokemon liar |
| `!p serang` | Serang Pokemon liar |
| `!p tangkap` | Tangkap Pokemon |
| `!p kabur` | Kabur dari battle |
| `!p koleksi` | Lihat koleksi Pokemon |
| `!p tim` | Susun tim battle |
| `!p profil` | Profil Pokemon |
| `!p toko` | Beli item Pokemon |
| `!p rank` | Peringkat Pokemon |
| `!p battle @user` | Battle PvP |
| `!p claim` | Klaim reward harian |

### ⚔️ RPG Petualang

| Command | Fungsi |
|---------|--------|
| `!rpg` | Menu utama RPG |
| `!rpg daftar` | Daftar jadi petualang |
| `!rpg profil` | Profil petualang |
| `!rpg kelas` | Pilih/ganti kelas (6 kelas) |
| `!rpg skill` | Pilih skill aktif |
| `!rpg tebang` | Tebang kayu (butuh stamina) |
| `!rpg tambang` | Tambang material (butuh stamina) |
| `!rpg lawan` | Lawan monster PvE |
| `!rpg fight @user` | Duel PvP |
| `!rpg serang skill [nama]` | Serang pakai skill aktif |
| `!rpg shop` | Toko material & item |
| `!rpg beli [item] [jumlah]` | Beli item |
| `!rpg jual [material] [jumlah\|all]` | Jual material |
| `!rpg pakai [item] [jumlah]` | Pakai item (ramuan, apel, roti) |
| `!rpg inv` | Lihat inventori |
| `!rpg equip` | Lihat/pasang equipment |
| `!rpg tempa` | Craft senjata/zirah/alat |
| `!rpg raid mulai [boss]` | Mulai raid boss (2-6 pemain) |
| `!rpg raid join` | Gabung raid |
| `!rpg raid serang` | Serang boss di raid |
| `!rpg claim` | Klaim reward harian |
| `!rpg top` | Peringkat petualang |

### 🎰 Casino & Judi

| Command | Fungsi |
|---------|--------|
| `!casino` | Menu casino (banner + panduan) |
| `!casino money [jumlah\|all]` | Roll slot money |
| `!casino material [id] [jumlah\|all]` | Judi material RPG |
| `!casino fish [nama] [jumlah\|all]` | Judi ikan FishIt |
| `!casino help` | Panduan lengkap casino |
| `!bj @user` / `!blackjack @user` | Tantang pemain Blackjack |
| `!togel [angka] [bet]` | Pasang nomor Togel 2D/3D/4D |
| `!mahjong` | Main Mahjong (solo & multiplayer) |

### 🕹️ Mini Game

| Command | Fungsi |
|---------|--------|
| `!br [taruhan]` / `!buckshot [taruhan]` | Buckshot Roulette solo vs bot |
| `!br @user1 [@user2] [@user3] [taruhan]` | Buckshot Roulette PvP (2-4 pemain) |
| `!tebakboom [bet]` | Tebak Boom — tebak angka beracun |
| `!tebakboom join` | Gabung game Tebak Boom |
| `!tebakboom start` | Mulai Tebak Boom |
| `!buka [n]` / `!boom [n]` | Buka kotak Tebak Boom |
| `!tebak` | Tebak angka 1-100, hadiah 1000 Money |
| `!tebak stop` | Hentikan sesi tebak angka |
| `!family100` | Family 100 — kuis asah otak |
| `!ttt @user` | Tic Tac Toe |
| `!suit @user` | Batu-Gunting-Kertas |
| `!snakes` | Ular Tangga 2D |
| `!pet` | Menu Pet |
| `!pet adopt` | Adopsi pet acak |
| `!pet profil` | Profil pet |
| `!pet makan [ikan] [jumlah]` | Makani pet (ikan dari FishIt) |
| `!pet lawan @user` | Battle pet PvP |

### 🎉 Fun & Sosial

| Command | Fungsi |
|---------|--------|
| `!jadian` / `!jodoh` | Cari jodoh random di grup |
| `!jokes` / `!lucu` | Jokes acak |
| `!quote` / `!kutipan` | Kutipan motivasi |
| `!truth` / `!jujur` | Truth or Dare (jujur) |
| `!dare` / `!tantangan` | Truth or Dare (tantangan) |
| `!8ball [pertanyaan]` / `!magic` | Bola Ramalan |
| `!dice [n]` / `!roll [n]` | Lempar dadu (1-6) |
| `!calc [rumus]` / `!kalkulator` | Kalkulator |
| `!base64 [enc/dec] [teks]` / `!b64` | Encode/Decode Base64 |

### 🎵 Media & Downloader

| Command | Fungsi |
|---------|--------|
| `!play [judul]` | Download audio/video YouTube |
| `!playlirik [judul]` | Lagu + lirik + card player |
| `!audio` / `!video` | Balas hasil play → pilih format |
| `!tt [link]` | Download video TikTok |
| `!ttaudio [link]` | Download audio TikTok |
| `!ttvideo [link]` | Download video TikTok |
| `!s` / `!sticker` | Ubah gambar/video jadi stiker |
| `!smeme [teks atas\|teks bawah]` | Stiker meme |
| `!toimg` | Stiker → gambar |
| `!tovid` | Stiker → video |
| `!toaudio` | Video → audio |
| `!change [rasio]` | Ubah rasio stiker (16:9, 9:16, 1:1) |
| `!send` | Kirim ulang media dari balasan |
| `!getpp` | Ambil foto profil WA |

### ⚙️ Admin Grup

| Command | Fungsi | Akses |
|---------|--------|-------|
| `!ban @user [durasi]` | Ban member di grup (lokal) | Admin grup |
| `!unban @user` / `!banlist` | Unban / lihat daftar banned | Admin grup |
| `!hidetag [teks]` | Tag semua member tanpa @ | Admin grup |
| `!del` / `!delete` | Hapus pesan bot/member (reply) | Admin grup |
| `!sw [teks]` | Pasang WhatsApp Status di grup | Admin grup |

**Durasi ban:** `10s` (detik), `5m` (menit), `2h` (jam), `1d` (hari), `1w` (minggu), `1mo` (bulan)

### 🔧 Owner Only

| Command | Fungsi |
|---------|--------|
| `!allowgroup [durasi]` | Batasi/pulihkan akses grup |
| `!allowgroup list` | Lihat grup yang diizinkan |
| `!allowgroup remove [grup]` | Cabut izin grup |
| `!mode on/off` | Toggle PM mode orang asing |
| `!acc @user` / `!unacc @user` | Beri/cabut izin `!getpp` |
| `!reset [rpg\|fishit\|pokemon\|money]` | Reset akun game |
| `!bansos @user [jumlah]` | Beri Money gratis |
| Free-text di PM | AI Asisten (tanpa prefix) |
| Free-text + `.` di grup | AI Asisten (diakhiri titik) |
| Reply pesan + `.` | AI menjawab isi pesan yang di-reply |

**Perintah natural language AI:**
- `ingat bahwa [fakta]` — simpan fakta ke ingatan AI
- `lupakan [kata]` — hapus fakta dari ingatan
- `daftar ingatan` — lihat semua fakta yang diingat
- `cari internet [query]` / `search [query]` — pencarian web

---

## Testing

```bash
npm test
```

Menjalankan **154 test** di sandbox (data asli tidak tersentuh):
- Database & ekonomi
- Bank, begal, bobol
- Battle Pokemon & RPG
- Fishing, casino, blackjack
- Mini game (buckshot, tebak boom, family 100)
- Router & handler

Test berjalan offline (tanpa koneksi WhatsApp).

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| **ffmpeg tidak ditemukan** | Pastikan `ffmpeg.exe` / `ffmpeg` ada di `ffmpeg/bin/`. Jalankan `scripts/install-ffmpeg.bat` (Windows) atau `bash scripts/setup-termux.sh` (Termux) |
| **npm diblokir PowerShell** | Pakai `cmd /c "npm install"` atau jalankan `scripts/setup-windows.bat` |
| **Session expired / bot diam** | Hapus folder `session/` lalu jalankan ulang bot untuk scan QR baru |
| **Sharp error di Termux** | Sharp pakai WASM (`@img/sharp-wasm32`). Jika gagal: `npm install @img/sharp-wasm32` |
| **Puppeteer gagal (Termux)** | Normal — `!playlirik` tetap jalan tanpa kartu gambar (mode teks + lirik). Untuk kartu: `pkg install chromium` + set `PUPPETEER_EXECUTABLE_PATH` di `.env` |
| **`!play` / `!tt` gagal download** | Pastikan `yt-dlp` terinstal. Windows: cek `yt-dlp.exe` di root. Termux: `pkg install yt-dlp` |
| **Bot reconnect terus** | Cek koneksi internet. Bot otomatis backoff dan reconnect |
| **Tag @nomor tidak highlight** | Pastikan `BUTTON_MODE=on` untuk tombol interaktif, atau kirim via reply |

---

## Catatan Penting

- **`.env` dan `session/` tidak di-commit ke Git** — keduanya ada di `.gitignore`
- **ffmpeg harus root-only** di `ffmpeg/bin/` — bot tidak mencari di PATH sistem
- **`OWNER_JID` dan `BOT_JID` format LID** (`@lid`), bukan nomor telepon
- **Durasi:** `m` = menit, `h` = jam, `d` = hari, `w` = minggu, `mo` = bulan. `j` (jam) sudah tidak didukung
- **AI Asisten** khusus owner — di PM cukup kirim pesan; di grup akhiri dengan titik `.`
- **Versi drift:** `CHANGELOG.md` = 1.18, `package.json` = 1.12.0 (jangan "fix" kecuali diminta)
- **Media files** (`.png`, `.jpg`, `.mp4`, `.webp`) di-ignoring oleh Git. File di `assets/` perlu `git add -f` jika ingin commit

---

## Lisensi

ISC
