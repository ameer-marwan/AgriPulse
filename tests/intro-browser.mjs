import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844}});
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
try{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const intro=page.locator('.fieldshift-intro');await intro.waitFor({state:'visible'});
  assert.equal(await intro.locator('img,video,canvas').count(),0,'The introduction has no images or video');
  assert.equal(await intro.locator('h1').innerText(),'FieldShift');
  assert.match(await intro.locator('p').innerText(),/weather, water, soil/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Fits a phone');
  await intro.getByRole('button',{name:'Enter FieldShift'}).click();await intro.waitFor({state:'hidden'});
  await page.goto(origin+'/#/settings',{waitUntil:'domcontentloaded'});
  await page.locator('#language').selectOption('fr');await page.locator('.intro-replay-setting button').click();
  assert.match(await intro.locator('p').innerText(),/météo/,'French caption');await intro.locator('button').click();
  await page.locator('#language').selectOption('ar');await page.locator('.intro-replay-setting button').click();
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.match(await intro.locator('p').innerText(),/الطقس/,'Arabic caption');
  console.log('PASS: text-only introduction, entry, replay, French/Arabic, phone layout.');
}finally{await browser.close();}
