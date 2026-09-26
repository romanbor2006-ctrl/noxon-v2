/* Підключає бота до сервера: каже Telegram, куди слати команди й
   натискання кнопок, і реєструє команди в меню бота (/zayavky — лише для адміна, у меню не показуємо).
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
    commands: [
      { command: "novyi", description: "Подати заявку на борг" },
      { command: "skasuvaty", description: "Скасувати заявку, яку заповнюєш" },
      { command: "borhy", description: "Борги: мої або всі (для Дмитра)" },
      { command: "stan", description: "Загальний стан боргу" },
      { command: "help", description: "Що вміє бот" },
      { command: "vidvyazaty", description: "Відв'язати Telegram" },
    ],
  });
  const info = await callApi(token, "getWebhookInfo", {});
  console.log(`Webhook: ${info.url}`);
  console.log(`Черга: ${info.pending_update_count}. Остання помилка: ${info.last_error_message || "немає"}.`);
}

main().catch((err) => {
  console.error("Помилка: " + err.message);
  process.exitCode = 1;
});
