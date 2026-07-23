const https = require('https');
const http = require('http');

// In-memory store: token -> {endTime, name, timeoutId}
const timers = {};

// Apple Push Notification via Web Push is not available server-side without certs
// Instead we use a simple polling approach:
// - App registers a timer with endTime
// - App polls /check/:token when it comes back to foreground
// - Server sends SSE push when timer fires (works when app is open)
// - For true background: server fires a fetch to our endpoint that triggers notification

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// SSE clients: token -> res
const sseClients = {};

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost`);
  const parts = url.pathname.split('/').filter(Boolean);

  // POST /schedule  body: {token, delayMs, name}
  if (req.method === 'POST' && parts[0] === 'schedule') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { token, delayMs, name } = JSON.parse(body);
        if (!token || !delayMs) { res.writeHead(400); res.end('Bad request'); return; }

        // Clear existing timer for this token
        if (timers[token]) {
          clearTimeout(timers[token].timeoutId);
          delete timers[token];
        }

        const delay = Math.min(Math.max(parseInt(delayMs), 1000), 600000); // 1s–10min
        const endTime = Date.now() + delay;

        const timeoutId = setTimeout(() => {
          // Notify via SSE if client is connected
          if (sseClients[token]) {
            try {
              sseClients[token].write(`data: ${JSON.stringify({ type: 'DONE', name })}\n\n`);
            } catch(e) {}
          }
          // Mark as fired
          if (timers[token]) timers[token].fired = true;
        }, delay);

        timers[token] = { endTime, name: name || 'exercise', timeoutId, fired: false };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, endTime }));
      } catch(e) {
        res.writeHead(400); res.end('Bad request');
      }
    });
    return;
  }

  // DELETE /cancel/:token
  if (req.method === 'DELETE' && parts[0] === 'cancel' && parts[1]) {
    const token = parts[1];
    if (timers[token]) { clearTimeout(timers[token].timeoutId); delete timers[token]; }
    res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /check/:token  — returns remaining ms or fired status
  if (req.method === 'GET' && parts[0] === 'check' && parts[1]) {
    const token = parts[1];
    const t = timers[token];
    if (!t) { res.writeHead(200); res.end(JSON.stringify({ found: false })); return; }
    const remaining = Math.max(0, t.endTime - Date.now());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: true, remaining, fired: t.fired, name: t.name }));
    return;
  }

  // GET /events/:token  — SSE stream for real-time notification
  if (req.method === 'GET' && parts[0] === 'events' && parts[1]) {
    const token = parts[1];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients[token] = res;

    // If already fired, notify immediately
    if (timers[token]?.fired) {
      res.write(`data: ${JSON.stringify({ type: 'DONE', name: timers[token].name })}\n\n`);
    }

    req.on('close', () => { delete sseClients[token]; });
    return;
  }

  // GET /health
  if (parts[0] === 'health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, timers: Object.keys(timers).length }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Training push server running on port ${PORT}`));
