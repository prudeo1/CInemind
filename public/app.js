const $ = (s) => document.querySelector(s);
let summaryMode = "spoiler-free",
  selectedGenres = new Set(),
  busy = false,
  supabaseClient = null,
  currentUser = null,
  latestPicks = [];
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}
function setBusy(on) {
  busy = on;
  document.body.classList.toggle("analyzing", on);
  document.querySelectorAll('button[type="submit"]').forEach((b) => {
    b.disabled = on;
    b.style.opacity = on ? ".65" : "";
  });
}
function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}
function renderText(el, text) {
  el.innerHTML = "";
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (/^#{1,3}\s/.test(s))
      el.insertAdjacentHTML(
        "beforeend",
        `<h3>${escapeHtml(s.replace(/^#{1,3}\s/, ""))}</h3>`
      );
    else if (/^\*\s/.test(s))
      el.insertAdjacentHTML("beforeend", `<p>• ${escapeHtml(s.slice(2))}</p>`);
    else
      el.insertAdjacentHTML(
        "beforeend",
        `<p>${escapeHtml(s.replace(/^\d+[.)]\s/, ""))}</p>`
      );
  }
}
function movieCard(m) {
  return `<article class="movie-card"><img src="${escapeHtml(
    m.poster || ""
  )}" alt="${escapeHtml(
    m.title
  )} poster" loading="lazy" onerror="this.style.opacity='.15'"><button class="save-movie" data-save="${Number(
    m.id
  )}">＋ Watchlist</button><div class="movie-info"><b>${escapeHtml(
    m.title
  )}</b><small>${escapeHtml(m.year)} · ${escapeHtml(
    (m.genres || []).join(" · ")
  )} · ★ ${escapeHtml(m.rating || "—")}</small><p>${escapeHtml(
    m.overview || ""
  )}</p>${
    m.reason ? `<p class="reason">${escapeHtml(m.reason)}</p>` : ""
  }</div></article>`;
}
function setAccountState(user) {
  currentUser = user;
  $("#authForm").classList.toggle("hidden", !!user);
  $("#signOutBtn").classList.toggle("hidden", !user);
  $("#authMessage").textContent = user
    ? `Signed in as ${user.email}. Your saved films sync with your account.`
    : "Sign in to sync your watchlist across devices.";
  $("#authToggle").textContent = user
    ? (user.email?.[0] || "P").toUpperCase()
    : "P";
  if (user) loadWatchlist();
  else {
    $("#watchlistCount").textContent = "0 SAVED";
    $("#watchlistItems").innerHTML =
      '<p class="muted-note">Sign in to save films for later.</p>';
  }
}
async function loadWatchlist() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient
    .from("watchlist")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    $("#watchlistItems").innerHTML =
      '<p class="muted-note">Could not load watchlist. Check the database setup.</p>';
    return;
  }
  $("#watchlistCount").textContent = `${data.length} SAVED`;
  $("#watchlistItems").innerHTML = data.length
    ? data
        .map(
          (m) =>
            `<div class="watchlist-row"><img src="${escapeHtml(
              m.poster_url || ""
            )}" alt=""><div><b>${escapeHtml(m.title)}</b><small>${escapeHtml(
              m.release_year || ""
            )}</small></div><button data-remove="${
              m.id
            }" aria-label="Remove ${escapeHtml(m.title)}">×</button></div>`
        )
        .join("")
    : '<p class="muted-note">Your watchlist is empty. Save a film you like.</p>';
}
async function saveMovie(id) {
  if (!currentUser) {
    $("#accountPanel").classList.remove("hidden");
    toast("Sign in first to save movies.");
    return;
  }
  const m = latestPicks.find((x) => Number(x.id) === Number(id));
  if (!m) return;
  const { error } = await supabaseClient
    .from("watchlist")
    .upsert(
      {
        user_id: currentUser.id,
        movie_id: m.id,
        title: m.title,
        release_year: m.year,
        poster_url: m.poster,
        overview: m.overview,
      },
      { onConflict: "user_id,movie_id" }
    );
  if (error) {
    toast("Could not save this movie.");
    return;
  }
  toast(`${m.title} added to your watchlist.`);
  loadWatchlist();
}

document.querySelectorAll(".mode").forEach((b) =>
  b.addEventListener("click", () => {
    document
      .querySelectorAll(".mode")
      .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    summaryMode = b.dataset.mode;
  })
);
$("#summaryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const title = $("#movieTitle").value.trim();
  setBusy(true);
  $("#summaryResult").classList.remove("hidden");
  $("#summaryContent").innerHTML = "<p>Reading the story signals…</p>";
  try {
    const d = await api("/api/summarize", { title, mode: summaryMode });
    $("#summaryContent").innerHTML = "";
    renderText($("#summaryContent"), d.answer);
    if (d.movie) {
      const m = d.movie;
      $("#summaryContent").insertAdjacentHTML(
        "afterbegin",
        `<div class="summary-movie-meta">${
          m.poster
            ? `<img src="${escapeHtml(m.poster)}" alt="${escapeHtml(
                m.title
              )} poster">`
            : ""
        }<div><b>${escapeHtml(m.title)} (${escapeHtml(
          m.year
        )})</b><p>${escapeHtml((m.genres || []).join(" · "))} · ★ ${escapeHtml(
          m.rating
        )}</p><p>${escapeHtml(m.overview)}</p></div></div>`
      );
    }
    $("#summaryContent").insertAdjacentHTML(
      "beforeend",
      `<div class="source-note">${
        d.source === "ai"
          ? "AI ANALYSIS · TMDB VERIFIED METADATA"
          : "MOVIE DATABASE INFORMATION"
      }</div>`
    );
    if (d.movie) latestPicks = [d.movie];
  } catch (err) {
    $("#summaryContent").textContent = err.message;
    toast(err.message);
  } finally {
    setBusy(false);
  }
});
$("#clearSummary").addEventListener("click", () =>
  $("#summaryResult").classList.add("hidden")
);
document.querySelectorAll(".chip").forEach((b) =>
  b.addEventListener("click", () => {
    const g = b.dataset.genre;
    if (selectedGenres.has(g)) {
      selectedGenres.delete(g);
      b.classList.remove("selected");
    } else {
      selectedGenres.add(g);
      b.classList.add("selected");
    }
  })
);
$("#recommendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const mood = $("#moodInput").value.trim(),
    genres = [...selectedGenres];
  setBusy(true);
  $("#recommendResult").classList.remove("hidden");
  $("#movieGrid").innerHTML = "";
  $("#recommendIntro").textContent = "Mapping your taste…";
  $("#recommendText").textContent = "";
  try {
    const d = await api("/api/recommend", {
      mood,
      genres,
      era: $("#eraSelect").value,
      avoid: $("#avoidInput").value.trim(),
    });
    latestPicks = d.picks || [];
    $("#recommendIntro").textContent =
      d.intro || "A few films selected for you.";
    $("#recommendSource").textContent =
      d.source === "ai" ? "AI CURATED · TMDB" : "TMDB PICKS";
    $("#movieGrid").innerHTML = latestPicks.map(movieCard).join("");
  } catch (err) {
    $("#recommendIntro").textContent = err.message;
    toast(err.message);
  } finally {
    setBusy(false);
  }
});
$("#movieGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-save]");
  if (b) saveMovie(b.dataset.save);
});
$("#authToggle").addEventListener("click", () =>
  $("#accountPanel").classList.toggle("hidden")
);
$("#closeAccount").addEventListener("click", () =>
  $("#accountPanel").classList.add("hidden")
);
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabaseClient) {
    toast("Add your Supabase project settings first.");
    return;
  }
  const email = $("#authEmail").value.trim();
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin },
  });
  if (error) toast(error.message);
  else toast("Sign-in link sent. Check your email.");
});
$("#signOutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  setAccountState(null);
  toast("Signed out.");
});
$("#watchlistItems").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b || !supabaseClient) return;
  const { error } = await supabaseClient
    .from("watchlist")
    .delete()
    .eq("id", b.dataset.remove);
  if (error) toast("Could not remove this film.");
  else loadWatchlist();
});
async function boot() {
  try {
    const [status, config] = await Promise.all([
      api("/api/status"),
      api("/api/config"),
    ]);
    $("#statusLabel").textContent =
      status.aiEnabled && status.tmdbEnabled
        ? "AI ENGINE READY"
        : status.tmdbEnabled
        ? "MOVIE DATA READY"
        : "SETUP REQUIRED";
    $(".status-dot").style.background =
      status.aiEnabled && status.tmdbEnabled ? "#83d9b5" : "#e5b86b";
    if (config.supabaseUrl && config.supabaseAnonKey && window.supabase) {
      supabaseClient = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey
      );
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      setAccountState(session?.user || null);
      supabaseClient.auth.onAuthStateChange((_event, session) =>
        setAccountState(session?.user || null)
      );
    } else {
      $("#authMessage").textContent =
        "Add Supabase settings to enable account sync and watchlists.";
    }
  } catch (e) {
    $("#statusLabel").textContent = "OFFLINE";
  }
}
boot();
