/* Щоденне нагадування: що горить — одним повідомленням у Telegram.
   node bot/remind.js [--dry-run] [--mode=normal|test]
   normal — лише о 9-й за Києвом і лише якщо щось горить;
   test   — завжди, навіть коли нічого не горить;
   --dry-run — нічого не надсилає, друкує текст (секрети не потрібні). */
process.env.TZ = process.env.TZ || "Europe/Kyiv";

const { loadSite } = require("./load-site");
const { signInAnonymously, listCollection, getDocument } = require("./firestore");
const { pickDue, nextDue, formatMessage } = require("./reminders");
const { sendMessage } = require("./telegram");

const SITE_URL = "https://noxon-app.vercel.app";
const SEND_HOUR = 9;

function kyivHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(now));
}

function parseArgs(argv) {
  const flag = argv.find((a) => a.startsWith("--mode="));
  const mode = (flag ? flag.slice("--mode=".length) : process.env.REMIND_MODE) || "normal";
  if (!["normal", "test"].includes(mode)) throw new Error(`Невідомий режим «${mode}»: має бути normal або test.`);
  return { mode, dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { mode, dryRun } = parseArgs(process.argv.slice(2));

  if (mode === "normal" && !dryRun && kyivHour() !== SEND_HOUR) {
    console.log(`У Києві зараз ${kyivHour()}-та година, надсилаємо о ${SEND_HOUR}:00 — пропускаю.`);
    return;
  }

  const { CONFIG, calc } = loadSite();
  const { apiKey, projectId } = CONFIG.firebase;
  const idToken = await signInAnonymously(apiKey);
  const [debts, subject] = await Promise.all([
    listCollection(projectId, "debts", idToken),
    getDocument(projectId, "site/subject", idToken),
  ]);

  const heroName = subject && subject.name ? subject.name.split(" ")[0] : "Герой сайту";
  const groups = pickDue(debts, calc);
  const text = formatMessage(groups, { calc, heroName, siteUrl: SITE_URL, test: mode === "test", next: nextDue(debts, calc) });

  // Лише числа: журнали GitHub Actions публічного репозиторію видно всім.
  console.log(`Боргів у базі: ${debts.length}. Горить: ${groups.reduce((s, g) => s + g.debts.length, 0)}.`);
  if (!text) { console.log("Нічого не горить — не надсилаю."); return; }
  if (dryRun) { console.log("\n" + text); return; }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("Немає секрету TELEGRAM_BOT_TOKEN.");
  if (!chatId) throw new Error("Немає секрету TELEGRAM_CHAT_ID.");
  await sendMessage(token, chatId, text);
  console.log("Надіслано в Telegram.");
}

main().catch((err) => {
  console.error("Помилка: " + err.message);
  process.exitCode = 1;
});
