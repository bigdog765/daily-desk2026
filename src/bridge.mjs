import path from 'node:path';
import crypto from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {JsonStore,readJson} from './store.mjs';
import {tasks} from './tasks.mjs';

const active=job=>!['complete','error'].includes(job.stage);
const extensionOrigin=value=>typeof value==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(value);
const problem=message=>Object.assign(new Error(message),{publicMessage:message});
export async function createBridge({server,privateDir,root,port,jobTimeoutMs=720000}){
  const store=await JsonStore.open(path.join(privateDir,'extension-state.json'),{tasks:{},jobs:[],pairedOrigin:null});
  const imported=await readJson(path.join(root,'data/imported.json'),{tasks:{}});
  const previous=await readJson(path.join(privateDir,'api-state.json'),{tasks:{}});
  for(const task of tasks){
    if(!store.value.tasks[task.id]){
      const reports=[];
      if(imported.tasks[task.id])reports.push({...imported.tasks[task.id],source:'imported',id:crypto.randomUUID()});
      for(const report of previous.tasks?.[task.id]?.history||[])reports.push({...report,source:'api-archive',id:report.responseId||crypto.randomUUID()});
      store.value.tasks[task.id]={history:reports};
    }
  }
  for(const job of store.value.jobs)if(active(job)){
    job.stage='error';job.finishedAt=new Date().toISOString();
    job.error='The local server restarted during this request. It was not resent. Sync latest before sending another prompt.';
  }
  await store.save();
  let client=null,version=null,closed=false;
  const credentials=new Map();
  const wss=new WebSocketServer({noServer:true,maxPayload:500000,handleProtocols:()=> 'daily-desk-v2'});
  const online=()=>client?.readyState===WebSocket.OPEN&&!!version;
  const jobView=job=>job?{...job}:null;
  function connection(){return {mode:'extension',online:online(),version,paired:!!store.value.pairedOrigin,extensionPath:path.join(root,'extension'),apiEnabled:false};}
  function bootstrap(origin,header){
    if(!extensionOrigin(origin)||header!=='1')throw problem('Only the installed Daily Desk extension can connect here.');
    if(store.value.pairedOrigin&&store.value.pairedOrigin!==origin)throw problem('Another extension is paired. Reset the browser connection on the dashboard first.');
    const token=crypto.randomBytes(32).toString('hex');
    for(const [key,value] of credentials)if(value.expires<Date.now())credentials.delete(key);
    if(credentials.size>100)throw problem('Too many connection attempts.');
    credentials.set(token,{origin,expires:Date.now()+30000});
    return {socket:`ws://127.0.0.1:${port}/bridge`,protocol:'daily-desk-v2',token};
  }
  server.on('upgrade',(req,socket,head)=>{
    const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(s=>s.trim());
    const auth=credentials.get(protocols[1]);
    if(req.url!=='/bridge'||!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||protocols[0]!=='daily-desk-v2'||!auth||auth.origin!==req.headers.origin||auth.expires<Date.now()||(store.value.pairedOrigin&&auth.origin!==store.value.pairedOrigin)){
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    credentials.delete(protocols[1]);
    if(client&&client.readyState===WebSocket.OPEN){socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>{ws.extensionOrigin=auth.origin;wss.emit('connection',ws);});
  });
  wss.on('connection',ws=>{
    client=ws;version=null;let serial=Promise.resolve();
    const helloTimer=setTimeout(()=>{if(!version)ws.close(1008,'Handshake required');},5000);
    ws.on('close',()=>{clearTimeout(helloTimer);if(client===ws){client=null;version=null;}});
    ws.on('error',()=>{});
    ws.on('message',data=>{
      serial=serial.then(async()=>{
        if(client!==ws||closed)return;
        let message;try{message=JSON.parse(data);}catch{return;}
        if(message.type==='hello'){
          if(message.version!=='2.0.0'){ws.close(1008,'Reload the updated Daily Desk extension');return;}
          store.value.pairedOrigin=ws.extensionOrigin;await store.save();version=message.version;clearTimeout(helloTimer);
          ws.send(JSON.stringify({type:'ready'}));return;
        }
        if(!version)return;
        if(message.type==='ping'){ws.send(JSON.stringify({type:'pong'}));return;}
        const job=store.value.jobs.find(item=>item.id===message.id);
        if(!job||!active(job)){if(message.type==='result')ws.send(JSON.stringify({type:'ack',id:message.id}));return;}
        if(message.type==='progress'&&['loading','sending','sent','reading','waiting'].includes(message.stage)){
          job.stage=message.stage;
          if(message.stage==='sending')job.submitted='unknown';
          if(message.stage==='sent')job.submitted=true;
          await store.save();return;
        }
        if(message.type!=='result')return;
        if(message.ok===true&&typeof message.result?.text==='string'&&message.result.text.trim()&&message.result.chatId===tasks.find(task=>task.id===job.taskId).chatId){
          const raw=message.result;
          const sources=(Array.isArray(raw.sources)?raw.sources:[]).filter(item=>typeof item?.url==='string'&&/^https?:\/\//.test(item.url)).slice(0,100).map(item=>({title:String(item.title||'Source').slice(0,300),url:item.url.slice(0,4000)}));
          const text=raw.text.slice(0,200000);
          const fingerprint=crypto.createHash('sha256').update(raw.chatId+'\n'+text).digest('hex');
          const history=store.value.tasks[job.taskId].history;
          let result=history.find(item=>item.id===fingerprint);
          if(!result){
            result={id:fingerprint,chatId:raw.chatId,title:tasks.find(task=>task.id===job.taskId).title,text,sources,source:'chatgpt',format:'plain',fetchedAt:new Date().toISOString(),createdAt:job.action==='retry'?new Date().toISOString():null};
            history.push(result);if(history.length>200)history.splice(0,history.length-200);
          }else result.fetchedAt=new Date().toISOString();
          job.result=result;job.stage='complete';if(job.action==='retry')job.submitted=true;
        }else{
          job.stage='error';job.error=typeof message.error==='string'?message.error.slice(0,1500):'The extension could not read a completed reply. Your saved response is still available.';
          if([true,false,'unknown'].includes(message.submitted))job.submitted=message.submitted;
        }
        job.finishedAt=new Date().toISOString();await store.save();ws.send(JSON.stringify({type:'ack',id:job.id}));
      }).catch(()=>{ws.close(1011,'Could not save this update');});
    });
  });
  const timer=setInterval(()=>{
    let changed=false;
    for(const job of store.value.jobs)if(active(job)&&Date.now()-Date.parse(job.createdAt)>jobTimeoutMs){
      job.stage='error';job.error='The browser request timed out. No prompt was resent. Sync latest to check for a reply before trying again.';job.finishedAt=new Date().toISOString();changed=true;
    }
    if(changed)void store.save();
  },1000);timer.unref();
  return {
    connection,bootstrap,
    state(){return {jobs:store.value.jobs.filter(active).map(jobView),lastRuns:Object.fromEntries(tasks.map(task=>{const job=store.value.jobs.findLast(item=>item.taskId===task.id);return [task.id,job?{id:job.id,stage:job.stage,error:job.error,submitted:job.submitted}:null];}))};},
    getJob:id=>jobView(store.value.jobs.find(job=>job.id===id)),
    history:id=>store.value.tasks[id].history,
    latest:id=>store.value.tasks[id].history.at(-1)||{source:'empty',text:'No saved response yet. Connect the browser extension, then choose Sync latest.',sources:[]},
    async start(taskId,action){
      const task=tasks.find(item=>item.id===taskId);if(!task||!['read','retry'].includes(action))throw problem('Unknown task request.');
      const existing=store.value.jobs.find(job=>job.taskId===taskId&&active(job));
      if(existing){if(existing.action===action||action==='read')return jobView(existing);throw problem('This conversation is being synced. Wait for it to finish before sending a new prompt.');}
      if(!online())throw problem('The browser extension is offline. Keep your signed-in Chrome or Edge browser open and check Connection setup.');
      const job={id:crypto.randomUUID(),taskId,action,stage:'queued',submitted:false,createdAt:new Date().toISOString()};
      store.value.jobs.push(job);await store.save();
      if(online())client.send(JSON.stringify({type:'job',id:job.id,taskId,action}));
      else{job.stage='error';job.error='The browser disconnected before this request was sent. Try again once it reconnects.';job.finishedAt=new Date().toISOString();await store.save();}
      return jobView(job);
    },
    async reset(){
      if(store.value.jobs.some(active))throw problem('Wait for the current browser request to finish before resetting the connection.');
      client?.close(1000,'Connection reset');client=null;version=null;credentials.clear();store.value.pairedOrigin=null;await store.save();
    },
    async close(){closed=true;clearInterval(timer);client?.terminate();await new Promise(resolve=>wss.close(resolve));await store.writes;}
  };
}
