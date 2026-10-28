import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { normalize, scoreAnswer } from '../server/scoring.js';
import { validateQuestionBank } from '../server/questions.js';
import { questions } from './fixtures.js';
import { rankedRoundResults } from '../shared/round-results.js';
import { songPosition } from '../shared/song-position.js';

const demoBank = [
  { id: 'demo1', points: 10, lines: ['滿天都是小星星'], videoId: '', cue: '一閃一閃亮晶晶' },
  { id: 'demo2', points: 10, lines: ['跑得快', '跑得快'], videoId: '', cue: '兩隻老虎' }
];

test('繁簡、標點與空白不影響計分；同音錯字仍扣分', () => {
  assert.equal(normalize('滿天，都是 小星星！'), '满天都是小星星');
  assert.equal(scoreAnswer('满天 都是小星星！', '滿天都是小星星', 10).points, 10);
  assert.equal(scoreAnswer('跑的快', '跑得快', 20).points, 13.3);
});
test('插入與漏字能對齊後面的字，得分四捨五入且最低零分', () => {
  const result = scoreAnswer('甲乙丁戊己庚辛壬癸', '甲乙丙丁戊己庚辛壬癸', 20);
  assert.equal(result.errors, 1); assert.equal(result.points, 18);
  assert.equal(result.differences.filter(x => x.type === 'correct').length, 9);
  assert.equal(scoreAnswer('甲乙丙丁戊己庚辛壬癸多', '甲乙丙丁戊己庚辛壬癸', 10).points, 9);
  assert.equal(scoreAnswer('完全不同而且超過長度', '甲', 10).points, 0);
  assert.equal(scoreAnswer('', '甲乙', 20).points, 0);
});
test('題目不洩漏答案，舊版本不能覆寫答案，重複揭曉不重複加分', () => {
  const game = new Game(demoBank); const room = game.create(); const player = game.join(room, '測試玩家');
  const actor = game.actor(room, player.token);
  assert.equal(game.snapshot(room, actor).question.lines, undefined);
  game.command(room, 'start'); game.command(room, 'answer');
  game.submit(room, player, '滿天都是小星星', 2, 0);
  game.submit(room, player, '錯的', 1, 0);
  assert.equal(room.answers[player.id].text, '滿天都是小星星');
  assert.throws(() => game.submit(room, player, '答案', 3, 1));
  assert.equal(game.snapshot(room, actor).players[0].result, undefined);
  game.command(room, 'lock'); assert.throws(() => game.submit(room, player, '更改', 3, 0));
  game.command(room, 'reveal'); assert.equal(player.total, 10);
  assert.equal(game.snapshot(room, actor).players[0].result, undefined);
  assert.equal(game.snapshot(room, actor).players[0].total, 0);
  assert.equal(game.snapshot(room, actor).question.lines[0], '滿天都是小星星');
  assert.throws(() => game.command(room, 'reveal')); assert.equal(player.total, 10);
  assert.throws(() => game.command(room, 'next'));
  game.command(room, 'results');
  assert.equal(game.snapshot(room, actor).players[0].result.points, 10);
  assert.throws(() => game.command(room, 'reveal')); assert.equal(player.total, 10);
  game.command(room, 'next'); assert.equal(room.round, 1); assert.deepEqual(room.answers, {});
});
test('倒數歸零仍可提交與修改，主持人截止揭曉後才拒收，並驗證身分', () => {
  const game = new Game(questions); const room = game.create(); const player = game.join(room, '玩家');
  assert.throws(() => game.actor(room, '假的權杖'));
  assert.throws(() => game.join(room, '玩家'));
  game.command(room, 'start'); assert.throws(() => game.join(room, '太晚加入'));
  game.command(room, 'answer'); room.deadline = Date.now() - 1;
  game.expire(room); assert.equal(room.phase, 'answering'); assert.equal(room.timeUp, true);
  const version = room.version; game.expire(room); assert.equal(room.version, version);
  game.submit(room, player, '先提交', 1, 0);
  game.submit(room, player, '問天涯望斷了天涯贏得了天下輸了她', 2, 0);
  assert.equal(game.snapshot(room, game.actor(room, player.token)).me.answer.revision, 2);
  game.command(room, 'reveal'); assert.equal(room.phase, 'revealed'); assert.equal(player.total, 10);
  assert.throws(() => game.submit(room, player, '太晚了', 3, 0));
  assert.throws(() => game.command(room, 'reveal')); assert.equal(player.total, 10);
});

test('自訂題庫：兩排八格、十分快題，以及揭曉前不洩漏影片答案片段', () => {
  const game = new Game(questions); const room = game.create(); const player = game.join(room, '玩家');
  const host = game.actor(room, room.hostToken), actor = game.actor(room, player.token);
  assert.equal(game.snapshot(room, host).question.playback, undefined);
  game.command(room, 'start');
  let snapshot = game.snapshot(room, host);
  assert.deepEqual(snapshot.question.lengths, [8, 8]);
  assert.equal(snapshot.question.points, 10);
  assert.equal(snapshot.totalRounds, 1);
  assert.deepEqual(snapshot.question.playback, { videoId: 'FDeRzYjRGvY', startSeconds: 45, endSeconds: 79, kind: 'question' });
  assert.equal(snapshot.question.lines, undefined);
  assert.equal(game.snapshot(room, actor).question.playback, undefined);
  game.command(room, 'answer');
  assert.equal(game.snapshot(room, host).question.playback, undefined);
  game.submit(room, player, '问天涯 望断了天涯 赢得了天下 输了她', 1, 0);
  game.command(room, 'lock'); game.command(room, 'reveal');
  snapshot = game.snapshot(room, host);
  assert.deepEqual(snapshot.question.playback, { videoId: 'FDeRzYjRGvY', startSeconds: 79, endSeconds: 86, kind: 'answer' });
  assert.equal(player.total, 10);
  assert.equal(game.snapshot(room, actor).question.playback, undefined);
  game.command(room, 'results'); game.command(room, 'next'); assert.equal(room.phase, 'finished');
});

test('題庫驗證拒絕錯字數、無效時間、重複 id，並跳過停用草稿', () => {
  const valid = structuredClone(questions[0]);
  assert.throws(() => validateQuestionBank([{ ...valid, lineLengths: [7, 8] }]), /格數/);
  assert.throws(() => validateQuestionBank([{ ...valid, answerClip: { startSeconds: 86, endSeconds: 79 } }]), /播放時間/);
  assert.throws(() => validateQuestionBank([valid, valid]), /不可重複/);
  assert.equal(validateQuestionBank([{ ...valid, points: 30 }])[0].points, 30);
  assert.equal(validateQuestionBank([{ ...valid, points: 17.5, practice: true }])[0].practice, true);
  for (const points of [-1, 0, 1.23, Infinity, NaN, 1000001]) assert.throws(() => validateQuestionBank([{ ...valid, points }]), /配分/);
  assert.throws(() => validateQuestionBank([{ ...valid, practice: 'true' }]), /試玩設定/);
  assert.equal(validateQuestionBank([valid, { id: 'draft', enabled: false }]).length, 1);
});

test('玩家格子保留標點與空格提示，不洩漏歌詞，也不影響字數與計分', () => {
  const game = new Game([{ id: 'format', points: 10, lines: ['甲， 乙！', '丙　丁？'], videoId: '' }]);
  const room = game.create(), player = game.join(room, '玩家');
  game.command(room, 'start'); game.command(room, 'answer');
  const snapshot = game.snapshot(room, game.actor(room, player.token));
  assert.deepEqual(snapshot.question.lengths, [2, 2]);
  assert.deepEqual(snapshot.question.layout[0], [{ type: 'slot' }, { type: 'punctuation', text: '，' }, { type: 'space', text: ' ' }, { type: 'slot' }, { type: 'punctuation', text: '！' }]);
  assert.deepEqual(snapshot.question.layout[1], [{ type: 'slot' }, { type: 'space', text: '　' }, { type: 'slot' }, { type: 'punctuation', text: '？' }]);
  assert.doesNotMatch(JSON.stringify(snapshot.question.layout), /[甲乙丙丁]/);
  assert.equal(snapshot.question.lines, undefined);
  game.submit(room, player, '甲乙丙丁', 1, 0);
  game.command(room, 'lock'); game.command(room, 'reveal');
  assert.equal(player.total, 10);
});

test('批改保留原字形、正確標記替換與增漏字，分數按錯誤比例取一位小數', () => {
  const equivalent = scoreAnswer('满天都是小星星', '滿天都是小星星', 10);
  assert.equal(equivalent.points, 10); assert.equal(equivalent.differences[0].actual, '满');
  assert.equal(equivalent.differences[0].expected, '滿'); assert.equal(equivalent.differences[0].type, 'correct');
  const replace = scoreAnswer('甲乙錯丁戊己', '甲乙丙丁戊己', 10);
  assert.equal(replace.points, 8.3); assert.equal(replace.accuracy, 83.3);
  assert.deepEqual(replace.differences.find(d => d.type === 'replace'), { type: 'replace', actual: '錯', expected: '丙', actualIndex: 2, expectedIndex: 2 });
  const missing = scoreAnswer('甲乙丁戊己', '甲乙丙丁戊己', 10);
  assert.equal(missing.differences.find(d => d.type === 'missing').expected, '丙');
  const extra = scoreAnswer('甲乙多丙丁戊己', '甲乙丙丁戊己', 10);
  assert.equal(extra.differences.find(d => d.type === 'extra').actual, '多');
  assert.equal(extra.points, 8.3);
});

test('各隊結果按本題分數排序、同分同名次，累計分數不干擾順序', () => {
  const players = [{ name: '累計領先隊', total: 100, result: { points: 3.3 } }, { name: '本題高分隊', total: 10, result: { points: 10 } }, { name: '同分隊', total: 5, result: { points: 10 } }];
  const ranked = rankedRoundResults(players);
  assert.deepEqual(ranked.map(p => p.name), ['本題高分隊', '同分隊', '累計領先隊']);
  assert.deepEqual(ranked.map(p => p.rank), [1, 1, 3]);
  assert.equal(players[0].name, '累計領先隊');
});

test('試玩題照常批改與計分，但在揭曉、結果與最終排名都不增加累計', () => {
  const game = new Game([
    { id: 'real', points: 17.5, lines: ['甲乙丙丁戊己'], videoId: '' },
    { id: 'practice', points: 35, practice: true, lines: ['甲乙丙丁戊己'], videoId: '' }
  ]);
  const room = game.create(), player = game.join(room, '範例隊'), actor = game.actor(room, player.token);
  game.command(room, 'start'); game.command(room, 'answer');
  game.submit(room, player, '甲乙丙丁戊己', 1, 0); game.command(room, 'reveal');
  assert.equal(player.total, 17.5); game.command(room, 'results'); game.command(room, 'next');
  assert.equal(game.snapshot(room, actor).question.practice, true);
  game.command(room, 'answer'); game.submit(room, player, '甲乙錯丁戊己', 1, 1); game.command(room, 'reveal');
  assert.equal(player.total, 17.5);
  assert.equal(game.snapshot(room, actor).players[0].total, 17.5);
  game.command(room, 'results');
  const result = game.snapshot(room, actor).players[0].result;
  assert.equal(result.points, 29.2); assert.equal(result.errors, 1); assert.equal(result.awardedPoints, 0);
  assert.equal(result.practice, true); assert.equal(player.total, 17.5);
  assert.throws(() => game.command(room, 'reveal'));
  game.command(room, 'next'); assert.equal(room.phase, 'finished'); assert.equal(player.total, 17.5);
});

test('正式歌曲編號排除試玩與停用題，後台與遊戲一致', () => {
  const bank = [
    { enabled: true, practice: true }, { enabled: true }, { enabled: false },
    { enabled: true, practice: true }, { enabled: true }
  ];
  assert.deepEqual(bank.map((_, index) => songPosition(bank, index, { enabledOnly: true }).songNumber), [null, 1, null, null, 2]);
  assert.equal(songPosition(bank, 4, { enabledOnly: true }).totalSongs, 2);
  const active = bank.filter(q => q.enabled);
  assert.deepEqual(active.map((_, index) => songPosition(active, index).songNumber), [null, 1, null, 2]);
  const game = new Game([{ ...questions[0], practice: true }, questions[0]]), room = game.create();
  const snapshot = game.snapshot(room, { host: true });
  assert.equal(snapshot.songNumber, null); assert.equal(snapshot.totalSongs, 1); assert.equal(snapshot.totalRounds, 2);
});

test('草稿只回傳本人，截止收取最新內容，未按提交也會自動提交與計分', () => {
  const game = new Game(questions), room = game.create();
  const alice = game.join(room, '忘記提交隊'), bob = game.join(room, '修改後沒提交隊');
  const correct = questions[0].lines.join('');
  game.command(room, 'start'); game.command(room, 'answer');
  game.saveDraft(room, alice, correct, 1, 0);
  assert.equal(game.snapshot(room, game.actor(room, alice.token)).me.draft.text, correct);
  assert.equal(game.snapshot(room, game.actor(room, bob.token)).me.draft, null);
  assert.equal(game.snapshot(room, { host: true }).players[0].draft, undefined);
  assert.equal(game.snapshot(room, { host: true }).submitted, 0);
  game.submit(room, bob, '舊答案', 1, 0); game.saveDraft(room, bob, correct, 2, 0);
  game.command(room, 'close'); assert.equal(room.phase, 'closing');
  assert.equal(game.snapshot(room, { host: true }).question.lines, undefined);
  game.saveDraft(room, alice, correct, 2, 0, true);
  assert.equal(room.phase, 'closing');
  assert.throws(() => game.saveDraft(room, alice, '截止後修改', 3, 0));
  game.saveDraft(room, bob, correct, 3, 0, true);
  assert.equal(room.phase, 'revealed'); assert.equal(alice.total, 10); assert.equal(bob.total, 10);
  assert.equal(room.results[alice.id].autoSubmitted, true); assert.equal(room.results[bob.id].answer, correct);
  assert.equal(room.results[bob.id].autoSubmitted, true);
  assert.throws(() => game.saveDraft(room, bob, '太晚', 4, 0, true));
  assert.throws(() => game.command(room, 'close')); assert.equal(bob.total, 10);
});

test('斷線未回覆截止通知時，用最後草稿；舊版本不覆蓋，清空輸入框可交空白', () => {
  const game = new Game(questions), room = game.create(), player = game.join(room, '離線隊');
  const correct = questions[0].lines.join('');
  game.command(room, 'start'); game.command(room, 'answer');
  game.submit(room, player, correct, 1, 0);
  game.saveDraft(room, player, '', 3, 0); game.saveDraft(room, player, '過時內容', 2, 0);
  assert.equal(room.drafts[player.id].text, '');
  assert.throws(() => game.saveDraft(room, player, '錯題', 4, 1));
  game.command(room, 'close'); room.closingDeadline = Date.now() - 1; game.expire(room);
  assert.equal(room.phase, 'revealed'); assert.equal(room.results[player.id].answer, ''); assert.equal(player.total, 0);
  game.expire(room); assert.equal(player.total, 0);
});
