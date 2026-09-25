/* Щоденні нагадування (Vercel-функція). Щоранку її викликає GitHub
   Actions (bot/remind-trigger.js) із заголовком x-noxon-remind.
   normal — Дмитру (або адміну, поки Дмитро не підключив Telegram) борги
            на 3 дні / завтра / сьогодні; кожному прив'язаному кредитору —
            його борги на завтра й сьогодні. Раз на день на людину.
   test   — одне повідомлення адміну: що отримав би Дмитро і скільки людей. */
process.env.TZ = "Europe/Kyiv";
const { loadSite, withData } = require("../bot/load-site");
const { botSession } = require("../bot/bot-account");
const { createDocument, deleteDocument } = require("../bot/firestore");
const { sendMessage } = require("../bot/telegram");
const { pickDue, nextDue, formatMessage, buildKeyboard, creditorReminder, remindSecret } = require("../bot/reminders");
const { heroUid } = require("../bot/events");
const { linksKeyboard } = require("../bot/views");
const { loadWorld, chatOf } = require("../bot/dispatch");

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (req.method !== "POST") return res.status(405).send("POST only");
  if (!token || req.headers["x-noxon-remind"] !== remindSecret(token)) return res.status(401).send("unauthorized");
  const mode = req.body && req.body.mode === "test" ? "test" : "normal";

  try {
    const site = loadSite();
    const { siteUrl, payUrl } = site.CONFIG;
    const s = await botSession(site.CONFIG, process.env.BOT_PASSWORD);
    if (!s.isAdmin) return res.status(200).json({ sent: 0, reason: "бот ще не адмін" });
    const world = await loadWorld(s);
    const calc = withData(site, world.debts, world.users);

    const heroId = heroUid(world.users);
    const heroChat = heroId ? chatOf(world, heroId) : null;
    const heroText = formatMessage(pickDue(world.debts, calc), {
      calc, heroName: world.hero, siteUrl, test: mode === "test", next: nextDue(world.debts, calc),
    });

    const jobs = [];
    if (heroText) {
      jobs.push({ key: heroChat ? heroId : "admin", chat: heroChat || admin, text: heroText, kb: buildKeyboard({ payUrl, siteUrl }) });
    }
    for (const link of world.links) {
      if (link.id === heroId) continue;
      const chat = chatOf(world, link.id);
      const text = chat && creditorReminder(world.debts, link.id, calc, world.hero);
      if (text) jobs.push({ key: link.id, chat, text, kb: linksKeyboard({ siteUrl }) });
    }

    if (mode === "test") {
      const creditors = jobs.filter((j) => j.key !== heroId && j.key !== "admin").length;
      const who = heroChat ? "Дмитро" : "ти (Дмитро ще не підключив Telegram)";
      await sendMessage(token, admin, `${heroText}\n\n<i>Це отримав би: ${who}. Кредиторів із нагадуванням сьогодні: ${creditors}.</i>`,
        buildKeyboard({ payUrl, siteUrl }));
      return res.status(200).json({ mode, sent: 1, people: jobs.length });
    }

    const date = calc.iso(calc.today());
    let sent = 0;
    for (const j of jobs) {
      const key = `tgsent/rem_${date}_${j.key}`;
      if (!(await createDocument(s.projectId, key, { ts: Date.now() }, s.idToken))) continue; // сьогодні вже було
      try {
        await sendMessage(token, j.chat, j.text, j.kb);
        sent++;
      } catch (err) {
        console.error("noxon remind:", err.message);
        if (err.code !== 403) await deleteDocument(s.projectId, key, s.idToken).catch(() => {});
      }
    }
    res.status(200).json({ mode, sent, people: jobs.length });
  } catch (err) {
    console.error("noxon remind:", err.message);
    res.status(500).json({ error: "remind failed" });
  }
};
