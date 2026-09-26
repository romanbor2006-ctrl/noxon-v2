/* Сайт викликає це після кожної зміни боргу: нова заявка, рішення,
   «віддав», «отримав», «не отримав». Із запиту нічого не береться:
   функція сама читає базу, тож зайві виклики лише повторно перевіряють.
   1) нові заявки — адміну з кнопками модерації (позначка notified);
   2) особисті сповіщення — прив'язаним кредиторам і Дмитру. */
process.env.TZ = "Europe/Kyiv";
const { loadSite } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { notifyAll } = require("../bot/dispatch");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  try {
    const site = loadSite();
    const s = await botSession(site.CONFIG, process.env.BOT_PASSWORD);
    if (!s.isAdmin) return res.status(200).json({ sent: 0, reason: "бот ще не адмін" });
    const r = await notifyAll(site, s, process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_ADMIN_CHAT_ID);
    res.status(200).json(r);
  } catch (err) {
    console.error("noxon notify:", err.message);
    res.status(500).json({ error: "notify failed" });
  }
};
