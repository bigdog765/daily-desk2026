import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {createDashboard} from '../server.mjs';
const base='http://127.0.0.1:4318',extensionOrigin='chrome-extension://'+'a'.repeat(32);
let app,state,folder,ws;const received=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<200;i++){const value=await predicate();if(value)return value;await wait(10);}throw new Error('Condition not reached.');}
const get=async route=>(await fetch(base+route)).json();
const post=(route,body={},headers={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Dashboard-Token':state.csrf,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function connect(){
  const response=await post('/api/bridge/bootstrap',{}, {Origin:extensionOrigin,'X-Daily-Desk-Bridge':'1'});assert.equal(response.status,200);
  const config=await response.json();
  ws=new WebSocket(config.socket,[config.protocol,config.token],{headers:{Origin:extensionOrigin}});
  ws.on('message',data=>received.push(JSON.parse(data)));await new Promise(resolve=>ws.once('open',resolve));
  ws.send(JSON.stringify({type:'hello',version:'2.0.0'}));await until(async()=>(await get('/api/state')).connection.online);
  return config;
}
before(async()=>{
  folder=await mkdtemp(path.join(os.tmpdir(),'daily-desk-extension-'));
  await writeFile(path.join(folder,'api-state.json'),JSON.stringify({tasks:{briefing:{history:[{responseId:'old-api',text:'Saved API report',source:'api'}]}}}));
  await writeFile(path.join(folder,'extension-state.json'),JSON.stringify({tasks:{robinhood:{history:[{id:'retired-report',text:'Preserve my Robinhood archive'}]}},jobs:[],pairedOrigin:null}));
  app=await createDashboard({port:4318,privateDir:folder});await new Promise(resolve=>app.server.listen(4318,'127.0.0.1',resolve));state=await get('/api/state');
});
after(async()=>{ws?.terminate();await app.close();});

test('dashboard preserves prior replies locally and disables every API generation entry point',async()=>{
  assert.equal(state.connection.mode,'extension');assert.equal(state.connection.apiEnabled,false);
  assert.equal(state.tasks.length,2);assert.equal(state.connection.online,false);
  const saved=await (await post('/api/tasks/briefing/saved')).json();assert.equal(saved.text,'Saved API report');assert.equal(saved.source,'api-archive');
  for(const route of ['/api/settings','/api/initialize','/api/robinhood/connect','/api/robinhood/disconnect'])assert.equal((await post(route)).status,410);
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.dependencies.openai,undefined);
});
test('offline requests fail without queuing a prompt for later',async()=>{
  const response=await post('/api/tasks/briefing/run');assert.equal(response.status,400);assert.match((await response.json()).error,/offline/);
  assert.equal((await get('/api/state')).jobs.length,0);
});
test('CSRF, private assets, and extension authentication are enforced',async()=>{
  assert.equal((await post('/api/tasks/briefing/run',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await post('/api/tasks/briefing/run',{}, {'X-Dashboard-Token':''})).status,403);
  assert.equal((await post('/api/bridge/bootstrap',{}, {'X-Daily-Desk-Bridge':'1'})).status,403);
  for(const route of ['/.local/api-state.json','/.local/extension-state.json','/src/bridge.mjs','/extension/background.js'])assert.equal((await fetch(base+route)).status,404);
  await connect();
  assert.equal((await post('/api/bridge/bootstrap',{}, {Origin:'chrome-extension://'+'b'.repeat(32),'X-Daily-Desk-Bridge':'1'})).status,403);
});
test('duplicate run clicks send one exact task; sent status and new report persist',async()=>{
  const before=received.filter(message=>message.type==='job').length;
  const [one,two]=await Promise.all([post('/api/tasks/iphone/run'),post('/api/tasks/iphone/run')].map(async value=>(await value).json()));
  assert.equal(one.id,two.id);
  const command=await until(()=>received.find(message=>message.type==='job'&&message.id===one.id));
  assert.equal(command.taskId,'iphone');assert.equal(command.action,'retry');
  assert.equal(received.filter(message=>message.type==='job').length,before+1);
  ws.send(JSON.stringify({type:'progress',id:one.id,stage:'sending'}));
  await until(async()=>(await get('/api/jobs/'+one.id)).submitted==='unknown');
  ws.send(JSON.stringify({type:'progress',id:one.id,stage:'sent'}));
  await until(async()=>(await get('/api/jobs/'+one.id)).submitted===true);
  ws.send(JSON.stringify({type:'result',id:one.id,ok:true,result:{chatId:state.tasks.find(task=>task.id==='iphone').chatId,text:'A new ChatGPT reply',sources:[{title:'Unsafe',url:'javascript:alert(1)'},{title:'Source',url:'https://example.com/deal'}]}}));
  const done=await until(async()=>{const job=await get('/api/jobs/'+one.id);return job.stage==='complete'&&job;});
  assert.equal(done.result.text,'A new ChatGPT reply');assert.equal(done.result.sources.length,1);assert.equal(done.result.source,'chatgpt');
  const saved=JSON.parse(await readFile(path.join(folder,'extension-state.json'),'utf8'));assert.equal(saved.jobs.at(-1).submitted,true);
  await until(()=>received.some(message=>message.type==='ack'&&message.id===one.id));
});
test('sync sends no prompt, de-duplicates the same reply, and rejects a mismatched chat',async()=>{
  const before=(await get('/api/tasks/iphone/history')).items.length;
  const job=await (await post('/api/tasks/iphone/read')).json();await until(()=>received.find(message=>message.id===job.id));
  assert.equal(received.find(message=>message.id===job.id).action,'read');
  ws.send(JSON.stringify({type:'result',id:job.id,ok:true,result:{chatId:state.tasks.find(task=>task.id==='iphone').chatId,text:'A new ChatGPT reply'}}));
  await until(async()=>(await get('/api/jobs/'+job.id)).stage==='complete');
  assert.equal((await get('/api/tasks/iphone/history')).items.length,before);
  const bad=await (await post('/api/tasks/iphone/read')).json();await until(()=>received.find(message=>message.id===bad.id));
  ws.send(JSON.stringify({type:'result',id:bad.id,ok:true,result:{chatId:'wrong-chat',text:'Do not save'}}));
  await until(async()=>(await get('/api/jobs/'+bad.id)).stage==='error');
  assert.equal((await (await post('/api/tasks/iphone/saved')).json()).text,'A new ChatGPT reply');
});
test('uncertain send is not replayed after a server restart; saved reports and pairing survive',async()=>{
  const job=await (await post('/api/tasks/briefing/run')).json();await until(()=>received.find(message=>message.id===job.id));
  ws.send(JSON.stringify({type:'progress',id:job.id,stage:'sending'}));await until(async()=>(await get('/api/jobs/'+job.id)).submitted==='unknown');
  await app.close();ws.terminate();
  app=await createDashboard({port:4318,privateDir:folder});await new Promise(resolve=>app.server.listen(4318,'127.0.0.1',resolve));state=await get('/api/state');
  const restored=await get('/api/jobs/'+job.id);assert.equal(restored.stage,'error');assert.match(restored.error,/not resent/);assert.equal(restored.submitted,'unknown');
  const count=received.filter(message=>message.type==='job').length;await connect();await wait(30);
  assert.equal(received.filter(message=>message.type==='job').length,count);
  assert.equal((await (await post('/api/tasks/iphone/saved')).json()).text,'A new ChatGPT reply');
});

test('retired Robinhood routes cannot read or dispatch chat requests, even with an older connected extension',async()=>{
  const count=received.filter(message=>message.type==='job').length;
  for(const action of ['run','retry','read','refresh','saved'])assert.equal((await post('/api/tasks/robinhood/'+action)).status,404);
  for(const action of ['history','prompt'])assert.equal((await fetch(base+'/api/tasks/robinhood/'+action)).status,404);
  assert.equal(received.filter(message=>message.type==='job').length,count);
  await assert.rejects(app.bridge.start('robinhood','retry'),/Unknown task/);
  const stored=JSON.parse(await readFile(path.join(folder,'extension-state.json'),'utf8'));
  assert.equal(stored.tasks.robinhood.history[0].text,'Preserve my Robinhood archive');
});
