import React, { useEffect, useRef, useState } from 'react';

let apiPromise;
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => reject(new Error('YouTube 載入逾時，請確認網路連線。')), 15000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      try { previousReady?.(); } finally { resolve(window.YT); }
    };
    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
    script.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('無法載入 YouTube 播放器，請確認網路或內容封鎖設定。')); }, { once: true });
  }).catch(error => { apiPromise = null; throw error; });
  return apiPromise;
}

const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const errors = { 2: '影片參數無效。', 5: '瀏覽器無法播放這支影片。', 100: '影片不存在、已移除或設為私人。', 101: 'YouTube 拒絕了這次內嵌播放。若後台試播正常，請重新載入播放器再按播放。', 150: 'YouTube 拒絕了這次內嵌播放。若後台試播正常，請重新載入播放器再按播放。', 153: 'YouTube 無法辨識網頁來源，請以正常瀏覽器開啟遊戲網址。' };

export default function YouTubeClip({ clip, autoPlay = false, onEnded }) {
  const mount = useRef(null), player = useRef(null), onEndedRef = useRef(onEnded), completed = useRef(false), played = useRef(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0), [autoplayBlocked, setAutoplayBlocked] = useState(false);
  onEndedRef.current = onEnded;
  const { videoId, startSeconds, endSeconds, kind } = clip;

  useEffect(() => {
    let cancelled = false, instance, timer, readyTimeout, autoplayAttempted = false;
    completed.current = false; played.current = false; setError(''); setStatus('loading'); setReady(false); setAutoplayBlocked(false);
    function finish() {
      if (cancelled || completed.current || !played.current) return;
      completed.current = true;
      instance.pauseVideo();
      setStatus('ended');
      onEndedRef.current?.();
    }
    loadYouTubeAPI().then(YT => {
      if (cancelled) return;
      const element = document.createElement('div');
      mount.current.appendChild(element);
      readyTimeout = setTimeout(() => {
        if (!cancelled) { setError('YouTube 播放器沒有回應，請重新整理或在 YouTube 分頁開啟。'); setStatus('error'); }
      }, 15000);
      instance = new YT.Player(element, {
        width: '100%', height: '100%', videoId,
        playerVars: { playsinline: 1, origin: location.origin, rel: 0 },
        events: {
          onReady: () => {
            clearTimeout(readyTimeout);
            if (cancelled) return;
            player.current = instance;
            setReady(true); setStatus('ready'); setError('');
            const options = { videoId, startSeconds, endSeconds };
            // Prepare both admin previews and answer clips through the same path.
            // Start autoplay only after YouTube confirms that the bounded clip is cued.
            instance.cueVideoById(options);
          },
          onStateChange: event => {
            if (cancelled || completed.current) return;
            if (event.data === YT.PlayerState.CUED && autoPlay && !autoplayAttempted) { autoplayAttempted = true; instance.playVideo(); }
            if (event.data === YT.PlayerState.PLAYING) { played.current = true; setStatus('playing'); setError(''); setAutoplayBlocked(false); }
            if (event.data === YT.PlayerState.PAUSED) setStatus('paused');
            if (event.data === YT.PlayerState.ENDED && played.current) finish();
          },
          onAutoplayBlocked: () => { if (!cancelled) { setStatus('ready'); setAutoplayBlocked(true); } },
          onError: event => { clearTimeout(readyTimeout); if (!cancelled) { setError(`${errors[event.data] || 'YouTube 播放失敗。'}（錯誤 ${event.data}）`); setStatus('error'); } }
        }
      });
      // Check media time rather than wall time: buffering must not shorten the clip.
      timer = setInterval(() => {
        if (!cancelled && played.current && !completed.current && instance?.getPlayerState?.() === YT.PlayerState.PLAYING && instance.getCurrentTime() >= endSeconds) finish();
      }, 80);
    }).catch(e => { if (!cancelled) { setError(e.message); setStatus('error'); } });
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(readyTimeout);
      player.current = null;
      instance?.destroy();
    };
  }, [videoId, startSeconds, endSeconds, kind, autoPlay, attempt]);

  function play() {
    if (!player.current) return;
    completed.current = false; played.current = false; setError(''); setStatus('ready'); setAutoplayBlocked(false);
    player.current.loadVideoById({ videoId, startSeconds, endSeconds });
  }

  return <section className="clip-player" aria-label={kind === 'answer' ? '答案片段' : '題目片段'}>
    <div className="clip-heading"><strong>{kind === 'answer' ? '♫ 聽聽正確答案' : '♫ 聽歌，準備接下一句'}</strong><span>{time(startSeconds)}–{time(endSeconds)}</span></div>
    <div className="youtube-frame" ref={mount}/>
    {error && <p className="clip-error" role="alert">{error} 可在 YouTube 分頁手動播放，回到遊戲繼續操作。</p>}
    <div className="clip-actions"><button type="button" className="secondary" onClick={play} disabled={status === 'loading' || !ready}>{status === 'loading' ? '載入播放器…' : status === 'error' ? '重試播放 ▶' : status === 'playing' || status === 'ended' || status === 'paused' ? '從片段起點重播 ↺' : kind === 'answer' ? '播放答案片段 ▶' : '播放題目片段 ▶'}</button>{status === 'error' && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>重新載入播放器 ↻</button>}<a href={`https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`} target="_blank" rel="noreferrer">在 YouTube 開啟 ↗</a></div>
    <p className="clip-hint" role="status">{autoplayBlocked ? '瀏覽器未允許自動播放，請按上方播放按鈕。' : status === 'ended' ? onEnded ? '提示片段已結束，正在開放作答。' : '片段已結束，可按按鈕重播。' : onEnded ? '片段結束會自動開放作答；也可以由主持人手動開始。' : '請按播放按鈕試播，確認切點與嵌入是否正常。'}</p>
  </section>;
}
