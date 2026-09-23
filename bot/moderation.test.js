const test = require("node:test");
const assert = require("node:assert/strict");
const { webhookSecret, parseCallback, routeUpdate, pendingText, pendingKeyboard, decisionText } = require("./moderation");
const { money } = require("./reminders");

const ADMIN = 111;
const debt = { id: "abc123", creditor: "Ростик", amount: 1500, reason: "шаурма", due: "2026-10-12" };

test("секрет webhook: стабільний, 48 символів, лише дозволені Telegram знаки", () => {
  const s = webhookSecret("123:ABC");
  assert.equal(s, webhookSecret("123:ABC"));
  assert.notEqual(s, webhookSecret("123:ABD"));
  assert.match(s, /^[a-f0-9]{48}$/);
});

test("розбір натискання: ok/no і перевірка ID", () => {
  assert.deepEqual(parseCallback("ok:abc123"), { status: "approved", id: "abc123" });
  assert.deepEqual(parseCallback("no:abc123"), { status: "rejected", id: "abc123" });
  assert.equal(parseCallback("ok:../users/x"), null);
  assert.equal(parseCallback("del:abc123"), null);
  assert.equal(parseCallback(undefined), null);
});

test("маршрут: натискання адміна", () => {
  const r = routeUpdate({ callback_query: { id: "q1", from: { id: ADMIN }, data: "ok:abc123", message: { chat: { id: ADMIN }, message_id: 7 } } }, String(ADMIN));
  assert.deepEqual(r, { type: "decide", callbackId: "q1", chatId: ADMIN, messageId: 7, status: "approved", id: "abc123" });
});

test("маршрут: чужа людина — відмова, і на кнопку, і на команду", () => {
  assert.equal(routeUpdate({ callback_query: { id: "q2", from: { id: 999 }, data: "ok:abc123", message: { chat: { id: 999 }, message_id: 1 } } }, ADMIN).type, "forbidden");
  assert.equal(routeUpdate({ message: { from: { id: 999 }, chat: { id: 999 }, text: "/zayavky" } }, ADMIN).type, "forbidden");
});

test("маршрут: команди адміна", () => {
  const msg = (text) => ({ message: { from: { id: ADMIN }, chat: { id: ADMIN }, text } });
  assert.equal(routeUpdate(msg("/zayavky"), ADMIN).type, "list");
  assert.equal(routeUpdate(msg("/start"), ADMIN).type, "list");
  assert.equal(routeUpdate(msg("/zayavky@noxonV2_bot"), ADMIN).type, "list");
  assert.equal(routeUpdate(msg("привіт"), ADMIN).type, "help");
  assert.equal(routeUpdate({ edited_message: {} }, ADMIN).type, "ignore");
});

test("текст заявки й кнопки", () => {
  assert.equal(pendingText(debt), `🟡 <b>Нова заявка</b>\nРостик — ${money(1500)} за «шаурма»\nПовернути до 12.10.2026`);
  assert.deepEqual(pendingKeyboard("abc123"), {
    inline_keyboard: [[{ text: "✅ Підтвердити", callback_data: "ok:abc123" }, { text: "❌ Відхилити", callback_data: "no:abc123" }]],
  });
});

test("текст рішення й екранування", () => {
  assert.ok(decisionText(debt, "approved").startsWith("✅ <b>Підтверджено</b>"));
  assert.ok(decisionText(debt, "rejected").startsWith("❌ <b>Відхилено</b>"));
  assert.ok(pendingText({ ...debt, reason: "<b>&" }).includes("«&lt;b&gt;&amp;»"));
});
