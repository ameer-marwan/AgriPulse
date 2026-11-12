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
import { initI18n, t, tFor, currentLanguage } from "./i18n.js";
import { initIntro } from "./intro.js";
import { workspaceStorage, storageReady } from "./storage.js";

window.__fieldshiftIntro ||= initIntro({language:'en'});
// Do not block first paint on the account/workspace request. Mobile browsers can
// suspend or delay that request; the interface must still render immediately.
await Promise.race([storageReady, new Promise(resolve => setTimeout(resolve, 1200))]);

// The welcome choice is a presentation preference, not an account or a data claim.
// Guided mode deliberately keeps the high-value inputs visible while tucking away
// optional scenario details. Full mode always leaves every control available.
function applyFarmerMode(mode) {
  const simple = mode === 'simple';
  document.body.classList.toggle('simple-farmer', simple);
  document.body.classList.toggle('advanced-farmer', !simple);
  document.documentElement.dataset.farmerMode = simple ? 'simple' : 'advanced';
  document.querySelectorAll('[data-farmer-mode-label]').forEach((label) => {
    label.textContent = simple ? 'GUIDED MODE' : 'FULL CONTROLS';
  });
  document.querySelectorAll('.economics-inputs .market-evidence-inputs input, .economics-inputs .market-evidence-inputs select, .economics-inputs .form-grid label:nth-child(n + 4) input').forEach((input) => {
    input.disabled = simple;
  });
}
function switchFarmerMode(mode, { navigateToWorkspace = true } = {}) {
  const next = mode === 'simple' ? 'simple' : 'advanced';
  try { localStorage.setItem('agripulse.farmer-mode', next); } catch { /* The mode remains active for this visit. */ }
  applyFarmerMode(next);
  if ($('#farmer-mode')) $('#farmer-mode').value = next;
  if ($('#simple-farmer-mode')) $('#simple-farmer-mode').value = next;
  if (navigateToWorkspace) location.hash = next === 'simple' ? '/simple' : '/overview';
  requestAnimationFrame(() => {
    state?.map?.resize?.();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}
let savedFarmerMode = 'advanced';
try { savedFarmerMode = localStorage.getItem('agripulse.farmer-mode') || 'advanced'; } catch { /* Use full controls if preferences cannot persist. */ }
applyFarmerMode(savedFarmerMode);
window.addEventListener('fieldshift:mode:selected', (event) => switchFarmerMode(event.detail));

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
  Turkey: "TRY", Pakistan: "PKR", Bangladesh: "BDT", Japan: "JPY",
  Canada: "CAD", Australia: "AUD", Mexico: "MXN", Argentina: "ARS",
  Chile: "CLP", Colombia: "COP", Indonesia: "IDR", Malaysia: "MYR",
  Thailand: "THB", Philippines: "PHP", Russia: "RUB", Morocco: "MAD",
  Algeria: "DZD", Tunisia: "TND", Jordan: "JOD", "United Arab Emirates": "AED",
  Qatar: "QAR", Kuwait: "KWD", Bahrain: "BHD", Oman: "OMR",
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
  simpleFarm: { objective: "water", waterSource: "unknown", crop: "recommend", crops: [], soilPH: "", soilTexture: "unknown", drainage: "unknown", ...read("fieldshift.simpleFarm", {}) },
};
// Reviewed Simple-mode crop records adapted from the FieldShift AI reference repository.
// They deliberately produce factor labels, never a numeric score or planting instruction.
const simpleCropEvidence = {
  wheat: { name: 'Wheat', ph: { optimum: [6, 7], absolute: [5.5, 8.5] }, texture: { optimum: ['medium', 'organic'], absolute: ['heavy', 'medium'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP 2114' },
  barley: { name: 'Barley', ph: { optimum: [6.5, 7.5], absolute: [6, 8] }, texture: { optimum: ['medium'], absolute: ['heavy', 'medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP 1232' },
  chickpea: { name: 'Chickpea', ph: { optimum: [6, 8.5], absolute: [4.7, 9.5] }, texture: { optimum: ['heavy', 'medium'], absolute: ['heavy', 'medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well', 'excessive'] }, source: 'FAO ECOCROP 2479' },
  alfalfa: { name: 'Alfalfa', ph: { optimum: [6.5, 7.5], absolute: [4.3, 8.7] }, texture: { optimum: ['medium', 'light'], absolute: ['medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well', 'excessive'] }, source: 'FAO ECOCROP 1428' },
  maize: { name: 'Maize', ph: { optimum: [5.8, 7.0], absolute: [5, 8] }, texture: { optimum: ['medium'], absolute: ['heavy', 'medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
  rice: { name: 'Rice', ph: { optimum: [5.5, 6.5], absolute: [4.5, 8] }, texture: { optimum: ['heavy'], absolute: ['heavy', 'medium'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
  tomato: { name: 'Tomato', ph: { optimum: [6, 6.8], absolute: [5, 7.5] }, texture: { optimum: ['medium'], absolute: ['medium', 'light', 'organic'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
  potato: { name: 'Potato', ph: { optimum: [5.2, 6.5], absolute: [4.5, 8] }, texture: { optimum: ['light', 'medium'], absolute: ['light', 'medium'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
  cotton: { name: 'Cotton', ph: { optimum: [5.5, 8], absolute: [5, 9] }, texture: { optimum: ['medium'], absolute: ['heavy', 'medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
  sunflower: { name: 'Sunflower', ph: { optimum: [6, 7.5], absolute: [5, 8.5] }, texture: { optimum: ['medium'], absolute: ['heavy', 'medium', 'light'] }, drainage: { optimum: ['well'], absolute: ['well'] }, source: 'FAO ECOCROP profile' },
};
const simpleCropStickers = { wheat:{icon:'🌾',category:'grain'}, barley:{icon:'🌾',category:'grain'}, chickpea:{icon:'🫘',category:'legume'}, alfalfa:{icon:'🌱',category:'forage'}, maize:{icon:'🌽',category:'grain'}, rice:{icon:'🍚',category:'grain'}, tomato:{icon:'🍅',category:'vegetable'}, potato:{icon:'🥔',category:'vegetable'}, cotton:{icon:'☁️',category:'fiber'}, sunflower:{icon:'🌻',category:'oilseed'} };
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
const localeForLanguage = () =>
  ({
    en: "en-US",
    fr: "fr-FR",
    ar: "ar-SA",
    es: "es-ES",
    de: "de-DE",
    pt: "pt-BR",
    tr: "tr-TR",
    ur: "ur-PK",
    hi: "hi-IN",
    zh: "zh-CN",
  })[currentLanguage()] || "en-US";
const money = (n, currency = state.economicsInputs.currency) =>
  number(n)
    ? new Intl.NumberFormat(localeForLanguage(), {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n)
    : "—";
const moisture = (n) => (number(n) ? (n * 100).toFixed(0) + "%" : "—");
const dateShort = (date) =>
  new Date(date + "T12:00:00").toLocaleDateString(currentLanguage(), { weekday: "short" });
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
  if (localStorage.getItem("agripulse.sidebar-collapsed") === "1") document.body.classList.add("sidebar-collapsed");
  // The transient top-bar data badge is intentionally removed.
  $(".system-status")?.remove();
  const modeIndicator = document.createElement('span');
  modeIndicator.className = 'farmer-mode-indicator';
  modeIndicator.setAttribute('data-farmer-mode-label', '');
  modeIndicator.setAttribute('title', 'Workspace mode selected after the AgriPulse introduction');
  $('.topbar-right')?.prepend(modeIndicator);
  applyFarmerMode(document.body.classList.contains('simple-farmer') ? 'simple' : 'advanced');
  const farmerMode = $('#farmer-mode');
  if (farmerMode) {
    farmerMode.value = document.body.classList.contains('simple-farmer') ? 'simple' : 'advanced';
    farmerMode.addEventListener('change', () => {
      const mode = farmerMode.value === 'simple' ? 'simple' : 'advanced';
      switchFarmerMode(mode);
      toast(mode === 'simple' ? 'Guided workspace enabled.' : 'Full controls enabled.');
    });
  }
  for(const route of ['overview','weather','soil','water','crops','profit','reports']){
    const view=$('#view-'+route),heading=view?.querySelector('.page-heading');if(!heading)continue;
    const bar=document.createElement('section');bar.className='field-data-controls';bar.setAttribute('aria-label','Field data controls');
    bar.innerHTML='<div><span class="eyebrow">YOUR SELECTED LAND</span><strong data-context-field>Choose your field</strong><p data-context-status role="status">Choose a place to load its weather, rainfall, water demand and modeled surface moisture.</p></div><div class="field-data-actions"><button class="button" type="button" data-action="location" data-context-select>Choose field</button><button class="button secondary" type="button" data-action="geolocation">Use my location</button><button class="button secondary" type="button" data-action="refresh" data-context-refresh hidden>Refresh data ↻</button></div>';
    heading.after(bar);
  }
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
    <aside class="learn-note"><span>✦</span><p><b>Keep learning beyond your field.</b> These websites open in a new tab, so your AgriPulse workspace stays exactly where you left it.</p></aside>`;
  $("main").insertBefore(exploreView, $(".app-footer"));
  const simpleView = document.createElement("section");
  simpleView.className = "view simple-farmer-view";
  simpleView.id = "view-simple";
  simpleView.hidden = true;
  const simpleCropOptions = ['<option value="recommend">I don’t know — show crop profiles</option>']
    .concat(crops.filter(crop => crop.type !== 'cover').map(crop => '<option value="' + escapeHTML(crop.id) + '">' + escapeHTML(crop.name) + '</option>'))
    .concat(crops.some(crop => crop.id === 'alfalfa') ? [] : ['<option value="alfalfa">Alfalfa</option>']).join('');
  simpleView.innerHTML = `
    <header class="simple-reference-header"><a class="simple-brand" href="#/simple" aria-label="AgriPulse AI"><span class="simple-brand-mark"><img src="assets/logo-new.png" alt=""></span><span class="simple-brand-copy"><b>AgriPulse</b><small>Simple farmer</small></span></a><div class="simple-nav-progress"><small id="simple-step-label">Step 1 of 4</small><span><i id="simple-progress-bar"></i></span><em id="simple-save-status">Ready</em></div><div class="simple-reference-actions"><button class="simple-theme-cycle" type="button" data-action="simple-theme-cycle" aria-label="Change appearance"><span class="simple-theme-cycle-icon" aria-hidden="true">◐</span><span><b id="simple-theme-cycle-label">Automatic</b><small>Appearance</small></span></button><button class="simple-settings-button" type="button" data-action="simple-settings" aria-label="Open settings"><svg aria-hidden="true"><use href="#i-sliders"/></svg><b data-simple-copy="settings">Settings</b></button></div></header>
    <section class="simple-reference-copy"><p class="eyebrow">AGRIPULSE · GUIDED FIELD DECISIONS</p><h1 data-simple-copy="title">AgriPulse AI</h1><p class="simple-lede" data-simple-copy="subtitle">Smarter crop decisions powered by NASA Earth data.</p></section>
    <section class="simple-agri-backdrop" aria-label="Agricultural field"><div><span class="eyebrow">FROM EARTH DATA TO YOUR FIELD</span><h2>A clearer season starts with your land.</h2><p>Choose a location, add what you know, and turn weather, soil, water, crop, and market context into one practical report.</p></div><span class="simple-agri-badge">NASA EARTH OBSERVATIONS · FARMER KNOWLEDGE</span></section>
    <dialog class="simple-settings-dialog" id="simple-settings-dialog"><header><div><span class="eyebrow">AGRIPULSE AI</span><h2 data-simple-copy="settings">Settings</h2></div><button class="simple-tool-icon" type="button" data-action="close-simple-settings" aria-label="Close settings">×</button></header><p data-simple-copy="settingsHelp">Change language or theme without leaving the guided farmer flow.</p><div class="simple-settings-actions"><div class="simple-appearance-options" role="group" aria-label="Choose appearance"><button type="button" data-simple-theme-choice="auto"><span>◐</span><b>Automatic</b><small>Follows local time</small></button><button type="button" data-simple-theme-choice="light"><span>☀</span><b>Daylight</b><small>Bright and fresh</small></button><button type="button" data-simple-theme-choice="dark"><span>☾</span><b>Forest dark</b><small>Calm and focused</small></button></div><label>Appearance<select id="simple-appearance"><option value="auto">Automatic · follows local time</option><option value="dark">Forest dark</option><option value="light">Daylight</option></select></label><label>Weather units<select id="simple-weather-units"><option value="metric">Metric · °C, mm, km/h</option><option value="imperial">Imperial · °F, inches, mph</option></select></label><label>Language<select id="simple-settings-language"><option value="en">English</option><option value="ar">العربية</option><option value="fr">Français</option><option value="es">Español</option><option value="de">Deutsch</option><option value="pt">Português</option><option value="tr">Türkçe</option><option value="ur">اردو</option><option value="hi">हिन्दी</option><option value="zh">中文</option></select></label><label>Farmer workspace<select id="simple-farmer-mode"><option value="simple">Simple farmer · guided</option><option value="advanced">Complex farmer · full controls</option></select></label><button class="button danger" type="button" data-action="reset-workspace">Reset entire workspace</button></div></dialog>
    <nav class="simple-steps" aria-label="Farm analysis steps"><button type="button" data-simple-step="1"><i>1</i><span>Location</span></button><button type="button" data-simple-step="2"><i>2</i><span>Soil &amp; water</span></button><button type="button" data-simple-step="3"><i>3</i><span>Crops</span></button><button type="button" data-simple-step="4"><i>4</i><span>Report</span></button></nav>
    <section class="simple-stage" data-simple-stage="1"><article class="panel simple-card"><span class="eyebrow">STEP 1 / LOCATION</span><h2>Where is your farm?</h2><p>Start with a place. AgriPulse uses it to set your country, weather context, and local report currency.</p><div class="simple-location-readout" id="simple-location-readout">No farm selected yet.</div><div class="simple-location-context" id="simple-location-context"><span>◎ Country: waiting</span><span>¤ Currency: waiting</span><span>☁ Weather: waiting</span></div><div class="button-row"><button class="button" type="button" data-action="simple-geolocation">Use my location</button><button class="button secondary" type="button" data-action="simple-map-focus">Choose on map</button></div><div class="simple-or"><span>or search for a place</span></div><form id="simple-place-search" class="simple-place-search"><label class="sr-only" for="simple-place-query">Search for a place</label><input id="simple-place-query" name="query" minlength="2" required placeholder="Country, city, village, or farm area"><button class="button secondary" type="submit">Search</button></form><div id="simple-place-results" class="simple-place-results" aria-live="polite"></div><div class="simple-step-actions"><span></span><button class="button" type="button" data-action="simple-next" data-next-step="2">Next <span aria-hidden="true">→</span></button></div></article></section>
    <section class="simple-stage" data-simple-stage="2" hidden><article class="panel simple-card"><span class="eyebrow">STEP 2 / SOIL &amp; WATER</span><h2>Tell us only what you know.</h2><p>These quick choices help AgriPulse explain the crop and water signals. “I don’t know” is always okay.</p><form id="simple-farm-form" class="simple-farm-form"><label>Water source<select name="waterSource"><option value="unknown">I don’t know yet</option><option value="rainfed">Rain-fed only</option><option value="irrigated">Irrigation available</option></select></label><label>Your priority<select name="objective"><option value="water">Use water wisely</option><option value="soil">Protect soil health</option><option value="risk">Prepare for changing weather</option></select></label><label>Soil pH <small>Optional</small><input name="soilPH" inputmode="decimal" min="0" max="14" placeholder="I don’t know"></label><label>Soil texture<select name="soilTexture"><option value="unknown">I don’t know</option><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option><option value="organic">Organic</option></select></label><label class="span-two">Drainage<select name="drainage"><option value="unknown">I don’t know</option><option value="well">Well drained</option><option value="excessive">Very fast drainage</option></select></label><div class="simple-step-actions span-two"><button class="button secondary" type="button" data-action="simple-back" data-back-step="1"><span aria-hidden="true">←</span> Back</button><button class="button" type="submit">Save &amp; continue <span aria-hidden="true">→</span></button></div></form></article></section>
    <section class="simple-stage" data-simple-stage="3" hidden><article class="panel simple-card simple-crops-card"><span class="eyebrow">STEP 3 / CROPS</span><h2>Which crops are you considering?</h2><p>Choose one or more crops. AgriPulse will compare their available soil conditions and include your primary crop in the report.</p><div class="simple-crop-tools"><label><span>⌕</span><input id="simple-crop-search" type="search" placeholder="Search crops"></label><div role="group" aria-label="Crop category"><button class="active" type="button" data-crop-filter="all">All</button><button type="button" data-crop-filter="grain">Grains</button><button type="button" data-crop-filter="vegetable">Vegetables</button><button type="button" data-crop-filter="other">Other</button></div></div><form id="simple-crops-form" class="simple-crop-checklist">${Object.entries(simpleCropEvidence).map(([id, crop]) => { const sticker = simpleCropStickers[id]; return '<label data-crop-card data-crop-name="' + crop.name.toLowerCase() + '" data-crop-category="' + sticker.category + '"><input type="checkbox" name="crops" value="' + id + '"><span class="simple-crop-sticker" aria-hidden="true">' + sticker.icon + '</span><span class="simple-crop-copy"><b>' + crop.name + '</b><small>' + sticker.category + '</small></span><i aria-hidden="true">✓</i></label>'; }).join('')}<div class="simple-step-actions"><button class="button secondary" type="button" data-action="simple-back" data-back-step="2"><span aria-hidden="true">←</span> Back</button><button class="button" type="submit">Generate my report <span aria-hidden="true">→</span></button></div></form></article></section>
    <section class="simple-stage" data-simple-stage="4" hidden><header class="simple-results-heading"><div><span class="eyebrow">STEP 4 / YOUR REPORT</span><h2>Your farm, clearly explained.</h2><p id="simple-results-summary">Your location, crop choices, water context, and planning estimate appear here.</p></div><div class="button-row"><button class="button" type="button" data-action="simple-save">Export report</button><button class="button secondary" type="button" data-simple-step="1">Start again</button></div></header><div id="simple-report-hero"></div><div class="simple-results-grid" id="simple-results"></div><aside class="simple-results-note"><b>How to read your report</b><p>Weather and crop-condition signals are separated from planning estimates. Local currency follows the country you selected; confirm prices with your local buyer before acting.</p></aside></section>
    <dialog class="simple-export-dialog" id="simple-export-dialog"><header><div><span class="eyebrow">REPORT EXPORT</span><h2>Download your farm report</h2></div><button class="simple-tool-icon" type="button" data-action="close-simple-export" aria-label="Close">×</button></header><p>Choose the language and file type. Every format uses the same field data and planning assumptions.</p><form id="simple-export-form"><label>Report language<select name="language"><option value="en">English</option><option value="ar">العربية</option><option value="fr">Français</option><option value="es">Español</option><option value="de">Deutsch</option><option value="pt">Português</option><option value="tr">Türkçe</option><option value="ur">اردو</option><option value="hi">हिन्दी</option><option value="zh">中文</option></select></label><fieldset><legend>File type</legend><label class="simple-format-option"><input type="radio" name="format" value="html" checked><span><b>HTML</b><small>Designed report for browsers and printing</small></span></label><label class="simple-format-option"><input type="radio" name="format" value="jpg"><span><b>JPG image</b><small>Shareable report snapshot</small></span></label><label class="simple-format-option"><input type="radio" name="format" value="json"><span><b>JSON data</b><small>Structured field and evidence record</small></span></label><label class="simple-format-option"><input type="radio" name="format" value="csv"><span><b>CSV table</b><small>Forecast and planning data for spreadsheets</small></span></label></fieldset><div class="simple-export-preview"><span>Ready to export</span><b id="simple-export-filename">AgriPulse-report.html</b></div><button class="button full" type="submit">Generate and download</button></form></dialog>
    <aside class="simple-community"><div><span class="eyebrow">AGRIPULSE COMMUNITY</span><b>Help us build better field decisions.</b></div><div><button type="button" data-action="simple-feedback">Share feedback</button><button type="button" data-action="simple-about">Learn about us</button></div></aside>
    <dialog class="simple-info-dialog" id="simple-feedback-dialog"><header><div><span class="eyebrow">YOUR FEEDBACK</span><h2>Help AgriPulse grow</h2></div><button class="simple-tool-icon" type="button" data-action="close-simple-dialog" aria-label="Close">×</button></header><p>Tell us what would make the guided farmer experience clearer or more useful.</p><form id="simple-feedback-form"><label>Rating<select name="rating"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Okay</option><option value="2">2 · Needs work</option><option value="1">1 · Poor</option></select></label><label>Comment<textarea name="comment" minlength="5" maxlength="600" required placeholder="Write your feedback"></textarea></label><button class="button" type="submit">Save feedback</button></form></dialog>
    <dialog class="simple-info-dialog" id="simple-about-dialog"><header><div><span class="eyebrow">ABOUT AGRIPULSE</span><h2>Built by students. Grounded in purpose.</h2></div><button class="simple-tool-icon" type="button" data-action="close-simple-dialog" aria-label="Close">×</button></header><div class="simple-about-profile"><img src="assets/dunia-alajial-logo.jpg" alt="Dunia Alajial International School logo"><div><b>Dunia Alajial International School</b><p>AgriPulse connects NASA Earth observations with farmer knowledge to support clearer crop, water, soil, and planning decisions.</p></div></div><div class="button-row"><a class="button secondary" href="https://share.google/ZDHDGsGC8tVU8AKJr" target="_blank" rel="noopener">Learn more ↗</a><a class="button secondary" href="https://github.com/a7mdel5taeeb-eng" target="_blank" rel="noopener">Tech team ↗</a></div></dialog>
    <button class="simple-agri-guide-toggle" type="button" data-action="agri-guide" aria-expanded="false"><span>✦</span><b>Agri Toggle</b><small>Field tips</small></button><aside class="simple-agri-guide" id="simple-agri-guide" hidden><header><div><span class="eyebrow">AGRIPULSE FIELD GUIDE</span><h2>What would you like to understand?</h2></div><button type="button" data-action="agri-guide" aria-label="Close">×</button></header><p>No typing needed. Tap a topic or generate a land-aware tip using your selected field and current weather.</p><button class="simple-generate-tip" type="button" data-action="generate-land-tip"><span>✦</span><b>Generate a tip for this land</b><small>Weather · water · crops · next action</small></button><div class="simple-agri-tip-topics"><button type="button" data-agri-tip="weather"><span aria-hidden="true">☀</span> Weather</button><button type="button" data-agri-tip="soil"><span aria-hidden="true">◉</span> Soil</button><button type="button" data-agri-tip="water"><span aria-hidden="true">◒</span> Water</button><button type="button" data-agri-tip="crop"><span aria-hidden="true">❋</span> Crops</button><button type="button" data-agri-tip="profit"><span aria-hidden="true">↗</span> Profit</button></div><article id="simple-agri-tip"><span class="eyebrow">QUICK FIELD TIP</span><h3>Start with your land</h3><p>Choose a location and crop, then tap a topic to see a short, practical explanation.</p></article></aside>`;
  $("main").insertBefore(simpleView, $(".app-footer"));
  const simpleMapHost = document.createElement('div');
  simpleMapHost.id = 'simple-map-host';
  simpleMapHost.className = 'simple-map-host';
  simpleMapHost.innerHTML = '<div class="simple-map-heading"><div><span class="eyebrow">SELECT ON MAP</span><b>Tap the map to choose your field</b></div><span>Interactive map</span></div>';
  $('#simple-place-results')?.after(simpleMapHost);
  const simpleCurrencyField = document.createElement('label');
  simpleCurrencyField.className = 'simple-currency-choice';
  simpleCurrencyField.innerHTML = '<span>Report currency</span><select id="simple-currency"><option value="USD">USD · $</option><option value="SAR">SAR · ﷼</option><option value="AED">AED · د.إ</option><option value="QAR">QAR · ﷼</option><option value="KWD">KWD · د.ك</option><option value="BHD">BHD · د.ب</option><option value="OMR">OMR · ﷼</option><option value="JOD">JOD · د.ا</option><option value="EGP">EGP · E£</option><option value="EUR">EUR · €</option><option value="GBP">GBP · £</option><option value="INR">INR · ₹</option><option value="PKR">PKR · ₨</option><option value="BDT">BDT · ৳</option><option value="CNY">CNY · ¥</option><option value="JPY">JPY · ¥</option><option value="TRY">TRY · ₺</option><option value="CAD">CAD · C$</option><option value="AUD">AUD · A$</option><option value="BRL">BRL · R$</option><option value="MXN">MXN · $</option><option value="ARS">ARS · $</option><option value="CLP">CLP · $</option><option value="COP">COP · $</option><option value="KES">KES · KSh</option><option value="ZAR">ZAR · R</option><option value="NGN">NGN · ₦</option><option value="MAD">MAD · د.م.</option><option value="DZD">DZD · دج</option><option value="TND">TND · د.ت</option><option value="IDR">IDR · Rp</option><option value="MYR">MYR · RM</option><option value="THB">THB · ฿</option><option value="PHP">PHP · ₱</option><option value="RUB">RUB · ₽</option></select><small id="simple-currency-status">Automatically chosen from the selected country. You can change it.</small>';
  $('#simple-location-context')?.after(simpleCurrencyField);
  const simpleAutoNote = document.createElement('aside');
  simpleAutoNote.className = 'simple-auto-note';
  simpleAutoNote.id = 'simple-auto-note';
  $('.simple-crop-tools')?.before(simpleAutoNote);
  const simpleAbout = $('#simple-about-dialog');
  simpleAbout?.querySelector('.simple-about-profile')?.remove();
  if (simpleAbout) {
    simpleAbout.querySelector('h2').textContent = 'Meet the AgriPulse tech team.';
    const row = simpleAbout.querySelector('.button-row');
    if (row) row.innerHTML = '<a class="button secondary" href="https://github.com/ameer-marwan" target="_blank" rel="noopener">Ameer on GitHub ↗</a><a class="button secondary" href="https://github.com/a7mdel5taeeb-eng" target="_blank" rel="noopener">a7mdel5taeeb-eng ↗</a><a class="button secondary" href="https://github.com/mostafabass1" target="_blank" rel="noopener">Mostafa on GitHub ↗</a>';
  }
  const replayIntroButton = document.createElement('button');
  replayIntroButton.type = 'button';
  replayIntroButton.className = 'button secondary';
  replayIntroButton.dataset.action = 'restart-experience';
  replayIntroButton.textContent = 'Replay intro & choose farmer mode';
  $('#simple-settings-dialog .simple-settings-actions')?.insertBefore(replayIntroButton, $('[data-action="reset-workspace"]'));
  const feedbackView = document.createElement("section");
  feedbackView.className = "view";
  feedbackView.id = "view-feedback";
  feedbackView.hidden = true;
  feedbackView.innerHTML =
    '<div class="page-heading"><div><span class="eyebrow">COMMENTS & FEEDBACK</span><h1>Help AgriPulse grow<span>.</span></h1><p>Share an idea, report a problem, or tell us what works well.</p></div><span class="pill">PRIVATE NOTES</span></div><div class="feedback-layout"><form id="feedback-form" class="panel feedback-form"><div class="panel-heading"><div><span class="eyebrow">YOUR MESSAGE</span><h2>What would you like us to know?</h2></div></div><label>Name (optional)<input name="name" maxlength="60" placeholder="Your name"></label><div class="form-grid"><label>Feedback type<select name="category"><option value="Idea">Idea</option><option value="Problem">Problem</option><option value="Question">Question</option><option value="Compliment">Compliment</option></select></label><label>Overall rating<select name="rating"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Okay</option><option value="2">2 · Needs work</option><option value="1">1 · Poor</option></select></label></div><label>Comment<textarea name="comment" minlength="10" maxlength="1000" required placeholder="Write your feedback here…"></textarea></label><button class="button full" type="submit">Save feedback</button><p class="fine-print">Your note stays in your local workspace and is included in your downloaded backup.</p></form><article class="panel feedback-history feedback-why"><div class="panel-heading"><div><span class="eyebrow">WHY YOUR COMMENT MATTERS</span><h2>Your feedback shapes the next field decision.</h2></div><span class="pill">FARMER VOICE</span></div><p>Every comment helps us make AgriPulse clearer, more practical, and more trustworthy for farmers and students. Tell us where a chart is confusing, which crop or market is missing, or what would make a recommendation easier to act on.</p><div class="feedback-reasons"><span>Make tools easier to use</span><span>Improve local relevance</span><span>Strengthen NASA data explanations</span></div></article></div>';
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
  initAgriSystem();
  initSeasonSimulator();
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
  renderSimpleFlow();
  if (document.body.classList.contains('simple-farmer') && (!location.hash || location.hash === '#/overview')) location.hash = '/simple';
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
      renderSimpleFlow();
      if (!$('[data-simple-stage="4"]')?.hidden) renderSimpleResults();
      const activeTip = $('#simple-agri-tip')?.dataset.topic;
      if (activeTip) showSimpleAgriTip(activeTip);
    },
  });
  initSimpleToolbar();
  window.__fieldshiftIntro ||= initIntro({
    language: state.preferences.language,
  });
  if (hasLocation()) loadWeather();
  else {resetWeather("unselected");requestAutoLocation();}
  state.ready = true;
}

const agriSystemDetails = {
  climate: { stage: 'OBSERVE', icon: '☀', title: 'Climate pattern', copy: 'Recent weather and longer climate context help reveal heat, rainfall, and wind conditions around the selected land.', source: 'Source type: Earth and weather observations', link: 'Open weather intelligence →', href: '#/weather' },
  water: { stage: 'OBSERVE', icon: '≈', title: 'Water signal', copy: 'Forecast rain, reference evapotranspiration, and modeled surface moisture create a short-term picture of incoming water and atmospheric demand.', source: 'Source type: Forecast models and field records', link: 'Open water intelligence →', href: '#/water' },
  land: { stage: 'OBSERVE', icon: '◫', title: 'Land context', copy: 'The selected boundary, local soil samples, crop history, and farmer observations keep regional data connected to a real place.', source: 'Source type: Farmer inputs and mapped land', link: 'Open field explorer →', href: '#/map' },
  stress: { stage: 'INTERPRET', icon: '⌁', title: 'Stress screening', copy: 'AgriPulse checks weather and land signals for possible heat, water, and crop-suitability concerns. It flags evidence to review, not automatic instructions.', source: 'Method: Transparent threshold screening', link: 'Review field signals →', href: '#/weather' },
  rotation: { stage: 'INTERPRET', icon: '↻', title: 'Rotation comparison', copy: 'Alternative crop sequences are compared for water demand, crop-family diversity, soil-supporting traits, and resilience trade-offs.', source: 'Method: Explainable rotation scenarios', link: 'Compare crop paths →', href: '#/crops' },
  economics: { stage: 'INTERPRET', icon: '↗', title: 'Local economics', copy: 'Yield, selling price, field area, costs, and local currency are kept visible so every profit estimate can be checked and changed.', source: 'Method: Editable planning assumptions', link: 'Open profit scenarios →', href: '#/profit' },
  brief: { stage: 'DECIDE', icon: '✓', title: 'Decision brief', copy: 'The strongest signals are organized into practical next checks, with uncertainty and missing evidence shown beside the recommendation.', source: 'Output: Evidence-led next actions', link: 'Return to field briefing →', href: '#/overview' },
  report: { stage: 'DECIDE', icon: '▤', title: 'Field report', copy: 'Weather, soil, water, rotation, and economics are gathered into a record that can be saved, shared, and revisited as conditions change.', source: 'Output: Downloadable decision record', link: 'Open evidence report →', href: '#/reports' },
  all: { stage: 'THE FULL PATHWAY', icon: '✦', title: 'One connected field decision', copy: 'AgriPulse moves from Earth observations and farmer knowledge to transparent comparisons, then presents a decision brief that keeps sources, assumptions, and uncertainty visible.', source: 'Observe → interpret → decide → learn', link: 'Choose your field to begin →', href: '#/map' },
};
function renderAgriSystemDetail(key) {
  const detail = agriSystemDetails[key] || agriSystemDetails.climate;
  text('#agri-system-detail-stage', t(detail.stage));
  text('#agri-system-detail-icon', detail.icon);
  text('#agri-system-detail-title', t(detail.title));
  text('#agri-system-detail-copy', t(detail.copy));
  text('#agri-system-detail-source', t(detail.source));
  const link = $('#agri-system-detail-link');
  if (link) { link.textContent = t(detail.link); link.href = detail.href; }
}
function initAgriSystem() {
  const section = $('.agri-system');
  if (!section || section.dataset.ready) return;
  section.dataset.ready = 'true';
  const nodes = [...section.querySelectorAll('[data-system-node]')];
  const detailPanel = section.querySelector('.agri-system-detail');
  const progress = document.createElement('span');
  progress.className = 'agri-system-progress';
  progress.innerHTML = '<i></i>';
  section.append(progress);
  let tourTimer = null, tourIndex = 0;
  const selectNode = (button) => {
    section.classList.remove('show-all');
    nodes.forEach(node => node.classList.toggle('active', node === button));
    detailPanel?.classList.add('is-changing');
    setTimeout(() => { renderAgriSystemDetail(button.dataset.systemNode); detailPanel?.classList.remove('is-changing'); }, 130);
  };
  const stopTour = () => {
    clearInterval(tourTimer); tourTimer = null;
    section.classList.remove('touring');
    const control = section.querySelector('[data-system-tour]');
    control?.setAttribute('aria-pressed', 'false');
    if (control) control.innerHTML = '<span>▶</span> ' + t('Play guided tour');
  };
  const startTour = () => {
    stopTour(); section.classList.add('touring');
    const control = section.querySelector('[data-system-tour]');
    control?.setAttribute('aria-pressed', 'true');
    if (control) control.innerHTML = '<span>Ⅱ</span> ' + t('Pause guided tour');
    tourIndex = Math.max(0, nodes.findIndex(node => node.classList.contains('active')));
    tourTimer = setInterval(() => { tourIndex = (tourIndex + 1) % nodes.length; selectNode(nodes[tourIndex]); }, 3200);
  };
  nodes.forEach(button => button.addEventListener('click', () => { stopTour(); selectNode(button); }));
  section.querySelector('[data-system-tour]')?.addEventListener('click', () => tourTimer ? stopTour() : startTour());
  section.querySelector('[data-system-show-all]')?.addEventListener('click', () => {
    stopTour();
    section.classList.toggle('show-all');
    nodes.forEach(node => node.classList.toggle('active', section.classList.contains('show-all')));
    renderAgriSystemDetail(section.classList.contains('show-all') ? 'all' : 'climate');
  });
  const earth = section.querySelector('.agri-earth');
  let earthOffset = 50, dragging = false, startX = 0, startOffset = 50;
  const setEarthPosition = value => { earthOffset = ((value % 200) + 200) % 200; earth.style.backgroundPosition = earthOffset + '% 50%'; };
  earth?.addEventListener('pointerdown', event => { dragging = true; startX = event.clientX; startOffset = earthOffset; earth.setPointerCapture(event.pointerId); earth.classList.add('dragging'); });
  earth?.addEventListener('pointermove', event => { if (dragging) setEarthPosition(startOffset + (startX - event.clientX) * .42); });
  earth?.addEventListener('pointerup', event => { dragging = false; earth.releasePointerCapture(event.pointerId); earth.classList.remove('dragging'); });
  earth?.addEventListener('pointercancel', () => { dragging = false; earth.classList.remove('dragging'); });
  earth?.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); earth.classList.add('dragging'); setEarthPosition(earthOffset + (event.key === 'ArrowLeft' ? -8 : 8)); clearTimeout(earth._spinTimer); earth._spinTimer = setTimeout(() => earth.classList.remove('dragging'), 900); });
  window.addEventListener('fieldshift:language', () => {
    const selected = section.classList.contains('show-all') ? 'all' : section.querySelector('[data-system-node].active')?.dataset.systemNode || 'climate';
    renderAgriSystemDetail(selected);
    const control = section.querySelector('[data-system-tour]');
    if (control) control.innerHTML = '<span>' + (tourTimer ? 'Ⅱ' : '▶') + '</span> ' + t(tourTimer ? 'Pause guided tour' : 'Play guided tour');
    renderAgriSystemLiveSignals();
  });
  window.addEventListener('fieldshift:updated', renderAgriSystemLiveSignals);
  renderAgriSystemLiveSignals();
}

function renderAgriSystemLiveSignals() {
  const weather = state.weather, forecast = weather?.daily?.slice(0,7) || [];
  const rainTotal = forecast.reduce((sum,day) => sum + (number(day.rain) ? day.rain : 0),0);
  const etTotal = forecast.reduce((sum,day) => sum + (number(day.et0) ? day.et0 : 0),0);
  text('#system-live-weather', weather ? temp(weather.current?.temperature) + ' · ' + t(formatWeatherCode(weather.current?.weatherCode)) : t(hasLocation() ? 'Connecting…' : 'Choose a field'));
  text('#system-live-water', weather ? rain(rainTotal) + ' ' + t('rain') + ' · ET₀ ' + rain(etTotal) : t('Waiting for forecast'));
  const localSoil = state.samples.filter(sample => sample.field === fieldKey()).length;
  text('#system-live-soil', localSoil ? localSoil + ' ' + t('local record(s)') : hasLocation() ? t('Automatic land context') : t('No local details'));
  const connected = [hasLocation(),Boolean(weather),localSoil > 0,Boolean(state.economics)].filter(Boolean).length;
  text('#system-live-readiness', connected + ' / 4 ' + t('connected'));
  $$('.agri-live-signal-bar>span').forEach((item,index) => item.classList.toggle('connected',[hasLocation(),Boolean(weather),localSoil > 0,Boolean(state.economics)][index]));
  const nodeCopy = {
    climate: weather ? temp(weather.current?.temperature) + ' · ' + wind(weather.current?.wind) : t('Heat · rain · wind'),
    water: weather ? rain(rainTotal) + ' · ET₀ ' + rain(etTotal) : t('Rain · ET₀ · moisture'),
    land: hasLocation() ? state.location.name : t('Soil · boundary · history'),
    economics: state.economics ? money(state.economics.marginPerHa) + ' / ha' : t('Yield · costs · currency'),
  };
  Object.entries(nodeCopy).forEach(([key,value]) => { const small = $('[data-system-node="'+key+'"] small'); if (small) small.textContent = value; });
}

function initSeasonSimulator() {
  const temperature = $('#sim-temperature'), rainfall = $('#sim-rain'); if (!temperature || !rainfall) return;
  const render = () => {
    const tempShift = Number(temperature.value), rainShift = Number(rainfall.value);
    text('#sim-temperature-value',(tempShift >= 0 ? '+' : '') + tempShift + '°C');
    text('#sim-rain-value',(rainShift >= 0 ? '+' : '') + rainShift + '%');
    const baseTemp = number(state.weather?.current?.temperature) ? state.weather.current.temperature : 25;
    const projectedTemp = baseTemp + tempShift;
    let pressure = Math.max(0,tempShift) * 12 + Math.max(0,-rainShift) * .65 + (projectedTemp >= 35 ? 22 : projectedTemp >= 30 ? 10 : 0) + (rainShift >= 30 ? 13 : 0);
    pressure = Math.min(100,Math.round(pressure));
    const level = pressure >= 65 ? t('HIGH') : pressure >= 30 ? t('MODERATE') : t('LOW');
    const title = pressure >= 65 ? t('Resilience becomes the priority') : pressure >= 30 ? t('Review water and timing') : t('Current baseline');
    const copy = pressure >= 65 ? t('This scenario increases crop and water stress. Compare heat-tolerant rotations, irrigation limits, soil cover, and market risk before acting.') : rainShift >= 25 ? t('A wetter scenario raises drainage, disease, and field-access concerns even when water supply improves.') : t('The scenario remains close to baseline. Use local soil evidence and planting windows to refine the plan.');
    text('#sim-risk-score',level); text('#sim-result-title',title); text('#sim-result-copy',copy);
    const ring = $('#sim-risk-ring'); if (ring) { ring.style.setProperty('--sim-pressure',pressure); ring.dataset.level = pressure >= 65 ? 'high' : pressure >= 30 ? 'medium' : 'low'; }
    const priorities = pressure >= 65 ? [t('Heat tolerance'),t('Efficient irrigation'),t('Soil cover')] : rainShift >= 25 ? [t('Drainage'),t('Disease watch'),t('Field access')] : [t('Planting window'),t('Soil evidence'),t('Market check')];
    $('#sim-priorities').innerHTML = priorities.map(item => '<span>'+escapeHTML(item)+'</span>').join('');
  };
  temperature.addEventListener('input',render); rainfall.addEventListener('input',render);
  $$('[data-sim-preset]').forEach(button => button.addEventListener('click',() => { const preset=button.dataset.simPreset; temperature.value=preset==='hotdry'?4:preset==='wet'?1:0; rainfall.value=preset==='hotdry'?-40:preset==='wet'?40:0; render(); }));
  window.addEventListener('fieldshift:updated',render); window.addEventListener('fieldshift:language',render); render();
}

function navigate() {
  const candidate =
    location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
  state.route = [
    "overview",
    "simple",
    "map",
    "weather",
    "soil",
    "water",
    "crops",
    "profit",
    "reports",
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
      simple: "Guided analysis",
      map: "Field explorer",
      weather: "Weather",
      soil: "Soil intelligence",
      water: "Water",
      crops: "Crop planner",
      profit: "Profit & scenarios",
      reports: "Reports",
      explore: "Explore",
      feedback: "Comments & feedback",
      settings: "Settings",
      about: "About us",
    }[state.route],
  );
  const target = state.route === "map"
    ? $("#explorer-map-host")
    : state.route === "simple"
      ? $("#simple-map-host")
      : $("#home-map-host");
  target?.append($("#map-dock"));
  document.body.classList.remove("menu-open");
  requestAnimationFrame(() => state.map?.resize());
  if (state.ready) window.scrollTo({ top: 0, behavior: "instant" });
}

function setSimpleStep(step) {
  const safeStep = Math.max(1, Math.min(4, Number(step) || 1));
  $$('.simple-stage').forEach(stage => { stage.hidden = Number(stage.dataset.simpleStage) !== safeStep; });
  $$('[data-simple-step]').forEach(button => {
    const number = Number(button.dataset.simpleStep);
    button.classList.toggle('active', number === safeStep);
    button.classList.toggle('complete', number < safeStep);
    button.setAttribute('aria-current', number === safeStep ? 'step' : 'false');
  });
  text('#simple-step-label', t('Step') + ' ' + safeStep + ' ' + t('of') + ' 4');
  const progress = $('#simple-progress-bar');
  if (progress) progress.style.width = (safeStep * 25) + '%';
  text('#simple-save-status', t(safeStep === 4 ? 'Report ready' : 'Progress saved'));
}

function renderSimpleFlow() {
  const readout = $('#simple-location-readout');
  if (!readout) return;
  readout.innerHTML = hasLocation()
    ? '<b>' + escapeHTML(state.location.name) + '</b><span>' + state.location.lat.toFixed(4) + ', ' + state.location.lon.toFixed(4) + ' · ' + escapeHTML(t('selected location')) + '</span>'
    : '<b>' + escapeHTML(t('Choose your farm location')) + '</b><span>' + escapeHTML(t('GPS is optional. You can search or choose a point on the map.')) + '</span>';
  const context = $('#simple-location-context');
  if (context) context.innerHTML = hasLocation()
    ? '<span>◎ ' + escapeHTML(state.location.country || t('Selected region')) + '</span><span>¤ ' + escapeHTML(simpleCurrency()) + '</span><span>☁ ' + escapeHTML(t(state.weather ? 'Forecast connected' : 'Loads after selection')) + '</span>'
    : '<span>◎ ' + escapeHTML(t('Country')) + ': ' + escapeHTML(t('waiting')) + '</span><span>¤ ' + escapeHTML(t('Currency')) + ': ' + escapeHTML(t('waiting')) + '</span><span>☁ ' + escapeHTML(t('Weather')) + ': ' + escapeHTML(t('waiting')) + '</span>';
  const currencySelect = $('#simple-currency');
  if (currencySelect) currencySelect.value = simpleCurrency();
  renderSimpleCurrencyStatus();
  const form = $('#simple-farm-form');
  if (form) Object.entries(state.simpleFarm).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  $$('input[name="crops"]', $('#simple-crops-form')).forEach(input => { input.checked = (state.simpleFarm.crops || []).includes(input.value); });
  const autoNote = $('#simple-auto-note');
  if (autoNote && hasLocation()) {
    const profile = simpleLandProfile(), names = profile.recommendedCrops.map(id => simpleCropEvidence[id]?.name).filter(Boolean).map(t);
    autoNote.innerHTML = '<span>✦</span><div><b>' + escapeHTML(t('Automatic land-aware starting point')) + '</b><p>' + escapeHTML(t('Based on the selected location and available weather, AgriPulse preselected') + ' ' + names.join(', ') + '. ' + t('These are planning assumptions; change any choice if you know your field better.')) + '</p></div>';
  }
}

function simpleLandProfile() {
  const forecast = state.weather?.daily?.slice(0, 7) || [];
  const rainTotal = forecast.reduce((sum, day) => sum + (number(day.rain) ? day.rain : 0), 0);
  const currentTemp = state.weather?.current?.temperature;
  const aridCountries = ['Saudi Arabia','United Arab Emirates','Qatar','Kuwait','Bahrain','Oman','Egypt','Jordan','Morocco','Algeria','Tunisia'];
  const aridRegion = aridCountries.includes(state.location.country) || (Math.abs(state.location.lat) >= 18 && Math.abs(state.location.lat) <= 35 && rainTotal < 12);
  const hot = number(currentTemp) ? currentTemp >= 30 : aridRegion;
  const cold = number(currentTemp) ? currentTemp <= 17 : Math.abs(state.location.lat) > 45;
  const wet = forecast.length ? rainTotal >= 25 : false;
  const dry = forecast.length ? rainTotal < 8 : aridRegion;
  const texture = aridRegion ? 'light' : wet ? 'heavy' : 'medium';
  const pH = aridRegion ? '7.5' : wet ? '6.5' : '7.0';
  const waterSource = dry ? 'irrigated' : 'rainfed';
  const drainage = wet ? 'well' : aridRegion ? 'excessive' : 'well';
  const objective = dry || hot ? 'water' : wet ? 'soil' : 'risk';
  const scores = Object.keys(simpleCropEvidence).map(id => {
    const profile = simpleCropEvidence[id]; let score = 0;
    score += simpleFactorStatus(Number(pH), profile.ph) === 'SUITABLE' ? 3 : simpleFactorStatus(Number(pH), profile.ph) === 'MARGINAL' ? 1 : -3;
    score += simpleFactorStatus(texture, profile.texture, 'category') === 'SUITABLE' ? 2 : simpleFactorStatus(texture, profile.texture, 'category') === 'MARGINAL' ? 1 : -2;
    if (hot) score += ({ cotton:4,sunflower:3,chickpea:2,barley:1,alfalfa:1,potato:-3,rice:-1 }[id] || 0);
    if (cold) score += ({ wheat:3,barley:3,potato:2,cotton:-3,rice:-2 }[id] || 0);
    if (dry) score += ({ barley:3,chickpea:3,sunflower:2,cotton:1,rice:-5,tomato:-1 }[id] || 0);
    if (wet) score += ({ rice:5,maize:2,barley:-1,chickpea:-1 }[id] || 0);
    if (waterSource === 'irrigated') score += ({ tomato:2,alfalfa:2,maize:1 }[id] || 0);
    return [id, score];
  }).sort((a,b) => b[1] - a[1]);
  return { rainTotal, currentTemp, aridRegion, hot, cold, wet, dry, texture, pH, waterSource, drainage, objective, recommendedCrops: scores.slice(0,3).map(([id]) => id) };
}
function ensureSimpleAssumptions() {
  if (!hasLocation()) return;
  const profile = simpleLandProfile();
  const automatic = { ...(state.simpleFarm._autoAssumptions || {}) };
  for (const key of ['waterSource','soilTexture','drainage','soilPH','objective']) {
    const missing = state.simpleFarm[key] === '' || state.simpleFarm[key] === 'unknown' || state.simpleFarm[key] == null;
    if (missing || automatic[key]) { state.simpleFarm[key] = profile[key]; automatic[key] = true; }
  }
  if (!(state.simpleFarm.crops || []).length || state.simpleFarm._autoCrops) {
    state.simpleFarm.crops = profile.recommendedCrops;
    state.simpleFarm.crop = profile.recommendedCrops[0];
    state.simpleFarm._autoCrops = true;
  }
  state.simpleFarm._autoAssumptions = automatic;
  write('fieldshift.simpleFarm', state.simpleFarm);
}

const simpleToolbarCopy = {
  en: { settings: 'Settings', settingsHelp:'Change language or theme without leaving the guided farmer flow.', theme:'Switch light / dark theme', title: 'AgriPulse AI', subtitle: 'Smarter crop decisions powered by NASA Earth data.' },
  fr: { settings: 'Paramètres', settingsHelp:'Changez la langue ou le thème sans quitter le parcours guidé.', theme:'Changer le thème clair / sombre', title: 'AgriPulse AI', subtitle: 'Des décisions agricoles plus intelligentes, alimentées par les données d’observation de la Terre de la NASA.' },
  ar: { settings: 'الإعدادات', settingsHelp:'غيّر اللغة أو المظهر دون مغادرة المسار الزراعي المبسط.', theme:'تبديل المظهر الفاتح / الداكن', title: 'AgriPulse AI', subtitle: 'قرارات زراعية أذكى مدعومة ببيانات رصد الأرض من ناسا.' },
  es: { settings:'Configuración', settingsHelp:'Cambia el idioma o el tema sin salir del flujo guiado.', theme:'Cambiar tema claro / oscuro', title: 'AgriPulse AI', subtitle: 'Decisiones agrícolas más inteligentes impulsadas por datos de observación de la Tierra de la NASA.' },
  de: { settings:'Einstellungen', settingsHelp:'Sprache oder Design ändern, ohne den geführten Ablauf zu verlassen.', theme:'Helles / dunkles Design wechseln', title: 'AgriPulse AI', subtitle: 'Intelligentere Anbauentscheidungen mit NASA-Erdbeobachtungsdaten.' },
  pt: { settings:'Configurações', settingsHelp:'Mude o idioma ou o tema sem sair do fluxo guiado.', theme:'Alternar tema claro / escuro', title: 'AgriPulse AI', subtitle: 'Decisões agrícolas mais inteligentes com dados de observação da Terra da NASA.' },
  tr: { settings:'Ayarlar', settingsHelp:'Yönlendirmeli akıştan ayrılmadan dili veya temayı değiştirin.', theme:'Açık / koyu temayı değiştir', title: 'AgriPulse AI', subtitle: 'NASA Dünya gözlem verileriyle daha akıllı tarım kararları.' },
  ur: { settings:'ترتیبات', settingsHelp:'رہنمائی والے کسان کے عمل سے باہر نکلے بغیر زبان یا تھیم بدلیں۔', theme:'روشن / گہرا تھیم تبدیل کریں', title: 'AgriPulse AI', subtitle: 'ناسا کے زمینی مشاہداتی ڈیٹا سے بہتر زرعی فیصلے۔' },
  hi: { settings:'सेटिंग्स', settingsHelp:'गाइडेड किसान प्रवाह छोड़े बिना भाषा या थीम बदलें।', theme:'लाइट / डार्क थीम बदलें', title: 'AgriPulse AI', subtitle: 'नासा पृथ्वी अवलोकन डेटा से बेहतर कृषि निर्णय।' },
  zh: { settings:'设置', settingsHelp:'无需离开引导式农户流程即可更改语言或主题。', theme:'切换明亮 / 深色主题', title: 'AgriPulse AI', subtitle: '由 NASA 地球观测数据支持的更智能农业决策。' },
};
const simpleStepCounterCopy = {
  en: (step) => `Step ${step} of 4`, fr: (step) => `Étape ${step} sur 4`, ar: (step) => `الخطوة ${step} من 4`, es: (step) => `Paso ${step} de 4`, de: (step) => `Schritt ${step} von 4`, pt: (step) => `Etapa ${step} de 4`, tr: (step) => `Adım ${step} / 4`, ur: (step) => `مرحلہ ${step} از 4`, hi: (step) => `चरण ${step} / 4`, zh: (step) => `第 ${step} 步，共 4 步`,
};
function syncSimpleToolbar(language = state.preferences.language) {
  const words = simpleToolbarCopy[language] || simpleToolbarCopy.en;
  $('#simple-language') && ($('#simple-language').value = language);
  $('#simple-settings-language') && ($('#simple-settings-language').value = language);
  $('#simple-appearance') && ($('#simple-appearance').value = state.preferences.theme);
  $('#simple-weather-units') && ($('#simple-weather-units').value = state.preferences.units);
  $('#simple-farmer-mode') && ($('#simple-farmer-mode').value = document.body.classList.contains('simple-farmer') ? 'simple' : 'advanced');
  $$('[data-simple-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.simpleThemeChoice === state.preferences.theme)));
  $$('[data-simple-copy]').forEach(element => { element.textContent = words[element.dataset.simpleCopy] || element.textContent; });
  const title = $('[data-simple-copy="title"]');
  if (title) title.textContent = words.title;
  const activeStep = $('[data-simple-step].active');
  if (activeStep) {
    const step = Number(activeStep.dataset.simpleStep);
    setSimpleStep(step);
    text('#simple-step-label', (simpleStepCounterCopy[language] || simpleStepCounterCopy.en)(step));
  }
}
function initSimpleToolbar() {
  const picker = $('#simple-settings-language');
  if (!picker) return;
  syncSimpleToolbar();
  picker.addEventListener('change', () => {
    const settingsPicker = $('#language');
    if (!settingsPicker) return;
    settingsPicker.value = picker.value;
    settingsPicker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('#simple-appearance')?.addEventListener('change', event => { state.preferences.theme = event.currentTarget.value; applyPreferences(); syncSimpleToolbar(); });
  $('#simple-weather-units')?.addEventListener('change', event => { state.preferences.units = event.currentTarget.value; applyPreferences(); if (state.weather) renderWeather(); syncSimpleToolbar(); });
  $('#simple-farmer-mode')?.addEventListener('change', event => {
    const mode = event.currentTarget.value === 'simple' ? 'simple' : 'advanced';
    $('#simple-settings-dialog')?.close();
    switchFarmerMode(mode);
    toast(mode === 'simple' ? t('Guided workspace enabled.') : t('Full controls enabled.'));
  });
  $$('[data-simple-theme-choice]').forEach(button => button.addEventListener('click', () => { state.preferences.theme = button.dataset.simpleThemeChoice; applyPreferences(); syncSimpleToolbar(); }));
  window.addEventListener('fieldshift:language', event => syncSimpleToolbar(event.detail));
}

function simpleCard(title, type, body, detail, action = 'Learn more') {
  const id = 'report-more-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return '<article class="panel simple-result-card"><div class="simple-result-top"><span class="simple-result-type ' + type + '">' + escapeHTML(t(type.toUpperCase())) + '</span><span class="simple-result-icon">' + ({ forecast: '☁', calculated: '◒', unavailable: '○', screening: '✦' }[type] || '·') + '</span></div><h3>' + escapeHTML(t(title)) + '</h3><p>' + escapeHTML(t(body)) + '</p><div class="simple-result-more" id="' + id + '" hidden><b>' + escapeHTML(t('What this means')) + '</b><p>' + escapeHTML(t(detail)) + '</p><small>' + escapeHTML(t('Use this signal with local observations and professional agricultural advice.')) + '</small></div><button class="simple-learn-more" type="button" data-action="simple-report-more" aria-expanded="false" aria-controls="' + id + '">' + escapeHTML(t(action)) + ' <span>＋</span></button></article>';
}

const simplePlanningBenchmarks = {
  wheat: { yield: 3.2, priceUsd: 270, costUsd: 470 },
  barley: { yield: 2.8, priceUsd: 230, costUsd: 380 },
  chickpea: { yield: 1.6, priceUsd: 710, costUsd: 510 },
  alfalfa: { yield: 8.4, priceUsd: 155, costUsd: 720 },
  maize: { yield: 5.8, priceUsd: 210, costUsd: 690 },
  rice: { yield: 4.2, priceUsd: 340, costUsd: 820 },
  tomato: { yield: 45, priceUsd: 420, costUsd: 8900 },
  potato: { yield: 22, priceUsd: 250, costUsd: 3100 },
  cotton: { yield: 1.8, priceUsd: 1650, costUsd: 1250 },
  sunflower: { yield: 1.6, priceUsd: 480, costUsd: 540 },
};
const simpleFallbackRates = { USD:1,SAR:3.75,AED:3.6725,QAR:3.64,KWD:.307,BHD:.376,OMR:.385,JOD:.709,EGP:50,EUR:.92,GBP:.79,INR:84,PKR:279,BDT:120,CNY:7.25,JPY:153,TRY:34,CAD:1.39,AUD:1.53,BRL:5.45,MXN:20.3,ARS:1000,CLP:970,COP:4400,KES:129,ZAR:18.3,NGN:1550,MAD:10,DZD:134,TND:3.1,IDR:15800,MYR:4.4,THB:34.5,PHP:58,RUB:98 };
function simpleCurrency() { return state.simpleFarm.currency || countryCurrencies[state.location.country] || 'USD'; }
function simpleMoney(value, currency) {
  return new Intl.NumberFormat(localeForLanguage(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
function renderSimpleCurrencyStatus() {
  const status = $('#simple-currency-status');
  const fx = state.simpleFx;
  if (!status) return;
  if (!fx || fx.currency !== simpleCurrency()) {
    status.textContent = t('Automatically chosen from the selected country. You can change it.');
    return;
  }
  status.textContent = fx.live
    ? t('Live exchange rate connected') + ' · 1 USD = ' + new Intl.NumberFormat(localeForLanguage(), { maximumFractionDigits: 4 }).format(fx.rate) + ' ' + fx.currency
    : t('Live rate unavailable; clearly labeled reference rate is being used.');
}
async function updateSimpleCurrency() {
  const currency = simpleCurrency();
  state.economicsInputs.currency = currency;
  let rate = simpleFallbackRates[currency] || 1, source = currency === 'USD' ? 'USD base rate' : 'offline reference rate', live = currency === 'USD', retrievedAt = currency === 'USD' ? new Date().toISOString() : null;
  if (currency !== 'USD') try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (response.ok && data?.result === 'success' && Number(data?.rates?.[currency]) > 0) {
      rate = Number(data.rates[currency]); source = 'open.er-api.com · USD reference'; live = true;
      retrievedAt = data.time_last_update_utc || new Date().toISOString();
    }
  } catch { /* The transparent reference rate keeps the simple report usable offline. */ }
  state.simpleFx = { currency, rate, source, live, retrievedAt };
  renderSimpleCurrencyStatus();
  return state.simpleFx;
}

function simpleFactorStatus(value, requirement, kind = 'number') {
  if (value === '' || value === null || value === undefined || value === 'unknown') return 'UNKNOWN';
  if (kind === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'UNKNOWN';
    if (numeric >= requirement.optimum[0] && numeric <= requirement.optimum[1]) return 'SUITABLE';
    if (numeric >= requirement.absolute[0] && numeric <= requirement.absolute[1]) return 'MARGINAL';
    return 'LIMITING';
  }
  if (requirement.optimum.includes(value)) return 'SUITABLE';
  if (requirement.absolute.includes(value)) return 'MARGINAL';
  return 'LIMITING';
}

function assessSimpleCropEvidence(cropId) {
  const profile = simpleCropEvidence[cropId];
  if (!profile) return null;
  const pH = simpleFactorStatus(state.simpleFarm.soilPH, profile.ph);
  const texture = simpleFactorStatus(state.simpleFarm.soilTexture, profile.texture, 'category');
  const drainage = simpleFactorStatus(state.simpleFarm.drainage, profile.drainage, 'category');
  const factors = [['soil pH', pH], ['soil texture', texture], ['drainage', drainage]];
  const limiting = factors.filter(([, status]) => status === 'LIMITING').map(([name]) => name);
  const unknown = factors.filter(([, status]) => status === 'UNKNOWN').map(([name]) => name);
  const overall = limiting.length ? 'potentially limited' : unknown.length === factors.length ? 'unknown' : 'no documented limitation';
  return { profile, factors, limiting, unknown, overall };
}

function renderSimpleResults() {
  const host = $('#simple-results');
  const reportHero = $('#simple-report-hero');
  const summary = $('#simple-results-summary');
  if (!host || !summary || !reportHero) return;
  if (!hasLocation()) {
    summary.textContent = 'Choose your farm location first. No estimates have been generated.';
    reportHero.innerHTML = '';
    host.innerHTML = simpleCard('Start with your location', 'unavailable', 'AgriPulse needs a selected place before it can retrieve regional weather context.', 'Required: selected location', 'Choose location');
    return;
  }
  const weather = state.weather;
  const selectedCrops = (state.simpleFarm.crops || []).length ? state.simpleFarm.crops : [state.simpleFarm.crop].filter(id => id && id !== 'recommend');
  const selectedCrop = selectedCrops[0] || 'recommend';
  const priority = state.simpleFarm.objective || 'water';
  const irrigated = state.simpleFarm.waterSource === 'irrigated';
  const rotations = recommendRotations({ priority, currentCrop: selectedCrop === 'recommend' ? 'wheat' : selectedCrop, irrigated, weather });
  const ids = [...new Set(rotations.flatMap(plan => plan.sequence).filter(id => crops.find(crop => crop.id === id)?.type !== 'cover'))].slice(0, 3);
  const candidates = ids.map(id => crops.find(crop => crop.id === id)?.name).filter(Boolean);
  const assessments = selectedCrops.map(assessSimpleCropEvidence).filter(Boolean);
  const assessment = assessments[0];
  const cropBody = assessments.length
    ? assessments.map(item => t(item.profile.name) + ': ' + t(item.overall) + (item.limiting.length ? ' (' + t('watch') + ': ' + item.limiting.map(t).join(', ') + ')' : '')).join('. ') + '.'
    : candidates.length ? candidates.map(t).join(', ') + '. ' + t('These are crop profiles for comparison, not automatic recommendations.') : t('Choose a crop to evaluate the available profile factors.');
  const current = weather?.current;
  const firstDay = weather?.daily?.[0];
  const forecastBody = weather
    ? 'Current forecast: ' + temp(current?.temperature) + ', wind ' + wind(current?.wind) + '. Seven-day forecast data is available for this selected location.'
    : 'Forecast data could not be retrieved yet. You can retry after selecting your location.';
  const waterBody = number(firstDay?.et0)
    ? t('Reference ET₀') + ': ' + rain(firstDay.et0) + '. ' + t('Use it as weather context, not irrigation instruction.')
    : t('Add crop stage, irrigation method, and available water to estimate demand.');
  const hot = number(current?.temperature) && current.temperature >= 35;
  const windy = number(current?.wind) && current.wind >= 30;
  const riskBody = weather ? (hot || windy ? t('Short-term weather watch') + ': ' + [hot ? t('high temperature') : '', windy ? t('strong wind') : ''].filter(Boolean).join(' · ') + '. ' + t('Confirm crop thresholds locally.') : t('No short-term heat or wind alert is active. Keep checking local conditions.')) : t('Weather risks are unavailable until the forecast loads.');
  const benchmark = simplePlanningBenchmarks[selectedCrop];
  const fx = state.simpleFx || { currency: simpleCurrency(), rate: simpleFallbackRates[simpleCurrency()] || 1, source: 'planning reference conversion' };
  const sales = benchmark ? benchmark.yield * benchmark.priceUsd * fx.rate : null;
  const cost = benchmark ? benchmark.costUsd * fx.rate : null;
  const margin = benchmark ? sales - cost : null;
  const profitBody = benchmark ? t('Planning margin') + ': ' + simpleMoney(margin, fx.currency) + ' ' + t('per hectare') + '. ' + t('Estimated sales') + ': ' + simpleMoney(sales, fx.currency) + '. ' + t('Planning costs') + ': ' + simpleMoney(cost, fx.currency) + '.' : t('Choose at least one crop to create the planning estimate.');
  const cropNames = selectedCrops.map(id => simpleCropEvidence[id]?.name || crops.find(crop => crop.id === id)?.name || id).filter(Boolean);
  const weatherCode = Number(current?.weatherCode);
  const scene = weatherCode >= 51 ? 'storm' : weatherCode > 0 ? 'clouds' : 'clear';
  const weatherGlyph = weatherCode === 0 ? '☀' : weatherCode >= 51 ? '☂' : '☁';
  const forecastItems = weather?.daily?.slice(0, 4).map((day, index) => '<div><span>' + escapeHTML(index === 0 ? t('Today') : dateShort(day.date)) + '</span><b>' + escapeHTML(temp(day.high)) + '</b><small>' + escapeHTML(rain(day.rain)) + '</small></div>').join('') || '<p class="empty">' + escapeHTML(t('Forecast unavailable.')) + '</p>';
  const decisionTips = [
    state.simpleFarm._autoAssumptions?.soilPH ? t('Confirm the automatic soil estimate with a local soil test.') : t('Keep your soil sample date and method with this report.'),
    weather && number(firstDay?.rain) < 2 ? t('Review irrigation access because little rain appears in the short forecast.') : t('Check rainfall again before planting or irrigation.'),
    benchmark ? t('Confirm selling price and input costs with a local buyer before acting.') : t('Choose a crop to unlock a planning margin.'),
  ];
  const readinessSignals = [
    [t('Location'), true], [t('Live weather'), Boolean(weather)], [t('Crop choice'), cropNames.length > 0],
    [t('Local soil input'), Boolean(state.simpleFarm.soilPH || (state.simpleFarm.soilTexture && state.simpleFarm.soilTexture !== 'unknown'))],
    [t('Live currency'), Boolean(fx.live)],
  ];
  const readinessCount = readinessSignals.filter(([, connected]) => connected).length;
  const weekRain = weather?.daily?.slice(0, 7).reduce((sum, day) => sum + (number(day.rain) ? day.rain : 0), 0);
  const weekEt0 = weather?.daily?.slice(0, 7).reduce((sum, day) => sum + (number(day.et0) ? day.et0 : 0), 0);
  const waterGap = number(weekRain) && number(weekEt0) ? weekRain - weekEt0 : null;
  const soilKnown = [state.simpleFarm.soilPH, state.simpleFarm.soilTexture, state.simpleFarm.drainage].filter(value => value && value !== 'unknown').length;
  const automaticSoil = state.simpleFarm._autoAssumptions && ['soilPH','soilTexture','drainage'].some(key => state.simpleFarm._autoAssumptions[key]);
  const reportUpdated = weather?.retrievedAt ? new Date(weather.retrievedAt).toLocaleString(localeForLanguage()) : t('Not available');
  reportHero.innerHTML = '<article class="simple-weather-report simple-weather-' + scene + '"><div class="simple-weather-shade"></div><div class="simple-weather-main"><span class="eyebrow">' + escapeHTML(t('LIVE FIELD WEATHER')) + '</span><h2>' + escapeHTML(state.location.name) + '</h2><p>' + escapeHTML(cropNames.length ? t('Selected crops') + ': ' + cropNames.map(t).join(', ') : t('No crop selected')) + '</p><div class="simple-weather-current"><span aria-hidden="true">' + weatherGlyph + '</span><strong>' + escapeHTML(weather ? temp(current?.temperature) : '—') + '</strong><div><b>' + escapeHTML(weather ? t(formatWeatherCode(weatherCode)) : t('Forecast unavailable.')) + '</b><small>' + escapeHTML(weather ? t('Wind') + ' ' + wind(current?.wind) + ' · ' + t('Humidity') + ' ' + (current?.humidity ?? '—') + '%' : t('Select or refresh your location to retry the live forecast')) + '</small></div></div></div><div class="simple-weather-forecast"><span class="eyebrow">' + escapeHTML(t('FOUR DAY OUTLOOK')) + '</span>' + forecastItems + '</div></article>' +
    '<div class="simple-report-facts"><article><span>' + escapeHTML(t('Location')) + '</span><b>' + escapeHTML(state.location.name) + '</b><small>' + escapeHTML(state.location.country || t('Selected region')) + '</small></article><article><span>' + escapeHTML(t('Crops')) + '</span><b>' + escapeHTML(cropNames.map(t).join(', ') || t('Not selected')) + '</b><small>' + escapeHTML(state.simpleFarm._autoCrops ? t('Automatically selected starting profiles') : t('Primary crop and alternatives')) + '</small></article><article><span>' + escapeHTML(t('Field details')) + '</span><b>' + escapeHTML(t(state.simpleFarm.waterSource === 'irrigated' ? 'Irrigation available' : 'Rain-fed only')) + '</b><small>' + escapeHTML(t('Soil texture') + ': ' + t(state.simpleFarm.soilTexture) + (automaticSoil ? ' · ' + t('automatic estimate') : '')) + '</small></article><article><span>' + escapeHTML(t('Profit estimate')) + '</span><b>' + escapeHTML(benchmark ? simpleMoney(margin, fx.currency) : '—') + '</b><small>' + escapeHTML(t('Planning margin per hectare')) + '</small></article></div><section class="simple-report-readiness"><div><span class="eyebrow">' + escapeHTML(t('DECISION READINESS')) + '</span><b>' + readinessCount + ' / ' + readinessSignals.length + ' ' + escapeHTML(t('signals connected')) + '</b></div><div>' + readinessSignals.map(([label, connected]) => '<span class="' + (connected ? 'connected' : '') + '"><i></i>' + escapeHTML(label) + '</span>').join('') + '</div></section><section class="simple-report-depth"><article><span class="eyebrow">' + escapeHTML(t('WATER BALANCE')) + '</span><h3>' + escapeHTML(number(waterGap) ? (waterGap >= 0 ? t('Rain exceeds reference demand') : t('Reference demand exceeds rain')) : t('Water balance unavailable')) + '</h3><dl><div><dt>' + escapeHTML(t('7-day rain')) + '</dt><dd>' + escapeHTML(number(weekRain) ? rain(weekRain) : '—') + '</dd></div><div><dt>' + escapeHTML(t('7-day reference ET₀')) + '</dt><dd>' + escapeHTML(number(weekEt0) ? rain(weekEt0) : '—') + '</dd></div><div><dt>' + escapeHTML(t('Difference')) + '</dt><dd>' + escapeHTML(number(waterGap) ? rain(Math.abs(waterGap)) : '—') + '</dd></div></dl></article><article><span class="eyebrow">' + escapeHTML(t('SOIL CONTEXT')) + '</span><h3>' + escapeHTML(automaticSoil ? t('Automatic land-based planning estimate') : soilKnown + ' / 3 ' + t('details provided')) + '</h3><dl><div><dt>' + escapeHTML(t('Soil pH')) + '</dt><dd>' + escapeHTML(state.simpleFarm.soilPH) + '</dd></div><div><dt>' + escapeHTML(t('Texture')) + '</dt><dd>' + escapeHTML(t(state.simpleFarm.soilTexture)) + '</dd></div><div><dt>' + escapeHTML(t('Drainage')) + '</dt><dd>' + escapeHTML(t(state.simpleFarm.drainage)) + '</dd></div></dl></article><article><span class="eyebrow">' + escapeHTML(t('REPORT TRACE')) + '</span><h3>' + escapeHTML(readinessCount + ' / ' + readinessSignals.length + ' ' + t('signals connected')) + '</h3><dl><div><dt>' + escapeHTML(t('Weather updated')) + '</dt><dd>' + escapeHTML(reportUpdated) + '</dd></div><div><dt>' + escapeHTML(t('Exchange rate')) + '</dt><dd>' + escapeHTML(fx.live ? t('Live') : t('Reference')) + '</dd></div><div><dt>' + escapeHTML(t('Coordinates')) + '</dt><dd>' + escapeHTML(state.location.lat.toFixed(3) + ', ' + state.location.lon.toFixed(3)) + '</dd></div></dl></article></section><article class="simple-decision-brief"><div><span class="eyebrow">' + escapeHTML(t('NEXT BEST ACTIONS')) + '</span><h3>' + escapeHTML(t('Your decision brief')) + '</h3><p>' + escapeHTML(t('Use these as checks, not automatic instructions. Local knowledge remains essential.')) + '</p></div><ol>' + decisionTips.map(tip => '<li>' + escapeHTML(tip) + '</li>').join('') + '</ol></article>';
  summary.textContent = weather ? 'Your automatic report is ready for ' + state.location.name + '. Currency: ' + fx.currency + '.' : 'Your location is saved. Weather retrieval is unavailable right now, so missing information is shown clearly.';
  host.innerHTML = [
    simpleCard(assessments.length ? 'Crop conditions' : 'Crop profiles', 'screening', cropBody, assessments.length ? t('Profile screening only; confirm with local evidence.') : t('Choose a crop for factor-by-factor conditions.')),
    simpleCard('Water needs', number(firstDay?.et0) ? 'forecast' : 'unavailable', waterBody, number(firstDay?.et0) ? t('Open-Meteo reference evapotranspiration; not an irrigation instruction.') : t('Crop stage and water details are missing.')),
    simpleCard('Planting window', 'unavailable', t('A local planting window needs seasonal crop and climate evidence.'), t('Review historical climate in Complex farmer mode.')),
    simpleCard('Profit planning estimate', benchmark ? 'calculated' : 'unavailable', profitBody, benchmark ? t('Planning reference, not a local market quote.') : t('Choose a crop to create a planning estimate.')),
    simpleCard('Farm risks', weather ? 'forecast' : 'unavailable', riskBody, weather ? t('Open-Meteo weather model forecast.') : t('Data unavailable.'))
  ].join('');
}

function simpleReportData() {
  const cropIds = ((state.simpleFarm.crops || []).length ? state.simpleFarm.crops : [state.simpleFarm.crop]).filter(id => id && id !== 'recommend');
  const cropNames = cropIds.map(id => simpleCropEvidence[id]?.name || crops.find(crop => crop.id === id)?.name || id).filter(Boolean);
  const benchmark = simplePlanningBenchmarks[cropIds[0]];
  const fx = state.simpleFx || { currency: simpleCurrency(), rate: simpleFallbackRates[simpleCurrency()] || 1, source: 'planning reference conversion' };
  const margin = benchmark ? (benchmark.yield * benchmark.priceUsd - benchmark.costUsd) * fx.rate : null;
  return { cropNames, benchmark, fx, margin };
}

const reportLocales = { en:'en-US',fr:'fr-FR',ar:'ar-SA',es:'es-ES',de:'de-DE',pt:'pt-BR',tr:'tr-TR',ur:'ur-PK',hi:'hi-IN',zh:'zh-CN' };
function buildSimpleReportPayload(language = currentLanguage()) {
  const tr = value => tFor(language, value);
  const { cropNames, benchmark, fx, margin } = simpleReportData();
  const weather = state.weather, current = weather?.current, forecast = weather?.daily?.slice(0, 7) || [];
  const sales = benchmark ? benchmark.yield * benchmark.priceUsd * fx.rate : null;
  const costs = benchmark ? benchmark.costUsd * fx.rate : null;
  const weekRain = forecast.reduce((sum, day) => sum + (number(day.rain) ? day.rain : 0), 0);
  const weekEt0 = forecast.reduce((sum, day) => sum + (number(day.et0) ? day.et0 : 0), 0);
  const cropAssessments = ((state.simpleFarm.crops || []).length ? state.simpleFarm.crops : [state.simpleFarm.crop]).filter(id => id && id !== 'recommend').map(assessSimpleCropEvidence).filter(Boolean).map(item => ({ crop: tr(item.profile.name), overall: tr(item.overall), limiting: item.limiting.map(tr), unknown: item.unknown.map(tr), factors: item.factors.map(([name,status]) => ({ name: tr(name), status: tr(status) })) }));
  return {
    schemaVersion: 2, language, direction: ['ar','ur'].includes(language) ? 'rtl' : 'ltr', generatedAt: new Date().toISOString(),
    location: { name: state.location.name, country: state.location.country, region: state.location.region, latitude: state.location.lat, longitude: state.location.lon, method: state.location.method },
    farm: { crops: cropNames.map(tr), waterSource: tr(state.simpleFarm.waterSource === 'irrigated' ? 'Irrigation available' : state.simpleFarm.waterSource === 'rainfed' ? 'Rain-fed only' : 'Water source unknown'), priority: tr(state.simpleFarm.objective || 'water'), soilPH: state.simpleFarm.soilPH || null, soilTexture: tr(state.simpleFarm.soilTexture || 'unknown'), drainage: tr(state.simpleFarm.drainage || 'unknown') },
    weather: { available: Boolean(weather), source: weather?.source || 'Open-Meteo forecast API', retrievedAt: weather?.retrievedAt || null, current: current ? { temperatureC: current.temperature, condition: tr(formatWeatherCode(current.weatherCode)), humidityPercent: current.humidity, windKmh: current.wind, surfaceSoilMoisture: current.soilMoisture } : null, forecast: forecast.map(day => ({ date: day.date, highC: day.high, lowC: day.low, rainMm: day.rain, rainProbabilityPercent: day.rainProbability, referenceEt0Mm: day.et0, windMaxKmh: day.windMax })), sevenDay: { rainMm: weekRain, referenceEt0Mm: weekEt0, balanceMm: weekRain - weekEt0 } },
    cropAssessment: cropAssessments,
    economics: { available: Boolean(benchmark), currency: fx.currency, exchangeRatePerUsd: fx.rate, exchangeRateLive: Boolean(fx.live), exchangeRateSource: fx.source, benchmarkYieldTonnesPerHa: benchmark?.yield ?? null, estimatedSalesPerHa: sales, planningCostsPerHa: costs, planningMarginPerHa: margin },
    evidence: { connectedSignals: [Boolean(state.location), Boolean(weather), cropNames.length > 0, Boolean(state.simpleFarm.soilPH || state.simpleFarm.soilTexture !== 'unknown'), Boolean(fx.live)].filter(Boolean).length, totalSignals: 5, limitations: [tr('Weather is modeled for the selected point, not measured on the farm.'), tr('Crop suitability is a profile screening, not a planting prescription.'), tr('Profit values are planning references until local prices and costs are entered.')] },
    nextActions: [!state.simpleFarm.soilPH ? tr('Measure soil pH to strengthen the crop comparison.') : tr('Keep your soil sample date and method with this report.'), weather && forecast[0]?.rain < 2 ? tr('Review irrigation access because little rain appears in the short forecast.') : tr('Check rainfall again before planting or irrigation.'), benchmark ? tr('Confirm selling price and input costs with a local buyer before acting.') : tr('Choose a crop to unlock a planning margin.')]
  };
}
function reportMoney(value, currency, language) { return number(value) ? new Intl.NumberFormat(reportLocales[language] || 'en-US', { style:'currency', currency, maximumFractionDigits:0 }).format(value) : '—'; }
function buildSimpleReportHtml(payload) {
  const tr = value => tFor(payload.language, value), e = escapeHTML, locale = reportLocales[payload.language] || 'en-US';
  const rows = payload.weather.forecast.map((day, index) => '<tr><td>' + e(index ? new Date(day.date + 'T12:00:00').toLocaleDateString(locale,{weekday:'short',month:'short',day:'numeric'}) : tr('Today')) + '</td><td>' + e(number(day.highC) ? Math.round(day.highC) + '°C' : '—') + '</td><td>' + e(number(day.lowC) ? Math.round(day.lowC) + '°C' : '—') + '</td><td>' + e(number(day.rainMm) ? day.rainMm.toFixed(1) + ' mm' : '—') + '</td><td>' + e(number(day.referenceEt0Mm) ? day.referenceEt0Mm.toFixed(1) + ' mm' : '—') + '</td></tr>').join('');
  const assessment = payload.cropAssessment.map(item => '<article class="card"><span>' + e(item.crop) + '</span><b>' + e(item.overall) + '</b><p>' + e(item.factors.map(factor => factor.name + ': ' + factor.status).join(' · ')) + '</p></article>').join('') || '<article class="card"><b>' + e(tr('No crop selected')) + '</b></article>';
  return '<!doctype html><html lang="' + e(payload.language) + '" dir="' + payload.direction + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AgriPulse · ' + e(payload.location.name) + '</title><style>body{margin:0;background:#eef4eb;color:#173d34;font:15px Arial,sans-serif}.page{max-width:980px;margin:auto;padding:42px}.hero{padding:38px;border-radius:24px;color:white;background:linear-gradient(130deg,#092f25,#1d704d)}h1{font-size:44px;margin:8px 0}.eyebrow{font-size:10px;letter-spacing:2px;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}.card{padding:20px;border:1px solid #cadac8;border-radius:14px;background:white}.card span{color:#657a6d;font-size:10px;text-transform:uppercase}.card b{display:block;margin:8px 0;font-size:19px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.metric{padding:15px;border-radius:12px;background:#dcebd4}.metric small{display:block;color:#57705f}.metric strong{display:block;margin-top:7px;font-size:18px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:12px;border-bottom:1px solid #dce6d9;text-align:start}.note{padding:18px;border-inline-start:4px solid #83b64c;background:#e6f1d8}.actions li{margin:10px 0}.footer{margin-top:28px;color:#657a6d;font-size:11px}@media print{body{background:white}.page{padding:12px}}@media(max-width:650px){.page{padding:18px}.grid,.metrics{grid-template-columns:1fr 1fr}h1{font-size:30px}}</style></head><body><main class="page"><section class="hero"><span class="eyebrow">AGRIPULSE · ' + e(tr('FARM DECISION REPORT')) + '</span><h1>' + e(payload.location.name) + '</h1><p>' + e(payload.location.country || tr('Selected region')) + ' · ' + e(new Date(payload.generatedAt).toLocaleString(locale)) + '</p></section><section class="metrics"><div class="metric"><small>' + e(tr('Weather')) + '</small><strong>' + e(payload.weather.current ? Math.round(payload.weather.current.temperatureC) + '°C' : '—') + '</strong></div><div class="metric"><small>' + e(tr('7-day rain')) + '</small><strong>' + e(payload.weather.sevenDay.rainMm.toFixed(1) + ' mm') + '</strong></div><div class="metric"><small>' + e(tr('Crops')) + '</small><strong>' + e(payload.farm.crops.join(', ') || tr('Not selected')) + '</strong></div><div class="metric"><small>' + e(tr('Planning margin')) + '</small><strong>' + e(reportMoney(payload.economics.planningMarginPerHa,payload.economics.currency,payload.language)) + '</strong></div></section><section class="grid"><article class="card"><span>' + e(tr('Field details')) + '</span><b>' + e(payload.farm.waterSource) + '</b><p>' + e(tr('Soil pH') + ': ' + (payload.farm.soilPH ?? tr('Unknown')) + ' · ' + tr('Texture') + ': ' + payload.farm.soilTexture + ' · ' + tr('Drainage') + ': ' + payload.farm.drainage) + '</p></article><article class="card"><span>' + e(tr('Economics')) + '</span><b>' + e(reportMoney(payload.economics.planningMarginPerHa,payload.economics.currency,payload.language)) + ' / ha</b><p>' + e(tr('Estimated sales') + ': ' + reportMoney(payload.economics.estimatedSalesPerHa,payload.economics.currency,payload.language) + ' · ' + tr('Planning costs') + ': ' + reportMoney(payload.economics.planningCostsPerHa,payload.economics.currency,payload.language)) + '</p></article>' + assessment + '</section><section class="card"><h2>' + e(tr('SEVEN DAY OUTLOOK')) + '</h2><table><thead><tr><th>' + e(tr('Day')) + '</th><th>' + e(tr('High')) + '</th><th>' + e(tr('Low')) + '</th><th>' + e(tr('Rain')) + '</th><th>ET₀</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">' + e(tr('Forecast unavailable.')) + '</td></tr>') + '</tbody></table></section><section class="card actions"><h2>' + e(tr('NEXT BEST ACTIONS')) + '</h2><ol>' + payload.nextActions.map(action => '<li>' + e(action) + '</li>').join('') + '</ol></section><section class="note"><b>' + e(tr('Evidence and limitations')) + '</b><ul>' + payload.evidence.limitations.map(note => '<li>' + e(note) + '</li>').join('') + '</ul></section><footer class="footer">AgriPulse · ' + e(tr('Generated from your selected land and inputs.')) + ' · ' + e(payload.weather.source) + '</footer></main></body></html>';
}
function buildSimpleReportCsv(payload) {
  const tr = value => tFor(payload.language, value), rows = [[tr('AgriPulse farm decision report')],[tr('Location'),payload.location.name],[tr('Country'),payload.location.country],[tr('Crops'),payload.farm.crops.join(' | ')],[tr('Currency'),payload.economics.currency],[tr('Planning margin per hectare'),payload.economics.planningMarginPerHa],[tr('7-day rain'),payload.weather.sevenDay.rainMm],[tr('7-day reference ET₀'),payload.weather.sevenDay.referenceEt0Mm],[],[tr('Day'),tr('High') + ' °C',tr('Low') + ' °C',tr('Rain') + ' mm','ET₀ mm',tr('Wind') + ' km/h'],...payload.weather.forecast.map(day => [day.date,day.highC,day.lowC,day.rainMm,day.referenceEt0Mm,day.windMaxKmh])];
  return rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g,'""') + '"').join(',')).join('\n');
}
function downloadBlob(name, blob) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
async function downloadSimpleReportJpg(payload, name) {
  const tr = value => tFor(payload.language, value), rtl = payload.direction === 'rtl';
  const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 2100; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef4eb'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#0a3a2b'; ctx.fillRect(0,0,canvas.width,390); ctx.textAlign = rtl ? 'right' : 'left'; ctx.direction = rtl ? 'rtl' : 'ltr'; const x = rtl ? 1490 : 110;
  const line = (value,y,size=34,color='#173d34',weight='400') => { ctx.fillStyle=color; ctx.font=weight+' '+size+'px Arial'; ctx.fillText(String(value),x,y); };
  line('AGRIPULSE · '+tr('FARM DECISION REPORT'),105,24,'#bfe78b','600'); line(payload.location.name,205,72,'#ffffff','700'); line(payload.location.country+' · '+new Date(payload.generatedAt).toLocaleDateString(reportLocales[payload.language]||'en-US'),275,28,'#d7e9df');
  const cards=[[tr('Weather'),payload.weather.current?Math.round(payload.weather.current.temperatureC)+'°C':'—'],[tr('7-day rain'),payload.weather.sevenDay.rainMm.toFixed(1)+' mm'],[tr('Crops'),payload.farm.crops.join(', ')||tr('Not selected')],[tr('Planning margin'),reportMoney(payload.economics.planningMarginPerHa,payload.economics.currency,payload.language)]];
  cards.forEach(([label,value],i)=>{const cx=90+(i%2)*760,cy=450+Math.floor(i/2)*220;ctx.fillStyle='#ffffff';ctx.roundRect(cx,cy,700,170,22);ctx.fill();ctx.textAlign=rtl?'right':'left';const tx=rtl?cx+650:cx+50;ctx.fillStyle='#61786a';ctx.font='24px Arial';ctx.fillText(label,tx,cy+52);ctx.fillStyle='#173d34';ctx.font='700 38px Arial';ctx.fillText(String(value).slice(0,30),tx,cy+112)});
  ctx.textAlign=rtl?'right':'left'; line(tr('Field evidence'),965,34,'#173d34','700'); const evidence=[tr('Water source')+': '+payload.farm.waterSource,tr('Soil pH')+': '+(payload.farm.soilPH??tr('Unknown')),tr('Texture')+': '+payload.farm.soilTexture,tr('Drainage')+': '+payload.farm.drainage,tr('Signals connected')+': '+payload.evidence.connectedSignals+' / '+payload.evidence.totalSignals]; evidence.forEach((value,i)=>line('• '+value,1030+i*62,27,'#3e5c4d'));
  line(tr('Next best actions'),1400,34,'#173d34','700'); payload.nextActions.forEach((value,i)=>line((i+1)+'. '+String(value).slice(0,80),1470+i*72,25,'#3e5c4d'));
  ctx.fillStyle='#dcebd4';ctx.fillRect(80,1785,1440,190);line(tr('Planning support only. Confirm local weather, soil, crop requirements, prices, and costs before acting.'),1860,24,'#375342','600');line('AgriPulse · '+tr('Generated from your selected land and inputs.'),1930,20,'#607668');
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.92)); if (!blob) throw new Error('Image export could not be generated.'); downloadBlob(name,blob);
}
function simpleReportFilename(format) { const slug = state.location.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'field'; return 'AgriPulse-report-'+slug+'-'+new Date().toISOString().slice(0,10)+'.'+format; }
function updateSimpleExportFilename() { const form = $('#simple-export-form'); if (!form) return; text('#simple-export-filename', simpleReportFilename(form.elements.format.value)); }
function downloadSimpleReport() {
  if (!hasLocation()) return toast(t('Choose your farm location first.'));
  const dialog = $('#simple-export-dialog'), form = $('#simple-export-form'); if (!dialog || !form) return;
  form.elements.language.value = currentLanguage(); updateSimpleExportFilename(); dialog.showModal();
}
async function exportSimpleReport(event) {
  event.preventDefault(); const form = event.currentTarget, language = form.elements.language.value, format = form.elements.format.value, payload = buildSimpleReportPayload(language), name = simpleReportFilename(format), button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = t('Generating report…');
  try {
    if (format === 'html') download(name, buildSimpleReportHtml(payload), 'text/html;charset=utf-8');
    else if (format === 'json') download(name, JSON.stringify(payload,null,2), 'application/json;charset=utf-8');
    else if (format === 'csv') download(name, '\ufeff' + buildSimpleReportCsv(payload), 'text/csv;charset=utf-8');
    else await downloadSimpleReportJpg(payload,name);
    write('fieldshift.simpleReport', { savedAt: payload.generatedAt, language, format, location: state.location, farm: state.simpleFarm, currency: payload.economics.currency });
    $('#simple-export-dialog')?.close(); text('#simple-save-status', t('Report downloaded')); toast(t('Report downloaded as a file.'));
  } catch (error) { toast(error.message || t('Report export failed.')); }
  finally { button.disabled = false; button.textContent = t('Generate and download'); }
}

function generateLandTip(animate = false) {
  const host = $('#simple-agri-tip'); if (!host) return;
  if (!hasLocation()) {
    host.innerHTML = '<span class="eyebrow">' + escapeHTML(t('LAND-AWARE TIP')) + '</span><h3>' + escapeHTML(t('Choose your land first')) + '</h3><p>' + escapeHTML(t('Select a location so Agri Toggle can combine its weather, water, and crop context.')) + '</p>';
    return;
  }
  ensureSimpleAssumptions(); renderSimpleFlow();
  const profile = simpleLandProfile(), cropNames = profile.recommendedCrops.map(id => simpleCropEvidence[id]?.name).filter(Boolean).map(t);
  const temperature = number(profile.currentTemp) ? temp(profile.currentTemp) : t('not available');
  const climateSignal = profile.hot ? t('Hot conditions increase water demand and heat stress.') : profile.cold ? t('Cool conditions favor crops that tolerate a shorter, cooler season.') : profile.wet ? t('Wet conditions increase drainage and disease-management importance.') : t('Conditions are moderate, so soil evidence and crop timing become the main checks.');
  const waterSignal = profile.dry ? t('The short forecast is dry, so confirm irrigation capacity before selecting a water-demanding crop.') : profile.wet ? t('Rainfall is relatively high; protect drainage and avoid unnecessary irrigation.') : t('Keep watching forecast rain and reference ET₀ before irrigating.');
  const action = profile.hot && profile.dry ? t('Prioritize heat-tolerant crops, morning fieldwork, mulch, and efficient irrigation checks.') : profile.wet ? t('Check drainage, leaf disease risk, and field access before planting.') : profile.cold ? t('Confirm the local planting window and avoid crops that require sustained heat.') : t('Confirm soil pH and local planting dates before making the final crop choice.');
  if (animate) host.classList.add('is-generating');
  setTimeout(() => {
    host.dataset.topic = 'generated';
    host.innerHTML = '<span class="eyebrow">' + escapeHTML(t('GENERATED FOR YOUR LAND')) + '</span><h3>' + escapeHTML(state.location.name) + '</h3><div class="generated-tip-signal"><span>☀ <b>' + escapeHTML(temperature) + '</b></span><span>☂ <b>' + escapeHTML(profile.rainTotal.toFixed(1) + ' mm / 7d') + '</b></span><span>◉ <b>' + escapeHTML(t(profile.texture)) + '</b></span></div><p><b>' + escapeHTML(t('Climate signal')) + ':</b> ' + escapeHTML(climateSignal) + '</p><p><b>' + escapeHTML(t('Water signal')) + ':</b> ' + escapeHTML(waterSignal) + '</p><div class="generated-tip-crops"><small>' + escapeHTML(t('Best starting crop profiles')) + '</small><b>' + escapeHTML(cropNames.join(' · ')) + '</b></div><p><b>' + escapeHTML(t('Next check')) + ':</b> ' + escapeHTML(action) + '</p><small>' + escapeHTML(t('Planning guidance only. Confirm varieties, planting dates, soil tests, water, pests, and markets locally.')) + '</small>';
    host.classList.remove('is-generating');
    $$('[data-agri-tip]').forEach(button => button.classList.remove('active'));
  }, animate ? 420 : 0);
}

function showSimpleAgriTip(topic) {
  if (topic === 'generated') return generateLandTip();
  const host = $('#simple-agri-tip');
  if (!host) return;
  const weather = state.weather;
  const firstDay = weather?.daily?.[0];
  const { cropNames, benchmark, fx, margin } = simpleReportData();
  const tips = {
    weather: [t('Weather on your land'), weather ? t('Current conditions') + ': ' + temp(weather.current?.temperature) + ', ' + t(formatWeatherCode(weather.current?.weatherCode)) + '. ' + t('Wind') + ' ' + wind(weather.current?.wind) + '.' : t('Choose a location to load live weather context.')],
    soil: [t('What the soil details mean'), state.simpleFarm.soilPH ? t('Your entered soil pH is') + ' ' + state.simpleFarm.soilPH + '. ' + t('Compare it with the selected crop profile and keep the sample method.') : t('Soil pH is unknown. A local soil test would make the crop comparison stronger.')],
    water: [t('Your short water signal'), firstDay ? t('Forecast rain') + ': ' + rain(firstDay.rain) + '. ' + t('Reference ET₀') + ': ' + rain(firstDay.et0) + '. ' + t('These are model signals, not irrigation instructions.') : t('Choose a location to compare forecast rain and reference water demand.')],
    crop: [t('Your crop choices'), cropNames.length ? cropNames.map(t).join(', ') + '. ' + t('Check local planting dates, seed availability, pests, and buyer requirements before choosing.') : t('Choose at least one crop to see its field profile.')],
    profit: [t('Your planning margin'), benchmark ? simpleMoney(margin, fx.currency) + ' ' + t('per hectare') + '. ' + t('This uses planning benchmarks; replace them with local prices and costs.') : t('Choose a crop to create a planning estimate.')],
  };
  const [title, body] = tips[topic] || [t('Start with your land'), t('Choose a location and crop, then tap a topic to see a short, practical explanation.')];
  host.dataset.topic = topic;
  host.innerHTML = '<span class="eyebrow">' + escapeHTML(t('QUICK FIELD TIP')) + '</span><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(body) + '</p>';
  $$('[data-agri-tip]').forEach(button => button.classList.toggle('active', button.dataset.agriTip === topic));
}

async function runSimpleAnalysis() {
  if (!hasLocation()) { setSimpleStep(1); toast('Choose your farm location before analysis.'); return; }
  const button = $('[data-action="simple-analysis"]');
  const status = $('#simple-analysis-status');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Preparing your location, weather, crop and local-currency report…';
  try {
    await Promise.all([state.weather ? Promise.resolve() : loadWeather(true), updateSimpleCurrency()]);
    renderRotations();
    renderSimpleResults();
    setSimpleStep(4);
  } finally {
    if (button) button.disabled = false;
    if (status) status.textContent = '';
  }
}
async function resetEntireWorkspace() {
  if (!window.confirm('Reset the entire workspace? This removes saved fields, settings, reports, feedback, and guest data.')) return;
  const keys = [];
  for (let index = 0; index < workspaceStorage.length; index += 1) {
    const key = workspaceStorage.key(index);
    if (key) keys.push(key);
  }
  keys.forEach(key => workspaceStorage.removeItem(key));
  try {
    [...localStorage.keys()].filter(key => key.startsWith('agripulse.') || key.startsWith('fieldshift.')).forEach(key => localStorage.removeItem(key));
    sessionStorage.clear();
  } catch { /* The reload still resets the in-memory UI. */ }
  await new Promise(resolve => setTimeout(resolve, 1200));
  await workspaceStorage.retry?.();
  try {
    sessionStorage.removeItem('agripulse.intro.seen.growth.v1');
    sessionStorage.removeItem('fieldshift.intro.skip-auto');
    localStorage.removeItem('agripulse.farmer-mode');
  } catch { /* Reloading still restarts the experience. */ }
  window.location.replace(window.location.origin + window.location.pathname + '?reset=' + Date.now());
}
function restartExperience() {
  try {
    sessionStorage.removeItem('agripulse.intro.seen.growth.v1');
    sessionStorage.removeItem('fieldshift.intro.skip-auto');
    localStorage.removeItem('agripulse.farmer-mode');
  } catch { /* The intro can still replay when storage is restricted. */ }
  window.location.replace(window.location.origin + window.location.pathname + '?intro=' + Date.now());
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const actions = {
      "toggle-sidebar": () => {
        const collapsed = document.body.classList.toggle("sidebar-collapsed");
        localStorage.setItem("agripulse.sidebar-collapsed", collapsed ? "1" : "0");
        const button = document.querySelector("[data-action=toggle-sidebar]");
        button?.setAttribute("aria-expanded", String(!collapsed));
        button?.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
      },
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
      "simple-analysis": runSimpleAnalysis,
      "simple-settings": () => $('#simple-settings-dialog')?.showModal(),
      "simple-map-focus": () => {
        $('#simple-map-host')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        requestAnimationFrame(() => state.map?.resize());
      },
      "close-simple-settings": () => $('#simple-settings-dialog')?.close(),
      "simple-save": () => downloadSimpleReport(),
      "close-simple-export": () => $('#simple-export-dialog')?.close(),
      "simple-report-more": () => {
        const details = document.getElementById(action.getAttribute('aria-controls'));
        if (!details) return;
        details.hidden = !details.hidden;
        action.setAttribute('aria-expanded', String(!details.hidden));
        action.innerHTML = escapeHTML(t(details.hidden ? 'Learn more' : 'Show less')) + ' <span>' + (details.hidden ? '＋' : '−') + '</span>';
      },
      "agri-guide": () => {
        const guide = $('#simple-agri-guide');
        if (!guide) return;
        guide.hidden = !guide.hidden;
        $('.simple-agri-guide-toggle')?.setAttribute('aria-expanded', String(!guide.hidden));
        if (!guide.hidden && hasLocation()) generateLandTip();
      },
      "generate-land-tip": () => generateLandTip(true),
      "reset-workspace": () => resetEntireWorkspace(),
      "restart-experience": () => restartExperience(),
      "simple-feedback": () => $('#simple-feedback-dialog')?.showModal(),
      "simple-about": () => $('#simple-about-dialog')?.showModal(),
      "close-simple-dialog": () => action.closest('dialog')?.close(),
      "simple-next": () => {
        if (!hasLocation()) { toast('Choose a farm location first.'); return; }
        setSimpleStep(action.dataset.nextStep || 2);
      },
      "simple-back": () => setSimpleStep(action.dataset.backStep || 1),
      "simple-geolocation": () => useSimpleDeviceLocation(),
      "simple-theme-toggle": () => { state.preferences.theme = resolvedTheme() === 'light' ? 'dark' : 'light'; applyPreferences(); syncSimpleToolbar(); },
      "simple-theme-cycle": () => { const modes = ['auto','light','dark']; state.preferences.theme = modes[(modes.indexOf(state.preferences.theme) + 1) % modes.length]; applyPreferences(); syncSimpleToolbar(); },
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
      $('#thermal-legend').hidden = button.dataset.mapLayer !== 'thermal';
      $$("[data-map-layer]").forEach((b) =>
        b.classList.toggle("selected", b === button),
      );
    }),
  );
  $("#place-search-form").addEventListener("submit", searchLocation);
  $('#simple-place-search')?.addEventListener('submit', searchSimpleLocation);
  $$('[data-agri-tip]').forEach(button => button.addEventListener('click', () => showSimpleAgriTip(button.dataset.agriTip)));
  $('#simple-currency')?.addEventListener('change', async event => {
    state.simpleFarm.currency = event.currentTarget.value;
    state.economicsInputs.currency = event.currentTarget.value;
    state.simpleFx = null;
    write('fieldshift.simpleFarm', state.simpleFarm);
    renderSimpleFlow();
    text('#simple-save-status', t('Connecting live currency…'));
    await updateSimpleCurrency();
    if (!$('[data-simple-stage="4"]')?.hidden) renderSimpleResults();
    text('#simple-save-status', t('Currency saved'));
  });
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
  $('#simple-export-form')?.addEventListener('submit', exportSimpleReport);
  $('#simple-export-form')?.addEventListener('change', updateSimpleExportFilename);
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
  $('#simple-farm-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.simpleFarm = {
      objective: form.elements.objective.value,
      waterSource: form.elements.waterSource.value,
      crop: state.simpleFarm.crop || 'recommend',
      crops: state.simpleFarm.crops || [],
      soilPH: form.elements.soilPH.value.trim(),
      soilTexture: form.elements.soilTexture.value,
      drainage: form.elements.drainage.value,
      currency: state.simpleFarm.currency || simpleCurrency(),
    };
    write('fieldshift.simpleFarm', state.simpleFarm);
    text('#simple-save-status', 'Saved just now');
    $('#planning-priority').value = state.simpleFarm.objective === 'risk' ? 'resilience' : state.simpleFarm.objective;
    $('#irrigation').value = state.simpleFarm.waterSource === 'irrigated' ? 'irrigated' : 'rainfed';
    renderRotations();
    setSimpleStep(3);
  });
  $('#simple-crops-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const choices = $$('input[name="crops"]:checked', event.currentTarget).map(input => input.value);
    if (!choices.length) { toast('Choose at least one crop.'); return; }
    state.simpleFarm = { ...state.simpleFarm, crops: choices, crop: choices[0], _autoCrops: false };
    write('fieldshift.simpleFarm', state.simpleFarm);
    text('#simple-save-status', 'Saved just now');
    if ($('#current-crop option[value="' + choices[0] + '"]')) $('#current-crop').value = choices[0];
    renderRotations();
    runSimpleAnalysis();
  });
  $('#simple-feedback-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    state.feedback.unshift({ id: crypto.randomUUID(), name: 'Simple farmer', category: 'Idea', rating: Number(form.elements.rating.value), comment: form.elements.comment.value.trim(), createdAt: new Date().toISOString() });
    write('fieldshift.feedback', state.feedback);
    form.reset();
    form.closest('dialog')?.close();
    text('#simple-save-status', 'Feedback saved');
    toast('Feedback saved. Thank you.');
  });
  $$('[data-simple-step]').forEach(button => button.addEventListener('click', () => {
    const target = Number(button.dataset.simpleStep);
    if (target === 1 && button.closest('[data-simple-stage="4"]')) { restartExperience(); return; }
    if (target > 1 && !hasLocation()) { setSimpleStep(1); toast('Choose your farm location first.'); return; }
    if (target === 4) {
      if (!(state.simpleFarm.crops || []).length) { setSimpleStep(3); toast('Choose at least one crop before opening the report.'); return; }
      runSimpleAnalysis(); return;
    }
    setSimpleStep(target);
  }));
  const filterSimpleCrops = () => {
    const query = ($('#simple-crop-search')?.value || '').trim().toLowerCase();
    const active = $('[data-crop-filter].active')?.dataset.cropFilter || 'all';
    $$('[data-crop-card]').forEach(card => {
      const category = card.dataset.cropCategory;
      const categoryMatch = active === 'all' || (active === 'other' ? !['grain','vegetable'].includes(category) : category === active);
      card.hidden = !categoryMatch || !card.dataset.cropName.includes(query);
    });
  };
  $('#simple-crop-search')?.addEventListener('input', filterSimpleCrops);
  $$('[data-crop-filter]').forEach(button => button.addEventListener('click', () => { $$('[data-crop-filter]').forEach(item => item.classList.toggle('active', item === button)); filterSimpleCrops(); }));
  window.addEventListener('fieldshift:updated', renderSimpleFlow);
  $$('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    state.preferences.theme = button.dataset.themeChoice;
    applyPreferences();
  }));
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
  $$('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.preferences.theme)));
  const themeButton = $('.theme-button');
  if (themeButton) { themeButton.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to daylight theme'); themeButton.setAttribute('title', theme === 'light' ? 'Switch to dark theme' : 'Switch to daylight theme'); }
  const simpleThemeSwitch = $('.simple-theme-switch');
  if (simpleThemeSwitch) { simpleThemeSwitch.setAttribute('aria-pressed', String(theme === 'dark')); simpleThemeSwitch.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to daylight theme'); }
  const simpleThemeCycle = $('.simple-theme-cycle');
  if (simpleThemeCycle) {
    const mode = state.preferences.theme;
    const label = mode === 'auto' ? 'Automatic' : mode === 'light' ? 'Daylight' : 'Forest dark';
    text('#simple-theme-cycle-label', label);
    text('.simple-theme-cycle-icon', mode === 'auto' ? '◐' : mode === 'light' ? '☀' : '☾');
    simpleThemeCycle.dataset.mode = mode;
    simpleThemeCycle.setAttribute('aria-label', 'Appearance: ' + label + '. Activate to change.');
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f1f3ea' : '#101b16');
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
  if (point.country) {
    state.simpleFarm.currency = countryCurrencies[point.country] || 'USD';
    write('fieldshift.simpleFarm', state.simpleFarm);
  }
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
  ensureSimpleAssumptions();
  renderLocation();
  renderSimpleFlow();
  loadWeather();
  updateSimpleCurrency().then(() => { if (!$('[data-simple-stage="4"]')?.hidden) renderSimpleResults(); });
}
async function searchSimpleLocation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const host = $('#simple-place-results');
  const query = form.elements.query.value.trim();
  if (query.length < 2) return;
  state.searchController?.abort();
  state.searchController = new AbortController();
  host.innerHTML = '<p class="search-results-status">Searching for places…</p>';
  try {
    const places = await searchPlaces(query, { signal: state.searchController.signal });
    if (!places.length) { host.innerHTML = '<p class="search-results-status">No places found. Try a nearby town or village.</p>'; return; }
    host.replaceChildren(...places.map(place => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'simple-place-option';
      button.innerHTML = '<b>' + escapeHTML(place.name) + '</b><small>' + place.lat.toFixed(4) + ', ' + place.lon.toFixed(4) + '</small>';
      button.addEventListener('click', () => {
        selectLocation({ ...place, method: 'Place search' });
        host.replaceChildren();
        toast('Selected ' + place.name + '. Press Next when you are ready.');
      });
      return button;
    }));
  } catch (error) {
    if (error.name !== 'AbortError') host.innerHTML = '<p class="search-results-status">Place search is unavailable. You can use the map instead.</p>';
  }
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
function useSimpleDeviceLocation() {
  if (!navigator.geolocation) return toast('Location access is unavailable in this browser.');
  toast('Waiting for your location permission…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      selectLocation({ lat: position.coords.latitude, lon: position.coords.longitude, name: 'My current location', method: 'Device location' });
      toast('Location selected. Press Next when you are ready.');
    },
    (error) => toast(error.code === 1 ? 'Location permission was declined. Search for your farm instead.' : 'Could not retrieve location. Try search instead.'),
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
      signal: AbortSignal.any([state.weatherController.signal, AbortSignal.timeout(8000)]),
      force,
    });
    if (request !== state.requestId) return;
    state.weather = weather;
    ensureSimpleAssumptions();
    renderSimpleFlow();
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
  const stickers = {wheat:'🌾',maize:'🌽',sorghum:'🌾',barley:'🌾',soybean:'🫘',chickpea:'🫘',cowpea:'🫘',sunflower:'🌻',rye:'🌾',clover:'☘️'};
  $("#crop-library").innerHTML =
    crops
      .filter((c) =>
        (c.name + " " + c.family + " " + c.type)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
      .map(
        (c) =>
          '<article class="crop-library-card"><span class="crop-sticker" aria-hidden="true">' + (stickers[c.id] || '🌱') + '</span><span class="eyebrow">' +
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
  label.textContent = role === "user" ? "You" : "AgriPulse Assistant";
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
  if (/profit|price|money|cost|sell|revenue/.test(q)) return `Open Profit to enter your local selling price, yield, area, and costs. AgriPulse calculates revenue, costs, and margin from your numbers instead of assuming every market pays the same.`;
  if (/crop|rotation|plant|wheat|corn|rice/.test(q)) return `Open Crop planner to compare rotations. A strong plan balances expected margin with water demand, soil recovery, and the weather outlook for ${field}.`;
  if (/nasa|satellite|earth|space/.test(q)) return `AgriPulse combines NASA POWER climate history with live weather and your local field inputs. Open NASA data to inspect the source and time range behind each insight.`;
  return `I’m ready to help with ${field}. Try asking about weather, water, soil, crop rotation, profit, or NASA data. I’ll use the values in your workspace when they are available.`;
}
function initAssistant() {
  const host = $("#assistant-messages"),
    form = $("#assistant-form");
  if (!host || !form) return;
  addAssistantMessage(
    "assistant",
    "Welcome to AgriPulse AI.",
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
      const stream = await aiEngine.chat.completions.create({messages:[{role:"system",content:"You are AgriPulse AI, a helpful general assistant. Answer clearly and concisely. Never invent farm data. Field data: "+JSON.stringify(assistantFieldContext())},...assistantHistory.slice(-2).map(item=>({...item,content:item.content.slice(0,800)})),{role:"user",content:message}],temperature:0.7,max_tokens:256,stream:true});
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
    ["AgriPulse field intelligence report"],
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
function renderHistoricalLocalRecords() {
  const host = $('#history-local-records'); if (!host) return;
  if (!hasLocation()) { host.innerHTML = '<p class="empty">Choose a field to connect its local records.</p>'; return; }
  const samples = state.samples.filter(item => item.field === fieldKey());
  const notes = state.journal.filter(item => item.field === fieldKey()).slice(0, 3);
  const rows = [
    ...samples.slice(-2).reverse().map(item => ({ icon: '◉', title: item.name || 'Soil sample', meta: [item.date, number(item.ph) !== null ? 'pH ' + item.ph : 'Local record'].filter(Boolean).join(' · ') })),
    ...notes.map(item => ({ icon: '↻', title: item.title, meta: new Date(item.time).toLocaleDateString(localeForLanguage()) + ' · ' + item.detail })),
  ].slice(0,4);
  host.innerHTML = rows.length ? rows.map(item => '<div class="history-record"><i>' + item.icon + '</i><span><b>' + escapeHTML(item.title) + '</b><small>' + escapeHTML(item.meta) + '</small></span></div>').join('') : '<p class="empty">No local records yet. Add a soil sample or save a field decision to build its memory.</p>';
}
function historicalOutlook(start, latest, targetYear) {
  const years = Math.max(1, latest.year - start.year), forward = targetYear - latest.year;
  const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
  const months = latest.months.map((recent,index) => {
    const early = start.months[index] || {};
    const project = (key,annualLimit) => {
      if (!number(recent[key]) || !number(early[key])) return null;
      const rawTrend = (recent[key] - early[key]) / years;
      const limit = typeof annualLimit === 'function' ? annualLimit(recent[key]) : annualLimit;
      return Math.max(0,recent[key] + clamp(rawTrend,-limit,limit) * forward);
    };
    return { month: recent.month, temperature: project('temperature',.35), rain: project('rain',value => Math.max(5,value*.12)), solar: project('solar',value => Math.max(.15,value*.04)), availableDays: null, expectedDays: recent.expectedDays };
  });
  return { year: targetYear, months, location: latest.location, retrievedAt: new Date().toISOString(), source: 'NASA POWER trend-based planning outlook', sourceUrl: latest.sourceUrl, classification: 'Statistical planning outlook — not observed data or a weather forecast', projection: true, basisYears: [start.year,latest.year], units: latest.units, limitations: `Planning outlook for ${targetYear}, created by extending the bounded monthly direction between ${start.year} and ${latest.year} NASA POWER observations. It is not an observation, climate-model projection, seasonal forecast, or planting prescription. Confirm decisions with official local forecasts and agricultural advice.` };
}
function historicalVerdict(result) {
  const values = key => result.months.map(month => month[key]).filter(number);
  const mean = key => { const rows=values(key); return rows.length ? rows.reduce((sum,value)=>sum+value,0)/rows.length : null; };
  const temperatures=values('temperature'), rains=values('rain'), annualRain=rains.length===12?rains.reduce((sum,value)=>sum+value,0):null, avgTemp=mean('temperature');
  const hotMonths=temperatures.filter(value=>value>=30).length, veryWet=rains.filter(value=>value>=150).length, dry=number(annualRain)&&annualRain<250, wet=number(annualRain)&&annualRain>1200;
  let level='balanced', mark='MIXED', title='A mixed agricultural signal with manageable trade-offs.', copy='No single regional signal defines a good farming year. Match the monthly pattern with crop stage, soil, irrigation capacity, pests, and local observations.';
  if (hotMonths>=5 || dry) { level='pressure'; mark='PRESSURE'; title=result.projection?'Heat and water pressure may deserve early planning.':'Heat and water pressure made this a more demanding agricultural year.'; copy=`${hotMonths} month${hotMonths===1?'':'s'} crossed a 30°C monthly mean${number(annualRain)?` and the year recorded about ${annualRain.toFixed(0)} mm of complete monthly rainfall`:''}. Favor locally proven heat tolerance, protect soil cover, and verify irrigation capacity.`; }
  else if (wet || veryWet>=3) { level='watch'; mark='WET WATCH'; title=result.projection?'A wetter outlook could improve supply while raising field risks.':'Water supply was stronger, with added drainage and disease risks.'; copy='Higher rainfall can support water availability, but timing matters. Check drainage, field access, nutrient loss, and crop disease pressure month by month.'; }
  else if (number(annualRain) && annualRain>=250 && annualRain<=900 && number(avgTemp) && avgTemp<28) { level='supportive'; mark='SUPPORTIVE'; title=result.projection?'The trend outlook appears broadly supportive—with local checks.':'The regional pattern was broadly supportive—but not automatically a good farm year.'; copy='Temperature and rainfall stayed within broad planning ranges. Yield still depends on rainfall timing, crop choice, soil, pests, inputs, and market conditions.'; }
  const tags=[hotMonths?`${hotMonths} hot month${hotMonths===1?'':'s'}`:'No extreme monthly heat mean',number(annualRain)?`${annualRain.toFixed(0)} mm annual rain`:'Rainfall total incomplete',veryWet?`${veryWet} very wet month${veryWet===1?'':'s'}`:'Rain spread needs local review'];
  return {level,mark,title,copy,tags};
}
function renderHistoricalAnalytics(result) {
  const host = $('#analytics-result'); if (!host || !result) return;
  const months = result.months || [], valid = key => months.filter(month => number(month[key]) !== null);
  const average = key => { const rows = valid(key); return rows.length ? rows.reduce((sum,row) => sum + row[key],0) / rows.length : null; };
  const rainRows = valid('rain'), totalRain = rainRows.length ? rainRows.reduce((sum,row) => sum + row.rain,0) : null;
  const metric = state.historyMetric || 'rain', rows = valid(metric), values = rows.map(row => row[metric]);
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1, span = Math.max(1,max-min);
  const peak = rows.length ? rows.reduce((best,row) => row[metric] > best[metric] ? row : best,rows[0]) : null;
  const monthName = month => new Intl.DateTimeFormat(localeForLanguage(),{month:'short'}).format(new Date(Date.UTC(2024,month-1,1)));
  const unit = metric === 'temperature' ? '°C' : metric === 'rain' ? 'mm' : result.units?.solar || '';
  text('#history-location',state.location.name); text('#history-year',result.year);
  text('#history-summary',result.projection ? `A ${result.year} planning outlook derived from the direction between ${result.basisYears.join(' and ')} observations.` : `Observed regional context for ${result.year}. Select a signal to inspect each month.`);
  text('#history-classification',result.projection?'FUTURE PLANNING OUTLOOK':'NASA POWER OBSERVATIONS');
  text('#history-year-label',result.projection?'OUTLOOK YEAR':'OBSERVED YEAR');
  text('#history-source-chip',result.projection?`Trend basis: ${result.basisYears.join(' → ')} · not a forecast`:'Observed NASA POWER regional grid · not a field sensor');
  text('#history-temp',number(average('temperature')) !== null ? average('temperature').toFixed(1) + '°C' : '—');
  text('#history-rain',number(totalRain) !== null ? totalRain.toFixed(0) + ' mm' : '—');
  text('#history-solar',number(average('solar')) !== null ? average('solar').toFixed(1) : '—');
  text('#history-peak',peak ? monthName(peak.month) : '—');
  text('#history-peak-note',peak ? (metric === 'rain' ? 'Wettest available month' : metric === 'temperature' ? 'Warmest available month' : 'Brightest available month') : 'No complete values available');
  host.innerHTML = '<div class="history-chart-label"><span>' + escapeHTML(metric === 'rain' ? 'Monthly rainfall' : metric === 'temperature' ? 'Mean temperature' : 'Mean solar energy') + '</span><b>' + result.year + '</b></div><div class="history-bars">' + months.map(month => {
    const value = number(month[metric]); const available = value !== null;
    const height = available ? 12 + ((value-min)/span)*78 : 2;
    return '<button type="button" class="history-bar' + (peak?.month === month.month ? ' peak' : '') + '" aria-label="' + escapeHTML(monthName(month.month) + ': ' + (available ? value.toFixed(1) + ' ' + unit : 'Unavailable')) + '"><span><i style="height:' + height.toFixed(1) + '%"></i></span><b>' + escapeHTML(monthName(month.month)) + '</b><small>' + (available ? escapeHTML(value.toFixed(metric === 'rain' ? 0 : 1)) : '—') + '</small></button>';
  }).join('') + '</div><p class="fine-print">' + escapeHTML(result.limitations) + '</p>';
  const verdict=historicalVerdict(result), verdictHost=$('#history-verdict');
  if(verdictHost) verdictHost.dataset.level=verdict.level;
  text('#history-verdict .history-verdict-mark span',verdict.mark); text('#history-verdict-title',verdict.title); text('#history-verdict-copy',verdict.copy);
  $('#history-verdict-tags').innerHTML=verdict.tags.map(tag=>'<span>'+escapeHTML(tag)+'</span>').join('');
  const detail=$('#history-detail-table');
  if(detail) detail.innerHTML='<div class="history-detail-head"><span>Month</span><span>Mean temperature</span><span>Rainfall</span><span>Solar energy</span><span>Evidence</span></div>'+months.map(month=>'<div><b>'+escapeHTML(monthName(month.month))+'</b><span>'+escapeHTML(number(month.temperature)?month.temperature.toFixed(1)+'°C':'—')+'</span><span>'+escapeHTML(number(month.rain)?month.rain.toFixed(1)+' mm':'—')+'</span><span>'+escapeHTML(number(month.solar)?month.solar.toFixed(1):'—')+'</span><small>'+escapeHTML(result.projection?'Trend outlook':'Observed regional grid')+'</small></div>').join('');
  renderHistoricalLocalRecords();
}
async function loadNasa() {
  const container = $("#nasa-result");
  if (!hasLocation()) {
    container.innerHTML = '<p class="empty">Choose a field before requesting NASA climate context.</p>';
    return;
  }
  state.nasaController?.abort();
  state.nasaController = new AbortController();
  const key = fieldKey();
  container.innerHTML = '<p class="empty">Requesting historical NASA POWER data…</p>';
  try {
    const result = await fetchNasa(state.location, { signal: state.nasaController.signal });
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
      container.innerHTML = '<p class="empty">' + escapeHTML(error.message) + ' You can retry using the button.</p>';
  }
}
// Keep the orbit and plant animation smooth while the map engine is idle.
// Settings replays run after the workspace has already been initialized.
function initializeWorkspace() {
  if (document.body.classList.contains("intro-open")) {
    window.addEventListener("fieldshift:intro:closed", () => setTimeout(initializeWorkspace, 380), { once: true });
  } else {
    init();
  }
}
initializeWorkspace();

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
