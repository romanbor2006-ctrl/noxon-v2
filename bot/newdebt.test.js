process.env.TZ = "Europe/Kyiv";
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("./newdebt");

const NOW = new Date(2026, 8, 26, 12, 0); // 26.09.2026

test("parseAmount: числа, пробіли, валюта", () => {
  assert.equal(N.parseAmount("500"), 500);
  assert.equal(N.parseAmount("1 500"), 1500);
  assert.equal(N.parseAmount("1500 грн"), 1500);
  assert.equal(N.parseAmount("500₴"), 500);
  assert.equal(N.parseAmount("100000"), 100000);
  assert.equal(N.parseAmount("100001"), null);
  assert.equal(N.parseAmount("0"), null);
  assert.equal(N.parseAmount("12.5"), null);
  assert.equal(N.parseAmount("-5"), null);
  assert.equal(N.parseAmount("п'ятсот"), null);
});

test("parseDue: формати, минулі й неіснуючі дати", () => {
  assert.deepEqual(N.parseDue("10.10", NOW), { iso: "2026-10-10" });
  assert.deepEqual(N.parseDue("26.09", NOW), { iso: "2026-09-26" }, "сьогодні можна");
  assert.deepEqual(N.parseDue("05.01", NOW), { iso: "2027-01-05" }, "без року й минуло — наступний рік");
  assert.deepEqual(N.parseDue("10/10/26", NOW), { iso: "2026-10-10" });
  assert.deepEqual(N.parseDue("2026-12-01", NOW), { iso: "2026-12-01" });
  assert.match(N.parseDue("01.09.2026", NOW).error, /минула/);
  assert.match(N.parseDue("31.02", NOW).error, /немає/);
  assert.match(N.parseDue("01.01.2030", NOW).error, /два роки/);
  assert.match(N.parseDue("завтра", NOW).error, /Не розібрав/);
});

test("діалог: сума → опис → дата → підтвердження", () => {
  let d = N.startDraft("nonce1", NOW.getTime());
  assert.equal(d.step, "amount");
  assert.ok(N.applyInput(d, "багато", NOW).error);
  d = N.applyInput(d, "700", NOW).draft;
  assert.deepEqual([d.step, d.amount], ["reason", 700]);
  assert.ok(N.applyInput(d, "   ", NOW).error);
  assert.ok(N.applyInput(d, "/stan", NOW).error);
  assert.match(N.applyInput(d, "x".repeat(81), NOW).error, /до 80/);
  d = N.applyInput(d, "  піца   і кола ", NOW).draft;
  assert.deepEqual([d.step, d.reason], ["due", "піца і кола"]);
  d = N.applyInput(d, "2026-10-03", NOW).draft;
  assert.deepEqual([d.step, d.due], ["confirm", "2026-10-03"]);
  assert.ok(N.applyInput(d, "ще щось", NOW).error);
});

test("чернетка застаріває за 30 хвилин", () => {
  const d = N.startDraft("n", 0);
  assert.equal(N.expired(d, N.DRAFT_TTL - 1), false);
  assert.equal(N.expired(d, N.DRAFT_TTL + 1), true);
  assert.equal(N.expired(null), true);
});

test("prompt: кнопки дат і картка з екрануванням", () => {
  const due = N.prompt({ step: "due", amount: 1, reason: "x", ts: 0 }, "Дмитро", NOW);
  assert.deepEqual(due.keyboard.inline_keyboard[0].map((b) => b.callback_data),
    ["nb:due:2026-10-03", "nb:due:2026-10-10", "nb:due:2026-10-26"]);
  const card = N.prompt({ step: "confirm", amount: 700, reason: "<b>піца</b>", due: "2026-10-03" }, "Дмитро", NOW);
  assert.match(card.text, /&lt;b&gt;піца&lt;\/b&gt;/);
  assert.match(card.text, /до 03\.10\.2026/);
  assert.deepEqual(card.keyboard.inline_keyboard[0].map((b) => b.callback_data), ["nb:send", "nb:cancel"]);
});

test("parseDraftCallback", () => {
  assert.deepEqual(N.parseDraftCallback("nb:send"), { action: "send" });
  assert.deepEqual(N.parseDraftCallback("nb:cancel"), { action: "cancel" });
  assert.deepEqual(N.parseDraftCallback("nb:due:2026-10-03"), { action: "due", due: "2026-10-03" });
  assert.equal(N.parseDraftCallback("nb:due:10.10"), null);
  assert.equal(N.parseDraftCallback("ok:abc"), null);
});

test("debtFromDraft — як із форми сайту", () => {
  const debt = N.debtFromDraft({ amount: 700, reason: "піца", due: "2026-10-03" }, { name: "Ростик" }, "u1", 5);
  assert.deepEqual(debt, {
    amount: 700, reason: "піца", creditor: "Ростик", creditorUid: "u1", author: "Ростик",
    due: "2026-10-03", status: "pending", payments: [], claim: null, ts: 5,
  });
});
