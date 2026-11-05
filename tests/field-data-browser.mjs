import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
await context.addInitScript(()=>sessionStorage.setItem('fieldshift.intro.skip-auto','1'));
if(process.env.FIELDSHIFT_PORTABLE){const html=await readFile(process.env.FIELDSHIFT_PORTABLE,'utf8');await context.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:html}));}
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
let requests=0,fail=false;
const day=new Date().toISOString().slice(0,10);
await page.route('https://api.open-meteo.com/**',async route=>{requests++;if(fail)return route.fulfill({status:503,json:{error:true}});const lat=Number(new URL(route.request().url()).searchParams.get('latitude'));const t=lat<0?19:29;await route.fulfill({json:{latitude:lat,longitude:46.67,timezone:'Asia/Riyadh',elevation:620,current:{time:day+'T12:00',temperature_2m:t,apparent_temperature:t-1,relative_humidity_2m:25,wind_speed_10m:11,weather_code:0,is_day:1},hourly:{time:Array.from({length:24},(_,i)=>day+'T'+String(i).padStart(2,'0')+':00'),temperature_2m:Array(24).fill(t),precipitation:Array(24).fill(0),soil_moisture_0_to_1cm:Array(24).fill(.15)},daily:{time:Array.from({length:7},(_,i)=>new Date(Date.now()+i*86400000).toISOString().slice(0,10)),temperature_2m_max:Array(7).fill(t+3),temperature_2m_min:Array(7).fill(t-5),precipitation_sum:Array(7).fill(1),et0_fao_evapotranspiration:Array(7).fill(4)}}});});
async function select(lat,lon){await page.locator('#latitude-input').fill(String(lat));await page.locator('#longitude-input').fill(String(lon));await page.locator('[data-action="coordinates"]').click();}
try{
  await page.goto(origin+'/#/water',{waitUntil:'domcontentloaded'});
  await page.locator('#view-water [data-context-select]').click();
  assert.equal(requests,0,'no made-up default field request');
  await select(24.71,46.67);
  await page.waitForFunction(()=>document.querySelector('#view-water [data-stat="etWeek"]')?.textContent==='28.0 mm');
  assert.equal(await page.locator('#view-soil [data-stat="moisture"]').textContent(),'15%');
  assert.equal(await page.locator('#view-weather [data-stat="temperature"]').textContent(),'29°C');
  assert.equal(await page.locator('#water-chart svg').count(),1);
  const before=requests;await page.locator('#view-water [data-context-refresh]').click();await page.waitForFunction(()=>document.querySelector('#view-water .field-data-controls')?.dataset.status==='ready');assert.equal(requests,before+1,'Refresh bypasses the in-memory forecast cache');
  await page.locator('#view-water [data-context-select]').click();await select(-1.28,36.82);
  await page.waitForFunction(()=>document.querySelector('#view-weather [data-stat="temperature"]')?.textContent==='19°C');
  assert.match(await page.locator('#view-water [data-context-status]').textContent(),/-1.2800, 36.8200/);
  fail=true;await page.locator('#view-water [data-context-refresh]').click();await page.waitForFunction(()=>document.querySelector('#view-water .field-data-controls')?.dataset.status==='error');
  assert.equal(await page.locator('#view-weather [data-stat="temperature"]').textContent(),'—','failed refresh does not leave stale values');
  fail=false;await page.locator('#view-water [data-context-refresh]').click();await page.waitForFunction(()=>document.querySelector('#view-water .field-data-controls')?.dataset.status==='ready');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#view-weather [data-stat="temperature"]')?.textContent==='19°C');
  assert.match(await page.locator('#view-water [data-context-status]').textContent(),/-1.2800, 36.8200/,'selected field survives reload');
  await page.setViewportSize({width:390,height:844});
  for(const route of ['weather','water','soil','crops','profit','reports']){await page.evaluate(route=>location.hash='/'+route,route);await page.waitForTimeout(80);assert.equal(await page.locator('#view-'+route+' [data-context-select]').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,route+' mobile layout');}
  assert.deepEqual(errors,[]);console.log('PASS: field selection, weather/water/soil shared data, fresh refresh, field switching, failure recovery, reload, mobile controls.');
}finally{await browser.close();}
