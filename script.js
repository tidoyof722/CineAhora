const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const isFallbackMode = window.telegramFallback || !tg;

if (tg && !isFallbackMode) {
  try {
    tg.ready();
    tg.expand && tg.expand();
    tg.setHeaderColor && tg.setHeaderColor("#0a0a0a");
    tg.setBackgroundColor && tg.setBackgroundColor("#0a0a0a");
  } catch (e) {
    console.error("Error de inicialización de Telegram WebApp:", e);
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

const TMDB_KEY = "0851eb8df09343f4fcba140a6855957a";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const IMG_ORIGINAL = "https://image.tmdb.org/t/p/original";
const REGION = "ES";
const LANGUAGE = "es-ES";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos: suficiente para navegar entre pestañas sin pedir de más

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

function cacheSet(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch (e) { /* sessionStorage lleno o no disponible: seguimos sin caché */ }
}

async function fetchJSON(url, timeout = 10000) {
  const cacheKey = `tmdb:${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const data = await res.json();
    cacheSet(cacheKey, data);
    return data;
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
    console.warn("loadGenreMaps falló:", e);
  }
}

function genreNames(ids) {
  return (ids || []).map(id => GENRE_MAP[id]).filter(Boolean);
}

function mapItem(item, forcedType) {
  const mediaType = forcedType || item.media_type || (item.first_air_date ? "tv" : "movie");
  const title = item.title || item.name || "Sin título";
  const dateStr = item.release_date || item.first_air_date || "";
  return {
    id: item.id,
    mediaType,
    title,
    image: item.poster_path ? `${IMG_BASE}${item.poster_path}` : "",
    backdrop: item.backdrop_path ? `${IMG_ORIGINAL}${item.backdrop_path}` : "",
    genres: genreNames(item.genre_ids),
    rating: item.vote_average || 0,
    released: dateStr ? dateStr.slice(0, 4) : "",
    overview: item.overview || "",
  };
}

const API = {
  async nowPlaying(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/movie/now_playing", { region: REGION, page }));
      return (data.results || []).map(it => mapItem(it, "movie"));
    } catch (e) { console.error("nowPlaying falló:", e); return []; }
  },

  async popularSeries(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/tv/popular", { page }));
      return (data.results || []).map(it => mapItem(it, "tv"));
    } catch (e) { console.error("popularSeries falló:", e); return []; }
  },

  async trending(page = 1) {
    try {
      const data = await fetchJSON(tmdbUrl("/trending/all/week", { page }));
      return (data.results || [])
        .filter(it => it.media_type === "movie" || it.media_type === "tv")
        .map(it => mapItem(it));
    } catch (e) { console.error("trending falló:", e); return []; }
  },

  async discoverMovies(genreId, page = 1) {
    const params = { region: REGION, page, sort_by: "popularity.desc" };
    if (genreId && genreId !== "all") params.with_genres = genreId;
    try {
      const data = await fetchJSON(tmdbUrl("/discover/movie", params));
      return (data.results || []).map(it => mapItem(it, "movie"));
    } catch (e) { console.error("discoverMovies falló:", e); return []; }
  },

  async search(query, page = 1) {
    if (!query) return [];
    try {
      const data = await fetchJSON(tmdbUrl("/search/multi", { query, page, include_adult: false }));
      return (data.results || [])
        .filter(it => it.media_type === "movie" || it.media_type === "tv")
        .map(it => mapItem(it));
    } catch (e) { console.error("search falló:", e); return []; }
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
      estrenos: estrenos.status === "fulfilled" ? estrenos.value.slice(0, 12) : [],
      series: series.status === "fulfilled" ? series.value.slice(0, 12) : [],
      tendencias: tendencias.status === "fulfilled" ? tendencias.value.slice(0, 12) : [],
    };
  },
};

const TAG_LABEL = { movie: "Película", tv: "Serie" };
const TAG_ICON = { movie: "film", tv: "tv" };

function getRatingClass(rating) {
  if (rating >= 7) return "";
  if (rating >= 5) return "mid";
  return "bad";
}

function cardHTML(item) {
  const cover = item.image
    ? `<img src="${item.image}" alt="" loading="lazy" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--surface-2);"><i data-lucide="film" style="width:48px;height:48px;opacity:0.3;"></i></div>`;
  
  const rating = item.rating ? item.rating.toFixed(1) : "N/A";
  const meta = item.genres && item.genres.length ? item.genres.slice(0, 2).join(" • ") : item.released;
  
  return `
    <div class="card" data-id="${item.id}" data-tag="${item.mediaType}">
      <div class="card-cover">
        ${cover}
        <div class="rating-badge ${getRatingClass(item.rating)}">
          <i data-lucide="star" style="fill:currentColor;"></i>
          ${rating}
        </div>
        <span class="card-type">
          <i data-lucide="${TAG_ICON[item.mediaType]}"></i>
          ${TAG_LABEL[item.mediaType]}
        </span>
      </div>
      <div class="card-body">
        <p class="card-title">${item.title}</p>
        <p class="card-meta">${meta || "&nbsp;"}</p>
      </div>
    </div>
  `;
}

function renderCarousel(elId, items) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = `<div class="empty-state"><i data-lucide="frown"></i><span>No se encontró nada</span></div>`;
    lucide.createIcons();
    return;
  }
  el.innerHTML = items.map(cardHTML).join("");
  lucide.createIcons();
  
  el.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => {
      try {
        const fullItem = items.find(i => i.id == card.dataset.id);
        haptic("medium");
        openDetailSheet(fullItem);
      } catch (e) { console.error("Error al analizar item:", e); }
    });
  });
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
    el.innerHTML = `<div class="empty-state"><i data-lucide="frown"></i><span>No se encontró nada</span></div>`;
    lucide.createIcons();
    return;
  }
  
  const html = uniqueItems.map(cardHTML).join("");
  if (append) {
    el.insertAdjacentHTML("beforeend", html);
  } else {
    el.innerHTML = html;
  }
  lucide.createIcons();

  el.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => {
      const fullItem = uniqueItems.find(i => i.id == card.dataset.id);
      haptic("medium");
      openDetailSheet(fullItem);
    });
  });
}

function renderSkeleton(elId, count = 6) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Array.from({ length: count })
    .map(() => `<div class="card skeleton"><div class="card-cover"></div><div class="card-body"></div></div>`)
    .join("");
}

async function openDetailSheet(item) {
  const backdrop = document.getElementById("sheetBackdrop");
  const cover = document.getElementById("sheetCover");
  const title = document.getElementById("sheetTitle");
  const meta = document.getElementById("sheetMeta");
  const ratings = document.getElementById("sheetRatings");
  const desc = document.getElementById("sheetDesc");
  const stores = document.getElementById("sheetStores");

  backdrop.classList.add("open");
  title.textContent = item.title;
  meta.innerHTML = `
    <span class="sheet-meta-item">
      <i data-lucide="calendar"></i>
      ${item.released}
    </span>
    <span class="sheet-meta-item">
      <i data-lucide="clapperboard"></i>
      ${(item.genres && item.genres.length) ? item.genres.slice(0, 3).join(" • ") : ""}
    </span>
  `;
  desc.textContent = "Cargando...";
  ratings.innerHTML = "";
  stores.innerHTML = "";

  if (item.image) {
    cover.innerHTML = `<img src="${item.image}" alt="" />`;
  } else {
    cover.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--surface-2);"><i data-lucide="film" style="width:64px;height:64px;opacity:0.3;"></i></div>`;
  }

  try {
    const detail = await API.detail(item.id, item.mediaType);
    desc.textContent = detail.overview || item.overview || "Descripción no disponible.";

    let ratingsHTML = "";
    if (detail.vote_average) {
      ratingsHTML += `<span class="rating-pill" style="color: var(--rating-good); border-color: var(--rating-good);">
        <i data-lucide="star" style="fill:currentColor;"></i>
        ${detail.vote_average.toFixed(1)}
      </span>`;
    }
    if (detail.runtime) ratingsHTML += `<span class="rating-pill">
      <i data-lucide="clock"></i>
      ${detail.runtime} min
    </span>`;
    if (detail.number_of_seasons) ratingsHTML += `<span class="rating-pill">
      <i data-lucide="layers"></i>
      ${detail.number_of_seasons} temporada(s)
    </span>`;
    ratings.innerHTML = ratingsHTML;

    const providers = detail["watch/providers"]?.results?.[REGION];
    if (providers) {
      const groups = [
        { key: "flatrate", label: "Suscripción" },
        { key: "rent", label: "Alquiler" },
        { key: "buy", label: "Compra" },
      ];
      const seen = new Set();
      let chipsHTML = "";
      
      groups.forEach(g => {
        (providers[g.key] || []).forEach(p => {
          if (seen.has(p.provider_name)) return;
          seen.add(p.provider_name);
          const logo = p.logo_path ? `${IMG_BASE}${p.logo_path}` : "";
          chipsHTML += `<span class="rating-pill">${logo ? `<img src="${logo}" alt="" style="width:18px;height:18px;border-radius:4px;vertical-align:-4px;margin-right:6px;" />` : ""}${p.provider_name}</span>`;
        });
      });
      
      if (chipsHTML) {
        stores.innerHTML = `<div class="sheet-ratings">${chipsHTML}</div>` +
          (providers.link ? `<button class="btn btn-primary store-btn" data-url="${providers.link}">
            <i data-lucide="external-link"></i>
            Abrir en JustWatch
          </button>` : "");
      } else {
        stores.innerHTML = `<p style="color: var(--text-muted); font-size: 14px;">No hay datos de streaming en tu región.</p>`;
      }
    } else {
      stores.innerHTML = `<p style="color: var(--text-muted); font-size: 14px;">No hay datos de streaming en tu región.</p>`;
    }
  } catch (e) {
    console.warn("openDetailSheet falló:", e);
    desc.textContent = item.overview || "Descripción no disponible.";
  }

  lucide.createIcons();
  attachSheetClose();
}

function attachSheetClose() {
  const backdrop = document.getElementById("sheetBackdrop");
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.classList.remove("open");
  };
}

const loaded = new Set();

async function loadHome(force = false) {
  if (loaded.has("home") && !force) return;
  renderSkeleton("carousel-tendencias-home", 6);
  renderSkeleton("carousel-estrenos-home", 6);
  renderSkeleton("carousel-series-home", 6);
  
  const data = await API.home();
  
  if (data.tendencias.length > 0) {
    const heroItem = data.tendencias[0];
    const heroBanner = document.getElementById("heroBanner");
    if (heroItem.backdrop) {
      heroBanner.style.backgroundImage = `url(${heroItem.backdrop})`;
    }
    document.getElementById("heroTitle").textContent = heroItem.title;
    document.getElementById("heroMeta").innerHTML = `
      <span class="hero-meta-item hero-rating">
        <i data-lucide="star" style="fill:currentColor;"></i>
        ${heroItem.rating.toFixed(1)}
      </span>
      <span class="hero-meta-item">
        <i data-lucide="calendar"></i>
        ${heroItem.released}
      </span>
      <span class="hero-meta-item">
        <i data-lucide="clapperboard"></i>
        ${heroItem.genres.slice(0, 2).join(" • ")}
      </span>
    `;
    
    document.getElementById("heroWatchBtn").onclick = () => {
      haptic("medium");
      openDetailSheet(heroItem);
    };
    document.getElementById("heroInfoBtn").onclick = () => {
      haptic("medium");
      openDetailSheet(heroItem);
    };
  }

  renderCarousel("carousel-tendencias-home", data.tendencias);
  renderCarousel("carousel-estrenos-home", data.estrenos);
  renderCarousel("carousel-series-home", data.series);
  loaded.add("home");
}

function toggleLoadMoreBtn(id, show) {
  const btn = document.getElementById(id);
  if (btn) btn.style.display = show ? "block" : "none";
}

let estrenosPage = 1;
async function loadEstrenos(force = false) {
  if (loaded.has("estrenos") && !force) return;
  estrenosPage = 1;
  renderSkeleton("grid-estrenos", 8);
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
  if (btn) { btn.disabled = false; btn.textContent = "Cargar más"; }
  toggleLoadMoreBtn("loadMoreEstrenos", data.length > 0);
}

let seriesPage = 1;
async function loadSeries(force = false) {
  if (loaded.has("series") && !force) return;
  seriesPage = 1;
  renderSkeleton("grid-series", 8);
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
  if (btn) { btn.disabled = false; btn.textContent = "Cargar más"; }
  toggleLoadMoreBtn("loadMoreSeries", data.length > 0);
}

async function loadTendencias(force = false) {
  if (loaded.has("tendencias") && !force) return;
  renderSkeleton("grid-tendencias", 10);
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
  renderSkeleton("grid-donde_ver", 10);
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
  if (btn) { btn.disabled = false; btn.textContent = "Cargar más"; }
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

const tabs = document.querySelectorAll(".tab");
const bnavItems = document.querySelectorAll(".bnav-item");
const panels = document.querySelectorAll(".panel");

function goToSection(section) {
  panels.forEach(p => p.classList.toggle("active", p.id === `section-${section}`));
  tabs.forEach(t => t.classList.toggle("active", t.dataset.section === section));
  bnavItems.forEach(b => b.classList.toggle("active", b.dataset.section === section));
  window.scrollTo({ top: 0, behavior: "smooth" });
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

lucide.createIcons();

// --- Drag-to-scroll (ratón de escritorio) para .carousel, igual que el swipe en móvil ---
function enableDragScroll(el) {
  if (!el || el.dataset.dragEnabled) return;
  el.dataset.dragEnabled = "1";

  let isDown = false;
  let dragged = false;
  let startX = 0;
  let startScroll = 0;

  const DRAG_THRESHOLD = 6; // px antes de considerarlo un arrastre real

  el.addEventListener("mousedown", (e) => {
    // Ignorar botones que no sean el principal
    if (e.button !== 0) return;
    isDown = true;
    dragged = false;
    startX = e.pageX;
    startScroll = el.scrollLeft;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    const delta = e.pageX - startX;
    if (!dragged && Math.abs(delta) > DRAG_THRESHOLD) {
      dragged = true;
      el.classList.add("dragging");
    }
    if (dragged) {
      e.preventDefault();
      el.scrollLeft = startScroll - delta;
    }
  });

  function endDrag() {
    if (!isDown) return;
    isDown = false;
    if (dragged) {
      el.classList.remove("dragging");
      // Evita que el "click" que sigue al soltar abra una tarjeta sin querer
      const blockClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        el.removeEventListener("click", blockClick, true);
      };
      el.addEventListener("click", blockClick, true);
    }
    dragged = false;
  }

  window.addEventListener("mouseup", endDrag);
  el.addEventListener("mouseleave", () => { if (isDown && !dragged) isDown = false; });

  // Evita el "fantasma" de arrastrar imágenes/nativo del navegador
  el.addEventListener("dragstart", (e) => e.preventDefault());
}

function enableDragScrollAll() {
  document.querySelectorAll(".carousel").forEach(enableDragScroll);
}

// Vuelve a aplicarse cada vez que cambian de sección o se recargan carruseles,
// por si aparecen nuevos elementos .carousel en el DOM.
const dragScrollObserver = new MutationObserver(() => enableDragScrollAll());
dragScrollObserver.observe(document.body, { childList: true, subtree: true });
enableDragScrollAll();

loadGenreMaps().then(() => {
  loadGenreChips();
  initFromParams();
});