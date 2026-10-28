import { randomBytes, randomInt } from 'node:crypto';
import { questions } from './questions.js';
import { normalize, scoreAnswer } from './scoring.js';
import { createLyricLayout } from '../shared/lyric-layout.js';
import { songPosition } from '../shared/song-position.js';

const token = () => randomBytes(24).toString('hex');
export class Game {
  constructor(questionBank = questions) { this.rooms = new Map(); this.questions = questionBank; }
  create(duration = 120, questionBank = this.questions) {
    if (!questionBank.length) throw new Error('題庫至少需要一題已啟用的題目，請先在題庫管理新增或啟用題目。');
    let code;
    do code = String(randomInt(100000, 1000000)); while (this.rooms.has(code));
    const room = { code, hostToken: token(), questions: structuredClone(questionBank), players: [], round: 0, phase: 'lobby', duration, deadline: null, timeUp: false, version: 1, answers: {}, drafts: {}, closingAcks: {}, closingDeadline: null, results: {}, createdAt: Date.now() };
    this.rooms.set(code, room);
    return room;
  }
  get(code) { const room = this.rooms.get(code); if (!room) throw new Error('找不到房間，請確認房間碼。'); this.expire(room); return room; }
  expire(room) {
    if (room.phase === 'answering' && !room.timeUp && Date.now() >= room.deadline) { room.timeUp = true; room.version++; }
    if (room.phase === 'closing' && Date.now() >= room.closingDeadline) this.finishReveal(room);
  }
  finishReveal(room) {
    if (!['answering', 'locked', 'closing'].includes(room.phase)) throw new Error('本題已經揭曉。');
    const q = room.questions[room.round];
    room.results = {};
    for (const p of room.players) {
      const draft = room.drafts[p.id], submitted = room.answers[p.id];
      if (draft && (!submitted || draft.revision > submitted.revision)) room.answers[p.id] = { ...draft, autoSubmitted: !submitted || draft.text !== submitted.text };
      const answer = room.answers[p.id]?.text || '';
      const result = scoreAnswer(answer, q.lines.join(''), q.points);
      const awardedPoints = q.practice ? 0 : result.points;
      room.results[p.id] = { ...result, answer, autoSubmitted: room.answers[p.id]?.autoSubmitted === true, practice: q.practice === true, awardedPoints };
      p.total = Math.round((p.total + awardedPoints) * 10) / 10;
    }
    room.phase = 'revealed'; room.version++;
  }
  join(room, name) {
    if (room.phase !== 'lobby') throw new Error('遊戲已開始，請等待下一場。');
    if (room.players.length >= 30) throw new Error('房間已滿（最多 30 人）。');
    name = String(name || '').trim();
    if (!name || Array.from(name).length > 16) throw new Error('暱稱請填 1～16 個字。');
    if (room.players.some(p => p.name === name)) throw new Error('這個暱稱已有人使用。');
    const player = { id: token(), token: token(), name, total: 0 };
    room.players.push(player); room.version++;
    return player;
  }
  actor(room, auth) {
    if (auth === room.hostToken) return { host: true };
    const player = room.players.find(p => p.token === auth);
    if (!player) throw new Error('連線身分失效，請重新加入。');
    return { host: false, player };
  }
  command(room, action) {
    this.expire(room);
    if (action === 'start' && room.phase === 'lobby') {
      if (!room.players.length) throw new Error('至少需要一位玩家才能開始。');
      room.phase = 'playing';
    } else if (action === 'answer' && room.phase === 'playing') {
      room.phase = 'answering'; room.timeUp = false; room.deadline = Date.now() + room.duration * 1000;
    } else if (action === 'lock' && room.phase === 'answering') room.phase = 'locked';
    else if (action === 'close' && room.phase === 'answering') {
      room.phase = 'closing'; room.closingDeadline = Date.now() + 1500; room.closingAcks = {};
    }
    else if (action === 'reveal' && ['answering', 'locked'].includes(room.phase)) {
      this.finishReveal(room); return;
    } else if (action === 'results' && room.phase === 'revealed') {
      room.phase = 'results';
    } else if (action === 'next' && room.phase === 'results') {
      if (room.round === room.questions.length - 1) room.phase = 'finished';
      else { room.round++; room.phase = 'playing'; room.answers = {}; room.drafts = {}; room.closingAcks = {}; room.closingDeadline = null; room.results = {}; room.deadline = null; room.timeUp = false; }
    } else throw new Error('目前無法執行此操作，請重新確認遊戲狀態。');
    room.version++;
  }
  submit(room, player, text, revision, round) {
    this.expire(room);
    if (room.phase !== 'answering') throw new Error('本題作答已截止。');
    if (round !== room.round) throw new Error('題目已更新，請重新作答。');
    if (typeof text !== 'string' || text.length > 300) throw new Error('答案長度超過限制。');
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('答案版本無效。');
    if ((room.answers[player.id]?.revision || 0) >= revision) return;
    room.answers[player.id] = { text, revision }; room.version++;
  }
  saveDraft(room, player, text, revision, round, final = false) {
    this.expire(room);
    if (!['answering', 'closing'].includes(room.phase)) throw new Error('本題作答已截止。');
    if (round !== room.round) throw new Error('題目已更新，請重新作答。');
    if (typeof text !== 'string' || text.length > 300) throw new Error('答案長度超過限制。');
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('答案版本無效。');
    const latest = Math.max(room.drafts[player.id]?.revision || 0, room.answers[player.id]?.revision || 0);
    if (room.phase === 'closing' && room.closingAcks[player.id]) {
      if (final === true && revision <= latest) return;
      throw new Error('本隊答案已收取，不能再修改。');
    }
    if (revision > latest) { room.drafts[player.id] = { text, revision }; room.version++; }
    if (room.phase === 'closing' && final === true) {
      if (!room.closingAcks[player.id]) { room.closingAcks[player.id] = true; room.version++; }
      if (room.players.every(p => room.closingAcks[p.id])) this.finishReveal(room);
    }
  }
  snapshot(room, actor) {
    this.expire(room);
    const q = room.questions[room.round];
    const revealed = ['revealed', 'results', 'finished'].includes(room.phase);
    const resultsPublished = ['results', 'finished'].includes(room.phase);
    const clip = room.phase === 'playing' ? q.questionClip : room.phase === 'revealed' ? q.answerClip : null;
    return {
      code: room.code, phase: room.phase, round: room.round, totalRounds: room.questions.length,
      ...songPosition(room.questions, room.round),
      duration: room.duration, deadline: room.deadline, timeUp: room.timeUp, version: room.version, serverTime: Date.now(),
      closingDeadline: room.closingDeadline, collected: Object.keys(room.closingAcks).length,
      submitted: Object.keys(room.answers).length,
      players: room.players.map(p => ({ id: p.id, name: p.name, total: room.phase === 'revealed' ? Math.round((p.total - (room.results[p.id]?.awardedPoints || 0)) * 10) / 10 : p.total, submitted: !!room.answers[p.id], result: resultsPublished ? room.results[p.id] : undefined })),
      question: { points: q.points, practice: q.practice === true, prompt: q.prompt, lengths: q.lines.map(s => Array.from(normalize(s)).length),
        layout: createLyricLayout(q.lines),
        playback: actor.host && q.videoId && clip ? { videoId: q.videoId, ...clip, kind: room.phase === 'playing' ? 'question' : 'answer' } : undefined,
        cue: room.phase !== 'lobby' ? q.cue : undefined,
        title: revealed ? q.title : undefined, artist: revealed ? q.artist : undefined, lines: revealed ? q.lines : undefined },
      me: actor.player ? { id: actor.player.id, answer: room.answers[actor.player.id] || null, draft: room.drafts[actor.player.id] || null } : null
    };
  }
}
