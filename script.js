// ---------------------------------------------------------------------------
// Telegram WebApp init — con manejo de errores
// ---------------------------------------------------------------------------
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const isFallbackMode = window.telegramFallback || !tg;

if (tg && !isFallbackMode) {
  try {
    tg.ready();
    tg.expand && tg.expand();
    tg.setHeaderColor && tg.setHeaderColor("#0d0a16");
    tg.setBackgroundColor && tg.setBackgroundColor("#0d0a16");
  } catch (e) {
    console.error("Telegram WebApp init error:", e);
  }
}

function haptic(style = "light") {
  if (tg && tg.HapticFeedback && !isFallbackMode) {
    try { tg.HapticFeedback.impactOccurred(style); } catch (e) {}
  }
}

function openLink(url) {
  if (!url) return;
  if (tg && tg.openLink && !isFallbackMode) {
    try { tg.openLink(url, { try_instant_view: false }); return; } catch (e) {}
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// TMDB API config
// ---------------------------------------------------------------------------
// Consigue tu propia clave gratuita en https://www.themoviedb.org/settings/api
// y sustituye el valor de abajo antes de publicar la Mini App.
const TMDB_KEY = "0851eb8df09343f4fcba140a6855957a";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const REGION = "ES";
const LANGUAGE = "es-ES";

async function fetchJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function tmdbUrl(path, params = {}) {
  const usp = new URLSearchParams({
    api_key: TMDB_KEY,
    language: LANGUAGE,
    ...params,
  });
  return `${TMDB_BASE}${path}?${usp.toString()}`;
}

// ---------------------------------------------------------------------------
// Genre maps (fetched once)
// ---------------------------------------------------------------------------
const GENRE_MAP = {};

async function loadGenreMaps() {
  try {
    const [movieGenres, tvGenres] = await Promise.all([
      fetchJSON(tmdbUrl("/genre/movie/list")),
      fetchJSON(tmdbUrl("/genre/tv/list")),
    ]);
    [...(movieGenres.genres || []), ...(tvGenres.genres || [])].forEach(g => {
      GENRE_MAP[g.id] = g.name;
    });
  } catch (e) {
    console.warn("loadGenreMaps failed:", e);
  }
}

function genreNames(ids) {
  return (ids || []).map(id => GENRE_MAP[id]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function mapItem(item, forcedType) {
  const mediaType = forcedType || item.media_type || (item.first_air_date ? "tv" : "movie");
  const title = item.title || item.name || "Sin título";
  const dateStr = item.release_date || item.first_air_date || "";
  return {
    id: item.id,
    mediaType,
    title,
    image: item.poster_path ? `${IMG_BASE}${item.poster_path}` : "",
    genres: genreNames(item.genre_ids),
    rating: item.vote_average || 0,
    released: dateStr ? dateStr.slice(0, 4) : "",
    overview: item.overview || "",
  };
}

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------
const API = {
  async nowPlaying(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/movie/now_playing", { region: REGION, page }));
      return (data.results || []).map(it => mapItem(it, "movie"));
    } catch (e) { console.error("nowPlaying failed:", e); return []; }
  },

  async popularSeries(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/tv/popular", { page }));
      return (data.results || []).map(it => mapItem(it, "tv"));
    } catch (e) { console.error("popularSeries failed:", e); return []; }
  },

  async trending(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/trending/all/week", { page }));
      return (data.results || [])
        .filter(it => it.media_type === "movie" || it.media_type === "tv")
        .map(it => mapItem(it));
    } catch (e) { console.error("trending failed:", e); return []; }
  },

  async discoverMovies(genreId, page = 1) {
    const params = { region: REGION, page, sort_by: "popularity.desc" };
    if (genreId && genreId !== "all") params.with_genres = genreId;
    try {
      const data = await fetchJSON(tmdbUrl("/discover/movie", params));
      return (data.results || []).map(it => mapItem(it, "movie"));
    } catch (e) { console.error("discoverMovies failed:", e); return []; }
  },

  async search(query, page = 1) {
    if (!query) return [];
    try {
      const data = await fetchJSON(tmdbUrl("/search/multi", { query, page, include_adult: false }));
      return (data.results || [])
        .filter(it => it.media_type === "movie" || it.media_type === "tv")
        .map(it => mapItem(it));
    } catch (e) { console.error("search failed:", e); return []; }
  },

  async detail(id, mediaType) {
    const path = mediaType === "tv" ? `/tv/${id}` : `/movie/${id}`;
    return await fetchJSON(tmdbUrl(path, { append_to_response: "watch/providers" }));
  },

  async home() {
    const [estrenos, series, tendencias] = await Promise.allSettled([
      this.nowPlaying(),
      this.popularSeries(),
      this.trending(),
    ]);
    return {
      estrenos: estrenos.status === "fulfilled" ? estrenos.value.slice(0, 6) : [],
      series: series.status === "fulfilled" ? series.value.slice(0, 6) : [],
      tendencias: tendencias.status === "fulfilled" ? tendencias.value.slice(0, 6) : [],
    };
  },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const TAG_LABEL = { movie: "Película", tv: "Serie" };
const TAG_CLASS = { movie: "tag-deal", tv: "tag-free" };
const PLACEHOLDER_GRADIENT = "linear-gradient(135deg, rgba(242,193,78,0.18), rgba(180,108,255,0.14))";

function ratingLine(item) {
  if (item.rating) return `★ ${item.rating.toFixed(1)}`;
  return item.released || "";
}

function cardHTML(item) {
  const cover = item.image
    ? `<img src="${item.image}" alt="" loading="lazy" />`
    : `<div class="cover-fallback" style="background:${PLACEHOLDER_GRADIENT}">🎬</div>`;
  const tagLabel = TAG_LABEL[item.mediaType];
  const meta = item.genres && item.genres.length
    ? item.genres.slice(0, 2).join(" · ")
    : item.released || "";
  const itemData = JSON.stringify(item).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
  return `
    <div class="card" data-id="${item.id}" data-tag="${item.mediaType}">
      <div class="card-cover">
        ${cover}
        ${tagLabel ? `<span class="card-tag ${TAG_CLASS[item.mediaType]}">${tagLabel}</span>` : ""}
      </div>
      <div class="card-body">
        <p class="card-title">${item.title}</p>
        <p class="card-meta">${meta || "&nbsp;"}</p>
        <p class="card-price">${ratingLine(item)}</p>
        <button class="btn btn-primary" data-item='${itemData}'>Ver detalles</button>
      </div>
    </div>
  `;
}

function renderGrid(elId, items, append = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const seenKeys = new Set();
  if (append) {
    el.querySelectorAll(".card[data-id]").forEach(c => seenKeys.add(`${c.dataset.tag || ""}-${c.dataset.id}`));
  }
  const uniqueItems = (items || []).filter(it => {
    const key = `${it.mediaType || ""}-${it.id}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (!append && uniqueItems.length === 0) {
    el.innerHTML = `<div class="empty-state">No hay nada por aquí ahora mismo — vuelve a mirar más tarde.</div>`;
    return;
  }
  const html = uniqueItems.map(cardHTML).join("");
  if (append) {
    el.insertAdjacentHTML("beforeend", html);
  } else {
    el.innerHTML = html;
  }
}

function renderSkeleton(elId, count = 6) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Array.from({ length: count })
    .map(() => `<div class="card skeleton"><div class="card-cover"></div><div class="card-body"><div class="sk-line w70"></div><div class="sk-line w40"></div></div></div>`)
    .join("");
}

function decodeEntities(str) {
  return (str || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function truncateAtBoundary(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastStop > maxLen * 0.4) return slice.slice(0, lastStop + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + "…";
}

// ---------------------------------------------------------------------------
// Detail sheet — incluye "Dónde ver" con datos de JustWatch vía TMDB
// ---------------------------------------------------------------------------
async function openDetailSheet(item) {
  const backdrop = document.getElementById("sheetBackdrop");
  const cover = document.getElementById("sheetCover");
  const title = document.getElementById("sheetTitle");
  const meta = document.getElementById("sheetMeta");
  const ratings = document.getElementById("sheetRatings");
  const desc = document.getElementById("sheetDesc");
  const whereLabel = document.getElementById("sheetWhereLabel");
  const stores = document.getElementById("sheetStores");

  backdrop.classList.add("open");
  title.textContent = item.title;
  meta.textContent = (item.genres && item.genres.length) ? item.genres.slice(0, 2).join(" · ") : (item.released || "");
  desc.textContent = "Cargando...";
  ratings.innerHTML = "";
  whereLabel.style.display = "none";
  stores.innerHTML = "";

  if (item.image) {
    cover.innerHTML = `<img src="${item.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md);" />`;
  } else {
    cover.innerHTML = `<div style="background:${PLACEHOLDER_GRADIENT};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;">🎬</div>`;
  }

  try {
    const detail = await API.detail(item.id, item.mediaType);
    const overview = decodeEntities(detail.overview || item.overview || "");
    desc.textContent = truncateAtBoundary(overview, 500) || "Sinopsis no disponible.";

    let ratingsHTML = "";
    if (detail.vote_average) ratingsHTML += `<span class="rating-badge metacritic">★ ${detail.vote_average.toFixed(1)}</span>`;
    const releaseDate = detail.release_date || detail.first_air_date;
    if (releaseDate) ratingsHTML += `<span class="rating-badge">Estreno: ${releaseDate.slice(0, 4)}</span>`;
    if (detail.runtime) ratingsHTML += `<span class="rating-badge">${detail.runtime} min</span>`;
    if (detail.number_of_seasons) ratingsHTML += `<span class="rating-badge">${detail.number_of_seasons} temporada${detail.number_of_seasons > 1 ? "s" : ""}</span>`;
    ratings.innerHTML = ratingsHTML;

    const providersES = detail["watch/providers"] && detail["watch/providers"].results && detail["watch/providers"].results[REGION];
    if (providersES) {
      whereLabel.style.display = "";
      const groups = [
        { key: "flatrate", label: "Suscripción" },
        { key: "rent", label: "Alquiler" },
        { key: "buy", label: "Compra" },
      ];
      const seen = new Set();
      let chipsHTML = "";
      groups.forEach(g => {
        (providersES[g.key] || []).forEach(p => {
          if (seen.has(p.provider_name)) return;
          seen.add(p.provider_name);
          const logo = p.logo_path ? `${IMG_BASE}${p.logo_path}` : "";
          chipsHTML += `<span class="rating-badge">${logo ? `<img src="${logo}" alt="" style="width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;" />` : ""}${p.provider_name}</span>`;
        });
      });
      if (chipsHTML) {
        stores.innerHTML = `<div class="sheet-ratings" style="margin-bottom:10px;">${chipsHTML}</div>` +
          (providersES.link ? `<button class="btn btn-primary store-btn" data-url="${providersES.link}">🔎 Ver todas las opciones (JustWatch)</button>` : "");
      } else if (providersES.link) {
        stores.innerHTML = `<p class="sheet-meta">No disponible en streaming/alquiler en España por ahora.</p>` +
          `<button class="btn btn-outline store-btn" data-url="${providersES.link}">🔎 Comprobar en JustWatch</button>`;
      } else {
        stores.innerHTML = `<p class="sheet-meta">Sin información de disponibilidad en España.</p>`;
      }
    } else {
      whereLabel.style.display = "";
      stores.innerHTML = `<p class="sheet-meta">Sin información de disponibilidad en España.</p>`;
    }
  } catch (e) {
    console.warn("openDetailSheet failed:", e);
    desc.textContent = decodeEntities(item.overview) || "Sinopsis no disponible.";
    stores.innerHTML = `<p class="sheet-meta">No se pudo cargar la información de disponibilidad.</p>`;
  }

  attachSheetClose();
}

function attachSheetClose() {
  const backdrop = document.getElementById("sheetBackdrop");
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.classList.remove("open");
  };
}

// ---------------------------------------------------------------------------
// Section loaders
// ---------------------------------------------------------------------------
const loaded = new Set();

async function loadHome(force = false) {
  if (loaded.has("home") && !force) return;
  renderSkeleton("grid-home", 6);
  renderSkeleton("grid-series-home", 6);
  renderSkeleton("grid-tendencias-home", 6);
  const data = await API.home();
  renderGrid("grid-home", data.estrenos);
  renderGrid("grid-series-home", data.series);
  renderGrid("grid-tendencias-home", data.tendencias);
  loaded.add("home");
}

function toggleLoadMoreBtn(id, show) {
  const btn = document.getElementById(id);
  if (btn) btn.style.display = show ? "" : "none";
}

let estrenosPage = 1;
async function loadEstrenos(force = false) {
  if (loaded.has("estrenos") && !force) return;
  estrenosPage = 1;
  renderSkeleton("grid-estrenos", 6);
  const data = await API.nowPlaying(estrenosPage);
  renderGrid("grid-estrenos", data);
  loaded.add("estrenos");
  toggleLoadMoreBtn("loadMoreEstrenos", data.length > 0);
}

async function loadMoreEstrenos() {
  const btn = document.getElementById("loadMoreEstrenos");
  if (btn) { btn.disabled = true; btn.textContent = "Cargando..."; }
  estrenosPage += 1;
  const data = await API.nowPlaying(estrenosPage);
  renderGrid("grid-estrenos", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Mostrar más"; }
  toggleLoadMoreBtn("loadMoreEstrenos", data.length > 0);
}

let seriesPage = 1;
async function loadSeries(force = false) {
  if (loaded.has("series") && !force) return;
  seriesPage = 1;
  renderSkeleton("grid-series", 6);
  const data = await API.popularSeries(seriesPage);
  renderGrid("grid-series", data);
  loaded.add("series");
  toggleLoadMoreBtn("loadMoreSeries", data.length > 0);
}

async function loadMoreSeries() {
  const btn = document.getElementById("loadMoreSeries");
  if (btn) { btn.disabled = true; btn.textContent = "Cargando..."; }
  seriesPage += 1;
  const data = await API.popularSeries(seriesPage);
  renderGrid("grid-series", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Mostrar más"; }
  toggleLoadMoreBtn("loadMoreSeries", data.length > 0);
}

async function loadTendencias(force = false) {
  if (loaded.has("tendencias") && !force) return;
  renderSkeleton("grid-tendencias", 9);
  const data = await API.trending(1);
  renderGrid("grid-tendencias", data);
  loaded.add("tendencias");
}

let currentGenre = "all";
let currentQuery = "";
let buscarPage = 1;

async function loadBuscar(force = false) {
  if (loaded.has("donde_ver") && !force && !currentQuery) return;
  buscarPage = 1;
  renderSkeleton("grid-donde_ver", 9);
  const data = currentQuery
    ? await API.search(currentQuery, buscarPage)
    : await API.discoverMovies(currentGenre, buscarPage);
  renderGrid("grid-donde_ver", data);
  loaded.add("donde_ver");
  toggleLoadMoreBtn("loadMoreBuscar", data.length > 0);
}

async function loadMoreBuscar() {
  const btn = document.getElementById("loadMoreBuscar");
  if (btn) { btn.disabled = true; btn.textContent = "Cargando..."; }
  buscarPage += 1;
  const data = currentQuery
    ? await API.search(currentQuery, buscarPage)
    : await API.discoverMovies(currentGenre, buscarPage);
  renderGrid("grid-donde_ver", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Mostrar más"; }
  toggleLoadMoreBtn("loadMoreBuscar", data.length > 0);
}

async function loadGenreChips() {
  const chipsWrap = document.getElementById("genreChips");
  try {
    if (Object.keys(GENRE_MAP).length === 0) await loadGenreMaps();
    const movieGenres = await fetchJSON(tmdbUrl("/genre/movie/list"));
    const all = [{ id: "all", name: "Todos" }, ...(movieGenres.genres || [])];
    chipsWrap.innerHTML = all
      .map((g, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-genre="${g.id}">${g.name}</button>`)
      .join("");
  } catch (e) { chipsWrap.innerHTML = ""; }
}

const SECTION_LOADERS = {
  home: loadHome,
  estrenos: loadEstrenos,
  series: loadSeries,
  tendencias: loadTendencias,
  donde_ver: loadBuscar,
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const tabs = document.querySelectorAll(".tab");
const bnavItems = document.querySelectorAll(".bnav-item");
const panels = document.querySelectorAll(".panel");

function goToSection(section) {
  panels.forEach(p => p.classList.toggle("active", p.id === `section-${section}`));
  tabs.forEach(t => t.classList.toggle("active", t.dataset.section === section));
  bnavItems.forEach(b => b.classList.toggle("active", b.dataset.section === section));
  window.scrollTo({ top: 0 });
  const loader = SECTION_LOADERS[section];
  if (loader) loader();
}

tabs.forEach(tab => tab.addEventListener("click", () => { haptic(); goToSection(tab.dataset.section); }));
bnavItems.forEach(item => item.addEventListener("click", () => { haptic(); goToSection(item.dataset.section); }));

const chipsWrap = document.getElementById("genreChips");
chipsWrap.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  haptic();
  chipsWrap.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  currentGenre = chip.dataset.genre;
  loadBuscar(true);
});

let searchDebounce;
document.getElementById("searchInput").addEventListener("input", (e) => {
  currentQuery = e.target.value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    goToSection("donde_ver");
    loadBuscar(true);
  }, 400);
});

document.querySelector(".content").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-item]");
  if (btn) {
    try {
      const item = JSON.parse(btn.dataset.item.replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
      haptic("medium");
      openDetailSheet(item);
    } catch (e) { console.error("Parse item error:", e); }
  }
});

document.getElementById("sheetBackdrop").addEventListener("click", (e) => {
  const storeBtn = e.target.closest(".store-btn");
  if (storeBtn) {
    const url = storeBtn.dataset.url;
    if (url) { haptic("medium"); openLink(url); }
  }
});

document.getElementById("loadMoreEstrenos")?.addEventListener("click", () => { haptic(); loadMoreEstrenos(); });
document.getElementById("loadMoreSeries")?.addEventListener("click", () => { haptic(); loadMoreSeries(); });
document.getElementById("loadMoreBuscar")?.addEventListener("click", () => { haptic(); loadMoreBuscar(); });

function initFromParams() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  const validSections = Object.keys(SECTION_LOADERS);
  goToSection(validSections.includes(section) ? section : "home");
}

const aboutBtn = document.getElementById("aboutBtn");
const aboutBackdrop = document.getElementById("aboutBackdrop");
if (aboutBtn && aboutBackdrop) {
  aboutBtn.addEventListener("click", () => {
    haptic();
    aboutBackdrop.classList.add("open");
  });
  aboutBackdrop.addEventListener("click", (e) => {
    if (e.target === aboutBackdrop) aboutBackdrop.classList.remove("open");
  });
}

loadGenreMaps().then(() => {
  loadGenreChips();
  initFromParams();
});
