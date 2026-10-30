import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('playwright');} catch {playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}:undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const day='2026-10-30';
const days=Array.from({length:7},(_,i)=>new Date(Date.UTC(2026,9,30+i)).toISOString().slice(0,10));
function weather(lat,lon){return {latitude:lat,longitude:lon,elevation:500,timezone:'UTC',current:{time:day+'T12:00',temperature_2m:lat===10?34:21,apparent_temperature:20,relative_humidity_2m:65,wind_speed_10m:12,weather_code:2},hourly:{time:Array.from({length:24},(_,i)=>day+'T'+String(i).padStart(2,'0')+':00'),temperature_2m:Array(24).fill(21),precipitation:Array(24).fill(0),soil_moisture_0_to_1cm:Array(24).fill(.25),wind_speed_10m:Array(24).fill(12),relative_humidity_2m:Array(24).fill(65),weather_code:Array(24).fill(2)},daily:{time:days,temperature_2m_max:[36,23,24,22,20,21,22],temperature_2m_min:[10,12,11,9,11,12,11],precipitation_sum:[18,1,2,0,3,0,1],precipitation_probability_max:[90,20,40,0,50,0,10],et0_fao_evapotranspiration:[3,3,4,3,2,3,3],wind_speed_10m_max:[40,15,12,10,20,15,18]}};}
await page.route('https://api.open-meteo.com/**',route=>{const url=new URL(route.request().url()),lat=Number(url.searchParams.get('latitude'));if(lat===33)return route.fulfill({status:503,json:{error:true}});const value=weather(lat,Number(url.searchParams.get('longitude')));if(lat===55){value.daily.temperature_2m_max[0]=null;value.daily.precipitation_sum[0]=null;}return route.fulfill({json:value});});
async function route(name){await page.goto(origin+'/#/'+name,{waitUntil:'domcontentloaded'});await page.locator('#view-'+name).waitFor({state:'visible'});}
async function select(lat,lon){await route('overview');await page.locator('.field-picker').click();await page.locator('#latitude-input').fill(String(lat));await page.locator('#longitude-input').fill(String(lon));await page.locator('[data-action="coordinates"]').click();await page.waitForFunction(([a,b])=>{const l=JSON.parse(localStorage.getItem('fieldshift.location'));return l.lat===a&&l.lon===b;},[lat,lon]);await page.waitForTimeout(150);}
try {
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#current-crop option').first().waitFor({state:'attached'});
  await page.locator('#planning-guide-open').click();
  await page.locator('#planning-guide').waitFor({state:'visible'});
  assert.equal(await page.locator('#planning-guide-steps .planning-check-step').count(),4,'Guide has four meaningful setup steps');
  await page.locator('#planning-guide-close').click();
  await select(10,20);
  await route('profit');
  await page.locator('#economics-form [name="yieldTonnesHa"]').fill('8');
  await page.locator('#economics-form button').last().click();
  const aMargin=await page.locator('#profit-total').innerText();
  await route('crops');await page.locator('#current-crop').selectOption('maize');await page.locator('#planning-priority').selectOption('water');await page.locator('#planner-ph').fill('6.2');await page.locator('#planner-ph').dispatchEvent('change');
  await page.locator('#planning-date').fill('2027-03-01');await page.locator('#planning-crop').selectOption('maize');await page.locator('#planning-duration-0').fill('20');await page.locator('#planning-season-form button').click();
  assert.equal(await page.locator('.planning-stage').count(),5,'Season timeline has five stages');assert.match(await page.locator('.planning-stage').first().innerText(),/20 days/,'Edited stage duration rendered');
  await route('water');await page.locator('#planning-temperature').fill('2');await page.locator('#planning-temperature').dispatchEvent('input');await page.locator('#planning-rainfall').fill('-50');await page.locator('#planning-rainfall').dispatchEvent('input');
  assert.match(await page.locator('#planning-scenario').innerText(),/38.0°C/,'Scenario applies +2°C to36°C baseline');assert.match(await page.locator('#planning-scenario').innerText(),/9.0 mm/,'Scenario halves18mm baseline rainfall');
  await route('soil');await page.locator('#planning-note-form [name="text"]').fill('Field A observation — crop emergence uneven.');
  await page.locator('#planning-note-form [name="photo"]').setInputFiles({name:'observation.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCZkAAAAASUVORK5CYII=','base64')});
  await page.locator('#planning-note-save').click();await page.locator('#planning-notes-list .planning-note').waitFor();assert.equal(await page.locator('#planning-notes-list img').count(),1,'Photo persists with observation');
  await route('weather');assert.match(await page.locator('#planning-alerts').innerText(),/Heat stress watch/,'Heat threshold flagged');assert.match(await page.locator('#planning-alerts').innerText(),/Rain may limit/,'Heavy rain threshold flagged');
  await route('reports');assert.match(await page.locator('#planning-report-body').innerText(),/Field A observation/,'Report carries selected field observations');assert.match(await page.locator('#planning-report-body').innerText(),/2027-03-01/,'Report carries schedule');
  await route('crops');await page.locator('#planning-date').fill('2028-04-02');await page.locator('[data-action="refresh"]').dispatchEvent('click');await page.waitForTimeout(100);assert.equal(await page.locator('#planning-date').inputValue(),'2028-04-02','Unsaved schedule survives same-field forecast refresh');
  await route('soil');await page.locator('#planning-note-form [name="text"]').fill('Unsaved A draft');
  await select(-10,30);
  await route('profit');assert.equal(await page.locator('[name="yieldTonnesHa"]').inputValue(),'3','A yield does not contaminate B');
  await route('crops');assert.equal(await page.locator('#current-crop').inputValue(),'wheat','A crop does not contaminate B');assert.equal(await page.locator('#planner-ph').inputValue(),'','A pH does not contaminate B');
  assert.notEqual(await page.locator('#planning-date').inputValue(),'2027-03-01','A schedule does not contaminate B');await route('soil');assert.equal(await page.locator('#planning-note-form [name="text"]').inputValue(),'','A unsaved draft clears when selecting B');assert.doesNotMatch(await page.locator('#planning-notes-list').innerText(),/Field A/,'A observations hidden on B');await route('water');assert.equal(await page.locator('#planning-temperature').inputValue(),'0','A sensitivity does not contaminate B');await route('crops');
  await page.locator('#current-crop').selectOption('sorghum');
  await select(10,20);await route('profit');assert.equal(await page.locator('[name="yieldTonnesHa"]').inputValue(),'8','A yield restored');assert.equal(await page.locator('#profit-total').innerText(),aMargin,'A economics restored');
  await route('crops');assert.equal(await page.locator('#current-crop').inputValue(),'maize','A crop restored');assert.equal(await page.locator('#planning-priority').inputValue(),'water','A priority restored');assert.equal(await page.locator('#planner-ph').inputValue(),'6.2','A pH restored');
  assert.equal(await page.locator('#planning-date').inputValue(),'2027-03-01','A schedule restored');await route('soil');assert.match(await page.locator('#planning-notes-list').innerText(),/Field A/,'A observation restored');await route('water');assert.equal(await page.locator('#planning-temperature').inputValue(),'2','A sensitivity restored');await route('crops');
  await page.reload();await page.locator('#current-crop option').first().waitFor({state:'attached'});assert.equal(await page.locator('#current-crop').inputValue(),'maize','A crop survives reload');
  await page.locator('[data-action="save-plan"]').click();await page.locator('#current-crop').selectOption('barley');await page.locator('#saved-plans-list').getByRole('button',{name:'Restore assumptions'}).first().click();assert.equal(await page.locator('#current-crop').inputValue(),'maize','Saved plan restores crop assumptions');
  await page.locator('#saved-plans-list').getByRole('button',{name:'Remove',exact:true}).first().click();assert.equal(await page.locator('#saved-plans-list .sample-row').count(),0,'Saved plan removal updates current field');
  await route('soil');await page.getByRole('button',{name:'Add a soil sample',exact:true}).click();await page.locator('#soil-sample-form [name="name"]').fill('Field A lab');await page.locator('#soil-sample-form [name="date"]').fill('2026-10-28');await page.locator('#soil-sample-form [name="depth"]').fill('15');await page.locator('#soil-sample-form [name="ph"]').fill('6.7');await page.locator('#soil-sample-form [name="method"]').fill('Laboratory');await page.locator('#soil-sample-form button').last().click();await page.locator('[data-use-sample]').first().click();await route('crops');assert.equal(await page.locator('#planner-ph').inputValue(),'6.7','Applying dated sample updates current field pH');await route('overview');assert.match(await page.locator('#planning-evidence-grid').innerText(),/User records/,'Local sample updates evidence');await route('reports');assert.match(await page.locator('#planning-report-body').innerText(),/Field A lab/,'Selected field lab evidence appears in report');
  await select(55,44);await route('water');await page.waitForFunction(()=>document.querySelector('#planning-scenario').textContent.includes('Unavailable'));assert.match(await page.locator('#planning-scenario tbody tr').first().innerText(),/Unavailable.*Unavailable.*Unavailable.*Unavailable/,'Missing source high/rain remains unavailable for baseline and scenario');
  await select(33,44);await route('water');await page.waitForFunction(()=>document.querySelector('[data-weather-status]').textContent==='UNAVAILABLE');assert.match(await page.locator('#planning-scenario').innerText(),/forecast.*required/,'Failed field forecast does not reuse A or B sensitivity');await route('weather');assert.match(await page.locator('#planning-alerts').innerText(),/No weather available/,'Failed forecast clears weather alerts');assert.equal(await page.locator('[data-stat="temperature"]').first().textContent(),'—','Failed forecast clears temperature');
  await route('map');await page.waitForTimeout(1200);await page.locator('#field-map canvas').click({position:{x:100,y:100}});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fieldshift.location')).method==='Map');assert.equal(await page.locator('#selection-type').textContent(),'MAP','Map selection updates field context');await page.waitForFunction(()=>document.querySelector('[data-weather-status]').textContent==='MODEL');
  for(const name of ['overview','map','weather','soil','water','crops','profit','reports','assistant','settings']){await route(name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' desktop fits');}
  await page.setViewportSize({width:390,height:844});
  for(const name of ['overview','map','weather','soil','water','crops','profit','reports','assistant','settings']){await route(name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' mobile fits');}
  assert.deepEqual(errors,[],'No uncaught application errors');
  console.log('PASS: per-field economics/planner/timeline/scenario/observation+photo isolation and restoration, guide, heat/rain alerts, report appendix, 10 routes, desktop/mobile overflow.');
} finally {await browser.close();}
