# Бот: кнопки під нагадуванням і модерація заявок — дизайн і план

Дата: 2026-09-23 · Статус: дизайн погоджено в чаті

## A. Кнопки під нагадуванням

Під щоденним нагадуванням — `[💸 Віддати] [🔗 Відкрити сайт]`.
«Віддати» веде на банку Monobank (`CONFIG.payUrl`), «Відкрити сайт» — на
`CONFIG.siteUrl`. Посилання публічні, тому лежать у `config.js`.

## B. Модерація заявок у Telegram

Обсяг: **лише заявки на борги** — підтвердити або відхилити.

### Як це виглядає

Нова заявка на сайті → адміну в Telegram:

```
🟡 Нова заявка
Ростик — 1 500 ₴ за «шаурма»
Повернути до 12.10.2026
[✅ Підтвердити] [❌ Відхилити]
```

Після натиску текст стає «✅ Підтверджено» / «❌ Відхилено», кнопки зникають.
Якщо заявку вже розглянули на сайті — «Уже розглянуто». Команда `/zayavky`
показує всі заявки, що чекають.

### Архітектура

| Частина | Роль |
|---|---|
| `api/telegram.js` | Vercel-функція, webhook Telegram: команди й натискання кнопок |
| `api/notify.js` | Vercel-функція: надіслати адміну заявки, про які ще не повідомляли |
| `bot/moderation.js` | чиста логіка: розбір оновлень, тексти, кнопки, секрет webhook |
| `bot/bot-account.js` | вхід під `bot@noxon.local`, створення профілю при першому вході |
| `bot/firestore.js` | + `signInWithPassword`, `patchDocument`, `encodeFields` |
| `bot/telegram.js` | + `callApi`, клавіатура в `sendMessage`, `editMessageText`, `answerCallbackQuery` |
| `bot/set-webhook.js` + workflow «Підключити бота» | реєстрація webhook і команди `/zayavky` |
| `storage.js` | після успішної заявки — `POST /api/notify` (лише Firebase) |
| `firestore.rules` | адмін може змінювати ще й поле `notified` (bool) |
| `vercel.json` | функціям — `config.js` і `storage.js` у збірку |

### Безпека

- **Webhook:** Telegram шле заголовок `X-Telegram-Bot-Api-Secret-Token`; секрет —
  перші 48 символів SHA-256 від токена бота. Не збігається → 401.
- **Хто модерує:** лише `from.id === TELEGRAM_ADMIN_CHAT_ID`. Інші отримують
  «Це приватний бот noxon.».
- **Доступ до бази:** акаунт `bot@noxon.local` (пароль — `BOT_PASSWORD` у Vercel),
  роль адміна видає власник на сайті. Правила діють: статус — так, платежі — ні.
- **`/api/notify`** нічого не бере із запиту: сам читає базу; повторні виклики лише
  повторно перевіряють. Позначка `notified: true` не дає надіслати двічі.
- **ID з кнопки** перевіряється регулярним виразом `^[A-Za-z0-9]{1,40}$`.

### Змінні Vercel

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `BOT_PASSWORD` — додано 2026-09-23.

## План

1. **A: кнопки.** `config.js` (`payUrl`, `siteUrl`), `reminders.buildKeyboard`,
   `sendMessage(..., replyMarkup)`, `remind.js`. Тест клавіатури.
2. **Логіка модерації** (`bot/moderation.js`) з тестами: секрет, розбір
   `callback_data`, маршрутизація оновлень, текст заявки з екрануванням, текст рішення.
3. **Запис у Firestore** (`encodeFields`, `patchDocument`, `signInWithPassword`)
   з тестом кодування; `bot/bot-account.js`.
4. **Vercel-функції** `api/telegram.js`, `api/notify.js`, `vercel.json`;
   правила (`notified`) і `storage.js` (виклик `/api/notify`, локальна копія правил).
5. **Підключення:** `bot/set-webhook.js`, workflow «Підключити бота», README.
6. **Наскрізна перевірка:** деплой правил, workflow, роль адміна боту,
   заявка з тестового акаунта → повідомлення → «Підтвердити» → борг у реєстрі.
