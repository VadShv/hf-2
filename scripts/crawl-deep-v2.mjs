import fs from 'fs';

const BASE = 'http://127.0.0.1:9223';
const APP = 'https://huntflow.ru/app/my/gk51295';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = [];
const visited = new Set();

// Known IDs from round 1
const APPLICANT_IDS = ['89307311', '86199662', '86555541', '89457120', '90777206'];
const VACANCY_IDS = ['4288523', '4357384', '3995083', '4228656', '3685071'];

// Words that indicate action buttons — NEVER click
const DANGER_WORDS = ['создать','сохранить','удалить','изменить','добавить','отправить','опубликовать','выгрузить','загрузить','скачать','закрыть','отменить','подтвердить','редактировать','перенести','п7ереместить','копировать','дублировать','архивир','восстановить','отозвать','снять','назначить','исключить','блокир'];

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
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); }
  });
  return (method, params = {}) => {
    const myId = ++id;
    return new Promise((resolve, reject) => { pending.set(myId, {resolve, reject}); sock.send(JSON.stringify({id: myId, method, params})); });
  };
}

async function main() {
  const page = await getPage();
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => sock.addEventListener('open', r));
  const send = makeSend(sock);
  await send('Page.enable');
  await send('Runtime.enable');

  async function evalJS(expr) {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.result?.value;
    } catch { return null; }
  }

  async function navigate(url) {
    if (visited.has(url)) return;
    visited.add(url);
    try { await send('Page.navigate', { url }); } catch { return; }
    await sleep(5000);
    const title = await evalJS('document.title') || '?';
    log.push({ action: 'nav', url, title });
    console.log(`  → ${url.replace(APP, '')} (${title.slice(0,40)})`);
  }

  async function clickAllSafeTabs(context) {
    // Find ALL clickable elements that look like tabs/navigation (not action buttons)
    const dangerArr = JSON.stringify(DANGER_WORDS);
    const tabInfo = await evalJS(`(() => {
      const DANGER = ${dangerArr};
      const isDanger = (text) => DANGER.some(w => text.toLowerCase().includes(w));

      const tabs = [];
      const seen = new Set();

      // Broader selectors for tab-like elements
      const selectors = [
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="button"]:not([aria-label*="закрыть"])',
        '[class*="tab"]:not([class*="table"]):not([class*="Table"])',
        '[class*="Tab"]',
        '[class*="nav-item"]', '[class*="navItem"]', '[class*="NavItem"]',
        '[class*="menu-item"]', '[class*="menuItem"]', '[class*="MenuItem"]',
        '[class*="sidebar-item"]', '[class*="filter-item"]',
        '[data-tab]', '[data-view]', '[data-route]',
        'a[href]:not([href*="create"]):not([href*="edit"]):not([href*="delete"])',
      ];

      for (const sel of selectors) {
        let els;
        try { els = document.querySelectorAll(sel); } catch { continue; }
        for (const el of els) {
          const text = (el.textContent || '').trim().slice(0, 50);
          if (!text || text.length > 50) continue;
          if (isDanger(text)) continue;
          if (seen.has(text + sel)) continue;
          seen.add(text + sel);

          const rect = el.getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) continue;
          if (rect.x < 0 || rect.y < 0) continue;

          tabs.push({
            text, x: Math.round(rect.x + rect.width/2),
            y: Math.round(rect.y + rect.height/2),
            tag: el.tagName, sel: sel.slice(0, 20),
            href: el.getAttribute?.('href') || '',
          });
        }
      }
      // Deduplicate by position
      const byPos = new Map();
      for (const t of tabs) {
        const key = t.x + ',' + t.y;
        if (!byPos.has(key)) byPos.set(key, t);
      }
      return JSON.stringify([...byPos.values()].slice(0, 30));
    })()`);

    const tabs = JSON.parse(tabInfo || '[]');
    if (!tabs.length) { console.log(`    (no tabs found)`); return; }

    let clicked = 0;
    for (const tab of tabs) {
      try {
        // Record URL before click
        const urlBefore = await evalJS('location.href');
        // Click
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
        await sleep(3000);
        const urlAfter = await evalJS('location.href');
        clicked++;
        log.push({ action: 'click', context, text: tab.text, urlChanged: urlBefore !== urlAfter });
        console.log(`    [tab] ${tab.text.slice(0,30)}${urlBefore !== urlAfter ? ' → ' + urlAfter.split('/').slice(-2).join('/') : ''}`);
      } catch { /* ignore */ }
    }
    console.log(`    Clicked ${clicked} tabs`);
  }

  async function collectLinks() {
    const links = await evalJS(`JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>({text:(a.textContent||'').trim().slice(0,40), href:a.href})).filter(l=>l.href.includes('huntflow.ru/app/')&&!l.href.includes('#')))`);
    return JSON.parse(links || '[]');
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 1. НАСТРОЙКИ — ищем правильные URL ═══');
  // /settings/users worked in round 2 — start there and explore
  await navigate(`${APP}/settings/users`);
  await clickAllSafeTabs('settings/users');
  let links = await collectLinks();
  console.log(`  Links on settings/users: ${links.length}`);
  for (const l of links.filter(l => /settings|настрой/i.test(l.href + l.text)).slice(0, 15)) {
    await navigate(l.href);
    await clickAllSafeTabs('settings-link');
  }

  // Try more settings sub-pages
  const settingsPages = [
    '/settings/divisions', '/settings/regions', '/settings/sources',
    '/settings/tags', '/settings/templates', '/settings/mail-templates',
    '/settings/sms-templates', '/settings/interview-types', '/settings/rejections',
    '/settings/fields', '/settings/custom-fields', '/settings/webhooks',
    '/settings/tariff', '/settings/billing', '/settings/limits',
    '/settings/2fa', '/settings/security', '/settings/depersonalization',
  ];
  for (const p of settingsPages) {
    await navigate(`${APP}${p}`);
    await clickAllSafeTabs(`settings:${p}`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 2. КАНДИДАТЫ — карточки по ID + вкладки ═══');
  for (const aid of APPLICANT_IDS) {
    console.log(`\n  ── Кандидат #${aid} ──`);
    await navigate(`${APP}/applicant/${aid}`);
    await clickAllSafeTabs(`applicant:${aid}`);

    // Try sub-routes
    for (const sub of ['/log', '/questionary', '/files', '/messages', '/emails',
                        '/schedule', '/interviews', '/offer', '/offers', '/tag', '/tags',
                        '/notes', '/comment', '/comments', '/external', '/history',
                        '/agreement', '/resume', '/cv', '/profile', '/activity',
                        '/comparison', '/doubles', '/not_doubles']) {
      await navigate(`${APP}/applicant/${aid}${sub}`);
    }
    // Click tabs again after loading sub-routes
    await navigate(`${APP}/applicant/${aid}`);
    await clickAllSafeTabs(`applicant:${aid}:round2`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 3. ВАКАНСИИ — карточки по ID + вкладки ═══');
  for (const vid of VACANCY_IDS) {
    console.log(`\n  ── Вакансия #${vid} ──`);
    await navigate(`${APP}/vacancy/${vid}`);
    await clickAllSafeTabs(`vacancy:${vid}`);

    // Try sub-routes
    for (const sub of ['/applicants', '/candidates', '/external', '/publish',
                        '/access', '/logs', '/log', '/stats', '/statistics',
                        '/notify', '/notifications', '/quotas', '/stoplist',
                        '/children', '/child', '/link', '/links', '/fields',
                        '/description', '/requirements', '/conditions',
                        '/frame', '/history', '/activity', '/comments',
                        '/coworkers', '/team', '/recruiters']) {
      await navigate(`${APP}/vacancy/${vid}${sub}`);
    }
    await navigate(`${APP}/vacancy/${vid}`);
    await clickAllSafeTabs(`vacancy:${vid}:round2`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 4. ВОРОНКИ — детали ═══');
  await navigate(`${APP}/pipelines`);
  await clickAllSafeTabs('pipelines');
  // Try individual pipeline pages
  for (const sub of ['/1', '/edit', '/settings', '/statuses', '/stages']) {
    await navigate(`${APP}/pipelines${sub}`);
  }
  // Pipeline might be in settings
  await navigate(`${APP}/settings/pipelines`);
  await navigate(`${APP}/settings/statuses`);
  await clickAllSafeTabs('pipeline-settings');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 5. АНАЛИТИКА — все типы отчётов ═══');
  await navigate(`${APP}/reports`);
  await clickAllSafeTabs('reports-main');
  // Click on different report type selectors
  const reportPages = [
    '/reports/funnel', '/reports/funnel_conversion', '/reports/funnel_recruiter',
    '/reports/funnel_rejection', '/reports/ttf', '/reports/conversion',
    '/reports/recruiter', '/reports/source', '/reports/sources',
    '/reports/vacancy', '/reports/vacancies', '/reports/applicants',
    '/reports/hired', '/reports/rejection', '/reports/time',
    '/reports/custom', '/reports/saved', '/reports/summary',
  ];
  for (const p of reportPages) {
    await navigate(`${APP}${p}`);
    await clickAllSafeTabs(`report:${p}`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 6. КАЛЕНДАРЬ — события ═══');
  await navigate(`${APP}/calendar`);
  await clickAllSafeTabs('calendar');
  for (const sub of ['/event', '/events', '/today', '/week', '/month',
                      '/interviews', '/meetings', '/reminders']) {
    await navigate(`${APP}/calendar${sub}`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 7. КОМАНДА / КОЛЛЕГИ ═══');
  for (const p of ['/colleagues', '/team', '/members', '/users',
                    '/settings/users', '/settings/members', '/settings/colleagues',
                    '/settings/&roles', '/settings/permissions']) {
    await navigate(`${APP}${p}`);
    await clickAllSafeTabs(`team:${p}`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 8. ИНТЕГРАЦИИ ═══');
  for (const p of ['/integrations', '/settings/integrations',
                    '/settings/integration', '/integrations/hh',
                    '/integrations/superjob', '/integrations/email',
                    '/integrations/telephony']) {
    await navigate(`${APP}${p}`);
    await clickAllSafeTabs(`integrations:${p}`);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log('\n═══ 9. ПОИСК ═══');
  for (const p of ['/search/applicants', '/search/vacancies', '/search/resumes',
                    '/search/talent', '/search/candidates']) {
    await navigate(`${APP}${p}`);
    await clickAllSafeTabs(`search:${p}`);
  }

  // ════════════════════════════════════════════════════════════════════
  fs.writeFileSync('/home/astra/huntflow-clone/capture/crawl-log-3.json', JSON.stringify(log, null, 2));
  console.log(`\n═══ ГОТОВО ═══`);
  console.log(`  Посещено: ${visited.size} URL`);
  console.log(`  Лог: ${log.length} действий`);
  sock.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
