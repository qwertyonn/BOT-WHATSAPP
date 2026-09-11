# AGENTS.md — Bot WhatsApp 1.18

## Quick Start

```bash
npm install          # install deps (termux: npm run termux)
node test/smoke.js   # verify everything works (154 checks, sandboxed)
npm start            # run bot (scans QR or uses PAIRING_NUMBER)
```

**Warning:** `npm` may be blocked by PowerShell execution policy on Windows.
Use `cmd /c "npm ..."` or run scripts via `scripts/start.bat`.

## Stack

- **Runtime:** Node.js v26+ (CommonJS, `"type": "commonjs"`)
- **WhatsApp:** `@nexustechpro/baileys@^2.2.6` (fork of baileys with group status support; aliased as `@whiskeysockets/baileys` in `package.json`)
- **Media:** ffmpeg (required for video/sticker/download) — binary root-only, must live in **`ffmpeg/bin/`** inside the project (see Gotchas), sharp (image processing)
- **YouTube/TikTok:** bundled `yt-dlp.exe` in root
- **AI:** Assistant owner via local 9router proxy (OpenAI-compatible localhost; default model `oc/x-preview-f-free`), `!bot` or free-text.

## Environment

Copy/create `.env` with:
```
OWNER_JID=<number>@lid       # WhatsApp owner JID (LID format)
BOT_JID=<number>@lid         # WhatsApp bot JID (LID format)
PAIRING_NUMBER=628xxxx       # optional: login via phone number
BUTTON_MODE=on               # on=interactive buttons, off=text fallback
DEEPSEEK_API_KEY=...         # for AI assistant
DEEPSEEK_BASE_URL=...        # default http://localhost:20128/v1
DEEPSEEK_MODEL=...           # default oc/x-preview-f-free
```

**Never commit `.env` or `session/`.** Both are in `.gitignore`.

## Testing

```bash
node test/smoke.js          # main suite — 154 checks
node test/mahjong.test.js   # Mahjong engine + handler tests (excluded from npm test)
```

- `npm test` only runs `test/smoke.js`; `test/mahjong.test.js` is a separate suite you must run manually
- Runs in a temp sandbox (`BOT_DB_PATH`, `BOT_BACKUP_DIR`, `BOT_AFK_STATE_PATH`, `BOT_FAMILY_STATE_PATH`, `BOT_AI_MEMORY_PATH`, `BOT_PM_MODE_PATH` point to tmpdir)
- Tests do NOT require network or a running bot
- `sock.relayMessage` warnings in test output are expected (mock socket lacks interactive button methods)

## Architecture

```
index.js                  # Entry point: Baileys socket, message dispatch
handlers/router.js        # Central router: GLOBAL_HANDLERS, COMMAND_INDEX, HANDLERS fallback
handlers/                 # Feature handlers, organized by domain:
  game/fishit/            #   FishIt fishing game
  game/pokemon/           #   Pokemon game
  game/rpg/               #   RPG game (includes raid.js, classSkills.js)
  game/casino/            #   Casino (roll/dadu, blackjack, taruhan material & ikan)
  game/buckshot/          #   Buckshot Roulette (state.js, bot.js, render.js, router.js)
  game/togel/             #   Togel lottery
  game/mahjong/           #   Mahjong (solo & multiplayer)
  game/minigame/          #   Family 100, TTT, Snakes, Suit, Tebak Boom
  gacha/                  #   Gacha system
  economy/                #   Claim, transfer, profile, bank (depo/bunga, begal, bobol, top begal/bobol)
  media/                  #   Download (yt-dlp), sticker, media conversion
  ai/                     #   AI assistant (DeepSeek), memory
  owner/                  #   Owner+/admin commands (ban, allowgroup, sw, hidetag, del, mode)
  pet/                    #   Pet system
  utility/                #   Menu, AFK, utility commands
  nexa/                   #   Fun/tools (jokes, quote, dare, truth, 8ball, dice, base64, calc, jadian, tebak)
game/                     # Pure engines (no handler logic): fishingEngine, rpgEngine, gachaEngine, petEngine, mahjongEngine, togelEngine, battle (pokemon stat/logic stays in handlers/game/pokemon/)
data/                     # DB layer (db.js) + static data (rpgData, gameData, fishitAchievements, etc.)
state/                    # Runtime JSON state (database.json, afk_state, allowed_groups, ai_memory, family100, pm_mode)
utils/                    # Helpers: jid.js, ui.js, buttons.js, amount.js, duration.js, sharp.js, pmMode.js, downloadQueue.js, groupAccess.js, ffmpeg.js
test/smoke.js             # Main test suite (154 checks, sandboxed)
test/mahjong.test.js      # Standalone Mahjong tests — NOT run by `npm test`
scripts/                  # Setup & launcher scripts (setup-termux.sh, setup-windows.bat, install-ffmpeg.bat, start.bat)
assets/                   # Static images (banner casino, etc.)
```

## CodeGraph

Repo has a `.codegraph/` index. Before grep/find when locating or understanding code, prefer:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call.
- **Shell:** `cmd /c "codegraph explore \"<symbol names or question>\""` or `cmd /c "codegraph sync"`.

## Key Conventions

- **Prefix:** `!` for commands (`!fishit`, `!p`, `!rpg`, `!casino`, `!play`, `!br`, etc.)
- **Handler pattern:** Each handler is `async function handleX(ctx)` returning `true` if consumed, `false` otherwise. `ctx` contains `{ sock, msg, chatId, isGroup, groupId, senderJid, senderName, body, OWNER_JID, BOT_JID }`
- **Router registration:** Add handler to `HANDLERS` array and token to `COMMAND_INDEX` in `handlers/router.js`
- **Owner detection:** `sameUser(senderJid, OWNER_JID)` — JIDs use LID format
- **Owner vs admin:** group admin via `isGroupAdmin(sock, chatId, jid)` in `utils/jid.js`. Group-admin-only: `!ban` (lokal grup), `!hidetag`, `!del`, `!sw`. Owner-only: `!allowgroup`, `!mode`, `!acc`/`!unacc`, `!reset`, `!bansos`, `!bot`
- **Amount parsing:** use `parsePositiveAmount` / `resolveAmount` from `utils/amount.js` (accepts thousand separators `.`/`,`, rejects negative/fraction/hex). Don't hand-roll `parseInt`/regex
- **Duration parsing:** single parser `parseDuration` in `utils/duration.js` — scheme `s`/`m`/`h`/`d`/`w`/`mo` (`m`=minute, month=`mo`, alias `j` unsupported). Don't write your own duration parser
- **Interactive buttons:** `sendMenu()`, `quickReply()`, `listButton()` live in **`utils/buttons.js`** (NOT `utils/ui.js` — that one has text-rendering helpers `box`/`section`/`inlineCmd`/`divider`). `BUTTON_MODE=off` falls back to plain text
- **DB:** JSON file (`data/db.js`), collections accessed via getter functions (e.g. `getFishingPlayer`, `getRpgPlayer`, `getUserMoney`, `addMoney`, `deductMoney`)
- **Sandboxes:** State paths overridable via env: `BOT_DB_PATH`, `BOT_BACKUP_DIR`, `BOT_AFK_STATE_PATH`, `BOT_FAMILY_STATE_PATH`, `BOT_AI_MEMORY_PATH`, `BOT_PM_MODE_PATH`
- **Anti-exploit:** Auto-cleanup of tmp files, cooldowns on economy actions, ban checks per-message
- **Changelog:** Every change/feature addition MUST be logged in `CHANGELOG.md`. "Riwayat Perubahan" is ordered OLDEST→NEWEST (top→bottom): append new entries near the bottom. Also update "Daftar Fitur" (each feature annotated with `(ditambahkan pada: DD-MM-YYYY)`) and the "Versi saat ini" header at the top

## Gotchas

- Duration units in `!ban`/`!allowgroup`: `1h` = 1 HOUR (not a day — use `1d`); `2j` is REJECTED (use `2h`); month = `mo` (not `m`, which is minutes)
- Version labels drift between files: CHANGELOG says 1.18, `package.json` is still `1.12.0` — don't "fix" version numbers unless asked
- `OWNER_JID` / `BOT_JID` must be in LID format (`@lid` suffix), not phone number format
- AI trigger: in PM owner = any free-text; in group = text ending with `.`
- `yt-dlp.exe` is Windows-only; on Termux, yt-dlp is installed via pkg/pip
- **ffmpeg/ffprobe are root-only** — must be inside the project at **`ffmpeg/bin/`** (level with `index.js`), resolved by `utils/ffmpeg.js`. No fallback to `C:/ffmpeg` or PATH (Windows AND Termux). Windows: run `scripts/install-ffmpeg.bat`. Termux: copy ELF binaries `ffmpeg`/`ffprobe` into `ffmpeg/bin/` + `chmod +x` (do NOT rely on `pkg install ffmpeg`). `getFfmpegParam()` always sends `--ffmpeg-location`
- `sharp` di Termux/Android tak punya prebuilt native → dipasok via `@img/sharp-wasm32` (sudah di `dependencies`). Jangan build-from-source lagi.
- `session/` contains auth credentials — deleting it forces re-login
- `package-lock.json` is gitignored but required for `npm install` — keep locally
- Media files (`.png`, `.jpg`, `.mp4`, `.webp`) are gitignored — assets in `assets/` are exceptions that need `git add -f`. Same for `*.exe` (incl. `ffmpeg/bin/ffmpeg.exe`, `yt-dlp.exe`) — use `git add -f` if they must be committed
- On Windows PowerShell, npm scripts may need execution via `cmd /c "npm ..."` or `node ...`.
