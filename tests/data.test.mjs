import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The production file is a native browser module; load it without imposing a
// Node package type on the rest of the retained static project.
const code = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const { fetchWeather, fetchNasa, searchPlaces, calculateEconomics, recommendRotations, crops } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const basic = { areaHa: 2, yieldTonnesHa: 4, pricePerTonne: 250, seedCostHa: 100, fertilizerCostHa: 150, waterCostHa: 50, operationsCostHa: 200, currency: 'USD' };

test('economics uses consistent tonnes, hectares, and area totals', () => {
  const value = calculateEconomics(basic);
  assert.equal(value.revenue, 2000);
  assert.equal(value.cost, 1000);
  assert.equal(value.margin, 1000);
  assert.equal(value.perHa.margin, 500);
  assert.equal(value.breakEvenPrice, 125);
  assert.equal(value.breakEvenYield, 2);
  assert.ok(Math.abs(value.scenarios[0].margin - 620) < 1e-8);
});

test('economics preserves losses and handles zero yield/price without infinity', () => {
  const value = calculateEconomics({ ...basic, yieldTonnesHa: 0, pricePerTonne: 0 });
  assert.equal(value.margin, -1000);
  assert.equal(value.breakEvenPrice, null);
  assert.equal(value.breakEvenYield, null);
  assert.throws(() => calculateEconomics({ ...basic, areaHa: 0 }));
  assert.throws(() => calculateEconomics({ ...basic, seedCostHa: -1 }));
  assert.throws(() => calculateEconomics({ ...basic, yieldTonnesHa: NaN }));
});

test('rotation scenarios respond to priority, family and pH constraints', () => {
  const value = recommendRotations({ priority: 'water', currentCrop: 'wheat', irrigated: false, ph: 6.5 });
  assert.equal(value[0].id, 'water');
  assert.equal(value.length, 3);
  assert.ok(value.every(plan => !('score' in plan)));
  for (const plan of value) {
    const first = crops.find(crop => crop.id === plan.sequence[0]);
    assert.notEqual(first.family, 'Poaceae');
    assert.ok(plan.limitations.length > 0);
  }
  assert.ok(recommendRotations({ ph: 14 }).every(plan => plan.sequence.length === 0));
});

test('weather null values stay unavailable while genuine zero is preserved', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    current: { temperature_2m: null, apparent_temperature: 0, relative_humidity_2m: null, wind_speed_10m: 0, weather_code: 0, time: '2026-10-29T10:15' },
    daily: { time: ['2026-10-29'], temperature_2m_max: [null], temperature_2m_min: [0], precipitation_sum: [null] },
    hourly: { time: ['2026-10-29T10:00'], temperature_2m: [null], precipitation: [0], soil_moisture_0_to_1cm: [null] },
    elevation: null, timezone: 'UTC'
  }) });
  try {
    const value = await fetchWeather({ lat: 1, lon: 2 });
    assert.equal(value.current.temperature, null);
    assert.equal(value.current.feelsLike, 0);
    assert.equal(value.current.soilMoisture, null);
    assert.equal(value.daily[0].rain, null);
    assert.equal(value.daily[0].low, 0);
    assert.equal(value.elevation, null);
    assert.equal(value.hourly[0].rain, 0);
  } finally { globalThis.fetch = original; }
});

test('malformed and failed weather responses reject instead of generating sample data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ current: {} }) });
  try { await assert.rejects(fetchWeather({ lat: 3, lon: 4 }), /incomplete/); }
  finally { globalThis.fetch = original; }
  await assert.rejects(fetchWeather({ lat: '', lon: 0 }), /valid latitude/);
});

test('already cancelled requests never fetch even if cached', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchWeather({ lat: 1, lon: 2 }, { signal: controller.signal }), { name: 'AbortError' });
});

test('search returns a selectable resolved location and excludes missing coordinates', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
    { id: 1, name: 'Place', country: 'Country', latitude: 0, longitude: 0 },
    { id: 2, name: 'Unknown', latitude: null, longitude: null }
  ] }) });
  try {
    const value = await searchPlaces('Place');
    assert.equal(value.length, 1);
    assert.equal(value[0].lat, 0);
    assert.equal(value[0].name, 'Place, Country');
  } finally { globalThis.fetch = original; }
});

test('NASA monthly rainfall does not masquerade incomplete sums as full months', async () => {
  const year = new Date().getUTCFullYear() - 1;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ parameters: {ALLSKY_SFC_SW_DWN: {units: 'MJ/m^2/day'}}, properties: { parameter: {
    T2M: { [`${year}0101`]: 20, [`${year}0102`]: -999 },
    PRECTOTCORR: { [`${year}0101`]: 3, [`${year}0102`]: -999 },
    ALLSKY_SFC_SW_DWN: { [`${year}0101`]: 5 }
  } } }) });
  try {
    const value = await fetchNasa({ lat: 10, lon: 20 });
    assert.equal(value.months[0].temperature, 20);
    assert.equal(value.months[0].rain, null);
    assert.equal(value.months[0].availableDays, 1);
    assert.equal(value.months[1].temperature, null);
    assert.equal(value.units.solar, 'MJ/m^2/day', 'Solar units are retained from provider metadata');
  } finally { globalThis.fetch = original; }
});
