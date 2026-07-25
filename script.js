// ---------------------------------------------------------------------------
// Telegram WebApp init — с обработкой ошибок
// ---------------------------------------------------------------------------
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const isFallbackMode = window.telegramFallback || !tg;

if (tg && !isFallbackMode) {
  try {
    tg.ready();
    tg.expand && tg.expand();
    tg.setHeaderColor && tg.setHeaderColor("#0a0e16");
    tg.setBackgroundColor && tg.setBackgroundColor("#0a0e16");
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
// API Keys & Base URLs
// ---------------------------------------------------------------------------
const RAWG_KEY = "3d423ceea09d4b4d879d50e7585b20a6";
const RAWG_BASE = "https://api.rawg.io/api";
const GAMERPOWER_BASE = "https://www.gamerpower.com/api";
const CHEAPSHARK_BASE = "https://www.cheapshark.com/api/1.0";

// ---------------------------------------------------------------------------
// RAWG Store IDs → names & CSS classes
// ---------------------------------------------------------------------------
const RAWG_STORES = {
  1:  { name: "Steam",        cls: "steam" },
  6:  { name: "GOG",          cls: "gog" },
  13: { name: "Epic Games",   cls: "epic" },
  33: { name: "GOG",          cls: "gog" },
  34: { name: "Steam",        cls: "steam" },
  35: { name: "Epic Games",   cls: "epic" },
  40: { name: "Epic Games",   cls: "epic" },
};

function getStoreInfo(storeId) {
  return RAWG_STORES[storeId] || { name: "Mağaza", cls: "" };
}

// ---------------------------------------------------------------------------
// Fetch helper с таймаутом
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------
const API = {
  async newReleases(page = 1) {
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(today.getMonth() - 6);
    const dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
    const dateTo = today.toISOString().slice(0, 10);
    const url = `${RAWG_BASE}/games?key=${RAWG_KEY}&dates=${dateFrom},${dateTo}&ordering=-added&page_size=20&page=${page}`;
    try {
      const data = await fetchJSON(url);
      if (data.results && data.results.length > 0) {
        return data.results.map(mapRawgGame).map(g => ({ ...g, tag: "new" }));
      }
    } catch (e) { console.error("newReleases failed:", e); }
    try {
      const fallbackUrl = `${RAWG_BASE}/games?key=${RAWG_KEY}&ordering=-rating&page_size=20&page=${page}`;
      const data = await fetchJSON(fallbackUrl);
      return data.results.map(mapRawgGame).map(g => ({ ...g, tag: "new" }));
    } catch (e) { return []; }
  },

  async discover(genre, q, page = 1) {
    let url = `${RAWG_BASE}/games?key=${RAWG_KEY}&page_size=20&page=${page}`;
    if (q) url += `&search=${encodeURIComponent(q)}`;
    if (genre && genre !== "all") url += `&genres=${genre}`;
    url += `&ordering=-rating`;
    try {
      const data = await fetchJSON(url);
      return data.results.map(mapRawgGame).map(g => ({ ...g, tag: "discover" }));
    } catch (e) { return []; }
  },

  async gameDetail(id) {
    const url = `${RAWG_BASE}/games/${id}?key=${RAWG_KEY}`;
    return await fetchJSON(url);
  },

  // The /games/{id} endpoint's `stores` array only has store id + name —
  // NOT a working url. The real per-store purchase links only come from
  // this separate endpoint. Without this call the detail sheet can never
  // show a working "open in store" button for non-giveaway/non-deal games.
  async gameStores(id) {
    const url = `${RAWG_BASE}/games/${id}/stores?key=${RAWG_KEY}`;
    try {
      const data = await fetchJSON(url);
      return data.results || [];
    } catch (e) {
      console.warn("gameStores failed:", e);
      return [];
    }
  },

  async genres() {
    try {
      const data = await fetchJSON(`${RAWG_BASE}/genres?key=${RAWG_KEY}`);
      return data.results.map(g => ({ slug: g.slug, name: g.name }));
    } catch (e) { return []; }
  },

  async freeGamesGamerPower() {
    const url = `${GAMERPOWER_BASE}/giveaways?type=game&sort-by=value`;
    try {
      const data = await fetchJSON(url, 6000);
      return data.map(mapGamerpowerGame);
    } catch (e) {
      console.warn("GamerPower direct fetch failed (CORS?), trying proxy:", e);
    }
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const data = await fetchJSON(proxyUrl, 8000);
      return data.map(mapGamerpowerGame);
    } catch (e) {
      console.error("GamerPower fetch failed completely:", e);
      return [];
    }
  },

  // Official Epic Games Store endpoint for the current weekly free game(s).
  // No API key, no CORS proxy needed, and it's the authoritative source for
  // Epic freebies specifically — a nice reliability backstop next to
  // GamerPower, which aggregates many sites and occasionally lags or hits
  // CORS issues.
  async freeGamesEpic() {
    const url = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=tr-TR&country=TR&allowCountries=TR";
    try {
      const data = await fetchJSON(url, 6000);
      const elements = (data && data.data && data.data.Catalog && data.data.Catalog.searchStore && data.data.Catalog.searchStore.elements) || [];
      const now = Date.now();
      return elements
        .filter(el => {
          const bundles = (el.promotions && el.promotions.promotionalOffers) || [];
          const offers = bundles.flatMap(b => b.promotionalOffers || []);
          return offers.some(o => {
            const start = new Date(o.startDate).getTime();
            const end = new Date(o.endDate).getTime();
            const pct = o.discountSetting ? o.discountSetting.discountPercentage : null;
            return start <= now && now <= end && pct === 0;
          });
        })
        .map(mapEpicGame);
    } catch (e) {
      console.warn("Epic free games fetch failed:", e);
      return [];
    }
  },

  async freeGames() {
    const [epicResult, gpResult] = await Promise.allSettled([
      this.freeGamesEpic(),
      this.freeGamesGamerPower()
    ]);
    const epic = epicResult.status === "fulfilled" ? epicResult.value : [];
    const gp = gpResult.status === "fulfilled" ? gpResult.value : [];
    const seen = new Set(epic.map(g => g.title.trim().toLowerCase()));
    const rest = gp.filter(g => {
      const key = g.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...epic, ...rest];
  },

  async hotDeals(page = 1) {
    try {
      const pageNumber = page - 1; // CheapShark's pageNumber is zero-indexed
      const url = `${CHEAPSHARK_BASE}/deals?sortBy=DealRating&pageSize=20&pageNumber=${pageNumber}&onSale=1&upperPrice=30`;
      const deals = await fetchJSON(url);
      const detailedDeals = await Promise.all(
        deals.slice(0, 12).map(async (deal) => {
          try {
            const detail = await fetchJSON(`${CHEAPSHARK_BASE}/deals?id=${deal.dealID}`);
            return { ...deal, gameInfo: detail.gameInfo || null };
          } catch (e) { return { ...deal, gameInfo: null }; }
        })
      );
      const mapped = detailedDeals.map(mapCheapsharkDeal);
      const seen = new Set();
      const deduped = [];
      for (const g of mapped) {
        const key = g.title.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(g);
      }
      return deduped;
    } catch (e) { return []; }
  },

  async news() {
    const feeds = [
      { url: "https://www.log.com.tr/feed/", lang: "tr" },
      { url: "https://shiftdelete.net/feed", lang: "tr" },
      { url: "https://www.gamesradar.com/feeds/tag/games", lang: "en" },
      { url: "https://www.eurogamer.net/feed", lang: "en" }
    ];
    const allNews = [];
    for (const feed of feeds) {
      try {
        const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
        const data = await fetchJSON(rss2jsonUrl, 5000);
        if (data.status === "ok" && data.items) {
          data.items.slice(0, 6).forEach(item => {
            const rawText = item.content || item.description || "";
            const withBreaks = rawText
              .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<[^>]*>/g, "");
            const cleanText = withBreaks.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
            const flatSummary = cleanText.replace(/\s+/g, " ").trim();
            if (!isGameRelated(item.title || "", flatSummary)) return;
            let sourceHost = "";
            try { sourceHost = new URL(feed.url).hostname.replace(/^www\./, ""); } catch (e) {}
            allNews.push({
              id: item.link || item.guid || `${feed.url}-${item.title}`,
              title: item.title || "Untitled",
              summary: flatSummary.slice(0, 150),
              content: cleanText,
              link: item.link || "#",
              image: item.thumbnail || (item.enclosure && item.enclosure.link) || "",
              published: item.pubDate || new Date().toISOString(),
              lang: feed.lang,
              source: sourceHost
            });
          });
        }
      } catch (e) { console.warn(`RSS failed: ${feed.url}`, e); }
    }
    const seenIds = new Set();
    const dedupedNews = allNews.filter(n => {
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return true;
    });
    return dedupedNews.sort((a, b) => new Date(b.published) - new Date(a.published)).slice(0, 15);
  },

  async home() {
    const [newReleases, freeGames, hotDeals, news] = await Promise.allSettled([
      this.newReleases(),
      this.freeGames(),
      this.hotDeals(),
      this.news()
    ]);
    return {
      new_releases: newReleases.status === "fulfilled" ? newReleases.value.slice(0, 6) : [],
      free_games: freeGames.status === "fulfilled" ? freeGames.value.slice(0, 6) : [],
      hot_deals: hotDeals.status === "fulfilled" ? hotDeals.value.slice(0, 6) : [],
      news: news.status === "fulfilled" ? news.value.slice(0, 3) : []
    };
  }
};

// ---------------------------------------------------------------------------
// News relevance filter — keeps non-gaming content (sports, TV, general tech)
// out even if it slips through a broader feed
// ---------------------------------------------------------------------------
const NON_GAME_HINTS = [
  "world cup", "how to watch", "live stream", "premier league", "champions league",
  "uefa", "fifa world cup", "olympics", "election", "senate", "parliament",
  "tv series", "season finale", "box office", "concert tour"
];
const GAME_HINTS = [
  "game", "oyun", "steam", "epic games", "playstation", "ps5", "ps4", "xbox",
  "nintendo", "switch", "dlc", "patch", "update", "rpg", "fps", "gameplay",
  "trailer", "expansion", "beta", "early access", "esports", "mod", "console",
  "pc gaming", "indie", "multiplayer", "publisher", "developer", "studio"
];

function isGameRelated(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const looksOffTopic = NON_GAME_HINTS.some(w => text.includes(w));
  if (looksOffTopic) {
    const hasGameContext = GAME_HINTS.some(w => text.includes(w));
    if (!hasGameContext) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function mapRawgGame(game) {
  const stores = (game.stores || []).map(s => ({
    id: s.store.id,
    name: s.store.name,
    url: s.url || ""
  }));
  return {
    id: game.id,
    title: game.name || "Unknown",
    image: game.background_image || "",
    url: `https://rawg.io/games/${game.slug}`,
    genres: game.genres ? game.genres.map(g => g.name) : [],
    rating: game.rating || 0,
    released: game.released ? game.released.slice(0, 4) : "",
    description: game.description_short || game.description || "",
    metacritic: game.metacritic || null,
    platforms: game.platforms ? game.platforms.map(p => p.platform.name) : [],
    stores: stores
  };
}

// GamerPower's real claim-link field is `open_giveaway_url` — older code (and
// some third-party mirrors) call it `open_url`, which does not exist on the
// live API and silently produced empty links for every giveaway. Falling
// back through all known variants keeps this working even if the API
// changes again.
function gamerpowerLink(item) {
  return item.open_giveaway_url || item.open_url || item.gamerpower_url || "";
}

function mapGamerpowerGame(item) {
  const link = gamerpowerLink(item);
  const allStores = detectAllStoresFromGamerpower(item, link);
  const primary = allStores[0] || { name: item.platforms || "PC", url: link, cls: "", icon: "🎮" };
  return {
    id: item.id,
    title: item.title || "Unknown",
    image: item.image || item.thumbnail || "",
    url: link,
    genres: item.type ? [item.type] : [],
    price: item.worth || "0",
    store: primary.name,
    storeUrl: primary.url,
    storeClass: primary.cls,
    storeIcon: primary.icon,
    stores: allStores,
    tag: "free",
    salePrice: "0",
    normalPrice: item.worth || "0",
    description: item.description || "",
    instructions: item.instructions || "",
    platforms: item.platforms ? [item.platforms] : []
  };
}

function mapEpicGame(el) {
  const images = el.keyImages || [];
  const image = (images.find(i => i.type === "OfferImageWide") || images.find(i => i.type === "Thumbnail") || images[0] || {}).url || "";
  const slug = el.productSlug
    || (el.offerMappings && el.offerMappings[0] && el.offerMappings[0].pageSlug)
    || (el.catalogNs && el.catalogNs.mappings && el.catalogNs.mappings[0] && el.catalogNs.mappings[0].pageSlug)
    || "";
  const url = slug ? `https://store.epicgames.com/tr/p/${slug}` : "https://store.epicgames.com/tr/free-games";
  const normalCents = el.price && el.price.totalPrice ? el.price.totalPrice.originalPrice : 0;
  const normalPrice = normalCents ? (normalCents / 100).toFixed(2) : "0";
  const store = { name: "Epic Games", url, cls: "epic", icon: "🎯" };
  return {
    id: `epic-${el.id || slug || el.title}`,
    title: el.title || "Unknown",
    image,
    url,
    genres: [],
    price: normalPrice,
    store: store.name,
    storeUrl: url,
    storeClass: store.cls,
    storeIcon: store.icon,
    stores: [store],
    tag: "free",
    salePrice: "0",
    normalPrice,
    description: stripHTML(el.description || ""),
    instructions: "",
    platforms: ["PC"]
  };
}

function matchStoreByUrl(urlLower) {
  if (urlLower.includes("steampowered.com")) return { name: "Steam", cls: "steam", icon: "🎮" };
  if (urlLower.includes("epicgames.com")) return { name: "Epic Games", cls: "epic", icon: "🎯" };
  if (urlLower.includes("gog.com")) return { name: "GOG", cls: "gog", icon: "💎" };
  if (urlLower.includes("humblebundle.com")) return { name: "Humble Bundle", cls: "", icon: "📦" };
  if (urlLower.includes("origin.com") || urlLower.includes("ea.com")) return { name: "EA App", cls: "", icon: "🎲" };
  if (urlLower.includes("ubisoft.com") || urlLower.includes("uplay")) return { name: "Ubisoft Connect", cls: "", icon: "🏰" };
  if (urlLower.includes("itch.io")) return { name: "itch.io", cls: "", icon: "🎨" };
  return null;
}

// Returns an array of ALL official store links found for a giveaway — the
// real claim URL first, plus any other official store links mentioned in
// the giveaway's instructions/description (e.g. "also on GOG: ...", "itch.io
// version: ..."). This lets the detail sheet show every legitimate way to
// grab the giveaway instead of a single best guess.
function detectAllStoresFromGamerpower(item, link) {
  const stores = [];
  const seenNames = new Set();
  const add = (info, url) => {
    if (!info || !url || seenNames.has(info.name)) return;
    seenNames.add(info.name);
    stores.push({ name: info.name, url, cls: info.cls, icon: info.icon });
  };

  const openUrl = link !== undefined ? link : gamerpowerLink(item);
  const primaryMatch = matchStoreByUrl(openUrl.toLowerCase());
  if (primaryMatch) add(primaryMatch, openUrl);

  // GamerPower's own platform tag (e.g. "epic-games-store, pc") — useful when
  // open_url is just a generic gamerpower.com/open/... redirect
  const platformsStr = (item.platforms || "").toLowerCase();
  if (stores.length === 0) {
    if (platformsStr.includes("epic")) add({ name: "Epic Games", cls: "epic", icon: "🎯" }, openUrl);
    else if (platformsStr.includes("steam")) add({ name: "Steam", cls: "steam", icon: "🎮" }, openUrl);
    else if (platformsStr.includes("gog")) add({ name: "GOG", cls: "gog", icon: "💎" }, openUrl);
    else if (platformsStr.includes("itch")) add({ name: "itch.io", cls: "", icon: "🎨" }, openUrl);
  }

  // NOTE: we deliberately do NOT scan instructions/description text for
  // "extra" store links here. Giveaway descriptions often mention unrelated
  // links (a Steam page for a different edition, a wishlist link, a trailer,
  // etc.) that are not actual ways to claim this specific giveaway. Adding
  // those as buttons caused e.g. an Epic Games giveaway to show a Steam
  // button that took people to the wrong place. The claim link (openUrl) and
  // GamerPower's own platform tag are the only two sources we trust.

  if (stores.length === 0) add({ name: item.platforms || "PC", cls: "", icon: "🎮" }, openUrl);
  return stores;
}

function mapCheapsharkDeal(deal) {
  let directUrl = "";
  let storeName = "Mağaza";
  let storeCls = "";

  if (deal.gameInfo) {
    if (deal.gameInfo.steamAppID && deal.gameInfo.steamAppID !== "0") {
      directUrl = `https://store.steampowered.com/app/${deal.gameInfo.steamAppID}/`;
      storeName = "Steam";
      storeCls = "steam";
    } else if (deal.gameInfo.cheapsharkURL) {
      directUrl = deal.gameInfo.cheapsharkURL;
      storeName = getStoreNameCheapShark(deal.storeID);
    }
  }
  if (!directUrl) {
    directUrl = `https://www.cheapshark.com/redirect?dealID=${deal.dealID}`;
    storeName = getStoreNameCheapShark(deal.storeID);
  }

  return {
    id: deal.dealID,
    title: deal.title || "Unknown",
    image: deal.thumb || "",
    url: directUrl,
    genres: [],
    rating: parseFloat(deal.metacriticScore) / 10 || 0,
    store: storeName,
    storeClass: storeCls,
    tag: "deal",
    salePrice: deal.salePrice || "0",
    normalPrice: deal.normalPrice || "0",
    savings: deal.savings || 0,
    description: "",
    metacritic: deal.metacriticScore ? parseInt(deal.metacriticScore) : null
  };
}

function getStoreNameCheapShark(storeID) {
  const stores = {
    "1": "Steam", "3": "Amazon", "4": "GamersGate", "5": "Green Man Gaming",
    "7": "GOG", "8": "Origin", "9": "Uplay", "11": "Gamesplanet",
    "13": "Epic Games", "14": "Battle.net", "15": "Microsoft Store",
    "24": "Humble Bundle"
  };
  return stores[storeID] || "Mağaza";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const TAG_LABEL = { new: "Yeni", free: "Ücretsiz", deal: "İndirim", discover: "" };
const TAG_CLASS = { new: "", free: "tag-free", deal: "tag-deal", discover: "" };
const PLACEHOLDER_GRADIENT = "linear-gradient(135deg, rgba(61,220,151,0.18), rgba(255,77,141,0.10))";

function priceLine(game) {
  if (game.tag === "free") {
    return game.price && game.price !== "0" ? `Ücretsiz <s>$${game.price}</s>` : "Ücretsiz";
  }
  if (game.tag === "deal") {
    const sale = parseFloat(game.salePrice);
    const normal = parseFloat(game.normalPrice);
    if (!isNaN(sale) && !isNaN(normal) && normal > 0) {
      const savings = game.savings ? ` (-${Math.round(game.savings)}%)` : "";
      return `$${sale.toFixed(2)} <s>$${normal.toFixed(2)}</s>${savings}`;
    }
  }
  if (game.rating) return `★ ${game.rating.toFixed(1)}`;
  return game.released || "";
}

function actionLabel(game) {
  if (game.tag === "free") return "🎁 Ücretsiz Al";
  if (game.tag === "deal") return "🛒 Satın Al";
  return "Detaylar";
}

function cardHTML(game) {
  const cover = game.image
    ? `<img src="${game.image}" alt="" loading="lazy" />`
    : `<div class="cover-fallback" style="background:${PLACEHOLDER_GRADIENT}">🎮</div>`;
  const tagLabel = TAG_LABEL[game.tag];
  const meta = game.genres && game.genres.length
    ? game.genres.slice(0, 2).join(" · ")
    : game.store || "";
  const gameData = JSON.stringify(game).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
  return `
    <div class="card" data-id="${game.id}" data-tag="${game.tag || ''}">
      <div class="card-cover">
        ${cover}
        ${tagLabel ? `<span class="card-tag ${TAG_CLASS[game.tag]}">${tagLabel}</span>` : ""}
      </div>
      <div class="card-body">
        <p class="card-title">${game.title}</p>
        <p class="card-meta">${meta || "&nbsp;"}</p>
        <p class="card-price">${priceLine(game)}</p>
        <button class="btn btn-primary" data-game='${gameData}'>${actionLabel(game)}</button>
      </div>
    </div>
  `;
}

function renderGrid(elId, games, append = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const seenKeys = new Set();
  if (append) {
    el.querySelectorAll(".card[data-id]").forEach(c => seenKeys.add(`${c.dataset.tag || ""}-${c.dataset.id}`));
  }
  const uniqueGames = (games || []).filter(g => {
    const key = `${g.tag || ""}-${g.id}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (!append && uniqueGames.length === 0) {
    el.innerHTML = `<div class="empty-state">Şu anda burada bir şey yok — daha sonra tekrar göz at.</div>`;
    return;
  }
  const html = uniqueGames.map(cardHTML).join("");
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

const NEWS_MAP = {};

function newsCardHTML(item) {
  const cover = item.image ? `<img src="${item.image}" alt="" loading="lazy" />` : "";
  const langBadge = item.lang === "tr" ? `<span class="lang-badge">TR</span>` : "";
  const safeId = encodeURIComponent(item.id);
  return `
    <div class="news-card" data-news-id="${safeId}">
      ${cover}
      <div class="news-card-body">
        <p class="news-title">${item.title} ${langBadge}</p>
        <p class="news-summary">${item.summary || ""}</p>
        <p class="news-date">${formatDate(item.published)}</p>
      </div>
    </div>
  `;
}

function renderNews(items, elId = "news-list") {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = `<div class="empty-state">Şu anda haber yok.</div>`;
    return;
  }
  items.forEach(item => { NEWS_MAP[item.id] = item; });
  el.innerHTML = items.map(newsCardHTML).join("");
}

function renderNewsSkeleton(elId = "news-list") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Array.from({ length: 5 })
    .map(() => `<div class="news-card skeleton"><div class="news-card-body"><div class="sk-line w70"></div><div class="sk-line w90"></div><div class="sk-line w40"></div></div></div>`)
    .join("");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  } catch (e) { return ""; }
}

// ---------------------------------------------------------------------------
// Detail Sheet
// ---------------------------------------------------------------------------
async function openDetailSheet(game) {
  const backdrop = document.getElementById("sheetBackdrop");
  const cover = document.getElementById("sheetCover");
  const title = document.getElementById("sheetTitle");
  const meta = document.getElementById("sheetMeta");
  const ratings = document.getElementById("sheetRatings");
  const desc = document.getElementById("sheetDesc");
  const stores = document.getElementById("sheetStores");

  backdrop.classList.add("open");
  title.textContent = game.title;
  meta.textContent = (game.genres && game.genres.length) ? game.genres.slice(0, 2).join(" · ") : (game.store || "");
  desc.textContent = "Yükleniyor...";
  ratings.innerHTML = "";
  stores.innerHTML = "";

  if (game.image) {
    cover.innerHTML = `<img src="${game.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md);" />`;
  } else {
    cover.innerHTML = `<div style="background:${PLACEHOLDER_GRADIENT};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;">🎮</div>`;
  }

  if (game.tag === "free") {
    desc.textContent = stripHTML(game.description) || stripHTML(game.instructions) || "Açıklama yok.";
    if (game.stores && game.stores.length > 0) {
      stores.innerHTML = game.stores
        .map(s => `<button class="btn btn-primary store-btn ${s.cls}" data-url="${s.url}">${s.icon} ${s.name}'da Aç</button>`)
        .join("");
    } else if (game.storeUrl) {
      const cls = game.storeClass || "";
      const icon = game.storeIcon || "🎮";
      stores.innerHTML = `<button class="btn btn-primary store-btn ${cls}" data-url="${game.storeUrl}">${icon} ${game.store}'da Aç</button>`;
    } else if (game.url) {
      stores.innerHTML = `<button class="btn btn-primary store-btn" data-url="${game.url}">Detaylar</button>`;
    }
    attachSheetClose();
    return;
  }

  if (game.tag === "deal") {
    desc.textContent = stripHTML(game.description) || "Açıklama yok.";
    if (game.url) {
      const cls = game.storeClass || "";
      stores.innerHTML = `<button class="btn btn-primary store-btn ${cls}" data-url="${game.url}">🛒 ${game.store}'da Aç</button>`;
    }
    attachSheetClose();
    return;
  }

  try {
    const [detailResult, storesResult] = await Promise.allSettled([
      API.gameDetail(game.id),
      API.gameStores(game.id)
    ]);
    if (detailResult.status !== "fulfilled") throw detailResult.reason;
    const detail = detailResult.value;
    const realStores = storesResult.status === "fulfilled" ? storesResult.value : [];

    const cleanDesc = bestDescription(detail, game);
    desc.textContent = cleanDesc || "Bu oyun için açıklama bu dilde mevcut değil.";

    let ratingsHTML = "";
    if (detail.metacritic) ratingsHTML += `<span class="rating-badge metacritic">Metacritic: ${detail.metacritic}</span>`;
    if (detail.rating) ratingsHTML += `<span class="rating-badge rawg">RAWG: ${detail.rating.toFixed(1)}</span>`;
    if (detail.released) ratingsHTML += `<span class="rating-badge">Çıkış: ${detail.released.slice(0, 4)}</span>`;
    ratings.innerHTML = ratingsHTML;

    let storesHTML = "";
    if (realStores.length > 0) {
      const seenStoreNames = new Set();
      for (const s of realStores.slice(0, 4)) {
        const url = s.url || "";
        if (!url) continue;
        const storeInfo = getStoreInfo(s.store_id);
        if (seenStoreNames.has(storeInfo.name)) continue;
        seenStoreNames.add(storeInfo.name);
        storesHTML += `<button class="btn btn-outline store-btn ${storeInfo.cls}" data-url="${url}">🛒 ${storeInfo.name}'da Aç</button>`;
      }
    }
    if (!storesHTML) {
      storesHTML = `<p class="sheet-meta">Bu oyun için mağaza bağlantısı bulunamadı.</p>`;
      if (game.url) {
        storesHTML += `<button class="btn btn-outline store-btn" data-url="${game.url}">RAWG'da Görüntüle</button>`;
      }
    }
    stores.innerHTML = storesHTML;
  } catch (e) {
    desc.textContent = stripHTML(game.description) || "Açıklama yok.";
    stores.innerHTML = game.url
      ? `<button class="btn btn-outline store-btn" data-url="${game.url}">RAWG'da Görüntüle</button>`
      : `<p class="sheet-meta">Mağaza bilgisi yüklenemedi.</p>`;
  }

  attachSheetClose();
}

// ---------------------------------------------------------------------------
// Description cleanup — RAWG's full `description` field is scraped from
// whichever language Wikipedia happened to have the most content, so some
// games (e.g. niche/older titles) come back entirely in Japanese, Chinese,
// Korean, etc. instead of Turkish/English. We detect that case and fall back
// to the shorter, reliably-translated `description_short` field instead of
// showing a wall of text the user can't read. We also decode HTML entities
// and truncate on a word/sentence boundary instead of mid-word.
// ---------------------------------------------------------------------------
function decodeEntities(str) {
  return (str || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHTML(html) {
  return decodeEntities((html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const NON_LATIN_SCRIPT_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0600-\u06ff\u0e00-\u0e7f]/g;
function isWrongLanguage(text) {
  if (!text) return false;
  const nonLatinCount = (text.match(NON_LATIN_SCRIPT_RE) || []).length;
  const latinCount = (text.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
  // If a meaningful chunk of the text is CJK/Thai/Arabic script and it
  // outweighs Latin/Cyrillic letters, this description is in an unsupported
  // language rather than just containing a foreign proper noun.
  return nonLatinCount > 15 && nonLatinCount > latinCount;
}

function truncateAtBoundary(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastStop > maxLen * 0.4) return slice.slice(0, lastStop + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + "…";
}

function bestDescription(detail, fallbackGame) {
  const full = stripHTML(detail && detail.description);
  if (full && !isWrongLanguage(full)) return truncateAtBoundary(full, 500);
  const short = stripHTML((detail && detail.description_short) || (fallbackGame && fallbackGame.description));
  if (short && !isWrongLanguage(short)) return truncateAtBoundary(short, 500);
  return "";
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatArticleHTML(text) {
  const paragraphs = (text || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "<p>İçerik bulunamadı.</p>";
  return paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join("");
}

function readingTimeMinutes(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function openNewsSheet(item) {
  const backdrop = document.getElementById("sheetBackdrop");
  const cover = document.getElementById("sheetCover");
  const title = document.getElementById("sheetTitle");
  const meta = document.getElementById("sheetMeta");
  const ratings = document.getElementById("sheetRatings");
  const desc = document.getElementById("sheetDesc");
  const stores = document.getElementById("sheetStores");

  backdrop.classList.add("open");
  title.textContent = item.title;
  const langLabel = item.lang === "tr" ? "Türkçe" : "İngilizce";
  meta.textContent = `${formatDate(item.published)} · ${langLabel}`;

  let badgesHTML = `<span class="rating-badge">⏱ ${readingTimeMinutes(item.content)} dk okuma</span>`;
  if (item.source) badgesHTML += `<span class="rating-badge">🔗 ${item.source}</span>`;
  ratings.innerHTML = badgesHTML;
  stores.innerHTML = "";

  if (item.image) {
    cover.innerHTML = `<img src="${item.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md);" />`;
  } else {
    cover.innerHTML = `<div style="background:${PLACEHOLDER_GRADIENT};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;">📰</div>`;
  }

  desc.innerHTML = formatArticleHTML(item.content || item.summary);
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
  renderSkeleton("grid-free_games-home", 6);
  renderSkeleton("grid-hot_deals-home", 6);
  renderNewsSkeleton("news-list-home");
  const data = await API.home();
  renderGrid("grid-home", data.new_releases);
  renderGrid("grid-free_games-home", data.free_games);
  renderGrid("grid-hot_deals-home", data.hot_deals);
  renderNews(data.news, "news-list-home");
  loaded.add("home");
}

function toggleLoadMoreBtn(id, show) {
  const btn = document.getElementById(id);
  if (btn) btn.style.display = show ? "" : "none";
}

let newReleasesPage = 1;
async function loadNewReleases(force = false) {
  if (loaded.has("new_releases") && !force) return;
  newReleasesPage = 1;
  renderSkeleton("grid-new_releases", 6);
  try {
    const data = await API.newReleases(newReleasesPage);
    renderGrid("grid-new_releases", data);
    loaded.add("new_releases");
    toggleLoadMoreBtn("loadMoreNewReleases", data.length > 0);
  } catch (e) { renderGrid("grid-new_releases", []); }
}

async function loadMoreNewReleases() {
  const btn = document.getElementById("loadMoreNewReleases");
  if (btn) { btn.disabled = true; btn.textContent = "Yükleniyor..."; }
  newReleasesPage += 1;
  const data = await API.newReleases(newReleasesPage);
  renderGrid("grid-new_releases", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Daha fazla göster"; }
  toggleLoadMoreBtn("loadMoreNewReleases", data.length > 0);
}

async function loadFreeGames(force = false) {
  if (loaded.has("free_games") && !force) return;
  renderSkeleton("grid-free_games", 6);
  try {
    const data = await API.freeGames();
    renderGrid("grid-free_games", data);
    loaded.add("free_games");
  } catch (e) { renderGrid("grid-free_games", []); }
}

let hotDealsPage = 1;
let hotDealsSeenTitles = new Set();
async function loadHotDeals(force = false) {
  if (loaded.has("hot_deals") && !force) return;
  hotDealsPage = 1;
  hotDealsSeenTitles = new Set();
  renderSkeleton("grid-hot_deals", 6);
  try {
    const raw = await API.hotDeals(hotDealsPage);
    const data = raw.filter(g => {
      const key = g.title.trim().toLowerCase();
      if (hotDealsSeenTitles.has(key)) return false;
      hotDealsSeenTitles.add(key);
      return true;
    });
    renderGrid("grid-hot_deals", data);
    loaded.add("hot_deals");
    toggleLoadMoreBtn("loadMoreHotDeals", data.length > 0);
  } catch (e) { renderGrid("grid-hot_deals", []); }
}

async function loadMoreHotDeals() {
  const btn = document.getElementById("loadMoreHotDeals");
  if (btn) { btn.disabled = true; btn.textContent = "Yükleniyor..."; }
  hotDealsPage += 1;
  const raw = await API.hotDeals(hotDealsPage);
  const data = raw.filter(g => {
    const key = g.title.trim().toLowerCase();
    if (hotDealsSeenTitles.has(key)) return false;
    hotDealsSeenTitles.add(key);
    return true;
  });
  renderGrid("grid-hot_deals", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Daha fazla göster"; }
  toggleLoadMoreBtn("loadMoreHotDeals", data.length > 0);
}

async function loadNews(force = false) {
  if (loaded.has("news") && !force) return;
  renderNewsSkeleton("news-list");
  try {
    const data = await API.news();
    renderNews(data, "news-list");
    loaded.add("news");
  } catch (e) { renderNews([], "news-list"); }
}

let currentGenre = "all";
let currentQuery = "";
let discoverPage = 1;

async function loadDiscover(force = false) {
  if (loaded.has("discover") && !force && !currentQuery) return;
  discoverPage = 1;
  renderSkeleton("grid-discover_and_explore", 9);
  try {
    const data = await API.discover(currentGenre, currentQuery, discoverPage);
    renderGrid("grid-discover_and_explore", data);
    loaded.add("discover");
    toggleLoadMoreBtn("loadMoreDiscover", data.length > 0);
  } catch (e) { renderGrid("grid-discover_and_explore", []); }
}

async function loadMoreDiscover() {
  const btn = document.getElementById("loadMoreDiscover");
  if (btn) { btn.disabled = true; btn.textContent = "Yükleniyor..."; }
  discoverPage += 1;
  const data = await API.discover(currentGenre, currentQuery, discoverPage);
  renderGrid("grid-discover_and_explore", data, true);
  if (btn) { btn.disabled = false; btn.textContent = "Daha fazla göster"; }
  toggleLoadMoreBtn("loadMoreDiscover", data.length > 0);
}

async function loadGenreChips() {
  const chipsWrap = document.getElementById("genreChips");
  try {
    const genres = await API.genres();
    const all = [{ slug: "all", name: "Tümü" }, ...genres];
    chipsWrap.innerHTML = all
      .map((g, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-genre="${g.slug}">${g.name}</button>`)
      .join("");
  } catch (e) { chipsWrap.innerHTML = ""; }
}

const SECTION_LOADERS = {
  home: loadHome,
  new_releases: loadNewReleases,
  free_games: loadFreeGames,
  hot_deals: loadHotDeals,
  news: loadNews,
  discover_and_explore: loadDiscover,
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
  loadDiscover(true);
});

let searchDebounce;
document.getElementById("searchInput").addEventListener("input", (e) => {
  currentQuery = e.target.value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    goToSection("discover_and_explore");
    loadDiscover(true);
  }, 400);
});

document.querySelector(".content").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-game]");
  if (btn) {
    try {
      const game = JSON.parse(btn.dataset.game.replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
      haptic("medium");
      openDetailSheet(game);
    } catch (e) { console.error("Parse game error:", e); }
    return;
  }
  const newsCard = e.target.closest(".news-card");
  if (newsCard) {
    const newsId = decodeURIComponent(newsCard.dataset.newsId || "");
    const item = NEWS_MAP[newsId];
    if (item) { haptic("medium"); openNewsSheet(item); }
  }
});

document.getElementById("sheetBackdrop").addEventListener("click", (e) => {
  const storeBtn = e.target.closest(".store-btn");
  if (storeBtn) {
    const url = storeBtn.dataset.url;
    if (url) { haptic("medium"); openLink(url); }
  }
});

document.getElementById("loadMoreNewReleases")?.addEventListener("click", () => { haptic(); loadMoreNewReleases(); });
document.getElementById("loadMoreHotDeals")?.addEventListener("click", () => { haptic(); loadMoreHotDeals(); });
document.getElementById("loadMoreDiscover")?.addEventListener("click", () => { haptic(); loadMoreDiscover(); });

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

loadGenreChips();
initFromParams();