/* Розсилка особистих сповіщень. Читає базу акаунтом бота (роль адміна),
   будує події (events.js) і шле їх тим, хто прив'язав Telegram.

   Позначка tgsent/<ключ> ставиться ДО надсилання й лише якщо її ще немає —
   так два паралельні запуски не надішлють одне й те саме двічі. Якщо
   Telegram не прийняв повідомлення, позначку знімаємо, щоб спробувати
   наступного разу (крім 403: людина заблокувала бота — не набридаємо). */
const { listCollection, getDocument, createDocument, deleteDocument } = require("./firestore");
const { sendMessage } = require("./telegram");
const { collectEvents, heroUid } = require("./events");
const { linksKeyboard } = require("./views");
const { withData } = require("./load-site");

async function loadWorld(s) {
  const [debts, users, links, subject] = await Promise.all([
    listCollection(s.projectId, "debts", s.idToken),
    listCollection(s.projectId, "users", s.idToken),
    listCollection(s.projectId, "telegram", s.idToken),
    getDocument(s.projectId, "site/subject", s.idToken),
  ]);
  const hero = subject && subject.name ? subject.name.split(" ")[0] : "Дмитро";
  return { debts, users, links, hero };
}

// чат людини — лише якщо вона прив'язана й досі активна
function chatOf(world, uid) {
  const link = world.links.find((l) => l.id === uid);
  const user = world.users.find((u) => u.id === uid);
  return link && user && user.active === true ? String(link.chatId) : null;
}

async function sendEvents(site, s, token, world) {
  const calc = withData(site, world.debts, world.users);
  const events = collectEvents(world.debts, world.users, calc, world.hero);
  const heroId = heroUid(world.users);
  const mark = (key) => createDocument(s.projectId, `tgsent/${key}`, { ts: Date.now() }, s.idToken);
  const done = new Set((await listCollection(s.projectId, "tgsent", s.idToken)).map((d) => d.id));

  // Перший запуск: усе, що сталося досі, вважаємо надісланим —
  // інакше люди отримали б лавину старих подій.
  if (!done.has("_baseline")) {
    await Promise.all(events.filter((e) => !done.has(e.key)).map((e) => mark(e.key)));
    await mark("_baseline");
    return { sent: 0, baseline: events.length };
  }

  let sent = 0;
  for (const e of events) {
    if (done.has(e.key)) continue;
    if (!(await mark(e.key))) continue; // інший запуск уже взяв цю подію
    const chat = chatOf(world, e.uid);
    if (!chat) continue; // не прив'язаний — позначка лишається, старе не прийде потім
    try {
      const kb = linksKeyboard({ siteUrl: site.CONFIG.siteUrl, payUrl: site.CONFIG.payUrl, pay: e.uid === heroId });
      await sendMessage(token, chat, e.text, kb);
      sent++;
    } catch (err) {
      console.error("noxon dispatch:", err.message);
      if (err.code !== 403) await deleteDocument(s.projectId, `tgsent/${e.key}`, s.idToken).catch(() => {});
    }
  }
  return { sent };
}

module.exports = { loadWorld, chatOf, sendEvents };
