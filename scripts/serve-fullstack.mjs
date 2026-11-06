// Local development uses a real SQLite database; production uses hosted D1.
import {createServer} from 'node:http';
import {readFile,mkdir,readdir,stat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleAccountApi} from '../worker/account-api.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(resolve(root,'.local'),{recursive:true});
const sqlite=new DatabaseSync(resolve(root,'.local/fieldshift.sqlite'));
sqlite.exec('PRAGMA foreign_keys=ON');
for(const name of (await readdir(resolve(root,'migrations'))).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(await readFile(resolve(root,'migrations',name),'utf8'));
const DB={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);},async all(){return {results:statement.all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const env={DB,GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET};
const dist=resolve(root,'dist'),port=Number(process.env.PORT||4173);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://'+req.headers.host);if(url.pathname.startsWith('/api/')){const buffers=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1100000){res.writeHead(413);res.end();return;}buffers.push(chunk);}const response=await handleAccountApi(new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(buffers)}),env);if(!response){res.writeHead(404);res.end();return;}response.headers.forEach((value,key)=>{if(key!=='set-cookie')res.setHeader(key,value);});res.setHeader('set-cookie',response.headers.getSetCookie());res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()));return;}
let file=resolve(dist,'.'+decodeURIComponent(url.pathname));if(file!==dist&&!file.startsWith(dist+sep)){res.writeHead(403);res.end();return;}if((await stat(file)).isDirectory())file=resolve(file,'index.html');res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(500);res.end('Unable to complete the request.');}}).listen(port,'127.0.0.1',()=>console.log('FieldShift with real local accounts: http://127.0.0.1:'+port));
