import {renderMarkdown,safeUrl} from './markdown.js';

const $=selector=>document.querySelector(selector);
const cards=[...document.querySelectorAll('[data-task]')],runButtons=[...document.querySelectorAll('[data-run]')];
const watches=new Map(),pending=new Set();
let state,selected=null,ticket=0,history=[];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,10000);}
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The local server is unavailable.');return data;}
async function api(url,body={}){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.csrf},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed.');return data;}
function settingsView(){
  const connected=state.connection.online;
  $('#connection-dot').classList.toggle('live',connected);
  $('#connection-label').textContent=state.connection.updateRequired?'Reload browser extension':connected?'Browser connection ready':'Browser extension offline';
  $('#setup-status').textContent=state.connection.updateRequired?'An extension update is ready. Click Reload on the Daily Desk extension in Chrome or Edge to apply the fixes.':connected?'Connected. New requests use your signed-in browser. Saved responses load locally.':'Install or reload the extension in your normal browser to sync chats or send today’s prompt. Saved reports still work.';
  $('#extension-path').textContent=state.connection.extensionPath;
}
async function refreshState(){state=await get('/api/state');settingsView();}
function setBusy(id,busy){if(busy)pending.add(id);else pending.delete(id);const button=runButtons.find(b=>b.dataset.run===id);if(button){button.disabled=busy;button.textContent=busy?'Request in progress…':'Run today';}if(selected===id)$('#sync-latest').disabled=busy;}
function progress(message,busy=false){$('#request-status').hidden=false;$('#request-status').textContent=message;$('#request-status').classList.toggle('working',busy);$('#output').setAttribute('aria-busy',String(busy));}
function showError(message){$('#notice').textContent=message;$('#notice').hidden=false;}
function render(result){
  const label=result.source==='chatgpt'?'ChatGPT response':result.source==='api-archive'?'Saved API reply':result.source==='imported'?'Earlier ChatGPT copy':'No response yet';
  const stamp=result.createdAt?date(result.createdAt):result.fetchedAt?'Synced '+date(result.fetchedAt):'';
  $('#output-meta').innerHTML='<span class="badge">'+label+'</span><span>'+escape(stamp)+'</span>';
  $('#output-meta').hidden=result.source==='empty';
  $('#notice').textContent=result.warning||'';$('#notice').hidden=!result.warning;
  const content=document.createElement('div');content.className='response-text';
  if(result.format==='plain'||(result.source==='chatgpt'&&result.format!=='markdown')){const plain=document.createElement('div');plain.className='plain';plain.textContent=result.text||'';content.append(plain);}else content.append(renderMarkdown(result.text));
  if(result.sources?.length){const links=document.createElement('div');links.className='response-sources';const seen=new Set();for(const source of result.sources){const url=safeUrl(source.url);if(!url||seen.has(url))continue;seen.add(url);const a=document.createElement('a');a.href=url;a.textContent=source.title||new URL(url).hostname;a.target='_blank';a.rel='noopener noreferrer';links.append(a,document.createTextNode(' · '));}content.append(links);}
  if(result.unavailable&&result.previous){const details=document.createElement('details');details.open=true;const summary=document.createElement('summary');summary.textContent='Earlier available reply — '+date(result.previous.createdAt);const body=document.createElement('div');if(result.previous.format==='plain'){body.className='plain';body.textContent=result.previous.text;}else body.append(renderMarkdown(result.previous.text));details.append(summary,body);content.append(details);}
  $('#response').replaceChildren(content);
}
async function loadHistory(id,viewTicket=ticket){const result=await get('/api/tasks/'+id+'/history');if(selected!==id||viewTicket!==ticket)return;history=result.items;const select=$('#history-select');select.replaceChildren();history.forEach((item,index)=>select.add(new Option(date(item.createdAt||item.fetchedAt)+(item.source==='api-archive'?' · API archive':''),String(index))));$('#history-label').hidden=!history.length;}
async function selectTask(id){
  const currentTicket=++ticket;selected=id;
  for(const card of cards)card.setAttribute('aria-pressed',String(card.dataset.task===id));
  $('#output-title').textContent=state.tasks.find(task=>task.id===id).title;
  $('#sync-latest').hidden=false;$('#sync-latest').disabled=pending.has(id);$('#notice').hidden=true;$('#history-label').hidden=true;$('#prompt-details').hidden=true;
  $('#response').textContent='Loading saved reply…';progress('Loading saved reply…',true);
  try{
    const result=await api('/api/tasks/'+id+'/saved');if(currentTicket!==ticket)return;
    render(result);progress('Saved reply.');
    await loadHistory(id,currentTicket);
    const prompt=await get('/api/tasks/'+id+'/prompt');if(currentTicket!==ticket)return;
    $('#task-prompt').textContent=prompt.prompt;$('#prompt-details').hidden=false;
    const job=state.jobs.find(item=>item.taskId===id);
    if(job)void watch(job);
    else if(state.lastRuns?.[id]?.stage==='error'){showError(state.lastRuns[id].error);progress('The last request could not complete.');}
  }catch(error){if(currentTicket===ticket){showError(error.message);progress('Could not load the saved response.');}}
}
function stageText(job){return ({queued:'Waiting for the browser…',loading:'Loading the linked chat in the background…',sending:'Sending “Try again today”…',sent:'“Try again today” was sent. Waiting for the new reply…',reading:'Reading the latest completed reply…',waiting:'Waiting for ChatGPT to finish…'})[job.stage]||'Checking progress…';}
function watch(job){
  if(watches.has(job.id))return watches.get(job.id);
  const watching=(async()=>{
    setBusy(job.taskId,true);
    try{
      while(!['complete','error'].includes(job.stage)){if(selected===job.taskId)progress(stageText(job),true);await new Promise(resolve=>setTimeout(resolve,800));job=await get('/api/jobs/'+job.id);}
      if(selected===job.taskId){if(job.stage==='complete'){render(job.result);progress(job.action==='retry'?'New reply received.':'Response is up to date.');await loadHistory(job.taskId);}else{showError(job.error);progress('The request could not complete.');}}
    }catch(error){if(selected===job.taskId){showError(error.message+' Refresh the dashboard to resume checking.');progress('Connection interrupted.');}}
    finally{setBusy(job.taskId,false);watches.delete(job.id);void refreshState().catch(()=>{});}
  })();watches.set(job.id,watching);return watching;
}
async function runTask(id,action='run'){
  if(pending.has(id))return;setBusy(id,true);
  try{await selectTask(id);const job=await api('/api/tasks/'+id+'/'+action);await refreshState();await watch(job);}
  catch(error){if(selected===id){showError(error.message);progress('The request could not start.');}setBusy(id,false);}
}
$('#connect').addEventListener('click',()=>{const help=$('#connection-help');help.hidden=!help.hidden;$('#connect').setAttribute('aria-expanded',String(!help.hidden));});
$('#copy-extension').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.connection.extensionPath);toast('Extension folder copied.');}catch{toast('Select and copy the folder path shown above.');}});
$('#reset-connection').addEventListener('click',async()=>{try{await api('/api/bridge/reset');await refreshState();toast('Browser pairing reset. Reload the intended Daily Desk extension.');}catch(error){toast(error.message);}});
$('#sync-latest').addEventListener('click',()=>selected&&runTask(selected,'read'));
$('#history-select').addEventListener('change',()=>{const result=history[Number($('#history-select').value)];if(result){render(result);progress('Saved reply.');}});
for(const card of cards)card.addEventListener('click',()=>selectTask(card.dataset.task));
for(const button of runButtons)button.addEventListener('click',()=>runTask(button.dataset.run));
const today=new Date();$('#day').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long'}).format(today).toUpperCase();$('#date').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'long',day:'numeric'}).format(today);
try{
  await refreshState();for(const job of state.jobs)void watch(job);
  setInterval(()=>refreshState().catch(()=>{$('#connection-label').textContent='Local server unavailable';}),3000);
  if(location.pathname==='/setup'){$('#connection-help').hidden=false;$('#connect').setAttribute('aria-expanded','true');}
}catch(error){for(const button of [...cards,...runButtons])button.disabled=true;toast(error.message);}
