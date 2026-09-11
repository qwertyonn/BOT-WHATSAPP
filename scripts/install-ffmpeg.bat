@echo off
REM ============================================================
REM INSTALL FFMPEG (WINDOWS) — ke folder proyek (root-only)
REM Unduh & pasang FFmpeg ke <proyek>\ffmpeg\bin otomatis
REM Bot hanya mencar ffmpeg.exe di dalam folder proyek (tanpa C:\ffmpeg/PATH)
REM Jalankan sekali:  install-ffmpeg.bat
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."

echo ============================================
echo  INSTALL FFMPEG - WINDOWS (folder proyek)
echo ============================================
echo.

REM 1. Cek apakah sudah terpasang
if exist "%ROOT%\ffmpeg\bin\ffmpeg.exe" (
    echo [OK] FFmpeg sudah terpasang di %ROOT%\ffmpeg\bin\ffmpeg.exe
    "%ROOT%\ffmpeg\bin\ffmpeg.exe" -version | findstr /B "ffmpeg version"
    echo.
    echo Tidak perlu install ulang.
    pause
    exit /b 0
)

echo [1/4] Memeriksa koneksi internet...
where curl >nul 2>&1
if errorlevel 1 (
    echo  ERROR: curl tidak ditemukan. Jalankan ulang dari cmd bawaan Windows.
    pause
    exit /b 1
)

echo [2/4] Mengunduh FFmpeg (gyan.dev essentials build)...
set "ZIP=%TEMP%\ffmpeg-essentials.zip"
set "EXTRACT=%TEMP%\ffmpeg-extract"

curl -L -o "%ZIP%" "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
if errorlevel 1 (
    echo  ERROR: Gagal mengunduh. Periksa koneksi internet / URL.
    pause
    exit /b 1
)

echo [3/4] Mengekstrak...
if exist "%EXTRACT%" rmdir /s /q "%EXTRACT%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 (
    echo  ERROR: Gagal mengekstrak file zip.
    pause
    exit /b 1
)

echo [4/4] Memasang ke %ROOT%\ffmpeg\bin...
if not exist "%ROOT%\ffmpeg\bin" mkdir "%ROOT%\ffmpeg\bin"
powershell -NoProfile -Command "$root = Get-ChildItem -Path '%EXTRACT%' -Directory | Where-Object { $_.Name -like '*essentials_build*' } | Select-Object -First 1; if (-not $root) { Write-Error 'Folder ffmpeg build tidak ditemukan'; exit 1 }; Copy-Item -Path (Join-Path $root.FullName 'bin\*') -Destination '%ROOT%\ffmpeg\bin' -Recurse -Force"
if errorlevel 1 (
    echo  ERROR: Gagal menyalin file FFmpeg.
    pause
    exit /b 1
)

del /q "%ZIP%" 2>nul
rmdir /s /q "%EXTRACT%" 2>nul

echo.
echo ============================================
echo  FFMPEG BERHASIL DIPASANG!
echo ============================================
"%ROOT%\ffmpeg\bin\ffmpeg.exe" -version | findstr /B "ffmpeg version"
echo.
echo  Lokasi: %ROOT%\ffmpeg\bin\ffmpeg.exe
echo  Bot hanya mencar ffmpeg.exe di dalam folder proyek (sejajar index.js).
echo  Restart bot setelah ini untuk mengaktifkan fitur video.
echo ============================================
pause