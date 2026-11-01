const PAGE_B64 = '__PAGE_BASE64__';
let pageBytes;
function page(){
  if(pageBytes)return pageBytes;
  const raw=atob(PAGE_B64),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  pageBytes=bytes;return bytes;
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function identity(request){
  const userId=request.headers.get('oai-authenticated-user-id');
  if(!userId)return null;
  const email=request.headers.get('oai-authenticated-user-email')||'';
  const encoded=request.headers.get('oai-authenticated-user-full-name');
  let name='';
  if(encoded&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{name=decodeURIComponent(encoded);}catch{}
  return {userId,email,name:name||email};
}
async function workspace(request,env,user){
  if(!user)return json({error:'Sign in is required.'},401);
  if(!env.DB)return json({error:'Workspace storage is unavailable.'},503);
  if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT data, updated_at FROM fieldshift_workspaces WHERE user_id = ?').bind(user.userId).first();
    if(!row)return json({data:{},updatedAt:null});
    try{return json({data:JSON.parse(row.data),updatedAt:row.updated_at});}catch{return json({data:{},updatedAt:row.updated_at});}
  }
  if(request.method==='PUT'){
    const length=Number(request.headers.get('content-length')||0);if(length>4_500_000)return json({error:'Workspace is too large to sync.'},413);
    let body;try{body=await request.json();}catch{return json({error:'Invalid JSON.'},400);}
    const data=body?.data;if(!data||Array.isArray(data)||typeof data!=='object')return json({error:'Invalid workspace.'},400);
    const entries=Object.entries(data);if(entries.length>100||entries.some(([key,value])=>!key.startsWith('fieldshift.')||typeof value!=='string'))return json({error:'Invalid workspace keys.'},400);
    const encoded=JSON.stringify(data);if(encoded.length>4_000_000)return json({error:'Workspace is too large to sync.'},413);
    const updatedAt=new Date().toISOString();
    await env.DB.prepare('INSERT INTO fieldshift_workspaces (user_id, email, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, data = excluded.data, updated_at = excluded.updated_at').bind(user.userId,user.email,encoded,updatedAt).run();
    return json({saved:true,updatedAt});
  }
  return json({error:'Method not allowed.'},405);
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),user=identity(request);
    try{
      if(url.pathname==='/api/me')return json(user?{authenticated:true,email:user.email,name:user.name}:{authenticated:false});
      if(url.pathname==='/api/workspace')return await workspace(request,env,user);
      if(url.pathname.startsWith('/api/'))return json({error:'Not found.'},404);
      return new Response(page(),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','content-security-policy':"default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",'referrer-policy':'strict-origin-when-cross-origin','x-content-type-options':'nosniff'}});
    }catch(error){return json({error:'FieldShift could not complete this request.'},500);}
  }
};
