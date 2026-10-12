import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {createSettings} from './src/settings.mjs';
import {tasks,loadPrompts} from './src/tasks.mjs';
import {createRobinhood} from './src/robinhood.mjs';
import {createRunner,safeError} from './src/runner.mjs';
import {readJson} from './src/store.mjs';

export async function createDashboard({port=Number(process.env.PORT||4317),privateDir,clientFactory,env=process.env,request,pollMs}={}){
  const root=path.dirname(fileURLToPath(import.meta.url));
  privateDir??=env.DAILY_DESK_DATA_DIR||path.join(root,'.local');
  await mkdir(privateDir,{recursive:true});
  const origin='http://127.0.0.1:'+port,csrf=crypto.randomBytes(32).toString('hex');
  const settings=await createSettings(privateDir,{env});
  const prompts=await loadPrompts(root);
  const robinhood=await createRobinhood(settings,origin,{request});
  const runner=await createRunner({privateDir,settings,robinhood,prompts,clientFactory,pollMs});
  const imported=await readJson(path.join(root,'data/imported.json'),{tasks:{}});
  const legacyCache=await readJson(path.join(privateDir,'responses.json'),{});
  function saved(id){
    const result=runner.latest(id);
    if(result)return {...result,source:'api'};
    const legacy=legacyCache[id]||imported.tasks[id];
    return legacy?{...legacy,source:'legacy',warning:'Previous ChatGPT copy. Run this task to create its first API reply.'}:{text:'No response yet. Run this task to start its API conversation.',source:'empty',sources:[]};
  }
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  async function body(req){
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>32000)throw new Error('Request too large.');chunks.push(chunk);}
    return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
  }
  const files={'/':['index.html','text/html'],'/setup':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.js':['app.js','text/javascript'],'/favicon.svg':['favicon.svg','image/svg+xml']};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,origin);
    if(req.method==='POST'&&(![origin,'http://localhost:'+port].includes(req.headers.origin)||req.headers['x-dashboard-token']!==csrf))return json(res,403,{error:'Use the local dashboard to perform this action.'});
    if(Number(req.headers['content-length']||0)>32000)return json(res,413,{error:'Request too large.'});
    try{
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{tasks,csrf,connection:{mode:'api',...settings.public()},...runner.state()});
      if(req.method==='POST'&&url.pathname==='/api/settings'){
        try{return json(res,200,await settings.update(await body(req)));}catch(error){return json(res,400,{error:error.message});}
      }
      if(req.method==='POST'&&url.pathname==='/api/initialize')return json(res,200,await runner.initialize());
      if(req.method==='POST'&&url.pathname==='/api/robinhood/connect'){
        try{return json(res,200,await robinhood.connect());}catch(error){return json(res,400,{error:error.message});}
      }
      if(req.method==='POST'&&url.pathname==='/api/robinhood/disconnect'){await robinhood.disconnect();return json(res,200,{ok:true});}
      if(req.method==='GET'&&url.pathname==='/oauth/robinhood/callback'){
        try{await robinhood.callback(url.searchParams);res.writeHead(303,{Location:'/?robinhood=connected'});res.end();}
        catch{res.writeHead(303,{Location:'/?robinhood=error'});res.end();}
        return;
      }
      const jobMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(approve))?$/);
      if(jobMatch){
        if(req.method==='GET'&&!jobMatch[2]){const job=runner.getJob(jobMatch[1]);return json(res,job?200:404,job||{error:'Request not found.'});}
        if(req.method==='POST'&&jobMatch[2])return json(res,202,await runner.approve(jobMatch[1],await body(req)));
      }
      const taskMatch=url.pathname.match(/^\/api\/tasks\/([a-z]+)\/(saved|history|prompt|run|retry|refresh|read)$/);
      if(taskMatch){
        const [,id,action]=taskMatch;
        if(!tasks.some(t=>t.id===id))return json(res,404,{error:'Unknown task.'});
        if(req.method==='GET'&&action==='prompt')return json(res,200,{prompt:prompts[id]});
        if(req.method==='GET'&&action==='history')return json(res,200,{items:runner.history(id).slice().reverse()});
        if(req.method==='POST'&&['read','saved','refresh'].includes(action))return json(res,200,saved(id));
        if(req.method==='POST'&&['run','retry'].includes(action))return json(res,202,await runner.start(id));
      }
      if(req.method==='GET'&&files[url.pathname]){const [name,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(path.join(root,'public',name)));return;}
      json(res,404,{error:'Not found.'});
    }catch(error){json(res,400,{error:safeError(error)});}
  });
  return {server,runner,settings,async close(){runner.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dashboard=await createDashboard();
  const port=Number(process.env.PORT||4317);
  dashboard.server.listen(port,'127.0.0.1',()=>console.log('Daily Desk API dashboard: http://127.0.0.1:'+port));
  dashboard.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'The dashboard port is already in use.':'The dashboard could not start.');process.exitCode=1;});
  const shutdown=()=>dashboard.close().then(()=>process.exit(0));process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}

