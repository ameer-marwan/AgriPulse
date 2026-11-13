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

test('economics applies local selling losses, transport and market fees', () => {
  const value = calculateEconomics({ ...basic, sellingLossPercent: 10, transportCostPerTonne: 20, marketFeePercent: 5 });
  assert.equal(value.saleableYieldTonnesHa, 3.6);
  assert.equal(value.revenue, 1800);
  assert.equal(value.sellingCosts, 234);
  assert.equal(value.cost, 1234);
  assert.equal(value.margin, 566);
  assert.ok(Math.abs(value.breakEvenPrice - 167.2514619883041) < 1e-9);
  assert.ok(Math.abs(value.breakEvenYield - 2.554278416347382) < 1e-9);
  assert.throws(() => calculateEconomics({ ...basic, sellingLossPercent: 101 }));
  assert.throws(() => calculateEconomics({ ...basic, marketFeePercent: -1 }));
});

test('rotation scenarios do not invent crop suitability without approved evidence', () => {
  const value = recommendRotations({ priority: 'water', currentCrop: 'wheat', irrigated: false, ph: 6.5 });
  assert.equal(value[0].id, 'water');
  assert.equal(value.length, 3);
  assert.ok(value.every(plan => plan.sequence.length === 0));
  assert.ok(value.every(plan => plan.evidence === 'No inferred suitability values'));
  assert.ok(value.every(plan => plan.limitations.length > 0));
  assert.ok(recommendRotations({ ph: 14 }).every(plan => plan.sequence.length === 0));
});

test('weather null values stay unavailable while genuine zero is preserved', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    properties: { parameter: {
      T2M: { '20261029': 0 }, T2M_MAX: { '20261029': -999 }, T2M_MIN: { '20261029': 0 },
      RH2M: { '20261029': -999 }, WS10M: { '20261029': 0 }, WS10M_MAX: { '20261029': 0 },
      PRECTOTCORR: { '20261029': 0 }, ALLSKY_SFC_SW_DWN: { '20261029': -999 }
    } }
  }) });
  try {
    const value = await fetchWeather({ lat: 1, lon: 2 });
    assert.equal(value.current.temperature, 0);
    assert.equal(value.current.feelsLike, null);
    assert.equal(value.current.soilMoisture, null);
    assert.equal(value.daily[0].rain, 0);
    assert.equal(value.daily[0].low, 0);
    assert.equal(value.elevation, null);
    assert.deepEqual(value.hourly, []);
  } finally { globalThis.fetch = original; }
});

test('malformed and failed weather responses reject instead of generating sample data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ properties: { parameter: {} } }) });
  try { await assert.rejects(fetchWeather({ lat: 3, lon: 4 }), /no usable recent daily data/); }
  finally { globalThis.fetch = original; }
  await assert.rejects(fetchWeather({ lat: '', lon: 0 }), /valid latitude/);
});

test('weather keeps the latest seven NASA POWER records and converts wind to km/h', async () => {
  const original = globalThis.fetch;
  let requestUrl;
  globalThis.fetch = async url => {
    requestUrl = new URL(url);
    const dates = Array.from({ length: 9 }, (_, index) => `202610${String(index + 1).padStart(2,'0')}`);
    const record = mapper => Object.fromEntries(dates.map((date,index) => [date, mapper(index)]));
    return { ok: true, json: async () => ({ properties: { parameter: {
      T2M: record(i => 20 + i), T2M_MAX: record(i => 25 + i), T2M_MIN: record(i => 10 + i),
      RH2M: record(() => 50), WS10M: record(() => 2), WS10M_MAX: record(() => 5),
      PRECTOTCORR: record(i => i === 8 ? 0 : 1), ALLSKY_SFC_SW_DWN: record(() => 6)
    } } }) };
  };
  try {
    const value = await fetchWeather({ lat: 4, lon: 5 });
    assert.equal(value.daily.length, 7);
    assert.equal(value.daily[0].date, '2026-10-03');
    assert.equal(value.daily.at(-1).high, 33);
    assert.equal(value.daily.at(-1).windMax, 18);
    assert.equal(value.daily.at(-1).rain, 0);
    assert.equal(value.current.wind, 7.2);
    assert.equal(value.hourly.length, 0);
    assert.match(requestUrl.hostname, /power\.larc\.nasa\.gov/);
    assert.match(requestUrl.searchParams.get('parameters'), /PRECTOTCORR/);
    assert.match(value.units.wind, /km\/h/);
  } finally { globalThis.fetch = original; }
});

test('already cancelled requests never fetch even if cached', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchWeather({ lat: 1, lon: 2 }, { signal: controller.signal }), { name: 'AbortError' });
});

test('coordinate entry resolves locally without an outside geocoding provider', async () => {
  let fetched = false;
  const original = globalThis.fetch; globalThis.fetch = async () => { fetched = true; throw new Error('unexpected fetch'); };
  try {
    const value = await searchPlaces('24.7136, 46.6753');
    assert.equal(value.length, 1);
    assert.equal(value[0].lat, 24.7136);
    assert.match(value[0].name, /Coordinates/);
    assert.equal(fetched, false);
    await assert.rejects(searchPlaces('Riyadh'), /Enter coordinates/);
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
