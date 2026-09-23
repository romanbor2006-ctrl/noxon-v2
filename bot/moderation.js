/* Модерація заявок у Telegram — чиста логіка без мережі:
   секрет webhook, розбір натискань і команд, тексти й кнопки. */
const crypto = require("node:crypto");
const { money, esc } = require("./reminders");

const ID_RE = /^[A-Za-z0-9]{1,40}$/;

// Telegram додає цей секрет до кожного запиту на webhook. Виводимо його з
// токена бота, тож окремої змінної не треба, а сторонній його не вгадає.
function webhookSecret(token) {
  return crypto.createHash("sha256").update("noxon-webhook:" + token).digest("hex").slice(0, 48);
}

// "ok:<id>" / "no:<id>" → рішення; усе інше — null
function parseCallback(data) {
  const m = /^(ok|no):(.+)$/.exec(data || "");
  if (!m || !ID_RE.test(m[2])) return null;
  return { status: m[1] === "ok" ? "approved" : "rejected", id: m[2] };
}

// Що робити з оновленням: decide | list | help | forbidden | ignore
function routeUpdate(update, adminChatId) {
  const cb = update.callback_query;
  const msg = update.message;
  const from = cb ? cb.from : msg ? msg.from : null;
  if (!from) return { type: "ignore" };
  const isAdmin = String(from.id) === String(adminChatId);

  if (cb) {
    if (!isAdmin) return { type: "forbidden", callbackId: cb.id };
    const decision = parseCallback(cb.data);
    if (!decision) return { type: "ignore", callbackId: cb.id };
    return { type: "decide", callbackId: cb.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, ...decision };
  }

  if (!isAdmin) return { type: "forbidden", chatId: msg.chat.id };
  const text = (msg.text || "").trim();
  if (/^\/(zayavky|start)(@\w+)?$/.test(text)) return { type: "list", chatId: msg.chat.id };
  return { type: "help", chatId: msg.chat.id };
}

const dmy = (iso) => { const [y, m, d] = String(iso).split("-"); return `${d}.${m}.${y}`; };
const body = (d) => `${esc(d.creditor)} — ${money(d.amount)} за «${esc(d.reason)}»\nПовернути до ${dmy(d.due)}`;

const pendingText = (d) => `🟡 <b>Нова заявка</b>\n${body(d)}`;

function pendingKeyboard(id) {
  return { inline_keyboard: [[
    { text: "✅ Підтвердити", callback_data: `ok:${id}` },
    { text: "❌ Відхилити", callback_data: `no:${id}` },
  ]] };
}

function decisionText(d, status) {
  return `${status === "approved" ? "✅ <b>Підтверджено</b>" : "❌ <b>Відхилено</b>"}\n${body(d)}`;
}

module.exports = { webhookSecret, parseCallback, routeUpdate, pendingText, pendingKeyboard, decisionText };
