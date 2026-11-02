import { validQuestionPoints } from '../shared/question-points.js';

export function parseTime(value) {
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);
  if (!parts) throw new Error('時間請填 m:ss（例如 1:19），也可以直接填秒數。');
  return Number(parts[1]) * 60 + Number(parts[2]);
}
export function formatTime(seconds = 0) {
  const remainder = Math.round((seconds % 60) * 1000) / 1000;
  return `${Math.floor(seconds / 60)}:${remainder < 10 ? '0' : ''}${remainder}`;
}
export function parseVideoId(value) {
  const text = value.trim();
  if (!text) return '';
  if (/^[\w-]{11}$/.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { throw new Error('請貼上完整 YouTube 連結。'); }
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) id = url.searchParams.get('v') || (/^\/(embed|shorts|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : '');
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('找不到有效的 YouTube 影片 ID，請確認連結。');
  return id;
}
export const lyricLength = line => Array.from(line.normalize('NFKC').replace(/[\p{P}\p{Z}\p{C}\s]/gu, '')).length;
export function toEditor(q) {
  return { ...q, practice: q.practice === true, _url: q.videoId ? `https://www.youtube.com/watch?v=${q.videoId}` : '', _qs: formatTime(q.questionClip?.startSeconds), _qe: formatTime(q.questionClip?.endSeconds), _as: formatTime(q.answerClip?.startSeconds), _ae: formatTime(q.answerClip?.endSeconds) };
}
export function editorClip(q, kind) {
  const videoId = parseVideoId(q._url);
  if (!videoId) throw new Error('請先貼上 YouTube 連結。');
  const startSeconds = parseTime(kind === 'question' ? q._qs : q._as);
  const endSeconds = parseTime(kind === 'question' ? q._qe : q._ae);
  if (endSeconds <= startSeconds) throw new Error('片段結束時間必須大於開始時間。');
  return { videoId, startSeconds, endSeconds, kind };
}
export function fromEditor(q, { allowMissingVideo = false } = {}) {
  const { _url, _qs, _qe, _as, _ae, ...result } = q;
  result.points = Number(q.points);
  result.practice = q.practice === true;
  if (result.enabled && !validQuestionPoints(result.points)) throw new Error('配分須為 0.1～1000000 的正數，最多一位小數。');
  result.videoId = parseVideoId(_url);
  if (!result.videoId && !allowMissingVideo) throw new Error('請填寫 YouTube 連結後再儲存歌曲。');
  result.lines = q.lines.filter(line => line.trim());
  result.lineLengths = result.lines.map(lyricLength);
  if (result.enabled && (!result.lines.length || result.lines.some(s => !lyricLength(s)))) throw new Error('已啟用的題目必須填寫每句歌詞。');
  if (result.videoId) {
    const question = editorClip(q, 'question'), answer = editorClip(q, 'answer');
    result.questionClip = { startSeconds: question.startSeconds, endSeconds: question.endSeconds };
    result.answerClip = { startSeconds: answer.startSeconds, endSeconds: answer.endSeconds };
  } else { delete result.questionClip; delete result.answerClip; }
  return result;
}
