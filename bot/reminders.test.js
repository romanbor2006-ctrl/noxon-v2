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

const { buildKeyboard } = require("./reminders");

test("клавіатура: «Віддати» і «Відкрити сайт»", () => {
  assert.deepEqual(buildKeyboard({ payUrl: "https://pay", siteUrl: SITE }), {
    inline_keyboard: [[{ text: "💸 Віддати", url: "https://pay" }, { text: "🔗 Відкрити сайт", url: SITE }]],
  });
  assert.deepEqual(buildKeyboard({ siteUrl: SITE }), {
    inline_keyboard: [[{ text: "🔗 Відкрити сайт", url: SITE }]],
  });
});
