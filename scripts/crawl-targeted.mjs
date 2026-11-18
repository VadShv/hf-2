import fs from 'fs';
const BASE = 'http://127.0.0.1:9223';
const APP = 'https://huntflow.ru/app/my/gk51295';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = [];
const visited = new Set();

const APPLICANT_IDS = ['89307311', '86199662', '86555541', '89457120', '90777206'];
const VACANCY_IDS = ['4288523', '4357384', '3995083', '4228656', '3685071'];
const DANGER = ['создать','сохранить','удалить','изменить','добавить','отправить','опубликовать','выгрузить','загрузить','скачать','закрыть','отменить','подтвердить','редактировать','перенести','копировать','дублировать','архивир','восстановить','отозвать','снять','назначить','исключить','блокир','выйти','logout'];

async function getPage() {
  const r = await fetch(`${BASE}/json/list`);
  const ts = await r.json();
  return ts.find(t => t.type === 'page' && t.url.includes('huntflow'));
}
function makeSend(sock) {
  let id = 0; const p = new Map();
  sock.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id).resolve(m); p.delete(m.id); } });
  return (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { p.set(i, {resolve:res, reject:rej}); sock.send(JSON.stringify({id:i, method, params})); }); };
}

async function main() {
  const page = await getPage();
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => sock.addEventListener('open', r));
  const send = makeSend(sock);
  await send('Page.enable');
  await send('Runtime.enable');

  async function ev(expr) {
    try { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; } catch { return null; }
  }
  async function nav(url) {
    if (visited.has(url)) return false;
    visited.add(url);
    try { await send('Page.navigate', { url }); } catch { return false; }
    await sleep(5000);
    const title = await ev('document.title') || '?';
    const ok = !title.includes('не найдена') && !title.includes('Not Found');
    log.push({ nav: url, title, ok });
    if (ok) console.log(`  ✓ ${url.replace('https://huntflow.ru','')} (${title.slice(0,35)})`);
    return ok;
  }
  async function clickTabs(ctx) {
    const dangerStr = JSON.stringify(DANGER);
    const info = await ev(`(() => {
      const D = ${dangerStr};
      const isD = t => D.some(w => t.toLowerCase().includes(w));
      const tabs = [], seen = new Set();
      const sels = ['[role="tab"]','[role="menuitem"]','[class*="tabItem"]','[class*="TabItem"]','[class*="tab-item"]','[class*="nav-item"]','[class*="navItem"]','[class*="menu-item"]','[class*="menuItem"]','[class*="NavItem"]','[class*="MenuItem"]','[data-tab]','[data-view]','a[href]'];
      for (const s of sels) {
        let els; try { els = document.querySelectorAll(s); } catch { continue; }
        for (const el of els) {
          const text = (el.textContent||'').trim().slice(0,50);
          if (!text || text.length > 50 || isD(text)) continue;
          const key = text + s;
          if (seen.has(key)) continue; seen.add(key);
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10 || r.x < 0 || r.y < 0) continue;
          // Skip if it's a marketing/footer link
          if (r.y > 800 && !el.getAttribute('href')?.includes('/app/')) continue;
          tabs.push({ text, x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), href: el.getAttribute?.('href')||'' });
        }
      }
      const byPos = new Map();
      for (const t of tabs) { const k = t.x+','+t.y; if (!byPos.has(k)) byPos.set(k,t); }
      return JSON.stringify([...byPos.values()].slice(0,25));
    })()`);
    const tabs = JSON.parse(info || '[]');
    let n = 0;
    for (const t of tabs) {
      try {
        const before = await ev('location.href');
        await send('Input.dispatchMouseEvent', { type:'mousePressed', x:t.x, y:t.y, button:'left', clickCount:1 });
        await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:t.x, y:t.y, button:'left', clickCount:1 });
        await sleep(3000);
        const after = await ev('location.href');
        n++;
        log.push({ click: ctx, text: t.text, changed: before !== after });
        if (before !== after) console.log(`    [tab→] ${t.text.slice(0,30)} → ${after.split('huntflow.ru')[1]?.slice(0,50)}`);
        else console.log(`    [tab]  ${t.text.slice(0,30)}`);
      } catch {}
    }
    return n;
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 1. НАСТРОЙКИ /app/settings ═══');
  if (await nav('https://huntflow.ru/app/settings')) {
    await clickTabs('settings-main');
    // After clicking tabs, collect and visit any new URLs
    const links = await ev(`JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>h.includes('/app/my/')||h.includes('/app/settings')))` );
    for (const href of JSON.parse(links || '[]')) {
      if (await nav(href)) await clickTabs('settings-sub');
    }
  }

  // Settings sub-pages discovered from the tabs
  const settingsSubs = [
    '/app/my/gk51295/email-templates', '/app/my/gk51295/survey-type-a',
    '/app/my/gk51295/pipelines', '/app/my/gk51295/vacancy-request',
    '/app/my/gk51295/career-site', '/app/my/gk51295/api',
    '/app/my/gk51295/integrations', '/app/my/gk51295/mail',
    '/app/my/gk51295/telephony', '/app/my/gk51295/jobsites',
    '/app/my/gk51295/webhooks', '/app/my/gk51295/appearance',
    '/app/my/gk51295/organization', '/app/my/gk51295/divisions',
    '/app/my/gk51295/regions', '/app/my/gk51295/sources',
    '/app/my/gk51295/tags', '/app/my/gk51295/rejections',
    '/app/my/gk51295/fields', '/app/my/gk51295/interview-types',
  ];
  console.log('\n═══ 2. НАСТРОЙКИ — подстраницы ═══');
  for (const p of settingsSubs) {
    if (await nav(`https://huntflow.ru${p}`)) await clickTabs(`settings:${p.split('/').pop()}`);
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. КАНДИДАТЫ — карточки ═══');
  for (const aid of APPLICANT_IDS) {
    console.log(`\n  ── #${aid} ──`);
    if (await nav(`${APP}/applicant/${aid}`)) {
      await clickTabs(`applicant:${aid}`);
      // Sub-routes
      for (const s of ['/log','/questionary','/files','/messages','/emails','/schedule','/interviews','/offer','/offers','/tags','/notes','/comments','/external','/history','/resume','/activity','/agreement']) {
        await nav(`${APP}/applicant/${aid}${s}`);
      }
      // Back to main and click tabs again
      if (await nav(`${APP}/applicant/${aid}`)) await clickTabs(`applicant:${aid}:r2`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. ВАКАНСИИ — карточки ═══');
  for (const vid of VACANCY_IDS) {
    console.log(`\n  ── #${vid} ──`);
    if (await nav(`${APP}/vacancy/${vid}`)) {
      await clickTabs(`vacancy:${vid}`);
      for (const s of ['/applicants','/candidates','/external','/access','/logs','/stats','/notify','/quotas','/stoplist','/children','/link','/fields','/frame','/history','/coworkers','/recruiters']) {
        await nav(`${APP}/vacancy/${vid}${s}`);
      }
      if (await nav(`${APP}/vacancy/${vid}`)) await clickTabs(`vacancy:${vid}:r2`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. АНАЛИТИКА — типы отчётов ═══');
  if (await nav(`${APP}/reports`)) await clickTabs('reports');
  for (const r of ['/reports/funnel','/reports/conversion','/reports/ttf','/reports/recruiter','/reports/source','/reports/vacancy','/reports/custom','/reports/saved']) {
    if (await nav(`${APP}${r}`)) await clickTabs(`report:${r}`);
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 6. КАЛЕНДАРЬ ═══');
  if (await nav(`${APP}/calendar`)) await clickTabs('calendar');

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 7. КОМАНДА ═══');
  for (const p of ['/colleagues','/team','/members']) {
    if (await nav(`${APP}${p}`)) await clickTabs(`team:${p}`);
  }

  // ═══════════════════════════════════════════════════════════════
  fs.writeFileSync('/home/astra/huntflow-clone/capture/crawl-log-3.json', JSON.stringify(log, null, 2));
  console.log(`\n═══ ГОТОВО: ${visited.size} URL, ${log.length} действий ═══`);
  sock.close(); process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
