(() => {
  const API_KEY = "dec98ec9b59a5938a5ee3ae4eda1e090";
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p";
  const SESSION_KEY = "cineaura_session";
  const CODE_KEY = "cineaura_access_code";
  const LANG_KEY = "cineaura_lang";
  const THEME_KEY = "cineaura_theme";
  const LANGS = window.CineAuraLangs || ["en", "ar", "fr", "de", "es", "nl", "it"];
  const TMDB_LANG = { en: "en-US", ar: "ar-SA", fr: "fr-FR", de: "de-DE", es: "es-ES", nl: "nl-NL", it: "it-IT" };
  const LOCALE = { en: "en-US", ar: "ar", fr: "fr-FR", de: "de-DE", es: "es-ES", nl: "nl-NL", it: "it-IT" };
  const SUPABASE_URL = "https://mxdsgnlmfpaekgmswjou.supabase.co";
  const SUPABASE_KEY = "sb_publishable_FZmzR3yk_CR5j9jH191AVQ_NQivMZ-Q";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function isLoggedIn() {
    return Boolean(getSession());
  }

  function setSession(member, stay = true) {
    const payload = JSON.stringify({
      member_id: member.member_id,
      username: member.username,
      email: member.email,
      full_name: member.full_name,
      status: member.status || "active",
      stay: Boolean(stay),
    });
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (stay) localStorage.setItem(SESSION_KEY, payload);
    else sessionStorage.setItem(SESSION_KEY, payload);
    renderAuth();
  }

  function renderAuth() {
    const logged = isLoggedIn();
    document.body.classList.toggle("is-logged-in", logged);
    document.body.classList.toggle("is-guest", !logged);
    if (typeof wireSessionNav === "function") wireSessionNav();
  }

  function browserLang() {
    const list = navigator.languages || [navigator.language || "en"];
    for (const raw of list) {
      const code = String(raw || "").toLowerCase().split("-")[0];
      if (LANGS.includes(code)) return code;
    }
    return "en";
  }

  let activeLang = null;
  let activeTheme = null;
  // Ignore an older profile-preference request if a newer setting was applied
  // while that request was still in flight (for example, during dashboard boot).
  let prefsRevision = 0;

  function getLang() {
    if (LANGS.includes(activeLang)) return activeLang;
    const stored = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(stored)) return stored;
    return browserLang();
  }

  function getTheme() {
    if (activeTheme === "day" || activeTheme === "night") return activeTheme;
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "day" ? "day" : "night";
  }

  function getLocale() {
    return LOCALE[getLang()] || "en-US";
  }

  function t(key, vars) {
    const pack = window.CineAuraI18n || {};
    const lang = getLang();
    // 1) dotted interface key, 2) English text looked up in lang/<language>.js
    let s = pack[lang]?.[key] || langText(key) || pack.en?.[key] || key;
    if (vars && typeof s === "string") {
      Object.keys(vars).forEach((k) => {
        s = s.replaceAll(`{${k}}`, String(vars[k]));
      });
    }
    return s;
  }

  // Text that is not an interface key — a Supabase value ("Silver", "banned",
  // "premium", …) or any English string — translated through the language file.
  function langText(value) {
    const api = window.CineAuraLang;
    if (!api || typeof api.text !== "function") return "";
    const out = api.text(value);
    return out === value ? "" : out;
  }

  // Public helper: tr("Free") → "مجاني" in Arabic, "Gratis" in German, …
  function tr(value) {
    const api = window.CineAuraLang;
    return api && typeof api.text === "function" ? api.text(value) : String(value ?? "");
  }

  function ensureArabicFont() {
    if (getLang() !== "ar") return;
    if (document.getElementById("font-ar")) return;
    const link = document.createElement("link");
    link.id = "font-ar";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

  function translateDom(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const attr = el.getAttribute("data-i18n-attr");
      if (attr) el.setAttribute(attr, t(key));
      else el.textContent = t(key);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    const titleEl = root.querySelector?.("[data-i18n-title]") || document.querySelector("[data-i18n-title]");
    if (titleEl) document.title = t(titleEl.getAttribute("data-i18n-title"));
  }

  function applyPrefs({ language, theme, persist = true } = {}) {
    let changed = false;
    if (language && LANGS.includes(language)) {
      activeLang = language;
      if (persist) localStorage.setItem(LANG_KEY, language);
      changed = true;
    }
    if (theme === "day" || theme === "night") {
      activeTheme = theme;
      if (persist) localStorage.setItem(THEME_KEY, theme);
      changed = true;
    }
    if (changed) prefsRevision++;
    const lang = getLang();
    const mode = getTheme();
    const html = document.documentElement;
    html.dataset.theme = mode;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    document.body?.classList.toggle("is-rtl", lang === "ar");
    document.body?.classList.toggle("theme-day", mode === "day");
    ensureArabicFont();
    // lang/<language>.js drives every translation; it reloads on a language switch.
    window.CineAuraLang?.load?.(lang);
    translateDom(document);
    wireSessionNav();
    document.dispatchEvent(new CustomEvent("cineaura:prefs", { detail: { language: lang, theme: mode } }));
  }

  async function hydratePrefsFromProfile() {
    const s = getSession();
    if (!s?.member_id) return;
    const revisionAtStart = prefsRevision;
    try {
      const res = await supabaseRequest(
        `/rest/v1/profiles?member_id=eq.${restValue(s.member_id)}&select=language,theme`
      );
      // Don't let a delayed profile response undo a more recent selection made
      // on this page. Also guard against the account changing while it loads.
      if (revisionAtStart !== prefsRevision || getSession()?.member_id !== s.member_id) return;
      const p = res.data?.[0];
      if (!res.ok || !p) return;
      const language = LANGS.includes(p.language) ? p.language : null;
      const theme = p.theme === "day" || p.theme === "night" ? p.theme : null;
      // A language picked on this device wins; "en" is the default of a fresh profile,
      // so it is not treated as a choice and the browser language keeps applying.
      const manual = LANGS.includes(localStorage.getItem(LANG_KEY));
      const accountLang = language && !manual && language !== "en" ? language : null;
      if (theme) applyPrefs({ theme, persist: true });
      if (accountLang) applyPrefs({ language: accountLang, persist: false });
    } catch {
      /* keep local prefs */
    }
  }

  // ---------- Presence (online = signed in + recent heartbeat) ----------
  function touchPresence(offline) {
    const sess = getSession();
    if (!sess?.member_id) return Promise.resolve();
    return supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(sess.member_id)}`, {
      method: "PATCH",
      keepalive: true,
      body: JSON.stringify({ last_seen: offline ? null : new Date().toISOString() }),
    }).catch(() => {});
  }

  function startPresence() {
    if (startPresence._on) return;
    startPresence._on = true;
    touchPresence(false);
    setInterval(() => { if (!document.hidden) touchPresence(false); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) touchPresence(false); });
  }

  // ---------- Signed-out gate (pages marked with data-auth-gate) ----------
  // Profile and Dashboard need a session. Once a member signs out — or when a
  // signed-out visitor opens one of those pages — the page goes read-only:
  // every control is dimmed and pointer-blocked, a notice offers the sign-in
  // link, and a capture-phase guard swallows clicks, submits and Enter presses
  // that would otherwise reach a handler.
  function authGateEnabled() {
    return Boolean(document.body) && document.body.dataset.authGate !== undefined;
  }

  function gateAllows(target) {
    if (!target || typeof target.closest !== "function") return true;
    // Header + menu, the notice itself, and any page that draws its own gate.
    if (target.closest("#site-header, #mobile-menu, #auth-gate-note, .dash-gate, .auth-allow, #toast")) return true;
    // Plain links keep working: reading profiles and posts needs no account.
    // Buttons, inputs, forms and selects stay locked (see .auth-locked in CSS).
    const link = target.closest("a[href]");
    if (link) {
      const href = String(link.getAttribute("href") || "").trim();
      if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) return true;
    }
    return false;
  }

  let gateWired = false;
  let gateNoticeAt = 0;

  function gateNotice() {
    const now = Date.now();
    if (now - gateNoticeAt < 800) return;
    gateNoticeAt = now;
    toast(t("auth.gate.blocked"));
    const note = document.getElementById("auth-gate-note");
    if (!note) return;
    note.classList.remove("flash");
    void note.offsetWidth; // restart the highlight
    note.classList.add("flash");
    note.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setTimeout(() => note.classList.remove("flash"), 1400);
  }

  function wireAuthGate() {
    if (gateWired) return;
    gateWired = true;
    // Capture phase, so nothing inside the page ever sees the event. Every
    // mouse action, keystroke (typing, Enter, Space, arrows on a <select>) and
    // form control change is dropped while the page is locked.
    const block = (e) => {
      if (!document.body.classList.contains("auth-locked")) return;
      // A session that appeared since the lock (another tab, restored page)
      // wins: unlock and let this interaction through untouched.
      if (getSession()?.member_id) {
        hideAuthGate();
        return;
      }
      if (gateAllows(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      gateNotice();
    };
    for (const type of ["click", "submit", "keydown", "keypress", "keyup", "input", "change", "paste", "drop"]) {
      document.addEventListener(type, block, true);
    }
  }

  // data-auth-gate="note"   → lock the page and show the sign-in notice
  // data-auth-gate="silent" → lock the page; the page draws its own gate card
  function showAuthGate() {
    if (!authGateEnabled()) return false;
    wireAuthGate();
    document.body.classList.add("auth-locked");
    if (document.body.dataset.authGate === "silent") return true;
    if (document.getElementById("auth-gate-note")) return true;
    const main = document.querySelector("main");
    if (!main) return true;
    const note = document.createElement("section");
    note.className = "glass auth-gate-note";
    note.id = "auth-gate-note";
    note.innerHTML = `
      <div class="auth-gate-copy">
        <h2>${t("auth.gate.title")}</h2>
        <p>${t("auth.gate.text")}</p>
        <p class="muted">${t("auth.gate.readOnly")}</p>
      </div>
      <a class="btn btn-sm btn-primary auth-allow" href="./login.html">${t("common.signin")}</a>`;
    // Sits outside <main>: the page scripts redraw main's content at will.
    main.insertAdjacentElement("beforebegin", note);
    return true;
  }

  // Locks when there is no session, unlocks when there is one. Cheap enough to
  // run on every focus/pageshow/visibilitychange, which is what closes the
  // "signed out, then pressed Back" hole (bfcache restores a stale DOM without
  // re-running the page scripts).
  function syncAuthGate() {
    if (!authGateEnabled()) return false;
    if (getSession()?.member_id) return hideAuthGate();
    return showAuthGate();
  }

  // Another tab signing out locks this one too, then reloads into the guest view.
  function watchSessionLock() {
    if (watchSessionLock._on) return;
    watchSessionLock._on = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== SESSION_KEY || !authGateEnabled()) return;
      // Signed in elsewhere: the controls come back without a reload.
      if (getSession()?.member_id) {
        hideAuthGate();
        return;
      }
      showAuthGate();
      setTimeout(() => location.reload(), 350);
    });
    // Back/forward (bfcache), tab switch, window focus: re-check the session.
    window.addEventListener("pageshow", () => syncAuthGate());
    window.addEventListener("focus", () => syncAuthGate());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncAuthGate();
    });
  }

  // Called by the page-level write guards when a session-less write shows up.
  let writeBlockedAt = 0;
  function sessionWriteBlocked() {
    showAuthGate();
    const now = Date.now();
    if (now - writeBlockedAt < 1200) return;
    writeBlockedAt = now;
    toast(t("auth.gate.blocked"));
  }

  function hideAuthGate() {
    document.body.classList.remove("auth-locked");
    document.getElementById("auth-gate-note")?.remove();
  }

  function logout() {
    touchPresence(true);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    renderAuth();
    // Pages that need a session (Profile / Dashboard) go inert before the reload,
    // so nothing on them can be clicked, typed or submitted after signing out.
    showAuthGate();
    toast(t("home.signedOut"));
    setTimeout(() => location.reload(), 400);
  }

  function normalizeRecoveryCode(value) {
    return String(value || "").replace(/[\s\-]/g, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  }

  function restValue(value) {
    return encodeURIComponent(String(value || "").trim());
  }

  function downloadAccountTxt(info) {
    const created = info.created_at
      ? String(info.created_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const body = [
      "CineAura account details",
      "========================",
      `Member ID: ${info.member_id || ""}`,
      `Full name: ${info.full_name || ""}`,
      `Username: ${info.username || ""}`,
      `Email: ${info.email || ""}`,
      `Country: ${info.country || ""}`,
      `Gender: ${info.gender || ""}`,
      `Membership: ${info.membership_type || "Free"}`,
      `Membership duration: ${info.membership_duration || "1 month"}`,
      `Watch minutes: ${Number(info.watch_minutes || 0)}`,
      `Date of birth: ${info.birth_date || ""}`,
      `Account created: ${created}`,
      `Recovery code: ${info.recovery_code || ""}`,
      "",
      "Keep this recovery code private.",
      "Enter it on the Rest page to request a new password.",
    ].join("\r\n");
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CineAura-${info.member_id || "account"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function imgUrl(path, size = "w780") {
    if (!path) return "";
    return `${IMG}/${size}${path}`;
  }

  function formatRuntime(minutes) {
    if (!minutes && minutes !== 0) return "—";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function formatDate(value) {
    if (!value) return "TBA";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(getLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function ratingText(value) {
    return Number(value || 0).toFixed(1);
  }

  function ratingPercent(value) {
    return Math.round(Number(value || 0) * 10);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function watchHref(type, id, season, episode, postId) {
    const post = postId ? `&post=${encodeURIComponent(postId)}` : "";
    if (type === "tv") {
      const s = season ? `&season=${season}` : "";
      const e = episode ? `&episode=${episode}` : "";
      return `./watch.html?tv=${id}${s}${e}${post}`;
    }
    return `./watch.html?movie=${id}${post}`;
  }

  function personHref(id) {
    return `./Cast.html?person=${id}`;
  }

  // TMDB filmography of a person, cached in sessionStorage so the profile
  // updates feed and the Cast page share one request per person.
  async function personCredits(id) {
    const key = `cineaura_person_credits_v1:${id}`;
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) return JSON.parse(cached);
    } catch {
      /* ignore */
    }
    const out = { profile_path: "", works: [] };
    try {
      const data = await tmdb(`/person/${id}/combined_credits`);
      const rows = [...(data.cast || []), ...(data.crew || [])].filter(
        (c) => (c.media_type === "movie" || c.media_type === "tv") && c.id
      );
      out.profile_path = rows.find((c) => c.profile_path)?.profile_path || "";
      out.works = [...new Set(rows.map((c) => `${c.media_type}:${c.id}`))];
    } catch {
      /* offline: no filmography */
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(out));
    } catch {
      /* ignore quota */
    }
    return out;
  }

  function initialsAvatar(name) {
    const initials = String(name || "NA")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="#0d253f"/><text x="50%" y="54%" text-anchor="middle" fill="#90cea1" font-family="Outfit,sans-serif" font-size="24" font-weight="700">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function photo(path, name, size = "w185") {
    return imgUrl(path, size) || initialsAvatar(name);
  }

  // ---------- Avatars (shared cache so every page shows the real picture) ----------
  const avatarById = new Map();
  const avatarByName = new Map();

  function cacheAvatarRow(row) {
    if (!row) return;
    if (row.member_id) avatarById.set(String(row.member_id), row.avatar_url || "");
    if (row.username) avatarByName.set(String(row.username).replace(/^@/, "").toLowerCase(), row.avatar_url || "");
  }

  async function profilesByIds(ids, columns = ["member_id", "avatar_url"]) {
    const list = [...new Set((ids || []).map((x) => (x == null ? "" : String(x))).filter(Boolean))];
    if (!list.length) return [];
    const cols = (Array.isArray(columns) ? columns : String(columns).split(",")).map((c) => c.trim()).filter(Boolean);
    const filter = `member_id=in.(${list.map(restValue).join(",")})`;
    const pick = cols.slice();
    while (pick.length) {
      const res = await supabaseRequest(`/rest/v1/profiles?${filter}&select=${pick.join(",")}`);
      if (res.ok) return Array.isArray(res.data) ? res.data : [];
      pick.pop();
    }
    return [];
  }

  async function profilesByUsernames(names, columns = ["member_id", "username", "avatar_url"]) {
    const list = [...new Set((names || []).map((x) => String(x || "").replace(/^@/, "").trim()).filter(Boolean))];
    if (!list.length) return [];
    const cols = (Array.isArray(columns) ? columns : String(columns).split(",")).map((c) => c.trim()).filter(Boolean);
    const pick = cols.slice();
    while (pick.length) {
      const filter = `username=in.(${list.map(restValue).join(",")})`;
      let res = await supabaseRequest(`/rest/v1/profiles?${filter}&select=${pick.join(",")}`);
      if (!res.ok) {
        const or = list.map((n) => `username.ilike.${restValue(n)}`).join(",");
        res = await supabaseRequest(`/rest/v1/profiles?or=(${or})&select=${pick.join(",")}`);
      }
      if (res.ok) return Array.isArray(res.data) ? res.data : [];
      pick.pop();
    }
    return [];
  }

  async function primeAvatars(ids = [], usernames = []) {
    const wantIds = [...new Set((ids || []).filter(Boolean).map(String))].filter((id) => !avatarById.has(id));
    const wantNames = [...new Set((usernames || []).filter(Boolean).map((u) => String(u).replace(/^@/, "").toLowerCase()))].filter(
      (n) => !avatarByName.has(n)
    );
    if (!wantIds.length && !wantNames.length) return;
    try {
      const [byIds, byNames] = await Promise.all([
        wantIds.length ? profilesByIds(wantIds) : [],
        wantNames.length ? profilesByUsernames(wantNames) : [],
      ]);
      [...byIds, ...byNames].forEach(cacheAvatarRow);
    } catch {
      /* offline: keep initials */
    }
    wantIds.forEach((id) => { if (!avatarById.has(id)) avatarById.set(id, ""); });
    wantNames.forEach((n) => { if (!avatarByName.has(n)) avatarByName.set(n, ""); });
  }

  function avatarUrlFor(memberId, username) {
    const id = memberId ? String(memberId) : "";
    const name = username ? String(username).replace(/^@/, "").toLowerCase() : "";
    return (id && avatarById.get(id)) || (name && avatarByName.get(name)) || "";
  }

  function avatarSrc(memberId, username, fallback = "") {
    return avatarUrlFor(memberId, username) || initialsAvatar(fallback || username || memberId || "CA");
  }

  function avatarImg(memberId, username, fallback = "") {
    const src = avatarSrc(memberId, username, fallback);
    return `<img src="${escapeHtml(src)}" alt="" data-avatar-for="${escapeHtml(memberId || "")}" data-avatar-name="${escapeHtml(String(username || "").replace(/^@/, ""))}" />`;
  }

  // Re-paint every avatar of one member (used after a settings change).
  function refreshAvatar(memberId, url) {
    const id = memberId ? String(memberId) : "";
    if (id) avatarById.set(id, url || "");
    $$("[data-avatar-for]").forEach((n) => {
      if (!id || n.dataset.avatarFor !== id) return;
      if (url) {
        n.src = url;
        n.onerror = () => {
          n.onerror = null;
          n.src = initialsAvatar(n.dataset.avatarName || "CA");
        };
      } else {
        n.src = initialsAvatar(n.dataset.avatarName || "CA");
      }
    });
  }

  // Replaces initials with the stored avatar as soon as the profiles arrive.
  async function hydrateAvatars(root = document) {
    const nodes = [...root.querySelectorAll("[data-avatar-for], [data-avatar-name]")].filter(
      (n) => n.dataset.avatarFor || n.dataset.avatarName
    );
    if (!nodes.length) return;
    await primeAvatars(nodes.map((n) => n.dataset.avatarFor), nodes.map((n) => n.dataset.avatarName));
    nodes.forEach((n) => {
      const url = avatarUrlFor(n.dataset.avatarFor, n.dataset.avatarName);
      if (!url) return;
      n.src = url;
      // Broken avatar link -> keep the initials instead of a broken image.
      n.onerror = () => {
        n.onerror = null;
        n.src = initialsAvatar(n.dataset.avatarName || "CA");
      };
    });
  }

  // Staff (Super Admin / Admin / Moderator) rows, safe when sql/panel.sql is not installed yet.
  async function fetchStaff(columns = "id,role,member_id,username") {
    const pick = String(columns).split(",").map((c) => c.trim()).filter(Boolean);
    const res = await supabaseRequest(`/rest/v1/staff?select=${pick.join(",")}&order=created_at.asc`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  async function tmdb(path) {
    const join = path.includes("?") ? "&" : "?";
    const url = `${API}${path}${join}api_key=${API_KEY}&language=${TMDB_LANG[getLang()] || "en-US"}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
  }

  function normalizeStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    const map = {
      active: "active",
      activated: "active",
      enabled: "active",
      "مفعل": "active",
      disabled: "disabled",
      disabled_by_owner: "disabled",
      inactive: "disabled",
      "معطل": "disabled",
      banned: "banned",
      blocked: "banned",
      "محظور": "banned",
      expired: "expired",
      "منتهي": "expired",
    };
    return map[raw] || map[String(value || "").trim()] || raw || "unknown";
  }

  const CODE_MESSAGES = {
    active: "Code accepted. Enjoy the title.",
    disabled: "This code has been disabled by its owner.",
    banned: "This code has been banned by the platform.",
    expired: "This code has expired.",
    not_found: "This code does not exist. You can create one when you register.",
    invalid: "Enter a valid 6-digit access code.",
    setup: "Access codes are being configured. Please try again shortly.",
    error: "Could not verify the code. Please try again.",
    unknown: "This code cannot be used right now.",
  };

  async function verifyCode(code) {
    const clean = String(code || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(clean)) {
      return { ok: false, reason: "invalid", message: t("code.invalid") };
    }

    const url = `${SUPABASE_URL}/rest/v1/codes?code=eq.${encodeURIComponent(clean)}&select=*`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
        },
      });
    } catch {
      return { ok: false, reason: "error", message: t("code.error") };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === "PGRST205") {
        return { ok: false, reason: "setup", message: t("code.setup") };
      }
      return { ok: false, reason: "error", message: t("code.error") };
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      return { ok: false, reason: "not_found", message: t("code.not_found") };
    }

    const row = rows[0];
    let status = normalizeStatus(row.status);
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      status = "expired";
    }

    if (status === "active") {
      return { ok: true, reason: "active", message: t("code.active"), row };
    }

    return {
      ok: false,
      reason: status,
      message: t(`code.${status}`) !== `code.${status}` ? t(`code.${status}`) : t("code.unknown"),
      row,
    };
  }

  function getStoredCode() {
    return localStorage.getItem(CODE_KEY) || "";
  }

  function setStoredCode(code) {
    localStorage.setItem(CODE_KEY, code);
  }

  function clearStoredCode() {
    localStorage.removeItem(CODE_KEY);
  }

  function profileHref(username) {
    const name = String(username || "").replace(/^@/, "").trim();
    return name ? `./Profile.html?@${encodeURIComponent(name)}` : "./Profile.html";
  }

  // A single post has its own link too: ./Profile.html?post=P123456789
  function postHref(postId) {
    const id = String(postId || "").trim();
    return id ? `./Profile.html?post=${encodeURIComponent(id)}` : "./Profile.html";
  }

  /* ---------- Sharing a CineAura link ----------
     Facebook · Pinterest · Telegram · WhatsApp · Reddit, plus copy.
     Every network needs an absolute URL, so a page-relative href ("./Profile.html?post=P1")
     is resolved against the current page first. */
  function absoluteUrl(href) {
    const raw = String(href || "");
    try {
      return new URL(raw, location.href).href;
    } catch {
      return `${location.origin}/${raw.replace(/^\/+/, "")}`;
    }
  }

  const SHARE_ICONS = {
    facebook: `<path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8V11H8v3h2.5v7z"/>`,
    pinterest: `<path d="M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-4.9s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.8 1.5 1.8 1.8 0 3.2-1.9 3.2-4.6 0-2.4-1.7-4.1-4.2-4.1-2.9 0-4.5 2.1-4.5 4.3 0 .9.3 1.8.8 2.3l.1.4-.3 1.1c0 .2-.2.3-.4.2-1.3-.6-2.1-2.5-2.1-4 0-3.3 2.4-6.3 6.9-6.3 3.6 0 6.4 2.6 6.4 6 0 3.6-2.3 6.5-5.4 6.5-1.1 0-2.1-.6-2.4-1.2l-.7 2.5c-.2.9-.9 2-1.4 2.7A10 10 0 1 0 12 2z"/>`,
    telegram: `<path d="M21.9 4.3 18.8 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-1 .5l.3-4.6L18 6.9c.4-.3-.1-.5-.6-.2L7.2 13.1l-4.5-1.4c-1-.3-1-1 .2-1.4l17.6-6.8c.8-.3 1.5.2 1.4.4z"/>`,
    whatsapp: `<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.3 0-.5l-.7-1.7c-.2-.4-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3A2.9 2.9 0 0 0 6.8 10a5 5 0 0 0 1 2.6 11 11 0 0 0 4.3 3.8c1.6.6 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.3-.2-.6-.3z"/>`,
    reddit: `<path d="M22 12a2.1 2.1 0 0 0-3.6-1.5 10.6 10.6 0 0 0-5.8-1.8l1-4.6 3.2.7a1.5 1.5 0 1 0 .1-1l-3.7-.8a.5.5 0 0 0-.6.4l-1.1 5.3a10.6 10.6 0 0 0-5.9 1.8A2.1 2.1 0 1 0 4 14.2a4 4 0 0 0 0 .9c0 3.2 3.8 5.8 8.5 5.8s8.5-2.6 8.5-5.8a4 4 0 0 0 0-.9A2.1 2.1 0 0 0 22 12zM7.5 13.4a1.5 1.5 0 1 1 1.5 1.5 1.5 1.5 0 0 1-1.5-1.5zm8.9 4.4a6.4 6.4 0 0 1-4.4 1.4 6.4 6.4 0 0 1-4.4-1.4.5.5 0 0 1 .7-.7 5.5 5.5 0 0 0 3.7 1.1 5.5 5.5 0 0 0 3.7-1.1.5.5 0 0 1 .7.7zm-.5-2.9a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z"/>`,
    copy: `<path d="M9 9h9v11H9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 9V4H6v11h3" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  };

  function shareIcon(id) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">${SHARE_ICONS[id] || ""}</svg>`;
  }

  const SHARE_NETWORKS = [
    { id: "facebook", labelKey: "share.facebook", href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { id: "pinterest", labelKey: "share.pinterest", href: (url, text) => `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(text)}` },
    { id: "telegram", labelKey: "share.telegram", href: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
    { id: "whatsapp", labelKey: "share.whatsapp", href: (url, text) => `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text} ${url}`.trim())}` },
    { id: "reddit", labelKey: "share.reddit", href: (url, text) => `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}` },
  ];

  // One entry per network: the absolute CineAura link and where it is shared to.
  function shareTargets(href, text) {
    const url = absoluteUrl(href);
    const caption = String(text || "").trim() || url;
    return SHARE_NETWORKS.map((n) => ({
      id: n.id,
      label: t(n.labelKey),
      target: url,
      url: n.href(url, caption),
    }));
  }

  // Markup for one share row. `href` is the page-relative link of the thing
  // being shared (post, playlist, profile, watch page), `text` its caption.
  function shareRowHtml(href, text, opts = {}) {
    const url = absoluteUrl(href);
    const label = opts.label === false ? "" : escapeHtml(opts.label || t("share.title"));
    // A row that shares a post is marked, so the share itself can be counted.
    const track = opts.track ? ` data-share-track="${escapeHtml(opts.track)}"` : "";
    return `<div class="share-row${opts.compact ? " share-row--compact" : ""}"${track}>
      ${label ? `<span class="share-label">${label}</span>` : ""}
      <div class="share-btns">
        ${shareTargets(href, text)
          .map(
            (n) =>
              `<a class="share-btn share-${n.id}" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(n.label)}" aria-label="${escapeHtml(n.label)}">${shareIcon(n.id)}</a>`
          )
          .join("")}
        <button class="share-btn share-copy" type="button" data-share-copy="${escapeHtml(url)}" title="${escapeHtml(t("share.copy"))}" aria-label="${escapeHtml(t("share.copy"))}">${shareIcon("copy")}</button>
      </div>
    </div>`;
  }

  // Copy also works where the async clipboard API is unavailable (http, older
  // browsers), so the button never silently does nothing.
  async function copyText(value) {
    const text = String(value || "");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to the textarea path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // One delegated listener serves every share row on every page.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest?.("[data-share-copy]");
    if (!btn) return;
    const ok = await copyText(btn.dataset.shareCopy);
    toast(ok ? t("share.copied") : t("share.copyFail"));
  });

  /* ---------- Post analytics: impressions · link clicks · shares ----------
     Every event is one row in public.post_events (see sql/post_analytics.sql).
     Recommendations already live in post_votes, so only these three are stored
     here. Counting never blocks the UI: failures stay silent, and a database
     without the table simply records nothing. */
  const ANALYTICS_KINDS = ["impression", "click", "share"];
  const impressionSeen = new Set();
  let impressionQueue = [];
  let impressionTimer = null;
  let impressionObserver = null;

  function eventRow(postId, kind, extra = {}) {
    const session = getSession();
    return {
      post_id: String(postId || ""),
      owner_id: String(extra.ownerId || ""),
      kind,
      network: String(extra.network || ""),
      member_id: String(session?.member_id || ""),
      username: String(session?.username || ""),
    };
  }

  // One insert per event.
  function trackPostEvent(postId, kind, extra = {}) {
    if (!postId || !ANALYTICS_KINDS.includes(kind)) return Promise.resolve(false);
    return supabaseRequest("/rest/v1/post_events", {
      method: "POST",
      body: JSON.stringify(eventRow(postId, kind, extra)),
    })
      .then((r) => Boolean(r.ok))
      .catch(() => false);
  }

  // Impressions go out as one batch: a wall of cards is a single insert.
  function flushImpressions() {
    impressionTimer = null;
    if (!impressionQueue.length) return Promise.resolve(false);
    const rows = impressionQueue;
    impressionQueue = [];
    return supabaseRequest("/rest/v1/post_events", {
      method: "POST",
      body: JSON.stringify(rows),
    })
      .then((r) => Boolean(r.ok))
      .catch(() => false);
  }

  function queueImpression(card) {
    const postId = card?.dataset?.post;
    if (!postId || impressionSeen.has(postId)) return;
    impressionSeen.add(postId);
    impressionQueue.push(eventRow(postId, "impression", { ownerId: card.dataset.owner || "" }));
    clearTimeout(impressionTimer);
    impressionTimer = setTimeout(flushImpressions, 400);
  }

  // One impression per post card the viewer actually sees, counted once per page
  // (a reload is a new impression). Without an IntersectionObserver every drawn
  // card counts.
  function trackImpressions(container, posts) {
    const root = container || document;
    const wanted = new Set((posts || []).map((p) => String(p?.post_id || "")).filter(Boolean));
    const cards = [...root.querySelectorAll(".post-card[data-post]")].filter(
      (c) => !wanted.size || wanted.has(c.dataset.post)
    );
    if (!cards.length) return;
    if (typeof IntersectionObserver !== "function") {
      cards.forEach(queueImpression);
      return;
    }
    impressionObserver =
      impressionObserver ||
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            impressionObserver.unobserve(entry.target);
            queueImpression(entry.target);
          });
        },
        { rootMargin: "120px" }
      );
    cards.forEach((c) => impressionObserver.observe(c));
  }

  // Shares and link clicks, counted wherever a post card is drawn.
  document.addEventListener("click", (e) => {
    const share = e.target.closest?.("[data-share-track] .share-btn");
    if (share) {
      const row = share.closest("[data-share-track]");
      const network = share.classList.contains("share-copy")
        ? "copy"
        : [...share.classList].find((c) => c.startsWith("share-") && c !== "share-btn" && c !== "share-copy")?.slice(6) ||
          "";
      trackPostEvent(row.dataset.shareTrack, "share", { network });
      return;
    }
    const card = e.target.closest?.(".post-card[data-post]");
    if (!card) return;
    const link = e.target.closest("a[href]");
    if (!link || link.closest(".post-share")) return;
    // Only the links the post itself carries: a title it recommends, or the
    // playlist it points to.
    const href = link.getAttribute("href") || "";
    if (!/watch\.html|Playlist\.html/i.test(href)) return;
    trackPostEvent(card.dataset.post, "click", { ownerId: card.dataset.owner || "" });
  });

  function wireSessionNav() {
    const session = getSession();
    if (!session?.username) return;
    const href = profileHref(session.username);
    const fallback = session?.full_name || session?.username || "CA";
    const inject = (root, asButton) => {
      if (!root) return;
      let link = root.querySelector("[data-nav-profile]");
      if (!link) {
        link = document.createElement("a");
        link.dataset.navProfile = "1";
        if (asButton) {
          // Header: the member's picture is the profile button.
          link.className = "nav-avatar";
          link.innerHTML = avatarImg(session?.member_id, session?.username, fallback);
        }
        const dash = root.querySelector('a[href="./dashboard.html"], a[href="./dashboard.html"]');
        if (dash) dash.insertAdjacentElement("beforebegin", link);
        else root.insertBefore(link, root.firstChild);
      }
      link.href = href;
      if (asButton) {
        link.setAttribute("aria-label", t("nav.profile"));
        link.setAttribute("title", t("nav.profile"));
        const img = link.querySelector("img");
        if (img) {
          img.dataset.avatarFor = session?.member_id || "";
          img.dataset.avatarName = String(session?.username || "").replace(/^@/, "");
          img.alt = t("nav.profile");
          img.src = avatarSrc(session?.member_id, session?.username, fallback);
        }
        // Swap the initials for the stored picture once profiles arrive.
        hydrateAvatars(link);
      } else {
        link.textContent = t("nav.profile");
      }
    };
    $$("#auth-user, .auth-user").forEach((el) => inject(el, true));
    $$(".mobile-auth-user").forEach((el) => inject(el, false));
  }

  /* ---------- Header Bell Notifications ---------- */
  function initHeaderBell() {
    const bellBtn = $("#header-bell-btn");
    const bellDot = $("#header-bell-dot");
    const bellPanel = $("#header-bell-panel");
    if (!bellBtn || !bellPanel) return;

    let notes = [];

    bellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !bellPanel.hidden;
      bellPanel.hidden = open;
      if (open) return;
      // render notes
      if (notes.length) {
        bellPanel.innerHTML = notes.map((n) => {
          const href = n.href || "./Profile.html";
          return `
          <a class="hnote-row" href="${escapeHtml(href)}" data-note="${escapeHtml(n.id)}">
            <div class="hnote-dot ${n.read ? 'read' : ''}"></div>
            <div>
              <strong>${escapeHtml(n.title || n.kind)}</strong>
              <div style="color:var(--muted);font-size:12px;margin-top:2px">${escapeHtml(n.body || "")} · ${String(n.created_at || "").slice(0, 16).replace("T", " ")}</div>
            </div>
          </a>`;
        }).join("");
      } else {
        bellPanel.innerHTML = `<p style="color:var(--muted);text-align:center;padding:16px 0">${t("prof.noNotes")}</p>`;
      }
      // mark all as read
      notes.filter((n) => !n.read).forEach((n) => {
        supabaseRequest(`/rest/v1/notifications?id=eq.${n.id}`, {
          method: "PATCH",
          body: JSON.stringify({ read: true }),
        });
        n.read = true;
      });
      if (bellDot) bellDot.hidden = true;
    });

    document.addEventListener("click", (e) => {
      if (!bellPanel.hidden && !e.target.closest(".header-bell-wrap")) {
        bellPanel.hidden = true;
      }
    });

    async function poll() {
      const sess = getSession();
      if (!sess?.member_id) return;
      try {
        const res = await supabaseRequest(
          `/rest/v1/notifications?member_id=eq.${restValue(sess.member_id)}&select=*&order=created_at.desc&limit=30`
        );
        notes = res.ok && Array.isArray(res.data) ? res.data : [];
        const unread = notes.some((n) => !n.read);
        if (bellDot) bellDot.hidden = !unread;
      } catch { /* offline */ }
    }

    poll();
    setInterval(poll, 30000);
  }

  /* ---------- Section badges for profile page ---------- */
  function pollSectionBadges() {
    async function check() {
      const sess = getSession();
      if (!sess?.member_id) return;
      try {
        const [msgRes, followRes] = await Promise.all([
          supabaseRequest(`/rest/v1/messages?receiver_id=eq.${restValue(sess.member_id)}&read=eq.false&select=id`),
          supabaseRequest(`/rest/v1/follows?following_id=eq.${restValue(sess.member_id)}&status=eq.pending&select=id`),
        ]);
        const unreadMsgs = msgRes.ok && Array.isArray(msgRes.data) ? msgRes.data.length : 0;
        const pendingFollows = followRes.ok && Array.isArray(followRes.data) ? followRes.data.length : 0;
        // update profile sidebar buttons
        document.querySelectorAll('[data-sec="messages"]').forEach((btn) => {
          let badge = btn.querySelector(".sec-badge");
          if (unreadMsgs > 0) {
            if (!badge) { badge = document.createElement("span"); badge.className = "sec-badge"; btn.appendChild(badge); }
            badge.textContent = unreadMsgs;
          } else if (badge) {
            badge.remove();
          }
        });
        document.querySelectorAll('[data-sec="following"]').forEach((btn) => {
          let badge = btn.querySelector(".sec-badge");
          if (pendingFollows > 0) {
            if (!badge) { badge = document.createElement("span"); badge.className = "sec-badge"; btn.appendChild(badge); }
            badge.textContent = pendingFollows;
          } else if (badge) {
            badge.remove();
          }
        });
      } catch { /* offline */ }
    }
    check();
    setInterval(check, 20000);
    // re-check when profile sections change
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-sec]")) setTimeout(check, 500);
    });
  }

  // Ads are for Free members only: guests and active Silver / Gold / Diamond members never see them.
  // A paid plan that has expired counts as Free. Cached per member for the life of the page.
  const adsEligibleCache = {};
  function adsEligible() {
    const session = getSession();
    if (!session?.member_id) return Promise.resolve(false);
    const id = session.member_id;
    if (!adsEligibleCache[id]) {
      adsEligibleCache[id] = supabaseRequest(
        `/rest/v1/members?member_id=eq.${restValue(id)}&select=membership_type,membership_expires_at`
      )
        .then((res) => {
          const row = res.ok ? res.data?.[0] : null;
          if (!row) return false;
          const paid = ["Silver", "Gold", "Diamond"].includes(row.membership_type);
          const active = !row.membership_expires_at || new Date(row.membership_expires_at).getTime() > Date.now();
          return !(paid && active);
        })
        .catch(() => false);
    }
    return adsEligibleCache[id];
  }

  // ---------- Language menu in the header ----------
  const LANG_NAMES = { en: "English", ar: "العربية", fr: "Français", de: "Deutsch", es: "Español", nl: "Nederlands", it: "Italiano" };

  function initLangSwitch() {
    const inner = document.querySelector(".header-inner");
    if (!inner || inner.querySelector(".lang-switch")) return;
    const box = document.createElement("div");
    box.className = "lang-switch";
    box.innerHTML = `
      <button class="lang-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Language" data-i18n-aria="nav.language">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>
        <span class="lang-code"></span>
        <svg class="lang-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <ul class="lang-menu" role="listbox" hidden>
        ${LANGS.map((c) => `<li role="none"><button type="button" role="option" data-lang="${c}" lang="${c}">${LANG_NAMES[c] || c}</button></li>`).join("")}
      </ul>`;
    const burger = inner.querySelector(".hamburger");
    inner.insertBefore(box, burger || null);

    const btn = box.querySelector(".lang-btn");
    const menu = box.querySelector(".lang-menu");
    const setOpen = (open) => {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    };
    const sync = () => {
      const cur = getLang();
      box.querySelector(".lang-code").textContent = cur.toUpperCase();
      menu.querySelectorAll("[data-lang]").forEach((o) => o.setAttribute("aria-selected", String(o.dataset.lang === cur)));
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-lang]");
      if (!opt) return;
      const code = opt.dataset.lang;
      setOpen(false);
      applyPrefs({ language: code, persist: true });
      const s = getSession();
      if (s?.member_id) {
        // keep the account in step with the choice; a failed write is not fatal
        supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(s.member_id)}`, {
          method: "PATCH",
          keepalive: true,
          body: JSON.stringify({ language: code }),
        }).catch(() => null);
      }
    });
    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        setOpen(false);
        btn.focus();
      }
    });
    document.addEventListener("cineaura:prefs", sync);
    sync();
    translateDom(box);
  }

  function setupChrome() {
    applyPrefs({ persist: false });
    initLangSwitch();
    startPresence();
    renderAuth();
    // No session on a page that needs one: lock it before any handler is bound.
    syncAuthGate();
    watchSessionLock();
    wireSessionNav();
    initHeaderBell();
    pollSectionBadges();
    hydratePrefsFromProfile();
    const header = $("#site-header");
    if (header) {
      const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    const hamburger = $("#hamburger");
    const menu = $("#mobile-menu");
    hamburger?.addEventListener("click", () => {
      const open = !menu.classList.contains("open");
      menu.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
    });
    menu?.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        menu.classList.remove("open");
        document.body.classList.remove("menu-open");
      }
      if (e.target.closest("[data-logout]")) logout();
    });
    $("#logout-btn")?.addEventListener("click", logout);
  }

  function posterCard(item, type) {
    const media = type || item.media_type || (item.title ? "movie" : "tv");
    const title = item.title || item.name || "Untitled";
    const date = formatDate(item.release_date || item.first_air_date);
    const poster = imgUrl(item.poster_path, "w342") || initialsAvatar(title);
    return `
      <a class="poster-card" href="${watchHref(media, item.id)}" title="${escapeHtml(title)}">
        <div class="poster-media">
          <span class="rating-badge">★ ${ratingText(item.vote_average)}</span>
          <img src="${poster}" alt="${escapeHtml(title)}" loading="lazy" />
          <div class="poster-play">
            <span class="play-orb">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5L13 8L4 13.5V2.5Z"/></svg>
            </span>
          </div>
        </div>
        <div class="poster-info">
          <h3>${escapeHtml(title)}</h3>
          <div class="poster-sub">
            <span>${escapeHtml(date)}</span>
            <span>${ratingText(item.vote_average)}/10</span>
          </div>
        </div>
      </a>
    `;
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function supabaseRequest(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {}),
      },
    });
    let data = null;
    const raw = await res.text();
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    // Headers carry the total row count when a request asks for count=exact.
    return { ok: res.ok, status: res.status, data, headers: res.headers };
  }

  // Tell the author's accepted followers that a new post is out. One bulk insert
  // keeps it cheap; failures stay silent (the post itself is already saved).
  async function notifyFollowers(payload = {}) {
    const ownerId = payload.ownerId || payload.owner_id;
    if (!ownerId) return false;
    // Nobody gets told about a post that is meant to stay private.
    if (payload.visibility === "private") return false;
    try {
      const fol = await supabaseRequest(
        `/rest/v1/follows?following_id=eq.${restValue(ownerId)}&status=eq.accepted&select=follower_id`
      );
      const ids = [...new Set((fol.data || []).map((f) => f.follower_id).filter((id) => id && id !== ownerId))];
      if (!ids.length) return false;
      const rows = ids.slice(0, 500).map((id) => ({
        member_id: id,
        kind: "post",
        title: payload.title || t("prof.newPost"),
        body: payload.body || "",
        href: payload.href || profileHref(payload.username || ""),
        from_id: ownerId,
        from_username: payload.username || "",
      }));
      const res = await supabaseRequest("/rest/v1/notifications", {
        method: "POST",
        body: JSON.stringify(rows),
      });
      return Boolean(res.ok);
    } catch {
      return false;
    }
  }

  function normalizeAccountStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    const map = {
      active: "active",
      activated: "active",
      enabled: "active",
      "مفعل": "active",
      disabled: "disabled",
      inactive: "disabled",
      "معطل": "disabled",
      banned: "banned",
      blocked: "banned",
      "محظور": "banned",
    };
    return map[raw] || map[String(value || "").trim()] || raw;
  }

  // ---------- IPTV helpers (shared by dashboard + panel) ----------
  function iptvKind(a) {
    return a.kind || (a.xstream_user ? "xtream" : "m3u");
  }

  function iptvServer(a) {
    return String(a.xstream_server || "").trim().replace(/\/(player_api|get|xmltv|panel_api)\.php.*$/i, "").replace(/\/+$/, "");
  }

  function iptvM3uUrl(a) {
    if (iptvKind(a) === "m3u") return a.m3u_url || "";
    const server = iptvServer(a);
    if (!server || !a.xstream_user) return "";
    return `${server}/get.php?username=${encodeURIComponent(a.xstream_user)}&password=${encodeURIComponent(a.xstream_password || "")}&type=m3u_plus&output=ts`;
  }

  function fileSlug(name) {
    return String(name || "iptv").trim().replace(/[^\w\u0600-\u06FF.-]+/g, "_").replace(/^_+|_+$/g, "") || "iptv";
  }

  function saveTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function fetchPlaylistText(url) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
    } catch { /* blocked by CORS: use the server proxy */ }
    const r2 = await fetch(`/api/m3u?url=${encodeURIComponent(url)}`);
    if (!r2.ok) throw new Error("fetch failed");
    return r2.text();
  }

  async function iptvDownloadM3u(a) {
    const url = iptvM3uUrl(a);
    if (!url) return toast(t("dash.iptvDlFail"));
    try {
      const text = await fetchPlaylistText(url);
      if (!/#EXTM3U|#EXTINF/i.test(text)) throw new Error("not an m3u");
      saveTextFile(`${fileSlug(a.name)}.m3u`, text, "audio/x-mpegurl");
      toast(t("dash.iptvDlOk"));
    } catch {
      toast(t("dash.iptvDlFail"));
    }
  }

  function iptvDownloadXtream(a) {
    const server = iptvServer(a);
    const q = `username=${encodeURIComponent(a.xstream_user || "")}&password=${encodeURIComponent(a.xstream_password || "")}`;
    const body = [
      "CineAura IPTV - Xtream Codes",
      "============================",
      `Name: ${a.name || ""}`,
      `Server: ${server}`,
      `Username: ${a.xstream_user || ""}`,
      `Password: ${a.xstream_password || ""}`,
      `M3U: ${iptvM3uUrl(a)}`,
      `EPG: ${server}/xmltv.php?${q}`,
      `Duration: ${a.duration || "unlimited"}`,
      "",
    ].join("\r\n");
    saveTextFile(`${fileSlug(a.name)}-xtream.txt`, body, "text/plain");
    toast(t("dash.iptvDlOk"));
  }

  function iptvDetailRows(a) {
    const row = (label, val, secret) => {
      if (!val) return "";
      const v = escapeHtml(val);
      return `<div class="ipx-row">
        <span class="ipx-label">${label}</span>
        <div class="ipx-line">
          <code class="ipx-val" dir="ltr" title="${secret ? "" : v}" data-full="${v}" ${secret ? 'data-secret="1"' : ""}>${secret ? "••••••••" : v}</code>
          ${secret ? `<button class="ipx-btn" type="button" data-ipx-eye>${t("dash.iptvShow")}</button>` : ""}
          <button class="ipx-btn" type="button" data-ipx-copy="${v}">${t("dash.iptvCopy")}</button>
        </div>
      </div>`;
    };
    if (iptvKind(a) === "m3u") return row("M3U", a.m3u_url);
    return row(t("panel.iptv.server"), iptvServer(a)) + row(t("panel.iptv.user"), a.xstream_user) + row(t("panel.iptv.pass"), a.xstream_password, true) + row("M3U", iptvM3uUrl(a));
  }

  function iptvActionsHtml(a) {
    const id = escapeHtml(String(a.id));
    return `${iptvM3uUrl(a) ? `<button class="btn btn-sm btn-ghost" type="button" data-ipx-dl-m3u="${id}">${t("dash.iptvDlM3u")}</button>` : ""}${iptvKind(a) === "xtream" ? `<button class="btn btn-sm btn-ghost" type="button" data-ipx-dl-xt="${id}">${t("dash.iptvDlXt")}</button>` : ""}`;
  }

  function bindIptvActions(root, getAccount) {
    if (!root) return;
    root.addEventListener("click", async (e) => {
      const copy = e.target.closest("[data-ipx-copy]");
      if (copy) {
        try { await navigator.clipboard.writeText(copy.dataset.ipxCopy); toast(t("dash.iptvCopied")); } catch { /* ignore */ }
        return;
      }
      const eye = e.target.closest("[data-ipx-eye]");
      if (eye) {
        const code = eye.closest(".ipx-line")?.querySelector(".ipx-val");
        if (!code) return;
        const hidden = code.dataset.secret === "1";
        code.textContent = hidden ? code.dataset.full : "••••••••";
        code.dataset.secret = hidden ? "0" : "1";
        eye.textContent = hidden ? t("dash.iptvHide") : t("dash.iptvShow");
        return;
      }
      const m3u = e.target.closest("[data-ipx-dl-m3u]");
      const xt = e.target.closest("[data-ipx-dl-xt]");
      if (m3u || xt) {
        const acc = getAccount(String((m3u || xt).dataset.ipxDlM3u ?? (m3u || xt).dataset.ipxDlXt));
        if (!acc) return;
        if (m3u) { m3u.disabled = true; await iptvDownloadM3u(acc); m3u.disabled = false; }
        else iptvDownloadXtream(acc);
      }
    });
  }

  // Partial-ban guard: call before any restricted activity. Returns false (and shows the error) if blocked.
  async function guardFeature(feature) {
    const sess = getSession();
    if (!sess?.member_id) return true;
    try {
      const [san, mem] = await Promise.all([
        supabaseRequest(`/rest/v1/sanctions?member_id=eq.${restValue(sess.member_id)}&select=features,temp_until`),
        supabaseRequest(`/rest/v1/members?member_id=eq.${restValue(sess.member_id)}&select=status`),
      ]);
      const row = san.ok && Array.isArray(san.data) ? san.data[0] : null;
      const feats = String(row?.features || "").split(",").map((x) => x.trim());
      const temp = Boolean(row?.temp_until) && Date.parse(row.temp_until) > Date.now();
      const banned = normalizeAccountStatus(mem.data?.[0]?.status) === "banned";
      if (feats.includes(feature) || temp || banned) {
        toast(t("panel.featBlockedMsg", { feature: t(`panel.feat.${feature}`) }));
        return false;
      }
    } catch { /* offline: let the request itself fail */ }
    return true;
  }

  // ---------- Collapsible side menu (dashboard, panel, profile) ----------
  const SIDE_KEY = "cineaura_side_hidden";

  function sideHidden() {
    try {
      return localStorage.getItem(SIDE_KEY) === "1";
    } catch {
      return false;
    }
  }

  // Adds a "Hide menu / Show menu" button above the sidebar layout and applies the
  // remembered state. Call it again after every re-render of the layout.
  function mountSideToggle(layout) {
    if (!layout || !layout.querySelector("aside")) return;
    layout.querySelector(":scope > .side-toggle-bar")?.remove();
    const bar = document.createElement("div");
    bar.className = "side-toggle-bar";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm btn-ghost side-toggle";
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg><span></span>';
    const label = btn.querySelector("span");
    const apply = (hidden) => {
      layout.classList.toggle("side-collapsed", hidden);
      btn.setAttribute("aria-expanded", String(!hidden));
      label.textContent = t(hidden ? "side.show" : "side.hide");
    };
    btn.addEventListener("click", () => {
      const hidden = !layout.classList.contains("side-collapsed");
      try {
        localStorage.setItem(SIDE_KEY, hidden ? "1" : "0");
      } catch {
        /* storage blocked: the toggle still works for this view */
      }
      apply(hidden);
    });
    bar.appendChild(btn);
    layout.prepend(bar);
    apply(sideHidden());
  }

  /* ════════════════════════════════════════════════════════════════════
     Points

     A member earns points from five sources, each at its own rate:

       1 watch minute — yours or through your link —   = 1 point
       5 link shares                                   = 1 point
       10 public or exclusive playlists                = 1 point
       50 public or exclusive recommendations          = 1 point
       100 comments                                    = 1 point

     Fractions are dropped (12 shares are worth 2 points, not 2.4). What a
     member can spend is what they earned minus what they already spent
     (profiles.points_spent), so the bonus points of a source cannot be spent
     twice and the watch minutes themselves are never destroyed.
     ════════════════════════════════════════════════════════════════════ */
  const POINT_RATES = [
    { key: "minutes", per: 1, src: "points.src.minutes", rate: "points.rate.minutes" },
    { key: "shares", per: 5, src: "points.src.shares", rate: "points.rate.shares" },
    { key: "playlists", per: 10, src: "points.src.playlists", rate: "points.rate.playlists" },
    { key: "recommendations", per: 50, src: "points.src.recs", rate: "points.rate.recs" },
    { key: "comments", per: 100, src: "points.src.comments", rate: "points.rate.comments" },
  ];

  // Total number of rows of a query, read from the content-range header so the
  // rows themselves never travel over the wire.
  async function countRows(path) {
    const res = await supabaseRequest(`${path}${path.includes("?") ? "&" : "?"}limit=1`, {
      headers: { Prefer: "count=exact", Range: "0-0" },
    });
    if (!res.ok) return 0;
    const n = Number(String(res.headers?.get?.("content-range") || "").split("/")[1]);
    if (Number.isFinite(n)) return n;
    return Array.isArray(res.data) ? res.data.length : 0;
  }

  // How many of each source the member has. `minutes` comes from the profile
  // row that is already loaded: private_minutes is what the member watched,
  // public_minutes what was watched through a link they published.
  async function pointParts(memberId, profile = {}) {
    const id = restValue(memberId);
    const minutes = Number(profile.private_minutes || 0) + Number(profile.public_minutes || 0);
    const [shares, playlists, recommendations, comments] = await Promise.all([
      countRows(`/rest/v1/post_events?kind=eq.share&member_id=eq.${id}&select=id`),
      countRows(`/rest/v1/playlists?owner_id=eq.${id}&visibility=in.(public,exclusive)&select=playlist_id`),
      countRows(
        `/rest/v1/posts?owner_id=eq.${id}&kind=in.(recommendation,reclist)&visibility=in.(public,exclusive)&select=post_id`
      ),
      countRows(`/rest/v1/comments?member_id=eq.${id}&select=id`),
    ]);
    return { minutes, shares, playlists, recommendations, comments };
  }

  // One row per source: what the member has, the rate, and the points it gives.
  function pointBreakdown(parts) {
    return POINT_RATES.map((r) => {
      const count = Number(parts?.[r.key] || 0);
      return { key: r.key, per: r.per, src: r.src, rate: r.rate, count, points: Math.floor(count / r.per) };
    });
  }

  const pointsEarned = (parts) => pointBreakdown(parts).reduce((sum, r) => sum + r.points, 0);

  async function memberPoints(memberId, profile = {}) {
    const parts = await pointParts(memberId, profile);
    const breakdown = pointBreakdown(parts);
    const earned = breakdown.reduce((sum, r) => sum + r.points, 0);
    const spent = Math.max(0, Number(profile.points_spent || 0));
    return { parts, breakdown, earned, spent, available: Math.max(0, earned - spent) };
  }

  // Call a Postgres function (sql/prize_secure.sql). Returns { ok, status, data }.
  // Failures raised by the function (for example an expired staff session) come back
  // as ok:false with the message in data.message.
  async function rpc(name, args = {}) {
    return supabaseRequest(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  }

  // The "how you earn points" panel shared by the prize dialog and dashboard.
  function pointsHtml(mp) {
    if (!mp) return "";
    const rows = mp.breakdown
      .map(
        (r) => `
        <li class="pt-row">
          <span class="pt-src">
            <b>${escapeHtml(t(r.src))}</b>
            <small>${escapeHtml(t(r.rate))}</small>
          </span>
          <span class="pt-count">${r.count}</span>
          <span class="pt-pts">+${r.points}</span>
        </li>`
      )
      .join("");
    return `
      <div class="pt-box">
        <div class="pt-head">
          <span>${escapeHtml(t("points.title"))}</span>
          <b class="pt-total">${mp.available}</b>
        </div>
        <ul class="pt-list">${rows}</ul>
        <div class="pt-foot">
          <span>${escapeHtml(t("points.earned"))} <b>${mp.earned}</b></span>
          <span>${escapeHtml(t("points.spent"))} <b>${mp.spent}</b></span>
          <span>${escapeHtml(t("points.available"))} <b>${mp.available}</b></span>
        </div>
      </div>`;
  }

  window.CineAura = {
    API_KEY,
    API,
    IMG,
    SESSION_KEY,
    CODE_KEY,
    SUPABASE_URL,
    SUPABASE_KEY,
    TMDB_KEY: API_KEY,
    CODE_MESSAGES,
    LANGS,
    t,
    tr,
    langText,
    getLang,
    getTheme,
    getLocale,
    applyPrefs,
    translateDom,
    mountSideToggle,
    hydratePrefsFromProfile,
    adsEligible,
    $,
    $$,
    toast,
    isLoggedIn,
    getSession,
    setSession,
    renderAuth,
    logout,
    downloadAccountTxt,
    guardFeature,
    iptvKind,
    iptvM3uUrl,
    iptvDetailRows,
    iptvActionsHtml,
    bindIptvActions,
    normalizeRecoveryCode,
    restValue,
    imgUrl,
    formatRuntime,
    formatDate,
    ratingText,
    ratingPercent,
    escapeHtml,
    watchHref,
    personHref,
    personCredits,
    initialsAvatar,
    avatarUrlFor,
    avatarSrc,
    avatarImg,
    primeAvatars,
    hydrateAvatars,
    refreshAvatar,
    profilesByIds,
    profilesByUsernames,
    fetchStaff,
    photo,
    tmdb,
    verifyCode,
    getStoredCode,
    setStoredCode,
    clearStoredCode,
    setupChrome,
    profileHref,
    postHref,
    absoluteUrl,
    shareTargets,
    shareRowHtml,
    copyText,
    trackPostEvent,
    trackImpressions,
    wireSessionNav,
    posterCard,
    sha256,
    supabaseRequest,
    POINT_RATES,
    countRows,
    pointParts,
    pointBreakdown,
    pointsEarned,
    memberPoints,
    rpc,
    pointsHtml,
    normalizeAccountStatus,
    notifyFollowers,
    showAuthGate,
    hideAuthGate,
    syncAuthGate,
    sessionWriteBlocked,
    authGateEnabled,
  };
})();
