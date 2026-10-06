(() => {
  const {
    $,
    $$,
    tmdb,
    imgUrl,
    photo,
    formatRuntime,
    formatDate,
    ratingText,
    ratingPercent,
    escapeHtml,
    watchHref,
    personHref,
    posterCard,
    shareRowHtml,
    setupChrome,
    isLoggedIn,
    verifyCode,
    getStoredCode,
    setStoredCode,
    toast,
    getSession,
    supabaseRequest,
    restValue,
    t,
    translateDom,
    getLang,
  } = window.CineAura;

  const PREVIEW_MS = 5 * 60 * 1000;
  const CODE_FAIL_MAX = 3;
  const CODE_LOCK_MS = 24 * 60 * 60 * 1000;
  const CODE_LOCK_KEY = "cineaura_code_lockout";
  const params = new URLSearchParams(location.search);
  const movieId = params.get("movie");
  const tvId = params.get("tv");
  const mediaType = tvId ? "tv" : "movie";
  const mediaId = tvId || movieId;
  // Post attribution: links shared inside a post look like
  // /watch.html?movie=123&post=P456 — the watched minutes go to the post owner.
  const postId = params.get("post") || "";

  const state = {
    detail: null,
    season: Number(params.get("season") || 1) || 1,
    episode: Number(params.get("episode") || 1) || 1,
    seasons: [],
    episodes: [],
    unlocked: false,
    needsCode: false,
    gated: false,
    timer: null,
    lockTimer: null,
    endsAt: 0,
    watchMinutes: 0,
    viewId: null,
    viewMinutes: 0,
    minuteTimer: null,
    linkOwnerId: "",
    linkWatchUrl: "",
    guestId: "",
    postId: postId || "",
    postOwnerId: "",
    blocksAgainstMe: [],
    sanctions: null,
    recDone: "",
    watchTab: "comments",
    ctx: null,
  };

  async function loadPostOwner() {
    state.postOwnerId = "";
    if (!state.postId) return;
    try {
      const res = await supabaseRequest(
        `/rest/v1/posts?post_id=eq.${restValue(state.postId)}&select=owner_id`
      );
      const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
      state.postOwnerId = row?.owner_id ? String(row.owner_id) : "";
    } catch {
      state.postOwnerId = "";
    }
  }

  async function loadMySanctions() {
    const session = getSession();
    if (!session?.member_id) return;
    const res = await supabaseRequest(
      `/rest/v1/sanctions?member_id=eq.${restValue(session.member_id)}&select=features`
    );
    state.sanctions = res.data?.[0] || null;
  }

  function featureBlocked(name) {
    return String(state.sanctions?.features || "")
      .split(",")
      .map((s) => s.trim())
      .includes(name);
  }

  function subtitleLang() {
    const lang = typeof getLang === "function" ? getLang() : "en";
    const map = { en: "en", ar: "ar", fr: "fr", de: "de", es: "es", nl: "nl", it: "it" };
    return map[lang] || "en";
  }

  function embedUrl() {
    const sub = subtitleLang();
    if (mediaType === "tv") {
      return `https://vidsrc.sh/embed/tv/${mediaId}/${state.season}/${state.episode}?ds_lang=${sub}`;
    }
    return `https://vidsrc.sh/embed/movie/${mediaId}?ds_lang=${sub}`;
  }

  function certification(detail) {
    if (mediaType === "movie") {
      const groups = detail.release_dates?.results || [];
      const us = groups.find((g) => g.iso_3166_1 === "US") || groups[0];
      const hit = us?.release_dates?.find((d) => d.certification)?.certification;
      return hit || "NR";
    }
    const groups = detail.content_ratings?.results || [];
    const us = groups.find((g) => g.iso_3166_1 === "US") || groups[0];
    return us?.rating || "NR";
  }

  function currentRuntime() {
    if (mediaType === "movie") return state.detail?.runtime;
    const ep = state.episodes.find((e) => e.episode_number === state.episode);
    return ep?.runtime || state.detail?.episode_run_time?.[0] || null;
  }

  function idleBackdrop() {
    if (mediaType === "tv") {
      const ep = state.episodes.find((e) => e.episode_number === state.episode);
      if (ep?.still_path) return imgUrl(ep.still_path, "w1280");
    }
    return (
      imgUrl(state.detail?.backdrop_path, "original") ||
      imgUrl(state.detail?.poster_path, "w780")
    );
  }

  function setIdleArt() {
    const idle = $("#player-idle");
    const bg = idleBackdrop();
    idle.style.backgroundImage = bg ? `url('${bg}')` : "none";
    $("#play-runtime").textContent = formatRuntime(currentRuntime());
  }

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
    $("#countdown-dock").classList.remove("show");
  }

  function stopMinuteTicker() {
    clearInterval(state.minuteTimer);
    state.minuteTimer = null;
  }

  function minutesLabel(n) {
    return t("watch.min", { n: Math.max(0, Number(n) || 0) });
  }

  function updateMinutesChip() {
    const chip = $("#watch-min-chip");
    if (chip) chip.textContent = minutesLabel(state.watchMinutes);
  }

  async function loadWatchMinutes() {
    const res = await supabaseRequest(
      `/rest/v1/views?tmdb_id=eq.${Number(mediaId)}&media_type=eq.${mediaType}&select=minutes`
    );
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    state.watchMinutes = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
    updateMinutesChip();
  }

  async function addProfileMinute(memberId, field) {
    if (!memberId) return;
    const prof = await supabaseRequest(
      `/rest/v1/profiles?member_id=eq.${restValue(memberId)}&select=private_minutes,public_minutes`
    );
    const row = prof.data?.[0];
    if (!row) return;
    await supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(memberId)}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: Number(row[field] || 0) + 1 }),
    });
  }

  async function ensureViewRow(linkOwnerId, watchUrl) {
    const owner = String(linkOwnerId || "");
    const url = String(watchUrl || "");
    if (state.viewId && state.linkOwnerId === owner && state.linkWatchUrl === url) return;
    const session = getSession && getSession();
    if (!state.guestId) state.guestId = `GUEST${Date.now()}`;
    const viewer = session?.member_id || state.guestId;
    const playlistId = params.get("Playlist") || params.get("playlist") || "";
    const payload = {
      viewer_id: viewer,
      tmdb_id: Number(mediaId),
      media_type: mediaType,
      playlist_id: playlistId,
      minutes: 0,
      link_owner_id: owner,
      watch_url: url,
      post_id: state.postId || "",
    };
    if (mediaType === "tv") {
      payload.season = state.season;
      payload.episode = state.episode;
    }
    let saved = await supabaseRequest("/rest/v1/views", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!saved.ok) {
      const fallback = {
        viewer_id: viewer,
        tmdb_id: Number(mediaId),
        media_type: mediaType,
        playlist_id: playlistId,
        minutes: 0,
        link_owner_id: owner,
      };
      saved = await supabaseRequest("/rest/v1/views", {
        method: "POST",
        body: JSON.stringify(fallback),
      });
      // Older databases without watch_url/post_id: retry without watch_url but keep post_id.
      if (!saved.ok && state.postId) {
        saved = await supabaseRequest("/rest/v1/views", {
          method: "POST",
          body: JSON.stringify({ ...fallback, post_id: state.postId }),
        });
      }
    }
    state.viewId = saved?.data?.[0]?.id || null;
    state.viewMinutes = 0;
    state.linkOwnerId = owner;
    state.linkWatchUrl = url;
  }

  // Free members watch with ads. If an ad blocker hides them (or the ad script is
  // missing), the minute is not counted for anyone. Paid members and guests are not affected.
  async function adsAllowCounting() {
    try {
      if (!(await CineAura.adsEligible())) return true;
      return window.CineAuraAds?.status === "ok";
    } catch {
      return true;
    }
  }

  function startMinuteTicker() {
    stopMinuteTicker();
    state.minuteTimer = setInterval(async () => {
      if (!(await adsAllowCounting())) return;
      state.watchMinutes += 1;
      state.viewMinutes += 1;
      updateMinutesChip();
      if (state.viewId) {
        await supabaseRequest(`/rest/v1/views?id=eq.${state.viewId}`, {
          method: "PATCH",
          body: JSON.stringify({ minutes: state.viewMinutes }),
        });
      }
      const session = getSession && getSession();
      if (session?.member_id) {
        const playlistId = params.get("Playlist") || params.get("playlist") || "";
        let field = "private_minutes";
        if (playlistId) {
          const pl = await supabaseRequest(
            `/rest/v1/playlists?playlist_id=eq.${restValue(playlistId)}&select=visibility`
          );
          if (String(pl.data?.[0]?.visibility || "").toLowerCase() === "public") field = "public_minutes";
        }
        await addProfileMinute(session.member_id, field);
      }
      if (state.linkOwnerId && state.linkOwnerId !== session?.member_id) {
        await addProfileMinute(state.linkOwnerId, "public_minutes");
      }
    }, 60000);
  }

  function stopEmbed() {
    stopMinuteTicker();
    $("#player-frame").removeAttribute("src");
    $("#player-frame").src = "about:blank";
  }

  function showIdle() {
    $("#player").classList.remove("is-playing");
    $("#player-idle").style.display = "grid";
  }

  function hideIdle() {
    $("#player").classList.add("is-playing");
    $("#player-idle").style.display = "none";
  }

  function readCodeLock() {
    try {
      const raw = JSON.parse(localStorage.getItem(CODE_LOCK_KEY) || "null");
      if (!raw || typeof raw !== "object") return { fails: 0, until: 0 };
      const until = Number(raw.until) || 0;
      if (until && until <= Date.now()) {
        const fresh = { fails: 0, until: 0 };
        localStorage.setItem(CODE_LOCK_KEY, JSON.stringify(fresh));
        return fresh;
      }
      return { fails: Math.max(0, Number(raw.fails) || 0), until };
    } catch {
      return { fails: 0, until: 0 };
    }
  }

  function writeCodeLock(data) {
    localStorage.setItem(CODE_LOCK_KEY, JSON.stringify(data));
  }

  function clearCodeLock() {
    writeCodeLock({ fails: 0, until: 0 });
  }

  function codeLockRemaining() {
    return Math.max(0, readCodeLock().until - Date.now());
  }

  function isCodeLocked() {
    return codeLockRemaining() > 0;
  }

  function formatLockClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function lockMessage() {
    return t("watch.lockout", { time: formatLockClock(codeLockRemaining()) });
  }

  function setCodeFormEnabled(on) {
    const input = $("#code-input");
    const btn = $("#unlock-btn");
    if (input) {
      input.disabled = !on;
      if (!on) input.value = "";
    }
    if (btn) btn.disabled = !on;
    $("#player-gate .gate-card")?.classList.toggle("is-locked", !on);
  }

  function stopLockTicker() {
    clearInterval(state.lockTimer);
    state.lockTimer = null;
  }

  function applyLockUI() {
    if (!isCodeLocked()) {
      stopLockTicker();
      setCodeFormEnabled(true);
      return false;
    }
    setCodeFormEnabled(false);
    const msg = $("#gate-msg");
    if (msg) {
      msg.textContent = lockMessage();
      msg.className = "gate-msg error";
    }
    if (!state.lockTimer) {
      state.lockTimer = setInterval(() => {
        if (!isCodeLocked()) {
          stopLockTicker();
          setCodeFormEnabled(true);
          if (msg) {
            msg.textContent = t("watch.lockoutOver");
            msg.className = "gate-msg ok";
          }
          toast(t("watch.lockoutOver"));
          return;
        }
        if (msg) {
          msg.textContent = lockMessage();
          msg.className = "gate-msg error";
        }
      }, 1000);
    }
    return true;
  }

  function recordFailedCode() {
    const lock = readCodeLock();
    if (lock.until > Date.now()) return lock;
    lock.fails += 1;
    if (lock.fails >= CODE_FAIL_MAX) {
      lock.fails = CODE_FAIL_MAX;
      lock.until = Date.now() + CODE_LOCK_MS;
    }
    writeCodeLock(lock);
    return lock;
  }

  function showGate(message, kind = "error") {
    state.gated = true;
    stopTimer();
    stopEmbed();
    showIdle();
    $("#player-gate").classList.add("show");
    $("#create-code").href = isLoggedIn() ? "./dashboard.html" : "./login.html";
    if (applyLockUI()) return;
    const msg = $("#gate-msg");
    msg.textContent = message || "";
    msg.className = `gate-msg ${kind}`;
  }

  function hideGate() {
    state.gated = false;
    $("#player-gate").classList.remove("show");
    $("#gate-msg").textContent = "";
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function lockPlayer() {
    showGate(state.storedIssue || t("watch.enterCode"));
  }

  function startCountdown() {
    state.endsAt = Date.now() + PREVIEW_MS;
    const dock = $("#countdown-dock");
    const label = $("#countdown-time");
    dock.classList.add("show");
    label.textContent = "05:00";
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const left = state.endsAt - Date.now();
      label.textContent = formatClock(left);
      if (left <= 0) lockPlayer();
    }, 250);
  }

  function playEmbed() {
    hideGate();
    hideIdle();
    $("#player-frame").src = embedUrl();
    if (state.needsCode && !state.unlocked) startCountdown();
    else stopTimer();
    // Opened from a post (&post=...): credit the watched minutes to the post owner.
    const owner = state.postId ? state.postOwnerId || "" : "";
    const url = state.postId ? embedUrl() : "";
    ensureViewRow(owner, url).then(() => startMinuteTicker());
  }

  function playMemberLink(url, ownerId) {
    if (!url) return;
    if (state.gated) {
      $("#code-input")?.focus();
      toast(t("watch.enterFirst"));
      return;
    }
    hideGate();
    hideIdle();
    $("#player-frame").src = url;
    $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (state.needsCode && !state.unlocked) startCountdown();
    else stopTimer();
    ensureViewRow(ownerId || "", url).then(() => startMinuteTicker());
  }

  function linkHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "source";
    }
  }

  async function renderPlaylistBar() {
    const el = $("#title-playlist");
    if (!el) return;
    const session = getSession();
    if (!session?.member_id) {
      el.innerHTML = `
        <span class="eyebrow">${t("dash.nav.playlists")}</span>
        <p class="muted">${t("watch.signPl", { kind: mediaType === "tv" ? t("common.series") : t("common.movie") })}</p>
        <a class="btn btn-sm btn-primary" href="./login.html">Sign in</a>`;
      return;
    }
    const res = await supabaseRequest(
      `/rest/v1/playlists?owner_id=eq.${restValue(session.member_id)}&media_type=eq.${mediaType}&select=playlist_id,name,kind&order=created_at.asc`
    );
    const lists = res.ok && Array.isArray(res.data) ? res.data : [];
    if (!lists.length) {
      el.innerHTML = `
        <span class="eyebrow">${t("dash.nav.playlists")}</span>
        <p class="muted">${t("watch.noPl", { kind: mediaType === "tv" ? t("common.series") : t("common.movie") })}</p>
        <a class="btn btn-sm btn-primary" href="./dashboard.html">${t("watch.openDash")}</a>`;
      return;
    }
    el.innerHTML = `
      <span class="eyebrow">${t("dash.nav.playlists")}</span>
      <p class="muted">${t("watch.addList")}</p>
      <div class="playlist-add">
        <select id="pl-pick" aria-label="${t("watch.yourPl")}">
          ${lists.map((pl) => `<option value="${escapeHtml(pl.playlist_id)}">${escapeHtml(pl.name)}</option>`).join("")}
        </select>
        <button class="btn btn-sm btn-primary" id="pl-add" type="button">${t("watch.addTo")}</button>
      </div>`;
    $("#pl-add").onclick = async () => {
      const playlistId = $("#pl-pick").value;
      if (!playlistId) return;
      if (!(await window.CineAura.guardFeature("posts"))) return;
      const exists = await supabaseRequest(
        `/rest/v1/playlist_items?playlist_id=eq.${restValue(playlistId)}&tmdb_id=eq.${Number(mediaId)}&select=id`
      );
      if (exists.ok && exists.data?.[0]) {
        toast(t("watch.alreadyIn"));
        return;
      }
      const d = state.detail || {};
      const saved = await supabaseRequest("/rest/v1/playlist_items", {
        method: "POST",
        body: JSON.stringify({
          playlist_id: playlistId,
          tmdb_id: Number(mediaId),
          media_type: mediaType,
          title: d.title || d.name || "",
          poster_path: d.poster_path || "",
          visibility: "private",
        }),
      });
      if (!saved.ok) {
        toast(t("watch.addFail"));
        return;
      }
      toast(t("watch.added"));
    };
  }

  /* ---------- Tabs under the player: Comments · Recommend · Reviews · Playlists ---------- */
  const WATCH_TABS = ["comments", "recommend", "reviews", "playlists"];

  function tabLabel(tab) {
    if (tab === "recommend") return t("watch.rec.title", { kind: kindLabel() });
    if (tab === "reviews") return t("rev.reviews");
    if (tab === "playlists") return t("dash.nav.playlists");
    return t("watch.comments");
  }

  function splitList(value) {
    return String(value || "")
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function ageYears(birth) {
    if (!birth) return null;
    const d = new Date(birth);
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000)));
  }

  function tmdbIdsInText(value) {
    return String(value || "")
      .split(/[\n,;]+/)
      .map((raw) => {
        const s = raw.trim();
        const m = s.match(/themoviedb\.org\/(movie|tv|person)\/(\d+)/i);
        if (m) return Number(m[2]);
        return /^\d+$/.test(s) ? Number(s) : null;
      })
      .filter((n) => n != null);
  }

  // Everything the Reviews / Playlists tabs need about me: my member row, my
  // language, who I follow and what I have watched. Fetched once per page.
  async function viewerContext() {
    if (state.ctx) return state.ctx;
    const session = getSession();
    const ctx = {
      session,
      me: null,
      language: "",
      myUsername: String(session?.username || "").toLowerCase(),
      following: new Set(),
      watched: new Set(),
    };
    if (session?.member_id) {
      const [mem, prof, fol, hist, vw] = await Promise.all([
        supabaseRequest(
          `/rest/v1/members?member_id=eq.${restValue(session.member_id)}&select=username,gender,birth_date,country`
        ),
        supabaseRequest(
          `/rest/v1/profiles?member_id=eq.${restValue(session.member_id)}&select=language`
        ),
        supabaseRequest(
          `/rest/v1/follows?follower_id=eq.${restValue(session.member_id)}&status=eq.accepted&select=following_id`
        ),
        supabaseRequest(
          `/rest/v1/hestory?visitor_id=eq.${restValue(session.member_id)}&select=tmdb_id`
        ),
        supabaseRequest(
          `/rest/v1/views?viewer_id=eq.${restValue(session.member_id)}&select=tmdb_id`
        ),
      ]);
      ctx.me = mem.ok && Array.isArray(mem.data) ? mem.data[0] || null : null;
      ctx.language = String(prof.data?.[0]?.language || "").toLowerCase();
      (fol.data || []).forEach((r) => ctx.following.add(String(r.following_id)));
      [...(hist.data || []), ...(vw.data || [])].forEach((r) => ctx.watched.add(Number(r.tmdb_id)));
    }
    state.ctx = ctx;
    return ctx;
  }

  function isMine(row, ctx) {
    if (!ctx.session?.member_id) return false;
    if (row.owner_id && row.owner_id === ctx.session.member_id) return true;
    return Boolean(ctx.myUsername) && String(row.owner_username || "").toLowerCase() === ctx.myUsername;
  }

  // Only public posts, plus exclusive ones whose conditions apply to me. Private
  // posts never show up here — not even to somebody on their access list.
  function postVisibleToMe(post, ctx) {
    if (isMine(post, ctx)) return true;
    const vis = String(post.visibility || "public").toLowerCase();
    if (vis === "public") return true;
    if (vis !== "exclusive") return false;
    if (!ctx.session?.member_id || !ctx.me) return false;
    if (post.require_followers && !ctx.following.has(String(post.owner_id))) return false;
    const age = ageYears(ctx.me.birth_date);
    if (post.min_age && age != null && age < Number(post.min_age)) return false;
    if (post.max_age && age != null && age > Number(post.max_age)) return false;
    const langs = splitList(post.languages);
    if (langs.length && !langs.includes("all") && ctx.language && !langs.includes(ctx.language)) return false;
    const countries = splitList(post.countries);
    if (countries.length && !countries.includes(String(ctx.me.country || "").toLowerCase())) return false;
    const needed = [...tmdbIdsInText(post.watched_tmdb), ...tmdbIdsInText(post.titles)];
    if (needed.length && !needed.every((id) => ctx.watched.has(Number(id)))) return false;
    return true;
  }

  // Same rule for playlists: public, or exclusive with conditions that match.
  // Private lists stay out of this tab (my own lists are the exception).
  function playlistVisibleToMe(pl, ctx, accessNames) {
    if (isMine(pl, ctx)) return true;
    const vis = String(pl.visibility || "private").toLowerCase();
    if (vis === "public") return true;
    if (vis === "private") return false;
    if (vis !== "exclusive") return false;
    if (!ctx.session?.member_id) return false;
    if (pl.require_member && !ctx.session.member_id) return false;
    if (pl.require_followers && !ctx.following.has(String(pl.owner_id))) return false;
    const countries = splitList(pl.countries);
    if (countries.length && !countries.includes(String(ctx.me?.country || "").toLowerCase())) return false;
    if (pl.gender && pl.gender !== "any" && String(ctx.me?.gender || "") !== pl.gender) return false;
    if (pl.max_age) {
      const age = ageYears(ctx.me?.birth_date);
      if (age == null || age > Number(pl.max_age)) return false;
    }
    return Boolean(ctx.session?.member_id);
  }

  function visibilityChip(value) {
    const vis = String(value || "public").toLowerCase();
    const label = vis === "private" ? t("common.private") : vis === "exclusive" ? t("common.exclusive") : t("common.public");
    return `<span class="chip vis-chip vis-${escapeHtml(vis)}">${escapeHtml(label)}</span>`;
  }

  async function renderWatchTab(tab) {
    if (tab === "recommend") return renderRecommend(true);
    if (tab === "reviews") return renderReviews();
    if (tab === "playlists") return renderTitlePlaylists();
    return renderComments();
  }

  // The tab bar itself; the active panel is the only one that draws its content.
  async function renderSocialTabs() {
    const shell = $("#watch-social");
    const bar = $("#watch-tabs");
    if (!shell || !bar) return;
    shell.hidden = false;
    if (!WATCH_TABS.includes(state.watchTab)) state.watchTab = "comments";
    bar.innerHTML = WATCH_TABS.map((tab) => {
      const active = state.watchTab === tab;
      return `<button class="btn btn-sm ${active ? "btn-primary" : "btn-ghost"}" data-wtab="${tab}" type="button" role="tab" aria-selected="${active ? "true" : "false"}">${escapeHtml(tabLabel(tab))}</button>`;
    }).join("");
    WATCH_TABS.forEach((tab) => {
      const panel = $(`#panel-${tab}`);
      if (panel) panel.hidden = tab !== state.watchTab;
    });
    bar.onclick = (e) => {
      const btn = e.target.closest("[data-wtab]");
      if (!btn || btn.dataset.wtab === state.watchTab) return;
      state.watchTab = btn.dataset.wtab;
      renderSocialTabs();
    };
    await renderWatchTab(state.watchTab);
  }

  /* ---------- Reviews that mention this title ---------- */
  async function renderReviews() {
    const el = $("#watch-reviews");
    if (!el) return;
    const kind = kindLabel();
    el.innerHTML = `<p class="muted">${t("common.loading")}</p>`;
    const ctx = await viewerContext();
    const itemsRes = await supabaseRequest(
      `/rest/v1/post_items?tmdb_id=eq.${Number(mediaId)}&media_type=eq.${mediaType}&select=post_id`
    );
    const ids = [...new Set((itemsRes.data || []).map((r) => r.post_id).filter(Boolean))];
    const empty = `<p class="muted">${t("watch.noReviews", { kind })}</p>`;
    if (!ids.length) {
      el.innerHTML = empty;
      return;
    }
    const postsRes = await supabaseRequest(
      `/rest/v1/posts?post_id=in.(${ids.join(",")})&kind=eq.review&select=*&order=created_at.desc&limit=40`
    );
    const posts = (postsRes.data || []).filter(
      (p) => postVisibleToMe(p, ctx) && !ownerBlocks("updates", p.owner_id, p.owner_username)
    );
    if (!posts.length) {
      el.innerHTML = empty;
      return;
    }
    const idList = posts.map((p) => p.post_id).join(",");
    const votesRes = await supabaseRequest(
      `/rest/v1/post_votes?post_id=in.(${idList})&select=post_id,vote`
    );
    const votes = {};
    (votesRes.data || []).forEach((v) => {
      votes[v.post_id] = votes[v.post_id] || { up: 0, down: 0 };
      votes[v.post_id][v.vote] = (votes[v.post_id][v.vote] || 0) + 1;
    });
    el.innerHTML = `
      <p class="muted">${t("watch.reviewsLead", { kind })}</p>
      <div class="review-wall">${posts
        .map((p) => {
          const c = votes[p.post_id] || { up: 0, down: 0 };
          const dest = p.playlist_id
            ? `./Playlist.html?ID=${encodeURIComponent(p.playlist_id)}`
            : memberProfileHref(p.owner_username);
          return `<article class="review-wall-card" data-post="${escapeHtml(p.post_id)}">
            <div class="review-wall-head">
              <strong><a href="${memberProfileHref(p.owner_username)}">@${escapeHtml(p.owner_username || "member")}</a></strong>
              <span class="muted">${escapeHtml(commentDate(p.created_at))}</span>
              ${visibilityChip(p.visibility)}
            </div>
            <h3>${escapeHtml(p.title || "")}</h3>
            <p class="review-wall-body">${escapeHtml(p.body || "")}</p>
            ${Rich() ? Rich().reviewListsHtml(p.pros, p.cons) : ""}
            <div class="review-wall-foot">
              <span class="chip">${t("prof.recommendBtn", { n: c.up })}</span>
              <span class="chip">${t("prof.dont", { n: c.down })}</span>
              <a class="btn btn-sm btn-ghost" href="${dest}">${t("watch.openOnProfile")}</a>
            </div>
          </article>`;
        })
        .join("")}</div>`;
  }

  /* ---------- Playlists (by other members) that include this title ---------- */
  async function renderTitlePlaylists() {
    const el = $("#watch-playlists");
    if (!el) return;
    const kind = kindLabel();
    el.innerHTML = `<p class="muted">${t("common.loading")}</p>`;
    const ctx = await viewerContext();
    const itemsRes = await supabaseRequest(
      `/rest/v1/playlist_items?tmdb_id=eq.${Number(mediaId)}&media_type=eq.${mediaType}&select=playlist_id`
    );
    const ids = [...new Set((itemsRes.data || []).map((r) => r.playlist_id).filter(Boolean))];
    const empty = `<p class="muted">${t("watch.noPlaylists", { kind })}</p>`;
    if (!ids.length) {
      el.innerHTML = empty;
      return;
    }
    const [plsRes, accRes] = await Promise.all([
      supabaseRequest(
        `/rest/v1/playlists?playlist_id=in.(${ids.join(",")})&select=*&order=created_at.desc&limit=40`
      ),
      supabaseRequest(`/rest/v1/playlist_access?playlist_id=in.(${ids.join(",")})&select=playlist_id,username`),
    ]);
    const access = {};
    (accRes.data || []).forEach((a) => {
      (access[a.playlist_id] = access[a.playlist_id] || []).push(a.username);
    });
    // Only lists built by other members: my own playlists live in the dashboard.
    const rows = (plsRes.data || []).filter(
      (pl) =>
        !isMine(pl, ctx) &&
        playlistVisibleToMe(pl, ctx, access[pl.playlist_id] || []) &&
        !ownerBlocks("playlists", pl.owner_id, pl.owner_username)
    );
    if (!rows.length) {
      el.innerHTML = empty;
      return;
    }
    const counts = {};
    const cntRes = await supabaseRequest(
      `/rest/v1/playlist_items?playlist_id=in.(${rows.map((r) => r.playlist_id).join(",")})&select=playlist_id`
    );
    (cntRes.data || []).forEach((r) => {
      counts[r.playlist_id] = (counts[r.playlist_id] || 0) + 1;
    });
    el.innerHTML = `
      <p class="muted">${t("watch.playlistsLead", { kind })}</p>
      <div class="watch-playlist-list">${rows
        .map(
          (pl) => `<article class="watch-playlist-row">
            <div>
              <strong><a href="./Playlist.html?ID=${encodeURIComponent(pl.playlist_id)}">${escapeHtml(pl.name || pl.playlist_id)}</a></strong>
              <div class="muted">${escapeHtml(t("watch.by", { name: pl.owner_username || "member" }))} · ${escapeHtml(
                Number(counts[pl.playlist_id] || 0) === 1
                  ? t("watch.itemsCountOne")
                  : t("watch.itemsCount", { n: Number(counts[pl.playlist_id] || 0) })
              )}</div>
              ${pl.description ? `<p class="muted">${escapeHtml(pl.description)}</p>` : ""}
            </div>
            <div class="watch-playlist-side">
              ${visibilityChip(pl.visibility)}
              <a class="btn btn-sm btn-ghost" href="./Playlist.html?ID=${encodeURIComponent(pl.playlist_id)}">${t("watch.openPlaylist")}</a>
            </div>
          </article>`
        )
        .join("")}</div>`;
  }

  /* ---------- Recommend this title on your profile ---------- */
  const Rich = () => window.CineAuraRich;

  function kindLabel() {
    return mediaType === "tv" ? t("common.series") : t("common.movie");
  }

  function newPostId() {
    return `P${Math.floor(100000000 + Math.random() * 900000000)}`;
  }

  async function loadMyRecLists() {
    const session = getSession();
    if (!session?.member_id) return [];
    const res = await supabaseRequest(
      `/rest/v1/posts?owner_id=eq.${restValue(session.member_id)}&kind=eq.reclist&select=post_id,title&order=created_at.desc`
    );
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  // TMDB snapshot row for public.post_items (rich columns when the schema has them).
  async function addItemRow(postId) {
    const info = await Rich().details(mediaType, mediaId);
    const row = { ...Rich().toItemRow(info), post_id: postId };
    const full = await supabaseRequest("/rest/v1/post_items", { method: "POST", body: JSON.stringify(row) });
    if (full.ok) return true;
    const base = await supabaseRequest("/rest/v1/post_items", {
      method: "POST",
      body: JSON.stringify(Rich().baseItemRow(row)),
    });
    return base.ok;
  }

  // Publishes a recommendation / recommendation-list post on the member profile.
  async function publishRecPost(kind, title, body) {
    const session = getSession();
    if (!(await window.CineAura.guardFeature("posts"))) return { ok: false, blocked: true };
    const postId = newPostId();
    const saved = await supabaseRequest("/rest/v1/posts", {
      method: "POST",
      body: JSON.stringify({
        post_id: postId,
        owner_id: session.member_id,
        owner_username: session.username,
        kind,
        title,
        body,
        visibility: "public",
      }),
    });
    if (!saved.ok) {
      toast(t("watch.rec.fail"));
      return { ok: false };
    }
    const added = await addItemRow(postId);
    await supabaseRequest("/rest/v1/updates", {
      method: "POST",
      body: JSON.stringify({
        actor_id: session.member_id,
        actor_username: session.username,
        kind: "post",
        post_id: postId,
      }),
    });
    await window.CineAura.notifyFollowers({
      ownerId: session.member_id,
      username: session.username,
      title: t("prof.newPost"),
      body: t("prof.updLinePost", {
        actor: `@${session.username}`,
        noun: kind === "reclist" ? t("prof.updNounRecList") : t("prof.updNounRec"),
        post: `«${title}»`,
      }),
      href: window.CineAura.profileHref(session.username),
      visibility: "public",
    });
    return { ok: true, postId, added };
  }

  /* --- Popup layer: the three options are buttons, their fields are inside --- */
  const REC_TITLES = {
    post: "watch.rec.tabPost",
    list: "watch.rec.tabList",
    existing: "watch.rec.tabExisting",
  };

  const REC_ACTIONS = (go) => `
      <div class="rec-modal-actions">
        <button class="btn btn-sm btn-primary" type="button" id="rec-go">${go}</button>
        <button class="btn btn-sm btn-ghost" type="button" id="rec-cancel">${t("common.cancel")}</button>
      </div>`;

  function closeRecModal() {
    document.removeEventListener("keydown", onRecModalKey);
    $("#rec-modal")?.remove();
  }

  function onRecModalKey(e) {
    if (e.key === "Escape") closeRecModal();
  }

  /* --- What other members recommend about this title --- */
  // Public recommendations, plus exclusive ones whose conditions apply to me,
  // that carry this title — recommended on its own or held in a recommendation
  // list. Private posts stay out, exactly like the Reviews tab.
  async function titleRecommendations() {
    try {
      const ctx = await viewerContext();
      const hitRes = await supabaseRequest(
        `/rest/v1/post_items?tmdb_id=eq.${Number(mediaId)}&media_type=eq.${mediaType}&select=post_id`
      );
      const hits = Array.isArray(hitRes.data) ? hitRes.data : [];
      const ids = [...new Set(hits.map((r) => r.post_id).filter(Boolean))];
      if (!ids.length) return [];
      const postsRes = await supabaseRequest(
        `/rest/v1/posts?post_id=in.(${ids.join(",")})&kind=in.(recommendation,reclist)&select=*&order=created_at.desc&limit=60`
      );
      const posts = (Array.isArray(postsRes.data) ? postsRes.data : []).filter(
        (p) => postVisibleToMe(p, ctx) && !ownerBlocks("updates", p.owner_id, p.owner_username)
      );
      if (!posts.length) return [];
      const list = posts.map((p) => p.post_id).join(",");
      const [itemsRes, votesRes] = await Promise.all([
        supabaseRequest(
          `/rest/v1/post_items?post_id=in.(${list})&select=post_id,tmdb_id,media_type,title,poster_path&order=id.asc`
        ),
        supabaseRequest(`/rest/v1/post_votes?post_id=in.(${list})&select=post_id,vote`),
      ]);
      const items = {};
      (Array.isArray(itemsRes.data) ? itemsRes.data : []).forEach((r) => {
        (items[r.post_id] = items[r.post_id] || []).push(r);
      });
      const ups = {};
      (Array.isArray(votesRes.data) ? votesRes.data : []).forEach((v) => {
        if (v.vote !== "up") return;
        ups[v.post_id] = (ups[v.post_id] || 0) + 1;
      });
      return posts.map((p) => ({
        post: p,
        items: items[p.post_id] || [],
        up: ups[p.post_id] || 0,
      }));
    } catch {
      return [];
    }
  }

  // Poster strip: the other titles a recommendation (list) holds, so the card
  // shows what this title was recommended next to.
  function recOthersHtml(items) {
    const others = (items || []).filter((it) => Number(it.tmdb_id) !== Number(mediaId));
    if (!others.length) return "";
    const shown = others.slice(0, 8);
    const rest = others.length - shown.length;
    return `<div class="rec-others">
      <span class="rec-others-label">${t("watch.rec.moreTitles")}</span>
      <div class="rec-others-row">${shown
        .map((it) => {
          const src = photo(it.poster_path, it.title || "");
          // A post can also hold a person; that one opens the Cast page.
          const href =
            it.media_type === "person"
              ? personHref(it.tmdb_id)
              : watchHref(it.media_type === "tv" ? "tv" : "movie", it.tmdb_id, null, null, "");
          return `<a class="rec-thumb" href="${href}" title="${escapeHtml(it.title || "")}"><img src="${escapeHtml(src)}" alt="" loading="lazy" /></a>`;
        })
        .join("")}${rest > 0 ? `<span class="rec-others-more">+${rest}</span>` : ""}</div>
    </div>`;
  }

  function recCardHtml(entry) {
    const p = entry.post;
    const items = entry.items || [];
    const isList = p.kind === "reclist";
    const dest = memberProfileHref(p.owner_username);
    const count = items.length;
    return `<article class="review-wall-card rec-card" data-post="${escapeHtml(p.post_id)}">
      <div class="review-wall-head">
        <strong><a href="${dest}">@${escapeHtml(p.owner_username || "member")}</a></strong>
        <span class="muted">${escapeHtml(commentDate(p.created_at))}</span>
        <span class="chip">${escapeHtml(isList ? t("prof.recList") : t("prof.recs"))}</span>
        ${visibilityChip(p.visibility)}
      </div>
      <h3>${escapeHtml(p.title || "")}</h3>
      <p class="review-wall-body">${escapeHtml(p.body || "")}</p>
      ${recOthersHtml(items)}
      <div class="review-wall-foot">
        <span class="chip">${t("prof.recommendBtn", { n: entry.up })}</span>
        ${count ? `<span class="chip">${escapeHtml(count === 1 ? t("watch.itemsCountOne") : t("watch.itemsCount", { n: count }))}</span>` : ""}
        <a class="btn btn-sm btn-ghost" href="${dest}">${t("watch.openOnProfile")}</a>
      </div>
    </article>`;
  }

  // The wall itself: every recommendation of this title the viewer may read.
  async function recWallHtml() {
    const kind = kindLabel();
    const head = `<h3 class="rec-wall-title">${t("watch.rec.wallTitle")}</h3>
      <p class="muted">${t("watch.rec.wallLead", { kind })}</p>`;
    const entries = await titleRecommendations();
    if (!entries.length) {
      return `<div class="rec-wall">${head}<p class="muted">${t("watch.rec.none", { kind })}</p></div>`;
    }
    return `<div class="rec-wall">${head}<div class="review-wall">${entries.map(recCardHtml).join("")}</div></div>`;
  }

  // The tab: publish a recommendation of my own, and read the ones members
  // already made about this title.
  // embedded = true when the panel lives inside a tab (the tab already names it,
  // so the repeated eyebrow + heading are dropped).
  async function renderRecommend(embedded = false) {
    const el = $("#watch-recommend");
    if (!el || !state.detail) return;
    el.hidden = false;
    const d = state.detail;
    const title = d.title || d.name || "";
    const kind = kindLabel();
    const session = getSession();
    const head = embedded
      ? ""
      : `<span class="eyebrow">${t("watch.rec.eyebrow")}</span>
        <h2>${t("watch.rec.title", { kind })}</h2>`;
    let publish;
    if (!session?.member_id) {
      publish = `<p class="muted">${t("watch.rec.signIn", { kind })}</p>
        <a class="btn btn-sm btn-primary" href="./login.html">${t("common.signin")}</a>`;
    } else if (!window.CineAuraRich) {
      publish = `<p class="muted">${t("watch.rec.fail")}</p>`;
    } else {
      const myProfile = window.CineAura.profileHref(session.username);
      const done = state.recDone
        ? `<p class="rec-done">✓ ${escapeHtml(state.recDone)} <a href="${escapeHtml(myProfile)}">${t("watch.rec.viewProfile")}</a></p>`
        : "";
      publish = `<p class="muted">${t("watch.rec.lead", { title: escapeHtml(title), kind })}</p>
        <div class="rec-buttons">
          <button class="btn btn-sm btn-ghost" type="button" data-rec-open="post">${t("watch.rec.tabPost")}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-rec-open="list">${t("watch.rec.tabList")}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-rec-open="existing">${t("watch.rec.tabExisting")}</button>
        </div>
        ${done}
        <p class="muted rec-hint">${t("watch.rec.pick")}</p>`;
    }
    // The buttons need no network, the wall does: draw them first, then fill the
    // slot under them when the recommendations arrive.
    el.innerHTML = `${head}<div class="rec-publish">${publish}</div><div class="rec-wall-slot"><p class="muted">${t("common.loading")}</p></div>`;
    el.querySelectorAll("[data-rec-open]").forEach((b) => {
      b.onclick = () => openRecModal(b.dataset.recOpen);
    });
    const token = (state.recToken = (state.recToken || 0) + 1);
    const wall = await recWallHtml();
    // A newer render (tab switch, new episode) may have taken over meanwhile.
    if (state.recToken !== token) return;
    const slot = el.querySelector(".rec-wall-slot");
    if (slot) slot.innerHTML = wall;
  }

  // Popup shell shared by the three options; each one draws its fields into
  // #rec-body, so the watch page itself keeps nothing but the buttons.
  function recModal(head, sub) {
    closeRecModal();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "rec-modal";
    overlay.innerHTML = `
      <section class="glass modal-card rec-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(head)}">
        <header class="rec-modal-head">
          <div>
            <span class="eyebrow">${t("watch.rec.eyebrow")}</span>
            <h2>${escapeHtml(head)}</h2>
          </div>
          <button class="rec-modal-x" type="button" id="rec-x" aria-label="${t("common.close")}">&times;</button>
        </header>
        <p class="rec-modal-sub">${sub}</p>
        <div class="stack rec-form" id="rec-body">
          <p class="muted">${t("common.loading")}</p>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    // Delegated: the form (and its Cancel button) is drawn right after the shell.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("#rec-x") || e.target.closest("#rec-cancel")) closeRecModal();
    });
    document.addEventListener("keydown", onRecModalKey);
  }

  function openRecModal(kind) {
    const d = state.detail || {};
    const title = d.title || d.name || "";
    const head = t(REC_TITLES[kind] || REC_TITLES.post);
    const sub = `<span class="chip">${escapeHtml(kindLabel())}</span> <strong>${escapeHtml(title)}</strong>`;
    recModal(head, sub);
    if (kind === "list") drawRecListForm();
    else if (kind === "existing") drawRecExistingForm();
    else drawRecPostForm(title);
  }

  /* --- Publish a recommendation on my profile --- */
  function drawRecPostForm(title) {
    const body = $("#rec-body");
    body.innerHTML = `
      <label class="field-label" for="rec-title">${t("prof.postTitle")}</label>
      <input id="rec-title" value="${escapeHtml(title)}" />
      <label class="field-label" for="rec-text">${t("rich.textLabel")}</label>
      <textarea id="rec-text" rows="4" placeholder="${t("watch.rec.textPh")}"></textarea>
      ${REC_ACTIONS(t("watch.rec.publish"))}`;
    // The title is already filled in, so the cursor goes where typing is needed.
    $("#rec-text").focus();
    $("#rec-go").onclick = async (e) => {
      const head = $("#rec-title").value.trim();
      const text = $("#rec-text").value.trim();
      if (!head || !text) return toast(t("watch.rec.needText"));
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await publishRecPost("recommendation", head, text);
      btn.disabled = false;
      if (!res.ok) return;
      state.recDone = res.added ? t("watch.rec.published") : t("watch.rec.publishedNoItem");
      closeRecModal();
      renderWatchTab("recommend");
    };
  }

  /* --- New recommendation list, filled with this title --- */
  function drawRecListForm() {
    const body = $("#rec-body");
    body.innerHTML = `
      <label class="field-label" for="rec-list-name">${t("watch.rec.listName")}</label>
      <input id="rec-list-name" placeholder="${t("watch.rec.listNamePh")}" />
      <label class="field-label" for="rec-list-text">${t("watch.rec.listText")}</label>
      <textarea id="rec-list-text" rows="3" placeholder="${t("watch.rec.listTextPh")}"></textarea>
      <label class="field-label" for="rec-list-type">${t("watch.rec.listType")}</label>
      <select id="rec-list-type">
        <option value="movie"${mediaType === "movie" ? " selected" : ""}>${t("common.movie")}</option>
        <option value="tv"${mediaType === "tv" ? " selected" : ""}>${t("common.series")}</option>
      </select>
      <p class="muted">${t("watch.rec.typeHint", { kind: kindLabel() })}</p>
      ${REC_ACTIONS(t("watch.rec.createList", { kind: kindLabel() }))}`;
    $("#rec-list-name").focus();
    $("#rec-go").onclick = async (e) => {
      const name = $("#rec-list-name").value.trim();
      const text = $("#rec-list-text").value.trim();
      const type = $("#rec-list-type").value;
      if (!name || !text) return toast(t("watch.rec.needName"));
      if (type !== mediaType) {
        return toast(
          t("watch.rec.typeMismatch", {
            want: type === "tv" ? t("common.series") : t("common.movie"),
            have: kindLabel(),
          })
        );
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await publishRecPost("reclist", name, text);
      btn.disabled = false;
      if (!res.ok) return;
      toast(t("watch.rec.listCreated"));
      state.recDone = t("watch.rec.listCreatedNamed", { list: name });
      closeRecModal();
      renderWatchTab("recommend");
    };
  }

  /* --- Add this title to a list that already exists --- */
  async function drawRecExistingForm() {
    const lists = await loadMyRecLists();
    const body = $("#rec-body");
    // The lists arrive after a request: skip the redraw if the popup was closed.
    if (!body) return;
    if (!lists.length) {
      body.innerHTML = `
        <p class="muted">${t("watch.rec.noLists")}</p>
        ${REC_ACTIONS(t("watch.rec.tabList"))}`;
      $("#rec-go").onclick = () => drawRecListForm();
      return;
    }
    body.innerHTML = `
      <label class="field-label" for="rec-pick">${t("watch.rec.pickList")}</label>
      <select id="rec-pick">
        ${lists
          .map((p) => `<option value="${escapeHtml(p.post_id)}">${escapeHtml(p.title || p.post_id)}</option>`)
          .join("")}
      </select>
      <p class="muted">${t("watch.addList")}</p>
      ${REC_ACTIONS(t("watch.addTo"))}`;
    $("#rec-go").onclick = async (e) => {
      const picked = $("#rec-pick").value;
      if (!picked) return;
      if (!(await window.CineAura.guardFeature("posts"))) return;
      const dup = await supabaseRequest(
        `/rest/v1/post_items?post_id=eq.${restValue(picked)}&tmdb_id=eq.${Number(mediaId)}&select=id`
      );
      if (dup.ok && dup.data?.[0]) return toast(t("watch.rec.already"));
      const btn = e.currentTarget;
      btn.disabled = true;
      const ok = await addItemRow(picked);
      btn.disabled = false;
      if (!ok) return toast(t("watch.rec.fail"));
      const name = lists.find((p) => p.post_id === picked)?.title || "";
      state.recDone = t("watch.rec.addedTo", { list: name });
      toast(t("watch.rec.added"));
      closeRecModal();
      renderWatchTab("recommend");
    };
  }

  const REPORT_SUBJECTS = [
    { id: "misleading", labelKey: "watch.rpt.misleading", hintKey: "watch.hint.misleading" },
    { id: "broken", labelKey: "watch.rpt.broken", hintKey: "watch.hint.broken" },
    { id: "malicious", labelKey: "watch.rpt.malicious", hintKey: "watch.hint.malicious" },
    { id: "stolen", labelKey: "watch.rpt.stolen", hintKey: "watch.hint.stolen" },
    { id: "bad", labelKey: "watch.rpt.bad", hintKey: "watch.hint.bad" },
    { id: "indirect", labelKey: "watch.rpt.indirect", hintKey: "watch.hint.indirect" },
  ];

  function decodeDataUrl(value) {
    try {
      return decodeURIComponent(value || "");
    } catch {
      return value || "";
    }
  }

  function closeReportModal() {
    $("#report-overlay")?.remove();
  }

  async function banLinkIfNeeded(watchUrl) {
    const count = await supabaseRequest(
      `/rest/v1/reportlinks?tmdb_id=eq.${Number(mediaId)}&watch_url=eq.${restValue(watchUrl)}&verdict=eq.valid&select=id`
    );
    const n = count.ok && Array.isArray(count.data) ? count.data.length : 0;
    if (n < 10) return n;
    const table = mediaType === "tv" ? "tvlink" : "movielink";
    await supabaseRequest(
      `/rest/v1/${table}?tmdb_id=eq.${Number(mediaId)}&watch_url=eq.${restValue(watchUrl)}`,
      { method: "PATCH", body: JSON.stringify({ banned: true }) }
    );
    return n;
  }

  async function submitLinkReport(row, subject) {
    const session = getSession();
    if (!session?.member_id) {
      toast(t("watch.signReport"));
      return false;
    }
    if (featureBlocked("reports")) {
      toast(t("panel.featBlockedMsg", { feature: t("panel.feat.reports") }));
      return false;
    }
    if (row.member_id === session.member_id) {
      toast(t("watch.ownReport"));
      return false;
    }
    const dup = await supabaseRequest(
      `/rest/v1/reportlinks?reporter_id=eq.${restValue(session.member_id)}&tmdb_id=eq.${Number(mediaId)}&watch_url=eq.${restValue(row.watch_url)}&select=id`
    );
    if (dup.ok && dup.data?.[0]) {
      toast(t("watch.alreadyRpt"));
      return false;
    }
    const now = new Date().toISOString();
    const saved = await supabaseRequest("/rest/v1/reportlinks", {
      method: "POST",
      body: JSON.stringify({
        reported_at: now,
        subject,
        watch_url: row.watch_url,
        media_type: mediaType,
        tmdb_id: Number(mediaId),
        owner_id: row.member_id,
        verdict: "valid",
        verdict_at: now,
        reporter_id: session.member_id,
        link_id: row.id || null,
      }),
    });
    if (!saved.ok) {
      toast(t("watch.rptFail"));
      return false;
    }
    const n = await banLinkIfNeeded(row.watch_url);
    toast(n >= 10 ? t("watch.rptHidden") : t("watch.rptOk"));
    return true;
  }

  function openReportModal(row) {
    closeReportModal();
    const session = getSession();
    if (!session?.member_id) {
      toast(t("watch.signReport"));
      return;
    }
    if (row.member_id === session.member_id) {
      toast(t("watch.ownReport"));
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "report-overlay";
    overlay.id = "report-overlay";
    overlay.innerHTML = `
      <section class="glass report-card">
        <span class="eyebrow">${t("watch.report")}</span>
        <h2>${t("watch.why")}</h2>
        <p class="muted">${escapeHtml(linkHost(row.watch_url))} · @${escapeHtml(row.username || "member")}</p>
        <select id="report-subject">
          ${REPORT_SUBJECTS.map((s) => `<option value="${s.id}">${escapeHtml(t(s.labelKey))} — ${escapeHtml(t(s.hintKey))}</option>`).join("")}
        </select>
        <div class="link-actions">
          <button class="btn btn-sm btn-primary" id="report-send" type="button">${t("watch.submitRpt")}</button>
          <button class="btn btn-sm btn-ghost" id="report-cancel" type="button">${t("common.cancel")}</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeReportModal();
    });
    $("#report-cancel").onclick = closeReportModal;
    $("#report-send").onclick = async () => {
      const ok = await submitLinkReport(row, $("#report-subject").value);
      if (ok) {
        closeReportModal();
        renderLinks();
      }
    };
  }

  async function loadSocialGates() {
    state.blocksAgainstMe = [];
    const session = getSession();
    if (!session?.member_id) return;
    const res = await supabaseRequest(
      `/rest/v1/blocks?blocked_id=eq.${restValue(session.member_id)}&select=blocker_id,blocker_username,kind,features`
    );
    state.blocksAgainstMe = res.ok && Array.isArray(res.data) ? res.data : [];
  }

  function ownerBlocks(feature, ownerId, ownerUsername) {
    const rows = state.blocksAgainstMe || [];
    const hit = rows.find(
      (x) =>
        (ownerId && x.blocker_id === ownerId) ||
        (ownerUsername && x.blocker_username === ownerUsername)
    );
    if (!hit) return false;
    if (hit.kind === "full") return true;
    if (feature === "replies") return false;
    return String(hit.features || "")
      .split(",")
      .map((s) => s.trim())
      .includes(feature);
  }

  function memberProfileHref(username) {
    const name = String(username || "").replace(/^@/, "").trim();
    return name ? `./Profile.html?@${encodeURIComponent(name)}` : "./Profile.html";
  }

  async function renderLinks() {
    const el = $("#watch-links");
    if (!el) return;
    el.hidden = false;
    const epLabel = mediaType === "tv" ? ` for S${state.season} · E${state.episode}` : "";
    const session = getSession();
    el.innerHTML = `
      <span class="eyebrow">${t("watch.links")}</span>
      <h2>${t("watch.links")}</h2>
      <p class="muted">${t("watch.linksLead", { ep: epLabel })}</p>
      <div class="link-list" id="link-list"><p class="muted">Loading…</p></div>`;
    const res =
      mediaType === "movie"
        ? await supabaseRequest(
            `/rest/v1/movielink?tmdb_id=eq.${Number(mediaId)}&select=*&order=added_at.desc`
          )
        : await supabaseRequest(
            `/rest/v1/tvlink?tmdb_id=eq.${Number(mediaId)}&season=eq.${Number(state.season)}&episode=eq.${Number(state.episode)}&select=*&order=added_at.desc`
          );
    if (res?.data?.code === "PGRST205") {
      $("#link-list").innerHTML = `<p class="muted">${t("watch.missingLinks")}</p>`;
      return;
    }
    let rows = res.ok && Array.isArray(res.data) ? res.data : [];
    rows = rows.filter((row) => {
      const until = row.ban_until ? Date.parse(row.ban_until) : 0;
      const blocked = row.banned || until > Date.now();
      return !blocked || row.member_id === session?.member_id;
    });
    rows = rows.filter((row) => {
      if (!row.member_id || row.member_id === session?.member_id) return true;
      return !ownerBlocks("links", row.member_id, row.username);
    });
    const list = $("#link-list");
    if (!rows.length) {
      list.innerHTML = `<p class="muted">${t("watch.noLinks", { ep: epLabel })}</p>`;
      return;
    }
    list.innerHTML = rows
      .map((row, index) => {
        const url = String(row.watch_url || "");
        const when = String(row.added_at || "").slice(0, 10) || "—";
        const quality = row.quality || "—";
        const original = row.original_language || "—";
        const subs = row.has_subtitles
          ? row.subtitle_languages === "all"
            ? t("watch.subsAll")
            : t("watch.subsYes", { langs: row.subtitle_languages || t("common.yes") })
          : t("watch.noSubs");
        return `
          <article class="link-row ${row.banned ? "banned" : ""}" data-link-index="${index}">
            <div>
              <strong><a href="${memberProfileHref(row.username)}">@${escapeHtml(row.username || "member")}</a></strong>
              <div class="muted">${escapeHtml(linkHost(url))} · ${escapeHtml(when)}${row.banned ? " · " + t("watch.hiddenOthers") : ""}</div>
            </div>
            <div class="link-tags">
              <span class="chip">${escapeHtml(quality)}</span>
              <span class="chip">${escapeHtml(original)}</span>
              <span class="chip">${escapeHtml(subs)}</span>
            </div>
            <div class="link-actions">
              <button class="btn btn-sm btn-primary" type="button" data-play="${encodeURIComponent(url)}" data-owner="${escapeHtml(row.member_id || "")}">${t("watch.play")}</button>
              <button class="btn btn-sm btn-ghost" type="button" data-report="${index}">${t("watch.report")}</button>
            </div>
          </article>`;
      })
      .join("");
    list.onclick = (e) => {
      const play = e.target.closest("[data-play]");
      const report = e.target.closest("[data-report]");
      if (play) {
        playMemberLink(decodeDataUrl(play.dataset.play), play.dataset.owner || "");
        $$(".link-row").forEach((card) => {
          card.classList.toggle("on", card.contains(play));
        });
        return;
      }
      if (report) {
        const row = rows[Number(report.dataset.report)];
        if (row) openReportModal(row);
      }
    };
  }

  function commentDate(value) {
    const raw = String(value || "");
    return raw.slice(0, 16).replace("T", " ") || "—";
  }

  function publicCommentId(row) {
    if (row?.comment_id) return row.comment_id;
    const n = row?.id;
    if (!n) return "";
    return `${row.comment_type === "reply" ? "R" : "C"}${n}`;
  }

  async function nextCommentCode(kind) {
    const prefix = kind === "reply" ? "R" : "C";
    for (let i = 0; i < 10; i++) {
      const code = `${prefix}${Math.floor(100000000 + Math.random() * 900000000)}`;
      const check = await supabaseRequest(
        `/rest/v1/comments?comment_id=eq.${restValue(code)}&select=id`
      );
      if (!check.data?.[0]) return code;
    }
    return `${prefix}${Date.now()}`;
  }

  async function postComment({ text, commentType, parentCommentId }) {
    const session = getSession();
    if (!session?.member_id) {
      toast(t("watch.signCmtToast"));
      return false;
    }
    if (featureBlocked("comments")) {
      toast(t("panel.featBlockedMsg", { feature: t("panel.feat.comments") }));
      return false;
    }
    const body = String(text || "").trim();
    if (!body) {
      toast(t("watch.writeFirst"));
      return false;
    }
    if (commentType === "reply" && parentCommentId) {
      const parent = await supabaseRequest(
        `/rest/v1/comments?comment_id=eq.${restValue(parentCommentId)}&select=member_id,username`
      );
      const row = parent.data?.[0];
      if (row && ownerBlocks("replies", row.member_id, row.username)) {
        toast(t("watch.noReply"));
        return false;
      }
    }
    const commentId = await nextCommentCode(commentType);
    const payload = {
      idtmdb: Number(mediaId),
      type: mediaType,
      username: session.username || session.full_name || "member",
      member_id: session.member_id,
      comment: body,
      comment_type: commentType,
      comment_id: commentId,
      parent_comment_id: parentCommentId || null,
    };
    let saved = await supabaseRequest("/rest/v1/comments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!saved.ok) {
      const { comment_id, parent_comment_id, ...fallback } = payload;
      saved = await supabaseRequest("/rest/v1/comments", {
        method: "POST",
        body: JSON.stringify({ ...fallback, parent_id: parentCommentId || null }),
      });
    }
    if (!saved.ok) {
      toast(t("watch.postFail"));
      return false;
    }
    toast(commentType === "reply" ? t("watch.replyPosted", { id: commentId }) : t("watch.cmtPosted", { id: commentId }));
    await renderComments();
    return true;
  }

  async function renderComments() {
    const el = $("#watch-comments");
    if (!el) return;
    el.hidden = false;
    const session = getSession();
    el.innerHTML = `
      <span class="eyebrow">${t("watch.comments")}</span>
      <h2>${t("watch.comments")}</h2>
      <p class="muted">${t("watch.cmtLead", { kind: mediaType === "tv" ? t("common.series") : t("common.movie") })}</p>
      ${
        session?.member_id
          ? `<div class="comment-form">
              <textarea id="comment-text" placeholder="${t("watch.shareTake")}" maxlength="2000"></textarea>
              <button class="btn btn-sm btn-primary" id="comment-post" type="button">${t("watch.comment")}</button>
            </div>`
          : `<p class="muted">${t("watch.signCmt")} <a href="./login.html">${t("common.signin")}</a></p>`
      }
      <div class="comment-list" id="comment-list"><p class="muted">Loading…</p></div>`;
    if ($("#comment-post")) {
      $("#comment-post").onclick = async () => {
        const ok = await postComment({
          text: $("#comment-text")?.value,
          commentType: "comment",
          parentCommentId: null,
        });
        if (ok && $("#comment-text")) $("#comment-text").value = "";
      };
    }
    const res = await supabaseRequest(
      `/rest/v1/comments?idtmdb=eq.${Number(mediaId)}&type=eq.${mediaType}&select=*&order=created_at.asc`
    );
    const list = $("#comment-list");
    if (res?.data?.code === "PGRST205") {
      list.innerHTML = `<p class="muted">${t("watch.missingCmt")}</p>`;
      return;
    }
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    const roots = rows.filter(
      (r) => r.comment_type !== "reply" && !r.parent_comment_id && !r.parent_id
    );
    const repliesOf = (id) =>
      rows.filter((r) => {
        const parent = String(r.parent_comment_id || r.parent_id || "");
        return parent && parent === String(id);
      });
    if (!roots.length && !rows.length) {
      list.innerHTML = `<p class="muted">${t("watch.noCmt")}</p>`;
      return;
    }
    const card = (row, isReply) => {
      const cid = publicCommentId(row);
      return `
      <article class="comment-card ${isReply ? "reply" : ""}" data-comment-id="${escapeHtml(cid)}">
        <div class="comment-meta">
          <strong><a href="${memberProfileHref(row.username)}">@${escapeHtml(row.username || "member")}</a></strong>
          <span class="muted">${escapeHtml(cid)} · ${escapeHtml(commentDate(row.created_at))}${isReply ? ` · Reply to ${escapeHtml(row.parent_comment_id || "")}` : ""}</span>
        </div>
        <p class="comment-body">${escapeHtml(row.comment || "")}</p>
        ${ownerBlocks("replies", row.member_id, row.username) ? "" : `<button class="btn btn-sm btn-ghost" data-reply="${escapeHtml(cid)}" type="button">${t("watch.reply")}</button>`}
        <div class="reply-slot" data-slot="${escapeHtml(cid)}"></div>
      </article>
      ${repliesOf(cid).map((rep) => card(rep, true)).join("")}`;
    };
    list.innerHTML = roots.map((row) => card(row, false)).join("") || `<p class="muted">${t("watch.noCmt")}</p>`;
    list.onclick = async (e) => {
      const send = e.target.closest("[data-send-reply]");
      if (send) {
        const wrap = send.closest(".reply-form");
        const text = wrap?.querySelector("textarea")?.value;
        await postComment({
          text,
          commentType: "reply",
          parentCommentId: send.dataset.sendReply,
        });
        return;
      }
      const btn = e.target.closest("[data-reply]");
      if (!btn) return;
      const id = btn.dataset.reply;
      const slot = list.querySelector(`[data-slot="${CSS.escape ? CSS.escape(id) : id}"]`) ||
        list.querySelector(`[data-slot="${id}"]`);
      if (!slot) return;
      if (!session?.member_id) {
        toast(t("watch.signReply"));
        return;
      }
      const open = slot.querySelector(".reply-form");
      if (open) {
        slot.innerHTML = "";
        return;
      }
      slot.innerHTML = `
        <div class="reply-form">
          <textarea placeholder="${t("watch.replyTo", { id })}" maxlength="2000"></textarea>
          <button class="btn btn-sm btn-primary" data-send-reply="${escapeHtml(id)}" type="button">${t("watch.postReply")}</button>
        </div>`;
    };
  }

  async function renderWatchExtras() {
    await loadSocialGates();
    await renderPlaylistBar();
    await renderLinks();
    renderShareRow();
    await renderSocialTabs();
  }

  async function onPlay() {
    if (state.gated) {
      $("#code-input").focus();
      return;
    }
    if (state.needsCode && !state.unlocked && !state.timer) {
      playEmbed();
      return;
    }
    playEmbed();
  }

  async function submitCode() {
    if (applyLockUI()) {
      toast(t("watch.lockoutToast"));
      return;
    }
    const code = $("#code-input").value.replace(/\D/g, "");
    const result = await verifyCode(code);
    const msg = $("#gate-msg");
    if (!result.ok) {
      const counts = result.reason !== "setup" && result.reason !== "error" && result.reason !== "invalid";
      if (counts) {
        const lock = recordFailedCode();
        if (lock.until > Date.now()) {
          applyLockUI();
          toast(t("watch.lockoutToast"));
          return;
        }
        const left = Math.max(0, CODE_FAIL_MAX - lock.fails);
        msg.textContent = `${result.message} ${t("watch.triesLeft", { n: left })}`;
        msg.className = "gate-msg error";
        return;
      }
      msg.textContent = result.message;
      msg.className = "gate-msg error";
      return;
    }
    clearCodeLock();
    stopLockTicker();
    setCodeFormEnabled(true);
    setStoredCode(code);
    state.unlocked = true;
    state.needsCode = false;
    msg.textContent = result.message;
    msg.className = "gate-msg ok";
    toast(t("watch.codeOk"));
    playEmbed();
  }

  async function restoreCode() {
    const stored = getStoredCode();
    if (!stored) return;
    const result = await verifyCode(stored);
    if (result.ok) {
      state.unlocked = true;
      state.needsCode = false;
      return;
    }
    if (result.reason === "not_found") return;
    state.storedIssue = result.message;
  }

  function peopleSection(id, title, people, roleKey) {
    const el = $(id);
    if (!people.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="kicker"><span class="eyebrow">${title}</span></div>
      <div class="people-grid">
        ${people
          .map((p) => `
            <a class="person-card" href="${personHref(p.id)}">
              <img src="${photo(p.profile_path, p.name)}" alt="${escapeHtml(p.name)}" loading="lazy" />
              <div>
                <h3>${escapeHtml(p.name)}</h3>
                <p>${escapeHtml(p[roleKey] || "")}</p>
              </div>
            </a>
          `)
          .join("")}
      </div>
    `;
  }

  function railSection(id, kicker, title, items, type) {
    const el = $(id);
    const list = (items || []).filter((x) => x.poster_path);
    if (!list.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="section-head">
        <div>
          <div class="kicker"><span class="eyebrow">${kicker}</span></div>
          <h2>${title}</h2>
        </div>
      </div>
      <div class="rail-track">
        ${list.map((item) => posterCard(item, type || item.media_type || mediaType)).join("")}
      </div>
    `;
  }

  function renderInfo() {
    const d = state.detail;
    const title = d.title || d.name || "Untitled";
    document.title = `${title} — CineAura`;
    const genres = (d.genres || []).map((g) => g.name).join(" · ") || "—";
    const date = formatDate(d.release_date || d.first_air_date);
    const score = ratingPercent(d.vote_average);
    $("#title-info").hidden = false;
    $("#title-info").innerHTML = `
      <div class="title-poster">
        <img src="${imgUrl(d.poster_path, "w500") || photo(null, title)}" alt="${escapeHtml(title)}" />
      </div>
      <div>
        <div class="title-kicker">
          <span class="media-badge">${mediaType === "tv" ? "TV Series" : "Movie"}</span>
          ${mediaType === "tv" ? `<span class="chip">S${state.season} · E${state.episode}</span>` : ""}
        </div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-row">
          <span class="chip score">★ ${ratingText(d.vote_average)} · ${score}%</span>
          <span class="chip">${escapeHtml(date)}</span>
          <span class="chip">${escapeHtml(certification(d))}</span>
          <span class="chip">${formatRuntime(currentRuntime())}</span>
          <span class="chip" id="watch-min-chip">${minutesLabel(state.watchMinutes)}</span>
          <span class="chip">${escapeHtml(genres)}</span>
        </div>
        <p class="overview">${escapeHtml(d.overview || t("watch.noSynopsis"))}</p>
        <div class="title-playlist" id="title-playlist"></div>
      </div>
    `;

    const crew = d.credits?.crew || [];
    const directors = crew.filter((c) => c.job === "Director" || c.job === "Series Director");
    const creators = (d.created_by || []).map((c) => ({ ...c, job: "Creator" }));
    const leadCrew = (directors.length ? directors : creators).slice(0, 8);
    peopleSection("#directors-section", directors.length ? "Director" : "Created by", leadCrew, "job");

    const cast = (d.credits?.cast || []).slice(0, 16);
    peopleSection("#cast-section", "Cast", cast, "character");

    railSection("#similar-section", "More like this", "Similar titles", d.similar?.results || [], mediaType);
    railSection("#related-section", "Because you opened this", "Related titles", d.recommendations?.results || [], mediaType);
  }

  async function renderCollection() {
    const collection = state.detail?.belongs_to_collection;
    if (!collection?.id) return;
    try {
      const data = await tmdb(`/collection/${collection.id}`);
      const parts = (data.parts || []).sort((a, b) =>
        String(a.release_date || "").localeCompare(String(b.release_date || ""))
      );
      const index = parts.findIndex((p) => p.id === Number(mediaId));
      const labeled = parts.map((p, i) => {
        const card = posterCard(p, "movie");
        if (i === index) return card.replace('class="poster-card"', 'class="poster-card current-part"');
        return card;
      });
      const prev = index > 0 ? parts[index - 1] : null;
      const next = index >= 0 && index < parts.length - 1 ? parts[index + 1] : null;
      const el = $("#collection-section");
      el.hidden = false;
      el.innerHTML = `
        <div class="section-head">
          <div>
            <div class="kicker"><span class="eyebrow">Saga</span></div>
            <h2>${escapeHtml(data.name || t("watch.collection"))}</h2>
          </div>
          <p>${prev ? `Previous: ${escapeHtml(prev.title)}` : "This is the first part."}${next ? ` · Next: ${escapeHtml(next.title)}` : ""}</p>
        </div>
        <div class="rail-track">${labeled.join("")}</div>
      `;
    } catch {
      /* optional */
    }
  }

  // The link of this page: everything a visitor needs to land on the same
  // title, episode and playlist. Used for the address bar and for sharing.
  function canonicalUrl() {
    const url = new URL(location.href);
    url.search = "";
    if (mediaType === "tv") {
      url.searchParams.set("tv", mediaId);
      url.searchParams.set("season", String(state.season));
      url.searchParams.set("episode", String(state.episode));
    } else {
      url.searchParams.set("movie", mediaId);
    }
    // Keep post/playlist attribution across season & episode changes.
    if (state.postId) url.searchParams.set("post", state.postId);
    const pl = params.get("Playlist") || params.get("playlist");
    if (pl) url.searchParams.set("Playlist", pl);
    return url;
  }

  function syncUrl() {
    history.replaceState({}, "", canonicalUrl());
  }

  // Share row under the player. The shared link keeps its parameters, e.g.
  // /watch.html?tv=34587&season=1&episode=1&Playlist=IDP104059407
  function renderShareRow() {
    const el = $("#watch-share");
    if (!el) return;
    const d = state.detail || {};
    const title = d.title || d.name || "";
    const text =
      mediaType === "tv"
        ? `${title} — S${state.season} · E${state.episode} · CineAura`
        : `${title} · CineAura`;
    el.innerHTML = shareRowHtml(`${location.pathname}${canonicalUrl().search}`, text);
  }

  async function loadSeason(seasonNumber, preferredEpisode) {
    const data = await tmdb(`/tv/${mediaId}/season/${seasonNumber}`);
    state.season = seasonNumber;
    state.episodes = data.episodes || [];
    const exists = state.episodes.some((e) => e.episode_number === preferredEpisode);
    if (exists) {
      state.episode = preferredEpisode;
    } else if (preferredEpisode >= 9999) {
      state.episode = state.episodes[state.episodes.length - 1]?.episode_number || 1;
    } else {
      state.episode = state.episodes[0]?.episode_number || 1;
    }
    const seasonSelect = $("#season-select");
    const episodeSelect = $("#episode-select");
    seasonSelect.innerHTML = state.seasons
      .map(
        (s) =>
          `<option value="${s.season_number}" ${s.season_number === state.season ? "selected" : ""}>${escapeHtml(s.name || `Season ${s.season_number}`)}</option>`
      )
      .join("");
    episodeSelect.innerHTML = state.episodes
      .map(
        (e) =>
          `<option value="${e.episode_number}" ${e.episode_number === state.episode ? "selected" : ""}>E${e.episode_number} · ${escapeHtml(e.name || "Episode")}</option>`
      )
      .join("");
    syncUrl();
    setIdleArt();
    await loadWatchMinutes();
    renderInfo();
    await renderWatchExtras();
    stopTimer();
    stopEmbed();
    hideGate();
    showIdle();
  }

  function stepEpisode(delta) {
    const list = state.episodes;
    const idx = list.findIndex((e) => e.episode_number === state.episode);
    const nextIdx = idx + delta;
    if (nextIdx >= 0 && nextIdx < list.length) {
      loadSeason(state.season, list[nextIdx].episode_number);
      return;
    }
    const sIdx = state.seasons.findIndex((s) => s.season_number === state.season);
    const nextSeason = state.seasons[sIdx + delta];
    if (!nextSeason) {
      toast(delta > 0 ? t("watch.lastEp") : t("watch.firstEp"));
      return;
    }
    loadSeason(nextSeason.season_number, delta > 0 ? 1 : 9999);
  }

  function bind() {
    setupChrome();
    $("#play-btn").addEventListener("click", onPlay);
    $("#countdown-enter").addEventListener("click", lockPlayer);
    $("#unlock-btn").addEventListener("click", submitCode);
    $("#code-input").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    });
    $("#code-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitCode();
    });
    $("#prev-ep").addEventListener("click", () => stepEpisode(-1));
    $("#next-ep").addEventListener("click", () => stepEpisode(1));
    $("#season-select").addEventListener("change", (e) => {
      loadSeason(Number(e.target.value), 1);
    });
    $("#episode-select").addEventListener("change", (e) => {
      loadSeason(state.season, Number(e.target.value));
    });
    const playing = () => $("#player")?.classList.contains("is-playing") && !state.gated;
    const pauseWatchClock = () => stopMinuteTicker();
    const resumeWatchClock = () => {
      if (!document.hidden && playing()) startMinuteTicker();
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pauseWatchClock();
      else resumeWatchClock();
    });
    window.addEventListener("blur", pauseWatchClock);
    window.addEventListener("focus", resumeWatchClock);
  }

  async function init() {
    bind();
    if (!mediaId) {
      $("#page-loader")?.remove();
      $("#watch-root").innerHTML = `<div class="glass page-error"><h2>${t("watch.nothing")}</h2><p>${t("watch.openCat")}</p><a class="btn btn-lg btn-primary" href="./">${t("watch.backHome")}</a></div>`;
      return;
    }

    try {
      const path =
        mediaType === "movie"
          ? `/movie/${mediaId}?append_to_response=credits,similar,recommendations,release_dates`
          : `/tv/${mediaId}?append_to_response=credits,similar,recommendations,content_ratings`;
      state.detail = await tmdb(path);
      const score = ratingPercent(state.detail.vote_average);
      state.needsCode = score >= 70;
      await restoreCode();
      await loadMySanctions();
      await loadPostOwner();
      if (state.unlocked) state.needsCode = false;

      if (mediaType === "tv") {
        state.seasons = (state.detail.seasons || []).filter((s) => s.season_number > 0);
        if (!state.seasons.length) state.seasons = [{ season_number: 1, name: "Season 1" }];
        const hasSeason = state.seasons.some((s) => s.season_number === state.season);
        if (!hasSeason) state.season = state.seasons[0].season_number;
        $("#episode-bar").classList.add("show");
        await loadSeason(state.season, state.episode);
      } else {
        setIdleArt();
        await loadWatchMinutes();
        renderInfo();
        await renderWatchExtras();
      }

      renderCollection();
      const session = getSession && getSession();
      if (session?.member_id && supabaseRequest) {
        supabaseRequest("/rest/v1/hestory", {
          method: "POST",
          body: JSON.stringify({
            tmdb_id: Number(mediaId),
            media_type: mediaType,
            visitor_id: session.member_id,
            title: state.detail.title || state.detail.name || "",
            poster_path: state.detail.poster_path || "",
          }),
        }).catch(() => {});
      }
      if (state.storedIssue && state.needsCode) {
        /* verified on play / gate */
      }
    } catch (error) {
      console.error(error);
      toast(t("watch.loadFail"));
      $("#watch-root").insertAdjacentHTML(
        "afterbegin",
        `<div class="glass page-error"><h2>${t("watch.unavail")}</h2><p>${t("watch.tmdbFail")}</p><a class="btn btn-lg btn-primary" href="./">${t("watch.backHome")}</a></div>`
      );
    } finally {
      $("#page-loader")?.remove();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
