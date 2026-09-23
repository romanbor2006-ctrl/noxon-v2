/* Webhook Telegram-бота noxon (Vercel-функція).
   Приймає команди й натискання кнопок; модерує заявки на борги.
   Чужі запити відсікає секретний заголовок, чужих людей — chat ID. */
const { loadSite } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { listCollection, getDocument, patchDocument } = require("../bot/firestore");
const { sendMessage, editMessageText, answerCallbackQuery } = require("../bot/telegram");
const { webhookSecret, routeUpdate, pendingText, pendingKeyboard, decisionText } = require("../bot/moderation");

const PRIVATE = "Це приватний бот noxon.";
const HELP = "Я показую заявки на борги й даю їх підтвердити чи відхилити.\nКоманда: /zayavky";
const NOT_ADMIN = "Бот ще не адмін: видай йому роль «адмін» на сайті, у блоці «Люди».";

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (req.method !== "POST") return res.status(200).send("noxon bot");
  if (!token || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) {
    return res.status(401).send("unauthorized");
  }
  try {
    await handle(req.body || {}, token);
  } catch (err) {
    console.error("noxon bot:", err.message);
  }
  // Завжди 200: інакше Telegram повторюватиме те саме оновлення.
  res.status(200).send("ok");
};

async function handle(update, token) {
  const route = routeUpdate(update, process.env.TELEGRAM_ADMIN_CHAT_ID);

  if (route.type === "ignore") {
    if (route.callbackId) await answerCallbackQuery(token, route.callbackId, "");
    return;
  }
  if (route.type === "forbidden") {
    if (route.callbackId) return answerCallbackQuery(token, route.callbackId, PRIVATE);
    return sendMessage(token, route.chatId, PRIVATE);
  }
  if (route.type === "help") return sendMessage(token, route.chatId, HELP);

  const { CONFIG } = loadSite();
  const s = await botSession(CONFIG, process.env.BOT_PASSWORD);

  if (route.type === "list") {
    if (!s.isAdmin) return sendMessage(token, route.chatId, NOT_ADMIN);
    const pending = (await listCollection(s.projectId, "debts", s.idToken))
      .filter((d) => d.status === "pending")
      .sort((a, b) => a.ts - b.ts);
    if (!pending.length) return sendMessage(token, route.chatId, "Заявок на розгляді немає.");
    for (const d of pending) await sendMessage(token, route.chatId, pendingText(d), pendingKeyboard(d.id));
    return;
  }

  // route.type === "decide"
  if (!s.isAdmin) return answerCallbackQuery(token, route.callbackId, NOT_ADMIN);
  const d = await getDocument(s.projectId, `debts/${route.id}`, s.idToken);
  if (!d) {
    await editMessageText(token, route.chatId, route.messageId, "Цю заявку вже видалено.");
    return answerCallbackQuery(token, route.callbackId, "Заявку видалено");
  }
  if (d.status !== "pending") {
    await editMessageText(token, route.chatId, route.messageId, decisionText(d, d.status) + "\n<i>Розглянуто раніше.</i>");
    return answerCallbackQuery(token, route.callbackId, "Уже розглянуто");
  }
  await patchDocument(s.projectId, `debts/${route.id}`, { status: route.status }, s.idToken);
  await editMessageText(token, route.chatId, route.messageId, decisionText(d, route.status));
  return answerCallbackQuery(token, route.callbackId, route.status === "approved" ? "Підтверджено" : "Відхилено");
}
