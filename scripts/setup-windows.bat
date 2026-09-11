@echo off
REM ============================================================
REM SETUP BOT UNTUK WINDOWS
REM Jalankan sekali:  setup-windows.bat
REM ============================================================
echo ============================================
echo  SETUP BOT - WINDOWS
echo ============================================
echo.

echo [1/3] Memeriksa Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js belum terinstal!
    echo  Unduh dan install dari https://nodejs.org (versi LTS 20 atau lebih baru)
    pause
    exit /b 1
)
echo  OK: Node.js versi: 
node --version

echo.
echo [2/3] Memeriksa FFmpeg (untuk fitur video/stiker)...
if exist "%~dp0..\ffmpeg\bin\ffmpeg.exe" (
    echo  OK: ffmpeg ditemukan di folder proyek (ffmpeg\bin\ffmpeg.exe)
) else (
    echo  INFO: ffmpeg belum ada di folder proyek.
    echo  Jalankan  scripts\install-ffmpeg.bat  untuk pasang otomatis, atau
    echo  download dari https://www.gyan.dev/ffmpeg/builds/ lalu letakkan
    echo  ffmpeg.exe  dan  ffprobe.exe  di  ffmpeg\bin\  (dalam folder proyek).
)

echo.
echo [3/3] Menginstal dependensi npm...
call npm install
if errorlevel 1 (
    echo  ERROR: npm install gagal.
    pause
    exit /b 1
)

echo.
if not exist .env (
    echo  WARNING: File .env belum ada!
    echo  Salin  .env.example  menjadi  .env  lalu isi OWNER_JID / BOT_JID.
)

echo.
echo ============================================
echo  SETUP SELESAI!  Jalankan bot:  start.bat (di folder scripts)
echo ============================================
pause
