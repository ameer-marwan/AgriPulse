/** FieldShift provider adapters and transparent scenario calculations.
 * All environmental values remain nullable. API records are model outputs,
 * not field measurements. No provider failure is replaced by sample data.
 */
const number = value => typeof value === 'number' && Number.isFinite(value) && value !== -999 ? value : null;
const cache = new Map();

function coordinates(point) {
  if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number' ||
      !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
      Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
    throw new Error('A valid latitude and longitude are required.');
  }
  return { lat: point.lat, lon: point.lon };
}

async function request(url, { signal, timeout = 20000 } = {}) {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 429
      ? 'The data provider is busy. Please try again later.'
      : `The data provider could not complete the request (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error('The data provider took too long to respond. Please retry.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function arrayValue(record, property, index) {
  return Array.isArray(record?.[property]) ? number(record[property][index]) : null;
}

export async function fetchWeather(point, { signal, force = false } = {}) {
  const { lat, lon } = coordinates(point);
  const key = `nasa-power-recent:${lat},${lon}`;
  const saved = cache.get(key);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (!force && saved && Date.now() - saved.at < 6 * 60 * 60 * 1000) return { ...saved.value, cached: true };
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 5);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  const compact = date => date.toISOString().slice(0,10).replaceAll('-','');
  const query = new URLSearchParams({ parameters: 'T2M,T2M_MAX,T2M_MIN,RH2M,WS10M,WS10M_MAX,PRECTOTCORR,ALLSKY_SFC_SW_DWN', community: 'AG',
    longitude: lon, latitude: lat, start: compact(start), end: compact(end), format: 'JSON' });
  const data = await request(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`, { signal, timeout: 30000 });
  const p = data?.properties?.parameter;
  if (!p || typeof p.T2M !== 'object') throw new Error('NASA POWER returned no usable recent daily data for this location.');
  const dates = Object.keys(p.T2M).filter(date => /^\d{8}$/.test(date) && number(p.T2M[date]) !== null).sort().slice(-7);
  if (!dates.length) throw new Error('NASA POWER has no recent complete daily records for this location yet.');
  const read = (name,date) => number(p[name]?.[date]);
  const daily = dates.map(date => ({ date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
    high: read('T2M_MAX',date), low: read('T2M_MIN',date), rain: read('PRECTOTCORR',date), rainProbability: null,
    et0: null, windMax: read('WS10M_MAX',date) === null ? null : read('WS10M_MAX',date) * 3.6, mean: read('T2M',date), humidity: read('RH2M',date), solar: read('ALLSKY_SFC_SW_DWN',date) }));
  const recent = daily.at(-1);
  const value = {
    location: { lat, lon }, gridLocation: { lat, lon },
    current: {
      temperature: recent.mean, feelsLike: null, humidity: recent.humidity, wind: read('WS10M',dates.at(-1)) === null ? null : read('WS10M',dates.at(-1)) * 3.6, weatherCode: null,
      isDay: null, soilMoisture: null, time: recent.date + 'T12:00'
    },
    daily, hourly: [], timezone: 'UTC', elevation: null, retrievedAt: new Date().toISOString(),
    source: 'NASA POWER Daily API', sourceUrl: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
    classification: 'Recent regional agroclimatology — historical, not a forecast', cached: false,
    units: { temperature: '°C', wind: 'km/h (converted from NASA POWER m/s)', rain: 'mm/day', humidity: '%', soilMoisture: null, et0: null },
    limitations: 'Recent NASA POWER regional-grid records, not a field measurement or future forecast. Soil moisture and reference ET₀ are not inferred when they are unavailable from this request.'
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Current forecast adapter used for the live weather scene. NASA POWER remains
// the historical regional context; this endpoint supplies current conditions
// and a real short-range forecast rather than presenting old records as live.
export async function fetchLiveWeather(point, { signal, force = false } = {}) {
  const { lat, lon } = coordinates(point);
  const key = `open-meteo-live:${lat},${lon}`;
  const saved = cache.get(key);
  if (!force && saved && Date.now() - saved.at < 15 * 60 * 1000) return { ...saved.value, cached: true };
  const query = new URLSearchParams({ latitude: lat, longitude: lon, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day', hourly: 'temperature_2m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration', forecast_days: '7', timezone: 'auto' });
  const data = await request(`https://api.open-meteo.com/v1/forecast?${query}`, { signal, timeout: 20000 });
  if (!data?.current || !Array.isArray(data?.daily?.time)) throw new Error('Live forecast returned no usable conditions for this location.');
  const daily = data.daily.time.map((date, i) => ({ date, high: arrayValue(data.daily, 'temperature_2m_max', i), low: arrayValue(data.daily, 'temperature_2m_min', i), rain: arrayValue(data.daily, 'precipitation_sum', i), rainProbability: arrayValue(data.daily, 'precipitation_probability_max', i), weatherCode: arrayValue(data.daily, 'weather_code', i), et0: arrayValue(data.daily, 'et0_fao_evapotranspiration', i), windMax: arrayValue(data.daily, 'wind_speed_10m_max', i), mean: null, humidity: null, solar: null }));
  const hourly = (data.hourly?.time || []).map((time, i) => ({ time, temperature: arrayValue(data.hourly, 'temperature_2m', i) }));
  const value = { location: { lat, lon }, gridLocation: { lat, lon }, current: { temperature: number(data.current.temperature_2m), feelsLike: number(data.current.apparent_temperature), humidity: number(data.current.relative_humidity_2m), wind: number(data.current.wind_speed_10m), weatherCode: number(data.current.weather_code), isDay: data.current.is_day === 1, time: data.current.time, soilMoisture: null }, daily, hourly, timezone: data.timezone || 'auto', elevation: number(data.elevation), retrievedAt: new Date().toISOString(), source: 'Open-Meteo live forecast', sourceUrl: 'https://open-meteo.com/en/docs', classification: 'Current modeled conditions and seven-day forecast — not a field measurement', cached: false, units: { temperature: '°C', wind: 'km/h', rain: 'mm/day', humidity: '%', soilMoisture: null, et0: 'mm/day (modeled FAO-56 reference)' }, limitations: 'Weather and reference evapotranspiration are model estimates for a grid point. Soil moisture needs a separate measurement and is not inferred from rain.' };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function searchPlaces(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (match) {
    const lat = Number(match[1]), lon = Number(match[2]);
    coordinates({ lat, lon });
    return [{ id: `coordinates:${lat},${lon}`, name: `Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, country: '', region: '', timezone: 'UTC' }];
  }
  throw new Error('Enter coordinates as latitude, longitude, or choose a point on the map.');
}

export async function searchNamedPlaces(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (text.length < 2) return [];
  const data = await request(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: text, count: '8', language: 'en', format: 'json' })}`, { signal, timeout: 12000 });
  return (Array.isArray(data?.results) ? data.results : []).map(place => ({
    id: `place:${place.latitude},${place.longitude}`,
    name: [place.name, place.admin1, place.country].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(', '),
    lat: Number(place.latitude), lon: Number(place.longitude), country: place.country || '', region: place.admin1 || '', timezone: place.timezone || 'UTC'
  })).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon));
}

/** Small offline place index for the guided flow; no third-party geocoder is used. */
export function findNamedPlaces(query) {
  const text = String(query || '').trim().toLowerCase();
  if (text.length < 2) return [];
  return [
    ['Riyadh, Saudi Arabia',24.7136,46.6753,'Saudi Arabia'],['Jeddah, Saudi Arabia',21.4858,39.1925,'Saudi Arabia'],['Cairo, Egypt',30.0444,31.2357,'Egypt'],['Amman, Jordan',31.9454,35.9284,'Jordan'],['Dubai, United Arab Emirates',25.2048,55.2708,'United Arab Emirates'],['Doha, Qatar',25.2854,51.5310,'Qatar'],['Muscat, Oman',23.5880,58.3829,'Oman'],['New Delhi, India',28.6139,77.2090,'India'],['Nairobi, Kenya',-1.2921,36.8219,'Kenya'],['São Paulo, Brazil',-23.5505,-46.6333,'Brazil'],['Amsterdam, Netherlands',52.3676,4.9041,'Netherlands']
  ].filter(([name]) => name.toLowerCase().includes(text)).slice(0,6).map(([name,lat,lon,country]) => ({ id:`place:${lat},${lon}`, name, lat, lon, country, region:'', timezone:'UTC' }));
}

export async function fetchNasa(point, { signal, force = false } = {}) {
  const { lat, lon } = coordinates(point);
  const year = new Date().getUTCFullYear() - 1;
  const key = `nasa:${lat},${lon}:${year}`;
  const saved = cache.get(key);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (!force && saved) return { ...saved.value, cached: true };
  const query = new URLSearchParams({ parameters: 'T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN', community: 'AG',
    longitude: lon, latitude: lat, start: `${year}0101`, end: `${year}1231`, format: 'JSON' });
  const data = await request(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`, { signal, timeout: 30000 });
  const p = data?.properties?.parameter;
  if (!p || typeof p.T2M !== 'object') throw new Error('NASA POWER returned no usable seasonal data.');
  const months = Array.from({ length: 12 }, (_, index) => {
    const prefix = `${year}${String(index + 1).padStart(2, '0')}`;
    const rows = Object.keys(p.T2M).filter(date => date.startsWith(prefix));
    const values = property => rows.map(date => number(p[property]?.[date])).filter(value => value !== null);
    const temperatures = values('T2M'), precipitation = values('PRECTOTCORR'), solar = values('ALLSKY_SFC_SW_DWN');
    const mean = arr => arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : null;
    const expectedDays = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    return { month: index + 1, temperature: mean(temperatures),
      rain: precipitation.length === expectedDays ? precipitation.reduce((sum, v) => sum + v, 0) : null,
      solar: mean(solar), availableDays: temperatures.length, expectedDays };
  });
  const value = { year, months, location: { lat, lon }, retrievedAt: new Date().toISOString(),
    source: 'NASA POWER', sourceUrl: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
    classification: 'Historical regional model and satellite-derived data', cached: false,
    units: { temperature: '°C', rain: 'mm/month', solar: typeof data.parameters?.ALLSKY_SFC_SW_DWN?.units === 'string' ? data.parameters.ALLSKY_SFC_SW_DWN.units : 'Provider unit unavailable' },
    limitations: 'Previous calendar year only; not a long-term climate normal. Coarse source grids describe regional context, not field measurements. Incomplete monthly rainfall totals remain unavailable.' };
  cache.set(key, { at: Date.now(), value });
  return value;
}

const fao = 'https://gaez.fao.org/';
export const crops = [
  ['wheat','Wheat','grain'], ['maize','Maize','grain'], ['sorghum','Sorghum','grain'],
  ['barley','Barley','grain'], ['soybean','Soybean','legume'], ['chickpea','Chickpea','legume'],
  ['cowpea','Cowpea','legume'], ['sunflower','Sunflower','oilseed'],
  ['rye','Cereal rye cover','cover'], ['clover','Clover cover','cover']
].map(([id,name,type]) => ({ id, name, type, family: 'Validate locally', season: 'Validate with FAO GAEZ',
  waterDemand: 'Not loaded', droughtTolerance: 'Not loaded', phMin: null, phMax: null,
  notes: 'AgriPulse does not assign crop suitability until an approved FAO GAEZ layer and local field evidence are available.',
  reference: fao, evidence: 'FAO GAEZ validation resource; no suitability value has been inferred' }));

export function recommendRotations({ priority = 'soil', currentCrop = 'wheat', irrigated = false, ph = null, waterBudget = null, weather = null } = {}) {
  const concepts = [
    { id: 'soil', name: 'Soil protection' }, { id: 'water', name: 'Water conservation' }, { id: 'risk', name: 'Crop diversification' }
  ];
  return concepts.sort((a, b) => (a.id === priority ? -1 : b.id === priority ? 1 : 0)).map(concept => ({
    id: concept.id, name: concept.name, sequence: [],
    reasons: ['No crop sequence is generated without approved FAO GAEZ suitability evidence and farmer-entered local soil, water, and crop-history records.'],
    limitations: ['Open FAO GAEZ and validate the selected crops with local agricultural expertise before creating a rotation.'],
    waterLabel: 'Evidence required', sourceUrl: fao, evidence: 'No inferred suitability values'
  }));
}

export function calculateEconomics(input = {}) {
  const fields = ['areaHa', 'yieldTonnesHa', 'pricePerTonne', 'seedCostHa', 'fertilizerCostHa', 'waterCostHa', 'operationsCostHa'];
  const values = {};
  for (const field of fields) {
    const value = input[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (field === 'areaHa' && value === 0)) {
      throw new Error(`Enter a valid ${field === 'areaHa' ? 'positive' : 'non-negative'} value for ${field}.`);
    }
    values[field] = value;
  }
  for (const [field, fallback, maximum] of [['sellingLossPercent',0,100],['transportCostPerTonne',0,Infinity],['marketFeePercent',0,100]]) {
    const value = input[field] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Enter a valid value for ${field}.`);
    values[field] = value;
  }
  const { areaHa, yieldTonnesHa, pricePerTonne, sellingLossPercent, transportCostPerTonne, marketFeePercent, seedCostHa, fertilizerCostHa, waterCostHa, operationsCostHa } = values;
  const productionCostsHa = seedCostHa + fertilizerCostHa + waterCostHa + operationsCostHa;
  const saleableFactor = 1 - sellingLossPercent / 100;
  const feeFactor = marketFeePercent / 100;
  const saleableYieldHa = yieldTonnesHa * saleableFactor;
  const grossRevenueHa = saleableYieldHa * pricePerTonne;
  const transportHa = saleableYieldHa * transportCostPerTonne;
  const marketFeeHa = grossRevenueHa * feeFactor;
  const sellingCostsHa = transportHa + marketFeeHa;
  const costsHa = productionCostsHa + sellingCostsHa;
  const scenarios = [
    { id: 'conservative', name: 'Conservative', factor: 0.9 },
    { id: 'expected', name: 'Entered assumptions', factor: 1 },
    { id: 'optimistic', name: 'Optimistic', factor: 1.1 }
  ].map(scenario => {
    const harvestYield=yieldTonnesHa*scenario.factor,saleableYield=harvestYield*saleableFactor,price=pricePerTonne*scenario.factor;
    const revenue=saleableYield*price,transport=saleableYield*transportCostPerTonne,fee=revenue*feeFactor,cost=productionCostsHa+transport+fee;
    return { id:scenario.id,name:scenario.name,yieldTonnesHa:harvestYield,pricePerTonne:price,revenue:revenue*areaHa,cost:cost*areaHa,margin:(revenue-cost)*areaHa,marginHa:revenue-cost };
  });
  const priceContributionFactor=saleableYieldHa*(1-feeFactor);
  const yieldContributionPerHarvestTonne=saleableFactor*(pricePerTonne*(1-feeFactor)-transportCostPerTonne);
  return { revenue: grossRevenueHa * areaHa, cost: costsHa * areaHa, sellingCosts: sellingCostsHa * areaHa, margin: (grossRevenueHa - costsHa) * areaHa,
    perHa: { revenue: grossRevenueHa, cost: costsHa, sellingCosts: sellingCostsHa, margin: grossRevenueHa - costsHa },
    saleableYieldTonnesHa:saleableYieldHa,
    breakEvenPrice: priceContributionFactor > 0 ? (productionCostsHa + transportHa) / priceContributionFactor : null,
    breakEvenYield: yieldContributionPerHarvestTonne > 0 ? productionCostsHa / yieldContributionPerHarvestTonne : null,
    currency: typeof input.currency === 'string' ? input.currency : 'USD', areaHa, scenarios,
    assumptions: values,
    limitations: 'Local gross margin from entered values only. Unentered land, finance, tax, storage and overhead costs are excluded. Selling loss, transport and market fees use the explicit local assumptions. Sensitivity scenarios change both harvested yield and local sale price by ±10%; they are not forecasts.' };
}

export function formatWeatherCode(code) {
  return ({ 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
    96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail' })[code] || 'Recent NASA regional record';
}
