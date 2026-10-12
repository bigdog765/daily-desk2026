const $=selector=>document.querySelector(selector);
const cards=[...document.querySelectorAll('[data-task]')],runButtons=[...document.querySelectorAll('[data-run]')];
const watches=new Map(),pending=new Set();
let state,selected=null,ticket=0,history=[],pendingApproval=null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';
function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!['chatgpt.com','chat.openai.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host))?url.href:null;}catch{return null;}}
function inline(text){
  return escape(text).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_match,label,value)=>{
    const url=safeUrl(value.replace(/&amp;/g,'&'));return url?'<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':label;
  }).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
}
function markdown(text){
  return String(text).split(/\n\s*\n/).map(block=>{
    if(/^#{1,3} /.test(block)){const [,marks,value]=block.match(/^(#{1,3}) ([\s\S]*)$/);const level=Math.max(2,marks.length);return '<h'+level+'>'+inline(value)+'</h'+level+'>';}
    if(block.split('\n').every(line=>/^[-*] /.test(line)))return '<ul>'+block.split('\n').map(line=>'<li>'+inline(line.slice(2))+'</li>').join('')+'</ul>';
    if(/^---+$/.test(block.trim()))return '<hr>';
    return '<p>'+inline(block).replace(/\n/g,'<br>')+'</p>';
  }).join('');
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,12000);}
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The local server is unavailable.');return data;}
async function api(url,body={}){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.csrf},body:JSON.stringify(body),signal:AbortSignal.timeout(url==='/api/initialize'?90000:35000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed.');return data;
}
function settingsView(){
  const connection=state.connection;
  $('#connection-dot').classList.toggle('live',connection.keyAvailable);
  $('#connection-label').textContent=connection.keyAvailable?'OpenAI API configured':'Add an API key';
  $('#setup-status').textContent=connection.keyAvailable?'API key available from '+connection.keySource+'. Your three tasks use separate API conversations.':'Add your OpenAI API key to run the tasks.';
  $('#broker-status').textContent=connection.robinhoodConnected?'Robinhood connected'+(connection.accountNumber?' · Account '+connection.accountNumber:'. Select a brokerage account before submitting a buy.'):'Robinhood needs its own one-time sign-in.';
  $('#connect-robinhood').textContent=connection.robinhoodConnected?'Reconnect Robinhood':'Connect Robinhood';
  $('#disconnect-robinhood').hidden=!connection.robinhoodConnected;
  for(const [id,name] of [['model','model'],['robinhood-model','robinhoodModel']]){
    const select=$('#'+id);
    if(!select.options.length){for(const value of connection.models){select.add(new Option(value,value));}select.value=connection[name];}
  }
}
async function refreshState(){state=await get('/api/state');settingsView();}
function setBusy(id,busy){if(busy)pending.add(id);else pending.delete(id);const button=runButtons.find(b=>b.dataset.run===id);if(button){button.disabled=busy;button.textContent=busy?'Run in progress…':'Run today';}}
function progress(message,busy=false){$('#request-status').hidden=false;$('#request-status').textContent=message;$('#request-status').classList.toggle('working',busy);$('#output').setAttribute('aria-busy',String(busy));}
function showError(message){$('#notice').textContent=message;$('#notice').hidden=false;}
function render(result){
  const apiResult=result.source==='api';
  $('#output-meta').innerHTML='<span class="badge">'+(apiResult?(result.quiet?'Quiet check':'API response'):result.source==='legacy'?'Previous ChatGPT copy':'No response yet')+'</span><span>'+escape(date(result.createdAt||result.fetchedAt))+'</span>'+(result.model?'<span>'+escape(result.model)+'</span>':'');
  $('#output-meta').hidden=result.source==='empty';
  $('#notice').textContent=result.warning||'';$('#notice').hidden=!result.warning;
  const content=document.createElement('div');content.className='response-text';
  if(result.text){if(result.format==='plain'){const plain=document.createElement('div');plain.className='plain';plain.textContent=result.text;content.append(plain);}else content.innerHTML=markdown(result.text);}
  if(result.sources?.length){
    const links=document.createElement('div');links.className='response-sources';const seen=new Set();
    for(const source of result.sources){const url=safeUrl(source.url);if(!url||seen.has(url))continue;seen.add(url);const a=document.createElement('a');a.href=url;a.textContent=source.title||new URL(url).hostname;a.target='_blank';a.rel='noopener noreferrer';links.append(a,document.createTextNode(' · '));}
    content.append(links);
  }
  if(result.unavailable&&result.previous){const details=document.createElement('details');details.open=true;const summary=document.createElement('summary');summary.textContent='Earlier available reply — '+date(result.previous.createdAt);const body=document.createElement('div');body.innerHTML=markdown(result.previous.text);details.append(summary,body);content.append(details);}
  $('#response').replaceChildren(content);
}
async function loadHistory(id,viewTicket=ticket){
  const result=await get('/api/tasks/'+id+'/history');
  if(selected!==id||viewTicket!==ticket)return;
  history=result.items;
  const select=$('#history-select');select.replaceChildren();
  history.forEach((item,index)=>select.add(new Option(date(item.createdAt)+(item.quiet?' · Quiet check':''),String(index))));
  $('#history-label').hidden=!history.length;
}
function showApproval(job){
  pendingApproval=job;$('#approval').hidden=false;
  const a=job.approval.args;
  $('#order-summary').textContent=a.symbol+' · BUY · '+a.type+' · '+(a.dollar_amount?'$'+a.dollar_amount:a.quantity+' shares at a limit of $'+a.limit_price)+' · regular hours only';
  $('#order-disclosure').textContent=job.approval.disclosure||'';
  $('#order-preview').textContent=job.approval.preview;
  $('#approve-order').disabled=Date.now()>Date.parse(job.approval.expiresAt);
  if($('#approve-order').disabled)showError('This broker preview has expired. Decline this proposal and run the task again for a fresh preview.');
  progress('Your review is needed before submitting this buy.');
}
async function selectTask(id){
  const currentTicket=++ticket;selected=id;pendingApproval=null;
  for(const card of cards)card.setAttribute('aria-pressed',String(card.dataset.task===id));
  $('#output-title').textContent=state.tasks.find(t=>t.id===id).title;
  $('#approval').hidden=true;$('#notice').hidden=true;$('#history-label').hidden=true;$('#prompt-details').hidden=true;
  $('#response').textContent='Loading saved reply…';progress('Loading saved reply…',true);
  try{
    const result=await api('/api/tasks/'+id+'/saved');
    if(currentTicket!==ticket)return;
    render(result);progress(result.source==='api'?'Saved API reply.':'Ready for the first API run.');
    await loadHistory(id,currentTicket);
    const prompt=await get('/api/tasks/'+id+'/prompt');
    if(currentTicket!==ticket)return;
    $('#task-prompt').textContent=prompt.prompt;$('#prompt-details').hidden=false;
    const job=state.jobs.find(j=>j.taskId===id);
    if(job){if(job.stage==='approval')showApproval(job);else void watch(job);}
    else if(state.lastRuns?.[id]?.stage==='error'){showError(state.lastRuns[id].error);progress('The last run could not complete.');}
  }catch(error){if(currentTicket===ticket){showError(error.message);progress('Could not load the conversation.');}}
}
function stageText(job){return ({queued:'Starting today’s run…',creating:'Sending the task to OpenAI…',running:'The model is working…',searching:'Searching current sources…',writing:'Writing your report from the collected sources…',tools:'Checking Robinhood data…'})[job.stage]||'Checking progress…';}
function watch(job){
  if(watches.has(job.id))return watches.get(job.id);
  const watching=(async()=>{
    setBusy(job.taskId,true);
    try{
      while(!['complete','error','approval'].includes(job.stage)){
        if(selected===job.taskId)progress(stageText(job),true);
        await new Promise(resolve=>setTimeout(resolve,1200));
        job=await get('/api/jobs/'+job.id);
      }
      if(selected===job.taskId){
        if(job.stage==='complete'){render(job.result);progress(job.result.quiet?'Check recorded. No new standout deal.':'New reply saved.');await loadHistory(job.taskId);}
        else if(job.stage==='approval')showApproval(job);
        else{showError(job.error);progress('The run could not complete.');}
      }
    }catch(error){if(selected===job.taskId){showError(error.message+' Refresh the page to resume checking this run.');progress('Connection interrupted.');}}
    finally{if(job.stage!=='approval')setBusy(job.taskId,false);watches.delete(job.id);void refreshState().catch(()=>{});}
  })();watches.set(job.id,watching);return watching;
}
async function runTask(id){
  if(pending.has(id))return;
  setBusy(id,true);
  try{await selectTask(id);const job=await api('/api/tasks/'+id+'/run');await refreshState();await watch(job);}
  catch(error){if(selected===id){showError(error.message);progress('The run could not start.');}setBusy(id,false);}
}
$('#connect').addEventListener('click',()=>{const help=$('#connection-help');help.hidden=!help.hidden;$('#connect').setAttribute('aria-expanded',String(!help.hidden));});
$('#settings-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{await api('/api/settings',{apiKey:$('#api-key').value.trim(),model:$('#model').value,robinhoodModel:$('#robinhood-model').value,accountNumber:$('#account-number').value.trim()});$('#api-key').value='';$('#account-number').value='';await refreshState();toast('Settings saved on this computer.');}
  catch(error){toast(error.message);}finally{button.disabled=false;}
});
$('#check-api').addEventListener('click',async()=>{
  $('#check-api').disabled=true;
  try{await api('/api/initialize');await refreshState();toast('API connected. All three conversations are ready.');}catch(error){toast(error.message);}finally{$('#check-api').disabled=false;}
});
$('#connect-robinhood').addEventListener('click',async()=>{
  $('#connect-robinhood').disabled=true;
  try{const result=await api('/api/robinhood/connect');const url=new URL(result.url);if(url.origin!=='https://robinhood.com')throw new Error('Unexpected sign-in address.');location.assign(url.href);}
  catch(error){toast(error.message);$('#connect-robinhood').disabled=false;}
});
$('#disconnect-robinhood').addEventListener('click',async()=>{try{await api('/api/robinhood/disconnect');await refreshState();}catch(error){toast(error.message);}});
for(const [id,approve] of [['approve-order',true],['decline-order',false]])$('#'+id).addEventListener('click',async()=>{
  const job=pendingApproval;if(!job)return;
  $('#approve-order').disabled=true;$('#decline-order').disabled=true;
  try{const next=await api('/api/jobs/'+job.id+'/approve',{approvalId:job.approval.id,approve});$('#approval').hidden=true;pendingApproval=null;await watch(next);}
  catch(error){showError(error.message);}
  finally{$('#approve-order').disabled=false;$('#decline-order').disabled=false;}
});
$('#history-select').addEventListener('change',()=>{const result=history[Number($('#history-select').value)];if(result){render(result);progress('Saved API reply.');}});
for(const card of cards)card.addEventListener('click',()=>selectTask(card.dataset.task));
for(const button of runButtons)button.addEventListener('click',()=>runTask(button.dataset.run));
const today=new Date();$('#day').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long'}).format(today).toUpperCase();$('#date').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'long',day:'numeric'}).format(today);
try{
  await refreshState();
  for(const job of state.jobs){setBusy(job.taskId,true);if(job.stage!=='approval')void watch(job);}
  setInterval(()=>refreshState().catch(()=>{$('#connection-label').textContent='Local server unavailable';}),4000);
  if(location.pathname==='/setup'||!state.connection.keyAvailable||new URLSearchParams(location.search).has('robinhood')){$('#connection-help').hidden=false;$('#connect').setAttribute('aria-expanded','true');}
  if(new URLSearchParams(location.search).get('robinhood')==='error')toast('Robinhood sign-in was not completed. Use Connect Robinhood to try again.');
}catch(error){for(const button of [...cards,...runButtons])button.disabled=true;toast(error.message);}

