// utils/groupAccess.js
// Helper akses whitelist grup (allowed_groups.json) yang dipakai bersama
// oleh index.js (validasi) dan handlers/owner/ownerCommands.js (!allowgroup).
const fs = require('fs');
const path = require('path');

const ALLOWED_GROUPS_FILE = path.join(__dirname, '..', 'state', 'allowed_groups.json');

function getAllowedGroups() {
  if (!fs.existsSync(ALLOWED_GROUPS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ALLOWED_GROUPS_FILE, 'utf-8')); } catch (e) { return {}; }
}

function saveAllowedGroups(groups) {
  fs.writeFileSync(ALLOWED_GROUPS_FILE, JSON.stringify(groups, null, 2));
}

module.exports = { ALLOWED_GROUPS_FILE, getAllowedGroups, saveAllowedGroups };
