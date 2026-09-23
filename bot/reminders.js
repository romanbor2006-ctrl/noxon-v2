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

// null — надсилати нічого; інакше HTML-текст для Telegram (parse_mode: HTML)
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

// Кнопки під нагадуванням: посилання, тож сервер для них не потрібен
function buildKeyboard({ payUrl, siteUrl }) {
  const row = [];
  if (payUrl) row.push({ text: "💸 Віддати", url: payUrl });
  if (siteUrl) row.push({ text: "🔗 Відкрити сайт", url: siteUrl });
  return { inline_keyboard: [row] };
}

module.exports = { GROUPS, pickDue, nextDue, formatMessage, buildKeyboard, money, esc };
