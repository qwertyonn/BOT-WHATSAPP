// utils/pmMode.js
// State toggle !mode: on = PM orang asing dibalas "hubungi owner",
// off = PM orang asing diabaikan total (hanya owner yang dilayani).
// Default on (perilaku lama). File JSON dibaca tiap cek — simpel dan aman.
const fs = require('fs');
const path = require('path');

const PM_MODE_FILE = process.env.BOT_PM_MODE_PATH
  ? path.resolve(process.env.BOT_PM_MODE_PATH)
  : path.join(__dirname, '..', 'state', 'pm_mode.json');

function getPmMode() {
  try {
    return JSON.parse(fs.readFileSync(PM_MODE_FILE, 'utf-8')).on !== false;
  } catch (err) {
    return true; // file belum ada / korup → default on
  }
}

function setPmMode(on) {
  fs.writeFileSync(PM_MODE_FILE, JSON.stringify({ on: !!on }));
  return !!on;
}

module.exports = { PM_MODE_FILE, getPmMode, setPmMode };