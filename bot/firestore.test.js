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

const { encodeFields } = require("./firestore");

test("кодує значення для запису в Firestore REST", () => {
  assert.deepEqual(encodeFields({ status: "approved", notified: true, amount: 1500, rate: 1.5, claim: null, tags: ["a"], meta: { x: 1 } }), {
    status: { stringValue: "approved" },
    notified: { booleanValue: true },
    amount: { integerValue: "1500" },
    rate: { doubleValue: 1.5 },
    claim: { nullValue: null },
    tags: { arrayValue: { values: [{ stringValue: "a" }] } },
    meta: { mapValue: { fields: { x: { integerValue: "1" } } } },
  });
});
