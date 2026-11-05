import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountApi} from './account-api.js';

function localD1(sqlite) {
  return {prepare(sql){const stmt=sqlite.prepare(sql);let values=[];return {bind(...args){values=args;return this;},async first(){return stmt.get(...values)||null;},async run(){return stmt.run(...values);},async all(){return {results:stmt.all(...values)};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
async function fixture(){const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));return {DB:localD1(db)};}
const origin='https://fieldshift.example';
const call=(env,path,method='GET',body,cookie='',headers={})=>handleAccountApi(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)}),env);
const sessionCookie=res=>res.headers.getSetCookie().find(value=>value.startsWith('__Host-fieldshift_session='))?.split(';')[0]||'';

test('real accounts persist only their own workspace and reject stale saves',async()=>{
  const env=await fixture();
  const a=await call(env,'/api/auth/signup','POST',{name:'Farmer A',email:'a@example.test',password:'correct horse battery'});assert.equal(a.status,200);const ca=sessionCookie(a);assert.match(ca,/__Host-fieldshift_session=[a-f0-9]{64}/);assert.match(a.headers.getSetCookie()[0],/HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await (await call(env,'/api/auth/session','GET',undefined,ca)).json()).user.email,'a@example.test');
  const initial=await (await call(env,'/api/workspace','GET',undefined,ca)).json();assert.equal(initial.revision,0);
  const first=await call(env,'/api/workspace','PUT',{data:{'fieldshift.location':'{"name":"Farm A"}'},revision:0},ca);assert.equal(first.status,200);assert.equal((await first.json()).revision,1);
  const next=await call(env,'/api/workspace','PUT',{data:{'fieldshift.location':'{"name":"Changed"}'},revision:1},ca);assert.equal((await next.json()).revision,2);
  assert.equal((await call(env,'/api/workspace','PUT',{data:{},revision:1},ca)).status,409);
  const b=await call(env,'/api/auth/signup','POST',{name:'Farmer B',email:'b@example.test',password:'another strong password'});const cb=sessionCookie(b);const empty=await (await call(env,'/api/workspace','GET',undefined,cb)).json();assert.deepEqual(empty.data,{});
  const saved=await (await call(env,'/api/workspace','GET',undefined,ca)).json();assert.equal(saved.data['fieldshift.location'],'{"name":"Changed"}');
  assert.equal((await call(env,'/api/workspace','GET')).status,401);
});

test('password sessions, duplicate addresses, CSRF and guests are enforced',async()=>{
  const env=await fixture(),account={name:'Field operator',email:'owner@example.test',password:'long enough password'};
  const signup=await call(env,'/api/auth/signup','POST',account);const cookie=sessionCookie(signup);
  assert.equal((await call(env,'/api/auth/signup','POST',account)).status,409);
  assert.equal((await call(env,'/api/auth/login','POST',{email:account.email,password:'incorrect password'})).status,401);
  const login=await call(env,'/api/auth/login','POST',account);assert.equal(login.status,200);
  const csrf=await call(env,'/api/account/profile','PUT',{name:'Malicious'},cookie,{origin:'https://untrusted.example'});assert.equal(csrf.status,403);
  const guest=await call(env,'/api/auth/guest','POST',undefined,cookie);assert.equal((await guest.json()).guest,true);assert.equal((await call(env,'/api/workspace','GET',undefined,cookie)).status,401);
  const google=await call(env,'/api/auth/google/start');assert.equal(google.status,302);assert.match(google.headers.get('location'),/google_unavailable/);
});

test('profile updates and account deletion require authenticated ownership',async()=>{
  const env=await fixture(),signup=await call(env,'/api/auth/signup','POST',{name:'Operator',email:'operator@example.test',password:'strong passphrase here'}),cookie=sessionCookie(signup);
  const profile=await call(env,'/api/account/profile','PUT',{name:'New name',avatar:''},cookie);assert.equal((await profile.json()).user.name,'New name');
  assert.equal((await call(env,'/api/account','DELETE',{confirm:'wrong'},cookie)).status,400);
  assert.equal((await call(env,'/api/account','DELETE',{confirm:'DELETE'},cookie)).status,200);
  assert.equal((await call(env,'/api/workspace','GET',undefined,cookie)).status,401);
});
