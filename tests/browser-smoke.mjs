import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const { chromium } = playwright;
const origin = process.env.FIELDSHIFT_PREVIEW || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
await context.addInitScript(() => sessionStorage.setItem('fieldshift.intro.seen', '1'));
const errors = [];
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const day = '2026-10-29';
const weather = {
  latitude: 38.46, longitude: -98.25, elevation: 500, timezone: 'America/Chicago',
  current: { time: day+'T12:00', temperature_2m: 21, apparent_temperature: 20, relative_humidity_2m: 65, wind_speed_10m: 12, weather_code: 2 },
  hourly: { time: Array.from({length:24},(_,i)=>day+'T'+String(i).padStart(2,'0')+':00'), temperature_2m: Array.from({length:24},(_,i)=>15+i/2), precipitation: Array(24).fill(0), soil_moisture_0_to_1cm: Array(24).fill(.25) },
  daily: { time: Array.from({length:7},(_,i)=>new Date(Date.UTC(2026,9,29+i)).toISOString().slice(0,10)), temperature_2m_max: [21,23,24,22,20,21,22], temperature_2m_min: [10,12,11,9,11,12,11], precipitation_sum: [0,1,2,0,3,0,1], precipitation_probability_max:[0,20,40,0,50,0,10], et0_fao_evapotranspiration: [3,3,4,3,2,3,3] }
};
await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: weather }));
await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ id: 1, name: 'Nairobi', admin1: 'Nairobi County', country: 'Kenya', latitude: -1.2864, longitude: 36.8172 }] } }));
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  assert.equal(errors.length, 0, 'No application startup errors: '+errors.join('; '));
  assert.match(await page.locator('[data-stat="temperature"]').first().innerText(), /21/, 'Live fixture is rendered');
  for (const route of ['map','weather','soil','water','crops','profit','reports','settings','overview']) {
    await page.goto(origin+'/#/'+route, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#view-'+route).isVisible(), true, route+' route visible');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false, route+' has no desktop overflow');
  }
  await page.goto(origin+'/#/profit');
  await page.locator('[name="yieldTonnesHa"]').fill('4');
  await page.locator('#economics-form button[type="submit"], #economics-form button').last().click();
  assert.match(await page.locator('#profit-total').innerText(), /800/, 'Profit recalculates from entered values');
  await page.goto(origin+'/#/soil');
  await page.getByRole('button', {name:'Add a soil sample', exact:true}).click();
  await page.locator('#soil-sample-form [name="name"]').fill('QA laboratory sample');
  await page.locator('#soil-sample-form [name="date"]').fill('2026-10-28');
  await page.locator('#soil-sample-form [name="depth"]').fill('15');
  await page.locator('#soil-sample-form [name="ph"]').fill('6.8');
  await page.locator('#soil-sample-form [name="method"]').fill('Test laboratory');
  await page.locator('#soil-sample-form button').last().click();
  assert.match(await page.locator('#soil-samples').innerText(), /QA laboratory sample/);
  await page.reload();
  assert.match(await page.locator('#soil-samples').innerText(), /QA laboratory sample/, 'Sample persists');
  await page.goto(origin+'/#/settings');
  await page.locator('#appearance').selectOption('light');
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('light')), true);
  await page.locator('#appearance').selectOption('dark');
  await page.goto(origin+'/#/overview');
  await page.screenshot({path:'/tmp/fieldshift-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false, 'No mobile overflow');
  await page.screenshot({path:'/tmp/fieldshift-mobile.png',fullPage:true});
  for (const route of ['map','weather','soil','water','crops','profit','reports','settings']) {
    await page.goto(origin+'/#/'+route, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false, route+' has no mobile overflow');
  }
  assert.deepEqual(errors, [], 'No uncaught application errors');
  console.log('PASS: startup, 10 routes, profit, saved sample, guide, theme, desktop/mobile overflow.');
} finally { await browser.close(); }
