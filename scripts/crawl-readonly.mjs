import fs from 'fs';

const BASE = 'http://127.0.0.1:9223';
const CAPTURE_DIR = '/home/astra/huntflow-clone/capture';
const LOG_FILE = `${CAPTURE_DIR}/crawl-log.json`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPage() {
  const resp = await fetch(`${BASE}/json/list`);
  const targets = await resp.json();
  return targets.find(t => t.type === 'page' && t.url.includes('huntflow'));
}

function makeSend(sock) {
  let id = 0;
  const pending = new Map();
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  });
  return (method, params = {}) => {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(myId, { resolve, reject });
      sock.send(JSON.stringify({ id: myId, method, params }));
    });
  };
}

async function main() {
  const page = await getPage();
  if (!page) { console.error('No page'); process.exit(1); }
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => sock.addEventListener('open', r));
  const send = makeSend(sock);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const log = [];
  const visited = new Set();
  const queue = [];

  // Seeds: main sections
  const APP = 'https://huntflow.ru/app/my/gk51295';
  const seeds = [
    `${APP}/applicants`,
    `${APP}/reports`,
    `${APP}/calendar`,
    `${APP}/search/applicants`,
  ];
  queue.push(...seeds);

  // Add applicant filters from the sidebar (read-only list views)
  const filterIds = [
    'all', '155417', '192525', '183072', '155419', '155418', '183073',
    '155420', '155421', '183074', '165177', '157836', '167815', '164057',
    '185751', '155422', '183214', '165272', '155423', '155424', '157835',
    '155425', '165062', '179061', '206289', '155426',
  ];
  for (const fid of filterIds) {
    queue.push(`${APP}/applicants/filter/${fid}`);
  }

  // Add a sample of vacancies (read-only detail views)
  const vacancyIds = [
    '4288523', '4357384', '4244683', '4009030', '3995083', '4228656',
    '3867319', '4254970', '4283423', '4024368', '3685071', '3758337',
    '4029094', '4106170', '3695735',
  ];
  for (const vid of vacancyIds) {
    queue.push(`${APP}/vacancy/${vid}`);
  }

  // URLs that modify data — NEVER visit
  const DANGER = /\/(create|edit|delete|remove|add|save|move|reject|approve|hire|fire|send|upload|import|export\/create|duplicate|archive|restore|withdraw|cancel|submit|confirm|offer\/create|comment\/add)/i;

  async function navigateAndCollect(url) {
    if (visited.has(url)) return;
    if (DANGER.test(url)) return;
    visited.add(url);

    try {
      const nav = await send('Page.navigate', { url });
      if (nav.result?.errorText) {
        log.push({ url, status: 'nav-error', error: nav.result.errorText });
        return;
      }
    } catch (e) {
      log.push({ url, status: 'nav-exception', error: e.message });
      return;
    }

    // Wait for network idle
    await sleep(3500);

    // Collect links from the loaded page
    const expr = `(() => {
      const links = [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.includes('huntflow.ru/app/'))
        .filter(h => !h.includes('#'));
      const title = document.title;
      return JSON.stringify({ title, links: [...new Set(links)] });
    })()`;

    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      const data = JSON.parse(r.result.result.value);
      log.push({ url, status: 'ok', title: data.title, linksFound: data.links.length });

      // Add new links to queue (capped)
      for (const link of data.links) {
        if (!visited.has(link) && !DANGER.test(link) && queue.length < 200) {
          queue.push(link);
        }
      }
    } catch (e) {
      log.push({ url, status: 'eval-error', error: e.message });
    }
  }

  // Process queue with a cap
  const MAX_PAGES = 80;
  let count = 0;
  console.log(`Starting crawl with ${queue.length} seed URLs, max ${MAX_PAGES} pages`);

  while (queue.length > 0 && count < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    if (DANGER.test(url)) continue;
    count++;
    console.log(`[${count}/${MAX_PAGES}] ${url.slice(0, 90)}`);
    await navigateAndCollect(url);
  }

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  console.log(`\nDone. Visited ${visited.size} pages. Log: ${LOG_FILE}`);
  sock.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
