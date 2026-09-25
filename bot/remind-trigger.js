/* Щоранковий виклик нагадувань. Запускає GitHub Actions (remind.yml).
   Самі нагадування шле Vercel-функція /api/remind: лише вона має доступ
   бота до бази й знає, хто прив'язав Telegram.
   REMIND_MODE=normal — лише о 9-й за Києвом; test — завжди, лише адміну.
   Друкуємо тільки числа: журнали публічного репозиторію видно всім. */
process.env.TZ = process.env.TZ || "Europe/Kyiv";
const { loadSite } = require("./load-site");
const { remindSecret } = require("./reminders");

const SEND_HOUR = 9;

function kyivHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(now));
}

async function main() {
  const mode = process.env.REMIND_MODE || "normal";
  if (!["normal", "test"].includes(mode)) throw new Error(`Невідомий режим «${mode}»: має бути normal або test.`);
  if (mode === "normal" && kyivHour() !== SEND_HOUR) {
    console.log(`У Києві зараз ${kyivHour()}-та година, надсилаємо о ${SEND_HOUR}:00 — пропускаю.`);
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Немає секрету TELEGRAM_BOT_TOKEN.");

  const { CONFIG } = loadSite();
  const res = await fetch(`${CONFIG.siteUrl}/api/remind`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-noxon-remind": remindSecret(token) },
    body: JSON.stringify({ mode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/api/remind відповів ${res.status}${body.error ? ` (${body.error})` : ""}.`);
  console.log(`Режим ${mode}: надіслано ${body.sent || 0}, людей із нагадуванням ${body.people || 0}.${body.reason ? " " + body.reason : ""}`);
}

main().catch((err) => {
  console.error("Помилка: " + err.message);
  process.exitCode = 1;
});
