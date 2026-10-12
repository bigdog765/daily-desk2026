import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRunner} from '../src/runner.mjs';

const settings={apiKey:()=> 'fixture-private-key',model:()=> 'gpt-5.4-mini',secrets:{}};
const prompts={briefing:'Current local news.',iphone:'Current deals.',robinhood:'Research safely.'};
const usage={input_tokens:100,output_tokens:60,total_tokens:160,output_tokens_details:{reasoning_tokens:40}};
const message=(id,text,extra={})=>({id,status:'completed',output:[{type:'message',content:[{type:'output_text',text,annotations:[]}]}],usage,...extra});
const research=(id,text)=>{const response=message(id,text);response.output.push({type:'web_search_call',status:'completed'});return response;};
const cutShort={id:'resp_research',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},error:null,max_output_tokens:6000,max_tool_calls:6,usage,output:[{type:'web_search_call',status:'completed'},{type:'web_search_call',status:'searching'}]};
async function waitFor(runner,id,predicate=job=>['complete','error'].includes(job.stage)){
  for(let i=0;i<200;i++){const job=runner.getJob(id);if(predicate(job))return job;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('Run did not reach expected state.');
}
async function fixture(t,create,retrieve){
  const privateDir=await mkdtemp(path.join(os.tmpdir(),'daily-desk-research-'));
  const calls=[];
  const client={conversations:{create:async()=>({id:'conv_fixture'})},responses:{create:async body=>{calls.push(body);return create(body,calls.length);},retrieve}};
  const options={privateDir,settings,prompts,robinhood:{token:async()=> 'fixture-broker'},clientFactory:()=>client,pollMs:5};
  const runner=await createRunner(options);t.after(()=>runner.close());
  return {runner,calls,privateDir,options};
}

test('token exhaustion during research gets exactly one tool-free writing step and complete diagnostics',async t=>{
  const {runner,calls,privateDir}=await fixture(t,(_body,n)=>n===1?cutShort:message('resp_report','Verified items; research coverage was limited.'));
  const job=await waitFor(runner,(await runner.start('briefing')).id);
  assert.equal(job.stage,'complete');assert.equal(calls.length,2);
  assert.equal(calls[0].max_tool_calls,6);assert.equal(calls[0].reasoning.effort,'low');
  assert.equal(calls[0].tool_choice,'required');
  assert.equal(calls[1].conversation,calls[0].conversation);assert.equal(calls[1].tool_choice,'none');assert.deepEqual(calls[1].tools,[]);
  assert.equal(calls[1].max_output_tokens,6000);assert.match(calls[1].input[0].content,/cut short/);
  assert.match(job.result.warning,/some checks may be missing/);assert.equal(job.toolCount,2);
  assert.equal(job.diagnostics[0].incompleteReason,'max_output_tokens');assert.equal(job.diagnostics[0].completedToolCalls,1);
  assert.equal(job.diagnostics[0].outputTextCharacters,0);assert.equal(job.diagnostics[1].phase,'report');
  assert.equal(job.result.usage.output_tokens,120);assert.equal(job.result.usage.output_tokens_details.reasoning_tokens,80);
  const saved=JSON.parse(await readFile(path.join(privateDir,'api-state.json'),'utf8'));
  assert.deepEqual(saved.jobs[0].diagnostics,job.diagnostics);assert.ok(!JSON.stringify(job).includes('fixture-private-key'));
  assert.equal(runner.history('briefing').length,1);
});

test('successful research hands citation URLs to writing and saves only the final report',async t=>{
  const notes=research('resp_notes','Current facts. [citation]');
  notes.output[0].content[0].annotations=[{type:'url_citation',start_index:15,end_index:25,url:'https://example.com/current',title:'Current source'}];
  const {runner,calls}=await fixture(t,(_body,n)=>n===1?notes:message('resp_written','Final report [source](https://example.com/current).'));
  const job=await waitFor(runner,(await runner.start('briefing')).id);
  assert.equal(job.stage,'complete');assert.equal(job.result.warning,undefined);
  assert.match(calls[1].input[0].content,/https:\/\/example.com\/current/);
  assert.equal(runner.history('briefing').length,1);assert.match(runner.latest('briefing').text,/Final report/);
});

test('writing exhaustion stops after two requests, logs exact reason, and preserves previous report',async t=>{
  const {runner,calls,privateDir}=await fixture(t,(_body,n)=>n===1?research('resp_notes','Evidence'):({...cutShort,id:'resp_write',output:message('partial','Partial answer').output}));
  const prior={responseId:'resp_previous',text:'Previous complete report'};
  // History is live local state; seed a prior report without invoking the API.
  runner.history('briefing').push(prior);
  const job=await waitFor(runner,(await runner.start('briefing')).id);
  assert.equal(job.stage,'error');assert.match(job.error,/writing step.*token limit/);assert.equal(calls.length,2);
  assert.equal(runner.latest('briefing').responseId,'resp_previous');assert.equal(runner.history('briefing').length,1);
  assert.equal(job.diagnostics.at(-1).phase,'report');assert.ok(job.diagnostics.at(-1).outputTextCharacters>0);
  const saved=JSON.parse(await readFile(path.join(privateDir,'api-state.json'),'utf8'));
  assert.equal(saved.jobs[0].diagnostics.at(-1).incompleteReason,'max_output_tokens');
});

test('incomplete content-filter and billing failures never trigger a writing recovery',async t=>{
  for(const response of [{...cutShort,incomplete_details:{reason:'content_filter'}},{...cutShort,status:'failed',error:{code:'credit_balance_exhausted',message:'private provider content'}}]){
    const {runner,calls}=await fixture(t,()=>response);
    const job=await waitFor(runner,(await runner.start('briefing')).id);
    assert.equal(job.stage,'error');assert.equal(calls.length,1);assert.equal(runner.latest('briefing'),null);
    assert.ok(!JSON.stringify(job).includes('private provider content'));
  }
});

test('iPhone completed research can stay quiet; exhausted research cannot falsely claim no deals',async t=>{
  for(const limited of [false,true]){
    const {runner,calls}=await fixture(t,(_body,n)=>n===1?(limited?cutShort:research('resp_notes','NO_STANDOUT_DEAL')):message('resp_report','NO_STANDOUT_DEAL'));
    const job=await waitFor(runner,(await runner.start('iphone')).id);
    assert.equal(calls[0].max_tool_calls,8);
    assert.equal(job.stage,limited?'error':'complete');
    if(limited){assert.match(job.error,/could not be confirmed/);assert.equal(runner.latest('iphone'),null);}
    else assert.equal(job.result.quiet,true);
  }
});

test('restart while writing resumes the saved response without redoing research or writing',async t=>{
  let hold=true;
  const {runner,calls,options,privateDir}=await fixture(t,(_body,n)=>n===1?cutShort:{id:'resp_write',status:'queued',output:[]},async()=>hold?{id:'resp_write',status:'in_progress',output:[]}:message('resp_write','Finished with limited coverage.'));
  const start=await runner.start('briefing');
  await waitFor(runner,start.id,job=>job.phase==='report'&&job.responseId==='resp_write');
  assert.equal((await runner.start('briefing')).id,start.id);
  runner.close();await new Promise(resolve=>setTimeout(resolve,25));hold=false;
  const resumed=await createRunner(options);t.after(()=>resumed.close());
  const job=await waitFor(resumed,start.id);
  assert.equal(job.stage,'complete');assert.equal(calls.length,2);assert.equal(job.diagnostics.length,2);
  assert.equal(job.result.usage.output_tokens,120);assert.match(job.result.warning,/Research reached/);
  assert.equal(resumed.history('briefing').length,1);
  // A crash after reserving a POST but before its response ID is confirmed must not replay it.
  resumed.close();await new Promise(resolve=>setTimeout(resolve,25));
  const saved=JSON.parse(await readFile(path.join(privateDir,'api-state.json'),'utf8'));
  saved.jobs[0].stage='writing';saved.jobs[0].responseId=null;
  await writeFile(path.join(privateDir,'api-state.json'),JSON.stringify(saved));
  const uncertain=await createRunner(options);t.after(()=>uncertain.close());
  assert.equal(uncertain.getJob(start.id).stage,'error');assert.equal(calls.length,2);
});

test('Robinhood incomplete responses log diagnostics without replaying broker actions',async t=>{
  const {runner,calls}=await fixture(t,()=>({...cutShort,output:[{type:'mcp_call',name:'place_equity_order',status:'completed'}]}));
  const job=await waitFor(runner,(await runner.start('robinhood')).id);
  assert.equal(job.stage,'error');assert.equal(calls.length,1);assert.equal(job.diagnostics[0].phase,'execution');
  assert.equal(job.diagnostics[0].toolCalls,1);assert.equal(runner.latest('robinhood'),null);
});

test('a report without a completed fresh search cannot become a new daily result',async t=>{
  for(const output of [[],[{type:'web_search_call',status:'failed'}]]){
    const {runner,calls}=await fixture(t,()=>message('resp_stale','An old report.',{output}));
    const job=await waitFor(runner,(await runner.start('briefing')).id);
    assert.equal(job.stage,'error');assert.match(job.error,/No fresh web research completed/);
    assert.equal(calls.length,1);assert.equal(runner.latest('briefing'),null);
  }
});
