#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ROUTE_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'route-map.json'), 'utf8'));
const WEB_DIR = path.join(ROOT, 'web');
const PORT = process.env.PORT || 3360;
const ORG = 'gk51295';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── In-memory data store for write operations ───────────────────────────
const memStore = {
  applicants: new Map(),
  vacancies: new Map(),
  tags: new Map(),
  nextId: { applicant: 90000000, vacancy: 500000, tag: 70000 },
};

// ── Session cookie (SPA expects auth) ───────────────────────────────────
app.use((req, res, next) => {
  if (!req.headers.cookie?.includes('session')) {
    res.setHeader('Set-Cookie', 'session=hf-clone-demo-token; Path=/; HttpOnly');
  }
  next();
});

// ── Auth ─────────────────────────────────────────────────────────────────
const TOKEN = 'hf-clone-demo-token';
app.post('/app/api/account/session', (req, res) => {
  const { email, password } = req.body;
  if (email && password) {
    res.json({ token: TOKEN, account: { id: 212636, email, org: ORG } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
app.get('/app/api/account/session', (req, res) => {
  res.json({ account: { id: 212636, email: 'demo@huntflow-clone.local', org: ORG } });
});

// ── Analytics stub (SPA telemetry) ──────────────────────────────────────
app.all('/analytics/event/*', (req, res) => res.status(200).json({ ok: true }));
app.all('/analytics/*', (req, res) => res.status(200).json({ ok: true }));

// ── Sentry stub (error tracking) ────────────────────────────────────────
app.all('/api/:version/envelope/', (req, res) => res.status(200).type('text/plain').send(''));

// ── Elixir widget (local) ───────────────────────────────────────────────
app.use('/elixir/api', express.static(path.join(WEB_DIR, 'api', 'uploads'), {
  setHeaders: (res, p) => {
    if (p.endsWith('.js')) res.set('Content-Type', 'application/javascript');
  }
}));
app.get('/elixir/api/uploads/:id', (req, res) => {
  const f = path.join(WEB_DIR, 'api', 'uploads', req.params.id);
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).json({ error: 'upload not found' });
});
app.all('/elixir/api/*', (req, res) => res.json({}));

// ── API routes from recorded data ───────────────────────────────────────
let apiCount = 0;
for (const [key, route] of Object.entries(ROUTE_MAP)) {
  const { method, path: apiPath, body, mimeType } = route;
  if (apiPath.includes('/account/session')) continue;

  const expressPath = '/app/api' + apiPath
    .replace(/\{id0\}/g, ':id0')
    .replace(/\{id1\}/g, ':id1')
    .replace(/\{id\}/g, ':id');

  const rewriteUrls = (str) => str
    .replace(/https:\/\/wss\.huntflow\.ru/g, 'ws://localhost:' + PORT)
    .replace(/https:\/\/huntflow\.ru/g, 'http://localhost:' + PORT)
    .replace(/wss:\/\/huntflow\.ru/g, 'ws://localhost:' + PORT)
    .replace(/https:\/\/elixir-widget\.huntflow\.ru/g, 'http://localhost:' + PORT + '/elixir')
    .replace(/wss:\/\/elixir-widget\.huntflow\.ru/g, 'ws://localhost:' + PORT + '/elixir')
    .replace(/https:\/\/sentry-new\.huntflow\.ru/g, 'http://localhost:' + PORT);

  let responseData;
  if (body && (mimeType || '').includes('json')) {
    try {
      const parsed = JSON.parse(body);
      responseData = JSON.parse(rewriteUrls(JSON.stringify(parsed)));
    } catch { responseData = body; }
  } else if (body && (mimeType || '').includes('javascript')) {
    responseData = rewriteUrls(body);
  } else {
    responseData = body || {};
  }

  const handler = (req, res) => {
    if (mimeType?.includes('javascript')) {
      res.set('Content-Type', 'application/javascript');
      res.send(responseData);
    } else {
      res.json(responseData);
    }
  };

  if (method === 'GET') app.get(expressPath, handler);
  else if (method === 'POST') app.post(expressPath, handler);
  apiCount++;
}

// ── Stub endpoints the SPA expects but we don't have ────────────────────
app.get('/app/api/my/:org/permissions.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__permissions = {};');
});
app.get('/app/api/my/:org/feature-flags.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__featureFlags = {};');
});
app.get('/app/api/my/:org/app_init_data.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__appInitData = {};');
});
app.get('/app/api/my/:org/settings.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__settings = {};');
});
app.get('/app/api/my/:org/license-info.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__licenseInfo = {};');
});
app.get('/app/api/my/:org/account-events.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__accountEvents = {};');
});
app.get('/app/api/account/tariffs.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send('window.__tariffs = {};');
});

// ── Ay-client endpoints (baseURL /my/:org without /app/api) ─────────────
app.get('/my/:org/member_settings', (req, res) => {
  res.json({ items: [
    { id: 'dashboard', value: true },
    { id: 'extension-number', value: null },
  ]});
});
app.get('/my/:org/member_applicants_view_settings', (req, res) => {
  res.json({ items: [] });
});
app.get('/my/:org/exceeded_users', (req, res) => {
  res.json({ items: [] });
});
app.get('/my/:org/settings/invites/count', (req, res) => {
  res.json({ count: 0, items: [] });
});
app.get('/my/:org/vacancy_close_reason', (req, res) => {
  res.json({ items: [] });
});
app.get('/my/:org/vacancy_hold_reason', (req, res) => {
  res.json({ items: [] });
});

// ── Write operations (in-memory CRUD) ───────────────────────────────────
// POST: create applicant
app.post('/app/api/my/:org/applicants', (req, res) => {
  const id = memStore.nextId.applicant++;
  const applicant = { id, ...req.body, created: new Date().toISOString() };
  memStore.applicants.set(id, applicant);
  res.json(applicant);
});
// POST: create vacancy
app.post('/app/api/my/:org/vacancies', (req, res) => {
  const id = memStore.nextId.vacancy++;
  const vacancy = { id, ...req.body, created: new Date().toISOString() };
  memStore.vacancies.set(id, vacancy);
  res.json(vacancy);
});
// POST: create tag
app.post('/app/api/my/:org/tag', (req, res) => {
  const id = memStore.nextId.tag++;
  const tag = { id, ...req.body };
  memStore.tags.set(id, tag);
  res.json(tag);
});
// PUT/PATCH: update applicant
app.put('/app/api/my/:org/applicant/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = memStore.applicants.get(id) || {};
  const updated = { ...existing, ...req.body, id };
  memStore.applicants.set(id, updated);
  res.json(updated);
});
app.patch('/app/api/my/:org/applicant/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = memStore.applicants.get(id) || {};
  const updated = { ...existing, ...req.body, id };
  memStore.applicants.set(id, updated);
  res.json(updated);
});
// DELETE: delete applicant
app.delete('/app/api/my/:org/applicant/:id', (req, res) => {
  const id = parseInt(req.params.id);
  memStore.applicants.delete(id);
  res.json({ ok: true, id });
});
// PUT/PATCH: update vacancy
app.put('/app/api/my/:org/vacancies/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = memStore.vacancies.get(id) || {};
  const updated = { ...existing, ...req.body, id };
  memStore.vacancies.set(id, updated);
  res.json(updated);
});
app.patch('/app/api/my/:org/vacancies/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = memStore.vacancies.get(id) || {};
  const updated = { ...existing, ...req.body, id };
  memStore.vacancies.set(id, updated);
  res.json(updated);
});
// Generic write: POST/PUT/PATCH/DELETE for any unmatched API path
app.post('/app/api/my/:org/*', (req, res) => {
  res.json({ ok: true, ...req.body });
});
app.put('/app/api/my/:org/*', (req, res) => {
  res.json({ ok: true, ...req.body });
});
app.patch('/app/api/my/:org/*', (req, res) => {
  res.json({ ok: true, ...req.body });
});
app.delete('/app/api/my/:org/*', (req, res) => {
  res.json({ ok: true });
});

// ── Static assets (real Huntflow CSS/JS/fonts/images) ───────────────────
app.use('/static', express.static(path.join(WEB_DIR, 'static'), {
  maxAge: '1d',
  setHeaders: (res, p) => {
    if (p.endsWith('.js')) res.set('Content-Type', 'application/javascript');
    if (p.endsWith('.css')) res.set('Content-Type', 'text/css');
  }
}));

// ── Photo service stub (placeholder avatar) ─────────────────────────────
const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e0e0e0"/><text x="40" y="45" font-size="28" text-anchor="middle" fill="#999">?</text></svg>';
app.get('/photo_service/*', (req, res) => {
  res.set('Content-Type', 'image/svg+xml');
  res.send(PLACEHOLDER_SVG);
});

// ── File upload handling ────────────────────────────────────────────────
app.post('/photo_service/applicant/:id/photos', (req, res) => {
  res.json({ ok: true, url: '/photo_service/placeholder.svg' });
});
app.post('/app/api/my/:org/applicant/:id/external/:eid/file', (req, res) => {
  res.json({ ok: true, id: Date.now() });
});

// ── API catch-all: return empty JSON for unmatched API requests ──────────
app.all('/app/api/*', (req, res) => {
  console.log(`[API MISS] ${req.method} ${req.originalUrl}`);
  res.json({ items: [] });
});
app.all('/my/:org/*', (req, res, next) => {
  const isApi = req.headers['x-request-id'] ||
                (req.headers.accept && req.headers.accept.includes('application/json'));
  if (isApi) {
    console.log(`[API MISS] ${req.method} ${req.originalUrl}`);
    return res.json({ items: [] });
  }
  next();
});

// ── SPA fallback: serve index.html for all non-API routes ───────────────
app.get('*', (req, res) => {
  if (req.path === '/' || req.path === '/app' || req.path === '/app/') {
    return res.redirect(302, `/app/my/${ORG}/applicants`);
  }
  const idx = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(idx)) {
    res.sendFile(idx);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── HTTP + WebSocket server on same port ────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/' });

wss.on('connection', (ws, req) => {
  console.log(`[WS] client connected from ${req?.socket?.remoteAddress}`);
  // Send a welcome message so SPA knows connection is alive
  ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
  }, 30000);
  ws.on('message', (msg) => { /* accept any message, no-op */ });
  ws.on('close', () => clearInterval(heartbeat));
  ws.on('error', () => clearInterval(heartbeat));
});

server.listen(PORT, () => {
  console.log(`\n  Huntflow Clone (1:1) → http://localhost:${PORT}`);
  console.log(`  API: ${apiCount} endpoints + write ops`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Static: ${WEB_DIR}/static/`);
  console.log(`  SPA: real Huntflow frontend\n`);
});
