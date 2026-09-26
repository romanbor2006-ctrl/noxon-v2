/* Хто пише боту і чого хоче — чиста логіка без мережі.
   Доступ мають лише ті, чий чат прив'язаний до активного акаунта сайту. */

const ROLES = ["member", "admin", "subject"];
const CODE_RE = /^[A-Za-z0-9]{24,48}$/;

// "/start <код>" з посилання «Підключити Telegram» на сайті
function parseStartCode(text) {
  const m = /^\/start(?:@\w+)?\s+(\S+)$/.exec(String(text || "").trim());
  return m && CODE_RE.test(m[1]) ? m[1] : null;
}

const BUTTONS = { "➕ Новий борг": "newdebt", "📋 Борги": "debts", "📊 Стан": "status", "ℹ️ Допомога": "help" };
const COMMANDS = {
  novyi: "newdebt", skasuvaty: "cancel", borhy: "debts", stan: "status",
  help: "help", vidvyazaty: "unlink", zayavky: "zayavky",
};

// start | newdebt | cancel | debts | status | help | unlink | zayavky | unknown
function routeMessage(text) {
  const t = String(text || "").trim();
  if (/^\/start(@\w+)?(\s|$)/.test(t)) return { type: "start", code: parseStartCode(t) };
  if (BUTTONS[t]) return { type: BUTTONS[t] };
  const m = /^\/([a-z]+)(@\w+)?$/.exec(t);
  if (m && COMMANDS[m[1]]) return { type: COMMANDS[m[1]] };
  return { type: "unknown" };
}

// links — документи telegram/<uid> ({ id: uid, chatId }); users — профілі
function findMember(chatId, links, users) {
  const link = links.find((l) => String(l.chatId) === String(chatId));
  if (!link) return null;
  const user = users.find((u) => u.id === link.id);
  if (!user || user.active !== true || !ROLES.includes(user.role)) return null;
  return { uid: link.id, user };
}

module.exports = { parseStartCode, routeMessage, findMember, CODE_RE };
