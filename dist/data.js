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
  const key = `weather:${lat},${lon}`;
  const saved = cache.get(key);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (!force && saved && Date.now() - saved.at < 15 * 60 * 1000) return { ...saved.value, cached: true };
  const query = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    hourly: 'temperature_2m,precipitation,soil_moisture_0_to_1cm,wind_speed_10m,relative_humidity_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max',
    timezone: 'auto', forecast_days: '7', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm'
  });
  const data = await request(`https://api.open-meteo.com/v1/forecast?${query}`, { signal });
  if (!data || typeof data !== 'object' || data.error || !data.current ||
      !Array.isArray(data.daily?.time) || !Array.isArray(data.hourly?.time)) {
    throw new Error('The weather provider returned an incomplete response.');
  }
  const current = data.current;
  const times = data.hourly.time;
  const hour = typeof current.time === 'string' ? current.time.slice(0, 13) : '';
  const hourIndex = times.findIndex(time => typeof time === 'string' && time.slice(0, 13) === hour);
  const value = {
    location: { lat, lon }, gridLocation: { lat: number(data.latitude), lon: number(data.longitude) },
    current: {
      temperature: number(current.temperature_2m), feelsLike: number(current.apparent_temperature),
      humidity: number(current.relative_humidity_2m), wind: number(current.wind_speed_10m),
      weatherCode: number(current.weather_code),
      isDay: current.is_day === 1 ? true : current.is_day === 0 ? false : null,
      soilMoisture: hourIndex >= 0 ? arrayValue(data.hourly, 'soil_moisture_0_to_1cm', hourIndex) : null,
      time: typeof current.time === 'string' ? current.time : null
    },
    daily: data.daily.time.map((date, i) => ({
      date, high: arrayValue(data.daily, 'temperature_2m_max', i),
      low: arrayValue(data.daily, 'temperature_2m_min', i),
      rain: arrayValue(data.daily, 'precipitation_sum', i),
      rainProbability: arrayValue(data.daily, 'precipitation_probability_max', i),
      et0: arrayValue(data.daily, 'et0_fao_evapotranspiration', i),
      windMax: arrayValue(data.daily, 'wind_speed_10m_max', i)
    })).filter(day => typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date)),
    hourly: times.map((time, i) => ({
      time, temperature: arrayValue(data.hourly, 'temperature_2m', i),
      rain: arrayValue(data.hourly, 'precipitation', i),
      wind: arrayValue(data.hourly, 'wind_speed_10m', i),
      humidity: arrayValue(data.hourly, 'relative_humidity_2m', i),
      weatherCode: arrayValue(data.hourly, 'weather_code', i)
    })).filter(hour => typeof hour.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(hour.time)),
    timezone: typeof data.timezone === 'string' ? data.timezone : 'UTC',
    elevation: number(data.elevation), retrievedAt: new Date().toISOString(),
    source: 'Open-Meteo forecast API', sourceUrl: 'https://open-meteo.com/en/docs',
    classification: 'Weather model analysis and forecast', cached: false,
    units: { temperature: '°C', wind: 'km/h', rain: 'mm', humidity: '%', soilMoisture: 'm³/m³', et0: 'mm' },
    limitations: 'Reference-grid weather, not a field measurement. Soil moisture describes only the modeled 0–1 cm layer.'
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function searchPlaces(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (text.length < 2) return [];
  const data = await request(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: text, count: '7', language: 'en', format: 'json' })}`, { signal });
  if (data.error) throw new Error('Location search could not complete.');
  return (Array.isArray(data.results) ? data.results : []).filter(place => number(place.latitude) !== null && number(place.longitude) !== null).map(place => ({
    id: place.id, name: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    lat: place.latitude, lon: place.longitude, country: place.country || '', region: place.admin1 || '',
    timezone: place.timezone || null
  }));
}

export async function fetchNasa(point, { signal, year: requestedYear } = {}) {
  const { lat, lon } = coordinates(point);
  const latestCompletedYear = new Date().getUTCFullYear() - 1;
  const year = requestedYear == null ? latestCompletedYear : Number(requestedYear);
  if (!Number.isInteger(year) || year < 2020 || year > latestCompletedYear) throw new Error(`NASA observations are available here from 2020 through ${latestCompletedYear}.`);
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
    limitations: `${year} calendar-year observations; not a long-term climate normal. Coarse source grids describe regional context, not field measurements. Incomplete monthly rainfall totals remain unavailable.` };
  cache.set(key, { at: Date.now(), value });
  return value;
}

const fao = 'https://www.fao.org/land-water/databases-and-software/crop-information/en/';
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
  const limit = 'A scenario, not a planting prescription: local cultivar, planting window, market, pest history, soil profile and irrigation capacity need confirmation. A seven-day forecast cannot validate a multi-season rotation.';
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
