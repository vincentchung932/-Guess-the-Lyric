export function rankedRoundResults(players) {
  return [...players].sort((a, b) => (b.result?.points || 0) - (a.result?.points || 0)).map((player, index, sorted) => ({
    ...player,
    rank: sorted.findIndex(item => (item.result?.points || 0) === (player.result?.points || 0)) + 1
  }));
}
