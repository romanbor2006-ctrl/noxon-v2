/* ============================================================
   storage.js — уся робота з даними і вся математика боргу.

   app.js не знає, де лежать дані. Він кличе Store.saveReview(...)
   і отримує готові числа зі Store.calc. Під капотом — одне з двох
   сховищ з однаковим інтерфейсом:
     localBackend    — localStorage + тестові акаунти (етап 1);
     firebaseBackend — Firebase Auth + Cloud Firestore (етап 3).
   Перемикач — CONFIG.backend.
   ============================================================ */

(function () {
  "use strict";

  const C = window.CONFIG;
  const L = C.limits;
  const DAY = 86400000;

  /* ---------------- ДАТИ: завжди без часу ----------------------
     "2026-09-22" — місцева дата, а не UTC. Перед порівнянням усе
     обнуляємо до початку дня: інакше борг із датою "сьогодні"
     після обіду став би простроченим. */
  const pad = (n) => String(n).padStart(2, "0");

  function day(v) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    const x = new Date(v);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => day(Date.now());
  const daysBetween = (from, to) => Math.round((day(to) - day(from)) / DAY);

  function deny(message) {
    const e = new Error(message || "permission-denied");
    e.code = "permission-denied";
    return e;
  }
  function invalid(message) {
    const e = new Error(message);
    e.code = "invalid";
    return e;
  }

  // Власник (головний адмін) — за логіном входу, не за полем у базі
  const isOwnerLogin = (login) => !!login && login === C.ownerLogin;

  /* ---------------- СТАН -------------------------------------- */
  const COLS = ["users", "debts", "ratings", "site", "replies", "badges", "services"];
  const state = { users: [], debts: [], ratings: [], site: [], replies: [], badges: [], services: [] };
  let me = null;
  let kickReason = null;

  /* ============================================================
     МАТЕМАТИКА БОРГУ
     "Закрито" і "прострочено" не зберігаються — рахуються.
     ============================================================ */
  const calc = {
    paid: (d) => (d.payments || []).reduce((s, p) => s + p.amount, 0),
    left: (d) => Math.max(0, d.amount - calc.paid(d)),
    isApproved: (d) => d.status === "approved",
    isClosed: (d) => calc.isApproved(d) && calc.left(d) === 0,
    isOpen: (d) => calc.isApproved(d) && calc.left(d) > 0,
    daysLeft: (d) => daysBetween(today(), d.due),
    isOverdue: (d) => calc.isOpen(d) && calc.daysLeft(d) < 0,

    // коли сума платежів уперше покрила борг
    closedAt(d) {
      let sum = 0;
      for (const p of [...(d.payments || [])].sort((a, b) => a.ts - b.ts)) {
        sum += p.amount;
        if (sum >= d.amount) return p.ts;
      }
      return null;
    },

    approved: () => state.debts.filter(calc.isApproved),
    open: () => calc.approved().filter(calc.isOpen),
    closed: () => calc.approved().filter(calc.isClosed),
    pending: () => state.debts.filter((d) => d.status === "pending").sort((a, b) => a.ts - b.ts),

    totals() {
      const open = calc.open();
      const over = open.filter(calc.isOverdue);
      return {
        total: open.reduce((s, d) => s + calc.left(d), 0),
        count: open.length,
        overdue: over.reduce((s, d) => s + calc.left(d), 0),
        overdueCount: over.length
      };
    },

    // вчасно / (вчасно + із запізненням + зараз прострочені)
    reliability() {
      let onTime = 0, late = 0;
      calc.closed().forEach((d) => {
        day(calc.closedAt(d)) <= day(d.due) ? onTime++ : late++;
      });
      const overdue = calc.open().filter(calc.isOverdue).length;
      const base = onTime + late + overdue;
      return { percent: base ? Math.round((onTime / base) * 100) : null, onTime, late, overdue };
    },

    // Групуємо по creditorUid: ім'я можна перейменувати, uid — ні.
    byCreditor() {
      const map = new Map();
      calc.open().forEach((d) => {
        const key = d.creditorUid || "name:" + d.creditor;
        if (!map.has(key)) {
          const u = state.users.find((x) => x.id === d.creditorUid);
          map.set(key, { key, name: u ? u.name : d.creditor, sum: 0, count: 0 });
        }
        const row = map.get(key);
        row.sum += calc.left(d);
        row.count++;
      });
      return [...map.values()].sort((a, b) => b.sum - a.sum);
    },

    // Найближчий день зарплати: сьогодні або пізніше.
    nextPayday() {
      const t = today();
      const list = [...C.paydays].sort((a, b) => a - b);
      for (let add = 0; add < 3; add++) {
        for (const n of list) {
          const last = new Date(t.getFullYear(), t.getMonth() + add + 1, 0).getDate();
          const d = new Date(t.getFullYear(), t.getMonth() + add, Math.min(n, last));
          if (d >= t) return d;
        }
      }
      return t;
    },

    // Скільки зібрати до зарплати: прострочене + усе, що настає до неї включно.
    payday() {
      const date = calc.nextPayday();
      const items = calc.open().filter((d) => day(d.due) <= date);
      return {
        date,
        days: daysBetween(today(), date),
        need: items.reduce((s, d) => s + calc.left(d), 0),
        count: items.length
      };
    },

    // Черга за датою повернення; прострочені опиняються згори самі.
    queue() {
      let sum = 0;
      return calc.open()
        .sort((a, b) => day(a.due) - day(b.due) || a.ts - b.ts)
        .map((d) => {
          sum += calc.left(d);
          return { debt: d, left: calc.left(d), cumulative: sum };
        });
    },

    // Календар: 5 тижнів від понеділка поточного тижня.
    calendar() {
      const t = today();
      const start = new Date(t);
      start.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const open = calc.open();
      const paydays = new Set();
      const out = [];
      for (let i = 0; i < 35; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        out.push({ date: d, iso: iso(d), sum: 0, items: [], past: d < t, today: +d === +t, payday: false });
      }
      // дні зарплати, що потрапили в сітку
      for (let add = 0; add < 3; add++) {
        C.paydays.forEach((n) => paydays.add(iso(new Date(start.getFullYear(), start.getMonth() + add, n))));
      }
      out.forEach((cell) => {
        cell.payday = paydays.has(cell.iso);
        open.forEach((d) => {
          if (d.due === cell.iso) { cell.sum += calc.left(d); cell.items.push(d); }
        });
      });
      return out;
    },

    // Ачівки не зберігаються — рахуються з даних.
    achievements() {
      const approved = calc.approved();
      const closed = calc.closed();
      const lastTaken = approved.length ? Math.max(...approved.map((d) => d.ts)) : 0;
      const biggest = approved.length ? Math.max(...approved.map((d) => d.amount)) : 0;
      return [
        { id: "clean",  icon: "✦", title: "Чистий аркуш",
          hint: "немає жодного відкритого боргу",
          earned: approved.length > 0 && calc.open().length === 0 },
        { id: "early",  icon: "⚡", title: "Раніше строку",
          hint: "закрив борг до обіцяної дати",
          earned: closed.some((d) => day(calc.closedAt(d)) < day(d.due)) },
        { id: "quiet",  icon: "☾", title: "Місяць без позик",
          hint: "30 днів без нового боргу",
          earned: lastTaken > 0 && daysBetween(lastTaken, today()) >= 30 },
        { id: "record", icon: "▲", title: "Рекорд",
          hint: "борг від " + C.recordAmount + " " + C.currency + " одним записом",
          amount: biggest,
          earned: biggest >= C.recordAmount },
        { id: "repeat", icon: "↻", title: "Рецидивіст",
          hint: "більше " + C.recidivistCount + " боргів за весь час",
          earned: approved.length > C.recidivistCount }
      ];
    },

    rating() {
      const hist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      state.ratings.forEach((r) => { if (hist[r.value] !== undefined) { hist[r.value]++; sum += r.value; } });
      const count = state.ratings.length;
      const mine = me && state.ratings.find((r) => r.id === me.uid);
      return { avg: count ? sum / count : 0, count, hist, mine: mine ? mine.value : 0 };
    },

    age(birthday) {
      const b = day(birthday), n = today();
      let a = n.getFullYear() - b.getFullYear();
      if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
      return a;
    },

    day, iso, today, daysBetween
  };

  /* ============================================================
     СХОВИЩЕ 1: localStorage
     Імітує правила бази, щоб уже на етапі 1 було видно, хто що
     може. Справжній захист — лише в Firestore (етап 5).
     ============================================================ */
  /* Демо-досьє для локального режиму. Справжні дані про людину в коді
     не лежать: у Firebase досьє заповнює адмін на сайті, і читати його
     можуть лише залогінені. */
  const DEMO_SUBJECT = {
    name: "Герой Сайту",
    tagline: "Демо-досьє. Справжнє заповнює адмін — кнопка «Редагувати досьє».",
    birthday: "2000-01-01",
    city: "Місто",
    job: "Робота",
    telegram: "",
    instagram: "",
    about: [
      "Позичає щиро й так само щиро забуває. Не зі зла — просто не пам'ятає.",
      "Тому борг живе не в пам'яті, а в таблиці, яку бачать усі одночасно."
    ],
    traits: [
      { label: "Схильність позичати", value: 9 },
      { label: "Пам'ять на борги", value: 1 },
      { label: "Харизма", value: 8 }
    ],
    timeline: [
      { year: "2026", text: "Запущено noxon — борг переїхав із пам'яті в таблицю." }
    ],
    photo: ""
  };

  // той самий формат, що перевіряє firestore.rules
  function validSubject(d) {
    const str = (v, max) => typeof v === "string" && v.length <= max;
    return !!d && str(d.name, 60) && d.name.length > 0 && str(d.tagline, 140)
      && (d.birthday === "" || /^\d{4}-\d{2}-\d{2}$/.test(d.birthday))
      && str(d.city, 80) && str(d.job, 120) && str(d.telegram, 200) && str(d.instagram, 200)
      && Array.isArray(d.about) && d.about.length <= 10
      && Array.isArray(d.traits) && d.traits.length <= 12
      && Array.isArray(d.timeline) && d.timeline.length <= 30
      && str(d.photo, 400000) && (d.photo === "" || /^data:image\/(jpeg|png|webp);base64,/.test(d.photo));
  }

  function localBackend() {
    const DB_KEY = "noxon.v2.db";
    const SESSION_KEY = "noxon.v2.session";
    let authCb = null, dataCb = null, listening = false;

    const rid = () => Math.random().toString(36).slice(2, 12);

    function seed() {
      const db = { accounts: {}, users: {}, debts: {}, ratings: {}, site: { subject: DEMO_SUBJECT }, replies: {}, badges: {}, services: {} };
      const uidOf = {};
      C.demoUsers.forEach((u) => {
        const uid = "u_" + u.login;
        uidOf[u.login] = uid;
        db.accounts[u.login] = { uid, password: u.login };
        db.users[uid] = { login: u.login, name: u.name, role: u.role, active: true };
      });
      const t = today();
      const at = (n) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
      const ts = (n) => Date.now() + n * DAY;
      const debt = (login, amount, reason, due, taken, extra) => {
        db.debts[rid()] = Object.assign({
          amount, reason, creditor: db.users[uidOf[login]].name, creditorUid: uidOf[login],
          author: db.users[uidOf[login]].name, due, status: "approved", payments: [], claim: null, ts: ts(taken)
        }, extra);
      };
      debt("rostyk", 1500, "шаурма і проїзд", at(-5), -20, { payments: [{ amount: 500, ts: ts(-8) }] });
      debt("oleh", 3000, "на новий телефон", at(3), -12, { claim: { amount: 1000, ts: ts(-1) } });
      debt("rostyk", 6000, "оренда за місяць", at(20), -6);
      debt("roman", 800, "квитки в кіно", at(-30), -45, { payments: [{ amount: 800, ts: ts(-33) }] });
      debt("oleh", 2000, "подарунок мамі", at(-60), -90, { payments: [{ amount: 1000, ts: ts(-58) }, { amount: 1000, ts: ts(-50) }] });
      debt("oleh", 400, "таксі додому", at(10), 0, { status: "pending", author: "Олег" });

      db.ratings[uidOf.rostyk] = { value: 3, text: "Віддає, але шаурму вже двічі прострочив. Нагадую без нагадування 🙂", user: "Ростик", ts: ts(-3) };
      db.ratings[uidOf.oleh] = { value: 4, text: "Телефон поки не повернув, зате чесно пише «віддав» тільки коли справді віддав.", user: "Олег", ts: ts(-2) };
      db.ratings[uidOf.admin] = { value: 5, text: "", user: "Адмін", ts: ts(-9) };
      db.replies[uidOf.oleh + "_1_0"] = { reviewId: uidOf.rostyk, uid: uidOf.oleh, user: "Олег", text: "Шаурма — святе, згоден.", ts: ts(-2) };
      db.badges[rid()] = { title: "Повернув без нагадувань", desc: "Хоч раз віддав сам, ніхто не просив", icon: "🦄", earned: false, ts: ts(-5) };
      db.services[rid()] = { title: "Помити машину", price: 200, desc: "Зовні, з пилососом у салоні", ts: ts(-4) };
      db.services[rid()] = { title: "Допомогти з переїздом", price: 500, desc: "Носити коробки до 3 годин", ts: ts(-4) };
      return db;
    }

    function read() {
      try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) {
          const db = JSON.parse(raw);
          db.site = db.site || { subject: DEMO_SUBJECT };
          db.replies = db.replies || {};
          db.badges = db.badges || {};
          db.services = db.services || {};
          return db;
        }
      } catch (e) {}
      const db = seed();
      write(db);
      return db;
    }
    function write(db) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {}
    }
    function session() {
      try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
    }
    function account(uid) {
      if (!uid) return null;
      const db = read();
      const login = Object.keys(db.accounts).find((l) => db.accounts[l].uid === uid);
      return login ? { uid, login } : null;
    }

    function publish() {
      if (!listening || !dataCb) return;
      const db = read();
      COLS.forEach((col) => {
        state[col] = Object.entries(db[col]).map(([id, v]) => Object.assign({ id }, v));
      });
      dataCb();
    }

    // зміни з інших вкладок цього браузера
    window.addEventListener("storage", (e) => {
      if (e.key === DB_KEY) publish();
      if (e.key === SESSION_KEY && authCb) authCb(account(session()));
    });

    /* --- копія правил firestore.rules -------------------------- */
    function allowed(op, col, id, before, after, uid) {
      const db = read();
      const p = db.users[uid];
      const myLogin = Object.keys(db.accounts).find((l) => db.accounts[l].uid === uid);
      const owner = isOwnerLogin(myLogin);
      const active = owner || (!!p && p.active === true);
      const role = owner ? "admin" : (p ? p.role : null);
      const admin = active && role === "admin";
      const fresh = (v) => Number.isInteger(v) && Math.abs(v - Date.now()) < 300000;
      const changed = () => {
        const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
        return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      };
      const only = (list) => changed().every((k) => list.includes(k));
      const validName = (v) => typeof v === "string" && v.length > 0 && v.length <= L.nameMax;
      const validDebt = (d) => Number.isInteger(d.amount) && d.amount >= 1 && d.amount <= L.amountMax
        && typeof d.reason === "string" && d.reason.length > 0 && d.reason.length <= L.reasonMax
        && validName(d.creditor) && /^\d{4}-\d{2}-\d{2}$/.test(d.due);

      if (col === "users") {
        if (op === "create") return id === uid && after.active === true && validName(after.name)
          && after.role === (owner ? "admin" : "member");
        const touchesAccess = changed().some((k) => k === "role" || k === "active");
        if (op === "update") return admin && only(["name", "role", "active"]) && validName(after.name)
          && ["admin", "subject", "member"].includes(after.role) && typeof after.active === "boolean"
          // профіль власника: роль і доступ лише admin / true
          && (!isOwnerLogin(before.login) || (after.role === "admin" && after.active === true))
          // роль адміна видає і знімає тільки власник; звичайний адмін не чіпає адмінів і себе
          && (!touchesAccess || owner || (before.role !== "admin" && after.role !== "admin"));
        return false;
      }
      if (!active) return false;

      if (col === "debts") {
        if (op === "delete") return admin;
        if (op === "create") return validDebt(after) && after.status === "pending"
          && after.payments.length === 0 && after.claim === null && fresh(after.ts)
          && after.author === p.name && !!db.users[after.creditorUid]
          && after.creditorUid === uid && after.creditor === p.name && role !== "subject";
        if (admin && only(["status", "amount", "reason", "due", "creditor", "creditorUid", "notified"])
          && ["pending", "approved", "rejected"].includes(after.status) && validDebt(after)) return true;
        if (role === "subject" && before.status === "approved" && only(["claim"])
          && (after.claim === null || (Number.isInteger(after.claim.amount) && after.claim.amount >= 1
            && after.claim.amount <= before.amount && fresh(after.claim.ts)))) return true;
        if (before.creditorUid === uid && before.status === "approved" && before.claim
          && after.claim === null && only(["claim", "payments"])) {
          const a = before.payments || [], b = after.payments || [];
          if (JSON.stringify(a) === JSON.stringify(b)) return true;
          return b.length === a.length + 1 && JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a)
            && b[a.length].amount === before.claim.amount && fresh(b[a.length].ts);
        }
        return false;
      }
      if (col === "site") {
        return admin && id === "subject" && op !== "delete" && validSubject(after);
      }
      if (col === "replies") {
        if (op === "delete") return admin || before.uid === uid;
        if (op === "update") return false;
        const m = Math.floor(Date.now() / 60000), ok = [];
        [m, m - 1].forEach((mm) => { for (let s = 0; s < 3; s++) ok.push(uid + "_" + mm + "_" + s); });
        return ok.includes(id) && after.uid === uid && after.user === p.name && !!db.ratings[after.reviewId]
          && typeof after.text === "string" && after.text.length > 0 && after.text.length <= L.replyMax && fresh(after.ts);
      }
      if (col === "badges") {
        return admin && (op === "delete" || (typeof after.title === "string" && after.title.length > 0 && after.title.length <= 40
          && typeof after.desc === "string" && after.desc.length <= 120
          && typeof after.icon === "string" && after.icon.length <= 8 && typeof after.earned === "boolean"));
      }
      if (col === "services") {
        return admin && (op === "delete" || (typeof after.title === "string" && after.title.length > 0 && after.title.length <= 60
          && Number.isInteger(after.price) && after.price >= 0 && after.price <= L.amountMax
          && typeof after.desc === "string" && after.desc.length <= 200));
      }
      if (col === "ratings") {
        if (op === "delete") return admin || id === uid;
        return id === uid && role !== "subject" && Number.isInteger(after.value) && after.value >= 1 && after.value <= 5
          && typeof after.text === "string" && after.text.length <= L.reviewMax
          && Object.keys(after).every((k) => ["value", "text", "user", "ts"].includes(k))
          && after.user === p.name && fresh(after.ts);
      }
      return false;
    }

    function commit(op, col, id, after) {
      const uid = session();
      const db = read();
      const before = db[col][id] || null;
      if (op === "update" && !before) return Promise.reject(invalid("Запис не знайдено."));
      if (op === "set") op = before ? "update" : "create";
      if (op === "update" && after) after = Object.assign({}, before, after);
      if (!uid || !allowed(op, col, id, before, after, uid)) return Promise.reject(deny());
      if (op === "delete") delete db[col][id];
      else db[col][id] = JSON.parse(JSON.stringify(after));
      write(db);
      publish();
      return Promise.resolve();
    }

    return {
      kind: "local",
      onAuth(cb) {
        authCb = cb;
        setTimeout(() => cb(session() === "guest" ? { uid: "guest", login: "guest", guest: true } : account(session())), 0);
      },
      signInGuest() {
        try { localStorage.setItem(SESSION_KEY, "guest"); } catch (e) {}
        authCb && authCb({ uid: "guest", login: "guest", guest: true });
        return Promise.resolve();
      },
      signIn(login, password) {
        const acc = read().accounts[login];
        if (!acc || acc.password !== password) {
          const e = new Error("bad"); e.code = "auth/invalid-credential";
          return Promise.reject(e);
        }
        try { localStorage.setItem(SESSION_KEY, acc.uid); } catch (e) {}
        authCb && authCb({ uid: acc.uid, login });
        return Promise.resolve();
      },
      signOut() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        listening = false;
        authCb && authCb(null);
        return Promise.resolve();
      },
      getProfile(uid) {
        const p = read().users[uid];
        return Promise.resolve(p ? Object.assign({ id: uid }, p) : null);
      },
      createProfile(uid, profile) { return commit("create", "users", uid, profile); },
      listen(cb) { dataCb = cb; listening = true; publish(); },
      stop() { listening = false; },
      add(col, data) { return commit("create", col, rid(), data); },
      set(col, id, data) { return commit("set", col, id, data); },
      update(col, id, patch) { return commit("update", col, id, patch); },
      remove(col, id) { return commit("delete", col, id, null); },
      reset() { try { localStorage.removeItem(DB_KEY); } catch (e) {} }
    };
  }

  /* ============================================================
     СХОВИЩЕ 2: Firebase (compat-версія, глобальний firebase)
     ============================================================ */
  function firebaseBackend() {
    firebase.initializeApp(C.firebase);
    const auth = firebase.auth();
    const db = firebase.firestore();
    let unsubs = [];

    return {
      kind: "firebase",
      raw: { auth, db },   // для перевірки атак із консолі браузера
      onAuth(cb) {
        auth.onAuthStateChanged((u) => cb(u
          ? { uid: u.uid, login: (u.email || "").split("@")[0], guest: u.isAnonymous }
          : null));
      },
      // гість заходить анонімно: без акаунта, лише перегляд
      signInGuest() { return auth.signInAnonymously(); },
      signIn(login, password) {
        return auth.signInWithEmailAndPassword(login + "@" + C.loginDomain, password);
      },
      signOut() { return auth.signOut(); },
      async getProfile(uid) {
        const s = await db.collection("users").doc(uid).get();
        return s.exists ? Object.assign({ id: uid }, s.data()) : null;
      },
      createProfile(uid, profile) { return db.collection("users").doc(uid).set(profile); },
      listen(cb, onError) {
        this.stop();
        unsubs = COLS.map((col) =>
          // includeMetadataChanges: щоб позначка _pending знімалась, щойно сервер підтвердив запис
          db.collection(col).onSnapshot({ includeMetadataChanges: true },
            (snap) => {
              // _pending: запис ще не підтвердив сервер (може бути відхилений)
              state[col] = snap.docs.map((d) => Object.assign({ id: d.id, _pending: d.metadata.hasPendingWrites }, d.data()));
              cb();
            },
            (err) => onError && onError(err, col)
          ));
      },
      stop() { unsubs.forEach((u) => u()); unsubs = []; },
      add(col, data) { return db.collection(col).add(data); },
      set(col, id, data) { return db.collection(col).doc(id).set(data); },
      update(col, id, patch) { return db.collection(col).doc(id).update(patch); },
      remove(col, id) { return db.collection(col).doc(id).delete(); }
    };
  }

  const B = C.backend === "firebase" && window.firebase ? firebaseBackend() : localBackend();

  function clearState() {
    COLS.forEach((col) => { state[col] = []; });
  }

  const find = (id) => state.debts.find((d) => d.id === id);

  // Гість — тільки перегляд. Кнопок йому не показують, але й прямий
  // виклик має відмовити; у базі те саме роблять правила.
  function guestBlocked() {
    return me && me.guest ? Promise.reject(invalid("Режим гостя: тільки перегляд.")) : null;
  }

  /* ============================================================
     ПУБЛІЧНИЙ ІНТЕРФЕЙС
     ============================================================ */
  window.Store = {
    mode: B.kind,
    raw: B.raw,
    state,
    calc,
    get me() { return me; },
    isOwnerLogin,

    // досьє з бази; null — ще не заповнене
    get subject() { return state.site.find((d) => d.id === "subject") || null; },
    limitsSubject: { photoMax: 400000 },
    validSubject,

    /* onAuth(me | null, причина) — вхід/вихід; onData() — будь-яка зміна даних */
    start({ onAuth, onData }) {
      B.onAuth(async (acc) => {
        if (!acc) {
          me = null;
          B.stop();
          clearState();
          onAuth(null, kickReason);
          kickReason = null;
          return;
        }
        // Гість: профілю в базі немає, писати нічого не може.
        if (acc.guest) {
          me = { uid: acc.uid, login: "guest", name: "Гість", role: "guest", active: true, guest: true };
          onAuth(me);
          B.listen(onData, (err, col) => console.warn("noxon: підписка на «" + col + "» не працює:", err.code || err));
          return;
        }
        try {
          let p = await B.getProfile(acc.uid);
          if (!p) {
            // Перший вхід: профіль — "кредитор" (власник — одразу адмін).
            const profile = {
              login: acc.login,
              name: (acc.login[0] || "?").toUpperCase() + acc.login.slice(1),
              role: isOwnerLogin(acc.login) ? "admin" : "member",
              active: true
            };
            await B.createProfile(acc.uid, profile);
            p = Object.assign({ id: acc.uid }, profile);
          }
          const owner = isOwnerLogin(acc.login);
          // Власник не може втратити права: якщо профіль зіпсовано — лікуємо
          if (owner && (p.role !== "admin" || p.active !== true)) {
            try { await B.update("users", acc.uid, { role: "admin", active: true }); } catch (e) {}
            p = Object.assign({}, p, { role: "admin", active: true });
          }
          if (!owner && p.active === false) {
            kickReason = "Цей логін вимкнено адміністратором.";
            await B.signOut();
            return;
          }
          me = { uid: acc.uid, login: acc.login, name: p.name, role: owner ? "admin" : p.role, active: true, owner };
          onAuth(me);
          B.listen(() => {
            // адмін міг щойно змінити мені роль чи вимкнути доступ
            // Зважаємо лише на підтверджене сервером: Firestore спершу показує
            // запис локально, а відхилений сервером — відкочує. Без цієї
            // перевірки відхилена атака «вимкни себе» розлогінювала б людину.
            const fresh = state.users.find((u) => u.id === me.uid && !u._pending);
            if (fresh && fresh.active === false && !me.owner) {
              kickReason = "Доступ вимкнено адміністратором.";
              B.signOut();
              return;
            }
            if (fresh) me = { uid: me.uid, login: me.login, name: fresh.name, role: me.owner ? "admin" : fresh.role, active: true, owner: me.owner };
            onData();
          }, (err, col) => {
            // Розлогінюємо лише тоді, коли закрито список людей: це означає,
            // що мене вимкнули. Відмова на будь-якій іншій колекції (наприклад,
            // її прибрали з правил) не має викидати людину з сайту.
            if (err.code === "permission-denied" && col === "users" && !me.owner) {
              kickReason = "Доступ закрито. Звернись до адміна.";
              B.signOut();
            } else {
              console.warn("noxon: підписка на «" + col + "» не працює:", err.code || err);
            }
          });
        } catch (err) {
          kickReason = "Не вдалося завантажити профіль (" + (err.code || err.message) + ").";
          B.signOut();
        }
      });
    },

    loginGuest() { return B.signInGuest(); },

    login(login, password) {
      login = String(login || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(login)) return Promise.reject(invalid("Логін — латиниця, цифри, крапка або дефіс."));
      if (!password) return Promise.reject(invalid("Введи пароль."));
      return B.signIn(login, password);
    },
    logout() { return B.signOut(); },
    resetDemo() { if (B.reset) { B.reset(); location.reload(); } },

    /* ---------------- БОРГИ ---------------- */
    // Кожен сам за себе: кредитор боргу — завжди той, хто подає заявку.
    addDebt({ amount, reason, due }) {
      const stop = guestBlocked(); if (stop) return stop;
      amount = Number(amount);
      reason = String(reason || "").trim();
      if (!Number.isInteger(amount) || amount < 1 || amount > L.amountMax)
        return Promise.reject(invalid("Сума — ціле число від 1 до " + L.amountMax + "."));
      if (!reason) return Promise.reject(invalid("Напиши, за що."));
      if (reason.length > L.reasonMax) return Promise.reject(invalid("Опис — до " + L.reasonMax + " символів."));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due || "")) return Promise.reject(invalid("Вкажи дату повернення."));
      if (me.role === "subject") return Promise.reject(invalid("Герой сайту не вносить боргів сам собі."));
      return B.add("debts", {
        amount, reason,
        creditor: me.name,
        creditorUid: me.uid,
        author: me.name,
        due,
        status: "pending",
        payments: [],
        claim: null,
        ts: Date.now()
      }).then((r) => {
        // Нова заявка — сказати боту, щоб повідомив адміна в Telegram.
        // Бот сам читає базу, тож тут нічого не передаємо; помилку ігноруємо.
        if (B.kind === "firebase" && C.notifyUrl) {
          fetch(C.notifyUrl, { method: "POST", keepalive: true }).catch(() => {});
        }
        return r;
      });
    },
    approve(id) { return guestBlocked() || B.update("debts", id, { status: "approved" }); },
    reject(id)  { return guestBlocked() || B.update("debts", id, { status: "rejected" }); },
    removeDebt(id) { return guestBlocked() || B.remove("debts", id); },

    // старі записи без creditorUid: адмін вказує, чий це борг
    bindCreditor(id, uid) {
      const u = state.users.find((x) => x.id === uid);
      if (!u) return Promise.reject(invalid("Людину не знайдено."));
      return B.update("debts", id, { creditorUid: u.id, creditor: u.name });
    },

    // Герой сайту: "віддав X". Поки кредитор не підтвердив — не зараховується.
    claim(id, amount) {
      const stop = guestBlocked(); if (stop) return stop;
      const d = find(id);
      amount = Math.round(Number(amount));
      if (!d) return Promise.reject(invalid("Запис не знайдено."));
      if (!(amount >= 1)) return Promise.reject(invalid("Вкажи суму."));
      return B.update("debts", id, { claim: { amount: Math.min(amount, calc.left(d)), ts: Date.now() } });
    },
    cancelClaim(id) { return guestBlocked() || B.update("debts", id, { claim: null }); },

    // Кредитор: "отримав" — один платіж у кінець списку, заявка гасне.
    confirm(id) {
      const stop = guestBlocked(); if (stop) return stop;
      const d = find(id);
      if (!d || !d.claim) return Promise.reject(invalid("Заявки вже немає."));
      return B.update("debts", id, {
        payments: [...(d.payments || []), { amount: d.claim.amount, ts: Date.now() }],
        claim: null
      });
    },
    // Кредитор: "не отримував" — заявка гасне, сума не змінюється.
    deny(id) { return guestBlocked() || B.update("debts", id, { claim: null }); },

    /* ---------------- ДОСЬЄ ---------------- */
    saveSubject(data) {
      const stop = guestBlocked(); if (stop) return stop;
      if (!validSubject(data)) return Promise.reject(invalid("Перевір поля досьє: щось задовге або в неправильному форматі."));
      return B.set("site", "subject", data);
    },

    /* ---------------- ЛЮДИ ---------------- */
    updateUser(uid, patch) { return guestBlocked() || B.update("users", uid, patch); },

    /* ---------------- ВІДГУКИ ----------------
       Як у Google Maps: зірки + необов'язковий текст в одному документі.
       Ключ документа = мій uid, тож одна людина — один відгук: повторна
       публікація переписує старий, а написати за іншого неможливо. */
    saveReview({ value, text }) {
      const stop = guestBlocked(); if (stop) return stop;
      value = Number(value);
      text = String(text || "").trim();
      if (!Number.isInteger(value) || value < 1 || value > 5) return Promise.reject(invalid("Постав від 1 до 5 зірок."));
      if (text.length > L.reviewMax) return Promise.reject(invalid("Відгук — до " + L.reviewMax + " символів."));
      if (me.role === "subject") return Promise.reject(invalid("Герой сайту не оцінює сам себе."));
      return B.set("ratings", me.uid, { value, text, user: me.name, ts: Date.now() });
    },
    // свій відгук — автор; чужий — лише адмін
    removeReview(uid) { return guestBlocked() || B.remove("ratings", uid); },

    /* ---------------- ВІДПОВІДІ ПІД ВІДГУКАМИ ----------------
       Антиспам у ключі, як колись у коментарях: uid_хвилина_слот,
       слоти 0–2 — не більше трьох відповідей на хвилину. */
    async addReply(reviewId, text) {
      const stop = guestBlocked(); if (stop) return stop;
      text = String(text || "").trim();
      if (!text) throw invalid("Напиши відповідь.");
      if (text.length > L.replyMax) throw invalid("Відповідь — до " + L.replyMax + " символів.");
      const minute = Math.floor(Date.now() / 60000);
      const taken = new Set(state.replies.map((r) => r.id));
      for (let slot = 0; slot < 3; slot++) {
        const id = me.uid + "_" + minute + "_" + slot;
        if (taken.has(id)) continue;
        try {
          await B.set("replies", id, { reviewId, uid: me.uid, user: me.name, text, ts: Date.now() });
          return;
        } catch (e) {
          if (e.code !== "permission-denied") throw e;
        }
      }
      throw invalid("Не більше трьох відповідей на хвилину. Зачекай трохи.");
    },
    removeReply(id) { return guestBlocked() || B.remove("replies", id); },

    /* ---------------- ВЛАСНІ АЧІВКИ (адмін) ---------------- */
    saveBadge(id, { title, desc, icon, earned }) {
      const stop = guestBlocked(); if (stop) return stop;
      const data = {
        title: String(title || "").trim(),
        desc: String(desc || "").trim(),
        icon: String(icon || "").trim() || "🏆",
        earned: !!earned,
        ts: Date.now()
      };
      if (!data.title) return Promise.reject(invalid("Дай ачівці назву."));
      if (data.title.length > 40) return Promise.reject(invalid("Назва — до 40 символів."));
      if (data.desc.length > 120) return Promise.reject(invalid("Опис — до 120 символів."));
      if (data.icon.length > 8) return Promise.reject(invalid("Значок — один-два символи або емодзі."));
      return id ? B.update("badges", id, data) : B.add("badges", data);
    },
    removeBadge(id) { return guestBlocked() || B.remove("badges", id); },

    /* ---------------- ПОСЛУГИ: ВІДПРАЦЮВАТИ БОРГ (адмін) ---------------- */
    saveService(id, { title, price, desc }) {
      const stop = guestBlocked(); if (stop) return stop;
      const data = {
        title: String(title || "").trim(),
        price: Number(price),
        desc: String(desc || "").trim(),
        ts: Date.now()
      };
      if (!data.title) return Promise.reject(invalid("Назви послугу."));
      if (data.title.length > 60) return Promise.reject(invalid("Назва — до 60 символів."));
      if (!Number.isInteger(data.price) || data.price < 0 || data.price > L.amountMax)
        return Promise.reject(invalid("Ціна — ціле число від 0 до " + L.amountMax + "."));
      if (data.desc.length > 200) return Promise.reject(invalid("Опис — до 200 символів."));
      return id ? B.update("services", id, data) : B.add("services", data);
    },
    removeService(id) { return guestBlocked() || B.remove("services", id); }
  };
})();
