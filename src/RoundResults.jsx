import React from 'react';
import { rankedRoundResults } from '../shared/round-results.js';
import './results.css';

export function AnswerCorrections({ result }) {
  const counts = { replace: 0, missing: 0, extra: 0 };
  for (const item of result.differences) if (item.type in counts) counts[item.type]++;
  return <div className="answer-corrections">
    <div className="marked-answer" aria-label="逐字批改">{result.differences.map((item, index) => {
      if (item.type === 'correct') return <span key={index} className="marked-correct">{item.actual}</span>;
      if (item.type === 'replace') return <span key={index} className="red-mark replace" aria-label={`${item.actual} 寫錯，應為 ${item.expected}`}><span className="red-correction">{item.expected}</span><del>{item.actual}</del><small>錯字</small></span>;
      if (item.type === 'missing') return <span key={index} className="red-mark missing" aria-label={`漏字，應補 ${item.expected}`}><span className="red-correction">{item.expected}</span><span className="missing-position">∧</span><small>漏字</small></span>;
      return <span key={index} className="red-mark extra" aria-label={`多字 ${item.actual}`}><span className="red-correction">×</span><del>{item.actual}</del><small>多字</small></span>;
    })}</div>
    <div className="correction-summary">{result.errors === 0 ? <span className="all-correct">全對 ✓</span> : <span>錯字 {counts.replace} · 漏字 {counts.missing} · 多字 {counts.extra}</span>}</div>
  </div>;
}

export default function RoundResults({ room, host, busy, connected, onNext }) {
  const players = rankedRoundResults(room.players);
  return <section className="panel round-results">
    <div className="results-heading"><div><span className="eyebrow muted">{room.question.practice ? '試玩' : `第 ${room.songNumber} 首歌 / 共 ${room.totalSongs} 首`} · 作答結果</span><h2>各隊答案，一起來對。</h2><p>按本題得分由高到低排列 · 本題滿分 {room.question.points.toFixed(1)} 分</p></div>{host && <button className="primary" disabled={busy || !connected} onClick={onNext}>{room.round + 1 === room.totalRounds ? '公布最終排名' : '下一題'} →</button>}</div>
    {room.question.practice && <p className="practice-note" role="status">試玩示範題：照常批改與計算本題得分，但不加入隊伍累計總分。</p>}
    <div className="results-reference"><span>正確答案</span><div>{room.question.lines.map((line, index) => <p key={index}>{line}</p>)}</div></div>
    <div className="mark-legend"><span>紅線刪除錯字，上方補正確字</span><span>∧ 漏字補入</span><span>× 多字刪除</span></div>
    <table className="answers-table"><thead><tr><th scope="col">排名</th><th scope="col">隊名</th><th scope="col">作答與批改</th><th scope="col">本題得分</th></tr></thead><tbody>{players.map(player => {
      const result = player.result;
      return <tr key={player.id}><td className="result-rank">{player.rank}</td><th className="result-team" scope="row">{player.name}</th><td className="result-answer"><p className="original-answer"><span>{player.submitted ? '原答' : '未作答'}</span>{result?.answer || '（空白）'}{result?.autoSubmitted && <small className="auto-submitted">截止時自動提交</small>}</p>{result && <AnswerCorrections result={result}/>}</td><td className="result-points"><strong>{(result?.points || 0).toFixed(1)}</strong><span> / {room.question.points.toFixed(1)} 分</span><small>正確率 {(result?.accuracy || 0).toFixed(1)}%</small>{room.question.practice && <small className="practice-score">試玩，不計入總分</small>}</td></tr>;
    })}</tbody></table>
    <p className="results-formula">得分＝滿分 × max(0, 1 − 錯誤數 ÷ 正確歌詞字數)，四捨五入到小數點第一位。標點、空格與繁簡差異不扣分。</p>
    {!host && <p className="center muted">等待主持人進入下一題或公布最終排名。</p>}
  </section>;
}
