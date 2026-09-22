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
