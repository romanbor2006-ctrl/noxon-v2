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

  const ROLE = { admin: "адмін", subject: "герой сайту", member: "кредитор" };
  const me = () => S.me;
  const isAdmin = () => me() && me().role === "admin";
  const isSubject = () => me() && me().role === "subject";

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
        ["dossier", "metrics", "hot", "about", "traits", "timeline", "creditors", "payday", "queue",
         "calendar", "ledger", "pending", "people", "achievements", "rating", "comments", "meChip", "fNote", "claimInfo"]
          .forEach((id) => { $(id).innerHTML = ""; });
        subjectKey = null;
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
          <p class="eyebrow">Досьє · № 001</p>
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
    if (s.birthday) facts.push(["Вік", K.age(s.birthday) + " · " + dFull(s.birthday)]);
    if (s.city) facts.push(["Місто", s.city]);
    if (s.job) facts.push(["Робота", s.job]);
    const tg = safeUrl(s.telegram), ig = safeUrl(s.instagram);

    $("dossier").innerHTML = `
      <div class="hero-photo" id="heroPhoto"><span>${esc((s.name || "?")[0])}</span></div>
      <div class="hero-body">
        <p class="eyebrow">Досьє · № 001</p>
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

  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 520 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, out = c.toDataURL("image/jpeg", q);
        while (out.length > S.limitsSubject.photoMax * 0.9 && q > 0.35) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        if (out.length <= S.limitsSubject.photoMax) resolve(out);
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
    $("commentText").maxLength = C.limits.commentMax;
    // дата за замовчуванням — через два тижні
    const d = K.today(); d.setDate(d.getDate() + 14);
    $("fDue").value = K.iso(d);
    $("fDue").min = K.iso(K.today());
    updateCommentCount();
  }

  /* ============================================================
     ДИНАМІКА — на кожну зміну даних
     ============================================================ */
  function renderAll() {
    if (!me()) return;
    $("meChip").innerHTML = `<b>${esc(me().name)}</b><span>${ROLE[me().role] || esc(me().role)}</span>`;
    $("pendingBlock").hidden = !isAdmin();
    $("peopleBlock").hidden = !isAdmin();

    renderSubject();
    renderMetrics();
    renderCreditors();
    renderPayday();
    renderQueue();
    renderCalendar();
    renderLedger();
    renderForm();
    if (isAdmin()) { renderPending(); renderPeople(); }
    renderAchievements();
    renderRating();
    renderComments();
  }

  /* --- метрики + «що горить» ------------------------------------ */
  function renderMetrics() {
    const t = K.totals();
    const r = K.reliability();
    const rt = K.rating();

    $("metrics").innerHTML = `
      <div class="metric metric-main">
        <span class="m-label">Загальний борг</span>
        <strong class="m-value">${money(t.total)}</strong>
        <span class="m-sub">${t.count ? t.count + " " + plural(t.count, "відкритий борг", "відкриті борги", "відкритих боргів") : "боргів немає"}</span>
      </div>
      <div class="metric ${t.overdueCount ? "metric-bad" : ""}">
        <span class="m-label">Прострочено</span>
        <strong class="m-value">${money(t.overdue)}</strong>
        <span class="m-sub">${t.overdueCount ? t.overdueCount + " " + plural(t.overdueCount, "борг", "борги", "боргів") : "усе в строк"}</span>
      </div>
      <div class="metric">
        <span class="m-label">Індекс надійності</span>
        <strong class="m-value">${r.percent === null ? "—" : r.percent + "%"}</strong>
        <span class="m-sub">${r.percent === null ? "ще нічого не закрито" : `вчасно ${r.onTime} · пізно ${r.late} · висить ${r.overdue}`}</span>
      </div>
      <div class="metric">
        <span class="m-label">Народна оцінка</span>
        <strong class="m-value">${rt.count ? rt.avg.toFixed(1).replace(".", ",") + "<small>/5</small>" : "—"}</strong>
        <span class="m-sub">${rt.count ? rt.count + " " + plural(rt.count, "голос", "голоси", "голосів") : "ще ніхто не оцінив"}</span>
      </div>`;

    // Критерій успіху: за п'ять секунд видно, що горить
    const q = K.queue();
    if (!q.length) {
      $("hot").innerHTML = `<span class="hot-ok">Нічого не горить — усі борги закриті.</span>`;
      return;
    }
    const first = q[0].debt, n = K.daysLeft(first);
    $("hot").innerHTML = `
      <span class="hot-label ${n < 0 ? "is-bad" : ""}">${n < 0 ? "Горить" : "Найближче"}</span>
      <span><b>${esc(first.creditor)}</b> — ${money(q[0].left)}, ${dueText(n)}${n >= 0 ? " (" + dShort(first.due) + ")" : ""}</span>`;
  }

  /* --- кому скільки ---------------------------------------------- */
  function renderCreditors() {
    const list = K.byCreditor();
    if (!list.length) { $("creditors").innerHTML = `<p class="empty">Нікому нічого. Рідкісний кадр.</p>`; return; }
    const max = Math.max(...list.map((c) => c.sum));
    $("creditors").innerHTML = list.map((c) => `
      <div class="bar-row">
        <div class="bar-top"><span>${esc(c.name)}</span><b>${money(c.sum)}</b></div>
        <div class="bar"><i style="width:${Math.max(3, (c.sum / max) * 100)}%"></i></div>
      </div>`).join("");
  }

  /* --- найближча виплата ----------------------------------------- */
  function renderPayday() {
    const p = K.payday();
    const when = p.days === 0 ? "сьогодні" : p.days === 1 ? "завтра" : "через " + days(p.days);
    $("payday").innerHTML = `
      <h2 class="h">Найближча зарплата</h2>
      <div class="payday-date">
        <strong>${dShort(p.date)}</strong>
        <span>${when}</span>
      </div>
      <div class="payday-need ${p.need ? "is-warn" : ""}">
        <span class="m-label">Треба зібрати до неї</span>
        <strong>${money(p.need)}</strong>
        <span class="m-sub">${p.need
          ? p.count + " " + plural(p.count, "борг", "борги", "боргів") + ": прострочене + усе з датою до зарплати"
          : "до цієї дати нічого не горить"}</span>
      </div>`;
  }

  /* --- черга ------------------------------------------------------ */
  function renderQueue() {
    const q = K.queue();
    if (!q.length) { $("queue").innerHTML = `<li class="empty">Черга порожня.</li>`; return; }
    $("queue").innerHTML = q.map(({ debt, left, cumulative }, i) => {
      const n = K.daysLeft(debt);
      return `
      <li class="${n < 0 ? "is-bad" : ""}">
        <span class="q-num">${i + 1}</span>
        <span class="q-main">
          <b>${esc(debt.creditor)}</b> · ${money(left)}
          <small>${dueText(n)} · ${dShort(debt.due)}</small>
        </span>
        <span class="q-cum">${money(cumulative)}</span>
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
        ? c.items.map((d) => d.creditor + " — " + money(K.left(d))).join(", ")
        : (c.payday ? "зарплата" : "");
      const cls = ["cal-cell", c.past && "past", c.today && "today", c.sum && "due", c.payday && "pay"].filter(Boolean).join(" ");
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
    else if (n < 0) { badge = `<span class="badge b-bad">прострочено ${days(-n)}</span>`; cls = "is-overdue"; }
    else { badge = `<span class="badge b-open">${dueText(n)}</span>`; }

    return `
    <article class="debt ${cls}">
      <header class="debt-head">
        <div>
          <p class="debt-who">${esc(d.creditor)}</p>
          <p class="debt-why">${esc(d.reason)}</p>
        </div>
        <div class="debt-amt">
          <strong>${money(d.amount)}</strong>
          ${badge}
        </div>
      </header>
      ${d.status === "approved" ? `
        <div class="progress" role="img" aria-label="Повернуто ${pct}%"><i style="width:${pct}%"></i></div>
        <p class="debt-meta"><span>повернуто ${money(paid)}</span><span>${left ? "лишилось " + money(left) : "✓ повністю"}</span></p>` : ""}
      <p class="debt-dates">взяв ${dFull(d.ts)} · до ${dFull(d.due)} · вніс ${esc(d.author)}</p>
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
        else side = `<span class="muted">чекає підтвердження від ${esc(d.creditor)}</span>`;
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
    $("formBlock").hidden = isSubject();
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
     Собі роль і доступ адмін не міняє: знизивши себе, повернути
     адміна можна буде лише руками в консолі Firebase. */
  function renderPeople() {
    const box = $("people");
    if (busy(box)) return;
    const list = [...S.state.users].sort((a, b) => (a.name || "").localeCompare(b.name || "", "uk"));
    box.innerHTML = list.length ? list.map((u) => {
      const self = u.id === me().uid;
      return `
      <div class="person ${u.active === false ? "is-off" : ""}">
        <span class="avatar">${esc((u.name || "?")[0].toUpperCase())}</span>
        <div class="person-name">
          <input value="${esc(u.name || "")}" maxlength="${C.limits.nameMax}" data-name="${esc(u.id)}" aria-label="Ім'я">
          <small>${esc(u.login || "")}${self ? " · це ти" : ""}</small>
        </div>
        <select data-role="${esc(u.id)}" ${self ? "disabled" : ""} aria-label="Роль">
          ${Object.entries(ROLE).map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <label class="switch" title="${self ? "Себе вимкнути не можна" : "Доступ"}">
          <input type="checkbox" data-active="${esc(u.id)}" ${u.active !== false ? "checked" : ""} ${self ? "disabled" : ""}>
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

  /* --- ачівки ------------------------------------------------------ */
  function renderAchievements() {
    $("achievements").innerHTML = K.achievements().map((a) => `
      <div class="ach ${a.earned ? "on" : ""}">
        <span class="ach-icon" aria-hidden="true">${a.icon}</span>
        <b>${esc(a.title)}</b>
        <small>${a.earned && a.amount ? "найбільший борг — " + money(a.amount) : esc(a.hint)}</small>
        <span class="ach-state">${a.earned ? "здобуто" : "ще ні"}</span>
      </div>`).join("");
  }

  /* --- народна оцінка -----------------------------------------------
     Думка людей. Індекс надійності — факт із даних. */
  function renderRating() {
    const r = K.rating();
    const max = Math.max(1, ...Object.values(r.hist));
    $("rating").innerHTML = `
      <div class="rate-score">
        <strong>${r.count ? r.avg.toFixed(1).replace(".", ",") : "—"}</strong>
        <span class="stars-view" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= Math.round(r.avg) ? "on" : ""}">★</i>`).join("")}</span>
        <small>${r.count ? r.count + " " + plural(r.count, "голос", "голоси", "голосів") : "голосів ще немає"}</small>
      </div>
      <div class="rate-hist">
        ${[5, 4, 3, 2, 1].map((v) => `
          <div class="hist-row"><span>${v}</span><div class="bar"><i style="width:${(r.hist[v] / max) * 100}%"></i></div><b>${r.hist[v]}</b></div>`).join("")}
      </div>
      <div class="rate-mine">
        <p class="m-label">${r.mine ? "Твоя оцінка — можна змінити" : "Твоя оцінка"}</p>
        <div class="stars-pick" role="radiogroup" aria-label="Оцінка від 1 до 5">
          ${[1, 2, 3, 4, 5].map((v) => `<button type="button" role="radio" aria-checked="${v === r.mine}" aria-label="${v} з 5" data-star="${v}" class="${v <= r.mine ? "on" : ""}">★</button>`).join("")}
        </div>
      </div>`;
  }

  $("rating").addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]");
    if (b) act(S.rate(Number(b.dataset.star)), "Оцінку збережено");
  });

  /* --- коментарі ---------------------------------------------------- */
  function renderComments() {
    const list = [...S.state.comments].sort((a, b) => b.ts - a.ts);
    $("comments").innerHTML = list.length ? list.map((c) => {
      const own = c.uid === me().uid;
      return `
      <article class="comment ${own ? "own" : ""}">
        <span class="avatar">${esc((c.user || "?")[0].toUpperCase())}</span>
        <div class="comment-body">
          <header><b>${esc(c.user)}</b><time>${dTime(c.ts)}</time>
            ${own || isAdmin() ? `<button class="link-btn" data-del="${esc(c.id)}">видалити</button>` : ""}</header>
          <p>${esc(c.text)}</p>
        </div>
      </article>`;
    }).join("") : `<p class="empty">Коментарів ще немає. Будь першим.</p>`;
  }

  function updateCommentCount() {
    const n = $("commentText").value.length;
    $("commentCount").textContent = n ? n + " / " + C.limits.commentMax : "";
  }
  $("commentText").addEventListener("input", () => { updateCommentCount(); $("commentError").hidden = true; });

  $("commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    $("commentError").hidden = true;
    try {
      await S.addComment($("commentText").value);
      $("commentText").value = "";
      updateCommentCount();
    } catch (err) {
      $("commentError").textContent = humanError(err);
      $("commentError").hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("comments").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (b && confirm("Видалити коментар?")) act(S.removeComment(b.dataset.del), "Коментар видалено");
  });
})();
