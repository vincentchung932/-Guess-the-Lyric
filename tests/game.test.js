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

test('房間題目可追加與調整未播放順序，不改動共用題庫或目前歌曲', () => {
  const game = new Game(demoBank), room = game.create();
  const extra = { id: 'extra', enabled: true, points: 20, lines: ['測試'], title: '新增歌曲' };
  const edit = body => game.manage(room, { ...body, version: room.version }, [extra]);
  edit({ action: 'add', id: 'extra' });
  extra.title = '題庫改名'; assert.equal(room.questions[2].title, '新增歌曲');
  assert.throws(() => edit({ action: 'add', id: 'extra' }), /已在本場/);
  assert.throws(() => game.manage(room, { action: 'remove', index: 2, version: 0 }, []), /房間已更新/);
  const p = game.join(room, '隊伍'); game.command(room, 'start');
  assert.throws(() => edit({ action: 'remove', index: 0 }), /尚未播放/);
  edit({ action: 'move', index: 2, target: 1 }); assert.equal(room.questions[1].id, 'extra');
  edit({ action: 'remove', index: 2 }); assert.equal(room.questions.length, 2);
  assert.equal(demoBank.length, 2);
  assert.equal(game.snapshot(room, game.actor(room, p.token)).queue, undefined);
});

test('一鍵加入按題庫順序追加已啟用歌曲，跳過重複且不影響目前作答', () => {
  const game = new Game(demoBank), room = game.create();
  const player = game.join(room, '測試隊'); game.command(room, 'start'); game.command(room, 'answer');
  game.submit(room, player, '草稿答案', 1, 0);
  const bank = structuredClone([{ ...demoBank[0], enabled: true }, { id: 'off', enabled: false }, { ...demoBank[1], id: 'practice', enabled: true, practice: true }, { ...demoBank[0], id: 'new', enabled: true }]);
  const addAll = () => game.manage(room, { action: 'add-all', version: room.version }, bank);
  addAll();
  assert.deepEqual(room.questions.map(q => q.id), ['demo1', 'demo2', 'practice', 'new']);
  assert.equal(room.phase, 'answering'); assert.equal(room.round, 0);
  assert.equal(room.answers[player.id].text, '草稿答案');
  assert.equal(room.questions[2].practice, true);
  bank[2].lines[0] = '題庫修改'; assert.notEqual(room.questions[2].lines[0], '題庫修改');
  addAll(); assert.equal(room.questions.length, 4);
  room.questions = Array.from({ length: 500 }, (_, i) => ({ id: `full-${i}` }));
  assert.throws(addAll, /500/); assert.equal(room.questions.length, 500);
  room.phase = 'finished'; assert.throws(addAll, /本場已結束/);
});

test('提示播放階段可修改本題及後續作答時間，作答中不能改動倒數', () => {
  const game = new Game(demoBank), room = game.create(), p = game.join(room, '時間測試');
  game.command(room, 'start');
  game.command(room, 'duration', { duration: 180 }); assert.equal(room.duration, 180);
  assert.equal(game.snapshot(room, { host: false, player: p }).duration, 180);
  assert.throws(() => game.command(room, 'duration', { duration: 1 }), /作答時間/);
  const before = Date.now(); game.command(room, 'answer');
  assert.ok(room.deadline >= before + 180000 && room.deadline <= Date.now() + 180000);
  assert.throws(() => game.command(room, 'duration', { duration: 300 }), /目前無法/);
  assert.equal(room.duration, 180);
  game.command(room, 'reveal'); game.command(room, 'results'); game.command(room, 'next');
  assert.equal(room.duration, 180);
  game.command(room, 'duration', { duration: 300 }); game.command(room, 'answer');
  assert.equal(room.duration, 300);
});

test('清除已結束房間只移除 finished，保留大廳及進行中的房間', () => {
  const game = new Game(demoBank), lobby = game.create(), playing = game.create(), finished = game.create(120, [demoBank[0]]);
  game.join(playing, '進行中'); game.command(playing, 'start');
  game.join(finished, '已結束');
  for (const action of ['start', 'answer', 'reveal', 'results', 'next']) game.command(finished, action);
  assert.deepEqual(game.clearFinished(), [finished.code]);
  assert.equal(game.get(lobby.code), lobby); assert.equal(game.get(playing.code), playing);
  assert.throws(() => game.get(finished.code), /找不到房間/);
  assert.deepEqual(game.clearFinished(), []);
});

test('改分只加差額，保留原始批改，跨題修改與試玩不累加', () => {
  const game = new Game([{ ...demoBank[0], practice: true }, demoBank[1]]), room = game.create();
  const p = game.join(room, '甲隊'); game.command(room, 'start'); game.command(room, 'answer'); game.command(room, 'reveal');
  const score = (round, points) => game.manage(room, { action: 'score', round, playerId: p.id, points, reason: '接受版本', version: room.version }, []);
  score(0, 9.5); assert.equal(p.total, 0); assert.equal(room.results[p.id].points, 9.5);
  game.command(room, 'results'); game.command(room, 'next'); game.command(room, 'answer'); game.command(room, 'reveal');
  score(1, 7.2); assert.equal(p.total, 7.2);
  score(1, 8.5); assert.equal(p.total, 8.5); assert.equal(room.results[p.id].automaticPoints, 0);
  assert.equal(room.results[p.id].adjustments.length, 2);
  assert.equal(game.snapshot(room, { host: false, player: p }).players[0].total, 0);
  game.command(room, 'results'); game.command(room, 'next');
  score(1, 6.5); assert.equal(p.total, 6.5);
  score(0, 5); assert.equal(p.total, 6.5); assert.equal(room.history[0][p.id].points, 5);
  assert.throws(() => score(1, 10.1), /本題滿分/);
  assert.throws(() => score(1, 1.23), /一位小數/);
});

test('繁簡、標點與空白不影響計分；指定字組放寬，其餘同音錯字仍扣分', () => {
  assert.equal(normalize('滿天，都是 小星星！'), '满天都是小星星');
  assert.equal(scoreAnswer('满天 都是小星星！', '滿天都是小星星', 10).points, 10);
  assert.equal(scoreAnswer('跑的快', '跑得快', 20).points, 20);
  assert.equal(scoreAnswer('跑德快', '跑得快', 20).points, 13.3);
});

test('放寬字組雙向等同，批改保留原字且不畫錯字', () => {
  for (const group of ['你妳', '他她它牠', '的地得', '啊阿', '嗯恩', '喔哦噢']) {
    for (const actual of group) for (const expected of group) {
      const result = scoreAnswer(actual, expected, 10);
      assert.equal(result.points, 10, `${actual}／${expected}`);
      assert.equal(result.errors, 0); assert.equal(result.accuracy, 100);
      assert.deepEqual(result.differences.map(({ type, actual, expected }) => ({ type, actual, expected })), [{ type: 'correct', actual, expected }]);
    }
  }
  assert.equal(scoreAnswer('妳的她阿恩噢', '你得牠啊嗯喔', 20).points, 20);
  for (const [actual, expected] of [['在', '再'], ['做', '作'], ['心', '星'], ['哈', '呵']]) assert.equal(scoreAnswer(actual, expected, 10).errors, 1);
  const result = scoreAnswer('妳阿多', '你啊', 10);
  assert.equal(result.errors, 1); assert.equal(result.differences.filter(item => item.type === 'extra').length, 1);
  assert.equal(scoreAnswer('她', '他她', 10).errors, 1);
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
test('倒數歸零自動截止，收取最後草稿後等待主持人揭曉，不能再提交', () => {
  const game = new Game(questions), room = game.create(), player = game.join(room, '玩家');
  assert.throws(() => game.actor(room, '假的權杖'));
  game.command(room, 'start'); game.command(room, 'answer');
  game.submit(room, player, '舊答案', 1, 0);
  room.deadline = Date.now() - 1;
  assert.throws(() => game.submit(room, player, '超時提交', 2, 0), /已截止/);
  assert.equal(room.phase, 'closing'); assert.equal(room.timeUp, true);
  const version = room.version; game.expire(room); assert.equal(room.version, version);
  const correct = questions[0].lines.join('');
  game.saveDraft(room, player, correct, 2, 0, true);
  assert.equal(room.phase, 'locked'); assert.equal(player.total, 0);
  assert.equal(room.answers[player.id].text, correct); assert.equal(room.answers[player.id].autoSubmitted, true);
  assert.equal(game.snapshot(room, { host: true }).question.lines, undefined);
  assert.equal(game.snapshot(room, { host: true }).players[0].result, undefined);
  assert.throws(() => game.submit(room, player, '太晚了', 3, 0));
  assert.throws(() => game.saveDraft(room, player, '太晚了', 3, 0, true));
  game.command(room, 'reveal'); assert.equal(room.phase, 'revealed'); assert.equal(player.total, 10);
  assert.throws(() => game.command(room, 'reveal')); assert.equal(player.total, 10);
});

test('倒數截止後離線隊使用最後同步草稿，收取超時不會自動公布答案', () => {
  const game = new Game(questions), room = game.create(), player = game.join(room, '離線隊');
  game.command(room, 'start'); game.command(room, 'answer');
  game.saveDraft(room, player, questions[0].lines.join(''), 1, 0);
  room.deadline = Date.now() - 1; game.expire(room);
  room.closingDeadline = Date.now() - 1; game.expire(room);
  assert.equal(room.phase, 'locked'); assert.equal(room.answers[player.id].autoSubmitted, true);
  assert.equal(player.total, 0);
  const version = room.version; game.expire(room); assert.equal(room.version, version);
  game.command(room, 'reveal'); assert.equal(player.total, 10);
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
