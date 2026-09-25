/* Події для особистих сповіщень — чиста логіка без мережі.
   Кожна подія має сталий ключ: за ним розсилка пам'ятає, що вже
   надіслала (tgsent/<ключ>), тож повторний прохід нічого не дублює. */
const { money, esc } = require("./reminders");
const { dmy } = require("./views");

function heroUid(users) {
  const u = users.find((x) => x.role === "subject" && x.active !== false);
  return u ? u.id : null;
}

// [{ key, uid, text }] — uid адресата; прив'язаний він чи ні, вирішує розсилка
function collectEvents(debts, users, calc, hero) {
  const heroId = heroUid(users);
  const out = [];
  for (const d of debts) {
    const what = `${money(d.amount)} за «${esc(d.reason)}»`;

    if ((d.status === "approved" || d.status === "rejected") && d.creditorUid) {
      out.push({
        key: `st_${d.id}_${d.status}`,
        uid: d.creditorUid,
        text: d.status === "approved"
          ? `✅ <b>Заявку підтверджено</b>\n${what} — ${esc(hero)} має повернути до ${dmy(d.due)}.`
          : `❌ <b>Заявку відхилено</b>\n${what}. Якщо це помилка — напиши адміну.`,
      });
    }
    if (d.status !== "approved") continue;

    if (heroId) {
      out.push({
        key: `new_${d.id}`,
        uid: heroId,
        text: `🔺 <b>Новий борг</b>\n${esc(d.creditor)} — ${what}, повернути до ${dmy(d.due)}.`,
      });
    }

    if (d.claim && d.creditorUid) {
      out.push({
        key: `cl_${d.id}_${d.claim.ts}`,
        uid: d.creditorUid,
        text: `💸 <b>${esc(hero)} каже, що віддав тобі ${money(d.claim.amount)}</b>\nза «${esc(d.reason)}».\n`
          + "Перевір і натисни на сайті «Отримав» або «Не отримав».",
      });
    }

    if (heroId) {
      let sum = 0;
      for (const p of [...(d.payments || [])].sort((a, b) => a.ts - b.ts)) {
        sum += p.amount;
        const left = Math.max(0, d.amount - sum);
        out.push({
          key: `pay_${d.id}_${p.ts}`,
          uid: heroId,
          text: `✅ <b>${esc(d.creditor)} підтвердив ${money(p.amount)}</b>\nза «${esc(d.reason)}». `
            + (left ? `Лишилось ${money(left)}.` : "Борг закрито 🏁"),
        });
      }
    }
  }
  return out;
}

module.exports = { collectEvents, heroUid };
