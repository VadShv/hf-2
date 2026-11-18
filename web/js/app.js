// ── Huntflow Clone SPA ──────────────────────────────────────────────────
const API = '/app/api';
const ORG = 'gk51295';
let token = localStorage.getItem('hf_token') || '';
let currentView = 'dashboard';
let currentFilter = 'all';

// ── API helper ──────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return res.text();
}

// ── Router ──────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!token) { app.innerHTML = loginHTML(); bindLogin(); return; }
  app.innerHTML = appShell();
  bindShell();
  loadView(currentView);
}

// ── Login ───────────────────────────────────────────────────────────────
function loginHTML() {
  return `<div class="login-page">
    <div class="login-card">
      <h1>Huntflow Clone</h1>
      <p>ATS — система управления кандидатами</p>
      <div class="login-error" id="loginError">Неверный email или пароль</div>
      <input type="email" id="loginEmail" placeholder="Email" value="demo@huntflow-clone.local">
      <input type="password" id="loginPass" placeholder="Пароль" value="demo">
      <button id="loginBtn">Войти</button>
    </div>
  </div>`;
}
function bindLogin() {
  document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    try {
      const r = await api('/account/session', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
      token = r.token;
      localStorage.setItem('hf_token', token);
      render();
    } catch { document.getElementById('loginError').style.display = 'block'; }
  };
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
}

// ── App shell ───────────────────────────────────────────────────────────
function appShell() {
  return `<div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">Хантфлоу</div>
      <nav class="sidebar-nav">
        <a data-view="dashboard" class="${currentView==='dashboard'?'active':''}">📊 Картина дня</a>
        <a data-view="applicants" class="${currentView==='applicants'?'active':''}">👤 Кандидаты</a>
        <a data-view="vacancies" class="${currentView==='vacancies'?'active':''}">📋 Вакансии</a>
        <a data-view="reports" class="${currentView==='reports'?'active':''}">📈 Аналитика</a>
        <a data-view="calendar" class="${currentView==='calendar'?'active':''}">📅 Календарь</a>
        <div class="nav-section">Этапы</div>
        <div id="filterList"></div>
      </nav>
    </aside>
    <div class="main-area">
      <div class="topbar">
        <h2 id="pageTitle">Картина дня</h2>
        <div class="topbar-tabs">
          <button onclick="logout()">Выйти</button>
        </div>
      </div>
      <div class="content" id="content"><div class="loading"><div class="spinner"></div>Загрузка…</div></div>
    </div>
  </div>`;
}

function bindShell() {
  document.querySelectorAll('.sidebar-nav a[data-view]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); currentView = a.dataset.view; render(); };
  });
}

function logout() { token = ''; localStorage.removeItem('hf_token'); render(); }
function setContent(html) { document.getElementById('content').innerHTML = html; }

// ── Views ───────────────────────────────────────────────────────────────
async function loadView(view) {
  const titles = { dashboard: 'Картина дня', applicants: 'Кандидаты', vacancies: 'Вакансии', reports: 'Аналитика', calendar: 'Календарь' };
  document.getElementById('pageTitle').textContent = titles[view] || view;
  try {
    if (view === 'dashboard') await viewDashboard();
    else if (view === 'applicants') await viewApplicants();
    else if (view === 'vacancies') await viewVacancies();
    else if (view === 'reports') await viewReports();
    else if (view === 'calendar') await viewCalendar();
  } catch (e) { setContent(`<div class="card">Ошибка: ${e.message}</div>`); }
  loadFilters();
}

// ── Dashboard ───────────────────────────────────────────────────────────
async function viewDashboard() {
  const [counts, stats, recruiters, vacancies] = await Promise.all([
    api(`/my/${ORG}/applicants/count`).catch(() => ({})),
    api(`/my/${ORG}/applicants/status/stats`).catch(() => ({})),
    api(`/my/${ORG}/dashboard/recruiters`).catch(() => ({})),
    api(`/my/${ORG}/vacancies`).catch(() => ({})),
  ]);

  const vacItems = vacancies?.items || [];
  const openVac = vacItems.filter(v => v.state === 'OPEN').length;

  setContent(`
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Всего кандидатов</div><div class="value">${counts?.count ?? stats?.total ?? '—'}</div></div>
      <div class="stat-card"><div class="label">Вакансии в работе</div><div class="value">${openVac}</div></div>
      <div class="stat-card"><div class="label">Всего вакансий</div><div class="value">${vacItems.length}</div></div>
      <div class="stat-card"><div class="label">Активных этапов</div><div class="value">${stats?.items?.length ?? '—'}</div></div>
    </div>
    <div class="card">
      <h3>Вакансии в работе</h3>
      <div class="vacancy-list">
        ${vacItems.filter(v => v.state === 'OPEN').slice(0, 10).map(v => `
          <div class="vacancy-item" onclick="navTo('vacancies','${v.id}')">
            <div><div class="v-title">${esc(v.position)}</div><div class="v-meta">${esc(v.custom_name_data?.account_division?.[0] || '')} · ${fmtDate(v.created)}</div></div>
            <span class="badge open">В работе</span>
          </div>
        `).join('') || '<p>Нет активных вакансий</p>'}
      </div>
    </div>
    ${stats?.items?.length ? `<div class="card"><h3>Воронка по этапам</h3>${funnelHTML(stats.items)}</div>` : ''}
  `);
}

function funnelHTML(stages) {
  const max = Math.max(...stages.map(s => s.count || s.applicants_count || 0), 1);
  return `<div class="funnel">${stages.map(s => {
    const count = s.count || s.applicants_count || 0;
    const pct = Math.round((count / max) * 100);
    return `<div class="funnel-stage">
      <div class="stage-name">${esc(s.name || s.status_name || '—')}</div>
      <div class="stage-bar"><div class="stage-fill" style="width:${pct}%">${count}</div></div>
    </div>`;
  }).join('')}</div>`;
}

// ── Applicants ──────────────────────────────────────────────────────────
async function viewApplicants(filterId) {
  const fid = filterId || currentFilter || 'all';
  let path = `/my/${ORG}/applicants`;
  if (fid && fid !== 'all') path += `?status=${fid}`;

  const data = await api(path).catch(() => ({ items: [] }));
  const items = data?.items || [];

  setContent(`
    <div class="card">
      <h3>Кандидаты (${data?.total || items.length})</h3>
      <table class="table">
        <thead><tr><th>Кандидат</th><th>Должность</th><th>Компания</th><th>Источник</th><th>Дата</th></tr></thead>
        <tbody>
          ${items.slice(0, 50).map(a => `
            <tr onclick="navTo('applicant','${a.id}')">
              <td><div class="applicant-row">
                <div class="applicant-avatar">${initials(a.first_name, a.last_name)}</div>
                <div><div class="applicant-name">${esc(a.first_name)} ${esc(a.last_name)}</div></div>
              </div></td>
              <td>${esc(a.position || '—')}</td>
              <td>${esc(a.company || '—')}</td>
              <td>${esc(a.account_source?.name || '—')}</td>
              <td>${fmtDate(a.created)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  `);
}

// ── Vacancies ───────────────────────────────────────────────────────────
async function viewVacancies() {
  const data = await api(`/my/${ORG}/vacancies`).catch(() => ({ items: [] }));
  const items = data?.items || [];
  setContent(`
    <div class="card">
      <h3>Вакансии (${items.length})</h3>
      <div class="vacancy-list">
        ${items.map(v => `
          <div class="vacancy-item" onclick="navTo('vacancy','${v.id}')">
            <div>
              <div class="v-title">${esc(v.position)}</div>
              <div class="v-meta">${esc(v.custom_name_data?.account_division?.[0] || '')} · ${v.state === 'OPEN' ? 'В работе' : 'Закрыта'} · ${fmtDate(v.created)}</div>
            </div>
            <span class="badge ${v.state?.toLowerCase()}">${v.state === 'OPEN' ? 'В работе' : 'Закрыта'}</span>
          </div>
        `).join('') || '<p>Нет вакансий</p>'}
      </div>
    </div>
  `);
}

async function viewVacancyDetail(id) {
  const [vac, full, stats, access] = await Promise.all([
    api(`/my/${ORG}/vacancies/${id}`).catch(() => ({})),
    api(`/my/${ORG}/full_vacancy/${id}`).catch(() => ({})),
    api(`/my/${ORG}/vacancy/${id}/stats`).catch(() => ({})),
    api(`/my/${ORG}/vacancy/${id}/access`).catch(() => ({})),
  ]);
  const v = full || vac;
  document.getElementById('pageTitle').textContent = v.position || `Вакансия #${id}`;
  setContent(`
    <button class="back-btn" onclick="navTo('vacancies')">← К вакансиям</button>
    <div class="detail-panel">
      <h2>${esc(v.position)}</h2>
      <div class="detail-grid">
        <div class="detail-field"><div class="field-label">Статус</div><div class="field-value"><span class="badge ${v.state?.toLowerCase()}">${v.state === 'OPEN' ? 'В работе' : 'Закрыта'}</span></div></div>
        <div class="detail-field"><div class="field-label">Подразделение</div><div class="field-value">${esc(v.custom_name_data?.account_division?.[0] || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Создана</div><div class="field-value">${fmtDate(v.created)}</div></div>
        <div class="detail-field"><div class="field-label">Обновлена</div><div class="field-value">${fmtDate(v.updated)}</div></div>
        <div class="detail-field"><div class="field-label">План найма</div><div class="field-value">${v.applicants_to_hire || '—'} чел.</div></div>
        <div class="detail-field"><div class="field-label">Зарплата</div><div class="field-value">${esc(v.money || '—')}</div></div>
      </div>
      ${v.body ? `<h3 style="margin-top:24px">Описание</h3><p>${esc(v.body)}</p>` : ''}
      ${v.requirements ? `<h3 style="margin-top:24px">Требования</h3><p>${esc(v.requirements)}</p>` : ''}
      ${v.conditions ? `<h3 style="margin-top:24px">Условия</h3><p>${esc(v.conditions)}</p>` : ''}
    </div>
  `);
}

// ── Applicant detail ────────────────────────────────────────────────────
async function viewApplicantDetail(id) {
  const [a, log, q] = await Promise.all([
    api(`/my/${ORG}/applicant/${id}`).catch(() => ({})),
    api(`/my/${ORG}/applicant/${id}/log`).catch(() => ({})),
    api(`/my/${ORG}/applicant/${id}/questionary`).catch(() => ({})),
  ]);
  document.getElementById('pageTitle').textContent = `${a.first_name || ''} ${a.last_name || ''}`;
  const logs = log?.items || log || [];
  setContent(`
    <button class="back-btn" onclick="navTo('applicants')">← К кандидатам</button>
    <div class="detail-panel">
      <h2>${esc(a.first_name)} ${esc(a.middle_name || '')} ${esc(a.last_name)}</h2>
      <div class="detail-grid">
        <div class="detail-field"><div class="field-label">Должность</div><div class="field-value">${esc(a.position || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Компания</div><div class="field-value">${esc(a.company || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Email</div><div class="field-value">${esc(a.email || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Телефон</div><div class="field-value">${esc(a.formatted_phone || a.phone || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Дата рождения</div><div class="field-value">${esc(a.birthday || '—')}</div></div>
        <div class="detail-field"><div class="field-label">Создан</div><div class="field-value">${fmtDate(a.created)}</div></div>
      </div>
      ${a.links?.length ? `<h3 style="margin-top:24px">Вакансии</h3><table class="table"><thead><tr><th>Вакансия</th><th>Статус</th><th>Дата</th></tr></thead><tbody>
        ${a.links.map(l => `<tr><td>#${l.vacancy_id}</td><td>${esc(l.vacancy_status || '—')}</td><td>${fmtDate(l.changed)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${logs?.length ? `<h3 style="margin-top:24px">История</h3><table class="table"><thead><tr><th>Дата</th><th>Событие</th></tr></thead><tbody>
        ${logs.slice(0,20).map(l => `<tr><td>${fmtDate(l.created || l.changed)}</td><td>${esc(l.type || l.action || '—')}</td></tr>`).join('')}
      </tbody></table>` : ''}
    </div>
  `);
}

// ── Reports ─────────────────────────────────────────────────────────────
async function viewReports() {
  const body = JSON.stringify({ date_from: '2026-01-01', date_to: '2026-12-31' });
  const [funnel, conv, ttf] = await Promise.all([
    api(`/my/${ORG}/report/preview/funnel`, { method: 'POST', body }).catch(() => null),
    api(`/my/${ORG}/report/preview/funnel_conversion`, { method: 'POST', body }).catch(() => null),
    api(`/my/${ORG}/report/preview/ttf`, { method: 'POST', body }).catch(() => null),
  ]);

  const funnelStages = funnel?.items || funnel?.stages || [];
  setContent(`
    <div class="card"><h3>Воронка найма</h3>${funnelStages.length ? funnelHTML(funnelStages) : '<p>Нет данных</p>'}</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Конверсия</div><div class="value">${conv?.total_conversion ? conv.total_conversion + '%' : '—'}</div></div>
      <div class="stat-card"><div class="label">Time to fill</div><div class="value">${ttf?.avg ? ttf.avg + ' дн.' : '—'}</div></div>
    </div>
    <div class="card"><h3>Детализация воронки</h3>
      <pre style="overflow:auto;font-size:12px;background:#f9fafb;padding:16px;border-radius:8px">${esc(JSON.stringify(funnel || {}, null, 2).slice(0, 3000))}</pre>
    </div>
  `);
}

// ── Calendar ────────────────────────────────────────────────────────────
async function viewCalendar() {
  const data = await api(`/my/${ORG}/calendar`).catch(() => ({}));
  const events = data?.items || data?.events || [];
  setContent(`
    <div class="card"><h3>Календарь</h3>
      ${events.length ? `<table class="table"><thead><tr><th>Событие</th><th>Дата</th><th>Тип</th></tr></thead><tbody>
        ${events.slice(0, 30).map(e => `<tr><td>${esc(e.title || e.name || '—')}</td><td>${fmtDate(e.start || e.date || e.created)}</td><td>${esc(e.type || '—')}</td></tr>`).join('')}
      </tbody></table>` : '<p>Нет событий</p>'}
    </div>
  `);
}

// ── Filters sidebar ─────────────────────────────────────────────────────
async function loadFilters() {
  const el = document.getElementById('filterList');
  if (!el) return;
  const stats = await api(`/my/${ORG}/applicants/status/stats`).catch(() => null);
  const stages = stats?.items || [];
  el.innerHTML = `
    <div class="filter-link ${currentFilter==='all'?'active':''}" onclick="setFilter('all')"><span>Вся база</span></div>
    ${stages.map(s => `<div class="filter-link ${currentFilter==String(s.id)?'active':''}" onclick="setFilter('${s.id}')">
      <span>${esc(s.name || s.status_name || '—')}</span><span class="count">${s.count || 0}</span>
    </div>`).join('')}
  `;
}
function setFilter(f) { currentFilter = f; viewApplicants(f); }

// ── Navigation ──────────────────────────────────────────────────────────
function navTo(view, id) {
  if (view === 'vacancy') { currentView = 'vacancies'; viewVacancyDetail(id); return; }
  if (view === 'applicant') { currentView = 'applicants'; viewApplicantDetail(id); return; }
  currentView = view; render();
}

// ── Utils ───────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c])); }
function initials(f, l) { return ((f?.[0]||'') + (l?.[0]||'')).toUpperCase(); }
function fmtDate(d) { if (!d) return '—'; return String(d).slice(0, 10); }

// ── Init ────────────────────────────────────────────────────────────────
render();
