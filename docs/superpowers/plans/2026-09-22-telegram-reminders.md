# Telegram-бот нагадувань — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Щодня о 9:00 за Києвом надсилати в Telegram одне повідомлення про борги Дмитра, до дати повернення яких лишилось 3, 1 або 0 днів.

**Architecture:** Node-скрипт у папці `bot/`, який запускає GitHub Actions за розкладом. Скрипт заходить у Firebase анонімно через REST, читає `debts` і `site/subject`, рахує дні й залишки функціями `storage.js` сайту (завантаженими через `node:vm`) і шле текст через Telegram Bot API.

**Tech Stack:** Node 20+ (`fetch`, `node:test`, `node:vm`), без npm-залежностей; Firebase Auth REST, Firestore REST, Telegram Bot API; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-telegram-reminders-design.md`

## Global Constraints

- Node 20+, жодних npm-залежностей, жодного `package.json`.
- Пороги рівно 0, 1, 3 днів; назви груп: «Сьогодні», «Завтра», «Через 3 дні».
- Час надсилання: 9-та година за `Europe/Kyiv`; розклад `0 6 * * *` і `0 7 * * *` (UTC).
- Секрети: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Ні в код, ні в журнали.
- Текст повідомлення **не друкується** в журнал GitHub Actions (репозиторій публічний, журнали теж) — лише в `--dry-run`.
- Увесь текст із бази в повідомленні екранується: `&`, `<`, `>`.
- Сайт `https://noxon-app.vercel.app`.
- Коміти закінчуються рядком `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Файл | Відповідальність |
|---|---|
| `bot/load-site.js` | виконує `config.js` і `storage.js` сайту в `vm`, віддає `{ CONFIG, calc }` |
| `bot/reminders.js` | чиста логіка: `pickDue`, `nextDue`, `formatMessage`, `money`, `esc` |
| `bot/reminders.test.js` | тести логіки |
| `bot/firestore.js` | `signInAnonymously`, `listCollection`, `getDocument`, `decodeFields`, `decodeDocument` |
| `bot/firestore.test.js` | тести декодування REST-значень |
| `bot/telegram.js` | `sendMessage` |
| `bot/remind.js` | точка входу: аргументи, година, збирання |
| `bot/chat-id.js` | допоміжний: показує chat ID за токеном |
| `.github/workflows/remind.yml` | розклад, ручний запуск, тести перед надсиланням |
| `README.md` | розділ «Telegram-нагадування» |

---

### Task 1: Завантаження математики сайту й відбір боргів

**Files:**
- Create: `bot/load-site.js`, `bot/reminders.js`
- Test: `bot/reminders.test.js`

**Interfaces:**
- Produces: `loadSite(): { CONFIG, calc }`, де `calc` — `Store.calc` сайту (`isOpen(d)`, `left(d)`, `paid(d)`, `daysLeft(d)`, `today()`, `iso(date)`).
- Produces: `pickDue(debts, calc): Array<{ days: 0|1|3, title: string, debts: Debt[] }>` — лише непорожні групи в порядку 0, 1, 3; у групі — від більшого залишку.
- Produces: `nextDue(debts, calc): Debt | null` — найближчий відкритий борг із `daysLeft >= 0`.

- [ ] **Step 1: Тести відбору**

```js
// bot/reminders.test.js
process.env.TZ = "Europe/Kyiv";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSite } = require("./load-site");
const { pickDue, nextDue } = require("./reminders");

const { calc } = loadSite();
const t = calc.today();
const at = (n) => calc.iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
let seq = 0;
const debt = (over) => ({
  id: "d" + ++seq, amount: 1000, reason: "тест", creditor: "Ростик", creditorUid: "u1",
  author: "Ростик", status: "approved", payments: [], claim: null, due: at(0), ts: Date.now(), ...over,
});

test("бере 0, 1 і 3 дні й розкладає по групах", () => {
  const groups = pickDue([debt({ due: at(3) }), debt({ due: at(0) }), debt({ due: at(1) })], calc);
  assert.deepEqual(groups.map((g) => [g.days, g.title, g.debts.length]),
    [[0, "Сьогодні", 1], [1, "Завтра", 1], [3, "Через 3 дні", 1]]);
});

test("пропускає 2 дні, прострочене, закрите, pending і rejected", () => {
  const groups = pickDue([
    debt({ due: at(2) }),
    debt({ due: at(-1) }),
    debt({ due: at(0), payments: [{ amount: 1000, ts: 1 }] }),
    debt({ due: at(0), status: "pending" }),
    debt({ due: at(1), status: "rejected" }),
  ], calc);
  assert.deepEqual(groups, []);
});

test("у групі — від більшого залишку", () => {
  const [g] = pickDue([debt({ amount: 200 }), debt({ amount: 900 })], calc);
  assert.deepEqual(g.debts.map((d) => d.amount), [900, 200]);
});

test("nextDue — найближчий відкритий борг без простроченого", () => {
  const near = debt({ due: at(5) });
  assert.equal(nextDue([debt({ due: at(-2) }), debt({ due: at(9) }), near], calc), near);
  assert.equal(nextDue([debt({ due: at(-2) })], calc), null);
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `node --test bot/reminders.test.js`
Expected: FAIL — `Cannot find module './load-site'`.

- [ ] **Step 3: Реалізація**

```js
// bot/load-site.js
/* Завантажує config.js і storage.js сайту в Node, щоб бот рахував борги
   тими самими функціями, що й сторінка. Браузер імітуємо мінімально:
   storage.js на старті потребує лише window і addEventListener, а
   localStorage чіпає ліниво й у try. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SITE_DIR = path.join(__dirname, "..");

function loadSite() {
  const ctx = { console, addEventListener() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of ["config.js", "storage.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SITE_DIR, file), "utf8"), ctx, { filename: file });
  }
  return { CONFIG: ctx.CONFIG, calc: ctx.Store.calc };
}

module.exports = { loadSite };
```

```js
// bot/reminders.js
/* Чиста логіка нагадувань: що горить і яким текстом про це сказати.
   Нічого не знає ні про Firebase, ні про Telegram. */

const GROUPS = [
  { days: 0, title: "Сьогодні" },
  { days: 1, title: "Завтра" },
  { days: 3, title: "Через 3 дні" },
];

function pickDue(debts, calc) {
  return GROUPS
    .map((g) => ({
      days: g.days,
      title: g.title,
      debts: debts
        .filter((d) => calc.isOpen(d) && calc.daysLeft(d) === g.days)
        .sort((a, b) => calc.left(b) - calc.left(a)),
    }))
    .filter((g) => g.debts.length > 0);
}

function nextDue(debts, calc) {
  return debts
    .filter((d) => calc.isOpen(d) && calc.daysLeft(d) >= 0)
    .sort((a, b) => calc.daysLeft(a) - calc.daysLeft(b))[0] || null;
}

module.exports = { GROUPS, pickDue, nextDue };
```

- [ ] **Step 4: Тести проходять**

Run: `node --test bot/reminders.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit** — `git add bot/load-site.js bot/reminders.js bot/reminders.test.js`, повідомлення «Бот: відбір боргів за 3/1/0 днів на математиці сайту».

---

### Task 2: Текст повідомлення

**Files:**
- Modify: `bot/reminders.js`
- Test: `bot/reminders.test.js`

**Interfaces:**
- Consumes: `pickDue`, `nextDue` (Task 1).
- Produces: `formatMessage(groups, { calc, heroName, siteUrl, test, next }): string | null` — `null`, коли груп немає й `test` false. Також `money(n)`, `esc(s)`.

- [ ] **Step 1: Тести тексту** (дописати в `bot/reminders.test.js`)

```js
const { formatMessage, money } = require("./reminders");
const SITE = "https://noxon-app.vercel.app";
const fmt = (debts, opts = {}) =>
  formatMessage(pickDue(debts, calc), { calc, heroName: "Дмитро", siteUrl: SITE, next: nextDue(debts, calc), ...opts });

test("normal: нічого не горить — null", () => {
  assert.equal(fmt([debt({ due: at(5) })]), null);
});

test("test: нічого не горить — найближчий борг", () => {
  const text = fmt([debt({ due: at(5), amount: 700, reason: "кава" })], { test: true });
  assert.match(text, /тестовий запуск/);
  assert.match(text, /Нічого не горить\./);
  assert.ok(text.includes(`Найближче: Ростик — ${money(700)} за «кава», через 5 днів.`));
});

test("групи, залишок, разом і посилання", () => {
  const text = fmt([debt({ due: at(0), amount: 1500, reason: "шаурма" }), debt({ due: at(3), amount: 6000, creditor: "Олег" })]);
  assert.ok(text.startsWith("🔺 <b>noxon: наближаються дати повернення</b>"));
  assert.ok(text.includes(`<b>Сьогодні</b>\n• Ростик — ${money(1500)} за «шаурма»`));
  assert.ok(text.includes(`<b>Через 3 дні</b>\n• Олег — ${money(6000)}`));
  assert.ok(!text.includes("Завтра"));
  assert.ok(text.includes(`Разом у ці три дні: ${money(7500)}`));
  assert.ok(text.endsWith(SITE));
});

test("частковий платіж і висяча заявка", () => {
  const text = fmt([debt({ amount: 1500, payments: [{ amount: 500, ts: 1 }], claim: { amount: 300, ts: 2 } })]);
  assert.ok(text.includes(`• Ростик — ${money(1000)} за «тест»`));
  assert.ok(text.includes(`(з ${money(1500)} уже повернуто ${money(500)})`));
  assert.ok(text.includes(`(Дмитро заявив, що віддав ${money(300)}, — чекає підтвердження)`));
});

test("екранує текст із бази", () => {
  const text = fmt([debt({ reason: "<b>x</b> & y", creditor: "<i>Ро</i>" })]);
  assert.ok(text.includes("• &lt;i&gt;Ро&lt;/i&gt; —"));
  assert.ok(text.includes("«&lt;b&gt;x&lt;/b&gt; &amp; y»"));
});
```

- [ ] **Step 2: Падають** — `node --test bot/reminders.test.js` → FAIL: `formatMessage is not a function`.

- [ ] **Step 3: Реалізація** (дописати в `bot/reminders.js` перед `module.exports` і розширити експорт)

```js
const nf = new Intl.NumberFormat("uk-UA");
const money = (n) => nf.format(n) + " ₴";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const inDays = (n) => n === 0 ? "сьогодні" : n === 1 ? "завтра" : `через ${n} ${plural(n, "день", "дні", "днів")}`;

function debtLines(d, calc, heroName) {
  const lines = [`• ${esc(d.creditor)} — ${money(calc.left(d))} за «${esc(d.reason)}»`];
  const paid = calc.paid(d);
  if (paid > 0) lines.push(`  (з ${money(d.amount)} уже повернуто ${money(paid)})`);
  if (d.claim) lines.push(`  (${esc(heroName)} заявив, що віддав ${money(d.claim.amount)}, — чекає підтвердження)`);
  return lines;
}

function formatMessage(groups, { calc, heroName = "Герой сайту", siteUrl, test = false, next = null }) {
  const head = test ? "🧪 <b>noxon: тестовий запуск</b>\n\n" : "";
  if (!groups.length) {
    if (!test) return null;
    const tail = next
      ? `Найближче: ${esc(next.creditor)} — ${money(calc.left(next))} за «${esc(next.reason)}», ${inDays(calc.daysLeft(next))}.`
      : "Відкритих боргів із майбутньою датою немає.";
    return `${head}Нічого не горить.\n${tail}\n\n${siteUrl}`;
  }
  let total = 0;
  const parts = [`${head}🔺 <b>noxon: наближаються дати повернення</b>`];
  for (const g of groups) {
    const lines = [`<b>${g.title}</b>`];
    for (const d of g.debts) {
      lines.push(...debtLines(d, calc, heroName));
      total += calc.left(d);
    }
    parts.push(lines.join("\n"));
  }
  parts.push(`Разом у ці три дні: ${money(total)}`, siteUrl);
  return parts.join("\n\n");
}

module.exports = { GROUPS, pickDue, nextDue, formatMessage, money, esc };
```

- [ ] **Step 4: Проходять** — `node --test bot/reminders.test.js` → 9 passing.
- [ ] **Step 5: Commit** — «Бот: текст повідомлення з групами, залишками й екрануванням».

---

### Task 3: Читання Firestore через REST

**Files:**
- Create: `bot/firestore.js`
- Test: `bot/firestore.test.js`

**Interfaces:**
- Produces: `decodeFields(fields): object`, `decodeDocument(doc): { id, ...fields }`, `signInAnonymously(apiKey): Promise<string idToken>`, `listCollection(projectId, collection, idToken): Promise<object[]>`, `getDocument(projectId, docPath, idToken): Promise<object | null>`.

- [ ] **Step 1: Тести декодування**

```js
// bot/firestore.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeDocument } = require("./firestore");

test("розбирає типізовані значення Firestore REST", () => {
  const doc = decodeDocument({
    name: "projects/p/databases/(default)/documents/debts/abc123",
    fields: {
      amount: { integerValue: "1500" },
      reason: { stringValue: "шаурма" },
      claim: { nullValue: null },
      ok: { booleanValue: true },
      rate: { doubleValue: 1.5 },
      payments: { arrayValue: { values: [{ mapValue: { fields: { amount: { integerValue: "500" }, ts: { integerValue: "17" } } } }] } },
      empty: { arrayValue: {} },
    },
  });
  assert.deepEqual(doc, {
    id: "abc123", amount: 1500, reason: "шаурма", claim: null, ok: true, rate: 1.5,
    payments: [{ amount: 500, ts: 17 }], empty: [],
  });
});
```

- [ ] **Step 2: Падає** — `node --test bot/firestore.test.js` → FAIL: `Cannot find module './firestore'`.

- [ ] **Step 3: Реалізація**

```js
// bot/firestore.js
/* Firebase для бота — лише через REST: анонімний вхід (як «Увійти як
   гість» на сайті) і читання документів. Правила бази дають гостю
   читати debts і site, тож ключі сервісного акаунта не потрібні. */

function decodeValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  return undefined;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

function decodeDocument(doc) {
  return { id: doc.name.split("/").pop(), ...decodeFields(doc.fields) };
}

const docsUrl = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase: анонімний вхід не вдався (${(body.error && body.error.message) || res.status}).`);
  return body.idToken;
}

async function readJson(url, idToken, what) {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + idToken } });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firestore: не вдалося прочитати ${what} (${(body.error && body.error.status) || res.status}).`);
  return body;
}

async function listCollection(projectId, collection, idToken) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${docsUrl(projectId)}/${collection}?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const body = (await readJson(url, idToken, collection)) || {};
    for (const doc of body.documents || []) out.push(decodeDocument(doc));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function getDocument(projectId, docPath, idToken) {
  const body = await readJson(`${docsUrl(projectId)}/${docPath}`, idToken, docPath);
  return body ? decodeDocument(body) : null;
}

module.exports = { decodeFields, decodeDocument, signInAnonymously, listCollection, getDocument };
```

- [ ] **Step 4: Проходить** — `node --test bot/firestore.test.js` → 1 passing.
- [ ] **Step 5: Commit** — «Бот: читання Firestore через REST як гість».

---

### Task 4: Telegram і точка входу; сухий прогін на живій базі

**Files:**
- Create: `bot/telegram.js`, `bot/remind.js`, `bot/chat-id.js`

**Interfaces:**
- Consumes: `loadSite` (T1), `pickDue`/`nextDue`/`formatMessage` (T1–2), `signInAnonymously`/`listCollection`/`getDocument` (T3).
- Produces: CLI `node bot/remind.js [--dry-run] [--mode=normal|test]`; змінні середовища `REMIND_MODE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TZ`.

- [ ] **Step 1: `bot/telegram.js`**

```js
// bot/telegram.js
/* Надсилання в Telegram. Адреса містить токен, тому її ніде не друкуємо. */
async function sendMessage(token, chatId, html) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.ok) return;
  const hint = {
    401: " Перевір секрет TELEGRAM_BOT_TOKEN.",
    400: " Перевір секрет TELEGRAM_CHAT_ID.",
    403: " Відкрий бота в Telegram і натисни Start.",
  }[body.error_code] || "";
  throw new Error(`Telegram: ${body.description || res.status}.${hint}`);
}

module.exports = { sendMessage };
```

- [ ] **Step 2: `bot/remind.js`**

```js
// bot/remind.js
/* Щоденне нагадування: що горить — одним повідомленням у Telegram.
   node bot/remind.js [--dry-run] [--mode=normal|test]
   normal — лише о 9-й за Києвом і лише якщо щось горить;
   test   — завжди, навіть коли нічого не горить;
   --dry-run — нічого не надсилає, друкує текст (секрети не потрібні). */
process.env.TZ = process.env.TZ || "Europe/Kyiv";

const { loadSite } = require("./load-site");
const { signInAnonymously, listCollection, getDocument } = require("./firestore");
const { pickDue, nextDue, formatMessage } = require("./reminders");
const { sendMessage } = require("./telegram");

const SITE_URL = "https://noxon-app.vercel.app";
const SEND_HOUR = 9;

function kyivHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(now));
}

function parseArgs(argv) {
  const flag = argv.find((a) => a.startsWith("--mode="));
  const mode = (flag ? flag.slice("--mode=".length) : process.env.REMIND_MODE) || "normal";
  if (!["normal", "test"].includes(mode)) throw new Error(`Невідомий режим «${mode}»: має бути normal або test.`);
  return { mode, dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { mode, dryRun } = parseArgs(process.argv.slice(2));

  if (mode === "normal" && !dryRun && kyivHour() !== SEND_HOUR) {
    console.log(`У Києві зараз ${kyivHour()}-та година, надсилаємо о ${SEND_HOUR}:00 — пропускаю.`);
    return;
  }

  const { CONFIG, calc } = loadSite();
  const { apiKey, projectId } = CONFIG.firebase;
  const idToken = await signInAnonymously(apiKey);
  const [debts, subject] = await Promise.all([
    listCollection(projectId, "debts", idToken),
    getDocument(projectId, "site/subject", idToken),
  ]);

  const heroName = subject && subject.name ? subject.name.split(" ")[0] : "Герой сайту";
  const groups = pickDue(debts, calc);
  const text = formatMessage(groups, { calc, heroName, siteUrl: SITE_URL, test: mode === "test", next: nextDue(debts, calc) });

  // Лише числа: журнали GitHub Actions публічного репозиторію видно всім.
  console.log(`Боргів у базі: ${debts.length}. Горить: ${groups.reduce((s, g) => s + g.debts.length, 0)}.`);
  if (!text) { console.log("Нічого не горить — не надсилаю."); return; }
  if (dryRun) { console.log("\n" + text); return; }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("Немає секрету TELEGRAM_BOT_TOKEN.");
  if (!chatId) throw new Error("Немає секрету TELEGRAM_CHAT_ID.");
  await sendMessage(token, chatId, text);
  console.log("Надіслано в Telegram.");
}

main().catch((err) => {
  console.error("Помилка: " + err.message);
  process.exitCode = 1;
});
```

- [ ] **Step 3: `bot/chat-id.js`**

```js
// bot/chat-id.js
/* Показує chat ID людей, які натиснули Start у боті.
   TELEGRAM_BOT_TOKEN=... node bot/chat-id.js   (запускає людина сама) */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error("Задай TELEGRAM_BOT_TOKEN у змінних середовища."); process.exit(1); }

fetch(`https://api.telegram.org/bot${token}/getUpdates`)
  .then((r) => r.json())
  .then((body) => {
    if (!body.ok) throw new Error(body.description);
    const chats = new Map();
    for (const u of body.result) {
      const chat = (u.message || u.edited_message || {}).chat;
      if (chat) chats.set(chat.id, [chat.first_name, chat.last_name, chat.username && "@" + chat.username].filter(Boolean).join(" "));
    }
    if (!chats.size) console.log("Порожньо: відкрий бота в Telegram, натисни Start і запусти ще раз.");
    for (const [id, who] of chats) console.log(`${id}  ${who}`);
  })
  .catch((err) => { console.error("Помилка: " + err.message); process.exitCode = 1; });
```

- [ ] **Step 4: Перевірки**

Run: `node --test bot/reminders.test.js bot/firestore.test.js` → усі проходять.
Run: `node bot/remind.js --dry-run` → «Боргів у базі: N. Горить: M.» і або «Нічого не горить — не надсилаю.», або текст.
Run: `node bot/remind.js --dry-run --mode=test` → завжди текст із «тестовий запуск».
Run: `node bot/remind.js --mode=bogus` → «Помилка: Невідомий режим…», код виходу 1.

- [ ] **Step 5: Commit** — «Бот: надсилання в Telegram і точка входу».

---

### Task 5: GitHub Actions, документація й бойовий тест

**Files:**
- Create: `.github/workflows/remind.yml`
- Modify: `README.md` (новий розділ перед «## Публікація»)

- [ ] **Step 1: Workflow**

```yaml
# .github/workflows/remind.yml
name: Нагадування в Telegram

on:
  schedule:
    # 06:00 і 07:00 UTC: одне з них — 9:00 у Києві і влітку, і взимку.
    # Скрипт сам пропускає запуск, що не припав на 9-ту.
    - cron: "0 6 * * *"
    - cron: "0 7 * * *"
  workflow_dispatch:
    inputs:
      mode:
        description: "test — надіслати завжди; normal — як щоранку"
        type: choice
        options: [test, normal]
        default: test

permissions:
  contents: read

jobs:
  remind:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Тести
        run: node --test bot/reminders.test.js bot/firestore.test.js
        env:
          TZ: Europe/Kyiv
      - name: Нагадування
        run: node bot/remind.js
        env:
          TZ: Europe/Kyiv
          REMIND_MODE: ${{ github.event.inputs.mode || 'normal' }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 2: README** — розділ «## Telegram-нагадування»: що робить, секрети, ручний запуск (Actions → «Нагадування в Telegram» → Run workflow → test), локально `node bot/remind.js --dry-run`, як змінити отримувача (секрет `TELEGRAM_CHAT_ID`), обмеження (затримка, 60 днів).

- [ ] **Step 3: Commit і push** — «Бот: щоденний запуск у GitHub Actions».

- [ ] **Step 4: Бойовий тест** — людина (або агент через браузер) у GitHub → Actions → «Нагадування в Telegram» → Run workflow → `test`. Очікування: зелений запуск, у журналі «Надіслано в Telegram.», повідомлення «🧪 noxon: тестовий запуск» у Telegram у Романа.
