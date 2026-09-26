const test = require("node:test");
const assert = require("node:assert/strict");
const { parseStartCode, routeMessage, findMember } = require("./access");

const CODE24 = "a".repeat(24), CODE48 = "B1".repeat(24);

test("parseStartCode бере лише код 24–48 латиниці й цифр", () => {
  assert.equal(parseStartCode("/start " + CODE24), CODE24);
  assert.equal(parseStartCode("/start " + CODE48), CODE48);
  assert.equal(parseStartCode("/start@noxonV2_bot " + CODE24), CODE24);
  assert.equal(parseStartCode("/start " + "a".repeat(23)), null);
  assert.equal(parseStartCode("/start " + "a".repeat(49)), null);
  assert.equal(parseStartCode("/start abc-def-ghi-jkl-mno-pqr"), null);
  assert.equal(parseStartCode("/start"), null);
  assert.equal(parseStartCode("привіт"), null);
});

test("routeMessage: кнопки й команди", () => {
  assert.deepEqual(routeMessage("/start " + CODE24), { type: "start", code: CODE24 });
  assert.deepEqual(routeMessage("/start"), { type: "start", code: null });
  assert.equal(routeMessage("📋 Борги").type, "debts");
  assert.equal(routeMessage("/borhy").type, "debts");
  assert.equal(routeMessage("/borhy@noxonV2_bot").type, "debts");
  assert.equal(routeMessage("📊 Стан").type, "status");
  assert.equal(routeMessage("/stan").type, "status");
  assert.equal(routeMessage("ℹ️ Допомога").type, "help");
  assert.equal(routeMessage("/help").type, "help");
  assert.equal(routeMessage("/vidvyazaty").type, "unlink");
  assert.equal(routeMessage("/zayavky").type, "zayavky");
  assert.equal(routeMessage("  /stan  ").type, "status");
  assert.equal(routeMessage("➕ Новий борг").type, "newdebt");
  assert.equal(routeMessage("/novyi").type, "newdebt");
  assert.equal(routeMessage("/skasuvaty").type, "cancel");
  assert.equal(routeMessage("щось інше").type, "unknown");
  assert.equal(routeMessage(undefined).type, "unknown");
});

const users = [
  { id: "u1", name: "Ростик", role: "member", active: true },
  { id: "u2", name: "Дмитро", role: "subject", active: true },
  { id: "u3", name: "Олег", role: "member", active: false },
  { id: "u4", name: "Старий", role: "disabled", active: true },
];
const links = [
  { id: "u1", chatId: "111" }, { id: "u2", chatId: "222" },
  { id: "u3", chatId: "333" }, { id: "u4", chatId: "444" }, { id: "u9", chatId: "999" },
];

test("findMember: лише прив'язані активні з дозволеною роллю", () => {
  assert.equal(findMember(111, links, users).uid, "u1");
  assert.equal(findMember("222", links, users).user.name, "Дмитро");
  assert.equal(findMember(333, links, users), null, "вимкнений");
  assert.equal(findMember(444, links, users), null, "роль disabled");
  assert.equal(findMember(999, links, users), null, "профілю немає");
  assert.equal(findMember(555, links, users), null, "не прив'язаний");
});
