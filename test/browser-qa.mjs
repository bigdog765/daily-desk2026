import {chromium} from '../node_modules/playwright/index.mjs';
import {cp,readFile,writeFile,readdir,mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDashboard} from '../server.mjs';
const root=process.cwd();await mkdir(path.join(root,'work'),{recursive:true});
const scratch=await mkdtemp(path.join(root,'work','extension-qa-'));
const extension=path.join(scratch,'extension');await cp(path.join(root,'extension'),extension,{recursive:true});
for(const name of await readdir(extension))if(/\.(js|json)$/.test(name)){const file=path.join(extension,name);await writeFile(file,(await readFile(file,'utf8')).replaceAll('4317','4319'));}
const base='http://127.0.0.1:4319';
const app=await createDashboard({port:4319,privateDir:path.join(scratch,'data')});
await new Promise(resolve=>app.server.listen(4319,'127.0.0.1',resolve));
const executablePath=process.env.CHROMIUM_PATH||path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1148/chrome-win/chrome.exe');
let context,browser,scenario='success';const sends=[],errors=[],requests=[];
function fixture(url){
 const textarea=url.includes('6aad3c40');
 const editor=textarea?'<textarea id="prompt-textarea"></textarea>':'<div id="prompt-textarea" contenteditable="true" role="textbox"><p><br></p></div>';
 return `<!doctype html><style>#prompt-textarea{min-height:40px;width:600px}button{padding:10px}</style><main id="messages"><div data-message-author-role="user" data-message-id="old-user">Try again today</div><div data-message-author-role="assistant" data-message-id="old-assistant">OLD SAVED RESPONSE</div></main>${editor}<button aria-label="Send prompt" disabled>Send</button><button id="confirm-trade">Confirm trade</button><script>
 const editor=document.querySelector('#prompt-textarea'),send=document.querySelector('[aria-label="Send prompt"]');
 const value=()=>editor.tagName==='TEXTAREA'?editor.value:editor.innerText;
 editor.addEventListener('input',()=>send.disabled=!value().trim());
 if(${JSON.stringify(scenario)}==='draft'){if(editor.tagName==='TEXTAREA')editor.value='Preserve my draft';else editor.textContent='Preserve my draft';send.disabled=false;}
 document.querySelector('#confirm-trade').onclick=()=>window.recordSend({text:'UNEXPECTED TRADE CLICK'});
 send.onclick=()=>{
   window.recordSend({text:value().trim(),chatId:location.pathname.split('/').at(-1)});
   const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='new-user';user.textContent=value().trim();document.querySelector('#messages').append(user);
   if(editor.tagName==='TEXTAREA')editor.value='';else editor.textContent='';send.disabled=true;
   const stop=document.createElement('button');stop.dataset.testid='stop-button';document.body.append(stop);
   setTimeout(()=>{const answer=document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.dataset.messageId='new-assistant';answer.innerHTML='NEW WEBSITE REPLY <a href="https://example.com/story">Source</a><a href="https://chatgpt.com/c/example">Chat</a>';document.querySelector('#messages').append(answer);stop.remove();},2000);
 };
 </script>`;
}
try {
 context=await chromium.launchPersistentContext(path.join(scratch,'profile'),{executablePath,channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
 await context.exposeBinding('recordSend',(_source,value)=>sends.push(value));
 await context.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
 context.on('page',async tab=>{try{await tab.waitForURL('https://chatgpt.com/**',{timeout:10000});await tab.waitForLoadState('domcontentloaded');await tab.setContent(fixture(tab.url()));}catch{}});
 context.on('request',request=>requests.push(request.url()));
 browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);
 try{await page.waitForFunction(()=>document.querySelector('#connection-label').textContent==='Browser connection ready',null,{timeout:15000});}
 catch(error){console.log('CONNECTION',await (await fetch(base+'/api/state')).json());throw error;}
 const worker=context.serviceWorkers()[0];
 const activeBefore=await worker.evaluate(async()=>(await chrome.tabs.query({active:true})).map(tab=>tab.id));
 await page.locator('[data-task="briefing"]').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Saved reply.',null,{timeout:1500});
 assert.equal(sends.length,0);assert.equal(context.pages().filter(p=>p.url().startsWith('https://chatgpt.com/')).length,0);
 await page.locator('#sync-latest').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Response is up to date.',null,{timeout:15000});
 assert.equal(sends.length,0);assert.match(await page.locator('#response').innerText(),/OLD SAVED RESPONSE/);
 console.log('PASS extension-free dashboard, instant saved reads, explicit sync with no prompt');
 for(const [id,chatId] of [['robinhood','6aa2d72e-2a4c-83e9-b95a-7264914b4067'],['iphone','6aad3c40-08ac-83e9-bf5d-70c96bb2654d'],['briefing','6a5a3671-1cc8-83ea-966f-7d6fe13d798f']]){
   await page.locator('[data-run="'+id+'"]').click();
   await page.waitForFunction(()=>document.querySelector('#request-status').textContent.includes('was sent'),null,{timeout:15000});
   assert.equal(await page.locator('[data-run="'+id+'"]').isDisabled(),true);
   assert.deepEqual(await worker.evaluate(async()=>(await chrome.tabs.query({active:true})).map(tab=>tab.id)),activeBefore);
   if(id==='iphone'){await page.reload();await page.locator('[data-task="iphone"]').click();}
   await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='New reply received.',null,{timeout:15000});
   assert.match(await page.locator('#response').innerText(),/NEW WEBSITE REPLY/);
   assert.ok(!(await page.locator('#response').innerText()).includes('OLD SAVED RESPONSE'));
   assert.deepEqual(sends.at(-1),{text:'Try again today',chatId});
 }
 assert.equal(sends.length,3);assert.equal(await page.locator('a[href*="chatgpt.com"],a[href*="chat.openai.com"]').count(),0);
 assert.equal(context.pages().filter(p=>p.url().startsWith('https://chatgpt.com/')).length,0);
 console.log('PASS exact prompt in all three chats, background tabs, reload recovery, no trade clicks or ChatGPT links');
 await page.screenshot({path:'work/extension-desktop.png',fullPage:true});
 scenario='draft';await page.locator('[data-run="robinhood"]').click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('draft'),null,{timeout:15000});
 assert.equal(sends.length,3);console.log('PASS unrelated draft preserved without sending');
 await page.locator('#connect').click();await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'work/extension-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.ok(!requests.some(url=>url.startsWith('https://api.openai.com')));
 const receipts=await worker.evaluate(async()=>(await chrome.storage.local.get('executions')).executions);
 assert.ok(receipts.every(receipt=>receipt.state==='acknowledged'&&!receipt.result));
 await context.close();context=null;
 await page.waitForFunction(()=>document.querySelector('#connection-label').textContent.includes('offline'),null,{timeout:10000});
 await page.locator('[data-run="iphone"]').click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('offline'),null,{timeout:10000});
 assert.equal(sends.length,3);console.log('PASS durable delivery receipts, mobile layout, explicit offline errors, zero API calls');
} catch(error) {
 console.log('FAILURE STATE',JSON.stringify(app.bridge.state()));
 for(const tab of context?.pages()||[])console.log('PAGE',tab.url(),await tab.locator('body').innerText().catch(()=>'<unavailable>'));
 throw error;
} finally {await context?.close();await browser?.close();await app.close();}
