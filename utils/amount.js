function parsePositiveAmount(raw) {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().replace(/(?<=\d)[,.](?=\d{3}(?!\d))/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const amount = Number(clean);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function isAllAmount(raw) {
  return typeof raw === 'string' && /^(all|semua)$/i.test(raw.trim());
}

function resolveAmount(raw, maximum) {
  if (isAllAmount(raw)) return Number.isSafeInteger(maximum) && maximum > 0 ? maximum : null;
  return parsePositiveAmount(raw);
}

module.exports = { parsePositiveAmount, isAllAmount, resolveAmount };
