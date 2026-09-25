/* Сайт викликає це після кожної зміни боргу: нова заявка, рішення,
   «віддав», «отримав», «не отримав». Із запиту нічого не береться:
   функція сама читає базу, тож зайві виклики лише повторно перевіряють.
   1) нові заявки — адміну з кнопками модерації (позначка notified);
   2) особисті сповіщення — прив'язаним кредиторам і Дмитру. */
process.env.TZ = "Europe/Kyiv";
const { loadSite } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { patchDocument } = require("../bot/firestore");
const { sendMessage } = require("../bot/telegram");
const { pendingText, pendingKeyboard } = require("../bot/moderation");
const { loadWorld, sendEvents } = require("../bot/dispatch");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  try {
    const site = loadSite();
    const s = await botSession(site.CONFIG, process.env.BOT_PASSWORD);
    if (!s.isAdmin) return res.status(200).json({ sent: 0, reason: "бот ще не адмін" });
    const world = await loadWorld(s);

    const fresh = world.debts
      .filter((d) => d.status === "pending" && !d.notified)
      .sort((a, b) => a.ts - b.ts);
    let pending = 0;
    for (const d of fresh) {
      // Спершу надсилаємо, потім ставимо позначку: краще рідкісний дубль, ніж загублена заявка.
      await sendMessage(token, admin, pendingText(d), pendingKeyboard(d.id));
      await patchDocument(s.projectId, `debts/${d.id}`, { notified: true }, s.idToken);
      pending++;
    }

    const events = await sendEvents(site, s, token, world);
    res.status(200).json({ pending, ...events });
  } catch (err) {
    console.error("noxon notify:", err.message);
    res.status(500).json({ error: "notify failed" });
  }
};
