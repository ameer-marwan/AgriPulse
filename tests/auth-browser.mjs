import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
try{
  const guest=await browser.newPage({viewport:{width:390,height:844}});
  await guest.route(origin+'/api/me',route=>route.fulfill({json:{authenticated:false}}));
  await guest.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});
  const gate=guest.locator('#auth-gate');await gate.waitFor({state:'visible'});await gate.locator('.auth-gate.ready, .auth-actions').last().waitFor({state:'visible'});
  assert.equal(await gate.getByRole('link',{name:'Create account'}).getAttribute('href'),'/signin-with-chatgpt?return_to=/');
  assert.match(await gate.innerText(),/Guest data lasts only for this browser tab/);
  await gate.getByRole('button',{name:'Continue as guest'}).click();await gate.waitFor({state:'hidden'});
  await guest.waitForFunction(()=>window.__fieldshiftStorage===sessionStorage);
  assert.equal(await guest.evaluate(()=>localStorage.getItem('fieldshift.location')),null,'Guest records are not placed in persistent local storage');
  await guest.close();

  const account=await browser.newPage({viewport:{width:1280,height:800}});let saved;
  await account.route(origin+'/api/me',route=>route.fulfill({json:{authenticated:true,email:'farmer@example.com',name:'Field Farmer'}}));
  await account.route(origin+'/api/workspace',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{data:{'fieldshift.preferences':JSON.stringify({theme:'dark',units:'metric',language:'en'})}}});
    saved=route.request().postDataJSON();return route.fulfill({json:{saved:true,updatedAt:new Date().toISOString()}});
  });
  await account.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});
  await account.locator('.auth-chip').waitFor();assert.match(await account.locator('.auth-chip').innerText(),/farmer@example.com/);
  assert.equal(await account.locator('.auth-chip').getAttribute('href'),'/signout-with-chatgpt?return_to=/');
  await account.goto(origin+'/?auth-preview=1#/settings',{waitUntil:'domcontentloaded'});await account.locator('.auth-chip').waitFor();
  await account.locator('#weather-units').selectOption('imperial');await account.waitForTimeout(1000);
  assert.ok(saved?.data?.['fieldshift.preferences'],'Signed-in changes are sent to the cloud workspace endpoint');
  console.log('PASS: account gate, real sign-in routes, guest session storage, cloud load and sync.');
}finally{await browser.close();}
