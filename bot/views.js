/* Тексти й клавіатури бота — чиста логіка без мережі.
   Загальні підсумки беруться з calc сайту: перед викликом statusText
   і subjectDebtsText дані кладе в стан withData(). */
const { money, esc, plural, inDays } = require("./reminders");

const dmy = (iso) => { const [y, m, d] = String(iso).split("-"); return `${d}.${m}.${y}`; };

function whenText(days) {
  if (days < 0) return `прострочено ${-days} ${plural(-days, "день", "дні", "днів")}`;
  return inDays(days);
}

const PRIVATE_TEXT = "🔒 Це приватний бот noxon — лише для своїх.\n"
  + "Щоб користуватися, увійди на сайт і натисни «Підключити Telegram».";

// Що герой сайту винен саме цьому кредитору
function creditorDebtsText(debts, uid, calc, hero) {
  const mine = debts.filter((d) => d.creditorUid === uid);
  const open = mine.filter(calc.isOpen).sort((a, b) => calc.daysLeft(a) - calc.daysLeft(b));
  const pending = mine.filter((d) => d.status === "pending");
  const parts = [`📋 <b>Що ${esc(hero)} винен тобі</b>`];

  if (!open.length) parts.push(`${esc(hero)} тобі нічого не винен 🎉`);
  else {
    parts.push(open.map((d) => {
      const lines = [`• <b>${money(calc.left(d))}</b> за «${esc(d.reason)}» — до ${dmy(d.due)}, ${whenText(calc.daysLeft(d))}`];
      const paid = calc.paid(d);
      if (paid > 0) lines.push(`  повернуто ${money(paid)} із ${money(d.amount)}`);
      if (d.claim) lines.push(`  ⏳ ${esc(hero)} каже, що віддав ${money(d.claim.amount)} — підтверди на сайті`);
      return lines.join("\n");
    }).join("\n"));
    parts.push(`Разом: <b>${money(open.reduce((s, d) => s + calc.left(d), 0))}</b>`);
  }
  if (pending.length) {
    parts.push("🟡 <b>На розгляді</b>\n" + pending.map((d) => `• ${money(d.amount)} за «${esc(d.reason)}»`).join("\n"));
  }
  return parts.join("\n\n");
}

// Усі борги героя сайту в черзі повернення
function subjectDebtsText(debts, calc) {
  const queue = calc.queue();
  if (!queue.length) return "📋 <b>Твої борги</b>\n\nВідкритих боргів немає 🎉";
  const lines = queue.map(({ debt: d, left }, i) => {
    const row = [`${i + 1}. ${esc(d.creditor)} — <b>${money(left)}</b> за «${esc(d.reason)}», ${whenText(calc.daysLeft(d))}`];
    if (d.claim) row.push(`   ⏳ чекає підтвердження: ${money(d.claim.amount)}`);
    return row.join("\n");
  });
  const total = queue[queue.length - 1].cumulative;
  return `📋 <b>Твої борги</b> — у черзі повернення\n\n${lines.join("\n")}\n\nРазом: <b>${money(total)}</b>`;
}

function statusText(debts, calc) {
  const t = calc.totals();
  const r = calc.reliability();
  const next = calc.queue().find((q) => calc.daysLeft(q.debt) >= 0);
  const lines = [
    "📊 <b>Стан боргу</b>",
    `Загальний борг: <b>${money(t.total)}</b> (${t.count} ${plural(t.count, "борг", "борги", "боргів")})`,
    t.overdueCount ? `Прострочено: ${money(t.overdue)} (${t.overdueCount})` : "Прострочених немає",
    r.percent === null
      ? "Індекс надійності: ще немає даних"
      : `Індекс надійності: ${r.percent}% (вчасно ${r.onTime}, із запізненням ${r.late}, висить ${r.overdue})`,
  ];
  if (next) lines.push(`Найближче: ${esc(next.debt.creditor)} — ${money(next.left)}, ${inDays(calc.daysLeft(next.debt))}`);
  return lines.join("\n");
}

function helpText(role, hero) {
  if (role === "subject") {
    return "📋 <b>Борги</b> — усі твої борги в черзі повернення\n"
      + "📊 <b>Стан</b> — загальна картина\n\n"
      + "Щоранку о 9:00 нагадаю про борги, що горять, і повідомлю про новий борг "
      + "та про платіж, який кредитор підтвердив.\n\n/vidvyazaty — відв'язати Telegram";
  }
  return `📋 <b>Борги</b> — що ${esc(hero)} винен тобі\n`
    + "📊 <b>Стан</b> — загальна картина\n\n"
    + `Повідомлю, коли твою заявку розглянуть, коли ${esc(hero)} скаже, що віддав, `
    + "і в день повернення. Підтверджувати платежі — на сайті.\n\n/vidvyazaty — відв'язати Telegram";
}

function welcomeText(user, hero) {
  return `Привіт, ${esc(user.name)}! Telegram підключено до noxon ✅\n\n${helpText(user.role, hero)}`;
}

// Постійна клавіатура під полем вводу
function menuKeyboard() {
  return {
    keyboard: [[{ text: "📋 Борги" }, { text: "📊 Стан" }], [{ text: "ℹ️ Допомога" }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

// Кнопки-посилання під відповіддю; «Віддати» — лише герою сайту
function linksKeyboard({ siteUrl, payUrl, pay = false }) {
  const row = [];
  if (pay && payUrl) row.push({ text: "💸 Віддати", url: payUrl });
  if (siteUrl) row.push({ text: "🔗 Відкрити сайт", url: siteUrl });
  return { inline_keyboard: [row] };
}

module.exports = {
  PRIVATE_TEXT, dmy, whenText,
  creditorDebtsText, subjectDebtsText, statusText, helpText, welcomeText,
  menuKeyboard, linksKeyboard,
};
