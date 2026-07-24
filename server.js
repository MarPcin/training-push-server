const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// In-memory: topic -> timeoutId
const ntfyTimers = {};

function sendNtfy(topic, name) {
  const payload = JSON.stringify({
    topic,
    title: '\u23f1 Rest done!',
    message: 'Time to get back to ' + name + ' \u2014 next set!',
    priority: 4,
    tags: ['muscle']
  });

  const options = {
    hostname: 'ntfy.sh',
    port: 443,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, res => {
    console.log('ntfy response:', res.statusCode);
  });
  req.on('error', e => console.error('ntfy error:', e.message));
  req.write(payload);
  req.end();
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  // POST /schedule-ntfy  body: {delayMs, topic, name}
  if (req.method === 'POST' && parts[0] === 'schedule-ntfy') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { delayMs, topic, name } = JSON.parse(body);
        if (!topic || !delayMs) { res.writeHead(400); res.end('Bad request'); return; }

        // Cancel existing timer for this topic
        if (ntfyTimers[topic]) { clearTimeout(ntfyTimers[topic]); delete ntfyTimers[topic]; }

        const delay = Math.min(Math.max(parseInt(delayMs), 1000), 600000);
        ntfyTimers[topic] = setTimeout(() => {
          delete ntfyTimers[topic];
          sendNtfy(topic, name || 'exercise');
        }, delay);

        console.log(`Scheduled ntfy for topic ${topic} in ${delay}ms`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, delay }));
      } catch(e) {
        res.writeHead(400); res.end('Bad request');
      }
    });
    return;
  }

  // POST /cancel-ntfy  body: {topic}
  if (req.method === 'POST' && parts[0] === 'cancel-ntfy') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { topic } = JSON.parse(body);
        if (ntfyTimers[topic]) { clearTimeout(ntfyTimers[topic]); delete ntfyTimers[topic]; }
        console.log(`Cancelled ntfy for topic ${topic}`);
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400); res.end('Bad request');
      }
    });
    return;
  }

  // GET /health
  if (parts[0] === 'health' || parts.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pending: Object.keys(ntfyTimers).length }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Training push server on port ${PORT}`));
