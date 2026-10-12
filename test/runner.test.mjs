import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRunner,safeError} from '../src/runner.mjs';
const settings={apiKey:()=> 'fixture-key',model:()=> 'gpt-5.4',secrets:{accountNumber:'12345'}};
const prompts={robinhood:'Research a stock. Never spend over $20.',briefing:'Daily briefing',iphone:'Find deals'};
const finished={id:'resp_finished',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Finished report.',annotations:[]}]}]};
async function settle(runner,id,stage='complete'){
  for(let i=0;i<150;i++){const job=runner.getJob(id);if(job.stage===stage||job.stage==='error')return job;await new Promise(r=>setTimeout(r,5));}
  throw new Error('Runner did not settle.');
}
test('a saved response ID resumes after a server restart without another creation',async()=>{
  const privateDir=await mkdtemp(path.join(os.tmpdir(),'daily-desk-resume-'));
  let creations=0,hold=true;
  const fake={conversations:{create:async()=>({id:'conv_resume'})},responses:{create:async()=>{creations++;return creations===1?{id:'resp_resume',status:'queued',output:[]}:finished;},retrieve:async()=>hold?{id:'resp_resume',status:'in_progress',output:[]}:{...finished,id:'resp_resume',output:[{type:'web_search_call',status:'completed'},...finished.output]}}};
  const options={privateDir,settings,prompts,robinhood:{token:async()=> 'fixture-rh'},clientFactory:()=>fake,pollMs:5};
  const first=await createRunner(options);const job=await first.start('briefing');
  for(let i=0;i<100&&!first.getJob(job.id).responseId;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(first.getJob(job.id).responseId,'resp_resume');first.close();await new Promise(r=>setTimeout(r,15));hold=false;
  const second=await createRunner(options);
  assert.equal((await settle(second,job.id)).stage,'complete');assert.equal(creations,2);assert.equal(second.history('briefing').length,1);second.close();
});
test('a broker-reviewed order pauses on the website and duplicate approvals cannot submit twice',async()=>{
  const privateDir=await mkdtemp(path.join(os.tmpdir(),'daily-desk-approval-'));
  const calls=[],args={account_number:'12345',symbol:'ABC',side:'buy',type:'market',dollar_amount:'20',market_hours:'regular_hours',time_in_force:'gfd'};
  const preview={data:{symbol:'ABC',side:'buy',quote_data:{last_trade_price:'10'},order_checks:{},market_data_disclosure:'Exact broker disclosure.'}};
  const fake={conversations:{create:async()=>({id:'conv_order'})},responses:{
    create:async body=>{
      calls.push(body);const refId=body.instructions.match(/ref_id ([a-f0-9-]+)\./)[1];
      if(calls.length===1)return {id:'resp_review_request',status:'completed',output:[{type:'mcp_approval_request',id:'approval_review',server_label:'robinhood',name:'review_equity_order',arguments:JSON.stringify(args)}]};
      if(calls.length===2)return {id:'resp_review_result',status:'completed',output:[{type:'mcp_call',name:'review_equity_order',arguments:JSON.stringify(args),output:JSON.stringify(preview)},{type:'mcp_approval_request',id:'approval_place',server_label:'robinhood',name:'place_equity_order',arguments:JSON.stringify({...args,ref_id:refId})}]};
      return finished;
    }
  }};
  const runner=await createRunner({privateDir,settings,prompts,robinhood:{token:async()=> 'fixture-rh'},clientFactory:()=>fake,pollMs:5,now:()=>new Date('2026-10-09T16:00:00Z')});
  const started=await runner.start('robinhood');const job=await settle(runner,started.id,'approval');
  assert.equal(job.stage,'approval');assert.equal(job.approval.disclosure,'Exact broker disclosure.');assert.equal(calls.length,2);
  assert.equal((await runner.start('robinhood')).id,job.id);
  const decisions=await Promise.allSettled([runner.approve(job.id,{approvalId:'approval_place',approve:true}),runner.approve(job.id,{approvalId:'approval_place',approve:true})]);
  assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await settle(runner,job.id)).stage,'complete');assert.equal(calls.length,3);
  assert.deepEqual(calls[2].input,[{type:'mcp_approval_response',approval_request_id:'approval_place',approve:true}]);runner.close();
});
test('background credit failures give an actionable billing error',async()=>{
  const privateDir=await mkdtemp(path.join(os.tmpdir(),'daily-desk-credit-'));
  const fake={conversations:{create:async()=>({id:'conv_credit'})},responses:{create:async()=>({id:'resp_credit',status:'failed',output:[],error:{code:'credit_balance_exhausted',message:'Provider detail'}})}};
  const runner=await createRunner({privateDir,settings,prompts,robinhood:{},clientFactory:()=>fake,pollMs:5});
  const job=await settle(runner,(await runner.start('briefing')).id);
  assert.equal(job.stage,'error');assert.match(job.error,/no credits available/);assert.equal(runner.latest('briefing'),null);
  assert.match(safeError({code:'insufficient_quota'}),/Add API credit/);runner.close();
});
