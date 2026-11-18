#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ROUTE_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'route-map.json'), 'utf8'));
const WEB_DIR = path.join(ROOT, 'web');
const PORT = process.env.PORT || 3360;

const app = express();
app.use(express.json({ limit: '10mb' }));

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
    res.json({ token: TOKEN, account: { id: 212636, email, org: 'gk51295' } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
app.get('/app/api/account/session', (req, res) => {
  res.json({ account: { id: 212636, email: 'demo@huntflow-clone.local', org: 'gk51295' } });
});

// ── API routes from recorded data ───────────────────────────────────────
let apiCount = 0;
for (const [key, route] of Object.entries(ROUTE_MAP)) {
  const { method, path: apiPath, body, mimeType } = route;
  if (apiPath.includes('/account/session')) continue;

  const expressPath = '/app/api' + apiPath
    .replace(/\{id0\}/g, ':id0')
    .replace(/\{id1\}/g, ':id1')
    .replace(/\{id\}/g, ':id');

  let responseData;
  if (body && (mimeType || '').includes('json')) {
    try { responseData = JSON.parse(body); } catch { responseData = body; }
  } else if (body && (mimeType || '').includes('javascript')) {
    // Fix absolute URLs in JS config files so SPA uses our local server
    responseData = body
      .replace(/https:\/\/wss\.huntflow\.ru/g, 'ws://localhost:' + PORT)
      .replace(/https:\/\/huntflow\.ru/g, 'http://localhost:' + PORT)
      .replace(/wss:\/\/huntflow\.ru/g, 'ws://localhost:' + PORT);
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

// ── Static assets (real Huntflow CSS/JS/fonts/images) ───────────────────
app.use('/static', express.static(path.join(WEB_DIR, 'static'), {
  maxAge: '1d',
  setHeaders: (res, p) => {
    if (p.endsWith('.js')) res.set('Content-Type', 'application/javascript');
    if (p.endsWith('.css')) res.set('Content-Type', 'text/css');
  }
}));

// ── Photo service stub ──────────────────────────────────────────────────
app.get('/photo_service/*', (req, res) => {
  res.redirect(307, 'https://huntflow.ru' + req.originalUrl);
});

// ── API catch-all: return empty JSON for unmatched API requests ──────────
// Handles both /app/api/* and /my/:org/* API calls (Ay client lacks /app/api prefix)
app.all('/app/api/*', (req, res) => {
  console.log(`[API MISS] ${req.method} ${req.originalUrl}`);
  res.json({ items: [] });
});
app.all('/my/:org/*', (req, res, next) => {
  // Only intercept if this is an API call (has X-Request-Id or Accept: json)
  const isApi = req.headers['x-request-id'] ||
                (req.headers.accept && req.headers.accept.includes('application/json'));
  if (isApi) {
    // member_settings needs a dashboard item for route predicates
    if (req.originalUrl.includes('member_settings')) {
      return res.json({ items: [{ id: 'dashboard', value: true }] });
    }
    console.log(`[API MISS] ${req.method} ${req.originalUrl}`);
    return res.json({ items: [] });
  }
  next();
});

// ── SPA fallback: serve index.html for all non-API routes ───────────────
app.get('*', (req, res) => {
  // Redirect root to the main SPA route
  if (req.path === '/' || req.path === '/app' || req.path === '/app/') {
    return res.redirect(302, '/app/my/gk51295/applicants');
  }
  const idx = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(idx)) {
    res.sendFile(idx);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Huntflow Clone (1:1) → http://localhost:${PORT}`);
  console.log(`  API: ${apiCount} endpoints`);
  console.log(`  Static: ${WEB_DIR}/static/`);
  console.log(`  SPA: real Huntflow frontend\n`);
});
