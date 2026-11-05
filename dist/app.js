import {
  fetchWeather,
  searchPlaces,
  fetchNasa,
  crops,
  recommendRotations,
  calculateEconomics,
  formatWeatherCode,
} from "./data.js";
import {
  createFieldMap,
  polygonAreaHa,
  validatePolygon,
  polygonReferencePoint,
} from "./geo.js";
import { initPlanning } from "./planning.js";
import { initScenes } from "./scenes.js";
import { initI18n, t, currentLanguage } from "./i18n.js";
import { initIntro } from "./intro.js";
import { workspaceStorage, storageReady } from "./storage.js";
import { initAccounts } from "./accounts.js";

window.__fieldshiftIntro ||= initIntro({language:'en'});
await storageReady;

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const text = (q, value) =>
  $$(q).forEach((el) => {
    el.textContent = value;
  });
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (n) => typeof n === "number" && Number.isFinite(n);
function read(key, fallback) {
  try {
    const value = JSON.parse(workspaceStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    workspaceStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast(
      "Workspace storage is unavailable. Export a report to keep your work.",
    );
  }
}
const unselected = {
  lat: 0,
  lon: 0,
  name: "Choose your field",
  country: "",
  region: "",
  method: "Unselected",
  id: "unselected-field",
  boundary: null,
};
const validPoint = (loc) =>
  loc &&
  number(loc.lat) &&
  number(loc.lon) &&
  Math.abs(loc.lat) <= 90 &&
  Math.abs(loc.lon) <= 180;
const savedLocation = read("fieldshift.location", null);
const defaultEconomics = {
  currency: "USD",
  areaHa: null,
  yieldTonnesHa: null,
  pricePerTonne: null,
  sellingLossPercent: null,
  transportCostPerTonne: null,
  marketFeePercent: null,
  seedCostHa: null,
  fertilizerCostHa: null,
  waterCostHa: null,
  operationsCostHa: null,
  priceSource: "none",
  priceDate: "",
};
const currencyFields = [
  "pricePerTonne",
  "transportCostPerTonne",
  "seedCostHa",
  "fertilizerCostHa",
  "waterCostHa",
  "operationsCostHa",
];
const economicsTextFields = new Set(["currency", "priceSource", "priceDate"]);
const countryCurrencies = {
  "Saudi Arabia": "SAR",
  "United States": "USD",
  "United States of America": "USD",
  "United Kingdom": "GBP",
  India: "INR",
  Kenya: "KES",
  Egypt: "EGP",
  China: "CNY",
  Brazil: "BRL",
  "South Africa": "ZAR",
  Nigeria: "NGN",
  France: "EUR",
  Germany: "EUR",
  Netherlands: "EUR",
  Spain: "EUR",
  Italy: "EUR",
  Portugal: "EUR",
  Ireland: "EUR",
  Belgium: "EUR",
  Austria: "EUR",
  Greece: "EUR",
  Finland: "EUR",
};
const priceSourceNames = {
  none: "Choose a source",
  estimate: "User estimate",
  farmgate: "Farm-gate quote",
  cooperative: "Cooperative or contract",
  wholesale: "Wholesale market quote",
  benchmark: "Published benchmark",
};
const state = {
  location:
    validPoint(savedLocation) && savedLocation?.method !== "Example location"
      ? savedLocation
      : { ...unselected },
  preferences: read("fieldshift.preferences", {
    theme: "auto",
    units: "metric",
    language: "en",
  }),
  fields: read("fieldshift.fields", []),
  samples: read("fieldshift.samples", []),
  journal: read("fieldshift.journal", []),
  feedback: read("fieldshift.feedback", []),
  plans: read("fieldshift.plans", []),
  weather: null,
  nasa: null,
  economics: null,
  rotationOptions: [],
  selectedPlan: "soil",
  weatherController: null,
  nasaController: null,
  searchController: null,
  requestId: 0,
  route: "overview",
  map: null,
  ready: false,
  fieldSettings: read("fieldshift.fieldSettings", {}),
  economicsInputs: { ...defaultEconomics },
};
const hasLocation = () =>
  validPoint(state.location) &&
  state.location.method !== "Unselected" &&
  state.location.method !== "Example location";
let toastTimer, themeClock;
function toast(message) {
  text("#toast", message);
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3400);
}
const icon = (name) =>
  '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const temperatureValue = (n) =>
  state.preferences.units === "imperial" ? (n * 9) / 5 + 32 : n;
const temp = (n) =>
  number(n)
    ? Math.round(temperatureValue(n)) +
      "°" +
      (state.preferences.units === "imperial" ? "F" : "C")
    : "—";
const rain = (n) =>
  number(n)
    ? state.preferences.units === "imperial"
      ? (n / 25.4).toFixed(2) + " in"
      : n.toFixed(1) + " mm"
    : "—";
const wind = (n) =>
  number(n)
    ? state.preferences.units === "imperial"
      ? Math.round(n * 0.621371) + " mph"
      : Math.round(n) + " km/h"
    : "—";
const money = (n, currency = state.economicsInputs.currency) =>
  number(n)
    ? new Intl.NumberFormat(
        { en: "en-US", fr: "fr-FR", ar: "ar-SA" }[currentLanguage()] || "en-US",
        { style: "currency", currency, maximumFractionDigits: 0 },
      ).format(n)
    : "—";
const moisture = (n) => (number(n) ? (n * 100).toFixed(0) + "%" : "—");
const dateShort = (date) =>
  new Date(date + "T12:00:00").toLocaleDateString("en", { weekday: "short" });
const today = () => new Date().toISOString().slice(0, 10);
const fieldKey = () =>
  state.location.lat.toFixed(5) + "," + state.location.lon.toFixed(5);
const total = (days, key) =>
  days.length && days.every((d) => number(d[key]))
    ? days.reduce((n, d) => n + d[key], 0)
    : null;
const notifyFieldUpdate = () =>
  window.dispatchEvent(new CustomEvent("fieldshift:updated"));
function persistFieldSettings() {
  state.fieldSettings[fieldKey()] = {
    ...state.fieldSettings[fieldKey()],
    economics: { ...state.economicsInputs },
    planner: {
      crop: $("#current-crop").value,
      priority: $("#planning-priority").value,
      irrigation: $("#irrigation").value,
      ph: $("#planner-ph").value,
      selectedPlan: state.selectedPlan,
    },
  };
  write("fieldshift.fieldSettings", state.fieldSettings);
}
function restoreFieldSettings() {
  const settings = state.fieldSettings[fieldKey()];
  state.economicsInputs = { ...defaultEconomics, ...settings?.economics };
  if (!settings?.economics) {
    const suggested = countryCurrencies[state.location.country];
    if (suggested) state.economicsInputs.currency = suggested;
  }
  if (state.location.boundary)
    state.economicsInputs.areaHa = Number(
      polygonAreaHa(state.location.boundary).toFixed(4),
    );
  Object.entries(state.economicsInputs).forEach(([key, value]) => {
    if ($("#economics-form").elements[key])
      $("#economics-form").elements[key].value = value;
  });
  const planner = settings?.planner ?? {};
  $("#current-crop").value = crops.some((c) => c.id === planner.crop)
    ? planner.crop
    : "wheat";
  $("#planning-priority").value = planner.priority || "soil";
  $("#irrigation").value = planner.irrigation || "rainfed";
  $("#planner-ph").value = planner.ph ?? "";
  state.selectedPlan = planner.selectedPlan || "soil";
  state.weather = null;
  state.economics = null;
  renderEconomics();
  renderRotations();
  renderMarketContext();
}

function init() {
  // The transient top-bar data badge is intentionally removed.
  $(".system-status")?.remove();
  for(const route of ['overview','weather','soil','water','crops','profit','reports']){
    const view=$('#view-'+route),heading=view?.querySelector('.page-heading');if(!heading)continue;
    const bar=document.createElement('section');bar.className='field-data-controls';bar.setAttribute('aria-label','Field data controls');
    bar.innerHTML='<div><span class="eyebrow">YOUR SELECTED LAND</span><strong data-context-field>Choose your field</strong><p data-context-status role="status">Choose a place to load its weather, rainfall, water demand and modeled surface moisture.</p></div><div class="field-data-actions"><button class="button" type="button" data-action="location" data-context-select>Choose field</button><button class="button secondary" type="button" data-action="geolocation">Use my location</button><button class="button secondary" type="button" data-action="refresh" data-context-refresh hidden>Refresh data ↻</button></div>';
    heading.after(bar);
  }
  const feedbackLink = document.createElement("a");
  feedbackLink.href = "#/feedback";
  feedbackLink.dataset.route = "feedback";
  feedbackLink.innerHTML =
    '<svg><use href="#i-file"/></svg>Comments & feedback';
  $(".side-nav").append(feedbackLink);
  const aboutLink = document.createElement("a");
  aboutLink.href = "#/about";
  aboutLink.dataset.route = "about";
  aboutLink.innerHTML = '<svg><use href="#i-globe"/></svg>About us';
  $(".side-nav").append(aboutLink);
  const exploreLink = document.createElement("a");
  exploreLink.href = "#/explore";
  exploreLink.dataset.route = "explore";
  exploreLink.innerHTML = '<svg><use href="#i-globe"/></svg>Explore';
  $(".side-nav").insertBefore(exploreLink, feedbackLink);
  const exploreView = document.createElement("section");
  exploreView.className = "view";
  exploreView.id = "view-explore";
  exploreView.hidden = true;
  exploreView.innerHTML = `
    <header class="explore-world-hero">
      <div><span class="eyebrow">GLOBAL AGRICULTURE</span><h1>Explore<span>.</span></h1><p>Explore how farmers across different climates combine knowledge, technology and local resources to feed their communities.</p></div>
      <div class="explore-world-stats" aria-label="Explore page summary"><span><b>5</b> countries</span><span><b>4</b> continents</span><span><b>1</b> shared future</span></div>
    </header>
    <div class="explore-feature-grid">
      <article class="world-feature world-china"><img src="assets/explore-china.webp" alt="Farm workers tending green rice fields in China"><div class="world-feature-copy"><span class="world-country-code">CN / 01</span><span class="eyebrow">ASIA · RICE, WHEAT & VEGETABLES</span><h2>China</h2><p>China ranks first globally in total agricultural economic output, with a reported estimate of about <b>$1.65 trillion</b>, and is a leading producer of rice, wheat and vegetables.</p><p class="world-caveat">The value is an approximate published estimate; rankings and totals vary by year, currency and methodology.</p><div class="world-sources"><a href="https://www.investopedia.com/financial-edge/0712/top-agricultural-producing-countries.aspx" target="_blank" rel="noopener noreferrer">Source 1 ↗</a><a href="https://www.globpulse.com/blog/top-agricultural-producing-countries-in-the-world-2026" target="_blank" rel="noopener noreferrer">Source 2 ↗</a></div></div></article>
      <article class="world-feature world-ksa"><img src="assets/explore-ksa.webp" alt="Agricultural robots working between crops inside a modern Saudi greenhouse"><div class="world-feature-copy"><span class="world-country-code">SA / 02</span><span class="eyebrow">SAUDI ARABIA · AGRITECH</span><h2>Saudi Arabia</h2><p>Saudi farming is developing through modern tools such as greenhouse automation, field sensors, agricultural robots and precision irrigation that can help growers use water and inputs more carefully.</p><p class="world-caveat">Technology supports decisions, but crops and systems still need to fit local water, soil and climate conditions.</p><div class="world-sources"><a href="https://saudi-agriculture.com/" target="_blank" rel="noopener noreferrer">Explore Saudi Agriculture ↗</a></div></div></article>
    </div>
    <div class="explore-world-section-heading"><div><span class="eyebrow">MORE FIELD STORIES</span><h2>Innovation takes many forms.</h2></div><p>Different places solve different constraints—from limited land and water to changing weather and farm access.</p></div>
    <div class="world-story-grid">
      <article class="world-story"><div class="world-story-image"><img src="assets/explore-netherlands.webp" alt="A high-technology greenhouse growing tomatoes and peppers in the Netherlands"><span>NL / EUROPE</span></div><div class="world-story-copy"><span class="eyebrow">CONTROLLED ENVIRONMENTS</span><h3>Netherlands</h3><p>Glasshouses, hydroponics and climate controls help growers produce high-value crops while closely managing water, nutrients and space.</p><a href="https://www.government.nl/topics/agriculture/agriculture-and-horticulture" target="_blank" rel="noopener noreferrer">Learn from the Netherlands ↗</a></div></article>
      <article class="world-story"><div class="world-story-image"><img src="assets/explore-kenya.webp" alt="A Kenyan farmer using a tablet near solar irrigation and a mapping drone"><span>KE / AFRICA</span></div><div class="world-story-copy"><span class="eyebrow">SMALLHOLDER INNOVATION</span><h3>Kenya</h3><p>Mobile information, solar-powered irrigation and field mapping can help small farms respond to weather, reach advice and manage scarce resources.</p><a href="https://www.fao.org/kenya/fao-in-kenya/kenya-at-a-glance/en/" target="_blank" rel="noopener noreferrer">Explore agriculture in Kenya ↗</a></div></article>
      <article class="world-story"><div class="world-story-image"><img src="assets/explore-brazil.webp" alt="Precision farming across organized crop rows beside native vegetation in Brazil"><span>BR / SOUTH AMERICA</span></div><div class="world-story-copy"><span class="eyebrow">SCALE & CONSERVATION</span><h3>Brazil</h3><p>Precision equipment, crop research and conservation practices can work together across large farms and diverse agricultural regions.</p><a href="https://www.embrapa.br/en/" target="_blank" rel="noopener noreferrer">Explore Brazilian research ↗</a></div></article>
    </div>
    <aside class="explore-world-note"><span>✦</span><p><b>No single model fits every farm.</b> The strongest ideas are adapted to local people, evidence, climate, soils and water.</p></aside>
    <div class="explore-world-section-heading explore-resources-heading"><div><span class="eyebrow">TRUSTED RESOURCES</span><h2>Learn more about agriculture.</h2></div><p>Continue exploring with Saudi agriculture, NASA Earth observation, and a global view of changing land.</p></div>
    <div class="learn-resources explore-resources"><article class="panel learn-card learn-ksa"><span class="learn-card-number">01</span><div class="icon-box lime"><svg><use href="#i-leaf"/></svg></div><span class="eyebrow">SAUDI ARABIA</span><h2>KSA Agriculture</h2><p>Discover Saudi agriculture, industry events, technologies, and initiatives supporting the Kingdom’s farming sector.</p><a class="button learn-resource-link" href="https://saudi-agriculture.com/" target="_blank" rel="noopener noreferrer">Open KSA Agriculture <span aria-hidden="true">↗</span></a></article><article class="panel learn-card learn-nasa"><span class="learn-card-number">02</span><div class="icon-box blue"><svg><use href="#i-globe"/></svg></div><span class="eyebrow">EARTH OBSERVATION</span><h2>NASA Harvest</h2><p>Explore NASA’s global agriculture and food-security program, connecting satellite Earth observations with practical decisions.</p><a class="button learn-resource-link" href="https://www.nasaharvest.org" target="_blank" rel="noopener noreferrer">Open NASA Harvest <span aria-hidden="true">↗</span></a></article><article class="panel learn-card learn-earth"><span class="learn-card-number">03</span><div class="icon-box amber"><svg><use href="#i-map"/></svg></div><span class="eyebrow">EXPLORE THE PLANET</span><h2>Google Earth</h2><p>Travel across the globe, inspect landscapes, and understand the geographic context around farms and fields.</p><a class="button learn-resource-link" href="https://earth.google.com/web/@0,-1.38870016,0a,22251752.77375655d,35y,0h,0t,0r/data=CgRCAggBMikKJwolCiExM0FFVHlOV21hSXJSMUxBZjZvdy1Da05iczc1dHFhX3cgAToDCgEwQgIIAEoHCJvAuHEQAQ" target="_blank" rel="noopener noreferrer">Open Google Earth <span aria-hidden="true">↗</span></a></article></div>
    <aside class="learn-note"><span>✦</span><p><b>Keep learning beyond your field.</b> These websites open in a new tab, so your FieldShift workspace stays exactly where you left it.</p></aside>`;
  $("main").insertBefore(exploreView, $(".app-footer"));
  const feedbackView = document.createElement("section");
  feedbackView.className = "view";
  feedbackView.id = "view-feedback";
  feedbackView.hidden = true;
  feedbackView.innerHTML =
    '<div class="page-heading"><div><span class="eyebrow">COMMENTS & FEEDBACK</span><h1>Help FieldShift grow<span>.</span></h1><p>Share an idea, report a problem, or tell us what works well.</p></div><span class="pill">SAVED FEEDBACK</span></div><div class="feedback-layout"><form id="feedback-form" class="panel feedback-form"><div class="panel-heading"><div><span class="eyebrow">YOUR MESSAGE</span><h2>What would you like us to know?</h2></div></div><label>Name (optional)<input name="name" maxlength="60" placeholder="Your name"></label><div class="form-grid"><label>Feedback type<select name="category"><option value="Idea">Idea</option><option value="Problem">Problem</option><option value="Question">Question</option><option value="Compliment">Compliment</option></select></label><label>Overall rating<select name="rating"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Okay</option><option value="2">2 · Needs work</option><option value="1">1 · Poor</option></select></label></div><label>Comment<textarea name="comment" minlength="10" maxlength="1000" required placeholder="Write your feedback here…"></textarea></label><button class="button full" type="submit">Save feedback</button><p class="fine-print">Feedback is included when you download the workspace backup.</p></form><article class="panel feedback-history"><div class="panel-heading"><div><span class="eyebrow">YOUR FEEDBACK</span><h2>Recent feedback</h2></div><span class="pill" id="feedback-count">0 COMMENTS</span></div><div id="feedback-list"></div></article></div>';
  $("main").insertBefore(feedbackView, $(".app-footer"));
  replaceArrowGlyphs();
  const savedPlansPanel = document.createElement("article");
  savedPlansPanel.className = "panel";
  savedPlansPanel.innerHTML =
    '<div class="panel-heading"><div><span class="eyebrow">SAVED FOR THIS LAND</span><h2>Your rotation library</h2></div></div><div id="saved-plans-list"></div>';
  $("#view-crops").append(savedPlansPanel);
  const horizon = document.createElement("article");
  horizon.className = "panel season-horizon";
  horizon.innerHTML =
    '<div class="panel-heading"><div><span class="eyebrow">SEASON HORIZON</span><h2>Plan the next stages</h2></div><span class="pill">PLANNING VIEW</span></div><div id="season-horizon"></div><p class="fine-print">A planning horizon based on your selected rotation. Confirm local planting and harvest dates before acting.</p>';
  $("#view-crops").insertBefore(horizon, $("#view-crops .data-note"));
  const satellite = document.createElement("div");
  satellite.className = "satellite-status";
  satellite.innerHTML =
    '<span class="eyebrow">SATELLITE ANALYSIS</span><b>Boundary context ready</b><p>Satellite basemap is visible. Vegetation-health zones need a connected Sentinel or Landsat index before they can be calculated.</p><a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener noreferrer">Open NASA Worldview ↗</a>';
  $(".field-details").insertBefore(satellite, $(".saved-fields"));
  $('[data-map-layer="terrain"]').textContent = "Street map";
  state.map = createFieldMap($("#field-map"), {
    onSelect: (point) =>
      selectLocation(
        { ...point, id: crypto.randomUUID(), name: "Selected point" },
        false,
      ),
    onBoundary: (boundary) => {
      state.location.boundary = boundary?.geometry ?? null;
      if (boundary) {
        // The reference point is a vertex-average center, not a polygon-wide environmental average.
        state.location.lat = boundary.centroid.lat;
        state.location.lon = boundary.centroid.lon;
        state.location.method = "Drawn boundary";
        state.location.id = crypto.randomUUID();
        state.location.name =
          $("#field-name-input").value.trim() || "Mapped field";
        clearNasa();
        restoreFieldSettings();
        loadWeather();
        addJournal(
          "Field boundary drawn",
          boundary.areaHa.toFixed(2) + " ha · entered geometry",
        );
      }
      write("fieldshift.location", state.location);
      renderLocation();
      toast(
        boundary
          ? "Boundary drawn. Name and save your field."
          : "Boundary cleared",
      );
    },
    onStatus: (status) => {
      text("#drawing-status", status.message);
      if (status.level === "error" && !status.message.includes("tiles"))
        toast(status.message);
    },
  });
  if (hasLocation()) state.map.setLocation(state.location);
  if (state.location.boundary) state.map.setBoundary(state.location.boundary);
  bindEvents();
  applyPreferences();
  clearInterval(themeClock);
  themeClock = setInterval(() => {
    if (state.preferences.theme === "auto") applyPreferences();
  }, 60000);
  renderLocation();
  renderSamples();
  renderFields();
  renderJournal();
  const cropOptions = crops
    .filter((c) => c.type !== "cover")
    .map(
      (c) => '<option value="' + c.id + '">' + escapeHTML(c.name) + "</option>",
    )
    .join("");
  $("#current-crop").innerHTML = cropOptions;
  // Migrate earlier browser-local economics only to the field selected at upgrade.
  if (!Object.keys(state.fieldSettings).length) {
    const legacy = read("fieldshift.economics", null);
    if (legacy) state.fieldSettings[fieldKey()] = { economics: legacy };
  }
  restoreFieldSettings();
  $("#water-record-form").elements.date.value = today();
  $("#soil-sample-form").elements.date.value = today();
  renderEconomics();
  renderRotations();
  renderCropLibrary();
  renderReports();
  renderFeedback();
  renderDecisionBriefing();
  navigate();
  window.addEventListener("hashchange", navigate);
  initPlanning({ getState: () => state, fieldKey, toast, crops });
  initScenes({ getState: () => state });
  initI18n({
    preferences: state.preferences,
    save: (preferences) => write("fieldshift.preferences", preferences),
    rerender: () => {
      renderLocation();
      renderRotations();
      renderReports();
      renderEconomics();
      renderFeedback();
    },
  });
  initAccounts({getState:()=>state,toast}).catch(error=>toast(error.message));
  window.__fieldshiftIntro ||= initIntro({
    language: state.preferences.language,
  });
  if (hasLocation()) loadWeather();
  else {resetWeather("unselected");requestAutoLocation();}
  state.ready = true;
}

function navigate() {
  const candidate =
    location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
  state.route = [
    "overview",
    "map",
    "weather",
    "soil",
    "water",
    "crops",
    "profit",
    "reports",
    "account",
    "explore",
    "feedback",
    "settings",
    "about",
  ].includes(candidate)
    ? candidate
    : "overview";
  $$(".view").forEach((view) => {
    view.hidden = view.id !== "view-" + state.route;
  });
  $$("[data-route]").forEach((link) => {
    const active = link.dataset.route === state.route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  text(
    "#route-name",
    {
      overview: "Overview",
      map: "Field explorer",
      weather: "Weather",
      soil: "Soil intelligence",
      water: "Water",
      crops: "Crop planner",
      profit: "Profit & scenarios",
      reports: "Reports",
      account: "My account",
      explore: "Explore",
      feedback: "Comments & feedback",
      settings: "Settings",
      about: "About us",
    }[state.route],
  );
  const target =
    state.route === "map" ? $("#explorer-map-host") : $("#home-map-host");
  target.append($("#map-dock"));
  document.body.classList.remove("menu-open");
  requestAnimationFrame(() => state.map?.resize());
  if (state.ready) window.scrollTo({ top: 0, behavior: "instant" });
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const actions = {
      menu: () => document.body.classList.toggle("menu-open"),
      "close-menu": () => document.body.classList.remove("menu-open"),
      location: () => $("#location-dialog").showModal(),
      "close-dialog": () => action.closest("dialog")?.close(),
      explore: () => {
        location.hash = "/map";
      },
      theme: () => {
        const active = resolvedTheme();
        state.preferences.theme = active === "light" ? "dark" : "light";
        applyPreferences();
      },
      coordinates: useCoordinates,
      geolocation: useDeviceLocation,
      draw: () => {
        state.map.startDrawing();
        setMapModeButtons("map");
      },
      "finish-draw": () => state.map.finishDrawing(),
      "clear-boundary": () => state.map.clearBoundary(),
      "save-field": saveField,
      refresh: () => hasLocation()?loadWeather(true):$('#location-dialog').showModal(),
      "soil-dialog": () => hasLocation()?$("#soil-dialog").showModal():$('#location-dialog').showModal(),
      "compare-plans": () => {
        renderRotations();
        toast("Rotation comparisons updated");
      },
      "save-plan": savePlan,
      "export-csv": exportCSV,
      print: () => window.print(),
      nasa: loadNasa,
      "delete-feedback": () => {
        state.feedback = state.feedback.filter(
          (item) => item.id !== action.dataset.id,
        );
        write("fieldshift.feedback", state.feedback);
        renderFeedback();
        toast(t("Feedback removed."));
      },
      backup: () =>
        download(
          "fieldshift-workspace.json",
          JSON.stringify(
            {
              schemaVersion: 3,
              fields: state.fields,
              location: state.location,
              samples: state.samples,
              journal: state.journal,
              plans: state.plans,
              feedback: state.feedback,
              fieldSettings: state.fieldSettings,
              seasons: read("fieldshift.seasons.v1", {}),
            },
            null,
            2,
          ),
          "application/json",
        ),
    };
    try {
      actions[action.dataset.action]?.();
    } catch (error) {
      toast(error.message);
      console.error(error);
    }
  });
  $$("[data-map-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      state.map.setMode(button.dataset.mapMode);
      setMapModeButtons(button.dataset.mapMode);
    }),
  );
  $$("[data-map-layer]").forEach((button) =>
    button.addEventListener("click", () => {
      state.map.setLayer(button.dataset.mapLayer);
      $$("[data-map-layer]").forEach((b) =>
        b.classList.toggle("selected", b === button),
      );
    }),
  );
  $("#place-search-form").addEventListener("submit", searchLocation);
  $("#geojson-import").addEventListener("change", importBoundary);
  $("#economics-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.fieldSettings[fieldKey()] = {
      ...state.fieldSettings[fieldKey()],
      economicsReviewed: true,
    };
    renderEconomics();
    toast("Economics scenario updated");
  });
  $("#economics-form").elements.currency.addEventListener(
    "change",
    convertCurrency,
  );
  $("#economics-form").elements.priceSource.addEventListener(
    "change",
    renderMarketContext,
  );
  $("#economics-form").elements.priceDate.addEventListener(
    "change",
    renderMarketContext,
  );
  $("#soil-sample-form").addEventListener("submit", saveSample);
  $("#water-record-form").addEventListener("submit", saveWater);
  $("#feedback-form").addEventListener("submit", saveFeedback);
  $("#crop-filter").addEventListener("input", (event) =>
    renderCropLibrary(event.target.value),
  );
  $("#current-crop").addEventListener("change", () => {
    renderRotations();
    renderMarketContext();
  });
  $("#planning-priority").addEventListener("change", renderRotations);
  $("#irrigation").addEventListener("change", renderRotations);
  $("#planner-ph").addEventListener("change", renderRotations);
  $("#weather-units").addEventListener("change", (event) => {
    state.preferences.units = event.target.value;
    applyPreferences();
    if (state.weather) renderWeather();
  });
  $("#appearance").addEventListener("change", (event) => {
    state.preferences.theme = event.target.value;
    applyPreferences();
  });
  $$(".location-dialog-content").forEach((form) =>
    form.addEventListener("keydown", (event) => {
      if (event.key === "Escape") form.closest("dialog").close();
    }),
  );
}
function setMapModeButtons(mode) {
  $$("[data-map-mode]").forEach((b) =>
    b.classList.toggle("selected", b.dataset.mapMode === mode),
  );
}
function renderMarketContext() {
  const form = $("#economics-form");
  if (!form) return;
  const source =
    form.elements.priceSource?.value ||
    state.economicsInputs.priceSource ||
    "estimate";
  const crop = crops.find((item) => item.id === $("#current-crop")?.value);
  const place =
    [state.location.region, state.location.country]
      .filter(Boolean)
      .join(", ") || state.location.name;
  text("#market-location", hasLocation() ? place : "Choose a field");
  text("#market-crop", crop?.name || "Select a crop in Crop planner");
  text("#market-evidence", t(priceSourceNames[source] || "Choose a source"));
  text(
    "#market-region-note",
    state.location.country
      ? t("Market context follows the selected land.")
      : t("Select a field before building a market scenario."),
  );
  const suggested = countryCurrencies[state.location.country],
    currency = form.elements.currency?.value || state.economicsInputs.currency;
  text(
    "#market-currency-note",
    suggested && suggested !== currency
      ? t("Recommended local currency") + ": " + suggested
      : t("Scenario currency") + ": " + currency,
  );
}
async function convertCurrency(event) {
  const form = $("#economics-form"),
    next = event.target.value,
    previous = state.economicsInputs.currency || "USD";
  if (next === previous) return;
  const populated = currencyFields
    .map((name) => Number(form.elements[name].value))
    .filter(Number.isFinite);
  if (!populated.length) {
    state.economicsInputs = { ...state.economicsInputs, currency: next };
    renderMarketContext();
    return;
  }
  try {
    text("#market-currency-note", "Fetching the latest exchange rate…");
    const response = await fetch(
      "https://api.frankfurter.app/v1/latest?base=" +
        encodeURIComponent(previous) +
        "&symbols=" +
        encodeURIComponent(next),
      { headers: { Accept: "application/json" } },
    );
    const data = await response.json(),
      factor = Number(data?.rates?.[next]);
    if (!response.ok || !Number.isFinite(factor) || factor <= 0)
      throw new Error("No live rate is available for this currency pair.");
    for (const name of currencyFields) {
      const input = form.elements[name],
        value = Number(input.value);
      if (Number.isFinite(value) && input.value !== "")
        input.value = String(Math.round(value * factor * 100) / 100);
    }
    state.economicsInputs = { ...state.economicsInputs, currency: next };
    renderEconomics();
    renderMarketContext();
    text(
      "#market-currency-note",
      "Live exchange rate · " + previous + " → " + next + " · " + data.date,
    );
    toast("Converted using the latest available exchange rate.");
  } catch (error) {
    form.elements.currency.value = previous;
    renderMarketContext();
    toast(error.message || "Live currency conversion is unavailable.");
  }
}
function applyPreferences() {
  const theme = resolvedTheme();
  document.body.classList.toggle("light", theme === "light");
  document.documentElement.dataset.theme = theme;
  $("#appearance").value = ["auto", "dark", "light"].includes(
    state.preferences.theme,
  )
    ? state.preferences.theme
    : "auto";
  $("#weather-units").value = state.preferences.units;
  text(
    "#appearance-help",
    state.preferences.theme === "auto"
      ? theme === "light"
        ? "Automatic is using Daylight right now. It will switch to Forest dark at 19:00."
        : "Automatic is using Forest dark right now. It will switch to Daylight at 07:00."
      : "Manual appearance is active. Choose Automatic to follow local time.",
  );
  text(
    "[data-temp-unit]",
    state.preferences.units === "imperial" ? "°F" : "°C",
  );
  write("fieldshift.preferences", state.preferences);
}
function resolvedTheme() {
  if (state.preferences.theme === "light" || state.preferences.theme === "dark")
    return state.preferences.theme;
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? "light" : "dark";
}
function renderLocation() {
  const l = state.location;
  const selected = hasLocation();
  renderFieldDataControls();
  text(
    ".field-picker>.eyebrow",
    selected ? "ACTIVE LOCATION" : "FIELD REQUIRED",
  );
  text("[data-field-name]", l.name);
  text(
    "[data-coordinates]",
    selected
      ? Math.abs(l.lat).toFixed(4) +
          "° " +
          (l.lat >= 0 ? "N" : "S") +
          " · " +
          Math.abs(l.lon).toFixed(4) +
          "° " +
          (l.lon >= 0 ? "E" : "W")
      : "Choose a point, field boundary, or GeoJSON",
  );
  text(
    "#selection-type",
    selected ? l.method.toUpperCase() : "NO FIELD SELECTED",
  );
  const area = l.boundary ? polygonAreaHa(l.boundary) : null;
  text(
    "#field-area",
    area
      ? area.toFixed(2) + " ha · drawn boundary"
      : selected?"Point selected · no boundary":"Choose a field to begin",
  );
  text(
    "#mapped-area",
    area
      ? area.toFixed(2) + " ha / " + (area * 2.47105).toFixed(2) + " acres"
      : "No boundary drawn",
  );
  text(
    "#report-area",
    area ? area.toFixed(2) + " hectares" : "Point selection",
  );
  $("#field-name-input").value = selected ? l.name : "";
  renderReports();
  renderSamples();
  renderJournal();
  renderSavedPlans();
  renderMarketContext();
  renderFieldHealth();
  renderDecisionBriefing();
  notifyFieldUpdate();
}
function renderFieldHealth() {
  if (!hasLocation()) {
    text("#field-health-score", "—");
    text("#health-weather-score", "—");
    text("#health-water-score", "—");
    text("#health-soil-score", "—");
    text("#health-profit-score", "—");
    text(
      "#field-health-summary",
      "Choose a real field to connect live weather and add your own local evidence.",
    );
    return;
  }
  const weather = state.weather?.current,
    soilRecords = state.samples.filter((sample) => sample.field === fieldKey());
  const climate = weather
    ? Math.max(
        30,
        Math.min(
          100,
          100 -
            Math.max(0, Math.abs((weather.temperature ?? 22) - 23) - 8) * 4 -
            (weather.weatherCode >= 80 ? 12 : 0),
        ),
      )
    : 55;
  const water = weather
    ? Math.max(
        25,
        Math.min(
          100,
          48 +
            (weather.soilMoisture ?? 0.2) * 135 +
            Math.min(18, (total(state.weather.daily, "rain") ?? 0) / 3),
        ),
      )
    : 55;
  const soil = soilRecords.length
    ? Math.max(
        35,
        Math.min(
          100,
          72 +
            (soilRecords.some((sample) => number(sample.carbon)) ? 8 : 0) +
            (soilRecords.some((sample) => number(sample.ph)) ? 6 : 0),
        ),
      )
    : 55;
  const margin = state.economics?.perHa?.margin,
    profit = number(margin)
      ? Math.max(
          20,
          Math.min(100, 55 + Math.max(-35, Math.min(35, margin / 20))),
        )
      : 55;
  const scores = {
    weather: Math.round(climate),
    water: Math.round(water),
    soil: Math.round(soil),
    profit: Math.round(profit),
  };
  const overall = Math.round(
    Object.values(scores).reduce((sum, value) => sum + value, 0) / 4,
  );
  text("#field-health-score", overall);
  text("#health-weather-score", scores.weather + "/100");
  text("#health-water-score", scores.water + "/100");
  text("#health-soil-score", scores.soil + "/100");
  text("#health-profit-score", scores.profit + "/100");
  const ring = $("#field-health-ring");
  if (ring) ring.style.strokeDashoffset = String(283 - (283 * overall) / 100);
  text(
    "#field-health-summary",
    t(
      overall >= 75
        ? "Your field signals are working together. Keep checking local evidence before acting."
        : overall >= 55
          ? "Your field is steady, with opportunities to improve the weakest signal."
          : "Your field needs a closer look. Start with the weakest signal before the next decision.",
    ),
  );
}
function renderDecisionBriefing() {
  const host = $("#briefing-alert-list");
  if (!host) return;
  const weather = state.weather?.current,
    week = state.weather ? total(state.weather.daily, "rain") : null,
    samples = state.samples.filter((sample) => sample.field === fieldKey()),
    source = state.economicsInputs.priceSource;
  const alerts = [];
  let move = {
    title: "Add local evidence",
    copy: "A soil sample and a dated local price make field decisions more reliable.",
    link: "#/soil",
    action: "Add soil evidence",
  };
  if (!weather)
    alerts.push({
      kind: "info",
      title: "Weather needs a refresh",
      copy: "Forecast signals are unavailable until the provider returns data.",
      link: "#/weather",
    });
  else {
    if (number(week) && week < 10)
      alerts.push({
        kind: "water",
        title: "Low rain outlook",
        copy: "The next 7-day forecast is below 10 mm. Compare it with crop water demand.",
        link: "#/water",
      });
    if (number(weather.temperature) && weather.temperature >= 32)
      alerts.push({
        kind: "heat",
        title: "Heat window",
        copy: "High temperature is present in the current model. Review sensitive crop stages.",
        link: "#/weather",
      });
  }
  if (!samples.length)
    alerts.push({
      kind: "soil",
      title: "Local soil evidence missing",
      copy: "Add a dated pH or organic-carbon record before relying on soil recommendations.",
      link: "#/soil",
    });
  if (source === "estimate" || source === "none")
    alerts.push({
      kind: "market",
      title: "Local price needs verification",
      copy: "Add a dated farm-gate, contract, cooperative, wholesale, or benchmark quote.",
      link: "#/profit",
    });
  if (alerts.some((alert) => alert.kind === "water"))
    move = {
      title: "Review the water window",
      copy: "Rainfall is limited in the connected forecast. Compare rain with reference demand before scheduling irrigation.",
      link: "#/water",
      action: "Open water intelligence",
    };
  else if (!samples.length)
    move = {
      title: "Add a dated soil sample",
      copy: "A pH or organic-carbon result will make the crop-plan evidence more specific to your land.",
      link: "#/soil",
      action: "Add soil sample",
    };
  else if (source === "estimate" || source === "none")
    move = {
      title: "Verify your local price",
      copy: "Profit is most useful when the price source and date match your actual market.",
      link: "#/profit",
      action: "Open profit scenario",
    };
  else if (weather)
    move = {
      title: "Compare the next rotation",
      copy: "Your core evidence is connected. Review crop diversity, water access, and current soil pH together.",
      link: "#/crops",
      action: "Open crop planner",
    };
  const connected = [
    !!weather,
    samples.length > 0,
    source !== "estimate" && source !== "none",
    !!state.location.boundary,
  ].filter(Boolean).length;
  text(
    "#briefing-date",
    "Updated " +
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
  );
  text("#briefing-next-title", move.title);
  text("#briefing-next-copy", move.copy);
  const link = $("#briefing-next-link");
  link.href = move.link;
  link.childNodes[0].textContent = move.action + " ";
  text("#briefing-evidence-score", connected + "/4");
  text(
    "#briefing-evidence-copy",
    connected === 4
      ? "Weather, local soil, dated price, and a mapped boundary are connected."
      : 4 -
          connected +
          " evidence connection" +
          (4 - connected === 1 ? "" : "s") +
          " still need attention.",
  );
  text(
    "#briefing-alert-count",
    alerts.length + " " + (alerts.length === 1 ? "ALERT" : "ALERTS"),
  );
  host.innerHTML = alerts.length
    ? alerts
        .map(
          (alert) =>
            '<a class="briefing-alert ' +
            alert.kind +
            '" href="' +
            alert.link +
            '"><i>' +
            (alert.kind === "water"
              ? "⌁"
              : alert.kind === "soil"
                ? "◒"
                : alert.kind === "heat"
                  ? "☀"
                  : alert.kind === "market"
                    ? "↗"
                    : "•") +
            "</i><span><b>" +
            escapeHTML(alert.title) +
            "</b><small>" +
            escapeHTML(alert.copy) +
            "</small></span><em>→</em></a>",
        )
        .join("")
    : '<div class="briefing-clear"><span>✓</span><div><b>No urgent signal</b><small>Connected data does not show a threshold alert right now.</small></div></div>';
}
function renderSeasonHorizon() {
  const host = $("#season-horizon");
  if (!host) return;
  const plan = state.rotationOptions.find(
      (item) => item.id === state.selectedPlan,
    ),
    current = crops.find((item) => item.id === $("#current-crop")?.value),
    sequence = [
      current,
      ...(plan?.sequence || []).map((id) =>
        crops.find((item) => item.id === id),
      ),
    ]
      .filter(Boolean)
      .slice(0, 3),
    start = new Date();
  host.innerHTML = sequence
    .map((crop, index) => {
      const date = new Date(start);
      date.setMonth(date.getMonth() + index * 4);
      return (
        '<div class="season-stage"><span class="season-stage-date">' +
        date.toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
        }) +
        "</span><i>♧</i><b>" +
        escapeHTML(crop.name) +
        "</b><small>" +
        escapeHTML(
          index === 0
            ? "Current crop · observe conditions"
            : index === 1
              ? "Rotation window · confirm local fit"
              : "Later path · validate market and timing",
        ) +
        "</small></div>"
      );
    })
    .join('<span class="season-stage-arrow">→</span>');
}
function clearNasa() {
  state.nasaController?.abort();
  state.nasa = null;
  $("#nasa-result").innerHTML =
    '<span class="empty">Load historical NASA context for the current selected location.</span>';
}
function selectLocation(point, move = true) {
  if (!validPoint(point)) throw new Error("Please enter valid coordinates.");
  state.location = {
    ...point,
    boundary: point.boundary ?? null,
    id: point.id ?? crypto.randomUUID(),
  };
  clearNasa();
  // A new point does not inherit a previous field’s geometry.
  state.map.clearBoundary();
  if (point.boundary) {
    state.location.boundary = point.boundary;
    state.map.setBoundary(point.boundary);
  }
  restoreFieldSettings();
  if (move) state.map.setLocation(point);
  write("fieldshift.location", state.location);
  renderLocation();
  loadWeather();
}
async function searchLocation(event) {
  event.preventDefault();
  state.searchController?.abort();
  state.searchController = new AbortController();
  const query = event.target.elements.query.value.trim();
  if (query.length < 2) return;
  $("#search-results").innerHTML =
    '<p class="search-results-status">Searching for places…</p>';
  try {
    const results = await searchPlaces(query, {
      signal: state.searchController.signal,
    });
    $("#search-results").replaceChildren();
    if (!results.length) {
      $("#search-results").innerHTML =
        '<p class="search-results-status">No places found. Try a nearby town or enter coordinates.</p>';
      return;
    }
    for (const place of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.innerHTML =
        escapeHTML(place.name) +
        "<small>" +
        place.lat.toFixed(4) +
        ", " +
        place.lon.toFixed(4) +
        "</small>";
      button.addEventListener("click", () => {
        selectLocation({ ...place, method: "Place search" });
        $("#location-dialog").close();
        toast("Selected " + place.name);
      });
      $("#search-results").append(button);
    }
  } catch (error) {
    if (error.name !== "AbortError")
      $("#search-results").innerHTML =
        '<p class="search-results-status">' +
        escapeHTML(error.message) +
        "</p>";
  }
}
function useCoordinates() {
  const lat = $("#latitude-input").value.trim(),
    lon = $("#longitude-input").value.trim();
  if (!lat || !lon) return toast("Enter both latitude and longitude.");
  const point = {
    lat: Number(lat),
    lon: Number(lon),
    name: "Coordinate selection",
    method: "Coordinates",
  };
  if (!validPoint(point))
    return toast("Latitude must be −90 to 90 and longitude −180 to 180.");
  selectLocation(point);
  $("#location-dialog").close();
  toast("Coordinates selected");
}
function requestAutoLocation(){
  if(!navigator.geolocation)return;
  navigator.geolocation.getCurrentPosition(position=>{if(!hasLocation())selectLocation({lat:position.coords.latitude,lon:position.coords.longitude,name:'My current location',method:'Device location'});},()=>{}, {enableHighAccuracy:false,timeout:15000,maximumAge:60000});
}
function useDeviceLocation() {
  if (!navigator.geolocation)
    return toast("Location access is unavailable in this browser.");
  toast("Waiting for your location permission…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      selectLocation({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        name: "My current location",
        method: "Device location",
      });
      $("#location-dialog").close();
      toast("Device location selected. Draw a boundary to map a field.");
    },
    (error) =>
      toast(
        error.code === 1
          ? "Location permission was declined. You can use search or coordinates."
          : "Could not retrieve location. Try search or coordinates.",
      ),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
  );
}
async function importBoundary(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 1000000)
      throw new Error("Use a GeoJSON file smaller than 1 MB.");
    const json = JSON.parse(await file.text());
    const geometry = validatePolygon(
      json.type === "FeatureCollection" ? json.features?.[0] : json,
    );
    const point = polygonReferencePoint(geometry);
    selectLocation({
      ...point,
      name: file.name.replace(/\.(geojson|json)$/i, ""),
      method: "Imported boundary",
      boundary: geometry,
    });
    state.economicsInputs.areaHa = Number(polygonAreaHa(geometry).toFixed(4));
    $("#economics-form").elements.areaHa.value = state.economicsInputs.areaHa;
    renderEconomics();
    toast("Boundary imported. Verify its alignment on the map.");
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
}
function saveField() {
  if(!hasLocation())return $('#location-dialog').showModal();
  const name = $("#field-name-input").value.trim();
  if (!name) return toast("Give your field a name first.");
  state.location.name = name;
  const field = { ...state.location };
  const existing = state.fields.findIndex((f) => f.id === field.id);
  if (existing >= 0) state.fields[existing] = field;
  else state.fields.push(field);
  write("fieldshift.fields", state.fields);
  write("fieldshift.location", state.location);
  renderFields();
  renderLocation();
  addJournal("Field saved", name);
  toast("Field saved in this browser");
}
function renderFields() {
  const container = $("#saved-field-list");
  container.replaceChildren();
  if (!state.fields.length) {
    container.innerHTML = '<p class="empty">No saved fields yet.</p>';
    return;
  }
  for (const field of state.fields) {
    const button = document.createElement("button");
    button.className = "saved-field-button";
    button.innerHTML =
      escapeHTML(field.name) +
      "<small>" +
      (field.boundary
        ? polygonAreaHa(field.boundary).toFixed(2) + " ha"
        : "Point selection") +
      "</small>";
    button.addEventListener("click", () => selectLocation({ ...field }));
    container.append(button);
  }
}

function renderFieldDataControls(status=state.weather?'ready':'idle',error=''){
  const selected=hasLocation();
  text('[data-context-field]',selected?state.location.name:'Choose your field to get started');
  text('[data-context-select]',selected?'Change field':'Choose field');
  $$('[data-context-refresh]').forEach(button=>{button.hidden=!selected;button.disabled=status==='loading';});
  $$('.field-data-controls').forEach(bar=>{bar.dataset.status=selected?status:'unselected';});
  const place=selected?state.location.lat.toFixed(4)+', '+state.location.lon.toFixed(4):'';
  text('[data-context-status]',!selected?'Choose a place, use your location, or draw a boundary. Weather, Water and Soil will update together.':status==='loading'?'Loading the latest forecast and water signals for '+place+'…':status==='error'?error+' Try Refresh data, or choose another field.':state.weather?'Connected · '+place+' · '+state.weather.source+' · retrieved '+new Date(state.weather.retrievedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Selected point: '+place+'. Refresh data to connect weather and water signals.');
}
async function loadWeather(force=false) {
  if (!hasLocation()) {
    resetWeather("unselected");
    return;
  }
  state.weatherController?.abort();
  state.weatherController = new AbortController();
  const request = ++state.requestId;
  state.weather = null;
  resetWeather("loading");
  try {
    const weather = await fetchWeather(state.location, {
      signal: state.weatherController.signal,
      force,
    });
    if (request !== state.requestId) return;
    state.weather = weather;
    renderWeather();
    renderRotations();
  } catch (error) {
    if (error.name === "AbortError" || request !== state.requestId) return;
    resetWeather("error");
    renderFieldDataControls('error',error.message);
    text('[data-stat="conditions"]', "Data unavailable");
    text("#connection-label", "PROVIDER UNAVAILABLE");
    text(
      "#home-forecast",
      error.message + " Use Refresh conditions on the Weather page to retry.",
    );
    text("#full-forecast", error.message);
    text(
      '[data-stat="provenance"]',
      error.message + " No sample values have been substituted.",
    );
  }
  renderReports();
}
function resetWeather(status) {
  renderFieldDataControls(status);
  [
    "temperature",
    "rainWeek",
    "moisture",
    "etWeek",
    "feelsLike",
    "humidity",
    "wind",
    "timezone",
    "weatherTime",
    "elevation",
    "retrievalShort",
    "retrievedAt",
  ].forEach((key) => text('[data-stat="' + key + '"]', "—"));
  text(
    "[data-weather-status]",
    status === "loading"
      ? "LOADING"
      : status === "unselected"
        ? "FIELD REQUIRED"
        : "UNAVAILABLE",
  );
  text(
    '[data-stat="conditions"]',
    status === "loading"
      ? "Fetching conditions…"
      : status === "unselected"
        ? "Choose a field to load live conditions"
        : "Unavailable",
  );
  $("#home-forecast").innerHTML =
    '<p class="empty">' +
    (status === "loading"
      ? "Fetching the latest forecast…"
      : status === "unselected"
        ? "Choose a field to load the live forecast."
        : "The data provider is unavailable.") +
    "</p>";
  $("#full-forecast").innerHTML =
    '<p class="empty">' +
    (status === "loading"
      ? "Loading seven-day outlook…"
      : status === "unselected"
        ? "Choose a field to load the forecast."
        : "Forecast unavailable.") +
    "</p>";
  $("#hourly-chart").innerHTML =
    '<p class="empty">' +
    (status === "loading"
      ? "Loading hourly data…"
      : status==='unselected'?'Choose a field above to load hourly temperature.':"Hourly data unavailable.") +
    "</p>";
  $("#water-chart").innerHTML =
    '<p class="empty">' +
    (status === "loading"
      ? "Loading water signals…"
      : status==='unselected'?'Choose a field above to load rainfall and reference water demand.':"Water signals unavailable.") +
    "</p>";
  renderReports();
  renderFieldHealth();
  renderDecisionBriefing();
  notifyFieldUpdate();
}
function renderWeather() {
  const w = state.weather;
  if (!w) return;
  renderFieldDataControls('ready');
  const c = w.current;
  text('[data-stat="temperature"]', temp(c.temperature));
  text('[data-stat="conditions"]', formatWeatherCode(c.weatherCode));
  text('[data-stat="moisture"]', moisture(c.soilMoisture));
  text('[data-stat="rainWeek"]', rain(total(w.daily, "rain")));
  text('[data-stat="etWeek"]', rain(total(w.daily, "et0")));
  text('[data-stat="feelsLike"]', temp(c.feelsLike));
  text('[data-stat="humidity"]', number(c.humidity) ? c.humidity + "%" : "—");
  text('[data-stat="wind"]', wind(c.wind));
  text('[data-stat="timezone"]', w.timezone);
  text(
    '[data-stat="elevation"]',
    number(w.elevation) ? Math.round(w.elevation) + " m · grid" : "Unavailable",
  );
  text(
    '[data-stat="weatherTime"]',
    "Valid " +
      (c.time?.replace("T", " ") ?? "time unavailable") +
      " · " +
      w.timezone,
  );
  text('[data-stat="retrievedAt"]', new Date(w.retrievedAt).toLocaleString());
  text(
    '[data-stat="retrievalShort"]',
    (w.cached ? "Cached · " : "") +
      new Date(w.retrievedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
  );
  text(
    '[data-stat="provenance"]',
    (w.cached ? "Cached retrieval · " : "") +
      "Open-Meteo · valid " +
      (c.time ?? "time unavailable") +
      " (" +
      w.timezone +
      ") · retrieved " +
      new Date(w.retrievedAt).toLocaleString() +
      ". Current conditions and shallow moisture are model outputs.",
  );
  text("[data-weather-status]", w.cached ? "CACHED" : "MODEL");
  text("#connection-label", "LATEST DATA CONNECTED");
  const glyph = (day) => (number(day.rain) && day.rain > 1 ? "☂" : "◌");
  $(".weather-glyph").textContent =
    c.weatherCode === 0 ? "☀" : c.weatherCode >= 51 ? "☂" : "☁";
  $("#home-forecast").innerHTML = w.daily
    .slice(0, 4)
    .map(
      (d, i) =>
        '<div class="forecast-item"><span class="forecast-date">' +
        (i === 0 ? "Today" : dateShort(d.date)) +
        "</span><span>" +
        glyph(d) +
        '</span><span class="forecast-temp">' +
        temp(d.high) +
        '</span><span class="forecast-rain">' +
        rain(d.rain) +
        "</span></div>",
    )
    .join("");
  $("#full-forecast").innerHTML = w.daily
    .map(
      (d, i) =>
        '<div class="day-card"><span class="day">' +
        (i === 0 ? "Today" : dateShort(d.date)) +
        '</span><span class="wx">' +
        glyph(d) +
        "</span><strong>" +
        temp(d.high) +
        "<small>" +
        temp(d.low) +
        '</small></strong><span class="rain">' +
        rain(d.rain) +
        "</span></div>",
    )
    .join("");
  renderHourlyChart();
  renderWaterChart();
  renderReports();
  renderFieldHealth();
  renderDecisionBriefing();
  notifyFieldUpdate();
}
function renderHourlyChart() {
  const w = state.weather;
  if (!w) return;
  const now = w.current.time ?? w.hourly[0]?.time;
  const points = w.hourly.filter((h) => h.time >= now).slice(0, 24);
  const values = points
    .filter((p) => number(p.temperature))
    .map((p) => temperatureValue(p.temperature));
  if (!values.length) {
    $("#hourly-chart").innerHTML =
      '<p class="empty">Hourly values unavailable.</p>';
    return;
  }
  const min = Math.floor(Math.min(...values)) - 2,
    max = Math.ceil(Math.max(...values)) + 2,
    width = 700,
    height = 165,
    left = 35,
    right = 18,
    top = 14,
    bottom = 30;
  const x = (i) =>
      left + (i * (width - left - right)) / Math.max(1, points.length - 1),
    y = (n) => top + ((max - n) / (max - min)) * (height - top - bottom);
  let line = "",
    inSegment = false;
  points.forEach((p, i) => {
    if (!number(p.temperature)) {
      inSegment = false;
      return;
    }
    line +=
      (inSegment ? " L" : " M") +
      x(i).toFixed(1) +
      " " +
      y(temperatureValue(p.temperature)).toFixed(1);
    inSegment = true;
  });
  const grid = [min, (min + max) / 2, max]
    .map(
      (n) =>
        '<path class="chart-grid" d="M' +
        left +
        " " +
        y(n) +
        "H" +
        (width - right) +
        '"/><text class="axis-label" x="1" y="' +
        (y(n) + 3) +
        '">' +
        Math.round(n) +
        "°</text>",
    )
    .join("");
  const labels = points
    .filter((p, i) => i % 5 === 0)
    .map((p) => {
      const i = points.indexOf(p);
      return (
        '<text class="axis-label" x="' +
        x(i) +
        '" y="' +
        (height - 5) +
        '" text-anchor="middle">' +
        p.time.slice(11, 16) +
        "</text>"
      );
    })
    .join("");
  const chart = $("#hourly-chart");
  chart.innerHTML =
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="Next 24 hours temperature chart in ' +
    (state.preferences.units === "imperial" ? "Fahrenheit" : "Celsius") +
    '">' +
    grid +
    '<path class="temp-line" d="' +
    line +
    '"/>' +
    labels +
    '</svg><div class="chart-detail">Tap the chart to inspect the closest hourly modeled temperature.</div>';
  chart.querySelector("svg").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      index = Math.max(
        0,
        Math.min(
          points.length - 1,
          Math.round(
            (((event.clientX - rect.left) / rect.width) *
              (width - left - right) +
              left -
              left) /
              ((width - left - right) / Math.max(1, points.length - 1)),
          ),
        ),
      ),
      point = points[index];
    chart.querySelector(".chart-detail").textContent =
      point?.time?.replace("T", " ") +
      " · " +
      (number(point?.temperature) ? temp(point.temperature) : "Unavailable") +
      " · modeled hourly temperature";
  });
}
function renderWaterChart() {
  const days = state.weather?.daily;
  if (!days?.length) return;
  const vals = days.flatMap((d) => [d.rain, d.et0]).filter(number);
  if (!vals.length) {
    $("#water-chart").innerHTML =
      '<p class="empty">No water values returned.</p>';
    return;
  }
  const width = 700,
    height = 185,
    left = 35,
    bottom = 28,
    top = 15,
    max = Math.max(2, ...vals),
    step = (width - left - 15) / days.length;
  const y = (n) => height - bottom - (n / max) * (height - bottom - top);
  const grid = [0, max / 2, max]
    .map(
      (v) =>
        '<path class="chart-grid" d="M' +
        left +
        " " +
        y(v) +
        'H690"/><text class="axis-label" x="0" y="' +
        (y(v) + 3) +
        '">' +
        (state.preferences.units === "imperial"
          ? (v / 25.4).toFixed(2)
          : v.toFixed(1)) +
        "</text>",
    )
    .join("");
  const bars = days
    .map((d, i) => {
      const x = left + i * step + step / 2;
      let shape = "";
      if (number(d.rain))
        shape +=
          '<rect x="' +
          (x - 16) +
          '" y="' +
          y(d.rain) +
          '" width="13" height="' +
          (height - bottom - y(d.rain)) +
          '" rx="2" fill="#7eb4b4" stroke="none"><title>' +
          d.date +
          " rain " +
          rain(d.rain) +
          "</title></rect>";
      if (number(d.et0))
        shape +=
          '<rect x="' +
          (x + 3) +
          '" y="' +
          y(d.et0) +
          '" width="13" height="' +
          (height - bottom - y(d.et0)) +
          '" rx="2" fill="#c7b16c" stroke="none"><title>' +
          d.date +
          " ET0 " +
          rain(d.et0) +
          "</title></rect>";
      return (
        shape +
        '<text class="axis-label" x="' +
        x +
        '" y="' +
        (height - 4) +
        '" text-anchor="middle">' +
        dateShort(d.date) +
        "</text>"
      );
    })
    .join("");
  const chart = $("#water-chart");
  chart.innerHTML =
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="Daily rainfall and reference evapotranspiration, ' +
    (state.preferences.units === "imperial" ? "inches" : "millimeters") +
    '">' +
    grid +
    bars +
    '</svg><div class="chart-detail">Tap a day to inspect forecast rain and reference ET₀.</div>';
  chart.querySelector("svg").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      index = Math.max(
        0,
        Math.min(
          days.length - 1,
          Math.floor(((event.clientX - rect.left) / rect.width) * days.length),
        ),
      ),
      day = days[index];
    chart.querySelector(".chart-detail").textContent =
      day?.date +
      " · Rain " +
      rain(day?.rain) +
      " · Reference ET₀ " +
      rain(day?.et0) +
      " · forecast/model inputs";
  });
}

function renderRotations() {
  const ph = $("#planner-ph").value;
  const priority =
    $("#planning-priority").value === "resilience"
      ? "risk"
      : $("#planning-priority").value;
  state.rotationOptions = recommendRotations({
    priority,
    currentCrop: $("#current-crop").value || "wheat",
    irrigated: $("#irrigation").value === "irrigated",
    ph: ph === "" ? null : Number(ph),
    weather: state.weather,
  });
  if (!state.rotationOptions.some((p) => p.id === state.selectedPlan))
    state.selectedPlan = state.rotationOptions[0]?.id;
  $("#rotation-plans").innerHTML = state.rotationOptions
    .map(
      (plan, i) =>
        '<article class="rotation-plan ' +
        (plan.id === state.selectedPlan ? "selected" : "") +
        '"><div class="plan-top"><span class="plan-number">PATH / 0' +
        (i + 1) +
        '</span><span class="pill">' +
        (plan.id === state.selectedPlan ? "SELECTED" : "TRAIT SCREENING") +
        "</span></div><h2>" +
        escapeHTML(plan.name) +
        '</h2><div class="sequence">' +
        plan.sequence
          .map(
            (id, j) =>
              (j ? "<i>→</i>" : "") +
              "<span>" +
              escapeHTML(crops.find((c) => c.id === id)?.name ?? id) +
              "</span>",
          )
          .join("") +
        "</div><ul>" +
        plan.reasons
          .map((reason) => "<li>" + escapeHTML(reason) + "</li>")
          .join("") +
        '</ul><p class="plan-limit">' +
        escapeHTML(plan.limitations[0]) +
        '</p><button class="button ' +
        (plan.id === state.selectedPlan ? "" : "secondary") +
        '" data-select-plan="' +
        plan.id +
        '">' +
        (plan.id === state.selectedPlan
          ? "Selected path"
          : "Choose this path") +
        "</button></article>",
    )
    .join("");
  $$("[data-select-plan]").forEach((button) =>
    button.addEventListener("click", () => {
      state.selectedPlan = button.dataset.selectPlan;
      renderRotations();
    }),
  );
  const plan =
    state.rotationOptions.find((p) => p.id === state.selectedPlan) ??
    state.rotationOptions[0];
  const current =
    crops.find((c) => c.id === $("#current-crop").value) ?? crops[0];
  const steps = [
    { name: current.name, label: "CURRENT CROP", kind: current.family },
    ...plan.sequence
      .slice(0, 2)
      .map((id, i) => ({
        name: crops.find((c) => c.id === id)?.name ?? id,
        label: "SEASON " + (i + 1),
        kind: crops.find((c) => c.id === id)?.type ?? "",
      })),
  ];
  $("#rotation-preview").innerHTML = steps
    .map(
      (c, i) =>
        (i ? '<span class="rotation-arrow">→</span>' : "") +
        '<div class="rotation-step"><span class="crop-symbol">' +
        (i ? "♧" : "♧") +
        '</span><span class="eyebrow">' +
        c.label +
        "</span><strong>" +
        escapeHTML(c.name) +
        "</strong><small>" +
        escapeHTML(c.kind) +
        "</small></div>",
    )
    .join("");
  renderSeasonHorizon();
  renderDecisionBriefing();
  persistFieldSettings();
  notifyFieldUpdate();
}
function renderCropLibrary(filter = "") {
  $("#crop-library").innerHTML =
    crops
      .filter((c) =>
        (c.name + " " + c.family + " " + c.type)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
      .map(
        (c) =>
          '<article class="crop-library-card"><span class="eyebrow">' +
          escapeHTML(c.family.toUpperCase()) +
          "</span><h3>" +
          escapeHTML(c.name) +
          "</h3><p>" +
          escapeHTML(c.notes) +
          '</p><div class="crop-traits"><span>' +
          escapeHTML(c.season) +
          "</span><span>pH " +
          c.phMin +
          "–" +
          c.phMax +
          "</span><span>" +
          escapeHTML(c.waterDemand) +
          ' demand</span></div><a href="' +
          escapeHTML(c.reference) +
          '" target="_blank" rel="noreferrer">FAO crop reference ↗</a></article>',
      )
      .join("") || '<p class="empty">No matching crops.</p>';
  replaceArrowGlyphs();
}
function savePlan() {
  if(!hasLocation())return $('#location-dialog').showModal();
  const plan = state.rotationOptions.find((p) => p.id === state.selectedPlan);
  if (!plan) return;
  state.plans.push({
    ...plan,
    id: crypto.randomUUID(),
    pathId: plan.id,
    field: fieldKey(),
    location: { ...state.location },
    savedAt: new Date().toISOString(),
    economics: { ...state.economicsInputs },
    planner: { ...state.fieldSettings[fieldKey()]?.planner },
  });
  write("fieldshift.plans", state.plans);
  addJournal("Rotation plan saved", plan.name);
  renderSavedPlans();
  notifyFieldUpdate();
  toast("Plan and assumptions saved in this browser");
}
function renderSavedPlans() {
  const container = $("#saved-plans-list");
  if (!container) return;
  const entries = state.plans
    .filter((p) => p.field === fieldKey())
    .slice()
    .reverse();
  container.replaceChildren();
  if (!entries.length) {
    container.innerHTML =
      '<p class="empty">No saved paths for this land yet. Choose a path above and save it with its assumptions.</p>';
    return;
  }
  for (const plan of entries) {
    const row = document.createElement("div");
    row.className = "sample-row";
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = plan.name;
    const details = document.createElement("p");
    details.textContent = (plan.sequence ?? [])
      .map((id) => crops.find((c) => c.id === id)?.name ?? id)
      .join(" → ");
    const date = document.createElement("small");
    date.textContent = "Saved " + new Date(plan.savedAt).toLocaleString();
    content.append(title, details, date);
    const actions = document.createElement("div");
    actions.className = "button-row";
    const restore = document.createElement("button");
    restore.className = "button secondary small";
    restore.textContent = "Restore assumptions";
    restore.onclick = () => {
      if (plan.field !== fieldKey()) return;
      state.fieldSettings[fieldKey()] = {
        ...state.fieldSettings[fieldKey()],
        economics: { ...plan.economics },
        planner: {
          ...(plan.planner ?? {}),
          selectedPlan: plan.pathId ?? plan.id,
        },
      };
      const weather = state.weather;
      restoreFieldSettings();
      state.weather = weather;
      renderRotations();
      renderWeather();
      renderReports();
      toast("Saved path assumptions restored to this land");
    };
    const remove = document.createElement("button");
    remove.className = "button secondary small";
    remove.textContent = "Remove";
    remove.onclick = () => {
      if (plan.field !== fieldKey()) return;
      state.plans = state.plans.filter((p) => p !== plan);
      write("fieldshift.plans", state.plans);
      renderSavedPlans();
      notifyFieldUpdate();
      toast("Saved path removed from this browser");
    };
    actions.append(restore, remove);
    row.append(content, actions);
    container.append(row);
  }
}
function renderEconomics() {
  const form = $("#economics-form"),
    reviewed = state.fieldSettings[fieldKey()]?.economicsReviewed,
    source =
      form?.elements.priceSource?.value || state.economicsInputs.priceSource;
  text(
    "#economics-status",
    reviewed && source !== "estimate" && source !== "none"
      ? t("LOCAL MARKET INPUTS")
      : t("LOCAL INPUTS REQUIRED"),
  );
  const raw = Object.fromEntries(new FormData(form));
  const needed = [
    "areaHa",
    "yieldTonnesHa",
    "pricePerTonne",
    "sellingLossPercent",
    "transportCostPerTonne",
    "marketFeePercent",
    "seedCostHa",
    "fertilizerCostHa",
    "waterCostHa",
    "operationsCostHa",
  ];
  if (
    !hasLocation() ||
    source === "none" ||
    needed.some((key) => String(raw[key] ?? "").trim() === "")
  ) {
    state.economics = null;
    text("#profit-total", "—");
    text(
      "#profit-per-ha",
      "Enter a selected field, a price source, and every local input.",
    );
    text('[data-stat="margin"]', "—");
    text("#profit-revenue", "—");
    text("#profit-cost", "—");
    text("#profit-selling-costs", "—");
    text("#break-even-price", "—");
    text("#break-even-yield", "—");
    $("#profit-scenarios").innerHTML =
      '<p class="empty">No profit scenario is calculated until all inputs are entered.</p>';
    renderFieldHealth();
    renderDecisionBriefing();
    renderMarketContext();
    return;
  }
  try {
    const inputs = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        economicsTextFields.has(key) ? value : Number(value),
      ]),
    );
    state.economics = calculateEconomics(inputs);
    state.economicsInputs = inputs;
    persistFieldSettings();
    const e = state.economics,
      locale =
        { en: "en-US", fr: "fr-FR", ar: "ar-SA" }[currentLanguage()] || "en-US";
    text("#profit-total", money(e.margin));
    text(
      "#profit-per-ha",
      money(e.perHa.margin) +
        " " +
        t("per hectare") +
        " · " +
        e.areaHa.toLocaleString(locale) +
        " ha",
    );
    text('[data-stat="margin"]', money(e.perHa.margin));
    text("#profit-revenue", money(e.revenue));
    text("#profit-cost", money(e.cost));
    text("#profit-selling-costs", money(e.sellingCosts));
    text(
      "#break-even-price",
      number(e.breakEvenPrice)
        ? money(e.breakEvenPrice) + " / t"
        : t("Not defined for these inputs"),
    );
    text(
      "#break-even-yield",
      number(e.breakEvenYield)
        ? e.breakEvenYield.toFixed(2) + " t/ha"
        : t("Not defined for these inputs"),
    );
    renderFieldHealth();
    renderDecisionBriefing();
    const max = Math.max(1, ...e.scenarios.map((s) => Math.abs(s.margin)));
    $("#profit-scenarios").innerHTML = e.scenarios
      .map(
        (s, i) =>
          '<div class="scenario-row"><span>' +
          escapeHTML(t(s.name)) +
          "<small>" +
          t(
            i === 0
              ? "Local yield and price −10%"
              : i === 2
                ? "Local yield and price +10%"
                : "Your local yield and price",
          ) +
          '</small></span><div class="scenario-bar"><i style="width:' +
          Math.max(3, (Math.abs(s.margin) / max) * 100) +
          '%"></i></div><strong>' +
          money(s.margin) +
          "</strong></div>",
      )
      .join("");
    renderMarketContext();
    renderReports();
  } catch (error) {
    toast(error.message);
  }
}
function addJournal(title, detail) {
  state.journal.unshift({
    id: crypto.randomUUID(),
    title,
    detail,
    field: fieldKey(),
    time: new Date().toISOString(),
  });
  state.journal = state.journal.slice(0, 100);
  write("fieldshift.journal", state.journal);
  renderJournal();
}
function renderJournal() {
  const entries = state.journal
    .filter((e) => e.field === fieldKey())
    .slice(0, 4);
  $("#journal-list").innerHTML = entries.length
    ? entries
        .map(
          (e) =>
            '<div class="journal-entry"><i></i><div><b>' +
            escapeHTML(e.title) +
            "</b><small>" +
            escapeHTML(e.detail) +
            " · " +
            new Date(e.time).toLocaleDateString() +
            "</small></div><span>›</span></div>",
        )
        .join("")
    : '<div class="journal-empty">' +
      icon("leaf") +
      '<p>A new season starts with a first note. Save a field or add a soil sample to begin.</p><button class="button secondary small" data-action="soil-dialog">Add your first sample +</button></div>';
}
function saveSample(event) {
  event.preventDefault();
  if(!hasLocation())return $('#location-dialog').showModal();
  const data = Object.fromEntries(new FormData(event.target));
  if (data.ph === "" && data.carbon === "")
    return toast("Enter pH or organic carbon for this sample.");
  const record = {
    ...data,
    id: crypto.randomUUID(),
    field: fieldKey(),
    location: { lat: state.location.lat, lon: state.location.lon },
    ph: data.ph === "" ? null : Number(data.ph),
    carbon: data.carbon === "" ? null : Number(data.carbon),
    depth: Number(data.depth),
  };
  state.samples.push(record);
  write("fieldshift.samples", state.samples);
  addJournal("Soil sample added", record.name);
  renderSamples();
  $("#soil-dialog").close();
  event.target.reset();
  event.target.elements.date.value = today();
  toast("Sample saved to the selected field");
}
function renderSamples() {
  const samples = state.samples.filter((s) => s.field === fieldKey());
  $("#soil-samples").innerHTML = samples.length
    ? samples
        .map(
          (s) =>
            '<div class="sample-row"><div><h3>' +
            escapeHTML(s.name) +
            "</h3><p>pH " +
            (number(s.ph) ? s.ph : "—") +
            " · Organic carbon " +
            (number(s.carbon) ? s.carbon + "%" : "—") +
            " · Depth " +
            s.depth +
            " cm</p><small>" +
            escapeHTML(s.date) +
            " · " +
            escapeHTML(s.method) +
            '</small></div><div class="button-row">' +
            (number(s.ph)
              ? '<button class="button secondary small" data-use-sample="' +
                escapeHTML(s.id) +
                '">Use pH in planner</button>'
              : "") +
            '<button data-delete-sample="' +
            escapeHTML(s.id) +
            '">Remove</button></div></div>',
        )
        .join("")
    : '<div class="journal-empty">' +
      icon("layers") +
      '<p>No measurements for this field yet. Add a dated sample from your own laboratory or field records.</p><button class="button secondary small" data-action="soil-dialog">Add a sample +</button></div>';
  $$("[data-use-sample]").forEach(
    (button) =>
      (button.onclick = () => {
        const sample = samples.find((s) => s.id === button.dataset.useSample);
        if (!sample || sample.field !== fieldKey()) return;
        $("#planner-ph").value = sample.ph;
        renderRotations();
        location.hash = "/crops";
        toast(
          "Planner uses pH " +
            sample.ph +
            " from " +
            sample.name +
            " · " +
            sample.date,
        );
      }),
  );
  $$("[data-delete-sample]").forEach((b) =>
    b.addEventListener("click", () => {
      state.samples = state.samples.filter(
        (s) => s.id !== b.dataset.deleteSample || s.field !== fieldKey(),
      );
      write("fieldshift.samples", state.samples);
      renderSamples();
      toast("Sample removed from this device");
    }),
  );
  notifyFieldUpdate();
}
function saveWater(event) {
  event.preventDefault();
  if(!hasLocation())return $('#location-dialog').showModal();
  const data = Object.fromEntries(new FormData(event.target));
  addJournal(
    "Irrigation applied",
    Number(data.amount).toFixed(1) + " mm · " + data.date,
  );
  toast("Irrigation record saved");
  event.target.elements.amount.value = "";
}
function saveFeedback(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target)),
    comment = String(data.comment || "").trim(),
    name = String(data.name || "").trim();
  if (comment.length < 10) return toast("Please write at least 10 characters.");
  state.feedback.unshift({
    id: crypto.randomUUID(),
    name: name || "Anonymous",
    category: String(data.category || "Idea"),
    rating: Number(data.rating) || 5,
    comment,
    createdAt: new Date().toISOString(),
  });
  state.feedback = state.feedback.slice(0, 50);
  write("fieldshift.feedback", state.feedback);
  event.target.reset();
  renderFeedback();
  toast(t("Feedback saved. Thank you."));
}
function renderFeedback() {
  const host = $("#feedback-list");
  if (!host) return;
  text(
    "#feedback-count",
    state.feedback.length +
      " " +
      t(state.feedback.length === 1 ? "COMMENT" : "COMMENTS"),
  );
  if (!state.feedback.length) {
    host.innerHTML =
      '<div class="feedback-empty"><span>✦</span><h3>' +
      t("No feedback yet") +
      "</h3><p>" +
      t(
        "Your ideas and observations will appear here after you submit the form.",
      ) +
      "</p></div>";
    return;
  }
  const locale =
    { en: "en-US", fr: "fr-FR", ar: "ar-SA" }[currentLanguage()] || "en-US";
  host.innerHTML = state.feedback
    .map(
      (item) =>
        '<article class="feedback-entry"><div class="feedback-entry-head"><span class="pill">' +
        escapeHTML(t(item.category)) +
        '</span><span class="feedback-stars" aria-label="' +
        item.rating +
        " " +
        escapeHTML(t("out of 5")) +
        '">' +
        "★".repeat(item.rating) +
        "<i>" +
        "★".repeat(5 - item.rating) +
        "</i></span></div><p>" +
        escapeHTML(item.comment) +
        "</p><footer><span><b>" +
        escapeHTML(item.name) +
        "</b> · " +
        new Date(item.createdAt).toLocaleDateString(locale) +
        '</span><button type="button" data-action="delete-feedback" data-id="' +
        item.id +
        '">' +
        t("Remove") +
        "</button></footer></article>",
    )
    .join("");
}

let assistantHistory = read('fieldshift.ai.history',[]).filter(item=>['user','assistant'].includes(item?.role)&&typeof item?.content==='string').slice(-12);
let aiEngine;
let aiBusy=false;
const AI_MODEL = 'gemma-2-9b-it-q4f32_1-MLC';
function initAiStorageSettings(){
  const panel=document.createElement('article');panel.className='panel ai-storage-panel';
  panel.innerHTML='<div class="panel-heading"><div><span class="eyebrow">AI STORAGE & PERFORMANCE</span><h2>Make room for your ideas</h2></div><span class="pill">GEMMA 2 · 9B</span></div><div class="ai-storage-grid"><div><span class="eyebrow">DEVICE SPACE USED</span><strong id="ai-storage-used">Checking…</strong></div><div><span class="eyebrow">BROWSER ALLOWANCE</span><strong id="ai-storage-quota">Checking…</strong></div><div><span class="eyebrow">STORAGE RETENTION</span><strong id="ai-storage-retention">Checking…</strong></div></div><p class="fine-print">The browser sets the maximum available space for this site. Retaining storage helps keep the downloaded model between visits when supported. Cloud accounts save your records and chat, not the model files. Model size does not remove its graphics-memory requirement.</p><div class="button-row"><button class="button" id="ai-retain-storage" type="button">Retain model storage</button><button class="button secondary" id="ai-refresh-storage" type="button">Refresh usage</button><button class="button secondary" id="ai-clear-model" type="button">Remove downloaded model</button></div><p class="fine-print" id="assistant-status" role="status">Model loads when you send a message.</p>';
  $('#view-settings').append(panel);
  const refresh=async()=>{const estimate=await navigator.storage?.estimate?.();const gb=value=>number(value)?(value/1e9).toFixed(2)+' GB':'Unavailable';text('#ai-storage-used',gb(estimate?.usage));text('#ai-storage-quota',gb(estimate?.quota));text('#ai-storage-retention',(await navigator.storage?.persisted?.())?'Persistent':'Browser managed');};
  $('#ai-refresh-storage').onclick=()=>refresh().catch(()=>toast('Storage information is unavailable.'));
  $('#ai-retain-storage').onclick=async()=>{try{const retained=await navigator.storage?.persist?.();await refresh();toast(retained?'Persistent storage enabled.':'The browser controls storage retention on this device.');}catch{toast('Storage retention is unavailable in this browser.');}};
  $('#ai-clear-model').onclick=async event=>{if(aiBusy)return toast('Wait for the current AI request to finish.');const button=event.currentTarget;button.disabled=true;try{await aiEngine?.unload();aiEngine=null;const webllm=await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.80/+esm');await webllm.deleteModelAllInfoInCache(AI_MODEL);text('#assistant-status','Downloaded model removed. It will download again when needed.');await refresh();toast('Downloaded AI model removed. It can be downloaded again.');}catch{toast('The model cache could not be cleared.');}finally{button.disabled=false;}};
  refresh().catch(()=>{});
}
function assistantFieldContext() {
  const selected = hasLocation(),
    weather = state.weather?.current,
    samples = state.samples.filter((sample) => sample.field === fieldKey());
  return {
    field: selected
      ? {
          name: state.location.name,
          coordinates: {
            latitude: state.location.lat,
            longitude: state.location.lon,
          },
          country: state.location.country || null,
          boundary_drawn: !!state.location.boundary,
        }
      : null,
    weather: weather
      ? {
          source: "Open-Meteo weather model",
          valid_time: weather.time,
          temperature_c: weather.temperature,
          feels_like_c: weather.feelsLike,
          humidity_percent: weather.humidity,
          wind_kmh: weather.wind,
          soil_moisture_0_to_1cm_model: weather.soilMoisture,
        }
      : null,
    soil_records: samples.map((sample) => ({
      date: sample.date,
      name: sample.name,
      ph: sample.ph,
      organic_carbon_percent: sample.carbon,
      depth_cm: sample.depth,
      method: sample.method,
    })),
    economics: state.economics
      ? {
          currency: state.economics.currency,
          gross_margin: state.economics.margin,
          gross_margin_per_hectare: state.economics.perHa.margin,
          price_source:
            priceSourceNames[state.economicsInputs.priceSource] || null,
          quote_date: state.economicsInputs.priceDate || null,
          notice:
            "Calculated only from farmer-entered scenario inputs; not a verified market forecast.",
        }
      : null,
    nasa_context: state.nasa
      ? {
          source: "NASA POWER",
          year: state.nasa.year,
          retrieved_at: state.nasa.retrievedAt,
          notice: state.nasa.limitations,
        }
      : null,
  };
}
function renderAssistantContext() {
  const host = $("#assistant-context");
  if (!host) return;
  const context = assistantFieldContext(),
    items = [
      ["Field", context.field ? context.field.name : "Not selected"],
      ["Weather", context.weather ? "Live model connected" : "Not connected"],
      [
        "Soil records",
        context.soil_records.length
          ? context.soil_records.length + " record(s)"
          : "None",
      ],
      [
        "Profit scenario",
        context.economics ? "Calculated from your inputs" : "Not calculated",
      ],
      ["NASA history", context.nasa_context ? "Loaded" : "Not loaded"],
    ];
  host.innerHTML = items
    .map(
      ([name, value]) =>
        '<div class="assistant-context-row"><span>' +
        escapeHTML(name) +
        "</span><b>" +
        escapeHTML(String(value)) +
        "</b></div>",
    )
    .join("");
}
function addAssistantMessage(role, content) {
  const host = $("#assistant-messages");
  if (!host) return;
  const article = document.createElement("article");
  article.className = "assistant-message " + role;
  const label = document.createElement("b");
  label.textContent = role === "user" ? "You" : "FieldShift Assistant";
  const body = document.createElement("p");
  body.textContent = content;
  article.append(label, body);
  host.append(article);
  host.scrollTop = host.scrollHeight;
}
function instantAssistantReply(message) {
  const q = message.toLowerCase();
  const field = state.selectedField?.name || "your field";
  if (/weather|rain|temperature|forecast|wind/.test(q)) return `For ${field}, open Weather to see the live forecast, rainfall, wind, and evapotranspiration. I can help you turn those readings into a planting or irrigation decision.`;
  if (/water|irrigat|drought|moisture/.test(q)) return `Open Water for the latest water balance. Start with the current soil moisture and recent rainfall, then adjust irrigation in small steps and review the result after the next reading.`;
  if (/soil|ph|nitrogen|fertil/.test(q)) return `Open Soil to review pH, moisture, and nutrients. Keep a baseline sample, change one input at a time, and use the crop planner to compare rotations that protect soil health.`;
  if (/profit|price|money|cost|sell|revenue/.test(q)) return `Open Profit to enter your local selling price, yield, area, and costs. FieldShift calculates revenue, costs, and margin from your numbers instead of assuming every market pays the same.`;
  if (/crop|rotation|plant|wheat|corn|rice/.test(q)) return `Open Crop planner to compare rotations. A strong plan balances expected margin with water demand, soil recovery, and the weather outlook for ${field}.`;
  if (/nasa|satellite|earth|space/.test(q)) return `FieldShift combines NASA POWER climate history with live weather and your local field inputs. Open NASA data to inspect the source and time range behind each insight.`;
  return `I’m ready to help with ${field}. Try asking about weather, water, soil, crop rotation, profit, or NASA data. I’ll use the values in your workspace when they are available.`;
}
function initAssistant() {
  const host = $("#assistant-messages"),
    form = $("#assistant-form");
  if (!host || !form) return;
  addAssistantMessage(
    "assistant",
    "Welcome to FieldShift AI.",
  );
  assistantHistory.forEach(item=>addAssistantMessage(item.role,item.content));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(aiBusy)return;
    const input = form.elements.message,
      message = String(input.value || "").trim();
    if (!message) return;
    input.value = "";
    addAssistantMessage("user", message);
    const instant = instantAssistantReply(message);
    addAssistantMessage("assistant", instant);
    assistantHistory.push({ role: "user", content: message }, { role: "assistant", content: instant });
    assistantHistory = assistantHistory.slice(-12);
    write('fieldshift.ai.history',assistantHistory);
    const button = form.querySelector("button");
    button.disabled = true;
    aiBusy=true;
    $('#assistant-clear').disabled=true;
    try {
      const status = $("#assistant-status");
      if (!navigator.gpu || !aiEngine) {
        $("#assistant-status").textContent = "Instant guidance is ready. Enable WebGPU in a desktop browser to load the deeper on-device model.";
        return;
      }
      status.textContent = "AI ready · running on your device";
      const stream = await aiEngine.chat.completions.create({messages:[{role:"system",content:"You are FieldShift AI, a helpful general assistant. Answer clearly and concisely. Never invent farm data. Field data: "+JSON.stringify(assistantFieldContext())},...assistantHistory.slice(-2).map(item=>({...item,content:item.content.slice(0,800)})),{role:"user",content:message}],temperature:0.7,max_tokens:256,stream:true});
      let answer='';for await(const chunk of stream){answer+=chunk.choices?.[0]?.delta?.content||'';pending.querySelector('p').textContent=answer||'Thinking…';host.scrollTop=host.scrollHeight;}answer=answer.trim();
      if (!answer) throw new Error("The model returned an empty response. Please try again.");
      const latest = host.lastElementChild;
      if (latest?.classList.contains("assistant")) latest.querySelector("p").textContent = answer;
      assistantHistory.push(
        { role: "user", content: message },
        { role: "assistant", content: answer },
      );
      assistantHistory = assistantHistory.slice(-12);
      write('fieldshift.ai.history',assistantHistory);
    } catch (error) {
      $("#assistant-status").textContent = "AI unavailable or download failed. Check WebGPU support, free storage, and your connection.";
      // Keep the instant answer visible; never leave the user staring at a spinner.
    } finally {
      button.disabled = false;
      aiBusy=false;
      $('#assistant-clear').disabled=false;
      input.focus();
    }
  });
  $("#assistant-clear").addEventListener("click", () => {
    assistantHistory = [];
    write('fieldshift.ai.history',assistantHistory);
    host.replaceChildren();
    addAssistantMessage(
      "assistant",
      "Chat cleared. What would you like to explore?",
    );
  });
}

function evidenceRows() {
  const w = state.weather,
    c = w?.current,
    source =
      priceSourceNames[state.economicsInputs.priceSource] || "User estimate",
    dated = state.economicsInputs.priceDate
      ? source + " · " + state.economicsInputs.priceDate
      : source;
  return [
    [
      "Air temperature",
      c ? temp(c.temperature) : "Unavailable",
      "Current model analysis",
      "Open-Meteo",
    ],
    [
      "7-day rainfall",
      w ? rain(total(w.daily, "rain")) : "Unavailable",
      "Forecast",
      "Open-Meteo",
    ],
    [
      "Surface moisture",
      c ? moisture(c.soilMoisture) : "Unavailable",
      "Modeled 0–1 cm layer",
      "Open-Meteo",
    ],
    [
      "Local gross margin / ha",
      state.economics ? money(state.economics.perHa.margin) : "Not calculated",
      dated,
      state.location.country || "Farmer scenario",
    ],
    [
      "Selling deductions",
      state.economics ? money(state.economics.sellingCosts) : "Not calculated",
      "Loss, transport and market fee",
      "Entered local assumptions",
    ],
    [
      "Selected point",
      state.location.lat.toFixed(4) + ", " + state.location.lon.toFixed(4),
      state.location.method,
      "Your selection",
    ],
  ];
}
function renderReports() {
  const body = $("#report-data");
  if (!body) return;
  body.innerHTML = evidenceRows()
    .map(
      (row) =>
        "<tr>" +
        row.map((value) => "<td>" + escapeHTML(value) + "</td>").join("") +
        "</tr>",
    )
    .join("");
  notifyFieldUpdate();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSV() {
  const rows = [
    ["FieldShift field intelligence report"],
    ["Location", state.location.name],
    ["Retrieved", state.weather?.retrievedAt ?? "Unavailable"],
    ["Signal", "Value", "Evidence type", "Source"],
    ...evidenceRows(),
  ];
  download(
    "fieldshift-report.csv",
    rows
      .map((row) =>
        row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","),
      )
      .join("\r\n"),
    "text/csv;charset=utf-8",
  );
  toast("Report downloaded");
}
async function loadNasa() {
  const container = $("#nasa-result");
  if (!hasLocation()) {
    container.innerHTML =
      '<p class="empty">Choose a field before requesting NASA climate context.</p>';
    return;
  }
  state.nasaController?.abort();
  state.nasaController = new AbortController();
  const key = fieldKey();
  container.innerHTML =
    '<p class="empty">Requesting historical NASA POWER data…</p>';
  try {
    const result = await fetchNasa(state.location, {
      signal: state.nasaController.signal,
    });
    if (key !== fieldKey()) return;
    state.nasa = result;
    const max = Math.max(1, ...result.months.map((m) => m.rain ?? 0));
    container.innerHTML =
      '<span class="eyebrow">' +
      result.year +
      ' MONTHLY RAINFALL · MM</span><div class="nasa-months">' +
      result.months
        .map(
          (m) =>
            '<div class="nasa-month" title="Month ' +
            m.month +
            ": " +
            (number(m.rain) ? m.rain.toFixed(1) + " mm" : "Unavailable") +
            '" style="height:' +
            (number(m.rain) ? Math.max(2, (m.rain / max) * 95) : 0) +
            '%"><span>' +
            m.month +
            "</span></div>",
        )
        .join("") +
      '</div><p class="fine-print">' +
      escapeHTML(result.limitations) +
      '</p><span class="eyebrow">NASA POWER · RETRIEVED ' +
      new Date(result.retrievedAt).toLocaleDateString() +
      "</span>";
    notifyFieldUpdate();
  } catch (error) {
    if (error.name !== "AbortError" && key === fieldKey())
      container.innerHTML =
        '<p class="empty">' +
        escapeHTML(error.message) +
        " You can retry using the button.</p>";
  }
}
init();

function replaceArrowGlyphs() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode())
    if (walker.currentNode.textContent.includes("↗"))
      nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest("script,style,svg")) continue;
    const parts = node.textContent.split("↗");
    const fragment = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i) {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "inline-arrow");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", "M6 18 18 6M6 6h12v12");
        svg.append(path);
        fragment.append(svg);
      }
      fragment.append(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  }
}
