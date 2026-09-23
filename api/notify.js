/* Надіслати адміну в Telegram заявки, про які ще не повідомляли.
   Сайт викликає це одразу після нової заявки. Із запиту нічого не
   береться: функція сама читає базу, тож зайві виклики лише повторно
   перевіряють. Позначка notified не дає надіслати заявку двічі. */
const { loadSite } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { listCollection, patchDocument } = require("../bot/firestore");
const { sendMessage } = require("../bot/telegram");
const { pendingText, pendingKeyboard } = require("../bot/moderation");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  try {
    const { CONFIG } = loadSite();
    const s = await botSession(CONFIG, process.env.BOT_PASSWORD);
    if (!s.isAdmin) return res.status(200).json({ sent: 0, reason: "бот ще не адмін" });

    const fresh = (await listCollection(s.projectId, "debts", s.idToken))
      .filter((d) => d.status === "pending" && !d.notified)
      .sort((a, b) => a.ts - b.ts);

    let sent = 0;
    for (const d of fresh) {
      // Спершу надсилаємо, потім ставимо позначку: краще рідкісний дубль, ніж загублена заявка.
      await sendMessage(token, admin, pendingText(d), pendingKeyboard(d.id));
      await patchDocument(s.projectId, `debts/${d.id}`, { notified: true }, s.idToken);
      sent++;
    }
    res.status(200).json({ sent });
  } catch (err) {
    console.error("noxon notify:", err.message);
    res.status(500).json({ error: "notify failed" });
  }
};
