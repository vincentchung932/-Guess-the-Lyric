import React, { useEffect, useRef, useState } from 'react';
import YouTubeClip from './YouTubeClip.jsx';
import AnswerDuration from './AnswerDuration.jsx';
import { songPosition } from '../shared/song-position.js';
import { controlClipKind, canKeepControlPreview } from './control-playback.js';
import './control.css';

function hostSession() {
  try {
    const incoming = location.hash ? JSON.parse(decodeURIComponent(location.hash.slice(1))) : null;
    if (incoming?.role === 'host' && /^\d{6}$/.test(incoming.code) && typeof incoming.token === 'string') {
      sessionStorage.setItem('song-session', JSON.stringify(incoming));
      history.replaceState(null, '', location.pathname);
    }
    const session = JSON.parse(sessionStorage.getItem('song-session'));
    return session?.role === 'host' ? session : null;
  } catch { return null; }
}

export default function RoomControl() {
  const [session, setSession] = useState(hostSession);
  const activeSession = useRef(session); activeSession.current = session;
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [connected, setConnected] = useState(false), [search, setSearch] = useState('');
  const [round, setRound] = useState(''), [preview, setPreview] = useState(null);
  async function clearFinished() {
    if (!confirm('清除所有已結束房間？這些房間的答案、分數及修正紀錄將無法再查看。正在進行的房間會保留。')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/host-rooms', { method: 'DELETE', headers: { 'X-Room-Control': '1' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRooms(data.rooms); setNotice(`已清除 ${data.removed} 個已結束房間。`);
      try { const saved = JSON.parse(sessionStorage.getItem('song-session')); if (saved?.role === 'host' && !data.rooms.some(item => item.code === saved.code)) sessionStorage.removeItem('song-session'); } catch { /* Storage may be unavailable. */ }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (session) return;
    fetch('/api/host-rooms').then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setRooms(data.rooms); }).catch(e => setError(e.message));
  }, [session]);
  function choose(next) {
    try { sessionStorage.setItem('song-session', JSON.stringify(next)); } catch { /* Current tab still works. */ }
    setRoom(null); setRound(''); setPreview(null); setError(''); setNotice(''); setSession(next);
  }
  async function load() {
    const response = await fetch(`/api/rooms/${session.code}/control`, { headers: { Authorization: `Bearer ${session.token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (activeSession.current?.code !== session.code || activeSession.current?.token !== session.token) return;
    setRoom(old => !old || data.version >= old.version ? data : old);
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const refresh = () => { if (!stopped) load().catch(e => setError(e.message)); };
    refresh();
    const events = new EventSource(`/api/rooms/${session.code}/events?token=${encodeURIComponent(session.token)}`);
    let refreshTimer;
    events.onmessage = event => {
      const state = JSON.parse(event.data);
      // Stop playback as soon as a phase/round update arrives, before the full control refresh.
      setPreview(current => canKeepControlPreview(current, state) ? current : null);
      setConnected(true); if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 300);
    };
    events.onerror = () => setConnected(false);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; clearTimeout(refreshTimer); events.close(); document.removeEventListener('visibilitychange', visible); };
  }, [session]);
  async function act(body, command = false) {
    if (command && ['reveal', 'close', 'next'].includes(body.action)) setPreview(null);
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/rooms/${session.code}/${command ? 'command' : 'control'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ ...body, version: room.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load(); setNotice(body.action === 'add-all' ? `已加入 ${data.queue.length - room.queue.length} 首歌曲；已在本場的歌曲不會重複加入。` : '已更新目前房間。');
    } catch (e) { setError(e.message); await load().catch(() => {}); } finally { setBusy(false); }
  }
  const first = room?.phase === 'lobby' ? 0 : (room?.round || 0) + 1;
  const selectedRound = round !== '' ? Number(round) : Math.max(-1, ...Object.keys(room?.history || {}).map(Number));
  const q = room?.queue[selectedRound];
  const current = room?.queue[room.round];
  const clipKind = controlClipKind(room?.phase);
  const visiblePreview = canKeepControlPreview(preview, room) ? preview : null;
  function playClip() {
    setPreview({ code: room.code, round: room.round, videoId: current.videoId, ...(clipKind === 'question' ? current.questionClip : current.answerClip), kind: clipKind });
  }
  const available = room?.bank.filter(song => !room.queue.some(q => q.id === song.id)).length || 0;
  const songLabel = index => room.queue[index].practice ? '試玩' : `第 ${songPosition(room.queue, index).songNumber} 首歌`;
  const steps = { lobby: ['start', '開始遊戲'], playing: ['answer', '開始作答'], answering: ['close', '截止並揭曉答案'], locked: ['reveal', '揭曉答案'], revealed: ['results', '查看各隊答案'], results: ['next', room?.round + 1 === room?.totalRounds ? '公布最終排名' : '下一題'] };
  const step = steps[room?.phase];
  return <div className="app room-control">
    <header className="topbar"><a className="brand" href="/">♫ 接著唱</a><div className="control-links"><a href="/admin">共用題庫管理</a><a href="/" target="_blank" rel="opener">開啟投影畫面 ↗</a></div></header>
    <main className="control-main"><h1>房間控制台 {session?.code}</h1><p>此頁包含歌名及答案，請留在主持人電腦操作。</p>{session && <button className="secondary" onClick={() => { setRoom(null); setSession(null); setError(''); }}>選擇其他房間</button>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!session ? <section className="panel"><h2>選擇目前房間</h2><p>請在主持人電腦使用 localhost 開啟。沒有房間時，先到首頁建立房間。</p><button className="secondary" disabled={busy || !rooms.some(item => item.phase === 'finished')} onClick={clearFinished}>清除已結束房間（{rooms.filter(item => item.phase === 'finished').length}）</button>{!rooms.length && <p>目前沒有房間。</p>}{rooms.map(item => <p key={item.code}><button className="secondary" onClick={() => choose(item)}>管理房間 {item.code} · {item.teams} 隊 {item.phase === 'finished' ? '（已結束）' : ''}</button></p>)}</section> : !room ? <p>正在載入房間…</p> : <>
        <section className="panel control-current"><h2>目前歌曲：{current?.practice ? '試玩' : `第 ${room.songNumber} 首歌`} · {current?.title}</h2><p>{connected ? '即時連線中' : '正在重新連線'} · {room.players.length} 隊 · 已提交 {room.submitted} 隊</p>
          <p>{current?.lines.join(' ／ ')}</p>
          {room.phase === 'playing' && <AnswerDuration duration={room.duration} disabled={busy || !connected} onChange={duration => act({ action: 'duration', duration }, true)}/>}
          <div className="control-actions">{current?.videoId && clipKind && <button className={room.phase === 'playing' ? 'primary prompt-play-highlight' : 'secondary'} disabled={busy || !connected} onClick={playClip}>{clipKind === 'question' ? '播放提示片段' : '播放答案片段'}</button>}{step && <button className="primary" disabled={busy || !connected || (room.phase === 'lobby' && !room.players.length)} onClick={() => act({ action: step[0] }, true)}>{step[1]} →</button>}</div>
          {room.phase === 'closing' && <p>正在收取答案，請稍候。</p>}{room.phase === 'finished' && <p>本場比賽已結束。</p>}
          {visiblePreview && <div><YouTubeClip clip={visiblePreview} autoPlay/><button className="text-button" onClick={() => setPreview(null)}>關閉播放</button></div>}
        </section>
        <section className="panel"><h2>本場歌曲 · {room.queue.length} 題</h2><p>已播放及目前歌曲會鎖定；新增歌曲接在最後面。</p><ol className="control-queue">{room.queue.map((song, index) => <li key={`${song.id}-${index}`}><div><strong>{songLabel(index)} · {song.title}</strong><small>{song.artist} · {song.points} 分 · {index < room.round || room.phase === 'finished' ? '已完成' : index === room.round && room.phase !== 'lobby' ? '目前歌曲' : '待播放'}</small></div><div className="control-actions">{index >= first && room.phase !== 'finished' && <><button className="secondary" disabled={busy || index === first} onClick={() => act({ action: 'move', index, target: index - 1 })} aria-label={`上移 ${song.title}`}>↑</button><button className="secondary" disabled={busy || index === room.queue.length - 1} onClick={() => act({ action: 'move', index, target: index + 1 })} aria-label={`下移 ${song.title}`}>↓</button><button className="secondary" disabled={busy || room.queue.length === 1} onClick={() => { if (confirm(`從本場移除「${song.title}」？共用題庫會保留。`)) act({ action: 'remove', index }); }}>移除</button></>}</div></li>)}</ol></section>
        <section className="panel"><h2>主持人手動修正分數</h2><p>可修正已批改題目的得分，精確到一位小數。總分會同步更新；試玩題不加入總分。原始批改與改分紀錄會保留。</p>
          <select aria-label="選擇改分題目" value={selectedRound} onChange={e => setRound(e.target.value)}><option value={-1} disabled>尚無已批改題目</option>{Object.keys(room.history).map(index => <option key={index} value={index}>{songLabel(Number(index))} · {room.queue[index].title}</option>)}</select>
          {q && room.teams.map(team => { const result = room.history[selectedRound]?.[team.id]; return result && <ScoreForm key={`${selectedRound}-${team.id}-${result.points}-${result.adjustments?.length || 0}`} team={team} result={result} question={q} busy={busy} onSave={(points, reason) => act({ action: 'score', round: selectedRound, playerId: team.id, points, reason })}/>; })}
        </section>
        <section className="panel"><h2>將題庫歌曲加入目前房間</h2><p>先在共用題庫儲存歌曲，再按重新讀取。加入時會保存歌曲副本，之後修改題庫不會改動本場內容。</p><div className="control-actions"><input aria-label="搜尋歌曲" placeholder="搜尋歌名或歌手" value={search} onChange={e => setSearch(e.target.value)}/><button className="secondary" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>重新讀取題庫</button><button className="primary" disabled={busy || room.phase === 'finished' || !available} onClick={() => act({ action: 'add-all' })}>一鍵加入全部歌曲（{available} 首）</button></div><p>加入全部已啟用且尚未在本場的歌曲，包含試玩題，不受搜尋條件影響。</p><ul className="control-queue">{room.bank.filter(song => `${song.title} ${song.artist}`.includes(search)).map(song => <li key={song.id}><span>{song.title} · {song.artist} · {song.points} 分 {song.practice && '· 試玩'}</span><button className="secondary" disabled={busy || room.phase === 'finished' || room.queue.some(q => q.id === song.id)} onClick={() => act({ action: 'add', id: song.id })}>{room.queue.some(q => q.id === song.id) ? '已在本場' : '加入本場 +'}</button></li>)}</ul>{!room.bank.length && <p>目前沒有已啟用的題目。</p>}</section>
      </>}
    </main><footer><span className="design-credit">Designed by Vincent Chung</span></footer>
  </div>;
}
function ScoreForm({ team, result, question, busy, onSave }) {
  const [points, setPoints] = useState(String(result.points)), [reason, setReason] = useState('');
  return <form className="control-score" onSubmit={e => { e.preventDefault(); onSave(Number(points), reason); }}><h3>{team.name} · 累計 {team.total.toFixed(1)} 分</h3><p>原答：{result.answer || '（空白）'}</p><p>系統評分 {(result.automaticPoints ?? result.points).toFixed(1)} ／ {question.points} 分{question.practice && ' · 試玩不計總分'}</p><div className="control-actions"><label>本題得分<input required type="number" min="0" max={question.points} step="0.1" value={points} onChange={e => setPoints(e.target.value)}/></label><label>修正原因<input required maxLength={200} value={reason} placeholder="例如：接受另一歌詞版本" onChange={e => setReason(e.target.value)}/></label><button className="primary" disabled={busy}>儲存分數</button></div>{result.adjustments?.map((entry, index) => <p className="muted" key={index}>{entry.from.toFixed(1)} → {entry.to.toFixed(1)} 分：{entry.reason}</p>)}</form>;
}
