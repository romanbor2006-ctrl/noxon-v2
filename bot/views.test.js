process.env.TZ = "Europe/Kyiv";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSite, withData } = require("./load-site");
const V = require("./views");
// без тегів і з простими пробілами: Intl ставить нерозривні між тисячами
const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/[\u00a0\u202f]/g, " ");

const site = loadSite();
const { calc } = site;
const t = calc.today();
const at = (n) => calc.iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
let seq = 0;
const debt = (over) => ({
  id: "d" + ++seq, amount: 1000, reason: "шаурма", creditor: "Ростик", creditorUid: "u1",
  author: "Ростик", status: "approved", payments: [], claim: null, due: at(5), ts: Date.now(), ...over,
});

test("кредитор бачить лише свої відкриті борги й заявки на розгляді", () => {
  const debts = [
    debt({ amount: 700, payments: [{ amount: 200, ts: 1 }], claim: { amount: 100, ts: 2 } }),
    debt({ creditorUid: "u2", creditor: "Олег", reason: "чуже" }),
    debt({ status: "pending", amount: 300, reason: "кава" }),
    debt({ payments: [{ amount: 1000, ts: 1 }], reason: "закритий" }),
  ];
  withData(site, debts);
  const text = plain(V.creditorDebtsText(debts, "u1", calc, "Дмитро"));
  assert.match(text, /500 ₴/);
  assert.match(text, /повернуто 200 ₴ із 700 ₴/);
  assert.match(text, /Дмитро каже, що віддав 100 ₴/);
  assert.match(text, /На розгляді/);
  assert.match(text, /кава/);
  assert.doesNotMatch(text, /чуже|закритий/);
  assert.match(text, /Разом: 500 ₴/);
});

test("кредитор без боргів", () => {
  withData(site, []);
  assert.match(plain(V.creditorDebtsText([], "u1", calc, "Дмитро")), /нічого не винен/);
});

test("Дмитро бачить чергу з простроченням і екрануванням", () => {
  const debts = [
    debt({ due: at(3), creditor: "Олег", creditorUid: "u2" }),
    debt({ due: at(-2), reason: "<b>пиво</b>" }),
  ];
  withData(site, debts);
  const text = plain(V.subjectDebtsText(debts, calc));
  assert.ok(text.indexOf("прострочено 2 дні") < text.indexOf("через 3 дні"), "прострочене — першим");
  assert.match(text, /&lt;b&gt;пиво&lt;\/b&gt;/);
  assert.match(text, /Разом: 2 000 ₴/);
});

test("Дмитро без боргів", () => {
  withData(site, []);
  assert.match(plain(V.subjectDebtsText([], calc)), /Відкритих боргів немає/);
});

test("стан: суми, прострочене, надійність без даних", () => {
  const debts = [debt({ due: at(-1), amount: 300 }), debt({ due: at(2) })];
  withData(site, debts);
  const text = plain(V.statusText(debts, calc));
  assert.match(text, /1 300 ₴/);
  assert.match(text, /Прострочено: 300 ₴/);
  assert.match(text, /Індекс надійності: 0%/);
  withData(site, []);
  assert.match(plain(V.statusText([], calc)), /ще немає даних/);
});

test("клавіатури", () => {
  assert.deepEqual(V.menuKeyboard().keyboard.flat().map((b) => b.text), ["📋 Борги", "📊 Стан", "ℹ️ Допомога"]);
  const kb = V.linksKeyboard({ siteUrl: "https://s", payUrl: "https://p", pay: true });
  assert.deepEqual(kb.inline_keyboard[0].map((b) => b.url), ["https://p", "https://s"]);
  assert.equal(V.linksKeyboard({ siteUrl: "https://s", payUrl: "https://p" }).inline_keyboard[0].length, 1);
});
