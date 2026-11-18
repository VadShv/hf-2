import fs from 'fs';

const BASE = 'http://127.0.0.1:9223';
const APP = 'https://huntflow.ru/app/my/gk51295';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = [];
const visited = new Set();

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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  }

  async function navigate(url) {
    if (visited.has(url)) return;
    visited.add(url);
    await send('Page.navigate', { url });
    await sleep(4000);
    const info = await evalJS(`JSON.stringify({url: location.href, title: document.title, links: [...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>h.includes('huntflow.ru/app/'))})`);
    const data = JSON.parse(info || '{}');
    log.push({ action: 'navigate', url, title: data.title, links: data.links?.length || 0 });
    console.log(`  → ${url.replace('https://huntflow.ru', '')} (${data.title?.slice(0,40) || '?'})`);
    return data.links || [];
  }

  async function clickTabs(context) {
    // Find all tab-like elements and click them (read-only)
    const tabInfo = await evalJS(`(() => {
      const tabs = [];
      // Tab elements
      const selectors = [
        '[role="tab"]', '[class*="tab"]', '[class*="Tab"]',
        '[class*="menu-item"]', '[class*="menuItem"]',
        '[class*="nav-item"]', '[class*="navItem"]',
        '[data-tab]', '[data-view]',
      ];
      const seen = new Set();
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const text = (el.textContent || '').trim().slice(0, 40);
          if (!text || text.length > 40) continue;
          // Skip action buttons
          const lower = text.toLowerCase();
          if (['создать','сохранить','удалить','изменить','добавить','отправить','опубликовать','выгрузить','загрузить','скачать','закрыть','отменить','подтвердить','удалить','редактировать'].some(w => lower.includes(w))) continue;
          if (seen.has(text)) continue;
          seen.add(text);
          // Get position for clicking
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          tabs.push({ text, x: rect.x + rect.width/2, y: rect.y + rect.height/2, tag: el.tagName, cls: el.className?.toString().slice(0,50) });
        }
      }
      return JSON.stringify(tabs.slice(0, 20));
    })()`);

    const tabs = JSON.parse(tabInfo || '[]');
    if (!tabs.length) return;

    for (const tab of tabs) {
      try {
        // Click the tab
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
        await sleep(2500);
        log.push({ action: 'clickTab', context, text: tab.text, tag: tab.tag });
        console.log(`    [tab] ${tab.text}`);
      } catch (e) { /* ignore */ }
    }
  }

  async function collectLinks() {
    const links = await evalJS(`JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>({text:(a.textContent||'').trim().slice(0,40), href:a.href})).filter(l=>l.href.includes('huntflow.ru/app/')&&!l.href.includes('#')))`);
    return JSON.parse(links || '[]');
  }

  // ── 1. Scrape all navigation from current page ─────────────────────
  console.log('\n=== 1. СБОР НАВИГАЦИИ ===');
  let allLinks = await collectLinks();
  console.log(`  Найдено ссылок: ${allLinks.length}`);

  // Find settings, profile, colleagues links
  const settingsLinks = allLinks.filter(l => /settings|настрой|profile|профил/i.test(l.text + l.href));
  const colleagueLinks = allLinks.filter(l => /colleague|team|команд|сотрудник/i.test(l.text + l.href));
  console.log(`  Настройки: ${settingsLinks.length}, Команда: ${colleagueLinks.length}`);

  // ── 2. Visit settings pages ────────────────────────────────────────
  console.log('\n=== 2. НАСТРОЙКИ ===');
  // Try common settings URLs
  const settingsUrls = [
    `${APP}/settings`,
    `${APP}/settings/general`,
    `${APP}/settings/integrations`,
    `${APP}/settings/fields`,
    `${APP}/settings/api`,
    `${APP}/settings/tariff`,
    `${APP}/settings/telephony`,
    `${APP}/settings/mail`,
    `${APP}/settings/sms`,
    `${APP}/settings/notifications`,
    `${APP}/settings/appearance`,
    `${APP}/settings/dep`,
    `${APP}/settings/users`,
    `${APP}/settings/roles`,
  ];
  for (const url of settingsUrls) {
    await navigate(url);
    await clickTabs('settings');
    allLinks.push(...await collectLinks());
  }
  // Also visit any settings links found in nav
  for (const l of settingsLinks) {
    await navigate(l.href);
    await clickTabs('settings-nav');
  }

  // ── 3. Profile ─────────────────────────────────────────────────────
  console.log('\n=== 3. ПРОФИЛЬ ===');
  await navigate(`${APP}/profile`);
  await navigate(`${APP}/settings/profile`);
  await navigate(`${APP}/settings/coworker`);
  await clickTabs('profile');

  // ── 4. Applicants — open 5 and click all tabs ─────────────────────
  console.log('\n=== 4. КАНДИДАТЫ — КАРТОЧКИ ===');
  // Get applicant IDs from the list
  await navigate(`${APP}/applicants/filter/all`);
  const applicantLinks = (await collectLinks()).filter(l => /\/applicant\/\d+/.test(l.href));
  console.log(`  Кандидатов в списке: ${applicantLinks.length}`);

  for (const al of applicantLinks.slice(0, 5)) {
    console.log(`  Открыть: ${al.text.slice(0,30)}`);
    await navigate(al.href);
    await clickTabs(`applicant:${al.text}`);
    // Also try sub-routes
    const aid = al.href.match(/\/applicant\/(\d+)/)?.[1];
    if (aid) {
      for (const sub of ['/log', '/questionary', '/files', '/messages', '/schedule', '/offer', '/tag', '/notes', '/external']) {
        await navigate(`${APP}/applicant/${aid}${sub}`);
      }
    }
  }

  // ── 5. Vacancies — open 5 and click all tabs ──────────────────────
  console.log('\n=== 5. ВАКАНСИИ — КАРТОЧКИ ===');
  await navigate(`${APP}/vacancies`);
  const vacancyLinks = (await collectLinks()).filter(l => /\/vacancy\/\d+/.test(l.href));
  console.log(`  Вакансий в списке: ${vacancyLinks.length}`);

  for (const vl of vacancyLinks.slice(0, 5)) {
    console.log(`  Открыть: ${vl.text.slice(0,30)}`);
    await navigate(vl.href);
    await clickTabs(`vacancy:${vl.text}`);
    const vid = vl.href.match(/\/vacancy\/(\d+)/)?.[1];
    if (vid) {
      for (const sub of ['/applicants', '/external', '/access', '/logs', '/stats', '/notify', '/quotas', '/stoplist', '/children']) {
        await navigate(`${APP}/vacancy/${vid}${sub}`);
      }
    }
  }

  // ── 6. Pipelines — open each ──────────────────────────────────────
  console.log('\n=== 6. ВОРОНКИ ===');
  await navigate(`${APP}/pipelines`);
  await navigate(`${APP}/settings/pipelines`);
  await navigate(`${APP}/settings/statuses`);
  await clickTabs('pipelines');
  // Try opening individual pipelines
  const pipelineLinks = (await collectLinks()).filter(l => /\/pipeline\/\d+/.test(l.href));
  for (const pl of pipelineLinks.slice(0, 5)) {
    await navigate(pl.href);
    await clickTabs('pipeline-detail');
  }

  // ── 7. Reports — try different types ──────────────────────────────
  console.log('\n=== 7. АНАЛИТИКА ===');
  await navigate(`${APP}/reports`);
  await clickTabs('reports');
  const reportUrls = [
    `${APP}/reports/funnel`,
    `${APP}/reports/conversion`,
    `${APP}/reports/ttf`,
    `${APP}/reports/recruiter`,
    `${APP}/reports/source`,
    `${APP}/reports/vacancy`,
    `${APP}/reports/custom`,
    `${APP}/reports/saved`,
  ];
  for (const url of reportUrls) {
    await navigate(url);
    await clickTabs('report-type');
  }

  // ── 8. Calendar — events ──────────────────────────────────────────
  console.log('\n=== 8. КАЛЕНДАРЬ ===');
  await navigate(`${APP}/calendar`);
  await clickTabs('calendar');
  const calLinks = (await collectLinks()).filter(l => /\/calendar\/event/.test(l.href));
  for (const cl of calLinks.slice(0, 5)) {
    await navigate(cl.href);
  }

  // ── 9. Colleagues/Team ────────────────────────────────────────────
  console.log('\n=== 9. КОМАНДА ===');
  await navigate(`${APP}/colleagues`);
  await navigate(`${APP}/team`);
  await navigate(`${APP}/settings/colleagues`);
  await navigate(`${APP}/settings/members`);
  await clickTabs('team');

  // ── 10. Integrations ──────────────────────────────────────────────
  console.log('\n=== 10. ИНТЕГРАЦИИ ===');
  await navigate(`${APP}/integrations`);
  await navigate(`${APP}/settings/integrations`);
  await clickTabs('integrations');

  // ── Done ──────────────────────────────────────────────────────────
  fs.writeFileSync('/home/astra/huntflow-clone/capture/crawl-log-2.json', JSON.stringify(log, null, 2));
  console.log(`\n=== ГОТОВО ===`);
  console.log(`  Посещено: ${visited.size} страниц`);
  console.log(`  Действий: ${log.length}`);
  sock.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
