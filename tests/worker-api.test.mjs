import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/entry.js';

function database(){
  const state={users:new Map(),sessions:new Map(),workspaces:new Map(),attempts:new Map()};
  return {state,prepare(sql){let a=[];return{bind(...values){a=values;return this;},async first(){
    if(sql.startsWith('SELECT u.id')){const session=state.sessions.get(a[0]);if(!session||session.expires_at<=a[1])return null;return [...state.users.values()].find(user=>user.id===session.user_id)||null;}
    if(sql.startsWith('SELECT id FROM fieldshift_users'))return state.users.get(a[0])||null;
    if(sql.startsWith('SELECT id, email, name, username, provider, password_hash'))return state.users.get(a[0])||null;
    if(sql.startsWith('SELECT id, email, name, username, provider FROM'))return state.users.get(a[0])||null;
    if(sql.startsWith('SELECT attempts, locked_until'))return state.attempts.get(a[0])||null;
    if(sql.startsWith('SELECT data, updated_at FROM fieldshift_workspaces'))return state.workspaces.get(a[0])||null;
    return null;
  },async run(){
    if(sql.startsWith('INSERT INTO fieldshift_users')&&sql.includes("'password'"))state.users.set(a[1],{id:a[0],email:a[1],name:'',username:a[2],provider:'password',password_hash:a[3],password_salt:a[4]});
    else if(sql.startsWith('INSERT INTO fieldshift_sessions'))state.sessions.set(a[0],{user_id:a[1],expires_at:a[3]});
    else if(sql.startsWith('DELETE FROM fieldshift_sessions'))state.sessions.delete(a[0]);
    else if(sql.startsWith('INSERT INTO fieldshift_login_attempts'))state.attempts.set(a[0],{attempts:a[1],locked_until:a[3]});
    else if(sql.startsWith('DELETE FROM fieldshift_login_attempts'))state.attempts.delete(a[0]);
    else if(sql.startsWith('INSERT INTO fieldshift_workspaces'))state.workspaces.set(a[0],{data:a[2],updated_at:a[3]});
    return{success:true};
  }};}};
}
const origin='https://fieldshift.test',environment=DB=>({DB,AUTH_SECRET:'test-secret'});

test('provider configuration enables password accounts without exposing a secret',async()=>{
  const response=await worker.fetch(new Request(origin+'/api/auth/config'),environment(database()));
  assert.deepEqual(await response.json(),{passwordEnabled:true,googleClientId:null});
});

test('password signup, login and cloud workspace work with secure sessions',async()=>{
  const DB=database(),signupBody={username:'Field Farmer',email:'farmer@example.com',password:'strong-field-password'};
  const signup=await worker.fetch(new Request(origin+'/api/auth/signup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(signupBody)}),environment(DB));
  assert.equal(signup.status,200,await signup.text());const signupCookie=signup.headers.get('set-cookie');assert.match(signupCookie,/fieldshift_session=.*HttpOnly/);assert.notEqual(DB.state.users.get('farmer@example.com').password_hash,signupBody.password);
  const session=signupCookie.split(';')[0],me=await worker.fetch(new Request(origin+'/api/me',{headers:{cookie:session}}),environment(DB));const identity=await me.json();assert.equal(identity.username,'Field Farmer');assert.equal(identity.authenticated,true);
  const data={'fieldshift.location':'{"lat":10,"lon":20}'};const saved=await worker.fetch(new Request(origin+'/api/workspace',{method:'PUT',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify({data})}),environment(DB));assert.equal(saved.status,200);const loaded=await worker.fetch(new Request(origin+'/api/workspace',{headers:{cookie:session}}),environment(DB));assert.deepEqual((await loaded.json()).data,data);
  const login=await worker.fetch(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:signupBody.email,password:signupBody.password})}),environment(DB));assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/fieldshift_session=/);
  const wrong=await worker.fetch(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:signupBody.email,password:'wrong-password-value'})}),environment(DB));assert.equal(wrong.status,401);
});

test('guest workspace writes remain rejected',async()=>{
  const response=await worker.fetch(new Request(origin+'/api/workspace',{method:'PUT',headers:{origin,'content-type':'application/json'},body:'{"data":{}}'}),environment(database()));
  assert.equal(response.status,401);
});
