import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await playwright.chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const origin=process.env.FIELDSHIFT_PREVIEW||'http://127.0.0.1:4173';
const skipIntro=page=>page.addInitScript(()=>sessionStorage.setItem('fieldshift.intro.skip-auto','1'));
const baseRoutes=async page=>{await page.route(origin+'/api/me',route=>route.fulfill({json:{authenticated:false}}));await page.route(origin+'/api/auth/config',route=>route.fulfill({json:{passwordEnabled:true,googleClientId:null}}));await page.route(origin+'/api/workspace',route=>route.fulfill({json:{data:{}}}));};
try{
  const guest=await browser.newPage({viewport:{width:390,height:844}});await skipIntro(guest);await baseRoutes(guest);await guest.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});
  const gate=guest.locator('#auth-gate');await gate.waitFor({state:'visible'});assert.match(await gate.innerText(),/Continue with Google/);assert.match(await gate.innerText(),/Email address/);assert.match(await gate.innerText(),/Password/);
  await gate.getByRole('button',{name:'Continue as guest'}).click();await gate.waitFor({state:'hidden'});await guest.waitForFunction(()=>window.__fieldshiftStorage===sessionStorage);assert.equal(await guest.evaluate(()=>localStorage.getItem('fieldshift.location')),null);await guest.close();

  const signup=await browser.newPage({viewport:{width:1280,height:800}});await skipIntro(signup);await baseRoutes(signup);let signupBody;
  await signup.route(origin+'/api/auth/signup',route=>{signupBody=route.request().postDataJSON();return route.fulfill({json:{authenticated:true,user:{id:'user-1',email:'farmer@example.com',username:'Field Farmer',name:'',provider:'password'}}});});
  await signup.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});await signup.locator('#auth-gate').waitFor({state:'visible'});await signup.getByRole('tab',{name:'Create account'}).click();
  const signupForm=signup.locator('[data-auth-signup]');await signupForm.locator('[name="username"]').fill('Field Farmer');await signupForm.locator('[name="email"]').fill('farmer@example.com');await signupForm.locator('[name="password"]').fill('strong-field-password');await signupForm.getByRole('button',{name:'Create my account'}).click();
  await signup.locator('.auth-chip').waitFor();assert.deepEqual(signupBody,{username:'Field Farmer',email:'farmer@example.com',password:'strong-field-password'});assert.match(await signup.locator('.auth-chip').innerText(),/Field Farmer/);await signup.close();

  const login=await browser.newPage({viewport:{width:1280,height:800}});await skipIntro(login);await baseRoutes(login);let loginBody;
  await login.route(origin+'/api/auth/login',route=>{loginBody=route.request().postDataJSON();return route.fulfill({json:{authenticated:true,user:{id:'user-1',email:'farmer@example.com',username:'Field Farmer',name:'',provider:'password'}}});});
  await login.goto(origin+'/?auth-preview=1',{waitUntil:'domcontentloaded'});const loginForm=login.locator('[data-auth-login]');await loginForm.locator('[name="email"]').fill('farmer@example.com');await loginForm.locator('[name="password"]').fill('strong-field-password');await loginForm.getByRole('button',{name:'Enter FieldShift'}).click();await login.locator('.auth-chip').waitFor();assert.deepEqual(loginBody,{email:'farmer@example.com',password:'strong-field-password'});
  console.log('PASS: Google option, login, account creation, guest session storage, account workspace load.');
}finally{await browser.close();}
