/* Підключає бота до сервера: каже Telegram, куди слати команди й
   натискання кнопок, і реєструє команду /zayavky.
   Запускає workflow «Підключити бота» (Actions → Run workflow). */
const { loadSite } = require("./load-site");
const { callApi } = require("./telegram");
const { webhookSecret } = require("./moderation");

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Немає секрету TELEGRAM_BOT_TOKEN.");
  const { CONFIG } = loadSite();
  const url = `${CONFIG.siteUrl}/api/telegram`;

  await callApi(token, "setWebhook", {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await callApi(token, "setMyCommands", {
    commands: [{ command: "zayavky", description: "Заявки на борги, що чекають розгляду" }],
  });
  const info = await callApi(token, "getWebhookInfo", {});
  console.log(`Webhook: ${info.url}`);
  console.log(`Черга: ${info.pending_update_count}. Остання помилка: ${info.last_error_message || "немає"}.`);
}

main().catch((err) => {
  console.error("Помилка: " + err.message);
  process.exitCode = 1;
});
