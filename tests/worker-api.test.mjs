import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/entry.js';

function database(){
  const rows=new Map();
  return {rows,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return rows.get(args[0])||null;},async run(){rows.set(args[0],{email:args[1],data:args[2],updated_at:args[3]});return {success:true};}};}};
}
const auth={'oai-authenticated-user-id':'user-1','oai-authenticated-user-email':'farmer@example.com'};

test('anonymous visitors remain guests',async()=>{
  const response=await worker.fetch(new Request('https://fieldshift.test/api/me'),{DB:database()});
  assert.deepEqual(await response.json(),{authenticated:false});
});

test('signed-in workspaces save and restore per user',async()=>{
  const DB=database(),data={'fieldshift.location':'{"lat":10,"lon":20}'};
  const save=await worker.fetch(new Request('https://fieldshift.test/api/workspace',{method:'PUT',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({data})}),{DB});
  assert.equal(save.status,200);
  const load=await worker.fetch(new Request('https://fieldshift.test/api/workspace',{headers:auth}),{DB});
  assert.deepEqual((await load.json()).data,data);
  const other=await worker.fetch(new Request('https://fieldshift.test/api/workspace',{headers:{...auth,'oai-authenticated-user-id':'user-2'}}),{DB});
  assert.deepEqual((await other.json()).data,{});
});

test('workspace writes require authentication',async()=>{
  const response=await worker.fetch(new Request('https://fieldshift.test/api/workspace',{method:'PUT',headers:{'content-type':'application/json'},body:'{"data":{}}'}),{DB:database()});
  assert.equal(response.status,401);
});
