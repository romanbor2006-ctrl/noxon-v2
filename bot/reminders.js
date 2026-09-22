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
