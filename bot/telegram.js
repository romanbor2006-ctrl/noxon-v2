/* Telegram Bot API. Адреса містить токен, тому її ніде не друкуємо. */
async function callApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (body.ok) return body.result;
  const hint = {
    401: " Перевір TELEGRAM_BOT_TOKEN.",
    400: " Перевір chat ID.",
    403: " Відкрий бота в Telegram і натисни Start.",
  }[body.error_code] || "";
  const err = new Error(`Telegram ${method}: ${body.description || res.status}.${hint}`);
  err.code = body.error_code;
  throw err;
}

function sendMessage(token, chatId, html, replyMarkup) {
  return callApi(token, "sendMessage", {
    chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

function editMessageText(token, chatId, messageId, html, replyMarkup) {
  return callApi(token, "editMessageText", {
    chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

function answerCallbackQuery(token, callbackQueryId, text) {
  return callApi(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

module.exports = { callApi, sendMessage, editMessageText, answerCallbackQuery };
