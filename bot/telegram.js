/* Надсилання в Telegram. Адреса містить токен, тому її ніде не друкуємо. */
async function sendMessage(token, chatId, html) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.ok) return;
  const hint = {
    401: " Перевір секрет TELEGRAM_BOT_TOKEN.",
    400: " Перевір секрет TELEGRAM_CHAT_ID.",
    403: " Відкрий бота в Telegram і натисни Start.",
  }[body.error_code] || "";
  throw new Error(`Telegram: ${body.description || res.status}.${hint}`);
}

module.exports = { sendMessage };
