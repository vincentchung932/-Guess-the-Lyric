import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QuestionStore, isLocalEditorRequest } from '../server/question-store.js';
import { questions } from './fixtures.js';
import { Game } from '../server/game.js';
import { parseTime, formatTime, parseVideoId, toEditor, fromEditor } from '../src/question-utils.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createLyricLayout } from '../shared/lyric-layout.js';
import { invitationOrigin, lanUrls } from '../server/network.js';
import { controlClipKind, canKeepControlPreview } from '../src/control-playback.js';

test('控制台依階段提供片段，揭曉或換題時不保留提示播放器', () => {
  assert.equal(controlClipKind('lobby'), null);
  for (const phase of ['playing', 'answering', 'closing', 'locked']) assert.equal(controlClipKind(phase), 'question');
  for (const phase of ['revealed', 'results', 'finished']) assert.equal(controlClipKind(phase), 'answer');
  const preview = { code: '123456', round: 1, kind: 'question' };
  const state = { code: '123456', round: 1, phase: 'playing' };
  assert.equal(canKeepControlPreview(preview, state), true);
  assert.equal(canKeepControlPreview(preview, { ...state, phase: 'answering' }), true);
  assert.equal(canKeepControlPreview(preview, { ...state, phase: 'revealed' }), false);
  assert.equal(canKeepControlPreview(preview, { ...state, round: 2 }), false);
  assert.equal(canKeepControlPreview(preview, { ...state, code: '654321' }), false);
  assert.equal(canKeepControlPreview({ ...preview, kind: 'answer' }, { ...state, phase: 'revealed' }), true);
  assert.equal(canKeepControlPreview(null, state), false);
});

test('編輯器解析影片連結、分秒和自動格數，拒絕錯誤時間與連結', () => {
  assert.equal(parseTime('1:19'), 79); assert.equal(parseTime('79.5'), 79.5);
  assert.equal(formatTime(65.5), '1:05.5'); assert.equal(parseTime(formatTime(65.5)), 65.5);
  assert.throws(() => parseTime('1:79'));
  for (const url of ['https://www.youtube.com/watch?v=FDeRzYjRGvY&si=example', 'https://youtu.be/FDeRzYjRGvY?t=45', 'https://www.youtube.com/shorts/FDeRzYjRGvY']) assert.equal(parseVideoId(url), 'FDeRzYjRGvY');
  assert.throws(() => parseVideoId('https://evil.example/watch?v=FDeRzYjRGvY'));
  const edited = toEditor(questions[0]);
  const result = fromEditor(edited);
  assert.deepEqual(result.lineLengths, [8, 8]); assert.deepEqual(result.questionClip, { startSeconds: 45, endSeconds: 79 });
  assert.equal(result._url, undefined);
  assert.throws(() => fromEditor({ ...edited, _qe: '0:40' }));
  const practice = fromEditor({ ...edited, points: '12.5', practice: true });
  assert.equal(practice.points, 12.5); assert.equal(practice.practice, true);
  assert.equal(toEditor(questions[0]).practice, false);
  assert.throws(() => fromEditor({ ...edited, points: '' }), /配分/);
});

test('換行歌詞可儲存三句以上，忽略空白行並保留玩家分行格數', () => {
  const question = fromEditor({ ...toEditor(questions[0]), lines: ['甲，乙', '', '丙 丁', '  ', '戊己庚', ''] });
  assert.deepEqual(question.lines, ['甲，乙', '丙 丁', '戊己庚']);
  assert.deepEqual(question.lineLengths, [2, 2, 3]);
  const folder = mkdtempSync(path.join(tmpdir(), 'song-multiline-'));
  try {
    const file = path.join(folder, 'bank.json'); writeFileSync(file, JSON.stringify([question]));
    const store = new QuestionStore(file);
    store.save([question], store.read().version);
    const game = new Game(store.active()), room = game.create();
    assert.deepEqual(game.snapshot(room, { host: true }).question.lengths, [2, 2, 3]);
    assert.equal(game.snapshot(room, { host: true }).question.layout.length, 3);
    assert.throws(() => fromEditor({ ...toEditor(questions[0]), lines: ['', '  '] }), /填寫/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('管理頁與玩家共用排版，保留全形標點和連續空格，控制字元不洩漏', () => {
  const line = '你，  好！\u200bﬃ';
  const layout = createLyricLayout([line])[0];
  assert.equal(layout.filter(token => token.type === 'slot').length, 5);
  assert.deepEqual(layout.filter(token => token.type === 'space').map(token => token.text), [' ', ' ']);
  assert.deepEqual(layout.filter(token => token.type === 'punctuation').map(token => token.text), ['，', '！']);
  assert.doesNotMatch(JSON.stringify(layout), /[你好ﬃ\u200b]/);
});
test('題庫原子儲存、版本衝突、既有房間保留原題，新房間使用新題', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'song-editor-')); const file = path.join(folder, 'questions.json');
  try {
    writeFileSync(file, JSON.stringify(questions)); const store = new QuestionStore(file);
    const initial = store.read(), game = new Game(); const oldRoom = game.create(30, store.active());
    const changed = structuredClone(initial.bank); changed[0].points = 20;
    const saved = store.save(changed, initial.version);
    assert.notEqual(saved.version, initial.version);
    assert.equal(JSON.parse(readFileSync(file))[0].points, 20);
    const newRoom = game.create(30, store.active());
    assert.equal(game.snapshot(oldRoom, { host: true }).question.points, 10);
    assert.equal(game.snapshot(newRoom, { host: true }).question.points, 20);
    assert.throws(() => store.save(initial.bank, initial.version), /另一個視窗/);
    assert.throws(() => store.save([{ ...changed[0], points: -1 }], saved.version), /配分/);
    assert.equal(store.read().bank[0].points, 20);
    const empty = store.save([], saved.version);
    assert.deepEqual(store.read().bank, []);
    assert.throws(() => store.active(), /至少需要一題/);
    assert.throws(() => new Game([]).create(), /至少需要一題/);
    store.save(initial.bank, empty.version);
    assert.equal(store.active()[0].points, 10);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('管理 API 只接受 loopback 連線及 localhost Host', () => {
  const request = (ip, host) => ({ socket: { remoteAddress: ip }, headers: { host } });
  assert.equal(isLocalEditorRequest(request('127.0.0.1', 'localhost:3000')), true);
  assert.equal(isLocalEditorRequest(request('::ffff:127.0.0.1', '127.0.0.1:3000')), true);
  assert.equal(isLocalEditorRequest(request('10.0.0.5', 'localhost:3000')), false);
  assert.equal(isLocalEditorRequest(request('127.0.0.1', 'attacker.example:3000')), false);
  assert.equal(isLocalEditorRequest(request('10.0.0.101', '10.0.0.101:3000')), false);
});

test('主持人使用 localhost 時，手機邀請自動使用實體 Wi-Fi IP，排除虛擬網卡', () => {
  const interfaces = { 'vEthernet (WSL)': [{ family: 'IPv4', address: '172.17.16.1', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '10.0.0.101', internal: false }], loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
  assert.deepEqual(lanUrls(3000, interfaces), ['http://10.0.0.101:3000']);
  assert.equal(invitationOrigin('localhost:3000', 3000, interfaces), 'http://10.0.0.101:3000');
  assert.equal(invitationOrigin('127.0.0.1:3000', 3000, interfaces), 'http://10.0.0.101:3000');
  assert.equal(invitationOrigin('10.0.0.101:3000', 3000, interfaces), 'http://10.0.0.101:3000');
  const otherFirst = { Ethernet: [{ family: 'IPv4', address: '10.5.0.2', internal: false }], ...interfaces };
  assert.equal(invitationOrigin('localhost:3000', 3000, otherFirst), 'http://10.0.0.101:3000');
});

test('管理 API 儲存並持久化、拒絕非本機 Host、缺少管理標頭和過時版本', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'song-admin-api-')); const file = path.join(folder, 'bank.json');
  writeFileSync(file, JSON.stringify(questions));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server/index.js', '--production'], { env: { ...process.env, PORT: String(port), QUESTION_BANK_PATH: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('http://localhost')) resolve(); }); child.on('error', reject); child.on('exit', code => reject(new Error(`Server exited ${code}`))); });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    await ready;
    const url = `http://127.0.0.1:${port}/api/question-bank`;
    let response = await fetch(url, { headers: { Host: `10.0.0.101:${port}` } }); assert.equal(response.status, 403);
    response = await fetch(url); const original = await response.json(); assert.equal(response.status, 200);
    const changed = structuredClone(original.bank); changed[0].title = '測試儲存'; changed[0].points = 12.5; changed[0].practice = true;
    const body = JSON.stringify({ bank: changed, version: original.version });
    response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }); assert.equal(response.status, 403);
    const headers = { 'Content-Type': 'application/json', 'X-Question-Editor': '1' };
    response = await fetch(url, { method: 'PUT', headers, body }); assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(JSON.parse(readFileSync(file))[0].title, '測試儲存');
    assert.equal(JSON.parse(readFileSync(file))[0].points, 12.5);
    assert.equal(JSON.parse(readFileSync(file))[0].practice, true);
    const roomResponse = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const room = await roomResponse.json();
    const roomState = await (await fetch(`http://127.0.0.1:${port}/api/rooms/${room.code}`, { headers: { Authorization: `Bearer ${room.token}` } })).json();
    assert.equal(roomState.question.points, 12.5); assert.equal(roomState.question.practice, true);
    response = await fetch(url, { method: 'PUT', headers, body }); assert.equal(response.status, 409);
    response = await fetch(url, { method: 'PUT', headers: { ...headers, Origin: 'http://attacker.example' }, body }); assert.equal(response.status, 400);
    response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ bank: [], version: saved.version }) }); assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(readFileSync(file)), []);
    response = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /至少需要一題/);
    response = await fetch(url); assert.equal(response.status, 200); assert.deepEqual((await response.json()).bank, []);
  } finally {
    clearTimeout(timeout); const exited = once(child, 'exit'); child.kill(); await exited;
    rmSync(folder, { recursive: true, force: true });
  }
});
