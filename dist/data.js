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

export async function searchPlaces(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) throw new Error('Enter coordinates as latitude, longitude, or choose a point on the map.');
  const lat = Number(match[1]), lon = Number(match[2]);
  coordinates({ lat, lon });
  return [{ id: `coordinates:${lat},${lon}`, name: `Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, country: '', region: '', timezone: 'UTC' }];
}

export async function fetchNasa(point, { signal } = {}) {
  const { lat, lon } = coordinates(point);
  const year = new Date().getUTCFullYear() - 1;
  const key = `nasa:${lat},${lon}:${year}`;
  const saved = cache.get(key);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (saved) return { ...saved.value, cached: true };
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
  { id: 'wheat', name: 'Wheat', family: 'Poaceae', type: 'grain', season: 'Cool season', waterDemand: 'Moderate', droughtTolerance: 'Moderate', phMin: 5.5, phMax: 7.5, notes: 'Winter and spring cultivars have different temperature and vernalization needs.' },
  { id: 'maize', name: 'Maize', family: 'Poaceae', type: 'grain', season: 'Warm season', waterDemand: 'High', droughtTolerance: 'Low', phMin: 5.5, phMax: 7.5, notes: 'Water stress around flowering is particularly important. Irrigation access alone does not establish suitability.' },
  { id: 'sorghum', name: 'Sorghum', family: 'Poaceae', type: 'grain', season: 'Warm season', waterDemand: 'Lower', droughtTolerance: 'Higher', phMin: 5.5, phMax: 8, notes: 'Often used under hot, dry conditions. Cultivar, establishment and local pests matter.' },
  { id: 'barley', name: 'Barley', family: 'Poaceae', type: 'grain', season: 'Cool season', waterDemand: 'Lower', droughtTolerance: 'Moderate', phMin: 6, phMax: 8, notes: 'Cool-season option; salinity tolerance is cultivar- and growth-stage-dependent.' },
  { id: 'soybean', name: 'Soybean', family: 'Fabaceae', type: 'legume', season: 'Warm season', waterDemand: 'Moderate', droughtTolerance: 'Moderate', phMin: 6, phMax: 7.5, notes: 'Biological nitrogen fixation depends on suitable rhizobia and management. Harvest removes substantial nutrients.' },
  { id: 'chickpea', name: 'Chickpea', family: 'Fabaceae', type: 'legume', season: 'Cool season', waterDemand: 'Lower', droughtTolerance: 'Higher', phMin: 6, phMax: 8, notes: 'Avoid waterlogged ground. Planting season and disease pressure depend strongly on region.' },
  { id: 'cowpea', name: 'Cowpea', family: 'Fabaceae', type: 'legume', season: 'Warm season', waterDemand: 'Lower', droughtTolerance: 'Higher', phMin: 5.5, phMax: 7.5, notes: 'Warm-season pulse or cover option. Verify local cultivar availability and market demand.' },
  { id: 'sunflower', name: 'Sunflower', family: 'Asteraceae', type: 'oilseed', season: 'Warm season', waterDemand: 'Moderate', droughtTolerance: 'Higher', phMin: 6, phMax: 8, notes: 'Broadleaf diversification option. Disease history, rooting conditions and harvest facilities matter.' },
  { id: 'rye', name: 'Cereal rye cover', family: 'Poaceae', type: 'cover', season: 'Cool season', waterDemand: 'Moderate', droughtTolerance: 'Moderate', phMin: 5, phMax: 7.5, notes: 'Can maintain cover between cash crops. Termination timing can affect water and nitrogen for the following crop.' },
  { id: 'clover', name: 'Clover cover', family: 'Fabaceae', type: 'cover', season: 'Cool season', waterDemand: 'Moderate', droughtTolerance: 'Low', phMin: 6, phMax: 7.5, notes: 'Species selection changes adaptation. Nitrogen benefit depends on biomass, fixation and termination.' }
].map(crop => ({ ...crop, reference: fao, evidence: 'General crop characteristics; local validation required' }));

export function recommendRotations({ priority = 'soil', currentCrop = 'wheat', irrigated = false, ph = null, waterBudget = null, weather = null } = {}) {
  const current = crops.find(crop => crop.id === currentCrop || crop.name.toLowerCase() === String(currentCrop).toLowerCase());
  const phValue = number(ph);
  const budget = number(waterBudget);
  const dry = !irrigated || (budget !== null && budget < 300);
  const concepts = [
    { id: 'soil', name: 'Soil protection', favored: ['soybean', 'cowpea', 'chickpea'], reason: 'Integrates a legume and an intervening cover crop to diversify rooting and maintain soil cover.' },
    { id: 'water', name: 'Water conservation', favored: ['sorghum', 'chickpea', 'cowpea', 'barley'], reason: 'Favors broadly drought-tolerant or lower-water-demand options, subject to planting season and local soil storage.' },
    { id: 'risk', name: 'Crop diversification', favored: ['sunflower', 'cowpea', 'soybean', 'barley'], reason: 'Changes crop family and seasonal management exposure rather than assuming all crops have the same risk.' }
  ];
  const limit = 'A scenario, not a planting prescription: local cultivar, planting window, market, pest history, soil profile and irrigation capacity need confirmation. Recent regional climate records cannot validate a multi-season rotation.';
  return concepts.sort((a, b) => (a.id === priority ? -1 : b.id === priority ? 1 : 0)).map(concept => {
    const eligible = crops.filter(crop => crop.type !== 'cover' && (!current || crop.family !== current.family) &&
      (phValue === null || (phValue >= crop.phMin && phValue <= crop.phMax)));
    const ordered = [...eligible].sort((a, b) => {
      const rank = crop => {
        let score = 20 - Math.max(0, concept.favored.indexOf(crop.id)) * 2;
        if (!concept.favored.includes(crop.id)) score -= 12;
        if (dry && crop.waterDemand === 'High') score -= 15;
        if (dry && crop.droughtTolerance === 'Higher') score += 5;
        return score;
      };
      return rank(b) - rank(a);
    });
    const first = ordered[0];
    const second = crops.find(crop => crop.type !== 'cover' && crop.family !== first?.family && crop.id !== current?.id &&
      (!dry || crop.waterDemand !== 'High') && (phValue === null || (phValue >= crop.phMin && phValue <= crop.phMax)));
    const cover = crops.find(crop => crop.type === 'cover' && crop.family !== second?.family &&
      (phValue === null || (phValue >= crop.phMin && phValue <= crop.phMax)));
    const reasons = [concept.reason];
    if (current) reasons.push(`The first suggested crop changes family after ${current.name}.`);
    if (phValue !== null) reasons.push(`General pH screening uses the entered pH of ${phValue}; it is not a laboratory verification.`);
    if (dry) reasons.push('Limited or unconfirmed irrigation reduces preference for high-demand crop options.');
    if (weather?.current?.temperature !== null && number(weather?.current?.temperature) !== null) reasons.push('Available short-term weather is relevant to near-term field work, not proof of next-season suitability.');
    if (!first || !second || !cover) reasons.push('Some sequence positions have no suitable option under the entered pH constraints. Collect local agronomic advice before planning.');
    return { id: concept.id, name: concept.name, sequence: [first?.id, second?.id, cover?.id].filter(Boolean), reasons,
      limitations: [limit, 'Cover-crop water use and termination can affect the following cash crop. No yield improvement is predicted.'],
      waterLabel: concept.id === 'water' ? 'Lower-demand options prioritized' : 'Crop and season dependent',
      sourceUrl: fao, evidence: 'Transparent trait screening, not a validated suitability model' };
  });
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
    96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail' })[code] || 'Conditions unavailable';
}
