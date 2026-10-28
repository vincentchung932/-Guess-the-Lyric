import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Game } from './game.js';
import { QuestionStore, isLocalEditorRequest } from './question-store.js';
import { invitationOrigin, lanUrls } from './network.js';

const game = new Game();
const questionStore = new QuestionStore();
const streams = new Map();
const production = process.argv.includes('--production');
const vite = production ? null : await (await import('vite')).createServer({ server: { middlewareMode: true, fs: { deny: ['**/server/**', '**/tests/**', '**/.env*', '**/README.md', '**/.git/**'] } }, appType: 'spa' });
const port = Number(process.env.PORT || 3000);
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const broadcast = room => {
  room.broadcastVersion = room.version;
  for (const stream of streams.get(room.code) || []) {
    stream.res.write(`data: ${JSON.stringify(game.snapshot(room, stream.actor))}\n\n`);
  }
};
async function readBody(req, maxLength = 4096) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > maxLength) throw new Error('請求內容過長。'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const limits = new Map();
function rateLimit(req) {
  const key = req.socket.remoteAddress; const now = Date.now();
  let entry = limits.get(key);
  if (!entry || now - entry.since > 60000) { entry = { since: now, count: 0 }; limits.set(key, entry); }
  if (++entry.count > 300) throw new Error('操作太頻繁，請稍後再試。');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    // Dev tooling must never expose backend source or the answer bank.
    let decoded;
    try { decoded = decodeURIComponent(url.pathname).replace(/\\/g, '/'); } catch { res.writeHead(400); return res.end(); }
    if (/(^|\/)(server|tests|\.git|\.env[^/]*)(\/|$)/i.test(decoded)) { res.writeHead(403); return res.end('Forbidden'); }
    if (vite) return vite.middlewares(req, res);
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const root = path.resolve('dist');
      const file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { res.writeHead(403); return res.end(); }
      let content;
      try { content = await readFile(file); } catch { content = await readFile(path.join(root, 'index.html')); }
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(content);
    } catch { res.writeHead(500); res.end('請先執行 npm run build。'); }
    return;
  }
  try {
    rateLimit(req);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new Error('不允許此來源。');
    if (url.pathname === '/api/question-bank') {
      if (!isLocalEditorRequest(req)) return send(res, 403, { error: '題庫管理僅限主持人電腦。請在電腦開啟 http://localhost:' + port + '/admin' });
      if (req.method === 'GET') return send(res, 200, questionStore.read());
      if (req.method === 'PUT') {
        if (req.headers['x-question-editor'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: '請使用題庫管理頁面儲存。' });
        const { bank, version } = await readBody(req, 1024 * 1024);
        return send(res, 200, questionStore.save(bank, version));
      }
      return send(res, 405, { error: '不支援的操作。' });
    }
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = await readBody(req);
      const duration = [120, 180, 300].includes(body.duration) ? body.duration : 120;
      const room = game.create(duration, questionStore.active()); return send(res, 201, { code: room.code, token: room.hostToken, joinBaseUrl: invitationOrigin(req.headers.host, port) });
    }
    const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|events|command|answer|draft))?$/);
    if (!match) return send(res, 404, { error: '找不到此功能。' });
    const room = game.get(match[1]); const action = match[2];
    if (action === 'join' && req.method === 'POST') {
      const { name } = await readBody(req); const player = game.join(room, name); broadcast(room);
      return send(res, 201, { code: room.code, token: player.token });
    }
    const auth = action === 'events' ? url.searchParams.get('token') : req.headers.authorization?.replace(/^Bearer /, '');
    const actor = game.actor(room, auth);
    if (action === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'Referrer-Policy': 'no-referrer' });
      res.write(`data: ${JSON.stringify(game.snapshot(room, actor))}\n\n`);
      const stream = { res, actor };
      if (!streams.has(room.code)) streams.set(room.code, new Set());
      streams.get(room.code).add(stream);
      req.on('close', () => { streams.get(room.code)?.delete(stream); }); return;
    }
    if (action === 'command' && req.method === 'POST') {
      if (!actor.host) throw new Error('只有主持人可以控制遊戲。');
      game.command(room, (await readBody(req)).action); broadcast(room);
      return send(res, 200, game.snapshot(room, actor));
    }
    if (action === 'answer' && req.method === 'POST') {
      if (!actor.player) throw new Error('請使用玩家身分作答。');
      const body = await readBody(req); game.submit(room, actor.player, body.text, body.revision, body.round); broadcast(room);
      return send(res, 200, game.snapshot(room, actor));
    }
    if (action === 'draft' && req.method === 'POST') {
      if (!actor.player) throw new Error('請使用玩家身分暫存答案。');
      const body = await readBody(req); game.saveDraft(room, actor.player, body.text, body.revision, body.round, body.final);
      if (body.final === true) broadcast(room);
      return send(res, 200, game.snapshot(room, actor));
    }
    if (!action && req.method === 'GET') return send(res, 200, game.snapshot(room, actor));
    send(res, 405, { error: '不支援的操作。' });
  } catch (error) { send(res, error.status || 400, { error: error.message || '操作失敗，請稍後再試。' }); }
});
setInterval(() => {
  for (const room of game.rooms.values()) {
    game.expire(room);
    if (room.broadcastVersion !== room.version) broadcast(room);
    else for (const stream of streams.get(room.code) || []) stream.res.write(': heartbeat\n\n');
    if (Date.now() - room.createdAt > 12 * 3600000) {
      for (const stream of streams.get(room.code) || []) stream.res.end();
      streams.delete(room.code); game.rooms.delete(room.code);
    }
  }
  for (const [key, entry] of limits) if (Date.now() - entry.since > 60000) limits.delete(key);
}, 1000).unref();
server.listen(port, '0.0.0.0', () => {
  console.log(`接著唱已啟動：http://localhost:${port}`);
  console.log(`題庫管理（僅電腦）：http://localhost:${port}/admin`);
  for (const url of lanUrls(port)) console.log(`手機同 Wi-Fi 加入：${url}`);
});
