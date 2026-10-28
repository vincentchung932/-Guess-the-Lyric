import React, { useEffect, useRef, useState } from 'react';

export default function InviteLink({ url }) {
  const [status, setStatus] = useState('idle');
  const manualInput = useRef(null);

  useEffect(() => { setStatus('idle'); }, [url]);
  useEffect(() => {
    if (status === 'manual') {
      manualInput.current?.focus();
      manualInput.current?.select();
    }
    if (status === 'copied') {
      const timeout = setTimeout(() => setStatus('idle'), 3000);
      return () => clearTimeout(timeout);
    }
  }, [status]);

  async function copy() {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setStatus('copied');
        return;
      } catch { /* A denied clipboard permission can still use the fallback. */ }
    }

    // LAN HTTP pages do not receive the modern Clipboard API.
    const previousFocus = document.activeElement;
    const field = document.createElement('textarea');
    field.value = url;
    field.readOnly = true;
    field.setAttribute('aria-label', '邀請連結');
    field.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
    document.body.appendChild(field);
    let copied = false;
    try {
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      copied = document.execCommand('copy');
    } catch { /* Display a selectable link if the browser also blocks this. */ }
    finally {
      field.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
    setStatus(copied ? 'copied' : 'manual');
  }

  return <div className="invite-link">
    <button className="text-button" onClick={copy}>{status === 'copied' ? '已複製連結 ✓' : '複製邀請連結 ↗'}</button>
    <span className="sr-only" role="status">{status === 'copied' ? '邀請連結已複製' : ''}</span>
    {status === 'manual' && <div className="manual-copy">
      <label htmlFor="invite-url" role="status">瀏覽器未允許自動複製，請複製下方連結：</label>
      <input id="invite-url" ref={manualInput} value={url} readOnly onFocus={e => e.target.select()} />
      <small>電腦按 Ctrl+C／⌘C，手機長按文字選擇「拷貝」。</small>
    </div>}
  </div>;
}
