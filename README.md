# Huntflow Clone — ATS

Клон [Хантфлоу](https://huntflow.ru) (Applicant Tracking System), реконструированный из записанного трафика.

## Что внутри

- **116 API-эндпоинтов** — записаны через mitmproxy при навигации по реальному Хантфлоу (3 раунда)
- **OpenAPI 3.0 спека** —(916KB) — сгенерирована через mitmproxy2swagger
- **Backend** — Node.js + Express, обслуживает записанные ответы API
- **Frontend** — SPA на vanilla JS: login, Картина дня, Кандидаты, Вакансии, Аналитика, Календарь
- **Docker** — docker-compose для деплоя

## Быстрый старт

```bash
./start.sh          # локально (порт 3360)
./start.sh docker   # через Docker
```

→ http://localhost:3360

Логин: любой email + пароль.

## Структура

```
huntflow-clone/
├── capture/              # сырые данные записи
│   ├── huntflow-capture.mitm   (192MB — mitmproxy стрим)
│   ├── huntflow-session.har    (318MB — HAR)
│   └── crawl-log.json          (80 страниц обхода)
├── analysis/
│   ├── openapi-v1.yaml         (916KB — OpenAPI 3.0)
│   ├── api-endpoints.json      (103 эндпоинта)
│   └── sample-responses/       (102 sample-ответа API)
├── server/               # backend
│   ├── index.mjs               # Express сервер
│   ├── data/route-map.json     # карта API → ответы
│   └── package.json
├── web/                  # frontend SPA
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── scripts/
│   └── crawl-readonly.mjs      # CDP краулер
├── docker-compose.yml
├── Dockerfile
└── start.sh
```

## Как было записано

1. **mitmproxy** на порту 8082 перехватывал HTTPS-трафик
2. **Chrome** с прокси + CDP (порт 9223) открыл https://huntflow.ru/login
3. Пользователь залогинился и прошёл по разделам
4. **CDP-краулер** дополнительно обошёл 80 страниц (read-only, без правок)
5. **mitmproxy2swagger** сгенерировал OpenAPI-спеку из HAR
6. **Backend** обслуживает записанные ответы; **frontend** рендерит UI

## API покрытие

| Раздел | Эндпоинты |
|--------|-----------|
| Кандидаты | applicants, applicant/{id}, log, questionary, count, stats |
| Вакансии | vacancies, vacancies/{id}, full_vacancy, status, fields, access |
| Воронки | pipelines (13 воронок с этапами) |
| Аналитика | report/preview/funnel, conversion, ttf, recruiter |
| Календарь | calendar, calendar/event |
| Справочники | dict/*, system-dictionary/*, source, tag |
| Настройки | permissions, feature-flags, settings, license |
| Пользователи | account/member, colleague, dashboard/recruiters |
