/* ============================================================
   app.js — малювання сторінки й обробка натискань.
   Не знає, де лежать дані: усе через Store.
   ============================================================ */

(function () {
  "use strict";

  const C = window.CONFIG;
  const S = window.Store;
  const K = S.calc;
  const $ = (id) => document.getElementById(id);

  /* ---------------- ДОПОМІЖНЕ ---------------- */

  // Чужий текст завжди екранується — інакше скрипт у коментарі виконається.
  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const nf = new Intl.NumberFormat("uk-UA");
  const money = (n) => nf.format(n) + " " + C.currency;
  const short = (n) => n >= 1000 ? (Math.round(n / 100) / 10).toString().replace(".", ",") + "k" : String(n);

  const dShort = (v) => K.day(v).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }).replace(".", "");
  const dFull = (v) => K.day(v).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
  const dTime = (ts) => new Date(ts).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  const days = (n) => n + " " + plural(n, "день", "дні", "днів");

  function dueText(n) {
    if (n < 0) return "прострочено на " + days(-n);
    if (n === 0) return "сьогодні";
    if (n === 1) return "завтра";
    return "через " + days(n);
  }

  const ROLE = { admin: "адмін", subject: "герой сайту", member: "кредитор", guest: "гість · тільки перегляд" };
  const me = () => S.me;
  const isAdmin = () => me() && me().role === "admin";
  const isSubject = () => me() && me().role === "subject";
  const isGuest = () => !!(me() && me().guest);

  /* Гість бачить суми й строки, але не імена: замість «Ростик» —
     «Кредитор 1». Номер закріплюється за людиною на весь сеанс.
     Це ширма в інтерфейсі, а не таємниця: самі записи гість читає. */
  const aliases = new Map();
  function mask(key, name, word) {
    if (!isGuest()) return name;
    if (!aliases.has(key)) aliases.set(key, (word || "Кредитор") + " " + (aliases.size + 1));
    return aliases.get(key);
  }
  const creditorName = (d) => mask(d.creditorUid || "n:" + d.creditor, d.creditor);

  function humanError(err) {
    const code = err && err.code;
    if (code === "invalid" || code === "spam") return err.message;
    switch (code) {
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
      case "auth/wrong-password":
      case "auth/user-not-found": return "Невірний логін або пароль.";
      case "auth/invalid-email": return "Логін — латиниця, без пробілів.";
      case "auth/user-disabled": return "Цей логін вимкнено.";
      case "auth/too-many-requests": return "Забагато спроб. Спробуй за кілька хвилин.";
      case "auth/network-request-failed":
      case "unavailable": return "Немає зв'язку з сервером.";
      case "permission-denied": return "База відмовила: на це немає прав.";
      default: return "Щось пішло не так" + (code ? " (" + code + ")" : "") + ".";
    }
  }

  let toastTimer = null;
  function toast(text, bad) {
    const t = $("toast");
    t.textContent = text;
    t.classList.toggle("bad", !!bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // Будь-яка дія з кнопки: помилку показуємо людською мовою
  function act(promise, ok) {
    return Promise.resolve(promise)
      .then(() => { if (ok) toast(ok); })
      .catch((err) => toast(humanError(err), true));
  }

  // Поки людина друкує в полі всередині блоку — не перемальовуємо його,
  // інакше чужа зміна в базі зітре те, що вона вводить.
  function busy(el) {
    const a = document.activeElement;
    return el.contains(a) && a.matches("input, textarea, select");
  }

  /* ---------------- ТЕМА ---------------- */
  try {
    const saved = localStorage.getItem("noxon.theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch (e) {}

  $("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("noxon.theme", root.dataset.theme); } catch (e) {}
  });

  /* ============================================================
     ВХІД
     ============================================================ */
  if (S.mode === "local") {
    $("loginDemo").hidden = false;
    $("loginDemo").innerHTML = "Демо-режим, дані лише в цьому браузері. Логіни: " +
      C.demoUsers.map((u) => "<code>" + esc(u.login) + "</code>").join(" · ") +
      ". Пароль = логін.";
    $("modeBadge").hidden = false;
    $("resetDemo").hidden = false;
  }

  function loginError(text) {
    $("loginError").textContent = text || "";
    $("loginError").hidden = !text;
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    loginError("");
    try {
      await S.login($("loginName").value, $("loginPass").value);
    } catch (err) {
      loginError(humanError(err));
      $("loginPass").value = "";
    } finally {
      btn.disabled = false;
    }
  });

  $("guestBtn").addEventListener("click", async () => {
    loginError("");
    try { await S.loginGuest(); }
    catch (err) { loginError(err.code === "auth/operation-not-allowed"
      ? "Режим гостя вимкнено в налаштуваннях Firebase."
      : humanError(err)); }
  });

  $("logoutBtn").addEventListener("click", () => S.logout());
  $("resetDemo").addEventListener("click", () => {
    if (confirm("Стерти всі демо-дані в цьому браузері й почати заново?")) S.resetDemo();
  });

  let staticDone = false;

  S.start({
    onAuth(user, reason) {
      if (!user) {
        $("app").hidden = true;
        $("login").hidden = false;
        $("loginPass").value = "";
        loginError(reason || "");
        // вийшов — прибираємо з розмітки все, що прийшло з бази
        ["dossier", "metrics", "hot", "about", "traits", "timeline", "creditors", "services", "queue",
         "calendar", "ledger", "pending", "people", "achievements", "rvSummary", "rvMine", "rvToolbar", "rvList", "meChip", "fNote", "claimInfo"]
          .forEach((id) => { $(id).innerHTML = ""; });
        subjectKey = null;
        introDone = false;
        $("hot")._html = null;
        $("metrics")._html = null;
        rvEditing = false;
        document.title = C.siteName;
        return;
      }
      $("login").hidden = true;
      $("app").hidden = false;
      loginError("");
      if (!staticDone) { renderStatic(); staticDone = true; }
      renderAll();
    },
    onData: renderAll
  });

  /* --- іконки для кнопок соцмереж --- */
  const ICON = {
    tg: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M21.5 4.3 2.9 11.5c-1.3.5-1.2 1.3-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5ZM8.9 14.2l9-5.7c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.1-1.8-4.3Z"/></svg>',
    ig: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 2c-2.7 0-3 0-4.1.1C4.2 2.3 2.3 4.2 2.1 7.9 2 9 2 9.3 2 12s0 3 .1 4.1c.2 3.7 2.1 5.6 5.8 5.8 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c3.7-.2 5.6-2.1 5.8-5.8.1-1.1.1-1.4.1-4.1s0-3-.1-4.1c-.2-3.7-2.1-5.6-5.8-5.8C15 2 14.7 2 12 2Zm0 1.8c2.7 0 3 0 4 .1 2.7.1 4 1.4 4.1 4.1.1 1 .1 1.3.1 4s0 3-.1 4c-.1 2.7-1.4 4-4.1 4.1-1 .1-1.3.1-4 .1s-3 0-4-.1c-2.7-.1-4-1.4-4.1-4.1-.1-1-.1-1.3-.1-4s0-3 .1-4C4 5.3 5.3 4 8 3.9c1-.1 1.3-.1 4-.1Z"/></svg>'
  };

  /* --- дорожні знаки ---------------------------------------------
     Мова сайту — дорожні знаки: червоний трикутник «Увага» — прострочене,
     жовтий ромб — надійність, синя табличка — інформація, білий круг
     з косою рискою — «кінець обмеження», тобто закрито. Малюємо SVG,
     щоб трикутник був справжнім, а не символом ▲. */
  const SIGN = {
    warn: (cls = "") => `<svg class="sign sign-warn ${cls}" viewBox="0 0 100 90" aria-hidden="true">
        <path class="sign-edge" pathLength="100" d="M50 83 H7 L50 7 L93 83 Z"/>
        <g class="sign-mark"><rect x="45.5" y="32" width="9" height="28" rx="4"/><circle cx="50" cy="70" r="5.5"/></g>
      </svg>`,
    info: (glyph, cls = "") => `<svg class="sign sign-info ${cls}" viewBox="0 0 100 100" aria-hidden="true">
        <rect x="5" y="5" width="90" height="90" rx="14"/><text x="50" y="68" text-anchor="middle">${glyph}</text>
      </svg>`,
    diamond: (cls = "") => `<svg class="sign sign-diamond ${cls}" viewBox="0 0 100 100" aria-hidden="true">
        <rect class="d-out" x="17" y="17" width="66" height="66" rx="6" transform="rotate(45 50 50)"/>
        <rect class="d-in" x="29" y="29" width="42" height="42" rx="3" transform="rotate(45 50 50)"/>
      </svg>`,
    round: (glyph, cls = "") => `<svg class="sign sign-round ${cls}" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44"/><text x="50" y="66" text-anchor="middle">${glyph}</text>
      </svg>`,
    end: (cls = "") => `<svg class="sign sign-end ${cls}" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44"/><path d="M22 78 L78 22 M30 84 L84 30 M16 70 L70 16"/>
      </svg>`
  };

  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Одна вступна мить після входу: знак промальовується, суми відлічуються.
  let introDone = false;
  function countUp(el) {
    const to = Number(el.dataset.to) || 0;
    if (!to) return;
    const final = money(to);
    // У прихованій вкладці кадри не малюються, тож анімація не почнеться
    // й сума назавжди лишилась би нулем. Тоді просто ставимо значення.
    if (reduceMotion() || document.hidden) { el.textContent = final; return; }
    const start = performance.now(), dur = 900;
    setTimeout(() => { el.textContent = final; }, dur + 200);   // страховка
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = money(Math.round(to * eased));
      if (k < 1) requestAnimationFrame(tick);
    };
    el.textContent = money(0);
    requestAnimationFrame(tick);
  }

  // Не перемальовувати, якщо нічого не змінилось: Firebase шле кілька
  // знімків поспіль, і анімація знака обривалась би на півдорозі.
  function put(el, html) {
    if (el._html === html) return false;
    el._html = html;
    el.innerHTML = html;
    return true;
  }

  /* ============================================================
     ДОСЬЄ — з бази (site/subject), а не з коду.
     Репозиторій публічний, тож дані про людину живуть у Firestore
     і доходять до браузера лише після входу.
     ============================================================ */
  // посилання з бази пускаємо лише https — інакше javascript: у href
  const safeUrl = (u) => /^https:\/\/[^\s"'<>]+$/.test(u || "") ? u : "";
  const subject = () => S.subject;
  const heroName = () => {
    const s = subject();
    return s && s.name ? s.name.split(" ")[0] : "Герой сайту";
  };

  let subjectKey = null;

  function renderSubject() {
    const s = subject();
    const key = JSON.stringify(s) + "|" + isAdmin();
    if (key === subjectKey) return;          // нічого не змінилось — фото не блимає
    subjectKey = key;

    const editBtn = isAdmin()
      ? `<button class="btn btn-sm btn-ghost" type="button" id="editSubject">Редагувати досьє</button>` : "";

    if (!s) {
      document.title = C.siteName;
      $("dossier").innerHTML = `
        <div class="hero-photo"><span>?</span></div>
        <div class="hero-body">
          <h1 class="hero-name">Досьє порожнє</h1>
          <p class="hero-tag">${isAdmin() ? "Заповни його — дані збережуться в базі й будуть видні лише після входу." : "Адмін ще не заповнив досьє."}</p>
          <div class="hero-links">${editBtn}</div>
        </div>`;
      $("about").innerHTML = `<p class="empty">Поки порожньо.</p>`;
      $("traits").innerHTML = `<p class="empty">Поки порожньо.</p>`;
      $("timeline").innerHTML = "";
      return;
    }

    document.title = C.siteName + " · " + s.name;
    const facts = [];
    if (s.birthday) facts.push(["Вік", K.age(s.birthday) + " (" + dFull(s.birthday) + ")"]);
    if (s.city) facts.push(["Місто", s.city]);
    if (s.job) facts.push(["Робота", s.job]);
    const tg = safeUrl(s.telegram), ig = safeUrl(s.instagram);

    $("dossier").innerHTML = `
      <div class="hero-photo" id="heroPhoto"><span>${esc((s.name || "?")[0])}</span></div>
      <div class="hero-body">
        <h1 class="hero-name">${esc(s.name)}</h1>
        ${s.tagline ? `<p class="hero-tag">${esc(s.tagline)}</p>` : ""}
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
        <div class="hero-links">
          ${tg ? `<a class="btn btn-sm btn-soft" href="${esc(tg)}" target="_blank" rel="noopener noreferrer">${ICON.tg} Telegram</a>` : ""}
          ${ig ? `<a class="btn btn-sm btn-soft" href="${esc(ig)}" target="_blank" rel="noopener noreferrer">${ICON.ig} Instagram</a>` : ""}
          ${editBtn}
        </div>
      </div>`;

    if (/^data:image\/(jpeg|png|webp);base64,/.test(s.photo || "")) {
      const img = new Image();
      img.alt = s.name;
      img.onload = () => { const box = $("heroPhoto"); if (box) box.replaceChildren(img); };
      img.src = s.photo;
    }

    $("about").innerHTML = (s.about || []).length
      ? s.about.map((p) => `<p>${esc(p)}</p>`).join("") : `<p class="empty">Поки порожньо.</p>`;

    $("traits").innerHTML = (s.traits || []).length ? s.traits.map((t) => {
      const v = Math.max(0, Math.min(10, Number(t.value) || 0));
      return `
      <div class="trait">
        <div class="trait-top"><span>${esc(t.label)}</span><b>${v}<small>/10</small></b></div>
        <div class="meter" role="img" aria-label="${esc(t.label)}: ${v} з 10">
          ${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? "on" : ""}"></i>`).join("")}
        </div>
      </div>`;
    }).join("") : `<p class="empty">Поки порожньо.</p>`;

    $("timeline").innerHTML = (s.timeline || []).map((e) => `
      <li><b>${esc(e.year)}</b><span>${esc(e.text)}</span></li>`).join("");
  }

  /* --- редагування досьє (адмін) ----------------------------------
     Абзаци — через порожній рядок; риси — «Назва = 7»;
     хронологія — «2006 — подія». Фото стискаємо в браузері до ~500px
     і зберігаємо в документі як data:image/jpeg. */
  let photoDraft = "";

  function openSubjectEditor() {
    const s = subject() || {};
    $("sName").value = s.name || "";
    $("sTagline").value = s.tagline || "";
    $("sBirthday").value = s.birthday || "";
    $("sCity").value = s.city || "";
    $("sJob").value = s.job || "";
    $("sTelegram").value = s.telegram || "";
    $("sInstagram").value = s.instagram || "";
    $("sAbout").value = (s.about || []).join("\n\n");
    $("sTraits").value = (s.traits || []).map((t) => t.label + " = " + t.value).join("\n");
    $("sTimeline").value = (s.timeline || []).map((t) => t.year + " — " + t.text).join("\n");
    $("sPhotoFile").value = "";
    setPhotoDraft(s.photo || "");
    $("sError").hidden = true;
    $("subjectDialog").showModal();
  }

  function setPhotoDraft(data) {
    photoDraft = data;
    $("sPhotoPreview").innerHTML = data ? `<img src="${esc(data)}" alt="">` : "<span>немає</span>";
    $("sPhotoClear").hidden = !data;
    $("sPhotoInfo").textContent = data ? Math.round(data.length / 1024) + " КБ" : "";
  }

  function shrinkImage(file, side = 520, max = S.limitsSubject.photoMax) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, side / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, out = c.toDataURL("image/jpeg", q);
        while (out.length > max * 0.9 && q > 0.35) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        if (out.length <= max) resolve(out);
        else reject(new Error("Фото завелике навіть після стискання."));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Це не схоже на зображення.")); };
      img.src = url;
    });
  }

  $("dossier").addEventListener("click", (e) => {
    if (e.target.closest("#editSubject")) openSubjectEditor();
  });

  $("sPhotoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { setPhotoDraft(await shrinkImage(file)); }
    catch (err) { $("sError").textContent = err.message; $("sError").hidden = false; }
  });
  $("sPhotoClear").addEventListener("click", () => { $("sPhotoFile").value = ""; setPhotoDraft(""); });
  $("sCancel").addEventListener("click", () => $("subjectDialog").close());

  $("subjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lines = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
    const data = {
      name: $("sName").value.trim(),
      tagline: $("sTagline").value.trim(),
      birthday: $("sBirthday").value,
      city: $("sCity").value.trim(),
      job: $("sJob").value.trim(),
      telegram: $("sTelegram").value.trim(),
      instagram: $("sInstagram").value.trim(),
      about: $("sAbout").value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      traits: lines("sTraits").map((l) => {
        const m = l.match(/^(.*?)\s*[=:]\s*(\d{1,2})$/);
        return m ? { label: m[1].trim(), value: Math.min(10, Number(m[2])) } : null;
      }).filter(Boolean),
      timeline: lines("sTimeline").map((l) => {
        const m = l.match(/^(\S+)\s*[—–-]\s*(.+)$/);
        return m ? { year: m[1], text: m[2].trim() } : null;
      }).filter(Boolean),
      photo: photoDraft
    };
    const bad = [["Telegram", data.telegram], ["Instagram", data.instagram]].find(([, u]) => u && !safeUrl(u));
    if (bad) {
      $("sError").textContent = bad[0] + ": посилання має починатися з https://";
      $("sError").hidden = false;
      return;
    }

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await S.saveSubject(data);
      $("subjectDialog").close();
      toast("Досьє збережено");
    } catch (err) {
      $("sError").textContent = humanError(err);
      $("sError").hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* --- ліміти форм із config.js ----------------------------------- */
  function renderStatic() {
    $("fAmount").max = C.limits.amountMax;
    $("fReason").maxLength = C.limits.reasonMax;
    $("fReason").placeholder = "до " + C.limits.reasonMax + " символів";
    $("rvText").maxLength = C.limits.reviewMax;
    // дата за замовчуванням — через два тижні
    const d = K.today(); d.setDate(d.getDate() + 14);
    $("fDue").value = K.iso(d);
    $("fDue").min = K.iso(K.today());
  }

  /* ============================================================
     ДИНАМІКА — на кожну зміну даних
     ============================================================ */
  function renderAll() {
    if (!me()) return;
    $("meChip").innerHTML = isGuest()
      ? `<b>Гість</b><span>тільки перегляд</span>`
      : `<b>${esc(me().name)}</b><span>${ROLE[me().role] || esc(me().role)}</span>`;
    $("pendingBlock").hidden = !isAdmin();
    $("peopleBlock").hidden = !isAdmin();
    $("addService").hidden = !isAdmin();
    $("addBadge").hidden = !isAdmin();
    document.querySelector('#nav [data-admin]').hidden = !isAdmin();
    $("formBlock").hidden = isGuest() || isSubject();
    document.querySelector('#ledgerTabs [data-tab="other"]').hidden = isGuest();
    if (isGuest() && tab === "other") tab = "open";

    renderSubject();
    renderMetrics();
    renderCreditors();
    renderServices();
    renderQueue();
    renderCalendar();
    renderLedger();
    renderForm();
    if (isAdmin()) { renderPending(); renderPeople(); }
    renderAchievements();
    renderReviews();
    renderTelegram();
  }

  /* --- Telegram-бот: прив'язка ------------------------------------
     Код генерується тут, посилання відкривається одразу (інакше браузер
     заблокує нове вікно), а код пишеться в базу паралельно — бот, якщо
     не знайде його з першого разу, перепитає через секунду-дві. */
  function renderTelegram() {
    $("tgRow").hidden = isGuest();
    if (isGuest()) return;
    const tg = S.telegram;
    $("tgState").textContent = tg ? "підключено ✓ — сповіщення приходять у Telegram" : "не підключено";
    $("tgLink").hidden = !!tg;
    $("tgUnlink").hidden = !tg;
  }
  $("tgLink").addEventListener("click", () => {
    const code = S.telegramCode();
    const link = S.linkTelegram(code);
    link.then(() => toast("Відкрий Telegram і натисни «Start» — бот усе зробить сам"),
      (err) => toast(humanError(err), true));
    if (S.mode === "firebase") window.open(S.telegramUrl(code), "_blank", "noopener");
  });
  $("tgUnlink").addEventListener("click", () => {
    if (confirm("Відв'язати Telegram? Сповіщення перестануть приходити.")) act(S.unlinkTelegram(), "Telegram відв'язано");
  });

  /* --- «Що горить» + чотири метрики -----------------------------
     Критерій успіху з ТЗ: за п'ять секунд видно, кому винен і що
     горить. Тому головний елемент сторінки — знак «Увага». */
  function renderMetrics() {
    const t = K.totals();
    const r = K.reliability();
    const rt = K.rating();
    const q = K.queue();

    // знак
    let hot;
    if (!q.length) {
      hot = `
        <div class="hot hot-clear">
          ${SIGN.info("✓", "hot-sign")}
          <div class="hot-body">
            <p class="hot-state">Рух вільний</p>
            <p class="hot-main">Відкритих боргів немає</p>
          </div>
        </div>`;
    } else {
      const first = q[0].debt, n = K.daysLeft(first);
      const bad = n < 0;
      hot = `
        <div class="hot ${bad ? "hot-bad" : "hot-soon"}">
          ${SIGN.warn("hot-sign")}
          <div class="hot-body">
            <p class="hot-state">${bad ? "Горить" : "Найближче"}</p>
            <p class="hot-main"><b>${esc(creditorName(first))}</b> чекає <span class="num" data-to="${q[0].left}">${money(q[0].left)}</span></p>
            <p class="hot-sub">${bad ? "прострочено на " + days(-n) + ", обіцяв до " + dShort(first.due)
              : "повернути " + dueText(n) + ", до " + dShort(first.due)}${q.length > 1 ? `, а в черзі ще ${q.length - 1}` : ""}</p>
          </div>
        </div>`;
    }
    const hotChanged = put($("hot"), hot);
    if (hotChanged && !introDone && S.state.debts.length) {
      introDone = true;
      if (!reduceMotion()) {
        $("hot").firstElementChild.classList.add("intro");
        $("hot").querySelectorAll("[data-to]").forEach(countUp);
      }
    }

    put($("metrics"), `
      <div class="metric metric-total">
        ${SIGN.info("₴", "m-sign")}
        <span class="m-label">Загальний борг</span>
        <strong class="m-value">${money(t.total)}</strong>
        <span class="m-sub">${t.count ? t.count + " " + plural(t.count, "відкритий борг", "відкриті борги", "відкритих боргів") : "боргів немає"}</span>
      </div>
      <div class="metric ${t.overdueCount ? "metric-bad" : ""}">
        ${t.overdueCount ? SIGN.warn("m-sign") : SIGN.end("m-sign")}
        <span class="m-label">Прострочено</span>
        <strong class="m-value">${money(t.overdue)}</strong>
        <span class="m-sub">${t.overdueCount ? t.overdueCount + " " + plural(t.overdueCount, "борг", "борги", "боргів") : "усе в строк"}</span>
      </div>
      <div class="metric">
        ${SIGN.diamond("m-sign")}
        <span class="m-label">Індекс надійності</span>
        <strong class="m-value">${r.percent === null ? "—" : r.percent + "%"}</strong>
        <span class="m-sub">${r.percent === null ? "ще нічого не закрито" : `вчасно ${r.onTime}, пізно ${r.late}, висить ${r.overdue}`}</span>
      </div>
      <div class="metric">
        ${SIGN.round("★", "m-sign")}
        <span class="m-label">Народна оцінка</span>
        <strong class="m-value">${rt.count ? rt.avg.toFixed(1).replace(".", ",") + "<small>/5</small>" : "—"}</strong>
        <span class="m-sub">${rt.count ? rt.count + " " + plural(rt.count, "відгук", "відгуки", "відгуків") : "ще ніхто не оцінив"}</span>
      </div>`);
  }

  /* --- кому скільки ---------------------------------------------- */
  function renderCreditors() {
    const list = K.byCreditor();
    if (!list.length) { $("creditors").innerHTML = `<p class="empty">Нікому нічого. Рідкісний кадр.</p>`; return; }
    const max = Math.max(...list.map((c) => c.sum));
    $("creditors").innerHTML = list.map((c) => `
      <div class="bar-row">
        <div class="bar-top"><span>${esc(mask(c.key || c.name, c.name))}</span><b>${money(c.sum)}</b></div>
        <div class="bar"><i style="width:${Math.max(3, (c.sum / max) * 100)}%"></i></div>
      </div>`).join("");
  }

  /* --- діалоги: закрити кнопкою «Скасувати» ---------------------- */
  document.querySelectorAll("dialog [data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close()));

  function formError(id, err) {
    $(id).textContent = err ? humanError(err) : "";
    $(id).hidden = !err;
  }

  /* --- каталог послуг Дмитра --------------------------------------
     Картки з фото, ціною й кнопкою «Оплатити» — вона веде в банку
     Monobank і підставляє суму (a=) та назву послуги в коментар (t=).
     Наповнює адмін. */
  const isPhoto = (p) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p || "");
  function payLink(s) {
    const base = safeUrl(C.payUrl);
    if (!base || !s) return base;
    return base + (base.includes("?") ? "&" : "?") + "a=" + s.price + "&t=" + encodeURIComponent("noxon: " + s.title);
  }
  function renderServices() {
    const list = [...S.state.services].sort((a, b) => a.price - b.price || a.ts - b.ts);
    $("services").innerHTML = list.length ? list.map((s) => `
      <article class="svc">
        <div class="svc-photo">${isPhoto(s.photo) ? `<img src="${s.photo}" alt="" loading="lazy">` : `${SIGN.info("₴", "svc-sign")}`}</div>
        <div class="svc-body">
          <b class="svc-title">${esc(s.title)}</b>
          ${s.desc ? `<p>${esc(s.desc)}</p>` : ""}
          <div class="svc-foot">
            <strong class="svc-price">${s.price ? money(s.price) : "безкоштовно"}</strong>
            ${s.price && payLink(s) ? `<a class="btn btn-sm btn-accent" href="${esc(payLink(s))}" target="_blank" rel="noopener">Оплатити</a>` : ""}
          </div>
          ${isAdmin() ? `<button class="link-btn" type="button" data-svc="${esc(s.id)}">Змінити</button>` : ""}
        </div>
      </article>`).join("")
      : `<p class="empty">${isAdmin() ? "Каталог порожній — додай першу послугу." : "Послуг поки немає."}</p>`;
  }

  /* посилання на банку й підтримку — з config.js */
  $("payJar").href = safeUrl(C.payUrl) || "#";
  $("payJar").hidden = !safeUrl(C.payUrl);
  document.querySelectorAll("[data-support]").forEach((a) => {
    a.href = safeUrl(C.supportUrl) || "#";
    a.hidden = !safeUrl(C.supportUrl);
  });

  let svPhoto = "";
  function setSvPhoto(data) {
    svPhoto = data;
    $("svPhotoPreview").innerHTML = data ? `<img src="${esc(data)}" alt="">` : "<span>немає</span>";
    $("svPhotoClear").hidden = !data;
    $("svPhotoInfo").textContent = data ? Math.round(data.length / 1024) + " КБ" : "";
  }
  $("svPhotoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { setSvPhoto(await shrinkImage(file, 640, S.limitsService.photoMax)); formError("svError", null); }
    catch (err) { formError("svError", err); }
  });
  $("svPhotoClear").addEventListener("click", () => { $("svPhotoFile").value = ""; setSvPhoto(""); });

  let serviceId = null;
  function openService(id) {
    const s = id ? S.state.services.find((x) => x.id === id) : null;
    serviceId = s ? s.id : null;
    $("svHead").textContent = s ? "Змінити послугу" : "Нова послуга";
    $("svTitle").value = s ? s.title : "";
    $("svPrice").value = s ? s.price : "";
    $("svDesc").value = s ? s.desc || "" : "";
    $("svPhotoFile").value = "";
    setSvPhoto(s && isPhoto(s.photo) ? s.photo : "");
    $("svDelete").hidden = !s;
    formError("svError", null);
    $("serviceDialog").showModal();
  }
  $("addService").addEventListener("click", () => openService(null));
  $("services").addEventListener("click", (e) => {
    const b = e.target.closest("[data-svc]");
    if (b) openService(b.dataset.svc);
  });
  $("serviceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await S.saveService(serviceId, { title: $("svTitle").value, price: $("svPrice").value, desc: $("svDesc").value, photo: svPhoto });
      $("serviceDialog").close();
      toast("Послугу збережено");
    } catch (err) { formError("svError", err); }
  });
  $("svDelete").addEventListener("click", () => {
    if (serviceId && confirm("Видалити послугу?")) {
      act(S.removeService(serviceId), "Послугу видалено");
      $("serviceDialog").close();
    }
  });

  /* --- експорт боргів у CSV для Excel -----------------------------
     «;» — роздільник, який Excel з українською локаллю розбирає сам;
     BOM на початку — щоб кирилиця не перетворилась на кракозябри. */
  function csvCell(v) {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // текст із бази не має стати формулою Excel
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $("exportCsv").addEventListener("click", () => {
    const rows = [["Дата повернення", "Кредитор", "За що", "Сума, ₴", "Повернуто, ₴", "Лишилось, ₴", "Статус"]];
    K.open().sort((a, b) => K.day(a.due) - K.day(b.due)).forEach((d) => {
      rows.push([dFull(d.due), creditorName(d), d.reason, d.amount, K.paid(d), K.left(d), dueText(K.daysLeft(d))]);
    });
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "noxon-borgy-" + K.iso(K.today()) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(rows.length > 1 ? "Файл для Excel завантажено" : "Відкритих боргів немає — файл порожній");
  });

  /* --- черга ------------------------------------------------------ */
  function renderQueue() {
    const q = K.queue();
    if (!q.length) { $("queue").innerHTML = `<li class="empty">Черга порожня.</li>`; return; }
    $("queue").innerHTML = q.map(({ debt, left, cumulative }, i) => {
      const n = K.daysLeft(debt);
      return `
      <li class="${n < 0 ? "is-bad" : ""}">
        ${n < 0 ? SIGN.warn("q-sign") : `<span class="q-num">${i + 1}</span>`}
        <span class="q-main">
          <b>${esc(creditorName(debt))}</b> <span class="q-sum">${money(left)}</span>
          <small>${dueText(n)}, до ${dShort(debt.due)}</small>
        </span>
        <span class="q-cum" title="Разом із попередніми">${money(cumulative)}</span>
      </li>`;
    }).join("");
  }

  /* --- календар ---------------------------------------------------- */
  function renderCalendar() {
    const cells = K.calendar();
    let lastMonth = -1;
    $("calendar").innerHTML = cells.map((c) => {
      const m = c.date.getMonth();
      const label = m !== lastMonth
        ? c.date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }).replace(".", "")
        : c.date.getDate();
      lastMonth = m;
      const title = c.items.length
        ? c.items.map((d) => creditorName(d) + " — " + money(K.left(d))).join(", ")
        : "";
      const cls = ["cal-cell", c.past && "past", c.today && "today", c.sum && "due"].filter(Boolean).join(" ");
      return `
        <div class="${cls}" ${title ? `title="${esc(title)}"` : ""}>
          <span class="cal-d">${label}</span>
          ${c.sum ? `<span class="cal-sum">${short(c.sum)}</span>` : ""}
        </div>`;
    }).join("");
  }

  /* --- реєстр -------------------------------------------------------- */
  let tab = "open";

  $("ledgerTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll("#ledgerTabs [data-tab]").forEach((x) =>
      x.setAttribute("aria-selected", String(x.dataset.tab === tab)));
    renderLedger();
  });

  function renderLedger() {
    const box = $("ledger");
    if (busy(box)) return;

    let list;
    if (tab === "open") {
      list = K.open().sort((a, b) => K.day(a.due) - K.day(b.due));
    } else if (tab === "closed") {
      list = K.closed().sort((a, b) => (K.closedAt(b) || 0) - (K.closedAt(a) || 0));
    } else {
      list = S.state.debts.filter((d) => d.status !== "approved").sort((a, b) => b.ts - a.ts);
    }

    // лічильники на вкладках
    const counts = { open: K.open().length, closed: K.closed().length, other: S.state.debts.filter((d) => d.status !== "approved").length };
    document.querySelectorAll("#ledgerTabs [data-tab]").forEach((x) => {
      x.dataset.count = counts[x.dataset.tab] || "";
    });

    if (!list.length) {
      box.innerHTML = `<p class="empty">${tab === "open" ? "Відкритих боргів немає." : tab === "closed" ? "Ще нічого не закрито." : "Заявок немає."}</p>`;
      return;
    }
    box.innerHTML = list.map(debtCard).join("");
  }

  function debtCard(d) {
    const paid = K.paid(d), left = K.left(d);
    const pct = Math.min(100, Math.round((paid / d.amount) * 100));
    const n = K.daysLeft(d);
    let badge, cls = "";
    if (d.status === "pending") { badge = `<span class="badge b-wait">на розгляді</span>`; cls = "is-pending"; }
    else if (d.status === "rejected") { badge = `<span class="badge b-mute">відхилено</span>`; cls = "is-rejected"; }
    else if (K.isClosed(d)) { badge = `<span class="badge b-ok">закрито</span>`; cls = "is-closed"; }
    else if (n < 0) { badge = `<span class="badge b-bad">${SIGN.warn("b-sign")}прострочено ${days(-n)}</span>`; cls = "is-overdue"; }
    else { badge = `<span class="badge b-open">${dueText(n)}</span>`; }

    return `
    <article class="debt ${cls}">
      <header class="debt-head">
        <div>
          <p class="debt-who">${esc(creditorName(d))}</p>
          <p class="debt-why">${esc(d.reason)}</p>
        </div>
        <div class="debt-amt">
          <strong>${money(d.amount)}</strong>
          ${badge}
        </div>
      </header>
      ${d.status === "approved" ? `
        <div class="progress" role="img" aria-label="Повернуто ${pct}%" style="--p:${pct}%">
          <i></i><b class="progress-mark"></b>
        </div>
        <p class="debt-meta"><span>повернуто ${money(paid)}</span><span>${left ? "лишилось " + money(left) : "повністю"}</span></p>` : ""}
      <dl class="debt-dates">
        <div><dt>взяв</dt><dd>${dFull(d.ts)}</dd></div>
        <div><dt>до</dt><dd>${dFull(d.due)}</dd></div>
        ${isGuest() ? "" : `<div><dt>вніс</dt><dd>${esc(d.author)}</dd></div>`}
      </dl>
      ${(d.payments || []).length ? `
        <details class="payments"><summary>Платежі (${d.payments.length})</summary>
          <ul>${d.payments.map((p) => `<li><span>${dFull(p.ts)}</span><b>${money(p.amount)}</b></li>`).join("")}</ul>
        </details>` : ""}
      ${debtActions(d, left)}
    </article>`;
  }

  function debtActions(d, left) {
    const out = [];
    const mine = d.creditorUid && d.creditorUid === me().uid;

    if (d.status === "approved" && left > 0) {
      if (d.claim) {
        let side;
        if (mine) side = `
          <button class="btn btn-sm btn-ok" data-act="confirm" data-id="${esc(d.id)}">Отримав</button>
          <button class="btn btn-sm btn-ghost" data-act="deny" data-id="${esc(d.id)}">Не отримував</button>`;
        else if (isSubject()) side = `<button class="btn btn-sm btn-ghost" data-act="cancel" data-id="${esc(d.id)}">Скасувати заявку</button>`;
        else side = `<span class="muted">чекає підтвердження від ${esc(creditorName(d))}</span>`;
        out.push(`
          <div class="claim">
            <p>${esc(heroName())} каже, що віддав <b>${money(d.claim.amount)}</b> · ${dTime(d.claim.ts)}</p>
            <div class="claim-actions">${side}</div>
          </div>`);
      } else if (isSubject()) {
        out.push(`<div class="debt-actions"><button class="btn btn-sm btn-accent" data-act="claim" data-id="${esc(d.id)}">Віддав</button></div>`);
      }
    }

    if (isAdmin()) {
      const admin = [];
      if (d.status === "approved" && !d.creditorUid) {
        admin.push(`
          <label class="bind">Старий запис без прив'язки — підтвердити повернення неможливо.
            <select data-bind="${esc(d.id)}">
              <option value="">прив'язати до…</option>
              ${S.state.users.filter((u) => u.role !== "subject").map((u) =>
                `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}
            </select>
          </label>`);
      }
      admin.push(`<button class="link-btn danger" data-act="delete" data-id="${esc(d.id)}">видалити запис</button>`);
      out.push(`<div class="debt-admin">${admin.join("")}</div>`);
    }
    return out.join("");
  }

  $("ledger").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case "claim": openClaim(id); break;
      case "cancel": act(S.cancelClaim(id), "Заявку скасовано"); break;
      case "confirm": act(S.confirm(id), "Платіж зараховано"); break;
      case "deny": act(S.deny(id), "Заявку відхилено"); break;
      case "delete":
        if (confirm("Видалити запис назавжди?")) act(S.removeDebt(id), "Запис видалено");
        break;
    }
  });

  $("ledger").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-bind]");
    if (sel && sel.value) act(S.bindCreditor(sel.dataset.bind, sel.value), "Прив'язано");
  });

  /* --- діалог «Віддав» ------------------------------------------ */
  let claimId = null;

  function openClaim(id) {
    const d = S.state.debts.find((x) => x.id === id);
    if (!d) return;
    const left = K.left(d);
    claimId = id;
    $("claimInfo").textContent = `${d.creditor}: лишилось ${money(left)}. Сума зарахується, коли ${d.creditor} підтвердить.`;
    $("claimAmount").max = left;
    $("claimAmount").value = left;
    const opts = [...new Set([left, Math.round(left / 2), 500, 1000].filter((v) => v >= 1 && v <= left))];
    $("claimChips").innerHTML = opts.map((v) =>
      `<button type="button" class="chip" data-v="${v}">${v === left ? "усе · " : ""}${money(v)}</button>`).join("");
    $("claimDialog").showModal();
    $("claimAmount").select();
  }

  $("claimChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-v]");
    if (c) $("claimAmount").value = c.dataset.v;
  });
  $("claimCancel").addEventListener("click", () => $("claimDialog").close());
  $("claimForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number($("claimAmount").value);
    $("claimDialog").close();
    if (claimId) act(S.claim(claimId, v), "Заявку надіслано кредитору");
  });

  /* --- форма нового боргу ----------------------------------------
     Кожен сам за себе: борг записується лише на того, хто подає
     заявку, і повертати його будуть тільки йому. Вибору «кому» немає
     ні в кого, навіть в адміна. Герой сайту боргів собі не вносить. */
  function renderForm() {
    $("formBlock").hidden = isSubject() || isGuest();
    $("fNote").textContent = "Борг записується на тебе, " + me().name + ": повертати його будуть тільки тобі.";
  }

  $("debtForm").addEventListener("input", () => { $("fError").hidden = true; $("fOk").hidden = true; });

  $("debtForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    $("fError").hidden = true;
    $("fOk").hidden = true;
    try {
      await S.addDebt({
        amount: $("fAmount").value,
        reason: $("fReason").value,
        due: $("fDue").value
      });
      $("fAmount").value = "";
      $("fReason").value = "";
      $("fOk").hidden = false;
    } catch (err) {
      $("fError").textContent = err.code === "permission-denied"
        ? "База відхилила запис. Перевір суму, опис і дату."
        : humanError(err);
      $("fError").hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* --- на розгляді (адмін) ------------------------------------------- */
  function renderPending() {
    const list = K.pending();
    $("pendingCount").textContent = list.length || "";
    $("pending").innerHTML = list.length ? list.map((d) => `
      <div class="pend">
        <div class="pend-main">
          <strong>${money(d.amount)}</strong>
          <span>${esc(d.reason)}</span>
          <small>для ${esc(d.creditor)} · до ${dFull(d.due)} · вніс ${esc(d.author)} · ${dTime(d.ts)}</small>
        </div>
        <div class="pend-actions">
          <button class="btn btn-sm btn-ok" data-pend="approve" data-id="${esc(d.id)}">Підтвердити</button>
          <button class="btn btn-sm btn-ghost" data-pend="reject" data-id="${esc(d.id)}">Відхилити</button>
        </div>
      </div>`).join("") : `<p class="empty">Черга порожня.</p>`;
  }

  $("pending").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pend]");
    if (!b) return;
    if (b.dataset.pend === "approve") act(S.approve(b.dataset.id), "Борг підтверджено");
    else act(S.reject(b.dataset.id), "Заявку відхилено");
  });

  /* --- люди (адмін) ---------------------------------------------------
     Власник (CONFIG.ownerLogin) — головний адмін: його роль і доступ
     не змінює ніхто, навіть він сам. Роль адміна видає й знімає лише
     власник; звичайний адмін не чіпає адмінів і самого себе. Те саме
     перевіряють правила бази — тут лише не показуємо зайвих кнопок. */
  function renderPeople() {
    const box = $("people");
    if (busy(box)) return;
    const iOwn = !!me().owner;
    const list = [...S.state.users].sort((a, b) =>
      (S.isOwnerLogin(b.login) - S.isOwnerLogin(a.login)) || (a.name || "").localeCompare(b.name || "", "uk"));
    box.innerHTML = list.length ? list.map((u) => {
      const self = u.id === me().uid;
      const owner = S.isOwnerLogin(u.login);
      const locked = owner || (!iOwn && (self || u.role === "admin"));
      const why = owner ? "Власника не можна понизити чи вимкнути"
        : locked ? "Роль адміна видає й знімає лише власник" : "Доступ";
      // пункт «адмін» у списку бачить лише власник (або якщо людина вже адмін)
      const roles = Object.entries(ROLE).filter(([v]) => v !== "admin" || iOwn || u.role === "admin");
      return `
      <div class="person ${u.active === false && !owner ? "is-off" : ""}">
        <span class="avatar">${esc((u.name || "?")[0].toUpperCase())}</span>
        <div class="person-name">
          <input value="${esc(u.name || "")}" maxlength="${C.limits.nameMax}" data-name="${esc(u.id)}" aria-label="Ім'я">
          <small>${esc(u.login || "")}${owner ? " · власник" : ""}${self ? " · це ти" : ""}</small>
        </div>
        <select data-role="${esc(u.id)}" ${locked ? "disabled" : ""} aria-label="Роль" title="${why}">
          ${roles.map(([v, l]) => `<option value="${v}" ${(owner ? "admin" : u.role) === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <label class="switch" title="${why}">
          <input type="checkbox" data-active="${esc(u.id)}" ${owner || u.active !== false ? "checked" : ""} ${locked ? "disabled" : ""}>
          <span>активний</span>
        </label>
      </div>`;
    }).join("") : `<p class="empty">Поки ніхто не заходив.</p>`;
  }

  $("people").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.name) {
      const name = t.value.trim();
      if (!name) { t.blur(); renderPeople(); return; }
      act(S.updateUser(t.dataset.name, { name }), "Ім'я збережено");
    }
    if (t.dataset.role) act(S.updateUser(t.dataset.role, { role: t.value }), "Роль змінено");
    if (t.dataset.active) act(S.updateUser(t.dataset.active, { active: t.checked }), t.checked ? "Доступ увімкнено" : "Доступ вимкнено");
  });

  /* --- ачівки: кожна — свій знак ----------------------------------- */
  const ACH_SIGN = {
    clean: () => SIGN.end("ach-sign"),
    early: () => SIGN.info("⚡", "ach-sign"),
    quiet: () => SIGN.info("☾", "ach-sign"),
    record: () => SIGN.warn("ach-sign"),
    repeat: () => SIGN.diamond("ach-sign")
  };
  function renderAchievements() {
    const auto = K.achievements().map((a) => `
      <div class="ach ${a.earned ? "on" : ""}">
        ${(ACH_SIGN[a.id] || ACH_SIGN.early)()}
        <b>${esc(a.title)}</b>
        <small>${a.earned && a.amount ? "найбільший борг — " + money(a.amount) : esc(a.hint)}</small>
        <span class="ach-state">${a.earned ? "здобуто" : "ще ні"}</span>
      </div>`);
    // Власні ачівки: видає й забирає адмін
    const custom = [...S.state.badges].sort((a, b) => (a.title || "").localeCompare(b.title || "", "uk")).map((b) => `
      <div class="ach ach-custom ${b.earned ? "on" : ""}">
        <span class="ach-emoji" aria-hidden="true">${esc(b.icon || "🏆")}</span>
        <b>${esc(b.title)}</b>
        ${b.desc ? `<small>${esc(b.desc)}</small>` : ""}
        <span class="ach-state">${b.earned ? "здобуто" : "ще ні"}, від адміна</span>
        ${isAdmin() ? `<button class="link-btn" type="button" data-badge="${esc(b.id)}">Змінити</button>` : ""}
      </div>`);
    $("achievements").innerHTML = auto.concat(custom).join("");
  }

  let badgeId = null;
  function openBadge(id) {
    const b = id ? S.state.badges.find((x) => x.id === id) : null;
    badgeId = b ? b.id : null;
    $("bHead").textContent = b ? "Змінити ачівку" : "Нова ачівка";
    $("bTitle").value = b ? b.title : "";
    $("bDesc").value = b ? b.desc || "" : "";
    $("bIcon").value = b ? b.icon || "" : "";
    $("bEarned").checked = b ? !!b.earned : false;
    $("bDelete").hidden = !b;
    formError("bError", null);
    $("badgeDialog").showModal();
  }
  $("addBadge").addEventListener("click", () => openBadge(null));
  $("achievements").addEventListener("click", (e) => {
    const b = e.target.closest("[data-badge]");
    if (b) openBadge(b.dataset.badge);
  });
  $("badgeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await S.saveBadge(badgeId, { title: $("bTitle").value, desc: $("bDesc").value, icon: $("bIcon").value, earned: $("bEarned").checked });
      $("badgeDialog").close();
      toast("Ачівку збережено");
    } catch (err) { formError("bError", err); }
  });
  $("bDelete").addEventListener("click", () => {
    if (badgeId && confirm("Видалити ачівку?")) {
      act(S.removeBadge(badgeId), "Ачівку видалено");
      $("badgeDialog").close();
    }
  });

  /* --- відгуки ------------------------------------------------------
     Як у Google Maps: зірки й текст — одне ціле. Угорі середній бал і
     розподіл (натискання на рядок фільтрує), далі «мій відгук» або
     запрошення оцінити, далі стрічка. Народна оцінка — це думка людей;
     індекс надійності — факт із даних. */
  const STAR_WORD = ["", "Жахливо", "Погано", "Нормально", "Добре", "Чудово"];
  let rvSort = "new";      // new | high | low
  let rvFilter = 0;        // 0 — усі, 1–5 — лише з такою оцінкою
  let rvEditing = false;   // відкрита форма
  let rvDraft = 0;         // обрані у формі зірки

  const starsLine = (v, cls) =>
    `<span class="stars-view ${cls || ""}" aria-label="${v} з 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? "on" : ""}">★</i>`).join("")}</span>`;

  function ago(ts) {
    const n = K.daysBetween(ts, K.today());
    if (n <= 0) return "сьогодні";
    if (n === 1) return "вчора";
    if (n < 7) return n + " " + plural(n, "день", "дні", "днів") + " тому";
    if (n < 30) { const w = Math.round(n / 7); return w + " " + plural(w, "тиждень", "тижні", "тижнів") + " тому"; }
    if (n < 365) { const m = Math.round(n / 30); return m + " " + plural(m, "місяць", "місяці", "місяців") + " тому"; }
    const y = Math.round(n / 365);
    return y + " " + plural(y, "рік", "роки", "років") + " тому";
  }

  function reviewCard(r, own) {
    return `
      <article class="rv ${own ? "rv-own" : ""}">
        <header class="rv-head">
          <span class="avatar">${esc((r.user || "?")[0].toUpperCase())}</span>
          <div class="rv-meta">
            <b>${esc(mask("rv:" + r.id, r.user, "Учасник"))}${own ? ' <small class="rv-you">твій відгук</small>' : ""}</b>
            <span>${starsLine(r.value, "sm")}<time title="${esc(dTime(r.ts))}">${ago(r.ts)}</time></span>
          </div>
          ${own ? `
            <div class="rv-actions">
              <button class="link-btn" type="button" data-rv="edit">Змінити</button>
              <button class="link-btn danger" type="button" data-rv="delete">Видалити</button>
            </div>`
          : isAdmin() ? `<button class="link-btn danger" type="button" data-rv="remove" data-id="${esc(r.id)}">видалити</button>` : ""}
        </header>
        ${r.text ? `<p class="rv-text">${esc(r.text)}</p>` : ""}
        ${repliesBlock(r)}
      </article>`;
  }

  // Відповіді під відгуком — коротка гілка, від старих до нових
  function repliesBlock(r) {
    const list = S.state.replies.filter((x) => x.reviewId === r.id).sort((a, b) => a.ts - b.ts);
    if (!list.length && isGuest()) return "";
    return `
      <div class="rv-replies">
        ${list.map((x) => `
          <div class="reply">
            <div class="reply-head">
              <b>${esc(mask("rv:" + x.uid, x.user, "Учасник"))}</b>
              <time title="${esc(dTime(x.ts))}">${ago(x.ts)}</time>
              ${x.uid === me().uid || isAdmin() ? `<button class="link-btn danger" type="button" data-reply-del="${esc(x.id)}">видалити</button>` : ""}
            </div>
            <p>${esc(x.text)}</p>
          </div>`).join("")}
        ${isGuest() ? "" : `<button class="link-btn" type="button" data-reply="${esc(r.id)}">Відповісти</button>`}
      </div>`;
  }

  let replyTo = null;
  $("reviewsBlock").addEventListener("click", (e) => {
    const open = e.target.closest("[data-reply]");
    if (open) {
      replyTo = open.dataset.reply;
      const r = S.state.ratings.find((x) => x.id === replyTo);
      $("rpInfo").textContent = r ? "Відповідь на відгук: " + mask("rv:" + r.id, r.user, "Учасник") : "";
      $("rpText").value = "";
      formError("rpError", null);
      $("replyDialog").showModal();
      return;
    }
    const del = e.target.closest("[data-reply-del]");
    if (del && confirm("Видалити відповідь?")) act(S.removeReply(del.dataset.replyDel), "Відповідь видалено");
  });
  $("replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await S.addReply(replyTo, $("rpText").value);
      $("replyDialog").close();
      toast("Відповідь надіслано");
    } catch (err) { formError("rpError", err); }
  });

  function renderReviews() {
    const r = K.rating();
    const all = S.state.ratings;
    const mine = all.find((x) => x.id === me().uid);
    const max = Math.max(1, ...Object.values(r.hist));

    // підсумок
    $("rvSummary").innerHTML = `
      <div class="rv-score">
        <strong>${r.count ? r.avg.toFixed(1).replace(".", ",") : "—"}</strong>
        ${starsLine(Math.round(r.avg))}
        <small>${r.count ? r.count + " " + plural(r.count, "відгук", "відгуки", "відгуків") : "відгуків ще немає"}</small>
      </div>
      <div class="rv-hist" role="group" aria-label="Фільтр за оцінкою">
        ${[5, 4, 3, 2, 1].map((v) => `
          <button type="button" class="hist-row ${rvFilter === v ? "on" : ""}" data-filter="${v}"
                  aria-pressed="${rvFilter === v}" ${r.hist[v] ? "" : "disabled"} title="Показати лише ${v}★">
            <span>${v}</span><div class="bar"><i style="width:${(r.hist[v] / max) * 100}%"></i></div><b>${r.hist[v]}</b>
          </button>`).join("")}
      </div>`;

    // мій відгук / запрошення / форма
    $("rvForm").hidden = !rvEditing;
    if (rvEditing) {
      $("rvMine").innerHTML = "";
    } else if (mine) {
      $("rvMine").innerHTML = reviewCard(mine, true);
    } else if (isGuest()) {
      $("rvMine").innerHTML = `<p class="hint">Режим гостя: відгуки можна читати, але не писати.</p>`;
    } else if (isSubject()) {
      // як власник закладу в Google Maps: сам себе не оцінює
      $("rvMine").innerHTML = `<p class="hint">Це відгуки про тебе. Оцінювати себе не можна — лише читати.</p>`;
    } else {
      const hero = subject() ? subject().name.split(" ")[0] : "герой сайту";
      $("rvMine").innerHTML = `
        <div class="rv-invite">
          <span class="avatar">${esc((me().name || "?")[0].toUpperCase())}</span>
          <div>
            <b>Як тобі ${esc(hero)}?</b>
            <div class="stars-pick" role="group" aria-label="Почати відгук">
              ${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-start="${v}" aria-label="${v} з 5">★</button>`).join("")}
            </div>
          </div>
        </div>`;
    }

    // сортування
    const others = all.filter((x) => x.id !== me().uid && (!rvFilter || x.value === rvFilter));
    const sorters = {
      new: (a, b) => b.ts - a.ts,
      high: (a, b) => b.value - a.value || b.ts - a.ts,
      low: (a, b) => a.value - b.value || b.ts - a.ts
    };
    others.sort(sorters[rvSort]);

    $("rvToolbar").innerHTML = all.length > 1 || rvFilter ? `
      <div class="chips" role="group" aria-label="Сортування">
        ${[["new", "Найновіші"], ["high", "Найвищі"], ["low", "Найнижчі"]].map(([k, l]) =>
          `<button type="button" class="chip ${rvSort === k ? "on" : ""}" data-sort="${k}" aria-pressed="${rvSort === k}">${l}</button>`).join("")}
        ${rvFilter ? `<button type="button" class="chip chip-filter" data-filter="0">${rvFilter}★ ✕</button>` : ""}
      </div>` : "";

    $("rvList").innerHTML = others.length
      ? others.map((x) => reviewCard(x, false)).join("")
      : (rvFilter ? `<p class="empty">Відгуків на ${rvFilter}★ немає.</p>`
        : mine ? "" : `<p class="empty">Ще ніхто не писав. Будь першим.</p>`);
  }

  function paintDraft() {
    document.querySelectorAll("#rvStars [data-draft]").forEach((b) => {
      const v = Number(b.dataset.draft);
      b.classList.toggle("on", v <= rvDraft);
      b.setAttribute("aria-checked", String(v === rvDraft));
    });
    $("rvStarLabel").textContent = rvDraft ? STAR_WORD[rvDraft] : "Торкнись зірки";
    $("rvSubmit").disabled = !rvDraft;
  }

  function updateReviewCount() {
    const n = $("rvText").value.length;
    $("rvCount").textContent = n ? n + " / " + C.limits.reviewMax : "";
  }

  function openReviewForm(stars) {
    const mine = S.state.ratings.find((x) => x.id === me().uid);
    rvEditing = true;
    rvDraft = stars || (mine ? mine.value : 0);
    $("rvText").value = mine ? mine.text || "" : "";
    $("rvAvatar").textContent = (me().name || "?")[0].toUpperCase();
    $("rvName").textContent = me().name;
    $("rvSubmit").textContent = mine ? "Зберегти" : "Опублікувати";
    $("rvError").hidden = true;
    paintDraft();
    updateReviewCount();
    renderReviews();
    $("rvText").focus();
  }

  function closeReviewForm() {
    rvEditing = false;
    renderReviews();
  }

  $("reviewsBlock").addEventListener("click", (e) => {
    const start = e.target.closest("[data-start]");
    if (start) return openReviewForm(Number(start.dataset.start));

    const draft = e.target.closest("[data-draft]");
    if (draft) { rvDraft = Number(draft.dataset.draft); $("rvError").hidden = true; return paintDraft(); }

    const f = e.target.closest("[data-filter]");
    if (f) { const v = Number(f.dataset.filter); rvFilter = rvFilter === v ? 0 : v; return renderReviews(); }

    const so = e.target.closest("[data-sort]");
    if (so) { rvSort = so.dataset.sort; return renderReviews(); }

    const a = e.target.closest("[data-rv]");
    if (!a) return;
    if (a.dataset.rv === "edit") openReviewForm();
    if (a.dataset.rv === "delete" && confirm("Видалити свій відгук?")) act(S.removeReview(me().uid), "Відгук видалено");
    if (a.dataset.rv === "remove" && confirm("Видалити чужий відгук?")) act(S.removeReview(a.dataset.id), "Відгук видалено");
  });

  $("rvCancel").addEventListener("click", closeReviewForm);
  $("rvText").addEventListener("input", () => { updateReviewCount(); $("rvError").hidden = true; });

  $("rvForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!rvDraft) { $("rvError").textContent = "Спершу постав зірки."; $("rvError").hidden = false; return; }
    $("rvSubmit").disabled = true;
    try {
      await S.saveReview({ value: rvDraft, text: $("rvText").value });
      rvEditing = false;
      toast("Відгук опубліковано");
      renderReviews();
    } catch (err) {
      $("rvError").textContent = humanError(err);
      $("rvError").hidden = false;
    } finally {
      $("rvSubmit").disabled = !rvDraft;
    }
  });
  /* --- меню розділів ----------------------------------------------
     Посилання ведуть до розділу, в якому лежить елемент з id. Поточний
     розділ підсвічується: спостерігач стежить, який розділ зараз
     посередині екрана. */
  const navLinks = [...document.querySelectorAll("#nav a")];
  const sectionOf = (a) => {
    const el = $(a.getAttribute("href").slice(1));
    return el && (el.closest("section, .hero") || el);
  };
  function setActive(sec) {
    navLinks.forEach((a) => {
      const on = sectionOf(a) === sec;
      a.classList.toggle("on", on);
      if (on) {
        a.setAttribute("aria-current", "true");
        // на телефоні меню гортається вбік — тримаємо поточний пункт на виду
        const strip = a.parentElement;
        strip.scrollTo({ left: a.offsetLeft - 16, behavior: reduceMotion() ? "auto" : "smooth" });
      } else a.removeAttribute("aria-current");
    });
  }
  navLinks.forEach((a) => a.addEventListener("click", (e) => {
    const sec = sectionOf(a);
    if (!sec) return;
    e.preventDefault();
    sec.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    setActive(sec);
  }));
  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) setActive(en.target); });
    }, { rootMargin: "-35% 0px -60% 0px" });
    navLinks.forEach((a) => { const s = sectionOf(a); if (s) spy.observe(s); });
  }

  /* --- поява розділів під час прокрутки ---------------------------
     Розділ проявляється, трикутник у заголовку розвертається, смуги
     «Кому скільки» ростуть. Якщо в системі вимкнено рух — усе одразу. */
  const revealEls = document.querySelectorAll(".page > .hero, .page > section, .page > .row > section");
  if (reduceMotion() || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  }

  /* --- нова версія сайту --------------------------------------------
     Відкрита вкладка може жити днями й працювати зі старим кодом, який
     уже не збігається з правилами бази. Раз на 5 хвилин і щоразу, коли
     людина повертається на вкладку, дивимось, чи не вийшла нова версія. */
  const myVersion = (document.querySelector('script[src*="app.js"]').src.match(/[?&]v=(\d+)/) || [])[1];
  async function checkVersion() {
    if (!myVersion || !$("updateBar").hidden) return;
    try {
      const html = await fetch("index.html?check=" + Date.now(), { cache: "no-store" }).then((r) => r.text());
      const live = (html.match(/app\.js\?v=(\d+)/) || [])[1];
      if (live && live !== myVersion) $("updateBar").hidden = false;
    } catch (e) { /* немає мережі — перевіримо пізніше */ }
  }
  setInterval(checkVersion, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
  $("updateBtn").addEventListener("click", () => location.reload());
})();
