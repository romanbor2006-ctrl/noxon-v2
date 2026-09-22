/* ============================================================
   config.js — налаштування і контент noxon.
   Тут немає секретів: ключі Firebase публічні за природою,
   доступ захищають правила бази (firestore.rules).
   ============================================================ */

window.CONFIG = {

  siteName: "noxon",

  /* Де лежать дані:
     "local"    — localStorage цього браузера + тестові акаунти (етап 1);
     "firebase" — спільна хмарна база для всіх (етап 3). */
  backend: "local",

  firebase: {
    apiKey: "AIzaSyAMInBJQIf2ewHvVEEG3sSIuCMONN0qp7A",
    authDomain: "noxon-3b54e.firebaseapp.com",
    projectId: "noxon-3b54e",
    storageBucket: "noxon-3b54e.firebasestorage.app",
    messagingSenderId: "667085257543",
    appId: "1:667085257543:web:ffc1393f132591b413ea62"
  },

  /* Людина вводить "rostyk", у Firebase Auth іде rostyk@noxon.local.
     Пошта вигадана й нікуди не надсилається. */
  loginDomain: "noxon.local",

  /* Ліміти. Ті самі числа стоять у firestore.rules: сайт лише
     підказує заздалегідь, а відмовляє все одно база. */
  limits: {
    amountMax: 100000,
    reasonMax: 80,
    nameMax: 40,
    commentMax: 500,
    commentsPerMinute: 5
  },

  currency: "₴",

  /* Дні місяця, коли герой сайту отримує зарплату */
  paydays: [10, 25],

  /* Ачівка «Рекорд» — один борг від цієї суми */
  recordAmount: 5000,
  /* Ачівка «Рецидивіст» — більше стількох боргів за весь час */
  recidivistCount: 5,

  /* ---- ГЕРОЙ САЙТУ -------------------------------------------
     Досьє (ім'я, дата народження, місто, робота, контакти, фото)
     тут НЕ лежить: репозиторій публічний. Воно зберігається в
     Firestore, у документі site/subject, і читати його можуть лише
     залогінені. Заповнює адмін на сайті — кнопка «Редагувати досьє». */

  /* ---- ТЕСТОВІ АКАУНТИ (лише для backend: "local") -----------
     Пароль збігається з логіном. У Firebase акаунти створює адмін
     у консолі, і цей список не використовується. */
  demoUsers: [
    { login: "admin",  name: "Адмін",   role: "admin"   },
    { login: "dima",   name: "Герой",   role: "subject" },
    { login: "rostyk", name: "Ростик",  role: "member"  },
    { login: "oleh",   name: "Олег",    role: "member"  }
  ]
};
