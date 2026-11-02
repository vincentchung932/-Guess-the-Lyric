import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import InviteLink from './InviteLink.jsx';
import YouTubeClip from './YouTubeClip.jsx';
import QuestionEditor from './QuestionEditor.jsx';
import RoundResults from './RoundResults.jsx';
import RoomControl from './RoomControl.jsx';
import AnswerDuration from './AnswerDuration.jsx';
import './style.css';

const labels = { lobby: '等待大家加入', playing: '仔細聽，準備接著唱', answering: '輪到你接著唱', closing: '正在收取各隊答案', locked: '答案已鎖定', revealed: '揭曉時刻', results: '本題作答結果', finished: '今晚的歌詞王' };
const saved = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem('song-session'));
    return value && /^\d{6}$/.test(value.code) && typeof value.token === 'string' && ['host', 'player'].includes(value.role) ? value : null;
  } catch { return null; }
};
function persistSession(value) {
  // Some mobile privacy modes deny storage; joining still works in memory.
  try { if (value) sessionStorage.setItem('song-session', JSON.stringify(value)); else sessionStorage.removeItem('song-session'); } catch { /* Refresh recovery unavailable, but gameplay remains usable. */ }
}
async function api(path, data, session) {
  const response = await fetch(`/api/rooms${path}`, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '連線失敗');
  return result;
}
function App() {
  const [session, setSession] = useState(saved);
  const [room, setRoom] = useState(null);
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(120);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [answer, setAnswer] = useState('');
  const [draftStatus, setDraftStatus] = useState('idle');
  const [qr, setQr] = useState('');
  const [shareBase, setShareBase] = useState(() => session?.joinBaseUrl || location.origin);

  const revision = useRef(0), restoredRound = useRef(null);
  const answerRef = useRef(''), roomRef = useRef(null), closingSent = useRef(null);
  const host = session?.role === 'host';
  const joinUrl = room ? `${shareBase.replace(/\/$/, '')}/?room=${room.code}` : '';
  function acceptRoom(state) {
    if (roomRef.current && state.version < roomRef.current.version) return false;
    roomRef.current = state; setRoom(state); return true;
  }

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  useEffect(() => { if (room?.phase === 'results') window.scrollTo(0, 0); }, [room?.phase]);
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    function update(state) {
      if (disposed) return;
      if (!acceptRoom(state)) return;
      setOffset(state.serverTime - Date.now()); setConnected(true);
      if (restoredRound.current !== state.round) {
        const latest = (state.me?.draft?.revision || 0) > (state.me?.answer?.revision || 0) ? state.me.draft : state.me?.answer;
        restoredRound.current = state.round; answerRef.current = latest?.text || ''; setAnswer(answerRef.current); revision.current = latest?.revision || 0;
        setDraftStatus(latest ? 'saved' : 'idle'); closingSent.current = null;
      } else revision.current = Math.max(revision.current, state.me?.answer?.revision || 0, state.me?.draft?.revision || 0);
    }
    api(`/${session.code}`, null, session).then(update).catch(e => { if (!disposed) setError(e.message); });
    const source = new EventSource(`/api/rooms/${session.code}/events?token=${encodeURIComponent(session.token)}`);
    source.onmessage = event => update(JSON.parse(event.data));
    source.onerror = () => setConnected(false);
    return () => { disposed = true; source.close(); };
  }, [session]);
  useEffect(() => {
    if (!session || host || room?.phase !== 'answering') return;
    const latest = (room.me?.draft?.revision || 0) > (room.me?.answer?.revision || 0) ? room.me.draft : room.me?.answer;
    if (answer === (latest?.text || '')) return;
    setDraftStatus('pending');
    const round = room.round;
    const timer = setTimeout(() => {
      api(`/${session.code}/draft`, { text: answer, revision: ++revision.current, round }, session).then(state => {
        acceptRoom(state);
        if (answerRef.current === answer && roomRef.current?.round === round) setDraftStatus('saved');
      }).catch(() => { if (roomRef.current?.phase === 'answering' && roomRef.current?.round === round) setDraftStatus('error'); });
    }, 300);
    return () => clearTimeout(timer);
  }, [answer, session, host, room?.phase, room?.round]);
  useEffect(() => {
    if (!session || host || room?.phase !== 'closing') return;
    const key = `${session.code}:${room.round}:${room.closingDeadline}`;
    if (closingSent.current === key) return;
    closingSent.current = key;
    api(`/${session.code}/draft`, { text: answerRef.current, revision: ++revision.current, round: room.round, final: true }, session).then(state => {
      acceptRoom(state); setDraftStatus('saved');
    }).catch(() => { closingSent.current = null; });
  }, [session, host, room?.phase, room?.round, room?.closingDeadline, connected]);
  useEffect(() => { if (joinUrl) QRCode.toDataURL(joinUrl, { margin: 2, width: 240, color: { dark: '#171b2a', light: '#ffffff' } }).then(setQr).catch(() => setQr('')); }, [joinUrl]);
  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message || '操作失敗，請稍後再試。'); } finally { setBusy(false); }
  }
  function remember(result, role) { const s = { ...result, role }; persistSession(s); setSession(s); setShareBase(result.joinBaseUrl || location.origin); }
  const create = () => run(async () => remember(await api('', { duration }), 'host'));
  const join = e => { e.preventDefault(); run(async () => remember(await api(`/${code}/join`, { name }), 'player')); };
  const command = (action, options = {}) => run(async () => acceptRoom(await api(`/${room.code}/command`, { action, ...options }, session)));
  const submit = e => { e.preventDefault(); run(async () => { const state = await api(`/${room.code}/answer`, { text: answer, revision: ++revision.current, round: room.round }, session); acceptRoom(state); setDraftStatus('saved'); }); };
  function leave() { persistSession(null); setSession(null); setRoom(null); roomRef.current = null; restoredRound.current = null; answerRef.current = ''; closingSent.current = null; setError(''); setConnected(false); }
  const remaining = Math.min(room?.duration || 120, Math.max(0, Math.ceil(((room?.deadline || 0) - now - offset) / 1000)));
  const phase = room?.phase;
  const reveal = ['revealed', 'results', 'finished'].includes(phase);
  const rankings = [...(room?.players || [])].sort((a, b) => b.total - a.total);
  const me = room?.players.find(p => p.id === room.me?.id);
  const savedAnswer = room?.me?.answer?.text;

  return <div className={`app ${host ? 'host' : 'player'}`}>
    <header className="topbar"><a href="/" className="brand" onClick={e => { if (session) e.preventDefault(); }}><span className="brand-icon">♫</span> 接著唱<span className="brand-en">SONG PARTY</span></a><div className="top-right">{session ? <><span className={`connection ${connected ? 'online' : ''}`}><i/>{connected ? '即時連線中' : '重新連線中'}</span><>{host && <a className="text-button" href={`/control#${encodeURIComponent(JSON.stringify(session))}`} target="_blank" rel="noreferrer">房間控制台 ↗</a>}</><button className="text-button" onClick={leave}>{host ? '離開控制台' : '離開房間'}</button></> : <span className="tag">聚會的下一首，交給你</span>}</div></header>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="關閉訊息">×</button></div>}
    {!session ? <main className="landing">
      <section className="intro"><div className="eyebrow"><span/> 把副歌留給朋友</div><h1>歌停了，<br/>換你<span>接著唱。</span></h1><p className="intro-description">熟悉的旋律，不一定記得的下一句。<br/>拿起手機，把腦海裡的歌詞填進來。</p><div className="visual-lyrics"><span className="note">♪</span><div className="mini-bars">{[16,32,24,45,64,39,27,50,32,17,29,44,22].map((h,i) => <i key={i} style={{height:h}}/>)}</div><div className="preview-boxes">{'接著唱'.split('').map((x,i) => <span key={i}>{x}</span>)}<span className="empty-box">?</span></div><div className="visual-caption">下一句，你一定會？</div></div><div className="features"><span>✦ 掃碼即玩</span><span>✦ 不用下載</span><span>✦ 最多 30 人</span></div></section>
      <section className="entry"><div className="join-card"><span className="eyebrow muted">LET’S PLAY</span><h2>加入朋友的房間</h2><p>輸入電視上的房間碼，準備接招。</p><form onSubmit={join}><label htmlFor="code">房間碼</label><input id="code" className="code-input" placeholder="6 位數字" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g,''))}/><label htmlFor="name">隊名／暱稱</label><input id="name" placeholder="例如：不會忘詞隊" maxLength={16} required value={name} onChange={e => setName(e.target.value)}/><button className="primary wide" disabled={busy}>{busy ? '連線中…' : '加入遊戲'} <span>↗</span></button></form></div><div className="host-entry"><div><h3>今晚由你主持？</h3><p>電腦接上電視，開一間自己的房間。</p></div><div className="host-options"><select aria-label="每題作答時間" value={duration} onChange={e => setDuration(Number(e.target.value))}>{[120,180,300].map(t => <option key={t} value={t}>{t / 60} 分鐘／題</option>)}</select><button className="secondary" disabled={busy} onClick={create}>建立房間 →</button></div></div></section>
    </main> : !room ? <main className="loading"><div className="disc">♫</div><h2>正在找回你的房間…</h2><button className="secondary" onClick={leave}>回到首頁</button></main> : <main className="game-main">
      <div className="game-heading"><div><div className="eyebrow muted">{host ? '大螢幕 · 主持人' : `玩家 · ${me?.name || ''}`}</div><h1>{labels[phase]}</h1></div><div className="room-badge"><span>房間碼</span><strong>{room.code}</strong></div></div>
      {phase === 'lobby' ? <div className="lobby-grid"><section className="panel invite-panel"><div className="section-label">01 / 集合朋友</div>{host ? <><h2>掃一下，就入場。</h2><div className="qr-wrap">{qr && <img src={qr} alt="掃描 QR Code 加入房間"/>}</div><p className="large-code">{room.code}</p><InviteLink url={joinUrl}/>{/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(shareBase) && <div className="local-note"><strong>手機加入前，改用電腦的區網網址</strong><p>在電腦開啟啟動訊息中的 Wi-Fi 網址，或填入下方。手機與電腦需連同一個 Wi-Fi。</p><input aria-label="電腦區網網址" value={shareBase} onChange={e => setShareBase(e.target.value)}/></div>}</> : <><div className="disc">♫</div><h2>{me?.name}，準備好了！</h2><p>看著電視、聽主持人播歌。<br/>遊戲開始後，這裡會出現歌詞格子。</p><div className="waiting"><i/> 等待主持人開始</div></>}</section><section className="panel players-panel"><div className="section-label">02 / 今晚的陣容 <span>{room.players.length} / 30</span></div><h2>麥克風交給各位</h2><div className="player-list">{room.players.map((p,i) => <div className="player-row" key={p.id}><span className={`avatar color-${i%4}`}>{Array.from(p.name)[0]}</span><strong>{p.name}</strong><span className="ready">準備好了</span></div>)}{!room.players.length && <div className="empty-state">第一位歌詞王，會是誰？<br/><small>請朋友掃描左邊的 QR Code。</small></div>}</div><div className="rules"><strong>今晚的規則</strong><p>每題自訂配分 · 作答時間 {room.duration / 60} 分鐘<br/>繁簡、標點、空格與指定字組不扣分 · 其他同音錯字扣分<br/>截止前可修改 · 不比速度</p><small>本場題庫：{room.totalRounds} 題</small></div>{host && <button className="primary wide" disabled={busy || !room.players.length || !connected} onClick={() => command('start')}>大家到齊，開始遊戲 <span>→</span></button>}</section></div> : phase === 'results' ? <RoundResults room={room} host={host} busy={busy} connected={connected} onNext={() => command('next')}/>  : <div className={`round-grid ${host ? 'tv-grid' : ''} ${phase === 'revealed' ? 'reveal-only' : ''}`}>
        <section className="panel question-panel"><div className="question-meta"><span>{room.question.practice ? "試玩" : `第 ${room.songNumber} 首歌`} {!room.question.practice && <small>/ 共 {room.totalSongs} 首</small>}</span><span className={`points ${room.question.points===20 ? 'hard' : ''}`}>{room.question.points} 分題</span></div>
          {phase === 'finished' ? <div className="winner"><div className="trophy">♛</div><span className="eyebrow">TONIGHT’S CHAMPION</span><h2>{rankings.filter(p => p.total === rankings[0]?.total).map(p => p.name).join('、')}</h2><p>{rankings[0]?.total || 0} 分 · 今晚的歌詞王</p><button className="primary" onClick={leave}>回到首頁</button></div> : reveal ? <><span className="eyebrow muted">正確歌詞</span><h2 className="song-title">{room.question.title} <small>{room.question.artist}</small></h2><div className="revealed-lyrics">{room.question.lines.map((line,i) => <div key={i}>{line}</div>)}</div>{host && room.question.playback && <YouTubeClip clip={room.question.playback} autoPlay/>}</> : phase === 'playing' ? <div className="listening"><div className="disc">♫</div><h2>仔細聽，準備接著唱。</h2><p>聽完提示片段，再把下一句填進手機。</p><div className="prompt-grid-preview"><span className="section-label">本題歌詞 · {room.question.lengths.map(n => `${n} 字`).join("、")}</span><Lyrics layout={room.question.layout} lengths={room.question.lengths}/><p className="center muted">先看格數與標點，主持人開始作答後即可輸入。</p></div>{host && <div className="manual-prompt-note"><AnswerDuration duration={room.duration} disabled={busy || !connected} onChange={duration => command('duration', { duration })}/><p>請在主持人電腦的題庫管理頁播放提示片段。<br/>片段結束後，按下方按鈕開放作答。</p></div>}</div> : <><div className="answer-heading"><div><span className="eyebrow muted">{room.question.cue}</span><h2>{room.question.prompt}</h2></div>{phase === 'answering' && <div className={`timer ${remaining<=10 ? 'urgent' : ''}`}><strong>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</strong><span>{remaining === 0 ? "作答已截止" : "剩餘時間"}</span></div>}</div>{phase === 'answering' && remaining === 0 && <p className="overtime-note" role="status">倒數已結束，作答已截止。系統正在收取答案，請等待主持人揭曉。</p>}{phase === 'closing' && <p className="collecting-note" role="status">正在收取各隊輸入框的最新內容… 已收取 {room.collected}／{room.players.length} 隊，請稍候。</p>}<div className="progress-track"><div style={{width:`${phase==='answering' ? remaining/room.duration*100 : 0}%`}}/></div>{host ? <><Lyrics layout={room.question.layout} lengths={room.question.lengths}/><p className="center muted">答案填在你的手機上</p></> : <form onSubmit={submit}><Lyrics layout={room.question.layout} lengths={room.question.lengths} answer={answer}/><label htmlFor="answer">連續輸入歌詞即可，不用逐格點選</label><p className={`draft-status ${draftStatus}`} role="status">{draftStatus === "pending" ? "正在同步草稿…" : draftStatus === "saved" ? "草稿已暫存，截止時會自動提交最新內容 ✓" : draftStatus === "error" ? "草稿同步失敗，請確認連線或按提交重試。" : "輸入內容會自動暫存。"}</p><textarea id="answer" placeholder="把腦海裡的下一句填進來…" value={answer} maxLength={300} disabled={phase!=='answering' || remaining === 0} onChange={e => { answerRef.current = e.target.value; setAnswer(e.target.value); }} rows={3}/><button className="primary wide" disabled={busy || !connected || phase!=='answering' || remaining === 0 || !answer.trim()}>{busy ? '提交中…' : savedAnswer === answer && savedAnswer ? '已儲存答案 ✓' : savedAnswer !== undefined ? '更新答案 →' : '提交答案 →'}</button><p className="answer-status" role="status">{phase==='closing' ? '正在自動提交輸入框中的最新內容…' : phase==='locked' ? '作答已截止，等待主持人揭曉。' : savedAnswer !== undefined ? savedAnswer===answer ? '截止前仍可修改，修改後請再次提交。' : '有尚未提交的修改。' : '可先按提交；未提交內容會在主持人截止時自動提交。'}</p></form>}</>}
          {host && phase !== 'finished' && <div className="host-controls">{phase==='playing' && <button className="primary wide" disabled={busy || !connected} onClick={() => command('answer')}>提示播完，開始作答 <span>→</span></button>}{phase==='answering' && <button className="primary wide" disabled={busy || !connected} onClick={() => command('close')}>截止並揭曉答案 <span>→</span></button>}{phase==='locked' && <button className="primary wide" disabled={busy || !connected} onClick={() => command('reveal')}>揭曉答案 <span>✦</span></button>}{phase==='revealed' && <button className="primary wide" disabled={busy || !connected} onClick={() => command('results')}>查看各隊答案 <span>→</span></button>}</div>}
        </section>{phase !== 'revealed' && <aside className="panel standings"><div className="section-label">LIVE SCOREBOARD</div><h2>{reveal ? '本題戰況' : '今晚的排行榜'}</h2>{['answering','closing','locked'].includes(phase) && <div className="submission-count"><strong>{room.submitted}<small> / {room.players.length}</small></strong><span>人已提交</span></div>}<div className="ranking-list">{rankings.map((p,i) => <div className={`rank-row ${p.id===me?.id ? 'is-me' : ''}`} key={p.id}><span className="rank-number">{i && p.total===rankings[i-1].total ? rankings.findIndex(x=>x.total===p.total)+1 : i+1}</span><div className="rank-name"><strong>{p.name}{p.id===me?.id ? '（你）' : ''}</strong><small>{reveal && p.result ? `本題 +${p.result.points.toFixed(1)} 分 · ${p.result.errors} 字錯誤` : p.submitted ? '已提交 ✓' : '準備接著唱'}</small></div><strong className="score">{p.total.toFixed(1)}</strong></div>)}</div><div className="small-rules">每題自訂配分，按錯字比例扣分。指定字組視為相同，試玩題不列入總分。<br/>漏字、多字、錯字各算一個錯誤。</div></aside>}
      </div>}
    </main>}
    <footer><span>接著唱 · 好朋友，好歌，好像忘詞了。</span><span className="design-credit">Designed by Vincent Chung</span><span>PARTY MODE / ON <i/></span></footer>
  </div>;
}
function Lyrics({ lengths, layout, answer = '' }) {
  const chars = Array.from(answer.normalize('NFKC').replace(/[\p{P}\p{Z}\p{C}\s]/gu, ''));
  const rows = layout || lengths.map(length => Array.from({ length }, () => ({ type: 'slot' })));
  const overflow = chars.slice(lengths.reduce((sum, length) => sum + length, 0));
  let offset = 0;
  return <div className="lyrics-grid" aria-label={`歌詞共 ${lengths.join('、')} 字，標點與空格為提示`}>
    {rows.map((tokens, row) => <div className="lyrics-row" key={row}>{tokens.map((token, i) => {
      if (token.type !== 'slot') return <span className={`lyric-format ${token.type}`} key={i}>{token.text}</span>;
      const char = chars[offset++];
      return <span className={`letter ${char ? 'filled' : ''}`} key={i}>{char || <i/>}</span>;
    })}{row === rows.length - 1 && overflow.map((char, i) => <span className="letter overflow-letter" aria-label={`超出字數：${char}`} key={`overflow-${i}`}>{char}</span>)}</div>)}
    {overflow.length > 0 && <p className="overflow-note">灰色文字為超出格數的內容，仍會提交並計入多字扣分。</p>}
  </div>;
}


class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="boot"><h1>接著唱 ♫</h1><p>畫面載入遇到問題，請重新進入。</p><small>{this.state.error.message}</small><button onClick={() => { persistSession(null); location.reload(); }}>重新進入遊戲</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<ErrorBoundary>{location.pathname.replace(/\/$/, '') === '/admin' ? <QuestionEditor/> : location.pathname.replace(/\/$/, '') === '/control' ? <RoomControl/> : <App/>}</ErrorBoundary>);
