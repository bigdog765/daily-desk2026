import {allowedSender,taskFor,canRetry} from './policy.js';
import {readResponse} from './read-response.js';
import {submitRetry} from './submit-retry.js';
const queues=new Map(),executions=new Map(),records=new Map();
let socket=null,connecting=false,ready=false,writes=Promise.resolve();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function save(){
  // Retain small receipts after acknowledgment; keep result bodies only until delivered.
  while(records.size>200){const key=[...records.keys()].find(id=>records.get(id).state==='acknowledged');if(!key)break;records.delete(key);}
  const snapshot=[...records.values()];
  writes=writes.catch(()=>{}).then(()=>chrome.storage.local.set({executions:snapshot}));return writes;
}
const restored=(async()=>{
  const saved=await chrome.storage.local.get('executions');
  for(const entry of saved.executions||[]){
    if(entry.state==='running'){
      entry.state='finished';entry.result={type:'result',id:entry.id,ok:false,submitted:'unknown',error:'The browser extension restarted during this request. It was not resent. Sync latest before sending another prompt.'};
    }
    records.set(entry.id,entry);
  }
  await save();
})();
function publish(value){if(ready&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
async function finish(result){
  const entry=records.get(result.id);if(entry){entry.state='finished';entry.result=result;await save();}
  publish(result);
}
async function waitForPage(tabId,chatId){
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete'){
      const url=new URL(tab.url||'about:blank');
      if(url.origin==='https://chatgpt.com'&&url.pathname==='/c/'+chatId)return;
      if(url.pathname.includes('/auth')||url.hostname.includes('auth.'))throw new Error('ChatGPT needs sign-in in your normal browser. Your saved replies remain available.');
    }
    await wait(250);
  }
  throw new Error('The linked conversation did not load. Check your signed-in browser and its access to this chat.');
}
async function run(job){
  const task=taskFor(job.taskId);
  if(!task||!['read','retry'].includes(job.action)||(job.action==='retry'&&!canRetry(job.taskId)))throw new Error('Unsupported task request.');
  let tab,submitted=false;
  const progress=stage=>publish({type:'progress',id:job.id,stage});
  try{
    progress('loading');
    tab=await chrome.tabs.create({url:`https://chatgpt.com/c/${task.chatId}`,active:false});
    await waitForPage(tab.id,task.chatId);
    let after=null;
    if(job.action==='retry'){
      progress('sending');submitted='unknown';
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:submitRetry,args:[task.chatId]});
      const sent=results[0]?.result;submitted=sent?.submitted??'unknown';
      if(submitted!==true)throw new Error(sent?.error||'The prompt could not be confirmed. Sync latest before trying again.');
      after=sent.after;progress('sent');
    }else progress('reading');
    const responses=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readResponse,args:[task.chatId,after]});
    const result=responses[0]?.result;
    if(!result?.text)throw new Error(result?.error||'No completed reply is available yet. Choose Sync latest shortly.');
    return {type:'result',id:job.id,ok:true,result:{...result,chatId:task.chatId,triggered:job.action==='retry'}};
  }catch(error){
    let message=String(error.message||'The browser request failed.');
    if(job.action==='retry')message=(submitted===true?'“Try again today” was sent. ':submitted==='unknown'?'Send status is uncertain. Sync latest before trying again. ':'The prompt was not sent. ')+message;
    return {type:'result',id:job.id,ok:false,error:message,submitted};
  }finally{if(tab)await chrome.tabs.remove(tab.id).catch(()=>{});}
}
function accept(job){
  if(!/^[a-f0-9-]{36}$/.test(job.id||'')||!taskFor(job.taskId)||!['read','retry'].includes(job.action))return;
  if(executions.has(job.id))return;
  const execution=(async()=>{
    await restored;
    const previous=records.get(job.id);
    if(previous){if(previous.result)publish(previous.result);return;}
    records.set(job.id,{id:job.id,taskId:job.taskId,action:job.action,state:'running'});await save();
    const queued=queues.get(job.taskId)||Promise.resolve();
    const running=queued.catch(()=>{}).then(()=>run(job));queues.set(job.taskId,running);
    try{await finish(await running);}finally{if(queues.get(job.taskId)===running)queues.delete(job.taskId);}
  })().catch(error=>finish({type:'result',id:job.id,ok:false,error:'The extension could not finish this request. Sync latest before retrying.',submitted:'unknown'}));
  executions.set(job.id,execution);
  execution.finally(()=>executions.delete(job.id));
}
async function connect(){
  if(connecting||socket?.readyState===WebSocket.OPEN||socket?.readyState===WebSocket.CONNECTING)return;
  connecting=true;
  try{
    await restored;
    const response=await fetch('http://127.0.0.1:4317/api/bridge/bootstrap',{method:'POST',headers:{'X-Daily-Desk-Bridge':'1'},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Local dashboard unavailable.');
    const config=await response.json();
    if(config.socket!=='ws://127.0.0.1:4317/bridge'||config.protocol!=='daily-desk-v2')throw new Error('Unexpected local connection.');
    const ws=new WebSocket(config.socket,[config.protocol,config.token]);socket=ws;
    ws.onopen=()=>ws.send(JSON.stringify({type:'hello',version:chrome.runtime.getManifest().version}));
    ws.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='ready'){
        ready=true;for(const entry of records.values())if(entry.result)publish(entry.result);
      }else if(message.type==='job'&&ready)accept(message);
      else if(message.type==='ack'){
        const entry=records.get(message.id);if(entry){entry.state='acknowledged';delete entry.result;void save();}
      }
    };
    ws.onclose=()=>{if(socket===ws){socket=null;ready=false;}setTimeout(connect,3000);};
    ws.onerror=()=>ws.close();
  }catch{setTimeout(connect,3000);}finally{connecting=false;}
}
setInterval(()=>publish({type:'ping'}),20000);
chrome.alarms.create('daily-desk-connect',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(()=>connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!allowedSender(sender)||message?.channel!=='daily-desk-v1')return;
  if(message.action==='ping'){void connect();respond({ok:true,version:chrome.runtime.getManifest().version});}
});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:'http://127.0.0.1:4317/'}));
void connect();
