# Бот лише для своїх — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** бот відповідає лише прив'язаним кредиторам і Дмитру, дає їм «Борги»/«Стан», надсилає особисті сповіщення й нагадування.

**Architecture:** чисті модулі в `bot/` (маршрутизація, тексти, події) з тестами `node:test`; мережеві обгортки — у Vercel-функціях `api/`. Сайт генерує одноразовий код прив'язки, бот (акаунт bot@noxon.local з роллю адміна) перевіряє його й пише `telegram/<uid>`. Математика боргів — із `storage.js` через `bot/load-site.js`.

**Tech Stack:** Node 20 (Vercel, GitHub Actions), Firestore REST, Telegram Bot API, vanilla JS сайту, Firebase compat 10.12.2.

**Spec:** `docs/superpowers/specs/2026-09-25-bot-private-access-design.md`

## Global Constraints

- Жодних секретів у коді: токен бота, BOT_PASSWORD — лише змінні середовища.
- Публічні журнали GitHub Actions: друкувати лише числа, не тексти повідомлень.
- Тексти — українською; HTML parse_mode, усе користувацьке — через `esc`.
- Сайт: після змін — `?v=17`; перед комітом `backend: "firebase"`.
- Файли з CRLF нормалізувати в LF перед правками.

---

### Task 1: Firestore-обгортки + правила

**Files:** Modify `bot/firestore.js`, `firestore.rules`, `bot/firestore.test.js`

**Produces:** `deleteDocument(projectId, docPath, idToken)`; `createDocument(projectId, docPath, fields, idToken)` → `true` (створено) / `false` (вже існує, статус `ALREADY_EXISTS`/`FAILED_PRECONDITION`).

- [ ] Тест: `encodeFields`/`decodeFields` зберігає вкладені мапи (вже є) — додати нічого, мережеві функції тестуються живцем.
- [ ] `deleteDocument` — `DELETE` на `docsUrl/docPath`, 404 вважати успіхом.
- [ ] `createDocument` — `patchDocument(..., { mustNotExist: true })`, ловити `err.status` ∈ {ALREADY_EXISTS, FAILED_PRECONDITION} → `false`.
- [ ] Правила `tglinks`, `telegram`, `tgsent` дослівно за специфікацією (розділ «Правила бази»).
- [ ] `firebase deploy --only firestore:rules`; живі атаки: чужий uid у `tglinks` → відмова; не-адмін пише `telegram/<свій>` → відмова; читання чужого `telegram` → відмова.

### Task 2: Чиста логіка бота — `bot/access.js`

**Files:** Create `bot/access.js`, `bot/access.test.js`

**Produces:**
- `parseStartCode(text)` → код `[A-Za-z0-9]{24,48}` або `null`.
- `routeMessage(text)` → `{ type: "start", code } | "debts" | "status" | "help" | "unlink" | "zayavky" | "unknown" }`. Кнопки: «📋 Борги» → debts, «📊 Стан» → status, «ℹ️ Допомога» → help; команди `/borhy`, `/stan`, `/help`, `/start`, `/vidvyazaty`, `/zayavky` (з `@бот` суфіксом теж).
- `findMember(chatId, links, users)` → `{ uid, user }` лише якщо `links` має `chatId` (рядок), користувач існує, `active === true`, роль ∈ member/admin/subject; інакше `null`.

- [ ] Тести: код рівно 24/48 символів, закороткий, з дефісом; кнопки й команди з `@noxonV2_bot`; `findMember` для вимкненого, `disabled`, неприв'язаного, числового chatId.
- [ ] Реалізація, `node --test bot/access.test.js` — PASS, коміт.

### Task 3: Тексти — `bot/views.js`

**Files:** Create `bot/views.js`, `bot/views.test.js`; Modify `bot/load-site.js` (повертати також `Store`)

**Produces:** `withDebts(site, debts)` кладе debts у `Store.state.debts` і повертає `calc`; `creditorDebtsText(debts, uid, calc, hero)`, `subjectDebtsText(debts, calc)`, `statusText(debts, calc)`, `welcomeText(user, hero)`, `helpText(role)`, `menuKeyboard()` (reply keyboard 3 кнопки), `linksKeyboard({ siteUrl, payUrl, pay })`, `PRIVATE_TEXT`.

- [ ] Тести: кредитор бачить лише свої відкриті + «на розгляді»; «нічого не винен» коли порожньо; Дмитро бачить чергу з «прострочено N днів»; статус із сумами й «індекс надійності —» коли немає даних; спецсимволи екрануються.
- [ ] Реалізація, тести PASS, коміт.

### Task 4: Події — `bot/events.js`

**Files:** Create `bot/events.js`, `bot/events.test.js`

**Produces:** `collectEvents(debts, users, calc, hero)` → `[{ key, uid, text }]` за таблицею специфікації; `uid` Дмитра — перший активний `role === "subject"`.

- [ ] Тести: approved → `st_<id>_approved` кредитору + `new_<id>` Дмитру; rejected → лише `st_`; pending → нічого; claim → `cl_<id>_<ts>`; кожен платіж → `pay_<id>_<ts>`, останній, що закрив борг, згадує «борг закрито»; без Дмитра — події для нього пропускаються.
- [ ] Реалізація, тести PASS, коміт.

### Task 5: Розсилка — `bot/dispatch.js` + `api/notify.js`

**Files:** Create `bot/dispatch.js`; Modify `api/notify.js`

**Produces:** `loadWorld(s)` → `{ debts, users, links, subject }`; `sendEvents(s, token, world)` → `{ sent, skipped }` (baseline, замок `createDocument`, відкат `deleteDocument` при помилці Telegram); `chatOf(links, uid)`.

- [ ] `api/notify` = старі заявки адміну + `sendEvents`. Коміт.

### Task 6: Webhook — `api/telegram.js`

**Files:** Modify `api/telegram.js`, `bot/moderation.js` (routeUpdate лишається для callback адміна)

- [ ] Callback: як було (лише адмін), після рішення — `sendEvents`.
- [ ] Повідомлення: `start` з кодом → прив'язка (повтор через 1,5 с, вік ≤ 15 хв, активність, прибрати інші прив'язки цього чату, видалити код); адмін-чат + `zayavky` → список; `findMember` → debts/status/help/unlink; інакше `PRIVATE_TEXT` + кнопка на сайт.
- [ ] `bot/set-webhook.js`: команди borhy, stan, help, vidvyazaty. Коміт.

### Task 7: Нагадування через Vercel

**Files:** Create `api/remind.js`, `bot/remind-trigger.js`; Modify `bot/reminders.js` (`remindSecret`, `creditorReminder`), `bot/reminders.test.js`, `.github/workflows/remind.yml`; Delete `bot/remind.js`

- [ ] Тести: `remindSecret` детермінований і ≠ webhookSecret; `creditorReminder` бере лише свої борги на 0/1 день.
- [ ] `api/remind`: заголовок, режими normal/test, позначки `rem_<дата>_<uid>`.
- [ ] `remind-trigger.js`: 9-та година за Києвом (крім test), POST, друк лише лічильників. Workflow: тести всіх `bot/*.test.js` + тригер. Коміт.

### Task 8: Сайт

**Files:** Modify `config.js` (`botUsername`), `storage.js`, `app.js`, `index.html`, `style.css`

- [ ] Store: `tgCode()`, `linkTelegram(code)`, `unlinkTelegram()`, `tg` (стан прив'язки через `onSnapshot` на `telegram/<uid>`), `ping()` після approve/reject/claim/confirm/deny/addDebt.
- [ ] UI: рядок «Telegram-бот» у картці «Оплата і підтримка»; гість не бачить; демо — підказка «лише в хмарній версії».
- [ ] `?v=17`, перевірка в демо, коміт.

### Task 9: Випуск

- [ ] Усі тести, правила задеплоєні, merge у main, push, перевірка Vercel.
- [ ] Запустити workflow «Підключити бота» (оновити команди).
- [ ] README: розділ про прив'язку.
