process.env.TZ = "Europe/Kyiv";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSite } = require("./load-site");
const { collectEvents } = require("./events");

const { calc } = loadSite();
const users = [
  { id: "u1", name: "Ростик", role: "member", active: true },
  { id: "hero", name: "Дмитро", role: "subject", active: true },
];
const debt = (over) => ({
  id: "d1", amount: 1000, reason: "шаурма", creditor: "Ростик", creditorUid: "u1",
  status: "approved", payments: [], claim: null, due: "2026-10-10", ts: 1, ...over,
});
const keys = (evs) => evs.map((e) => `${e.key}>${e.uid}`);
const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/[\u00a0\u202f]/g, " ");

test("підтверджена заявка: кредитору й Дмитру", () => {
  const evs = collectEvents([debt()], users, calc, "Дмитро");
  assert.deepEqual(keys(evs), ["st_d1_approved>u1", "new_d1>hero"]);
  assert.match(plain(evs[0].text), /підтверджено/i);
  assert.match(plain(evs[1].text), /Ростик — 1 000 ₴/);
});

test("відхилена — лише кредитору; pending — нічого", () => {
  assert.deepEqual(keys(collectEvents([debt({ status: "rejected" })], users, calc, "Дмитро")), ["st_d1_rejected>u1"]);
  assert.deepEqual(collectEvents([debt({ status: "pending" })], users, calc, "Дмитро"), []);
});

test("заява «віддав» — кредитору, з ключем за часом заяви", () => {
  const evs = collectEvents([debt({ claim: { amount: 300, ts: 77 } })], users, calc, "Дмитро");
  const cl = evs.find((e) => e.key.startsWith("cl_"));
  assert.equal(cl.key, "cl_d1_77");
  assert.equal(cl.uid, "u1");
  assert.match(plain(cl.text), /Дмитро каже, що віддав тобі 300 ₴/);
});

test("платежі — Дмитру; останній, що закрив, каже про закриття", () => {
  const evs = collectEvents([debt({ payments: [{ amount: 600, ts: 20 }, { amount: 400, ts: 10 }] })], users, calc, "Дмитро");
  const pays = evs.filter((e) => e.key.startsWith("pay_"));
  assert.deepEqual(keys(pays), ["pay_d1_10>hero", "pay_d1_20>hero"]);
  assert.match(plain(pays[0].text), /Лишилось 600 ₴/);
  assert.match(plain(pays[1].text), /закрито/);
});

test("без Дмитра й без creditorUid події пропускаються", () => {
  const evs = collectEvents([debt({ creditorUid: "" , payments: [{ amount: 1, ts: 5 }] })], [users[0]], calc, "Дмитро");
  assert.deepEqual(evs, []);
});

test("спецсимволи екрануються", () => {
  const [ev] = collectEvents([debt({ reason: "<i>x</i>" })], users, calc, "Дмитро");
  assert.match(ev.text, /&lt;i&gt;x&lt;\/i&gt;/);
});
