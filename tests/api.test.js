import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { questions } from './fixtures.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('HTTP 多人流程：身分隔離、SSE、提交、鎖定、揭曉與重連', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'song-game-api-'));
  const bankFile = path.join(folder, 'bank.json'); writeFileSync(bankFile, JSON.stringify(questions));
  const port = 31000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server/index.js', '--production'], { env: { ...process.env, PORT: String(port), QUESTION_BANK_PATH: bankFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', d => { output += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('http://localhost')) resolve(); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`啟動失敗 ${code}: ${output}`)));
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  let reader;
  try {
    await ready;
    const request = async (path, body, token) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/rooms${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() };
    };
    for (const duration of [120, 180, 300]) {
      const created = (await request('', { duration })).data;
      assert.equal((await request(`/${created.code}`, null, created.token)).data.duration, duration);
    }
    const host = (await request('', { duration: 120 })).data;
    const path = `/${host.code}`;
    const alice = (await request(`${path}/join`, { name: '小明' })).data;
    const bob = (await request(`${path}/join`, { name: '小美' })).data;
    assert.equal((await request(path)).status, 400);
    assert.equal((await request(`${path}/command`, { action: 'start' }, alice.token)).status, 400);
    const stream = await fetch(`http://127.0.0.1:${port}/api/rooms${path}/events?token=${alice.token}`);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    reader = stream.body.getReader(); const initial = await reader.read();
    assert.match(new TextDecoder().decode(initial.value), /"phase":"lobby"/);
    for (const action of ['start', 'answer']) assert.equal((await request(`${path}/command`, { action }, host.token)).status, 200);
    let state = (await request(path, null, alice.token)).data;
    assert.equal(state.question.lines, undefined); assert.equal(state.question.title, undefined);
    const correctAnswer = questions[0].lines.join('');
    assert.deepEqual(state.question.lengths, [8, 8]);
    assert.equal(state.question.playback, undefined);
    assert.equal((await request(`${path}/answer`, { text: correctAnswer, revision: 1, round: 0 }, alice.token)).status, 200);
    state = (await request(path, null, bob.token)).data;
    assert.equal(state.me.answer, null); assert.equal(state.submitted, 1); assert.equal(state.players[0].result, undefined);
    assert.equal((await request(path, null, alice.token)).data.me.answer.text, correctAnswer);
    await request(`${path}/command`, { action: 'lock' }, host.token);
    assert.equal((await request(`${path}/answer`, { text: '遲到', revision: 2, round: 0 }, alice.token)).status, 400);
    state = (await request(`${path}/command`, { action: 'reveal' }, host.token)).data;
    assert.equal(state.players[0].total, 0); assert.equal(state.players[1].total, 0);
    assert.equal(state.players[0].result, undefined);
    assert.deepEqual(state.question.lines, questions[0].lines);
    assert.equal(state.question.playback.startSeconds, 79);
    assert.equal(state.question.playback.endSeconds, 86);
    const protectedBank = await fetch(`http://127.0.0.1:${port}/server/question-bank.json`);
    assert.equal(protectedBank.status, 403);
    assert.equal((await request(`${path}/command`, { action: 'results' }, alice.token)).status, 400);
    state = (await request(`${path}/command`, { action: 'results' }, host.token)).data;
    assert.equal(state.phase, 'results'); assert.equal(state.players[0].result.points, 10);
    assert.equal(state.players[0].total, 10);
    assert.equal(state.question.playback, undefined);
    await request(`${path}/command`, { action: 'next' }, host.token);
    state = (await request(path, null, alice.token)).data;
    assert.equal(state.phase, 'finished'); assert.equal(state.players[0].total, 10);
    const draftHost = (await request('', { duration: 120 })).data;
    const draftPath = `/${draftHost.code}`;
    const draftPlayer = (await request(`${draftPath}/join`, { name: '未提交隊' })).data;
    for (const action of ['start', 'answer']) await request(`${draftPath}/command`, { action }, draftHost.token);
    assert.equal((await request(`${draftPath}/draft`, { text: correctAnswer, revision: 1, round: 0 }, draftPlayer.token)).status, 200);
    state = (await request(draftPath, null, draftPlayer.token)).data;
    assert.equal(state.submitted, 0); assert.equal(state.me.draft.text, correctAnswer); assert.equal(state.me.answer, null);
    assert.equal((await request(`${draftPath}/draft`, { text: '冒用主持人', revision: 1, round: 0 }, draftHost.token)).status, 400);
    state = (await request(`${draftPath}/command`, { action: 'close' }, draftHost.token)).data;
    assert.equal(state.phase, 'closing'); assert.equal(state.question.lines, undefined);
    state = (await request(`${draftPath}/draft`, { text: correctAnswer, revision: 2, round: 0, final: true }, draftPlayer.token)).data;
    assert.equal(state.phase, 'revealed');
    state = (await request(`${draftPath}/command`, { action: 'results' }, draftHost.token)).data;
    assert.equal(state.players[0].result.autoSubmitted, true); assert.equal(state.players[0].result.points, 10);
    assert.equal(state.players[0].result.answer, correctAnswer); assert.equal(state.players[0].total, 10);
  } finally {
    if (reader) await reader.cancel();
    clearTimeout(timeout); const ended = once(child, 'exit'); child.kill(); await ended;
    rmSync(folder, { recursive: true, force: true });
  }
});
