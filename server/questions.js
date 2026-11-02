import { readFileSync } from 'node:fs';
import { normalize } from './scoring.js';
import { validQuestionPoints } from '../shared/question-points.js';

export function validateQuestionBank(bank, { allowEmpty = false } = {}) {
  if (!Array.isArray(bank)) throw new Error('題庫必須是 JSON 陣列。');
  const ids = new Set();
  for (const q of bank) {
    if (!q || typeof q.id !== 'string' || !q.id || ids.has(q.id)) throw new Error('題目 id 必須存在且不可重複。');
    ids.add(q.id);
    if (typeof q.enabled !== 'boolean') throw new Error(`${q.id}：請設定 enabled 為 true 或 false。`);
    if (q.practice !== undefined && typeof q.practice !== 'boolean') throw new Error(`${q.id}：practice 試玩設定必須為 true 或 false。`);
    for (const field of ['title', 'artist', 'cue', 'prompt']) if (q[field] !== undefined && (typeof q[field] !== 'string' || q[field].length > 300)) throw new Error(`${q.id}：${field} 請使用 300 字以內文字。`);
    if (!q.enabled) continue;
    if (!validQuestionPoints(q.points)) throw new Error(`${q.id}：配分須為 0.1～1000000 的正數，最多一位小數。`);
    if (!Array.isArray(q.lines) || q.lines.length < 1 || q.lines.some(s => typeof s !== 'string' || !normalize(s))) throw new Error(`${q.id}：請提供至少一句正確歌詞。`);
    if (q.lines.join('').length > 300) throw new Error(`${q.id}：全部歌詞含標點及空格最多 300 字元。`);
    const lengths = q.lines.map(s => Array.from(normalize(s)).length);
    if (lengths.some(n => n > 50)) throw new Error(`${q.id}：每句最多 50 個字。`);
    if (q.lineLengths && (!Array.isArray(q.lineLengths) || q.lineLengths.length !== lengths.length || q.lineLengths.some((n, i) => n !== lengths[i]))) throw new Error(`${q.id}：格數與忽略標點後的歌詞字數不一致。`);
    if (typeof q.videoId !== 'string') throw new Error(`${q.id}：請設定 videoId，無影片時使用空字串。`);
    if (q.videoId) {
      if (!/^[a-zA-Z0-9_-]{11}$/.test(q.videoId)) throw new Error(`${q.id}：YouTube videoId 應為 11 字元。`);
      for (const field of ['questionClip', 'answerClip']) {
        const clip = q[field];
        if (!clip || !Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds) || clip.startSeconds < 0 || clip.endSeconds <= clip.startSeconds) throw new Error(`${q.id}：${field} 的播放時間無效。`);
      }
    }
  }
  const active = bank.filter(q => q.enabled);
  if (!allowEmpty && !active.length) throw new Error('題庫至少需要一題已啟用的題目，請先在題庫管理新增或啟用題目。');
  return active;
}

// 題庫僅在後端讀取，不放到前端 public/ 或 dist/。
export const questionBankPath = process.env.QUESTION_BANK_PATH || new URL('./question-bank.json', import.meta.url);
export const questions = validateQuestionBank(JSON.parse(readFileSync(questionBankPath, 'utf8')), { allowEmpty: true });
