import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {createBridge} from './src/bridge.mjs';
import {tasks,loadPrompts} from './src/tasks.mjs';

export async function createDashboard({port=Number(process.env.PORT||4317),privateDir,jobTimeoutMs}={}){
  const root=path.dirname(fileURLToPath(import.meta.url));
  privateDir??=process.env.DAILY_DESK_DATA_DIR||path.join(root,'.local');
  await mkdir(privateDir,{recursive:true});
  const origin='http://127.0.0.1:'+port,csrf=crypto.randomBytes(32).toString('hex');
  const prompts=await loadPrompts(root);
  let bridge;
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>32000)throw new Error('Too large');}return text?JSON.parse(text):{};}
  const files={'/':['index.html','text/html'],'/setup':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.js':['app.js','text/javascript'],'/markdown.js':['markdown.js','text/javascript'],'/favicon.svg':['favicon.svg','image/svg+xml'],
    '/vendor/marked.js':['../node_modules/marked/lib/marked.esm.js','text/javascript'],
    '/response.css':['response.css','text/css'],
    '/vendor/dompurify.js':['../node_modules/dompurify/dist/purify.es.mjs','text/javascript']};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,origin);
    try{
      if(req.method==='POST'&&url.pathname==='/api/bridge/bootstrap'){
        try{return json(res,200,bridge.bootstrap(req.headers.origin,req.headers['x-daily-desk-bridge']));}catch(error){return json(res,403,{error:error.publicMessage});}
      }
      if(req.method==='POST'&&(![origin,'http://localhost:'+port].includes(req.headers.origin)||req.headers['x-dashboard-token']!==csrf))return json(res,403,{error:'Use the local dashboard to perform this action.'});
      if(Number(req.headers['content-length']||0)>32000)return json(res,413,{error:'Request too large.'});
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{tasks,csrf,connection:bridge.connection(),...bridge.state()});
      if(req.method==='POST'&&url.pathname==='/api/bridge/reset'){await body(req);await bridge.reset();return json(res,200,{ok:true});}
      if(req.method==='POST'&&['/api/initialize','/api/settings','/api/robinhood/connect','/api/robinhood/disconnect'].includes(url.pathname))return json(res,410,{error:'API generation is disabled. This dashboard uses the browser extension.'});
      const jobMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
      if(req.method==='GET'&&jobMatch){const job=bridge.getJob(jobMatch[1]);return json(res,job?200:404,job||{error:'Request not found.'});}
      const taskMatch=url.pathname.match(/^\/api\/tasks\/([a-z]+)\/(saved|history|prompt|run|retry|refresh|read)$/);
      if(taskMatch){
        const [,id,action]=taskMatch;if(!tasks.some(task=>task.id===id))return json(res,404,{error:'Unknown task.'});
        if(req.method==='GET'&&action==='prompt')return json(res,200,{prompt:prompts[id]});
        if(req.method==='GET'&&action==='history')return json(res,200,{items:bridge.history(id).slice().reverse()});
        if(req.method==='POST'&&action==='saved')return json(res,200,bridge.latest(id));
        if(req.method==='POST'&&['read','refresh','run','retry'].includes(action))return json(res,202,await bridge.start(id,['read','refresh'].includes(action)?'read':'retry'));
      }
      if(req.method==='GET'&&files[url.pathname]){const [name,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(path.join(root,'public',name)));return;}
      json(res,404,{error:'Not found.'});
    }catch(error){json(res,400,{error:error.publicMessage||'The local request could not be completed. Your saved responses are still available.'});}
  });
  bridge=await createBridge({server,privateDir,root,port,jobTimeoutMs});
  return {server,bridge,async close(){await bridge.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dashboard=await createDashboard();const port=Number(process.env.PORT||4317);
  dashboard.server.listen(port,'127.0.0.1',()=>console.log('Daily Desk browser dashboard: http://127.0.0.1:'+port));
  dashboard.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'The dashboard port is already in use.':'The dashboard could not start.');process.exitCode=1;});
  const shutdown=()=>dashboard.close().then(()=>process.exit(0));process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
