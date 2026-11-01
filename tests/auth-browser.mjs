import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
try{
  const guest=await browser.newPage({viewport:{width:390,height:844}});await guest.addInitScript(()=>sessionStorage.setItem('fieldshift.intro.skip-auto','1'));
  await guest.route(origin+'/api/me',route=>route.fulfill({json:{authenticated:false}}));
  await guest.route(origin+'/api/auth/config',route=>route.fulfill({json:{emailEnabled:false,googleClientId:null}}));
  await guest.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});
  const gate=guest.locator('#auth-gate');await gate.waitFor({state:'visible'});
  assert.match(await gate.innerText(),/Continue with Google/);assert.match(await gate.innerText(),/Send verification code/);
  assert.match(await gate.innerText(),/Guest data lasts only for this browser tab/);
  await gate.getByRole('button',{name:'Continue as guest'}).click();await gate.waitFor({state:'hidden'});
  await guest.waitForFunction(()=>window.__fieldshiftStorage===sessionStorage);
  assert.equal(await guest.evaluate(()=>localStorage.getItem('fieldshift.location')),null,'Guest records are not placed in persistent local storage');await guest.close();

  const account=await browser.newPage({viewport:{width:1280,height:800}});await account.addInitScript(()=>sessionStorage.setItem('fieldshift.intro.skip-auto','1'));let sentEmail,verified;
  await account.route(origin+'/api/me',route=>route.fulfill({json:{authenticated:false}}));
  await account.route(origin+'/api/auth/config',route=>route.fulfill({json:{emailEnabled:true,googleClientId:null}}));
  await account.route(origin+'/api/auth/email/send-code',route=>{sentEmail=route.request().postDataJSON().email;return route.fulfill({json:{message:'Verification code sent.'}});});
  await account.route(origin+'/api/auth/email/verify',route=>{verified=route.request().postDataJSON();return route.fulfill({json:{authenticated:true,user:{id:'user-1',email:'farmer@example.com',name:'',provider:'email'}}});});
  await account.route(origin+'/api/workspace',async route=>route.request().method()==='GET'?route.fulfill({json:{data:{'fieldshift.preferences':JSON.stringify({theme:'dark',units:'metric',language:'en'})}}}):route.fulfill({json:{saved:true}}));
  await account.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});await account.locator('#auth-gate').waitFor({state:'visible'});
  await account.locator('[data-auth-email] input').fill('farmer@example.com');await account.locator('[data-auth-email] button').click();
  await account.locator('[data-auth-code]').waitFor({state:'visible'});assert.equal(sentEmail,'farmer@example.com');
  await account.locator('[data-auth-code] input').fill('123456');await account.locator('[data-auth-code] button[type="submit"]').click();
  await account.locator('.auth-chip').waitFor();assert.deepEqual(verified,{email:'farmer@example.com',code:'123456'});assert.match(await account.locator('.auth-chip').innerText(),/farmer@example.com/);
  console.log('PASS: Google/email options, email-code flow, guest session storage, account workspace load.');
}finally{await browser.close();}
