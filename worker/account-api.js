/** Real FieldShift accounts and per-user records. Secrets never reach the browser. */
const SESSION_COOKIE = '__Host-fieldshift_session';
const GUEST_COOKIE = '__Host-fieldshift_guest';
const OAUTH_COOKIE = '__Host-fieldshift_oauth';
const encoder = new TextEncoder();
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ROUNDS = 100000;
const USER_COLUMNS = 'id,email,name,provider,avatar,created_at';

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
}
function cookie(name,value,maxAge) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge === undefined ? '' : '; Max-Age='+maxAge}`; }
function cookies(request) { return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(s=>{const i=s.indexOf('=');if(i<0)return ['', ''];try{return [s.slice(0,i).trim(),decodeURIComponent(s.slice(i+1))];}catch{return ['', ''];}})); }
function withCookies(response, values) { for(const value of values)response.headers.append('set-cookie',value);return response; }
function randomToken(length=32) {return Array.from(crypto.getRandomValues(new Uint8Array(length)),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function sha(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
async function passwordHash(password,salt) { const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']); const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:PBKDF2_ROUNDS},key,256);return Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join(''); }
function equal(a,b) {let delta=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)delta|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return delta===0;}
function userView(user) {return user?{id:user.id,email:user.email,name:user.name,provider:user.provider,avatar:user.avatar||'',createdAt:user.created_at}:null;}
function googleConfigured(env) {return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);}
function email(value) {const normalized=String(value||'').trim().toLowerCase();return normalized.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)?normalized:null;}
function validName(value) {return typeof value==='string'&&value.trim().length>=2&&value.trim().length<=60&&!/[\u0000-\u001f]/.test(value);}
async function readBody(request,max=16000) {if(!request.headers.get('content-type')?.includes('application/json'))throw Object.assign(new Error('Send a JSON request.'),{status:415});if(Number(request.headers.get('content-length')||0)>max)throw Object.assign(new Error('The request is too large.'),{status:413});const reader=request.body?.getReader();let bytes=0,parts=[];if(!reader)throw Object.assign(new Error('Enter the required information.'),{status:400});while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>max){await reader.cancel();throw Object.assign(new Error('The request is too large.'),{status:413});}parts.push(value);}const joined=new Uint8Array(bytes);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}try{const body=JSON.parse(new TextDecoder().decode(joined));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw Object.assign(new Error('Enter valid information.'),{status:400});}}
function safeOrigin(request) {const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');return (!origin||origin===new URL(request.url).origin)&&site!=='cross-site';}
async function sessionUser(request,env) {const token=cookies(request)[SESSION_COOKIE];if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return env.DB.prepare(`SELECT u.${USER_COLUMNS.split(',').join(',u.')} FROM fs_sessions s JOIN fs_users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha(token),Date.now()).first();}
async function createSession(env,user) {const token=randomToken();await env.DB.prepare('INSERT INTO fs_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha(token),user.id,Date.now()+SESSION_SECONDS*1000).run();return cookie(SESSION_COOKIE,token,SESSION_SECONDS);}
async function revokeSession(request,env) {const token=cookies(request)[SESSION_COOKIE];if(token)await env.DB.prepare('DELETE FROM fs_sessions WHERE token_hash=?').bind(await sha(token)).run();}
async function limit(request,env,action,identity='',maximum=20) {const ip=request.headers.get('cf-connecting-ip')||request.headers.get('x-real-ip')||'unknown';const bucket=await sha(action+':'+ip+':'+identity);const now=Date.now(),expires=now+10*60*1000;const row=await env.DB.prepare('INSERT INTO fs_auth_attempts(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts').bind(bucket,expires,now,now).first();if(row.attempts>maximum)throw Object.assign(new Error('Too many attempts. Please try again in ten minutes.'),{status:429});}
function redirect(path,values=[]) {return withCookies(new Response(null,{status:302,headers:{location:path,'cache-control':'no-store'}}),values);}

async function googleStart(request,env) {
  if(!googleConfigured(env))return redirect('/#/account?error=google_unavailable');
  await limit(request,env,'google', '', 30);
  const state=randomToken(),verifier=randomToken(32),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)));
  const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/api/auth/google/callback',request.url).href,response_type:'code',scope:'openid email profile',state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  return redirect(url.href,[cookie(OAUTH_COOKIE,JSON.stringify({state,verifier}),600)]);
}
async function googleCallback(request,env) {
  const clear=cookie(OAUTH_COOKIE,'',0),url=new URL(request.url);let context;
  try{context=JSON.parse(cookies(request)[OAUTH_COOKIE]||'null');}catch{}
  if(!googleConfigured(env)||!context?.state||!equal(context.state,url.searchParams.get('state')||'')||!url.searchParams.get('code'))return redirect('/#/account?error=google_failed',[clear]);
  try{
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code:url.searchParams.get('code'),code_verifier:context.verifier,grant_type:'authorization_code',redirect_uri:new URL('/api/auth/google/callback',request.url).href})});
    const tokens=await tokenResponse.json();if(!tokenResponse.ok||!tokens.access_token)throw Error('token');
    const infoResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+tokens.access_token}}),info=await infoResponse.json();
    const address=email(info.email);if(!infoResponse.ok||!info.sub||!info.email_verified||!address)throw Error('identity');
    let user=await env.DB.prepare(`SELECT u.${USER_COLUMNS.split(',').join(',u.')} FROM fs_google g JOIN fs_users u ON u.id=g.user_id WHERE g.subject=?`).bind(info.sub).first();
    if(!user){
      const existing=await env.DB.prepare('SELECT id FROM fs_users WHERE email=?').bind(address).first();
      if(existing)return redirect('/#/account?error=google_email_exists',[clear]);
      user={id:crypto.randomUUID(),email:address,name:validName(info.name)?info.name.trim():address.split('@')[0],provider:'google',avatar:'',created_at:new Date().toISOString()};
      await env.DB.batch([env.DB.prepare('INSERT INTO fs_users(id,email,name,provider,avatar,created_at) VALUES (?,?,?,?,?,?)').bind(user.id,user.email,user.name,user.provider,user.avatar,user.created_at),env.DB.prepare('INSERT INTO fs_google(subject,user_id) VALUES (?,?)').bind(info.sub,user.id)]);
    }
    await revokeSession(request,env);
    return redirect('/#/account',[clear,await createSession(env,user),cookie(GUEST_COOKIE,'',0)]);
  }catch{return redirect('/#/account?error=google_failed',[clear]);}
}

export async function handleAccountApi(request,env) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/auth/')&&path!=='/api/workspace'&&path!=='/api/account/profile'&&path!=='/api/account')return null;
  if(!env.DB)return json({error:'Account storage is not connected yet.'},503);
  if(method!=='GET'&&method!=='HEAD'&&!safeOrigin(request))return json({error:'This request must come from FieldShift.'},403);
  try{
    if(path==='/api/auth/google/start'&&method==='GET')return await googleStart(request,env);
    if(path==='/api/auth/google/callback'&&method==='GET')return await googleCallback(request,env);
    if(path==='/api/auth/session'&&method==='GET'){const user=await sessionUser(request,env);return json({user:userView(user),guest:!user&&!!cookies(request)[GUEST_COOKIE],googleConfigured:googleConfigured(env)});}
    if(path==='/api/auth/guest'&&method==='POST'){await revokeSession(request,env);return withCookies(json({user:null,guest:true,googleConfigured:googleConfigured(env)}),[cookie(SESSION_COOKIE,'',0),cookie(GUEST_COOKIE,randomToken(12))]);}
    if(path==='/api/auth/logout'&&method==='POST'){await revokeSession(request,env);return withCookies(json({user:null,guest:false}),[cookie(SESSION_COOKIE,'',0),cookie(GUEST_COOKIE,'',0)]);}
    if((path==='/api/auth/signup'||path==='/api/auth/login')&&method==='POST'){
      const body=await readBody(request),raw=String(body.username||body.email||'').trim(),username=/^[a-zA-Z0-9_.-]{3,32}$/.test(raw)?raw.toLowerCase():null,address=raw.includes('@')?email(raw):(username?username+'@fieldshift.local':null),password=body.password;
      await limit(request,env,path, '', path.endsWith('signup')?10:40);
      if(!address||typeof password!=='string'||password.length<3||password.length>256)return json({error:'Enter a username of 3–32 letters, numbers, dots, dashes or underscores, and a password of at least 3 characters.'},400);
      await limit(request,env,path+':email',address,10);
      let user;
      if(path.endsWith('signup')){
        const name=body.name||raw;if(!validName(name))return json({error:'Choose a valid username.'},400);
        const salt=randomToken(16),hash=await passwordHash(password,salt);
        user={id:crypto.randomUUID(),email:address,name:name.trim(),provider:'email',avatar:'',created_at:new Date().toISOString()};
        try{await env.DB.prepare('INSERT INTO fs_users(id,email,name,password_hash,salt,provider,avatar,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(user.id,user.email,user.name,hash,salt,user.provider,'',user.created_at).run();}catch(error){if(String(error.message).includes('UNIQUE'))return json({error:'This username is already taken. Please choose another.'},409);throw error;}
      }else{
        user=await env.DB.prepare('SELECT * FROM fs_users WHERE email=?').bind(address).first();
        const actual=await passwordHash(password,user?.salt||'fieldshift-dummy-salt');
        if(!user?.password_hash||!equal(actual,user.password_hash))return json({error:'The username or password is incorrect.'},401);
      }
      await revokeSession(request,env);
      return withCookies(json({user:userView(user),guest:false,googleConfigured:googleConfigured(env)}),[await createSession(env,user),cookie(GUEST_COOKIE,'',0)]);
    }
    const user=await sessionUser(request,env);if(!user)return json({error:'Sign in to access saved account data.'},401);
    if(path==='/api/workspace'&&method==='GET'){const row=await env.DB.prepare('SELECT data,revision,updated_at FROM fs_workspaces WHERE user_id=?').bind(user.id).first();return json({data:row?JSON.parse(row.data):{},revision:row?.revision||0,updatedAt:row?.updated_at||null});}
    if(path==='/api/workspace'&&method==='PUT'){
      const body=await readBody(request,1000000);
      if(!body.data||typeof body.data!=='object'||Array.isArray(body.data)||!Number.isInteger(body.revision)||body.revision<0||Object.entries(body.data).some(([key,value])=>!/^fieldshift\.[\w.-]+$/.test(key)||typeof value!=='string'))return json({error:'The workspace format is invalid.'},400);
      const data=JSON.stringify(body.data),now=new Date().toISOString();
      const result=body.revision===0
        ? await env.DB.prepare('INSERT INTO fs_workspaces(user_id,data,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision,updated_at').bind(user.id,data,now).first()
        : await env.DB.prepare('UPDATE fs_workspaces SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision,updated_at').bind(data,now,user.id,body.revision).first();
      if(!result)return json({error:'This account was updated in another tab or device. Reload before saving.',conflict:true},409);
      return json({revision:result.revision,updatedAt:result.updated_at});
    }
    if(path==='/api/account/profile'&&method==='PUT'){
      const body=await readBody(request,250000);if(!validName(body.name))return json({error:'Choose a name between 2 and 60 characters.'},400);
      let avatar=user.avatar||'';
      if(body.avatar!==undefined){if(typeof body.avatar!=='string'||body.avatar.length>220000||(body.avatar!==''&&!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(body.avatar)))return json({error:'Choose a PNG, JPEG, or WebP profile image under 160 KB.'},400);avatar=body.avatar;}
      await env.DB.prepare('UPDATE fs_users SET name=?,avatar=? WHERE id=?').bind(body.name.trim(),avatar,user.id).run();return json({user:userView({...user,name:body.name.trim(),avatar})});
    }
    if(path==='/api/account'&&method==='DELETE'){
      const body=await readBody(request);if(body.confirm!=='DELETE')return json({error:'Confirm account deletion.'},400);
      await env.DB.batch([env.DB.prepare('DELETE FROM fs_workspaces WHERE user_id=?').bind(user.id),env.DB.prepare('DELETE FROM fs_sessions WHERE user_id=?').bind(user.id),env.DB.prepare('DELETE FROM fs_google WHERE user_id=?').bind(user.id),env.DB.prepare('DELETE FROM fs_users WHERE id=?').bind(user.id)]);
      return withCookies(json({deleted:true}),[cookie(SESSION_COOKIE,'',0),cookie(GUEST_COOKIE,'',0)]);
    }
    return json({error:'Not found.'},404);
  }catch(error){return json({error:error.status?error.message:'The account service could not complete the request. Please try again.'},error.status||500);}
}
