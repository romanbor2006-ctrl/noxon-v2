/* Webhook Telegram-бота noxon (Vercel-функція).
   Відповідає лише своїм: чат має бути прив'язаний до активного акаунта
   сайту (кнопка «Підключити Telegram»). Адмін-чат ще й модерує заявки.
   Чужі запити відсікає секретний заголовок, чужих людей — прив'язка. */
process.env.TZ = "Europe/Kyiv";
const { loadSite, withData } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { listCollection, getDocument, patchDocument, deleteDocument } = require("../bot/firestore");
const { sendMessage, editMessageText, answerCallbackQuery } = require("../bot/telegram");
const { webhookSecret, routeUpdate, pendingText, pendingKeyboard, decisionText } = require("../bot/moderation");
const { routeMessage, findMember } = require("../bot/access");
const V = require("../bot/views");
const { loadWorld, sendEvents } = require("../bot/dispatch");

const NOT_ADMIN = "Бот ще не адмін: видай йому роль «адмін» на сайті, у блоці «Люди».";
const ADMIN_HELP = "Ти адмін: /zayavky — заявки на розгляді.\n"
  + "Щоб бачити свої борги й отримувати сповіщення — натисни «Підключити Telegram» на сайті.";
const LINK_TTL = 15 * 60 * 1000;
const ROLES = ["member", "admin", "subject"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (req.method !== "POST") return res.status(200).send("noxon bot");
  if (!token || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) {
    return res.status(401).send("unauthorized");
  }
  try {
    const update = req.body || {};
    if (update.callback_query) await onCallback(update, token);
    else if (update.message) await onMessage(update.message, token);
  } catch (err) {
    console.error("noxon bot:", err.message);
  }
  // Завжди 200: інакше Telegram повторюватиме те саме оновлення.
  res.status(200).send("ok");
};

/* ---------- кнопки модерації (лише адмін-чат) ---------- */
async function onCallback(update, token) {
  const route = routeUpdate(update, process.env.TELEGRAM_ADMIN_CHAT_ID);
  if (route.type === "ignore") return route.callbackId && answerCallbackQuery(token, route.callbackId, "");
  if (route.type === "forbidden") return answerCallbackQuery(token, route.callbackId, "Це приватний бот noxon.");

  const site = loadSite();
  const s = await botSession(site.CONFIG, process.env.BOT_PASSWORD);
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
  await answerCallbackQuery(token, route.callbackId, route.status === "approved" ? "Підтверджено" : "Відхилено");
  // кредитор і Дмитро дізнаються про рішення одразу
  await sendEvents(site, s, token, await loadWorld(s)).catch((err) => console.error("noxon events:", err.message));
}

/* ---------- повідомлення ---------- */
async function onMessage(msg, token) {
  if (!msg.chat || msg.chat.type !== "private") return; // групи ігноруємо
  const chatId = String(msg.chat.id);
  const isAdminChat = chatId === String(process.env.TELEGRAM_ADMIN_CHAT_ID);
  const route = routeMessage(msg.text);
  const site = loadSite();
  const { CONFIG } = site;
  const s = await botSession(CONFIG, process.env.BOT_PASSWORD);
  if (!s.isAdmin) return sendMessage(token, chatId, isAdminChat ? NOT_ADMIN : V.PRIVATE_TEXT);

  if (route.type === "start" && route.code) return linkChat(site, s, token, chatId, route.code);
  if (route.type === "zayavky" && isAdminChat) return listPending(s, token, chatId);

  const world = await loadWorld(s);
  const who = findMember(chatId, world.links, world.users);
  if (!who) {
    if (isAdminChat) return sendMessage(token, chatId, ADMIN_HELP);
    return sendMessage(token, chatId, V.PRIVATE_TEXT, V.linksKeyboard({ siteUrl: CONFIG.siteUrl }));
  }

  const calc = withData(site, world.debts, world.users);
  const subject = who.user.role === "subject";
  const links = V.linksKeyboard({ siteUrl: CONFIG.siteUrl, payUrl: CONFIG.payUrl, pay: subject });

  switch (route.type) {
    case "debts":
      return sendMessage(token, chatId, subject
        ? V.subjectDebtsText(world.debts, calc)
        : V.creditorDebtsText(world.debts, who.uid, calc, world.hero), links);
    case "status":
      return sendMessage(token, chatId, V.statusText(world.debts, calc), links);
    case "unlink":
      await deleteDocument(s.projectId, `telegram/${who.uid}`, s.idToken);
      return sendMessage(token, chatId, "Telegram відв'язано. Підключити знову — кнопкою на сайті.", { remove_keyboard: true });
    default: // start без коду, help, будь-що інше
      return sendMessage(token, chatId, V.helpText(who.user.role, world.hero)
        + (isAdminChat ? "\n/zayavky — заявки на розгляді" : ""), V.menuKeyboard());
  }
}

// Одноразовий код із сайту → telegram/<uid> = цей чат
async function linkChat(site, s, token, chatId, code) {
  const p = s.projectId;
  let link = await getDocument(p, `tglinks/${code}`, s.idToken);
  if (!link) { await wait(1500); link = await getDocument(p, `tglinks/${code}`, s.idToken); } // сайт міг ще не дописати
  const again = "Посилання застаріло або вже використане. Натисни «Підключити Telegram» на сайті ще раз.";
  if (!link) return sendMessage(token, chatId, again);
  await deleteDocument(p, `tglinks/${code}`, s.idToken); // код одноразовий
  if (!(Date.now() - link.ts < LINK_TTL)) return sendMessage(token, chatId, again);

  const user = await getDocument(p, `users/${link.uid}`, s.idToken);
  if (!user || user.active !== true || !ROLES.includes(user.role)) return sendMessage(token, chatId, V.PRIVATE_TEXT);

  // один чат — одна людина: старі прив'язки цього чату прибираємо
  for (const l of await listCollection(p, "telegram", s.idToken)) {
    if (String(l.chatId) === chatId && l.id !== link.uid) await deleteDocument(p, `telegram/${l.id}`, s.idToken);
  }
  await patchDocument(p, `telegram/${link.uid}`, { chatId, name: String(user.name || "").slice(0, 40), ts: Date.now() }, s.idToken);

  const subject = await getDocument(p, "site/subject", s.idToken);
  const hero = subject && subject.name ? subject.name.split(" ")[0] : "Дмитро";
  return sendMessage(token, chatId, V.welcomeText(user, hero), V.menuKeyboard());
}

async function listPending(s, token, chatId) {
  const pending = (await listCollection(s.projectId, "debts", s.idToken))
    .filter((d) => d.status === "pending")
    .sort((a, b) => a.ts - b.ts);
  if (!pending.length) return sendMessage(token, chatId, "Заявок на розгляді немає.");
  for (const d of pending) await sendMessage(token, chatId, pendingText(d), pendingKeyboard(d.id));
}
