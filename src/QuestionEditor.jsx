import React, { useEffect, useRef, useState } from 'react';
import YouTubeClip from './YouTubeClip.jsx';
import { toEditor, fromEditor, editorClip, lyricLength } from './question-utils.js';
import { createLyricLayout } from '../shared/lyric-layout.js';
import { songPosition } from '../shared/song-position.js';
import './editor.css';

const newId = () => `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export default function QuestionEditor() {
  const savedItems = useRef(new Map());
  const [bank, setBank] = useState([]), [version, setVersion] = useState(''), [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState(null), [confirmReload, setConfirmReload] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null), [removed, setRemoved] = useState(null);
  const q = bank.find(item => item.id === selected);
  const active = bank.filter(item => item.enabled).length;
  const positionLabel = index => bank[index].practice ? '試玩' : bank[index].enabled ? `第 ${songPosition(bank, index, { enabledOnly: true }).songNumber} 首歌` : '未啟用';

  async function load() {
    setBusy(true); setError(''); setConfirmReload(false);
    try {
      const response = await fetch('/api/question-bank'); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      savedItems.current = new Map(data.bank.map(item => [item.id, JSON.stringify(toEditor(item))]));
      setBank(data.bank.map(toEditor)); setVersion(data.version); setSelected(data.bank[0]?.id || '');
      setDirty(false); setLoaded(true); setPreview(null); setNotice(''); setPendingDelete(null); setRemoved(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function change(patch) {
    setBank(items => items.map(item => item.id === selected ? { ...item, ...patch } : item));
    setDirty(true); setNotice(''); setPreview(null);
  }
  function add(copy) {
    const item = copy ? { ...structuredClone(copy), id: newId(), title: `${copy.title || '未命名歌曲'}（副本）`, enabled: false } : toEditor({ id: newId(), enabled: false, title: '', artist: '', points: 10, prompt: '接出接下來的歌詞', cue: '請接出影片暫停後的歌詞', videoId: '', lines: [''] });
    setBank(items => [...items, item]); setSelected(item.id); setDirty(true); setPreview(null); setNotice('');
  }
  function move(index, direction) {
    setBank(items => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
    setDirty(true); setNotice('');
  }
  function removeQuestion() {
    const index = bank.findIndex(item => item.id === pendingDelete?.id);
    if (index < 0) { setPendingDelete(null); return; }
    const next = bank.filter(item => item.id !== pendingDelete.id);
    setRemoved({ question: bank[index], index });
    setBank(next);
    if (selected === pendingDelete.id) setSelected(next[Math.min(index, next.length - 1)]?.id || '');
    setPendingDelete(null); setPreview(null); setDirty(true); setError('');
    setNotice('題目已從列表移除；按「儲存題庫」才會寫入檔案。');
  }
  function undoRemove() {
    if (!removed) return;
    const next = [...bank]; next.splice(Math.min(removed.index, next.length), 0, removed.question);
    setBank(next); setSelected(removed.question.id); setRemoved(null); setDirty(true); setNotice('已復原刪除，請儲存題庫。'); setPreview(null);
  }
  function deleteDialogKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); setPendingDelete(null); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const clean = bank.map((item, index) => { try {
        const unchangedLegacy = !item.enabled && !item._url.trim() && savedItems.current.get(item.id) === JSON.stringify(item);
        return fromEditor(item, { allowMissingVideo: unchangedLegacy });
      } catch (e) { throw new Error(`第 ${index + 1} 題「${item.title || '未命名'}」：${e.message}`); } });
      const response = await fetch('/api/question-bank', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Question-Editor': '1' }, body: JSON.stringify({ bank: clean, version }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      savedItems.current = new Map(data.bank.map(item => [item.id, JSON.stringify(toEditor(item))]));
      setBank(data.bank.map(toEditor)); setVersion(data.version); setDirty(false); setRemoved(null); setNotice('已儲存。可到房間控制台按「重新讀取題庫」，再將歌曲加入目前房間。');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function play(kind) {
    try { const clip = editorClip(q, kind); setPreview({ ...clip, key: Date.now() }); setError(''); }
    catch (e) { setError(e.message); }
  }

  return <div className="app editor-app"><header className="topbar"><a className="brand" href="/" target="_blank" rel="noreferrer"><span className="brand-icon">♫</span>接著唱<span className="brand-en">QUESTION STUDIO</span></a><a className="text-button" href="/control">目前房間控制台 →</a><span className="editor-private">● 僅限本機電腦</span></header>
    <main className="editor-main"><div className="editor-title"><div><span className="eyebrow muted">BEHIND THE NEXT VERSE</span><h1>準備今晚的好歌。</h1><p>選片段、填歌詞，把下一句留給朋友。</p></div><div className="editor-tools"><span className={dirty ? 'unsaved' : 'muted'}>{dirty ? '● 有未儲存的變更' : '所有變更已儲存'}</span><button className="secondary" disabled={busy} onClick={() => dirty ? setConfirmReload(true) : load()}>重新載入</button><button className="primary" form="question-form" disabled={busy || !loaded || !dirty}>{busy ? '處理中…' : '儲存題庫 ✓'}</button></div></div>
      {error && <div className="error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="關閉錯誤">×</button></div>}
      {notice && <div className="editor-notice" role="status">{notice}{removed && <button type="button" className="text-button undo-delete" onClick={undoRemove}>復原刪除 ↶</button>}</div>}
      {pendingDelete && <div className="delete-backdrop"><section className="delete-dialog panel" role="dialog" aria-modal="true" aria-labelledby="delete-title" onKeyDown={deleteDialogKey}><h2 id="delete-title">刪除這道題目？</h2><p>「{pendingDelete.title || '未命名歌曲'}」會從題庫列表移除。<br/>按「儲存題庫」後才會寫入檔案，已建立的房間不受影響。</p><div><button autoFocus type="button" className="secondary" onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="danger-button" onClick={removeQuestion}>確認刪除</button></div></section></div>}
      {confirmReload && <div className="editor-confirm" role="alert"><span>重新載入會捨棄尚未儲存的變更。</span><button className="secondary" onClick={() => setConfirmReload(false)}>繼續編輯</button><button className="secondary" onClick={load}>捨棄並載入</button></div>}
      {!loaded ? <section className="panel"><h2>{busy ? '讀取題庫中…' : '無法讀取題庫'}</h2><p>請在主持人電腦使用 <a href={`http://localhost:${location.port || 3000}/admin`}>localhost 題庫管理頁面</a>。</p></section> : <div className="editor-layout"><aside className="panel bank-list"><div className="section-label">TONIGHT’S SETLIST <span>{active} 題啟用 / {bank.length} 題</span></div><button className="secondary wide" onClick={() => add()}>新增題目 <span>＋</span></button><div className="bank-items">{bank.map((item, index) => <div className={`bank-item ${selected === item.id ? 'selected' : ''}`} key={item.id}><button className="bank-select" onClick={() => { setSelected(item.id); setPreview(null); }}><span className="bank-index">{positionLabel(index)}</span><span><strong>{item.title || '未命名歌曲'}</strong><small>{item.points} 分{item.practice ? " · 試玩" : ""} · {item.enabled ? '已啟用' : '停用／草稿'}</small></span></button><div className="reorder"><button aria-label={`上移第 ${index + 1} 題`} disabled={index === 0 || busy} onClick={() => move(index, -1)}>↑</button><button aria-label={`下移第 ${index + 1} 題`} disabled={index === bank.length - 1 || busy} onClick={() => move(index, 1)}>↓</button></div></div>)}</div><p className="editor-footnote">啟用的題目依列表順序出題。<br/>這裡會顯示答案，請不要投到電視。</p></aside>
        <form id="question-form" className="panel edit-form" onSubmit={save}>{!q && <div className="empty-state"><h2>題庫目前沒有題目</h2><p>新增一道好歌，就能開始準備下一場聚會。<br/>開房前需要至少一題已啟用的題目。</p><button type="button" className="secondary" onClick={() => add()}>新增題目 ＋</button></div>}{q && <><fieldset disabled={busy}><div className="editor-form-heading"><div><span className="eyebrow muted">{positionLabel(bank.findIndex(item => item.id === selected))}</span><h2>{q.title || '新的好歌'}</h2></div><div className="question-actions"><button type="button" className="secondary" onClick={() => add(q)}>複製這題</button><button type="button" className="danger-button" onClick={() => setPendingDelete({ id: q.id, title: q.title })}>刪除這題</button></div></div>
          <div className="field-row"><div><label htmlFor="song-title">歌曲名稱</label><input id="song-title" value={q.title || ''} maxLength={100} onChange={e => change({ title: e.target.value })} placeholder="例如：天涯"/></div><div><label htmlFor="song-artist">歌手</label><input id="song-artist" value={q.artist || ''} maxLength={100} onChange={e => change({ artist: e.target.value })} placeholder="例如：任賢齊"/></div></div>
          <div className="field-row compact-fields score-settings"><div><label htmlFor="song-points">本題滿分</label><input id="song-points" type="number" inputMode="decimal" min="0.1" max="1000000" step="0.1" value={q.points} onChange={e => change({ points: e.target.value })}/><small className="points-help">自訂分數，最多一位小數</small></div><label className="enable-switch"><input type="checkbox" checked={q.practice === true} onChange={e => change({ practice: e.target.checked })}/><span>試玩題<small>照常計分，不加入隊伍總分</small></span></label><label className="enable-switch"><input type="checkbox" checked={q.enabled} onChange={e => change({ enabled: e.target.checked })}/><span>加入今晚題庫<small>停用後保留內容</small></span></label></div>
          <section className="edit-section"><h3>01 / 選擇歌曲與片段</h3><label htmlFor="video-url">YouTube 連結（必填）</label><input required id="video-url" value={q._url} onChange={e => change({ _url: e.target.value })} placeholder="貼上完整 YouTube 網址，不用找影片 ID"/><p className="field-help">新增或編輯歌曲時必須填寫 YouTube 連結。影片是否允許內嵌，請用下方試播確認。</p>
            <div className="clip-fields"><TimeFields title="提示片段" start={q._qs} end={q._qe} onStart={value => change({ _qs: value })} onEnd={value => change({ _qe: value })} onPlay={() => play('question')}/><TimeFields title="答案片段" start={q._as} end={q._ae} onStart={value => change({ _as: value })} onEnd={value => change({ _ae: value })} onPlay={() => play('answer')}/></div>
            {preview && <div className="editor-preview"><div className="preview-label"><strong>片段試播 · 不會開啟遊戲倒數</strong><button type="button" className="text-button" onClick={() => setPreview(null)}>關閉試播 ×</button></div><YouTubeClip key={preview.key} clip={preview}/></div>}
          </section>
          <section className="edit-section"><h3>02 / 填入正確歌詞</h3><label htmlFor="correct-lyrics">正確歌詞（每行一句）</label><textarea id="correct-lyrics" rows={5} value={q.lines.join("\n")} placeholder={"輸入第一句歌詞\n按 Enter 輸入下一句"} onChange={e => change({ lines: e.target.value.split(/\r\n|\r|\n/) })}/><p className="field-help">按 Enter 換行就是下一句，不用設定句數；儲存時會忽略空白行。每句最多 50 字，全部歌詞含標點及空格最多 300 字元。</p><div className="grid-preview"><span className="section-label">玩家看到的格數</span>{q.lines.map((line, i) => <div className="editor-grid" key={i}>{createLyricLayout([line])[0].map((token, j) => token.type === 'slot' ? <span key={j}>·</span> : <span className={`lyric-format ${token.type}`} key={j}>{token.text}</span>)}{!lyricLength(line) && <small>填入第 {i + 1} 句歌詞後顯示格子</small>}</div>)}</div><p className="field-help">標點與空格會顯示給玩家作為提示，不占格數、不影響判分；繁簡及指定字組（你／妳、他／她／它／牠、的／地／得、啊／阿、嗯／恩、喔／哦／噢）視為相同，其他同音錯字仍扣分。</p></section>
          <section className="edit-section"><h3>03 / 玩家看到的提示</h3><label htmlFor="song-prompt">題目文字</label><input id="song-prompt" value={q.prompt || ''} maxLength={100} onChange={e => change({ prompt: e.target.value })}/><label htmlFor="song-cue">公開提示</label><input id="song-cue" value={q.cue || ''} maxLength={200} onChange={e => change({ cue: e.target.value })}/><p className="field-help">歌名與歌手在揭曉後才顯示；這段提示會在答題前公開，不要填答案。</p></section>
          <div className="editor-save-bottom"><span>儲存後的新房間立即生效，無需重啟。</span><button className="primary" disabled={!dirty || busy}>儲存題庫 ✓</button></div>
        </fieldset></>}</form></div>}
    </main><footer><span>接著唱 · 題庫管理</span><span className="design-credit">Designed by Vincent Chung</span><span>GOOD SONGS START HERE</span></footer></div>;
}

function TimeFields({ title, start, end, onStart, onEnd, onPlay }) {
  return <div className="time-card"><div><strong>{title}</strong><button type="button" className="text-button" onClick={onPlay}>試播 ▶</button></div><div className="field-row"><div><label htmlFor={`${title}-start`}>開始時間</label><input id={`${title}-start`} value={start} placeholder="0:45" onChange={e => onStart(e.target.value)}/></div><div><label htmlFor={`${title}-end`}>結束時間</label><input id={`${title}-end`} value={end} placeholder="1:19" onChange={e => onEnd(e.target.value)}/></div></div><small>分:秒，例如 1:19；也可填 79</small></div>;
}
