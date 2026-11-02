import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'tw', to: 'cn' });
const acceptedGroups = ['你妳', '他她它牠', '的地得', '啊阿', '嗯恩', '喔哦噢'];
const equivalent = new Map(acceptedGroups.flatMap(group => {
  const chars = Array.from(convert(group));
  return chars.map(char => [char, chars[0]]);
}));
export function normalize(text) {
  return convert(String(text).normalize('NFKC')).replace(/[\p{P}\p{Z}\p{C}\s]/gu, '');
}

export function scoreAnswer(answer, expected, maxPoints) {
  const comparable = text => Array.from(normalize(text), char => equivalent.get(char) || char);
  const a = comparable(answer);
  const b = comparable(expected);
  const display = text => Array.from(String(text).normalize('NFKC').replace(/[\p{P}\p{Z}\p{C}\s]/gu, ''));
  const rawA = display(answer), rawB = display(expected);
  const shownA = rawA.length === a.length ? rawA : a;
  const shownB = rawB.length === b.length ? rawB : b;
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const differences = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      const type = a[i - 1] === b[j - 1] ? 'correct' : 'replace';
      --i; --j;
      differences.unshift({ type, actual: shownA[i], expected: shownB[j], actualIndex: i, expectedIndex: j });
    } else if (j && dp[i][j] === dp[i][j - 1] + 1) {
      --j;
      differences.unshift({ type: 'missing', actual: '', expected: shownB[j], expectedIndex: j });
    } else {
      --i;
      differences.unshift({ type: 'extra', actual: shownA[i], expected: '', actualIndex: i });
    }
  }
  const errors = dp[a.length][b.length];
  const points = b.length ? Math.round(maxPoints * Math.max(0, 1 - errors / b.length) * 10) / 10 : 0;
  const accuracy = b.length ? Math.round(Math.max(0, 1 - errors / b.length) * 1000) / 10 : 0;
  return { errors, points, maxPoints, accuracy, expectedLength: b.length, differences };
}
