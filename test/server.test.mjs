import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDashboard} from '../server.mjs';
import {orderCheck} from '../src/trading-policy.mjs';
import {createRobinhood} from '../src/robinhood.mjs';
import {createSettings} from '../src/settings.mjs';
const base='http://127.0.0.1:4318';
let app,state,mode='normal',privateDir;
const calls=[],responses=new Map(),conversations=new Map();
const fakeClient={
  models:{retrieve:async()=>({id:'gpt-5.4-mini'})},
  conversations:{create:async({metadata})=>{const id='conv_'+metadata.task;conversations.set(id,metadata.task);return {id};}},
  responses:{
    create:async body=>{
      calls.push(body);
      if(mode==='error'){const error=new Error('secret must not escape');error.status=401;throw error;}
      const id='resp_'+calls.length;
      const task=conversations.get(body.conversation);
      const text=task==='iphone'?'NO_STANDOUT_DEAL':'Fresh report with source.';
      const response={id,status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:task==='iphone'?[]:[{type:'url_citation',start_index:18,end_index:24,url:'https://example.com/news',title:'Source'}]}]}],usage:{input_tokens:10,output_tokens:20}};
      responses.set(id,response);return {id,status:'queued',output:[]};
    },
    retrieve:async id=>responses.get(id)
  }
};
before(async()=>{
  privateDir=await mkdtemp(path.join(os.tmpdir(),'daily-desk-api-test-'));
  app=await createDashboard({port:4318,privateDir,env:{OPENAI_API_KEY:'sk-fixture-api-key-which-must-stay-private'},clientFactory:()=>fakeClient,pollMs:15});
  await new Promise(resolve=>app.server.listen(4318,'127.0.0.1',resolve));
  state=await (await fetch(base+'/api/state')).json();
});
after(()=>app.close());
const post=(route,body={},headers={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Dashboard-Token':state.csrf,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function finished(id){
  for(let i=0;i<100;i++){const job=await (await fetch(base+'/api/jobs/'+id)).json();if(['complete','error','approval'].includes(job.stage))return job;await new Promise(r=>setTimeout(r,10));}
  throw new Error('Test job did not finish');
}
test('API state exposes the three tasks and never the key',()=>{
  assert.deepEqual(state.tasks.map(t=>t.id),['robinhood','briefing','iphone']);
  assert.equal(state.connection.mode,'api');assert.equal(state.connection.keyAvailable,true);
  assert.ok(!JSON.stringify(state).includes('sk-fixture'));assert.equal(state.connection.robinhoodConnected,false);
});
test('creates three distinct persistent conversations and reuses them',async()=>{
  for(let i=0;i<2;i++){const response=await post('/api/initialize');assert.equal(response.status,200);const data=await response.json();assert.equal(new Set(Object.values(data.conversations)).size,3);}
  assert.equal(conversations.size,3);
});
test('legacy copies are explicitly labelled and reading does not invoke a model',async()=>{
  const before=calls.length;const response=await post('/api/tasks/briefing/saved');const data=await response.json();
  assert.equal(data.source,'legacy');assert.match(data.warning,/Previous ChatGPT/);assert.equal(calls.length,before);
});
test('blocks cross-origin requests and retired extension routes',async()=>{
  assert.equal((await post('/api/tasks/briefing/run',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await post('/api/tasks/briefing/run',{}, {'X-Dashboard-Token':''})).status,403);
  assert.equal((await post('/api/bridge/bootstrap')).status,404);
  assert.equal((await post('/api/tasks/briefing/cache')).status,404);
  for(const url of ['/.local/credentials.dpapi','/prompts/robinhood.md','/src/runner.mjs'])assert.equal((await fetch(base+url)).status,404);
});
test('duplicate clicks share one research/write run; subsequent runs keep conversation history',async()=>{
  const before=calls.length;
  const jobs=await Promise.all([post('/api/tasks/briefing/run'),post('/api/tasks/briefing/run')].map(async p=>(await p).json()));
  assert.equal(jobs[0].id,jobs[1].id);
  const job=await finished(jobs[0].id);assert.equal(job.stage,'complete');assert.equal(calls.length,before+2);
  assert.equal(job.conversationId,'conv_briefing');assert.equal(job.result.source,'api');assert.match(job.result.text,/\[Source\]/);
  assert.ok(calls.at(-1).instructions.includes('Detroit or Royal Oak'));assert.ok(calls.at(-2).tools.some(t=>t.type==='web_search'));
  assert.deepEqual(calls.at(-1).tools,[]);assert.equal(calls.at(-1).tool_choice,'none');
  const next=await (await post('/api/tasks/briefing/run')).json();await finished(next.id);
  const history=await (await fetch(base+'/api/tasks/briefing/history')).json();assert.equal(history.items.length,2);
  assert.equal(calls.at(-1).conversation,'conv_briefing');
  const count=calls.length;await post('/api/tasks/briefing/saved');assert.equal(calls.length,count);
});
test('iPhone quiet checks do not turn into deal alerts',async()=>{
  const job=await finished((await (await post('/api/tasks/iphone/run')).json()).id);
  assert.equal(job.stage,'complete');assert.equal(job.result.quiet,true);assert.match(job.result.text,/No new standout/);
  assert.ok(calls.at(-1).instructions.includes('bill-credit duration'));
});
test('Robinhood requires its own connection and does not fabricate a report',async()=>{
  const count=calls.length;const job=await finished((await (await post('/api/tasks/robinhood/run')).json()).id);
  assert.equal(job.stage,'error');assert.match(job.error,/Connect Robinhood/);assert.equal(calls.length,count);
});
test('API authentication failures are explicit and are not resubmitted',async()=>{
  mode='error';const count=calls.length;
  const job=await finished((await (await post('/api/tasks/briefing/run')).json()).id);
  assert.equal(job.stage,'error');assert.match(job.error,/API key was rejected/);assert.ok(!job.error.includes('secret'));assert.equal(calls.length,count+1);mode='normal';
});
test('order gate enforces amount, side, account, exact preview and single attempt',()=>{
  const args={account_number:'12345',symbol:'ABC',side:'buy',type:'market',dollar_amount:'20',market_hours:'regular_hours',time_in_force:'gfd'};
  const context={accountNumber:'12345'};
  assert.equal(orderCheck(args,context),null);
  for(const change of [{side:'sell'},{dollar_amount:'20.01'},{dollar_amount:'-2'},{account_number:'54321'},{market_hours:'extended_hours'},{time_in_force:'gtc'},{type:'stop_market'},{quantity:'1'},{tax_lots:[]}])assert.ok(orderCheck({...args,...change},context));
  assert.ok(orderCheck(args,{...context,orderConsumed:true}));
  const output=JSON.stringify({data:{symbol:'ABC',side:'buy',quote_data:{last_trade_price:'10'},order_checks:{},market_data_disclosure:'Quote disclosure as supplied by the broker.'}});
  const placement={...context,placement:true,refId:'fixed-id',review:{args,output,receivedAt:Date.now()},now:new Date('2026-10-09T16:00:00Z')};
  assert.equal(orderCheck({...args,ref_id:'fixed-id'},placement),null);
  assert.ok(orderCheck({...args,symbol:'OTHER',ref_id:'fixed-id'},placement));
  assert.ok(orderCheck({...args,ref_id:'other'},placement));
  assert.ok(orderCheck({...args,ref_id:'fixed-id'},{...placement,now:new Date('2026-10-10T16:00:00Z')}));
  assert.ok(orderCheck({...args,ref_id:'fixed-id'},{...placement,review:{...placement.review,output:'{"isError":true}'}}));
});
test('OAuth uses PKCE, validates state, and renews credentials',async()=>{
  const settings={secrets:{},saveSecrets:async()=>{}},requests=[];
  const request=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/register')?{client_id:'test-client'}:{access_token:'test-token',refresh_token:'test-refresh',expires_in:60}};};
  const broker=await createRobinhood(settings,base,{request});
  const url=new URL((await broker.connect()).url);
  assert.equal(url.origin,'https://robinhood.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.notEqual(url.searchParams.get('code_challenge'),settings.secrets.robinhoodPending.verifier);
  await assert.rejects(()=>broker.callback(new URLSearchParams({state:'wrong',code:'unused'})),/did not match/);
  await broker.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'test-code'}));
  assert.equal(await broker.token(),'test-token');assert.ok(requests.some(r=>String(r.options.body).includes('grant_type=refresh_token')));
});
test('saved credentials survive a restart without plaintext in the Windows file',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'daily-desk-key-test-'));
  const one=await createSettings(folder,{env:{}});await one.update({apiKey:'sk-dummy-test-key-not-a-real-secret'});
  const two=await createSettings(folder,{env:{}});assert.equal(two.apiKey(),'sk-dummy-test-key-not-a-real-secret');
  assert.ok(!JSON.stringify(two.public()).includes('sk-dummy'));
  if(process.platform==='win32')assert.ok(!(await readFile(path.join(folder,'credentials.dpapi'))).includes(Buffer.from('sk-dummy')));
});

