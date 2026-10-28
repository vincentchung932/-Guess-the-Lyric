export function songPosition(bank, index, { enabledOnly = false } = {}) {
  const included = q => !enabledOnly || q.enabled;
  const formal = q => included(q) && !q.practice;
  const current = bank[index];
  return {
    songNumber: current && formal(current) ? bank.slice(0, index + 1).filter(formal).length : null,
    totalSongs: bank.filter(formal).length
  };
}
