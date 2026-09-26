/* Заявка на борг через бота — покроковий діалог, чиста логіка без мережі.
   Кроки: сума → за що → до якої дати → підтвердження. Чернетка
   лежить у tgdraft/<uid>; тут лише розбір відповідей і тексти. */
const { money, esc } = require("./reminders");
const { dmy } = require("./views");

const AMOUNT_MAX = 100000;
const REASON_MAX = 80;
const DRAFT_TTL = 30 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// "500", "1 500", "1500 грн", "500₴" → 500; інше — null
function parseAmount(text) {
  const t = String(text || "").replace(/[\s  ]/g, "").replace(/(грн\.?|₴|uah)$/i, "");
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= AMOUNT_MAX ? n : null;
}

/* "10.10", "10.10.2026", "10/10/26", "2026-10-10" → ISO-дата.
   Без року: якщо цей день уже минув — наступний рік.
   { iso } | { error } */
function parseDue(text, now = new Date()) {
  const t = String(text || "").trim();
  const today = dayOf(now);
  let y, m, d, yearGiven = true;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(t))) {
    [d, m] = [+r[1], +r[2]];
    if (r[3]) y = r[3].length === 2 ? 2000 + +r[3] : +r[3];
    else { y = today.getFullYear(); yearGiven = false; }
  } else return { error: "Не розібрав дату. Напиши, наприклад, 10.10 або 10.10.2026." };

  let date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return { error: "Такої дати немає." };
  if (!yearGiven && date < today) date = new Date(y + 1, m - 1, d);
  if (date < today) return { error: "Ця дата вже минула." };
  if (date > addDays(today, 730)) return { error: "Не далі ніж на два роки вперед." };
  return { iso: iso(date) };
}

function startDraft(nonce, now = Date.now()) {
  return { step: "amount", nonce, ts: now };
}

const expired = (draft, now = Date.now()) => !draft || now - draft.ts > DRAFT_TTL;

/* Відповідь людини на поточний крок → { draft } з наступним кроком або { error }.
   Крок "due" приймає і текст, і ISO-дату з кнопки. */
function applyInput(draft, input, now = new Date()) {
  const next = (patch) => ({ draft: { ...draft, ...patch, ts: now.getTime() } });
  if (draft.step === "amount") {
    const amount = parseAmount(input);
    return amount ? next({ step: "reason", amount }) : { error: `Сума — ціле число від 1 до ${money(AMOUNT_MAX)}.` };
  }
  if (draft.step === "reason") {
    const reason = String(input || "").trim().replace(/\s+/g, " ");
    if (!reason || reason.startsWith("/")) return { error: "Напиши словами, за що борг." };
    if (reason.length > REASON_MAX) return { error: `Коротше: до ${REASON_MAX} символів (зараз ${reason.length}).` };
    return next({ step: "due", reason });
  }
  if (draft.step === "due") {
    const r = parseDue(input, now);
    return r.iso ? next({ step: "confirm", due: r.iso }) : { error: r.error };
  }
  return { error: "Натисни «Надіслати» або «Скасувати»." };
}

const CANCEL = { text: "❌ Скасувати", callback_data: "nb:cancel" };

// Питання для поточного кроку: { text, keyboard }
function prompt(draft, hero, now = new Date()) {
  const today = dayOf(now);
  if (draft.step === "amount") {
    return { text: `➕ <b>Нова заявка</b>\nСкільки ${esc(hero)} тобі винен? Напиши суму числом, наприклад <code>500</code>.`,
      keyboard: { inline_keyboard: [[CANCEL]] } };
  }
  if (draft.step === "reason") {
    return { text: `Сума: <b>${money(draft.amount)}</b>\nЗа що? Коротко, до ${REASON_MAX} символів.`,
      keyboard: { inline_keyboard: [[CANCEL]] } };
  }
  if (draft.step === "due") {
    const opts = [["Через тиждень", 7], ["Через 2 тижні", 14], ["Через місяць", 30]]
      .map(([text, n]) => ({ text, callback_data: "nb:due:" + iso(addDays(today, n)) }));
    return { text: `До якої дати ${esc(hero)} має повернути? Обери або напиши, наприклад <code>10.10</code>.`,
      keyboard: { inline_keyboard: [opts, [CANCEL]] } };
  }
  return { text: cardText(draft, hero), keyboard: { inline_keyboard: [[
    { text: "✅ Надіслати", callback_data: "nb:send" }, CANCEL]] } };
}

function cardText(draft, hero) {
  return `➕ <b>Перевір заявку</b>\n${money(draft.amount)} за «${esc(draft.reason)}»\n`
    + `${esc(hero)} має повернути до ${dmy(draft.due)}.`;
}

// Документ боргу — рівно такий, як із форми на сайті
function debtFromDraft(draft, user, uid, now = Date.now()) {
  return {
    amount: draft.amount, reason: draft.reason,
    creditor: user.name, creditorUid: uid, author: user.name,
    due: draft.due, status: "pending", payments: [], claim: null, ts: now,
  };
}

// nb:cancel | nb:send | nb:due:YYYY-MM-DD → { action, due? } або null
function parseDraftCallback(data) {
  const m = /^nb:(cancel|send|due:(\d{4}-\d{2}-\d{2}))$/.exec(data || "");
  if (!m) return null;
  return m[2] ? { action: "due", due: m[2] } : { action: m[1] };
}

module.exports = {
  parseAmount, parseDue, startDraft, expired, applyInput, prompt, cardText,
  debtFromDraft, parseDraftCallback, DRAFT_TTL,
};
