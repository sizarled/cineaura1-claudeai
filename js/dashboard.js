(() => {
  const C = window.CineAura;
  const {
    $,
    $$,
    setupChrome,
    getSession,
    toast,
    supabaseRequest: sbRequest,
    sessionWriteBlocked,
    restValue,
    normalizeAccountStatus,
    initialsAvatar,
    avatarUrlFor,
    hydrateAvatars,
    escapeHtml,
    sha256,
    logout,
    photo,
    tmdb,
    t,
    tr,
    applyPrefs,
    translateDom,
    getLang,
    getTheme,
  } = C;

  const PLAN = {
    Free: { maxCodes: 5, months: 1 },
    Silver: { maxCodes: 10, months: 3 },
    Gold: { maxCodes: 10, months: 6 },
    Diamond: { maxCodes: 10, months: 12 },
  };

  const DEFAULT_LISTS = [
    { key: "completed", name: "Completed" },
    { key: "incomplete", name: "In progress" },
    { key: "later", name: "Watch later" },
  ];

  // Every write on the dashboard needs a live session; the read-only path stays
  // open so the gated page can still show its own notice.
  function supabaseRequest(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET" && !getSession()?.member_id) {
      if (typeof sessionWriteBlocked === "function") sessionWriteBlocked();
      else toast(t("auth.gate.blocked"));
      return Promise.resolve({ ok: false, status: 401, data: null, blocked: true });
    }
    return sbRequest(path, options);
  }

  const state = {
    session: null,
    member: null,
    profile: null,
    playlists: [],
    section: "overview",
    openPlaylist: null,
    panelVisible: false,
    sanctions: null,
  };

  let profileSettingsQueue = Promise.resolve();

  function writeProfileSettings(values) {
    const memberId = state.member?.member_id;
    if (!memberId) return Promise.resolve({ ok: false, status: 401 });
    const request = profileSettingsQueue
      .catch(() => null)
      .then(() => supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(memberId)}`, {
        method: "PATCH",
        keepalive: true,
        body: JSON.stringify(values),
      }));
    profileSettingsQueue = request;
    return request.catch(() => ({ ok: false, status: 0 }));
  }

  async function saveAppearancePreference(field, value) {
    const pref = { [field]: value };
    applyPrefs({ ...pref, persist: true });
    const result = await writeProfileSettings(pref);
    if (!result.ok) {
      toast(t("dash.settings.saveFailed"));
      return;
    }
    if (state.profile) Object.assign(state.profile, pref);
    toast(t("dash.settings.prefSaved"));
  }

  document.addEventListener("cineaura:prefs", () => {
    if (state.member && document.querySelector("#dash-root .dash-layout")) renderShell();
  });

  const gate = (title, text, actions) => `
    <section class="glass dash-gate">
      <span class="eyebrow">${t("nav.dashboard")}</span>
      <h1>${title}</h1>
      <p>${text}</p>
      <div class="success-actions">${actions}</div>
    </section>`;

  async function loadMember(id) {
    const res = await supabaseRequest(
      `/rest/v1/members?member_id=eq.${restValue(id)}&select=*`
    );
    return res.ok && Array.isArray(res.data) ? res.data[0] : null;
  }

  async function ensureProfile(member) {
    const get = await supabaseRequest(
      `/rest/v1/profiles?member_id=eq.${restValue(member.member_id)}&select=*`
    );
    if (get.ok && get.data?.[0]) {
      state.profile = get.data[0];
      return;
    }
    const row = {
      member_id: member.member_id,
      username: member.username,
      bio: "",
      membership_type: member.membership_type || "Free",
      private_minutes: Number(member.watch_minutes || 0),
      public_minutes: 0,
      avatar_url: "",
      followers: 0,
      following: 0,
      language: getLang(),
      theme: getTheme(),
      region: "",
      country: member.country || "",
    };
    await supabaseRequest("/rest/v1/profiles", {
      method: "POST",
      body: JSON.stringify(row),
    });
    state.profile = row;
  }

  function playlistId() {
    return `IDP${Math.floor(100000000 + Math.random() * 900000000)}`;
  }

  async function ensurePlaylists(member) {
    const res = await supabaseRequest(
      `/rest/v1/playlists?owner_id=eq.${restValue(member.member_id)}&select=*&order=created_at.asc`
    );
    let rows = res.ok && Array.isArray(res.data) ? res.data : [];
    if (!rows.length) {
      const seed = [];
      ["movie", "tv"].forEach((media) => {
        DEFAULT_LISTS.forEach((list) => {
          seed.push({
            playlist_id: playlistId(),
            name: list.name,
            description: `${list.name} ${media === "tv" ? "series" : "movies"}`,
            owner_username: member.username,
            owner_id: member.member_id,
            media_type: media,
            kind: "default",
            list_key: list.key,
            visibility: "private",
          });
        });
      });
      await supabaseRequest("/rest/v1/playlists", {
        method: "POST",
        body: JSON.stringify(seed),
      });
      rows = seed;
    }
    state.playlists = rows;
  }

  async function syncWatchMinutes() {
    const views = await supabaseRequest(
      `/rest/v1/views?viewer_id=eq.${restValue(state.member.member_id)}&select=minutes,playlist_id`
    );
    const rows = views.ok && Array.isArray(views.data) ? views.data : [];
    const vis = {};
    state.playlists.forEach((p) => {
      vis[p.playlist_id] = String(p.visibility || "").toLowerCase();
    });
    const extraIds = [...new Set(rows.map((r) => r.playlist_id).filter((id) => id && !vis[id]))];
    if (extraIds.length) {
      const extra = await supabaseRequest(
        `/rest/v1/playlists?playlist_id=in.(${extraIds.join(",")})&select=playlist_id,visibility`
      );
      (extra.data || []).forEach((p) => {
        vis[p.playlist_id] = String(p.visibility || "").toLowerCase();
      });
    }
    let priv = 0;
    let pub = 0;
    rows.forEach((r) => {
      const mins = Number(r.minutes || 0);
      if (vis[r.playlist_id] === "public") pub += mins;
      else priv += mins;
    });
    const owned = await supabaseRequest(
      `/rest/v1/views?link_owner_id=eq.${restValue(state.member.member_id)}&select=minutes,viewer_id`
    );
    (owned.ok && Array.isArray(owned.data) ? owned.data : []).forEach((r) => {
      if (r.viewer_id !== state.member.member_id) pub += Number(r.minutes || 0);
    });
    // Prizes are no longer paid by shrinking the watch minutes: what a member
    // spent lives in profiles.points_spent, and winners.minutes_paid is kept
    // only as a record of what each prize cost. Subtracting it here as well
    // would charge every claim twice.
    await supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(state.member.member_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ private_minutes: priv, public_minutes: pub }),
    });
    await supabaseRequest(`/rest/v1/members?member_id=eq.${restValue(state.member.member_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ watch_minutes: priv + pub }),
    });
    if (state.profile) {
      state.profile.private_minutes = priv;
      state.profile.public_minutes = pub;
    }
    if (state.member) state.member.watch_minutes = priv + pub;
  }

  function avatar() {
    const m = state.member || {};
    return state.profile?.avatar_url || avatarUrlFor(m.member_id, m.username) || initialsAvatar(m.username || "CA");
  }

  function avatarTag() {
    const m = state.member || {};
    return `<img src="${escapeHtml(avatar())}" alt="" data-avatar-for="${escapeHtml(m.member_id || "")}" data-avatar-name="${escapeHtml(m.username || "")}" />`;
  }

  function listLabel(pl) {
    const map = { completed: t("list.completed"), incomplete: t("list.progress"), later: t("list.later") };
    return map[pl.list_key] || pl.name;
  }

  function renderShell() {
    const m = state.member;
    const p = state.profile || {};
    const movies = state.playlists.filter((x) => x.media_type === "movie");
    const series = state.playlists.filter((x) => x.media_type === "tv");
    const listBtns = (arr) =>
      arr
        .map(
          (pl) =>
            `<button type="button" data-open-pl="${escapeHtml(pl.playlist_id)}">${escapeHtml(listLabel(pl))}</button>`
        )
        .join("");

    $("#dash-root").innerHTML = `
      <div class="dash-layout">
        <aside class="glass dash-side">
          <a class="side-user" href="./Profile.html?@${encodeURIComponent(m.username)}">
            ${avatarTag()}
            <strong>@${escapeHtml(m.username)}</strong>
            <span>${escapeHtml(tr(p.membership_type || m.membership_type || "Free"))}</span>
            <span>${escapeHtml(m.member_id)}</span>
          </a>
          <nav class="side-nav">
            ${["overview","playlists","links","reports","codes","iptv","views","analytics","prizes","history","settings"].map((s) =>
              `<button type="button" data-section="${s}" class="${state.section===s?"active":""}">${t("dash.nav."+s)}</button>`
            ).join("")}
            ${state.panelVisible ? `<a href="./Panel.html">${t("nav.panel")}</a>` : ""}
          </nav>
          <div class="side-label">${t("dash.side.movies")}</div>
          <div class="side-lists">${listBtns(movies)}</div>
          <div class="side-label">${t("dash.side.series")}</div>
          <div class="side-lists">${listBtns(series)}</div>
        </aside>
        <section class="glass dash-main" id="dash-main"></section>
      </div>`;
    $("#dash-root").onclick = onShellClick;
    C.mountSideToggle($("#dash-root .dash-layout"));
    hydrateAvatars($("#dash-root"));
    renderSection();
  }

  function onShellClick(e) {
    const sec = e.target.closest("[data-section]");
    if (sec) {
      state.section = sec.dataset.section;
      state.openPlaylist = null;
      renderShell();
      return;
    }
    const pl = e.target.closest("[data-open-pl]");
    if (pl) {
      state.section = "playlists";
      state.openPlaylist = pl.dataset.openPl;
      renderShell();
    }
  }

  async function renderSection() {
    const main = $("#dash-main");
    if (!main) return;
    main.onclick = null;
    const map = {
      overview: viewOverview,
      playlists: viewPlaylists,
      links: viewLinks,
      reports: viewReports,
      codes: viewCodes,
      iptv: viewIptv,
      views: viewViews,
      analytics: viewAnalytics,
      prizes: viewPrizes,
      history: viewHistory,
      settings: viewSettings,
    };
    await (map[state.section] || viewOverview)(main);
  }

  // ---------- Tabs for multi-part sections ----------
  function wireTabs(root, key) {
    const bar = root.querySelector("[data-tabbar]");
    if (!bar) return;
    state.tabs = state.tabs || {};
    const panes = [...root.querySelectorAll("[data-dpane]")];
    const apply = () => {
      let cur = state.tabs[key];
      if (!panes.some((x) => x.dataset.dpane === cur)) cur = panes[0]?.dataset.dpane;
      state.tabs[key] = cur;
      bar.querySelectorAll("[data-dtab]").forEach((b) => {
        const on = b.dataset.dtab === cur;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
      });
      panes.forEach((x) => { x.hidden = x.dataset.dpane !== cur; });
    };
    bar.onclick = (e) => {
      const b = e.target.closest("[data-dtab]");
      if (!b) return;
      state.tabs[key] = b.dataset.dtab;
      apply();
    };
    apply();
  }

  // Splits an already-rendered section into tabs, one per <h2> block.
  function tabify(main, key, opts = {}) {
    const kids = [...main.children];
    let i = 0;
    const isIntro = (el) => el.tagName === "P" || el.tagName === "H1" || el.classList.contains("stat-row") || el.classList.contains("stat");
    while (i < kids.length && isIntro(kids[i])) i++;
    const groups = [];
    kids.slice(i).forEach((el) => {
      if (el.tagName === "H2") { groups.push({ label: el.textContent.trim(), els: [] }); el.remove(); return; }
      if (!groups.length) groups.push({ label: opts.first ? opts.first() : "", els: [] });
      groups[groups.length - 1].els.push(el);
    });
    if (groups.length < 2) return;
    const bar = document.createElement("div");
    bar.className = "tabs follow-tabs";
    bar.setAttribute("role", "tablist");
    bar.dataset.tabbar = "1";
    bar.innerHTML = groups.map((g, n) => `<button type="button" role="tab" class="follow-tab" data-dtab="${key}${n}">${escapeHtml(g.label)}</button>`).join("");
    const anchor = i > 0 ? kids[i - 1] : null;
    if (anchor) anchor.after(bar); else main.prepend(bar);
    let prev = bar;
    groups.forEach((g, n) => {
      const pane = document.createElement("div");
      pane.className = "follow-pane";
      pane.dataset.dpane = `${key}${n}`;
      g.els.forEach((el) => pane.appendChild(el));
      prev.after(pane);
      prev = pane;
    });
    wireTabs(main, key);
  }

  function tabbed(fn, key, opts) {
    return async function (main, ...rest) {
      const out = await fn.call(this, main, ...rest);
      tabify(main, key, opts);
      return out;
    };
  }

  async function viewOverview(main) {
    const p = state.profile || {};
    const m = state.member;
    main.innerHTML = `
      <p class="eyebrow">${t("dash.overview")}</p>
      <h1>${t("common.hello", { name: escapeHtml(m.full_name || m.username) })}</h1>
      <div class="stat-row">
        <div class="stat"><b>${escapeHtml(tr(m.membership_type || "Free"))}</b><span>${t("common.membership")}</span></div>
        <div class="stat"><b>${escapeHtml(m.membership_duration || "1 month")}</b><span>${t("common.duration")}</span></div>
        <div class="stat"><b>${Number(p.private_minutes||0)+Number(p.public_minutes||0)}</b><span>${t("dash.totalMin")}</span></div>
        <div class="stat"><b>${Number(p.followers||0)}</b><span>${t("dash.followers")}</span></div>
      </div>
      <p class="muted">${t("dash.expiresOn", { date: escapeHtml(String(m.membership_expires_at||"—").slice(0,10)) })}</p>`;
  }

  function visibilityFieldsHtml(prefix, pl = {}) {
    return `
      <select id="${prefix}-vis">
        <option value="public">${t("common.public")}</option>
        <option value="private">${t("common.private")}</option>
        <option value="exclusive">${t("common.exclusive")}</option>
      </select>
      <div class="vis-fields stack" id="${prefix}-private" hidden>
        <p class="muted">${t("dash.privHint")}</p>
        <input id="${prefix}-people" placeholder="${t("dash.peoplePh")}" value="${escapeHtml((pl._people || []).join(", "))}" />
      </div>
      <div class="vis-fields stack" id="${prefix}-exclusive" hidden>
        <p class="muted">${t("dash.exclHint")}</p>
        <textarea id="${prefix}-rules" placeholder="${t("dash.rulesPh")}">${escapeHtml(pl.rules || "")}</textarea>
        <label class="lang-chip"><input type="checkbox" id="${prefix}-member" ${pl.require_member ? "checked" : ""} /> ${t("common.membersOnly")}</label>
        <label class="lang-chip"><input type="checkbox" id="${prefix}-followers" ${pl.require_followers ? "checked" : ""} /> ${t("common.followersOnly")}</label>
        <div class="form-row">
          <input id="${prefix}-countries" placeholder="${t("dash.countriesPh")}" value="${escapeHtml(pl.countries || "")}" />
          <input id="${prefix}-age" type="number" min="1" placeholder="${t("dash.maxAge")}" value="${pl.max_age || ""}" />
        </div>
        <select id="${prefix}-gender">
          <option value="any">${t("common.anyGender")}</option>
          <option value="male">${t("reg.male")}</option>
          <option value="female">${t("reg.female")}</option>
        </select>
      </div>`;
  }

  function bindVisibilityFields(prefix) {
    const vis = $(`#${prefix}-vis`);
    const priv = $(`#${prefix}-private`);
    const excl = $(`#${prefix}-exclusive`);
    const sync = () => {
      const v = vis.value;
      priv.hidden = v !== "private";
      excl.hidden = v !== "exclusive";
    };
    vis.onchange = sync;
    sync();
  }

  function readPlaylistSettings(prefix, { requirePeople, requireRules }) {
    const visibility = $(`#${prefix}-vis`).value;
    const people = String($(`#${prefix}-people`)?.value || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim().replace(/^@/, ""))
      .filter(Boolean);
    const rules = String($(`#${prefix}-rules`)?.value || "").trim();
    if (visibility === "private" && requirePeople && !people.length) {
      toast(t("dash.needPeople"));
      return null;
    }
    if (visibility === "exclusive" && requireRules && !rules) {
      toast(t("dash.needRules"));
      return null;
    }
    const ageRaw = $(`#${prefix}-age`)?.value;
    return {
      visibility,
      people,
      rules,
      require_member: Boolean($(`#${prefix}-member`)?.checked),
      require_followers: Boolean($(`#${prefix}-followers`)?.checked),
      countries: String($(`#${prefix}-countries`)?.value || "").trim(),
      max_age: ageRaw ? Number(ageRaw) : null,
      gender: $(`#${prefix}-gender`)?.value || "any",
    };
  }

  async function savePlaylistAccess(playlistId, people) {
    await supabaseRequest(`/rest/v1/playlist_access?playlist_id=eq.${restValue(playlistId)}`, {
      method: "DELETE",
    });
    if (!people.length) return;
    await supabaseRequest("/rest/v1/playlist_access", {
      method: "POST",
      body: JSON.stringify(people.map((username) => ({ playlist_id: playlistId, username }))),
    });
  }

  async function copyPlaylist(pl) {
    if (!(await C.guardFeature("posts"))) return;
    const base = String(listLabel(pl)).replace(/\s+\d+$/, "").trim();
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("^" + esc + "(?:\\s+(\\d+))?$", "i");
    let max = 1;
    state.playlists.forEach((x) => {
      const m = re.exec(String(listLabel(x)).trim());
      if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
    });
    const row = {
      playlist_id: playlistId(),
      name: `${base} ${max + 1}`,
      description: pl.description || "",
      owner_username: state.member.username,
      owner_id: state.member.member_id,
      media_type: pl.media_type,
      kind: "custom",
      list_key: "custom",
      visibility: pl.visibility || "private",
      rules: pl.rules || "",
      require_member: !!pl.require_member,
      require_followers: !!pl.require_followers,
      countries: pl.countries || "",
      max_age: pl.max_age ?? null,
      gender: pl.gender || "any",
      avatar_url: pl.avatar_url || "",
    };
    const ins = await supabaseRequest("/rest/v1/playlists", { method: "POST", body: JSON.stringify(row) });
    if (!ins.ok) return toast(t("dash.copyFail"));
    const items = await supabaseRequest(`/rest/v1/playlist_items?playlist_id=eq.${restValue(pl.playlist_id)}&select=*&order=added_at.asc`);
    const rows = items.ok && Array.isArray(items.data) ? items.data : [];
    if (rows.length) {
      await supabaseRequest("/rest/v1/playlist_items", {
        method: "POST",
        body: JSON.stringify(rows.map((r) => ({ playlist_id: row.playlist_id, tmdb_id: r.tmdb_id, media_type: r.media_type, title: r.title || "", poster_path: r.poster_path || "", visibility: r.visibility || row.visibility }))),
      });
    }
    if (String(row.visibility).toLowerCase() === "private") {
      const acc = await supabaseRequest(`/rest/v1/playlist_access?playlist_id=eq.${restValue(pl.playlist_id)}&select=username`);
      const people = (acc.ok && Array.isArray(acc.data) ? acc.data : []).map((x) => x.username);
      if (people.length) await savePlaylistAccess(row.playlist_id, people);
    }
    state.playlists.push(row);
    toast(t("dash.copyDone", { name: row.name }));
    renderShell();
  }

  async function viewPlaylists(main) {
    if (state.openPlaylist) return viewOnePlaylist(main, state.openPlaylist);
    main.innerHTML = `
      <p class="eyebrow">${t("dash.nav.playlists")}</p>
      <h1>${t("dash.yourLists")}</h1>
      <div class="stack" style="margin:16px 0 22px">
        <div class="form-row">
          <input id="pl-name" placeholder="${t("dash.listName")}" />
          <select id="pl-type"><option value="movie">${t("common.movies")}</option><option value="tv">${t("common.series")}</option></select>
        </div>
        <textarea id="pl-desc" placeholder="${t("dash.descReq")}"></textarea>
        ${visibilityFieldsHtml("pl")}
        <button class="btn btn-sm btn-primary" id="pl-create" type="button">${t("dash.createList")}</button>
      </div>
      <div class="filter-bar">
        <div class="filter-group">
          <span class="muted">${t("common.type")}</span>
          <label class="lang-chip"><input type="radio" name="pl-ft" value="all" checked /> ${t("common.all")}</label>
          <label class="lang-chip"><input type="radio" name="pl-ft" value="movie" /> ${t("common.movies")}</label>
          <label class="lang-chip"><input type="radio" name="pl-ft" value="tv" /> ${t("common.series")}</label>
        </div>
        <div class="filter-group">
          <span class="muted">${t("common.visibility")}</span>
          <label class="lang-chip all"><input type="checkbox" id="fv-all" checked /> ${t("common.all")}</label>
          <label class="lang-chip"><input type="checkbox" class="fv" value="public" checked /> ${t("common.public")}</label>
          <label class="lang-chip"><input type="checkbox" class="fv" value="exclusive" checked /> ${t("common.exclusive")}</label>
          <label class="lang-chip"><input type="checkbox" class="fv" value="private" checked /> ${t("common.private")}</label>
        </div>
      </div>
      <div id="pl-cards" style="overflow-x:auto"></div>`;
    bindVisibilityFields("pl");
    const counts = {};
    try {
      const ids = state.playlists.map((x) => encodeURIComponent(x.playlist_id)).join(",");
      const ci = ids ? await supabaseRequest(`/rest/v1/playlist_items?playlist_id=in.(${ids})&select=playlist_id`) : null;
      (ci?.ok && Array.isArray(ci.data) ? ci.data : []).forEach((r) => { counts[r.playlist_id] = (counts[r.playlist_id] || 0) + 1; });
    } catch { /* counts are optional */ }
    const drawPlaylistCards = () => {
      const type = document.querySelector('input[name="pl-ft"]:checked')?.value || "all";
      const visSet = new Set($$(".fv:checked").map((el) => el.value));
      const list = state.playlists.filter((pl) => {
        if (type !== "all" && pl.media_type !== type) return false;
        const vis = String(pl.visibility || "private").toLowerCase();
        return visSet.has(vis);
      });
      $("#pl-cards").innerHTML = list.length
        ? `<table class="table pl-table"><thead><tr>
            <th>#</th><th>${t("dash.colName")}</th><th>${t("common.type")}</th><th>${t("common.visibility")}</th>
            <th>${t("dash.colItems")}</th><th>${t("dash.colViewers")}</th><th>${t("dash.colActions")}</th>
          </tr></thead><tbody>${list.map((pl, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${escapeHtml(listLabel(pl))}</strong><div class="muted" style="font-size:12.5px">${escapeHtml(pl.description || t("dash.noDesc"))}</div></td>
            <td>${pl.media_type === "tv" ? t("common.series") : t("common.movies")}</td>
            <td>${escapeHtml(tr(pl.visibility || "private"))}</td>
            <td>${counts[pl.playlist_id] || 0}</td>
            <td>${Number(pl.viewers || 0)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost" data-open-pl="${escapeHtml(pl.playlist_id)}" type="button">${t("common.open")}</button>
              <button class="btn btn-sm btn-primary" data-copy-pl="${escapeHtml(pl.playlist_id)}" type="button">${t("dash.copyList")}</button>
              <button class="btn btn-sm btn-ghost" data-share-pl="${escapeHtml(pl.playlist_id)}" type="button">${t("dash.shareBtn")}</button>
              ${pl.kind === "default" ? "" : `<button class="btn btn-sm btn-danger" data-del-pl="${escapeHtml(pl.playlist_id)}" type="button">${t("dash.delBtn")}</button>`}
            </td>
          </tr>`).join("")}</tbody></table>`
        : `<p class="empty">${t("dash.noMatch")}</p>`;
    };
    drawPlaylistCards();
    $$('input[name="pl-ft"]').forEach((el) => {
      el.onchange = drawPlaylistCards;
    });
    $("#fv-all").onchange = () => {
      const on = $("#fv-all").checked;
      $$(".fv").forEach((el) => {
        el.checked = on;
      });
      drawPlaylistCards();
    };
    $$(".fv").forEach((el) => {
      el.onchange = () => {
        $("#fv-all").checked = $$(".fv").length > 0 && $$(".fv").every((x) => x.checked);
        drawPlaylistCards();
      };
    });
    $("#pl-cards").onclick = async (e) => {
      const share = e.target.closest("[data-share-pl]");
      if (share) {
        const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}Playlist.html?ID=${share.dataset.sharePl}`;
        try { await navigator.clipboard.writeText(url); toast(t("dash.shareCopied")); }
        catch { toast(url); }
        return;
      }
      const del = e.target.closest("[data-del-pl]");
      if (del) {
        const target = state.playlists.find((x) => x.playlist_id === del.dataset.delPl);
        if (!target || target.kind === "default") return;
        if (!window.confirm(t("dash.confirmDelList", { name: listLabel(target) }))) return;
        del.disabled = true;
        const pid = restValue(target.playlist_id);
        await supabaseRequest(`/rest/v1/playlist_items?playlist_id=eq.${pid}`, { method: "DELETE" });
        await supabaseRequest(`/rest/v1/playlist_access?playlist_id=eq.${pid}`, { method: "DELETE" });
        const r = await supabaseRequest(`/rest/v1/playlists?playlist_id=eq.${pid}`, { method: "DELETE" });
        if (!r.ok) { del.disabled = false; return toast(t("dash.copyFail")); }
        state.playlists = state.playlists.filter((x) => x.playlist_id !== target.playlist_id);
        toast(t("dash.listDeleted"));
        renderShell();
        return;
      }
      const btn = e.target.closest("[data-copy-pl]");
      if (!btn) return;
      const pl = state.playlists.find((x) => x.playlist_id === btn.dataset.copyPl);
      if (!pl) return;
      btn.disabled = true;
      await copyPlaylist(pl);
      btn.disabled = false;
    };
    $("#pl-create").onclick = async () => {
      if (!(await C.guardFeature("posts"))) return;
      const name = $("#pl-name").value.trim();
      const description = $("#pl-desc").value.trim();
      if (!name) return toast(t("dash.nameList"));
      if (!description) return toast(t("dash.writeDesc"));
      const settings = readPlaylistSettings("pl", { requirePeople: true, requireRules: true });
      if (!settings) return;
      const row = {
        playlist_id: playlistId(),
        name,
        description,
        owner_username: state.member.username,
        owner_id: state.member.member_id,
        media_type: $("#pl-type").value,
        kind: "custom",
        list_key: "custom",
        visibility: settings.visibility,
        rules: settings.rules,
        require_member: settings.require_member,
        require_followers: settings.require_followers,
        countries: settings.countries,
        max_age: settings.max_age,
        gender: settings.gender,
      };
      const res = await supabaseRequest("/rest/v1/playlists", { method: "POST", body: JSON.stringify(row) });
      if (!res.ok) return toast(t("dash.listFail"));
      if (settings.visibility === "private") await savePlaylistAccess(row.playlist_id, settings.people);
      state.playlists.push(row);
      toast(t("dash.listCreated"));
      renderShell();
    };
  }

  async function viewOnePlaylist(main, id) {
    const pl = state.playlists.find((x) => x.playlist_id === id);
    if (!pl) return viewPlaylists(main);
    const items = await supabaseRequest(
      `/rest/v1/playlist_items?playlist_id=eq.${restValue(id)}&select=*&order=added_at.desc`
    );
    const list = items.ok && Array.isArray(items.data) ? items.data : [];
    const acc = await supabaseRequest(
      `/rest/v1/playlist_access?playlist_id=eq.${restValue(id)}&select=username`
    );
    pl._people = (acc.ok && Array.isArray(acc.data) ? acc.data : []).map((x) => x.username).filter(Boolean);
    const locked = pl.kind === "default";
    main.innerHTML = `
      <p class="eyebrow">${pl.media_type === "tv" ? t("common.series") : t("common.movies")}</p>
      <h1>${escapeHtml(listLabel(pl))}</h1>
      <div class="toolbar pl-topbar">
        <button class="btn btn-sm btn-primary" id="pl-edit" type="button" aria-expanded="false">${t("dash.editBtn")}</button>
        <button class="btn btn-sm btn-ghost" id="pl-copy" type="button">${t("dash.copyList")}</button>
        ${locked ? "" : `<button class="btn btn-sm btn-danger" id="pl-del" type="button">${t("dash.delBtn")}</button>`}
      </div>
      <div class="stat-row">
        <div class="stat"><b>${Number(pl.viewers||0)}</b><span>${t("common.viewers")}</span></div>
        <div class="stat"><b>${list.length}</b><span>${t("common.titles")}</span></div>
        <div class="stat"><b>${escapeHtml(pl.visibility)}</b><span>${t("common.visibility")}</span></div>
      </div>
      <div class="stack" id="pl-edit-box" style="margin:16px 0;display:none">
        <textarea id="ed-desc" placeholder="${t("dash.descReq")}">${escapeHtml(pl.description || "")}</textarea>
        ${visibilityFieldsHtml("ed", pl)}
        <div class="toolbar">
          <button class="btn btn-sm btn-primary" id="pl-save" type="button">${t("dash.saveSettings")}</button>
          <button class="btn btn-sm btn-ghost" id="pl-share" type="button">${t("dash.copyShare")}</button>
        </div>
      </div>
      <div id="pl-items"></div>`;
    $("#ed-vis").value = pl.visibility || "private";
    if ($("#ed-gender")) $("#ed-gender").value = pl.gender || "any";
    bindVisibilityFields("ed");
    $("#pl-save").onclick = async () => {
      const description = $("#ed-desc").value.trim();
      if (!description) return toast(t("dash.writeDesc"));
      const settings = readPlaylistSettings("ed", { requirePeople: true, requireRules: true });
      if (!settings) return;
      const patch = {
        description,
        visibility: settings.visibility,
        rules: settings.rules,
        require_member: settings.require_member,
        require_followers: settings.require_followers,
        countries: settings.countries,
        max_age: settings.max_age,
        gender: settings.gender,
      };
      const saved = await supabaseRequest(`/rest/v1/playlists?playlist_id=eq.${restValue(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!saved.ok) return toast(t("dash.saveFail"));
      Object.assign(pl, patch);
      await savePlaylistAccess(id, settings.visibility === "private" ? settings.people : []);
      toast(t("dash.plSaved"));
      viewOnePlaylist(main, id);
    };
    $("#pl-share").onclick = async () => {
      const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}Playlist.html?ID=${id}`;
      try { await navigator.clipboard.writeText(url); toast(t("dash.shareCopied")); }
      catch { toast(url); }
    };
    $("#pl-edit").onclick = () => {
      const box = $("#pl-edit-box");
      const open = box.style.display === "none";
      box.style.display = open ? "" : "none";
      $("#pl-edit").setAttribute("aria-expanded", String(open));
      if (open) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    $("#pl-copy").onclick = async () => {
      const b = $("#pl-copy");
      b.disabled = true;
      await copyPlaylist(pl);
      b.disabled = false;
    };
    $("#pl-del")?.addEventListener("click", async () => {
      if (!window.confirm(t("dash.confirmDelList", { name: listLabel(pl) }))) return;
      await supabaseRequest(`/rest/v1/playlist_items?playlist_id=eq.${restValue(id)}`, { method: "DELETE" });
      await supabaseRequest(`/rest/v1/playlists?playlist_id=eq.${restValue(id)}`, { method: "DELETE" });
      await supabaseRequest(`/rest/v1/playlist_access?playlist_id=eq.${restValue(id)}`, { method: "DELETE" });
      state.playlists = state.playlists.filter((x) => x.playlist_id !== id);
      state.openPlaylist = null;
      toast(t("dash.listDeleted"));
      renderShell();
    });
    $("#pl-items").innerHTML = list.length
      ? list.map((it) => `
        <div class="item-row">
          <img src="${it.poster_path ? C.imgUrl(it.poster_path, "w92") : initialsAvatar(it.title)}" alt="" />
          <div>
            <strong>${escapeHtml(it.title || "Title")}</strong>
            <div class="muted">${t("dash.added", { date: String(it.added_at||"").slice(0,10) })}</div>
          </div>
          <div class="actions">
            <a class="btn btn-sm btn-primary" href="./watch.html?${it.media_type}=${it.tmdb_id}&Playlist=${id}">${t("common.watch")}</a>
            <button class="btn btn-sm btn-ghost" data-del-item="${it.id}" type="button">${t("common.remove")}</button>
          </div>
        </div>`).join("")
      : `<p class="empty">${t("dash.emptyList")}</p>`;
    $("#pl-items").onclick = async (e) => {
      const btn = e.target.closest("[data-del-item]");
      if (!btn) return;
      await supabaseRequest(`/rest/v1/playlist_items?id=eq.${btn.dataset.delItem}`, { method: "DELETE" });
      viewOnePlaylist(main, id);
    };
  }

  function parseTmdbInput(value, type) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const m = raw.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
    if (!m) return null;
    if (type && m[1].toLowerCase() !== type) return null;
    return Number(m[2]);
  }

  const LINK_QUALITIES = ["CAM", "TS", "HDCAM", "HDRip", "WEBRip", "WEB-DL", "BluRay", "720p", "1080p", "1440p", "4K", "8K"];
  const LINK_LANGUAGES = [
    "Arabic", "English", "French", "Spanish", "German", "Italian", "Portuguese",
    "Turkish", "Russian", "Japanese", "Korean", "Chinese", "Hindi", "Dutch",
    "Polish", "Indonesian", "Thai", "Vietnamese", "Persian", "Urdu",
  ];

  function langPickerHtml(id) {
    return `
      <label class="lang-chip all"><input type="checkbox" id="${id}-all" /> ${t("dash.allLangs")}</label>
      ${LINK_LANGUAGES.map((lang) => `<label class="lang-chip"><input type="checkbox" name="${id}" value="${escapeHtml(lang)}" /> ${escapeHtml(lang)}</label>`).join("")}`;
  }

  function selectedSubtitleLanguages() {
    if ($("#lk-sub-all")?.checked) return "all";
    return $$('input[name="lk-sub"]:checked').map((el) => el.value).join(", ");
  }

  function bindLangPicker() {
    const all = $("#lk-sub-all");
    if (!all) return;
    const boxes = () => $$('input[name="lk-sub"]');
    all.onchange = () => {
      boxes().forEach((el) => {
        el.checked = all.checked;
        el.disabled = all.checked;
      });
    };
    boxes().forEach((el) => {
      el.onchange = () => {
        if (!el.checked) all.checked = false;
        else if (boxes().every((x) => x.checked)) {
          all.checked = true;
          boxes().forEach((x) => {
            x.checked = true;
            x.disabled = true;
          });
        }
      };
    });
  }

  function validWatchUrl(value) {
    try {
      const u = new URL(String(value || "").trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function viewLinks(main) {
    const movies = await supabaseRequest(
      `/rest/v1/movielink?member_id=eq.${restValue(state.member.member_id)}&select=*&order=added_at.desc`
    );
    const series = await supabaseRequest(
      `/rest/v1/tvlink?member_id=eq.${restValue(state.member.member_id)}&select=*&order=added_at.desc`
    );
    const movieRows = movies.ok && Array.isArray(movies.data) ? movies.data : [];
    const tvRows = series.ok && Array.isArray(series.data) ? series.data : [];
    main.innerHTML = `
      <p class="eyebrow">${t("dash.linksEyebrow")}</p>
      <h1>${t("dash.addLink")}</h1>
      <p class="muted">${t("dash.linksLead")}</p>
      <div class="stack">
        <div class="form-row">
          <select id="lk-type">
            <option value="movie">${t("common.movie")}</option>
            <option value="tv">${t("common.series")}</option>
          </select>
          <input id="lk-tmdb" placeholder="${t("dash.tmdbPh")}" />
        </div>
        <input id="lk-watch" placeholder="${t("dash.watchPh")}" />
        <div class="form-row tv-fields" id="lk-tv" hidden>
          <input id="lk-season" type="number" min="1" placeholder="${t("dash.seasonPh")}" />
          <input id="lk-episode" type="number" min="1" placeholder="${t("dash.epPh")}" />
        </div>
        <div class="form-row">
          <select id="lk-quality">
            <option value="">${t("common.quality")}</option>
            ${LINK_QUALITIES.map((q) => `<option value="${q}">${q}</option>`).join("")}
          </select>
          <select id="lk-lang">
            <option value="">${t("common.origLang")}</option>
            ${LINK_LANGUAGES.map((l) => `<option value="${l}">${l}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <select id="lk-subs">
            <option value="no">${t("dash.subsNo")}</option>
            <option value="yes">${t("dash.subsYes")}</option>
          </select>
        </div>
        <div class="sub-fields" id="lk-sub-box" hidden>
          <p class="muted">${t("dash.subsHint")}</p>
          <div class="lang-picker">${langPickerHtml("lk-sub")}</div>
        </div>
        <button class="btn btn-sm btn-primary" id="lk-save" type="button">${t("dash.saveLink")}</button>
      </div>
      <h2 style="margin:22px 0 10px">${t("dash.yourMovieLinks")}</h2>
      <div id="lk-movies"></div>
      <h2 style="margin:22px 0 10px">${t("dash.yourSeriesLinks")}</h2>
      <div id="lk-series"></div>`;
    const tvBox = $("#lk-tv");
    const subBox = $("#lk-sub-box");
    $("#lk-type").onchange = (e) => {
      tvBox.hidden = e.target.value !== "tv";
    };
    $("#lk-subs").onchange = (e) => {
      subBox.hidden = e.target.value !== "yes";
    };
    bindLangPicker();
    const watchHrefFor = (r, kind) =>
      kind === "tv"
        ? `./watch.html?tv=${r.tmdb_id}&season=${Number(r.season || 1)}&episode=${Number(r.episode || 1)}`
        : `./watch.html?movie=${r.tmdb_id}`;
    const drawRows = (id, rows, kind) => {
      $(id).innerHTML = rows.length
        ? rows
            .map(
              (r) => `
          <div class="item-row">
            <div></div>
            <a href="${watchHrefFor(r, kind)}">
              <strong>${escapeHtml(r.title || `TMDB ${r.tmdb_id}`)}</strong>
              <div class="muted">${kind === "tv" ? `S${r.season} · E${r.episode} · ` : ""}${r.banned ? t("common.banned") + " · " : ""}${escapeHtml(r.quality || "—")} · ${escapeHtml(r.original_language || "—")} · ${r.has_subtitles ? (r.subtitle_languages === "all" ? t("dash.subsAll") : `Subs: ${escapeHtml(r.subtitle_languages || "yes")}`) : t("dash.noSubs")} · TMDB ${r.tmdb_id} · ${String(r.added_at || "").slice(0, 10)}</div>
            </a>
            <button class="btn btn-sm btn-ghost" data-del-link="${r.id}" data-kind="${kind}" type="button">${t("common.remove")}</button>
          </div>`
            )
            .join("")
        : `<p class="empty">${t("common.none")}</p>`;
    };
    drawRows("#lk-movies", movieRows, "movie");
    drawRows("#lk-series", tvRows, "tv");
    $("#lk-save").onclick = async () => {
      if (!(await C.guardFeature("links"))) return;
      const type = $("#lk-type").value;
      const tmdbId = parseTmdbInput($("#lk-tmdb").value, type);
      const watchUrl = $("#lk-watch").value.trim();
      const quality = $("#lk-quality").value.trim();
      const originalLanguage = $("#lk-lang").value.trim();
      const hasSubtitles = $("#lk-subs").value === "yes";
      if (!tmdbId) return toast(t("dash.needTmdb"));
      if (!validWatchUrl(watchUrl)) return toast(t("dash.needUrl"));
      if (!quality) return toast(t("dash.needQuality"));
      if (!originalLanguage) return toast(t("dash.needLang"));
      let subtitleLanguages = "";
      if (hasSubtitles) {
        subtitleLanguages = selectedSubtitleLanguages();
        if (!subtitleLanguages) return toast(t("dash.needSubs"));
      }
      let season = 0;
      let episode = 0;
      if (type === "tv") {
        season = Number($("#lk-season").value);
        episode = Number($("#lk-episode").value);
        if (!Number.isInteger(season) || season < 1) return toast(t("dash.needSeason"));
        if (!Number.isInteger(episode) || episode < 1) return toast(t("dash.needEpisode"));
      }
      let title = "";
      try {
        const info = await tmdb(`/${type}/${tmdbId}`);
        title = info?.title || info?.name || "";
      } catch {
        title = "";
      }
      const row = {
        tmdb_id: tmdbId,
        member_id: state.member.member_id,
        username: state.member.username,
        watch_url: watchUrl,
        title,
        quality,
        original_language: originalLanguage,
        has_subtitles: hasSubtitles,
        subtitle_languages: subtitleLanguages,
      };
      const table = type === "tv" ? "tvlink" : "movielink";
      if (type === "tv") {
        row.season = season;
        row.episode = episode;
      }
      const dup = await supabaseRequest(
        `/rest/v1/${table}?tmdb_id=eq.${tmdbId}&watch_url=eq.${restValue(watchUrl)}&select=id`
      );
      if (dup.ok && dup.data?.[0]) {
        toast(t("dash.dupUrl"));
        return;
      }
      const saved = await supabaseRequest(`/rest/v1/${table}`, {
        method: "POST",
        body: JSON.stringify(row),
      });
      if (!saved.ok) {
        const raw = JSON.stringify(saved.data || {});
        if (/duplicate|23505/i.test(raw)) return toast(t("dash.dupUrl"));
        toast(t("dash.linkFail"));
        return;
      }
      toast(t("dash.linkSaved"));
      viewLinks(main);
    };
    main.onclick = async (e) => {
      const btn = e.target.closest("[data-del-link]");
      if (!btn) return;
      const table = btn.dataset.kind === "tv" ? "tvlink" : "movielink";
      await supabaseRequest(`/rest/v1/${table}?id=eq.${btn.dataset.delLink}`, { method: "DELETE" });
      toast(t("dash.linkRemoved"));
      viewLinks(main);
    };
  }

  const REPORT_SUBJECTS = () => ({
    misleading: t("dash.rpt.misleading"),
    broken: t("dash.rpt.broken"),
    malicious: t("dash.rpt.malicious"),
    stolen: t("dash.rpt.stolen"),
    bad: t("dash.rpt.bad"),
    indirect: t("dash.rpt.indirect"),
  });

  async function viewReports(main) {
    const incoming = await supabaseRequest(
      `/rest/v1/reportlinks?owner_id=eq.${restValue(state.member.member_id)}&select=*&order=reported_at.desc`
    );
    const outgoing = await supabaseRequest(
      `/rest/v1/reportlinks?reporter_id=eq.${restValue(state.member.member_id)}&select=*&order=reported_at.desc`
    );
    const mineIn = incoming.ok && Array.isArray(incoming.data) ? incoming.data : [];
    const mineOut = outgoing.ok && Array.isArray(outgoing.data) ? outgoing.data : [];
    const validCount = (url, tmdb) =>
      mineIn.filter((r) => r.watch_url === url && Number(r.tmdb_id) === Number(tmdb) && r.verdict === "valid").length;
    const rowHtml = (r, kind) => `
      <div class="mini-card" style="margin-bottom:10px">
        <span class="eyebrow">${escapeHtml(tr(r.media_type || ""))} · ${escapeHtml(r.verdict === "ended" ? t("panel.ended") : r.verdict ? t("panel.valid") : "")}${kind === "in" && validCount(r.watch_url, r.tmdb_id) >= 10 ? " · banned" : ""}</span>
        <h3>${escapeHtml(REPORT_SUBJECTS()[r.subject] || tr(r.subject) || "Report")}</h3>
        <p class="muted">${escapeHtml(r.watch_url || "")}</p>
        <p class="muted">TMDB ${r.tmdb_id} · Owner ${escapeHtml(r.owner_id || "—")} · Reporter ${escapeHtml(r.reporter_id || "—")}</p>
        <p class="muted">Filed ${escapeHtml(String(r.reported_at || "").slice(0, 16).replace("T", " "))} · Verdict ${escapeHtml(String(r.verdict_at || "").slice(0, 16).replace("T", " "))}</p>
      </div>`;
    main.innerHTML = `
      <p class="eyebrow">${t("dash.moderation")}</p>
      <h1>${t("dash.reports")}</h1>
      <p class="muted">${t("dash.reportsLead")}</p>
      <div class="stat-row">
        <div class="stat"><b>${mineIn.length}</b><span>${t("dash.againstYou")}</span></div>
        <div class="stat"><b>${mineOut.length}</b><span>${t("dash.filedByYou")}</span></div>
      </div>
      <h2 style="margin:22px 0 10px">${t("dash.reportsOnYours")}</h2>
      ${mineIn.length ? mineIn.map((r) => rowHtml(r, "in")).join("") : `<p class="empty">${t("dash.noReportsIn")}</p>`}
      <h2 style="margin:22px 0 10px">${t("dash.reportsYouFiled")}</h2>
      ${mineOut.length ? mineOut.map((r) => rowHtml(r, "out")).join("") : `<p class="empty">${t("dash.noReportsOut")}</p>`}`;
  }

  function codeLimit() {
    return PLAN[state.member.membership_type] || PLAN.Free;
  }

  async function viewCodes(main) {
    const plan = codeLimit();
    const res = await supabaseRequest(
      `/rest/v1/codes?owner=eq.${restValue(state.member.member_id)}&select=*&order=created_at.desc`
    );
    const codes = res.ok && Array.isArray(res.data) ? res.data : [];
    main.innerHTML = `
      <p class="eyebrow">${t("dash.accessCodes")}</p>
      <h1>${t("dash.nav.codes")}</h1>
      <p class="muted">${t("dash.codesLead", { plan: tr(state.member.membership_type || "Free"), max: plan.maxCodes, months: plan.months })}</p>
      <div class="form-row">
        <input id="new-code" maxlength="6" placeholder="${t("dash.codePh")}" />
        <button class="btn btn-sm btn-ghost" id="gen-code" type="button">${t("common.generate")}</button>
      </div>
      <div class="form-row">
        <input id="new-ip" placeholder="${t("dash.ipPh")}" />
        <button class="btn btn-sm btn-ghost" id="detect-ip" type="button">${t("dash.detectIp")}</button>
      </div>
      <button class="btn btn-sm btn-primary" id="save-code" type="button">${t("dash.saveCode")}</button>
      <div style="margin-top:18px;overflow:auto">
        <table class="table"><thead><tr><th>${t("dash.nav.codes")}</th><th>${t("common.status")}</th><th>IP</th><th>${t("common.expires")}</th><th></th></tr></thead>
        <tbody id="code-rows"></tbody></table>
      </div>`;
    $("#code-rows").innerHTML = codes.map((c) => `
      <tr>
        <td>${escapeHtml(c.code)}</td>
        <td>${escapeHtml(tr(c.status))}</td>
        <td>${escapeHtml(c.ip || "—")}</td>
        <td>${String(c.expires_at||"").slice(0,10) || "—"}</td>
        <td class="actions">
          <button class="btn btn-sm btn-ghost" data-copy="${escapeHtml(c.code)}" type="button">${t("common.copy")}</button>
          <button class="btn btn-sm btn-danger" data-del="${escapeHtml(c.code)}" type="button">${t("common.delete")}</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="empty">${t("dash.noCodes")}</td></tr>`;
    const fillIp = (ip) => {
      const input = $("#new-ip");
      if (input && ip) input.value = ip;
    };

    async function detectPublicIp() {
      const readers = [
        ["https://api.ipify.org?format=json", (t) => JSON.parse(t).ip],
        ["https://api64.ipify.org?format=json", (t) => JSON.parse(t).ip],
        ["https://api.ipify.org", (t) => t.trim()],
        ["https://ipv4.icanhazip.com/", (t) => t.trim()],
        ["https://icanhazip.com/", (t) => t.trim()],
        ["https://ipwho.is/", (t) => JSON.parse(t).ip],
      ];
      for (const [url, read] of readers) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (!r.ok) continue;
          const ip = String(read(await r.text()) || "").trim();
          if (ip && /^[0-9a-fA-F.:]+$/.test(ip)) return ip;
        } catch {
          /* try next */
        }
      }
      return "";
    }

    function codeSaveMessage(saved) {
      const raw = JSON.stringify(saved?.data || {});
      if (/duplicate|23505/i.test(raw)) return t("dash.codeExists");
      if (/row-level security|42501/i.test(raw)) return t("dash.codeRls");
      if (/PGRST204|schema cache|could not find.*ip/i.test(raw)) return t("dash.codeIpCol");
      if (saved?.data?.message) return saved.data.message;
      return t("dash.codeFail");
    }

    $("#gen-code").onclick = () => {
      $("#new-code").value = String(Math.floor(100000 + Math.random() * 900000));
    };
    $("#detect-ip").onclick = async (e) => {
      e.preventDefault();
      const btn = $("#detect-ip");
      btn.disabled = true;
      btn.textContent = t("dash.detecting");
      const ip = await detectPublicIp();
      btn.disabled = false;
      btn.textContent = t("dash.detectIp");
      if (!ip) {
        toast(t("dash.ipFail"));
        $("#new-ip")?.focus();
        return;
      }
      fillIp(ip);
      toast(t("dash.ipOk", { ip }));
    };
    detectPublicIp().then((ip) => {
      if (ip && !$("#new-ip")?.value) fillIp(ip);
    });
    $("#save-code").onclick = async (e) => {
      e.preventDefault();
      const code = $("#new-code").value.replace(/\D/g, "").slice(0, 6);
      let ip = $("#new-ip").value.trim();
      if (!/^\d{6}$/.test(code)) return toast(t("dash.need6"));
      if (codes.length >= plan.maxCodes) return toast(t("dash.planAllows", { n: plan.maxCodes }));
      if (!ip) {
        ip = await detectPublicIp();
        fillIp(ip);
      }
      if (!ip) return toast(t("dash.needIp"));
      const btn = $("#save-code");
      btn.disabled = true;
      const exp = new Date();
      exp.setMonth(exp.getMonth() + plan.months);
      const row = {
        owner: state.member.member_id,
        code,
        status: "active",
        duration: `${plan.months} month${plan.months > 1 ? "s" : ""}`,
        ip,
        expires_at: exp.toISOString(),
      };
      let saved = await supabaseRequest("/rest/v1/codes", { method: "POST", body: JSON.stringify(row) });
      if (!saved.ok) {
        const raw = JSON.stringify(saved.data || {});
        if (/PGRST204|schema cache|could not find.*ip/i.test(raw)) {
          const { ip: _ip, ...withoutIp } = row;
          saved = await supabaseRequest("/rest/v1/codes", { method: "POST", body: JSON.stringify(withoutIp) });
          if (saved.ok) {
            toast(t("dash.codeSavedNoIp"));
            viewCodes(main);
            return;
          }
        }
        btn.disabled = false;
        return toast(codeSaveMessage(saved));
      }
      toast(t("dash.codeSavedIp", { ip }));
      viewCodes(main);
    };
    $("#code-rows").onclick = async (e) => {
      const copy = e.target.closest("[data-copy]");
      const del = e.target.closest("[data-del]");
      if (copy) {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast(t("dash.codeCopied"));
      }
      if (del) {
        await supabaseRequest(`/rest/v1/codes?code=eq.${restValue(del.dataset.del)}`, { method: "DELETE" });
        toast(t("dash.codeDeleted"));
        viewCodes(main);
      }
    };
  }

  async function viewIptv(main) {
    const me = state.member.member_id;
    const res = await supabaseRequest(`/rest/v1/iptv?or=(type.eq.free,owner_id.eq.${restValue(me)})&select=*&order=id.desc`);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    main.innerHTML = `
      <p class="eyebrow">${t("dash.liveTv")}</p>
      <h1>${t("dash.iptvPacks")}</h1>
      <p class="muted">${t("dash.iptvLead")}</p>
      <div class="ipx-grid" id="ipx-grid">${
        rows.length ? rows.map((p) => {
          const free = String(p.type).toLowerCase() === "free";
          const kind = C.iptvKind(p) === "m3u" ? "M3U" : "Xtream";
          return `
          <article class="ipx-card">
            <header class="ipx-head">
              <h3>${escapeHtml(p.name)}</h3>
              <div class="ipx-badges">
                <span class="ipx-badge ${free ? "free" : "paid"}">${free ? t("panel.iptv.free") : t("panel.iptv.paid")}</span>
                <span class="ipx-badge">${kind}</span>
                <span class="ipx-badge">${t("common.duration")}: ${escapeHtml(p.duration || t("common.unlimited"))}</span>
              </div>
            </header>
            <div class="ipx-rows">${C.iptvDetailRows(p)}</div>
            <footer class="ipx-actions">
              ${C.iptvActionsHtml(p)}
              <a class="btn btn-sm btn-primary" href="./Listchannels.html?package=${encodeURIComponent(p.name)}">${t("common.channels")}</a>
            </footer>
          </article>`;
        }).join("") : `<p class="empty">${t("dash.noIptv")}</p>`
      }</div>`;
    C.bindIptvActions($("#ipx-grid"), (id) => rows.find((x) => String(x.id) === id));
  }

  async function viewViews(main) {
    const mineRes = await supabaseRequest(
      `/rest/v1/views?viewer_id=eq.${restValue(state.member.member_id)}&select=*`
    );
    const ids = state.playlists.map((p) => p.playlist_id).filter(Boolean);
    let extra = [];
    if (ids.length) {
      const other = await supabaseRequest(
        `/rest/v1/views?playlist_id=in.(${ids.join(",")})&select=*`
      );
      extra = other.ok && Array.isArray(other.data) ? other.data : [];
    }
    const viaLinks = await supabaseRequest(
      `/rest/v1/views?link_owner_id=eq.${restValue(state.member.member_id)}&select=*`
    );
    const linkRows = (viaLinks.ok && Array.isArray(viaLinks.data) ? viaLinks.data : []).filter(
      (r) => r.viewer_id !== state.member.member_id
    );
    const rows = [...(mineRes.ok && Array.isArray(mineRes.data) ? mineRes.data : []), ...extra, ...linkRows];
    const mine = rows.filter((r) => r.viewer_id === state.member.member_id);
    const others = extra.filter((r) => r.viewer_id !== state.member.member_id);
    const sum = (arr) => arr.reduce((a, b) => a + Number(b.minutes || 0), 0);
    main.innerHTML = `
      <p class="eyebrow">${t("dash.watchTime")}</p>
      <h1>${t("dash.nav.views")}</h1>
      <div class="toolbar">
        <select id="vf"><option value="all">${t("dash.allTime")}</option><option value="year">${t("dash.thisYear")}</option><option value="month">${t("dash.thisMonth")}</option><option value="week">${t("dash.thisWeek")}</option><option value="day">${t("dash.today")}</option></select>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${sum(mine)}</b><span>${t("dash.yourMin")}</span></div>
        <div class="stat"><b>${sum(others)}</b><span>${t("dash.othersLists")}</span></div>
        <div class="stat"><b>${sum(linkRows)}</b><span>${t("dash.othersLinks")}</span></div>
      </div>
      <div id="view-list"></div>`;
    const draw = () => {
      const f = $("#vf").value;
      const now = new Date();
      const filtered = mine.filter((r) => {
        const d = new Date(r.started_at);
        if (f === "year") return d.getFullYear() === now.getFullYear();
        if (f === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (f === "week") return now - d < 7 * 86400000;
        if (f === "day") return d.toDateString() === now.toDateString();
        return true;
      });
      $("#view-list").innerHTML = filtered.length
        ? `<table class="table"><thead><tr><th>${t("common.id")}</th><th>${t("common.type")}</th><th>${t("common.minutes")}</th><th>${t("common.started")}</th></tr></thead><tbody>${
            filtered.map((r) => `<tr><td>${r.tmdb_id}</td><td>${r.media_type}</td><td>${r.minutes}</td><td>${String(r.started_at).slice(0,16)}</td></tr>`).join("")
          }</tbody></table>`
        : `<p class="empty">${t("dash.noViews")}</p>`;
    };
    $("#vf").onchange = draw;
    draw();
  }

  async function viewAnalytics(main) {
    const movies = await supabaseRequest(
      `/rest/v1/movielink?member_id=eq.${restValue(state.member.member_id)}&select=*&order=added_at.desc`
    );
    const series = await supabaseRequest(
      `/rest/v1/tvlink?member_id=eq.${restValue(state.member.member_id)}&select=*&order=added_at.desc`
    );
    const movieLinks = movies.ok && Array.isArray(movies.data) ? movies.data : [];
    const tvLinks = series.ok && Array.isArray(series.data) ? series.data : [];
    const allLinks = [
      ...movieLinks.map((r) => ({ ...r, media_type: "movie" })),
      ...tvLinks.map((r) => ({ ...r, media_type: "tv" })),
    ];
    const ids = [...new Set(allLinks.map((r) => Number(r.tmdb_id)).filter(Boolean))];
    let visits = [];
    let pageViews = [];
    let linkViews = [];
    if (ids.length) {
      const hist = await supabaseRequest(
        `/rest/v1/hestory?tmdb_id=in.(${ids.join(",")})&select=tmdb_id,media_type,visitor_id`
      );
      visits = hist.ok && Array.isArray(hist.data) ? hist.data : [];
      const pv = await supabaseRequest(
        `/rest/v1/views?tmdb_id=in.(${ids.join(",")})&select=tmdb_id,media_type,minutes,viewer_id,link_owner_id,watch_url,season,episode`
      );
      pageViews = pv.ok && Array.isArray(pv.data) ? pv.data : [];
    }
    const lv = await supabaseRequest(
      `/rest/v1/views?link_owner_id=eq.${restValue(state.member.member_id)}&select=*`
    );
    linkViews = lv.ok && Array.isArray(lv.data) ? lv.data : [];

    const matchLinkViews = (link) =>
      linkViews.filter((v) => {
        if (Number(v.tmdb_id) !== Number(link.tmdb_id)) return false;
        if (String(v.media_type) !== link.media_type) return false;
        if (link.watch_url && v.watch_url) return v.watch_url === link.watch_url;
        if (link.media_type === "tv") {
          return Number(v.season) === Number(link.season) && Number(v.episode) === Number(link.episode);
        }
        return true;
      });

    const draw = () => {
      const type = document.querySelector('input[name="an-ft"]:checked')?.value || "all";
      const links = allLinks.filter((l) => type === "all" || l.media_type === type);
      const tmdbSet = new Set(links.map((l) => Number(l.tmdb_id)));
      const pageVisits = visits.filter(
        (h) => tmdbSet.has(Number(h.tmdb_id)) && (type === "all" || h.media_type === type)
      );
      const titleMinutes = pageViews.filter(
        (v) => tmdbSet.has(Number(v.tmdb_id)) && (type === "all" || v.media_type === type)
      );
      const owned = linkViews.filter((v) => type === "all" || v.media_type === type);
      const pageMin = titleMinutes.reduce((a, r) => a + Number(r.minutes || 0), 0);
      const linkMin = owned.reduce((a, r) => a + Number(r.minutes || 0), 0);
      const visitors = new Set(owned.map((r) => r.viewer_id).filter(Boolean)).size;
      const clicks = owned.length;
      const ctr = pageVisits.length ? ((clicks / pageVisits.length) * 100).toFixed(1) : "0.0";
      $("#an-stats").innerHTML = `
        <div class="stat"><b>${pageVisits.length}</b><span>${t("dash.titleVisits")}</span></div>
        <div class="stat"><b>${pageMin}</b><span>${t("dash.titleMin")}</span></div>
        <div class="stat"><b>${linkMin}</b><span>${t("dash.linkMin")}</span></div>
        <div class="stat"><b>${visitors}</b><span>${t("dash.linkVisitors")}</span></div>
        <div class="stat"><b>${ctr}%</b><span>${t("dash.ctr")}</span></div>`;
      $("#an-table").innerHTML = links.length
        ? `<table class="table"><thead><tr>
            <th>TMDB</th><th>Type</th><th>${t("dash.seEp")}</th><th>${t("dash.linkVisits")}</th><th>${t("dash.linkMin")}</th>
          </tr></thead><tbody>${links
            .map((l) => {
              const rows = matchLinkViews(l);
              const ep = l.media_type === "tv" ? `S${l.season} · E${l.episode}` : t("common.excluded");
              return `<tr>
                <td><a href="${l.media_type === "tv" ? `./watch.html?tv=${l.tmdb_id}&season=${l.season}&episode=${l.episode}` : `./watch.html?movie=${l.tmdb_id}`}">${l.tmdb_id}</a></td>
                <td>${l.media_type === "tv" ? t("common.series") : t("common.movie")}</td>
                <td>${ep}</td>
                <td>${rows.length}</td>
                <td>${rows.reduce((a, r) => a + Number(r.minutes || 0), 0)}</td>
              </tr>`;
            })
            .join("")}</tbody></table>`
        : `<p class="empty">${t("dash.noPub")}</p>`;
    };

    main.innerHTML = `
      <p class="eyebrow">${t("dash.insights")}</p>
      <h1>${t("dash.nav.analytics")}</h1>
      <p class="muted">${t("dash.anLead")}</p>
      <div class="stat-row" id="an-stats"></div>
      <div class="filter-bar">
        <div class="filter-group">
          <span class="muted">${t("common.type")}</span>
          <label class="lang-chip"><input type="radio" name="an-ft" value="all" checked /> ${t("common.all")}</label>
          <label class="lang-chip"><input type="radio" name="an-ft" value="movie" /> ${t("common.movies")}</label>
          <label class="lang-chip"><input type="radio" name="an-ft" value="tv" /> ${t("common.series")}</label>
        </div>
      </div>
      <div style="overflow:auto" id="an-table"></div>`;
    $$('input[name="an-ft"]').forEach((el) => {
      el.onchange = draw;
    });
    draw();
  }

  async function viewPrizes(main) {
    const prizes = await supabaseRequest("/rest/v1/prizes?select=*&order=minutes_required.asc");
    const wins = await supabaseRequest(
      `/rest/v1/winners?member_id=eq.${restValue(state.member.member_id)}&select=*`
    );
    const rawList = prizes.ok && Array.isArray(prizes.data) ? prizes.data : [];
    const ageYears = (iso) => {
      if (!iso) return null;
      const birth = new Date(iso);
      if (Number.isNaN(birth.getTime())) return null;
      let age = new Date().getFullYear() - birth.getFullYear();
      const md = new Date().getMonth() - birth.getMonth();
      if (md < 0 || (md === 0 && new Date().getDate() < birth.getDate())) age -= 1;
      return age;
    };
    const hist = await supabaseRequest(
      `/rest/v1/hestory?visitor_id=eq.${restValue(state.member.member_id)}&select=tmdb_id,media_type`
    );
    const seen = new Set((hist.data || []).map((h) => `${h.media_type}:${h.tmdb_id}`));
    const age = ageYears(state.member.birth_date);
    const country = String(state.profile?.country || state.member.country || "").toLowerCase();
    const uname = String(state.member.username || "").toLowerCase();
    const now = Date.now();
    const list = rawList.filter((p) => {
      const vis = String(p.visibility || "public").toLowerCase();
      if (p.starts_at && Date.parse(p.starts_at) > now) return false;
      if (!p.unlimited_time && p.ends_at && Date.parse(p.ends_at) + 86400000 < now) return false;
      if (p.quantity != null && Number(p.winners_count || 0) >= Number(p.quantity)) return false;
      if (vis === "private") {
        const names = String(p.allowed_usernames || "").toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
        return names.includes(uname) || names.includes(String(state.member.member_id).toLowerCase());
      }
      if (vis === "exclusive") {
        const countries = String(p.countries || "").toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
        if (countries.length && !countries.includes(country)) return false;
        if (p.min_age && age != null && age < Number(p.min_age)) return false;
        if (p.max_age && age != null && age > Number(p.max_age)) return false;
        if (p.watched_tmdb && p.watched_type) {
          if (!seen.has(`${p.watched_type}:${p.watched_tmdb}`)) return false;
        }
      }
      return true;
    });
    const mine = wins.ok && Array.isArray(wins.data) ? wins.data : [];
    // Prizes are paid in points: watch minutes, link shares, playlists,
    // recommendations and comments, each at its own rate.
    const mp = await C.memberPoints(state.member.member_id, state.profile || {});
    const total = mp.available;
    const minutes = Number(state.profile?.private_minutes || 0) + Number(state.profile?.public_minutes || 0);
    const groups = {};
    list.forEach((p) => {
      groups[p.group_name] = groups[p.group_name] || [];
      groups[p.group_name].push(p);
    });
    main.innerHTML = `
      <p class="eyebrow">${t("dash.rewards")}</p>
      <h1>${t("dash.prizes")}</h1>
      <div class="stat"><b>${total}</b><span>${t("points.available")}</span></div>
      <div style="margin-top:14px">${C.pointsHtml(mp)}</div>
      <p class="muted" style="margin-top:10px">${t("dash.totalPrivPub")}: <b>${minutes}</b></p>
      <div class="cards" style="margin-top:16px">${
        Object.keys(groups).length
          ? Object.entries(groups).map(([g, arr]) => `
            <article class="mini-card">
              <img src="${arr[0].group_thumb || initialsAvatar(g)}" alt="" style="width:100%;height:90px;object-fit:cover;border-radius:10px;margin-bottom:8px" />
              <h3>${escapeHtml(g)}</h3>
              <p class="muted">${t("dash.nPrizes", { n: arr.length })}</p>
            </article>`).join("")
          : `<p class="empty">${t("dash.noGroups")}</p>`
      }</div>
      <h2 style="margin:22px 0 10px">${t("dash.availablePrizes")}</h2>
      <div id="prize-list">${list.map((p) => `
        <div class="mini-card" style="margin-bottom:10px">
          <h3>${escapeHtml(p.title)}</h3>
          <p class="muted">${escapeHtml(p.description||"")}</p>
          <p>${escapeHtml(t("prize.points", { n: p.minutes_required }))} · ${p.winners_count||0}/${p.winners_needed||1} winners · ${escapeHtml(p.group_name||"")}</p>
          <button class="btn btn-sm btn-primary" data-claim="${escapeHtml(p.title)}" ${total>=p.minutes_required?"":"disabled"} type="button">${t("dash.requestPrize")}</button>
        </div>`).join("") || `<p class="empty">${t("dash.noPrizes")}</p>`}</div>
      <h2 style="margin:22px 0 10px">${t("dash.yourPrizes")}</h2>
      ${mine.length ? mine.map((w)=>`<p>${escapeHtml(w.prize_title)} · ${w.minutes_paid} min</p>`).join("") : `<p class="empty">${t("dash.noClaim")}</p>`}`;
    main.onclick = async (e) => {
      const btn = e.target.closest("[data-claim]");
      if (!btn || btn.disabled) return;
      const prize = list.find((p) => p.title === btn.dataset.claim);
      if (!prize) return;
      let paid = prize.minutes_required;
      // The server checks the dates, quantity, audience and balance and spends the points
      // in one locked step. Prizes with subscription modes are claimed through their gift mode.
      const modes = await supabaseRequest(`/rest/v1/prize_modes?prize_id=eq.${prize.id}&select=mode,points_cost`);
      const hasModes = modes.ok && Array.isArray(modes.data) && modes.data.length;
      const gift = hasModes ? modes.data.find((m) => m.mode === "gift") : null;
      if (hasModes && !gift) return toast(t("dash.prizeFail"));
      if (gift) paid = gift.points_cost;
      if (!confirm(t("dash.confirmPrize", { n: paid, title: prize.title }))) return;
      const res = hasModes
        ? await C.rpc("prize_join", { p_member: state.member.member_id, p_prize: prize.id, p_mode: "gift", p_code: null })
        : await C.rpc("prize_claim_simple", { p_member: state.member.member_id, p_prize: prize.id });
      if (!res.ok || !res.data?.ok) return toast(t("dash.prizeFail"));
      state.profile.points_spent = Number(state.profile.points_spent || 0) + Number(res.data.cost ?? paid);
      toast(t("dash.prizeOk"));
      viewPrizes(main);
    };
  }

  async function viewHistory(main) {
    const res = await supabaseRequest(
      `/rest/v1/hestory?visitor_id=eq.${restValue(state.member.member_id)}&select=*&order=visited_at.desc`
    );
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    const movies = rows.filter((r) => r.media_type === "movie");
    const series = rows.filter((r) => r.media_type === "tv");
    const block = (title, arr, type) => `
      <h2 style="margin:18px 0 8px">${title}</h2>
      ${arr.length ? arr.map((r)=>`
        <div class="item-row">
          <img src="${r.poster_path ? C.imgUrl(r.poster_path,"w92") : initialsAvatar(r.title)}" alt="" />
          <div><strong>${escapeHtml(r.title||type)}</strong><div class="muted">${String(r.visited_at||"").slice(0,16)}</div></div>
          <a class="btn btn-sm btn-ghost" href="./watch.html?${type}=${r.tmdb_id}">${t("common.open")}</a>
        </div>`).join("") : `<p class="empty">${t("dash.noYet", { what: title })}</p>`}`;
    main.innerHTML = `<p class="eyebrow">${t("dash.visited")}</p><h1>${t("dash.history")}</h1>${block(t("common.movies"), movies, "movie")}${block(t("common.series"), series, "tv")}`;
  }

  async function viewSettings(main) {
    const m = state.member;
    const p = state.profile || {};
    const left = m.membership_expires_at
      ? Math.max(0, Math.ceil((new Date(m.membership_expires_at) - Date.now()) / 86400000))
      : "—";
    main.innerHTML = `
      <p class="eyebrow">${t("dash.settings.eyebrow")}</p>
      <h1>${t("dash.settings.title")}</h1>
      <div class="tabs follow-tabs" role="tablist" data-tabbar="1">
        <button type="button" role="tab" class="follow-tab" data-dtab="set0">${t("dash.tab.profile")}</button>
        <button type="button" role="tab" class="follow-tab" data-dtab="set1">${t("dash.tab.appearance")}</button>
        <button type="button" role="tab" class="follow-tab" data-dtab="set2">${t("dash.tab.account")}</button>
      </div>
      <div class="stack">
        <div class="follow-pane stack" data-dpane="set0">
          <input id="s-name" value="${escapeHtml(m.full_name||"")}" placeholder="${t("common.displayName")}" />
          <textarea id="s-bio" placeholder="${t("common.bio")}">${escapeHtml(p.bio||"")}</textarea>
          <input id="s-avatar" value="${escapeHtml(p.avatar_url||"")}" placeholder="${t("common.avatarUrl")}" />
          <div class="form-row">
            <input id="s-region" value="${escapeHtml(p.region||"")}" placeholder="${t("common.region")}" />
            <input id="s-country" value="${escapeHtml(p.country||m.country||"")}" placeholder="${t("common.country")}" />
          </div>
        </div>
        <div class="follow-pane stack" data-dpane="set1">
          <p class="muted">${t("dash.settings.appearance")}</p>
          <p class="muted">${t("dash.settings.langHint")}</p>
          <div class="form-row">
            <select id="s-theme">
              <option value="night">${t("dash.settings.theme")}</option>
              <option value="day">${t("dash.settings.day")}</option>
            </select>
            <select id="s-lang">
              <option value="en">${t("lang.en")}</option>
              <option value="ar">${t("lang.ar")}</option>
              <option value="fr">${t("lang.fr")}</option>
              <option value="de">${t("lang.de")}</option>
              <option value="es">${t("lang.es")}</option>
              <option value="nl">${t("lang.nl")}</option>
              <option value="it">${t("lang.it")}</option>
            </select>
          </div>
        </div>
        <div class="follow-pane stack" data-dpane="set2">
          <p class="muted">${t("dash.membershipLine", { plan: escapeHtml(tr(m.membership_type||"Free")), left: t("common.daysLeft", { n: left }) })}<a href="./activate.html">${t("common.upgrade")}</a></p>
          <input id="s-email" value="${escapeHtml(m.email||"")}" placeholder="${t("common.email")}" />
          <input id="s-pass" type="password" placeholder="${t("common.newPassword")}" />
          <p class="muted">${t("common.recoveryCode")}: <strong id="s-rec">${escapeHtml(m.recovery_code||t("common.notStored"))}</strong>
            <button class="btn btn-sm btn-ghost" id="copy-rec" type="button">${t("common.copy")}</button></p>
        </div>
        <button class="btn btn-lg btn-primary" id="s-save" type="button">${t("dash.settings.save")}</button>
      </div>`;
    wireTabs(main, "set");
    $("#s-theme").value = getTheme();
    $("#s-lang").value = getLang();
    $("#s-theme").onchange = () => saveAppearancePreference("theme", $("#s-theme").value);
    $("#s-lang").onchange = () => saveAppearancePreference("language", $("#s-lang").value);
    $("#copy-rec").onclick = async () => {
      if (!m.recovery_code) return toast(t("dash.noRec"));
      await navigator.clipboard.writeText(m.recovery_code);
      toast(t("dash.recCopied"));
    };
    $("#s-save").onclick = async () => {
      const body = {
        bio: $("#s-bio").value,
        avatar_url: $("#s-avatar").value.trim(),
        theme: $("#s-theme").value,
        language: $("#s-lang").value,
        region: $("#s-region").value.trim(),
        country: $("#s-country").value.trim(),
      };
      const profileSave = writeProfileSettings(body);
      const mem = { full_name: $("#s-name").value.trim(), email: $("#s-email").value.trim().toLowerCase() };
      const pass = $("#s-pass").value;
      if (pass.length >= 8) mem.password = await sha256(pass);
      const [profileResult, memberResult] = await Promise.all([
        profileSave,
        supabaseRequest(`/rest/v1/members?member_id=eq.${restValue(m.member_id)}`, {
          method: "PATCH",
          body: JSON.stringify(mem),
        }).catch(() => ({ ok: false, status: 0 })),
      ]);
      if (profileResult.ok) Object.assign(state.profile, body);
      if (memberResult.ok) Object.assign(state.member, mem);
      applyPrefs({ language: body.language, theme: body.theme, persist: true });
      toast(profileResult.ok && memberResult.ok ? t("dash.settings.saved") : t("dash.settings.saveFailed"));
    };
  }

  const SECTIONS = ["overview","playlists","links","reports","codes","iptv","views","analytics","prizes","history","settings"];

  async function boot() {
    setupChrome();
    const wanted = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (SECTIONS.includes(wanted)) state.section = wanted;
    state.session = getSession();
    if (!state.session?.member_id) {
      $("#dash-root").innerHTML = gate(
        t("dash.gate.title"),
        t("dash.gate.text"),
        `<a class="btn btn-lg btn-primary" href="./login.html">${t("common.signin")}</a>`
      );
      return;
    }
    state.member = await loadMember(state.session.member_id);
    if (!state.member) {
      $("#dash-root").innerHTML = gate(
        t("dash.gate.title"),
        t("dash.loadFail"),
        `<a class="btn btn-lg btn-primary" href="./login.html">${t("common.signin")}</a>`
      );
      return;
    }
    const sanRes = await supabaseRequest(
      `/rest/v1/sanctions?member_id=eq.${restValue(state.member.member_id)}&select=*`
    );
    state.sanctions = sanRes.ok && Array.isArray(sanRes.data) ? sanRes.data[0] : null;
    if (state.sanctions?.temp_until && Date.parse(state.sanctions.temp_until) > Date.now()) {
      $("#dash-root").innerHTML = gate(
        t("dash.bannedTitle"),
        t("panel.tempUntil", { date: String(state.sanctions.temp_until).slice(0, 16).replace("T", " ") }),
        `<button class="btn btn-lg btn-danger" id="gate-logout" type="button">${t("nav.logout")}</button>`
      );
      $("#gate-logout").onclick = () => { logout(); location.href = "./"; };
      return;
    }
    const staffRes = await supabaseRequest(
      `/rest/v1/staff?member_id=eq.${restValue(state.member.member_id)}&select=role`
    );
    const myRole = staffRes.data?.[0]?.role || "";
    const setRes = await supabaseRequest("/rest/v1/panel_settings?id=eq.1&select=*");
    const ps = setRes.data?.[0] || { show_admin: true, show_moderator: true, show_member: false };
    state.panelVisible =
      myRole === "super" ||
      (myRole === "admin" && ps.show_admin !== false) ||
      (myRole === "moderator" && ps.show_moderator !== false) ||
      (!myRole && ps.show_member === true);
    const status = normalizeAccountStatus(state.member.status);
    if (status === "banned") {
      $("#dash-root").innerHTML = gate(
        t("dash.bannedTitle"),
        t("dash.bannedText"),
        `<button class="btn btn-lg btn-danger" id="gate-logout" type="button">${t("nav.logout")}</button>`
      );
      $("#gate-logout").onclick = () => { logout(); location.href = "./"; };
      return;
    }
    if (status === "disabled") {
      $("#dash-root").innerHTML = gate(
        t("dash.disabledTitle"),
        t("dash.disabledText"),
        `<a class="btn btn-lg btn-primary" href="./activate.html">${t("dash.activate")}</a>`
      );
      return;
    }
    await ensureProfile(state.member);
    applyPrefs({
      language: state.profile?.language,
      theme: state.profile?.theme,
      persist: true,
    });
    await ensurePlaylists(state.member);
    await syncWatchMinutes();
    renderShell();
  }

  viewLinks = tabbed(viewLinks, "links", { first: () => t("dash.addLink") });
  viewReports = tabbed(viewReports, "reports");
  viewPrizes = tabbed(viewPrizes, "prizes", { first: () => t("dash.tabGroups") });
  viewHistory = tabbed(viewHistory, "history");

  document.addEventListener("DOMContentLoaded", boot);
})();
