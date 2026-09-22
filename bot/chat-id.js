/* Показує chat ID людей, які натиснули Start у боті.
   TELEGRAM_BOT_TOKEN=... node bot/chat-id.js   (запускає людина сама) */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error("Задай TELEGRAM_BOT_TOKEN у змінних середовища."); process.exit(1); }

fetch(`https://api.telegram.org/bot${token}/getUpdates`)
  .then((r) => r.json())
  .then((body) => {
    if (!body.ok) throw new Error(body.description);
    const chats = new Map();
    for (const u of body.result) {
      const chat = (u.message || u.edited_message || {}).chat;
      if (chat) chats.set(chat.id, [chat.first_name, chat.last_name, chat.username && "@" + chat.username].filter(Boolean).join(" "));
    }
    if (!chats.size) console.log("Порожньо: відкрий бота в Telegram, натисни Start і запусти ще раз.");
    for (const [id, who] of chats) console.log(`${id}  ${who}`);
  })
  .catch((err) => { console.error("Помилка: " + err.message); process.exitCode = 1; });
