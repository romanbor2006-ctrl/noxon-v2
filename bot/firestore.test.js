const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeDocument } = require("./firestore");

test("розбирає типізовані значення Firestore REST", () => {
  const doc = decodeDocument({
    name: "projects/p/databases/(default)/documents/debts/abc123",
    fields: {
      amount: { integerValue: "1500" },
      reason: { stringValue: "шаурма" },
      claim: { nullValue: null },
      ok: { booleanValue: true },
      rate: { doubleValue: 1.5 },
      payments: { arrayValue: { values: [{ mapValue: { fields: { amount: { integerValue: "500" }, ts: { integerValue: "17" } } } }] } },
      empty: { arrayValue: {} },
    },
  });
  assert.deepEqual(doc, {
    id: "abc123", amount: 1500, reason: "шаурма", claim: null, ok: true, rate: 1.5,
    payments: [{ amount: 500, ts: 17 }], empty: [],
  });
});
