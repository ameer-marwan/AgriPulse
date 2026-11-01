import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/entry.js';

function database(){
  const state={codes:new Map(),users:new Map(),sessions:new Map(),workspaces:new Map()};
  return {state,prepare(sql){let a=[];return{bind(...values){a=values;return this;},async first(){
    if(sql.startsWith('SELECT sent_at FROM fieldshift_email_codes'))return state.codes.get(a[0])||null;
    if(sql.startsWith('SELECT code_hash, expires_at, attempts'))return state.codes.get(a[0])||null;
    if(sql.startsWith('SELECT id, email, name, provider FROM fieldshift_users WHERE email'))return state.users.get(a[0])||null;
    if(sql.startsWith('SELECT u.id')){const session=state.sessions.get(a[0]);if(!session||session.expires_at<=a[1])return null;return [...state.users.values()].find(user=>user.id===session.user_id)||null;}
    if(sql.startsWith('SELECT data, updated_at FROM fieldshift_workspaces'))return state.workspaces.get(a[0])||null;
    return null;
  },async run(){
    if(sql.startsWith('INSERT INTO fieldshift_email_codes'))state.codes.set(a[0],{code_hash:a[1],expires_at:a[2],sent_at:a[3],attempts:0});
    else if(sql.startsWith('UPDATE fieldshift_email_codes SET attempts'))state.codes.get(a[0]).attempts++;
    else if(sql.startsWith('DELETE FROM fieldshift_email_codes'))state.codes.delete(a[0]);
    else if(sql.startsWith('INSERT INTO fieldshift_users'))state.users.set(a[1],{id:a[0],email:a[1],name:a[2],provider:a[3]});
    else if(sql.startsWith('UPDATE fieldshift_users')){for(const [email,user] of state.users)if(user.id===a[2])state.users.set(email,{...user,name:a[0],provider:a[1]});}
    else if(sql.startsWith('INSERT INTO fieldshift_sessions'))state.sessions.set(a[0],{user_id:a[1],expires_at:a[3]});
    else if(sql.startsWith('DELETE FROM fieldshift_sessions'))state.sessions.delete(a[0]);
    else if(sql.startsWith('INSERT INTO fieldshift_workspaces'))state.workspaces.set(a[0],{data:a[2],updated_at:a[3]});
    return{success:true};
  }};}};
}
const origin='https://fieldshift.test';
const env=DB=>({DB,AUTH_SECRET:'test-secret',RESEND_API_KEY:'re_test',AUTH_FROM_EMAIL:'FieldShift <login@example.com>'});

test('provider configuration reports only configured methods',async()=>{
  const response=await worker.fetch(new Request(origin+'/api/auth/config'),{DB:database()});
  assert.deepEqual(await response.json(),{emailEnabled:false,googleClientId:null});
});

test('email OTP creates a secure session and isolates a cloud workspace',async()=>{
  const DB=database(),originalFetch=globalThis.fetch;let code;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');code=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];return new Response('{}',{status:200});};
  try{
    const request=new Request(origin+'/api/auth/email/send-code',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'farmer@example.com'})});assert.deepEqual(await request.clone().json(),{email:'farmer@example.com'});
    const sent=await worker.fetch(request,env(DB));
    assert.equal(sent.status,200,await sent.text());assert.match(code,/^\d{6}$/);
    const verified=await worker.fetch(new Request(origin+'/api/auth/email/verify',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'farmer@example.com',code})}),env(DB));
    assert.equal(verified.status,200);const setCookie=verified.headers.get('set-cookie');assert.match(setCookie,/fieldshift_session=.*HttpOnly/);
    const session=setCookie.split(';')[0];const me=await worker.fetch(new Request(origin+'/api/me',{headers:{cookie:session}}),env(DB));assert.equal((await me.json()).email,'farmer@example.com');
    const data={'fieldshift.location':'{"lat":10,"lon":20}'};const saved=await worker.fetch(new Request(origin+'/api/workspace',{method:'PUT',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify({data})}),env(DB));assert.equal(saved.status,200);
    const loaded=await worker.fetch(new Request(origin+'/api/workspace',{headers:{cookie:session}}),env(DB));assert.deepEqual((await loaded.json()).data,data);
  }finally{globalThis.fetch=originalFetch;}
});

test('guest writes remain rejected',async()=>{
  const response=await worker.fetch(new Request(origin+'/api/workspace',{method:'PUT',headers:{origin,'content-type':'application/json'},body:'{"data":{}}'}),env(database()));
  assert.equal(response.status,401);
});
