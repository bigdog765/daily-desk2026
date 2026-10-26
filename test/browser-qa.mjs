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
const richReply=`<h1>Daily Briefing</h1><p>A <strong>bold update</strong> and <em>italic context</em>, with <strong><em>both together</em></strong>.</p>
<style>.styled-bold{font-weight:600}.styled-italic{font-style:italic}.styled-both{font-weight:700;font-style:italic}</style>
<p><span class="styled-bold">CSS bold label</span> and <span class="styled-italic">CSS italic context</span>.</p>
<p class="styled-bold"><span>Inherited bold subtitle</span></p>
<p><span class="styled-both">CSS combined emphasis</span></p>
<p class="styled-bold"><code>literal_code *</code> <strong>Semantic bold stays single</strong></p>
<h2>Local opportunities</h2><h3>Tonight in Royal Oak</h3><ul><li>First opportunity<ul><li>Nested detail</li></ul></li><li>Second opportunity</li></ul>
<ol start="3"><li>Compare prices</li><li>Check requirements</li></ol><blockquote><p>Worth remembering.</p></blockquote><hr>
<table><thead><tr><th>Model</th><th>Price</th><th>Requirements</th></tr></thead><tbody><tr><td><strong>iPhone 17</strong></td><td>$599 | $699</td><td>Unlocked<br>No plan change</td></tr><tr><td>iPhone 16</td><td>$499</td><td><em>Refurbished</em></td></tr></tbody></table>
<p>Use <code>value_* &lt; 4</code>. Literal *stars*, _underscores_, [brackets], &lt;tag&gt; &amp; symbols.</p><pre><code class="language-js">const value = 1;\n  console.log(value);</code></pre>
<p><a href="https://example.com/story?q=one&amp;other=two">Reliable source</a> <a href="https://chatgpt.com/c/example">Chat label</a></p>
<div style="display:none">HIDDEN CONTENT</div><button>Copy response</button>`;
function fixture(url){
 if(scenario==='signed-out')return '<h1>ChatGPT</h1><button>Log in</button>';
 if(scenario==='verification')return '<title>Just a moment...</title><h1>Verify you are human</h1>';
 if(scenario==='unavailable')return '<div role="alert">Unable to load conversation</div>';
 const textarea=url.includes('6aad3c40');
 const editor=textarea?'<textarea id="prompt-textarea"></textarea>':'<div id="prompt-textarea" contenteditable="true" role="textbox"><p><br></p></div>';
 let html=`<!doctype html><style>#prompt-textarea{min-height:40px;width:600px}button{padding:10px}</style><main id="messages"><div data-message-author-role="user" data-message-id="old-user">Try again today</div><div data-message-author-role="assistant" data-message-id="old-assistant">OLD SAVED RESPONSE</div></main>${editor}<button aria-label="Send prompt" disabled>Send</button><button id="confirm-trade">Confirm trade</button><script>
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
 if(scenario==='modern')html=html.replaceAll('data-message-author-role','data-turn').replaceAll('data-message-id','data-turn-id').replaceAll('dataset.messageAuthorRole','dataset.turn').replaceAll('dataset.messageId','dataset.turnId').replaceAll('prompt-textarea','modern-input').replace('id="modern-input" contenteditable','aria-label="Ask ChatGPT" id="modern-input" contenteditable');
 if(['surface','combined','rich'].includes(scenario))html=html
   .replace('<main id="messages">','<main role="region" aria-label="Conversation"><div id="messages" data-chatgpt-selection-conversation-id="'+url.split('/').at(-1)+'">')
   .replace('</main>','</div></main><div data-composer-body>')
   .replace('<script>','</div><script>')
   .replaceAll('Send prompt','Send')
   .replaceAll('data-message-author-role="user"','data-user-message-bubble')
   .replaceAll('data-message-author-role="assistant"','data-chatgpt-selection-conversation-id="'+url.split('/').at(-1)+'"')
   .replaceAll('data-message-id','data-chatgpt-selection-message-id')
   .replace('>OLD SAVED RESPONSE</div>','><div data-markdown-text-style>OLD SAVED RESPONSE</div></div>')
   .replace("user.dataset.messageAuthorRole='user'","user.setAttribute('data-user-message-bubble','')")
   .replace("answer.dataset.messageAuthorRole='assistant'","answer.dataset.chatgptSelectionConversationId=location.pathname.split('/').at(-1)")
   .replaceAll('dataset.messageId','dataset.chatgptSelectionMessageId')
   .replace("answer.innerHTML='NEW WEBSITE REPLY", "answer.innerHTML='<div data-markdown-text-style>NEW WEBSITE REPLY")
   .replace('>NEW WEBSITE REPLY','><h2>NEW WEBSITE REPLY</h2><p>First paragraph.</p><p>Second paragraph.</p>')
   .replace("</a>';document.querySelector('#messages').append(answer)","</a></div>';document.querySelector('#messages').append(answer)")
   .replaceAll('prompt-textarea','surface-input')
   .replace('id="surface-input" contenteditable','aria-label="Ask ChatGPT" id="surface-input" contenteditable')
   .replace("stop.dataset.testid='stop-button'","stop.setAttribute('aria-label','Stop streaming')");
 if(scenario==='combined')html=html.replace('>OLD SAVED RESPONSE</div>','><h1>Daily briefing — October 15, 2026</h1><p>Older briefing.</p><h1>Daily Briefing — October 16, 2026</h1><p>Current briefing.</p></div>');
 if(scenario==='rich')html=html.replace('>OLD SAVED RESPONSE</div>','>'+richReply+'</div>');
 return html;
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
 app.bridge.history('briefing').push({id:'plain-fixture',format:'plain',source:'chatgpt',text:'**Original plain snapshot**\nSecond line.'});
 await page.locator('[data-task="briefing"]').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Saved reply.',null,{timeout:1500});
 assert.equal(sends.length,0);assert.equal(context.pages().filter(p=>p.url().startsWith('https://chatgpt.com/')).length,0);
 assert.equal(await page.locator('#response .plain').innerText(),'**Original plain snapshot**\nSecond line.');
 assert.equal(await page.locator('#response strong').count(),0);
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
 for(const [problem,expected] of [['signed-out','showing Log in'],['verification','verification screen'],['unavailable','conversation is unavailable']]){
   scenario=problem;await page.locator('[data-run="briefing"]').click();
   await page.waitForFunction(text=>document.querySelector('#notice').textContent.includes(text),expected,{timeout:15000});
   assert.equal(sends.length,3);
   const last=app.bridge.state().lastRuns.briefing;
   assert.equal(app.bridge.getJob(last.id).diagnostics.status,problem);
   assert.equal(app.bridge.getJob(last.id).submitted,false);
 }
 console.log('PASS distinct sign-in, verification, and conversation-access errors without sending');
 scenario='modern';await page.locator('[data-run="briefing"]').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='New reply received.',null,{timeout:15000});
 assert.equal(sends.length,4);assert.match(await page.locator('#response').innerText(),/NEW WEBSITE REPLY/);
 console.log('PASS turn-based messages and an Ask ChatGPT composer without the legacy element IDs');
 scenario='surface';await page.locator('[data-run="briefing"]').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='New reply received.',null,{timeout:15000});
 assert.equal(sends.length,5);assert.match(await page.locator('#response').innerText(),/NEW WEBSITE REPLY/);
 assert.ok(!(await page.locator('#response').innerText()).includes('OLD SAVED RESPONSE'));
 assert.match(await page.locator('#response').innerText(),/NEW WEBSITE REPLY\n\nFirst paragraph\.\n\nSecond paragraph\./);
 console.log('PASS observed Conversation region, selection-marked replies, and user-message bubbles');
 scenario='combined';await page.locator('#sync-latest').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Response is up to date.',null,{timeout:15000});
 assert.match(await page.locator('#response').innerText(),/^Daily Briefing — October 16, 2026\n\nCurrent briefing\./);
 assert.ok(!(await page.locator('#response').innerText()).includes('Older briefing'));
 console.log('PASS latest dated briefing selected from grouped scheduled messages');
 scenario='rich';await page.locator('#sync-latest').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Response is up to date.',null,{timeout:15000});
 const response=page.locator('#response');
 assert.equal(await response.locator('h1').innerText(),'Daily Briefing');
 assert.equal(await response.locator('h2').innerText(),'Local opportunities');
 assert.equal(await response.locator('h3').innerText(),'Tonight in Royal Oak');
 assert.equal(await response.locator('strong em,em strong').filter({hasText:'both together'}).innerText(),'both together');
 assert.equal(await response.locator('strong').filter({hasText:'CSS bold label'}).count(),1);
 assert.equal(await response.locator('em').filter({hasText:'CSS italic context'}).count(),1);
 assert.equal(await response.locator('strong').filter({hasText:'Inherited bold subtitle'}).count(),1);
 assert.equal(await response.locator('strong em,em strong').filter({hasText:'CSS combined emphasis'}).count(),1);
 assert.equal(await response.locator('strong strong,em em').count(),0);
 assert.equal(await response.locator('code').filter({hasText:'literal_code *'}).innerText(),'literal_code *');
 assert.equal(await response.locator('strong').filter({hasText:'CSS bold label'}).evaluate(node=>getComputedStyle(node).fontWeight),'700');
 assert.equal(await response.locator('ul ul li').innerText(),'Nested detail');
 assert.equal(await response.locator('ol').getAttribute('start'),'3');
 assert.equal(await response.locator('blockquote').innerText(),'Worth remembering.');
 assert.equal(await response.locator('hr').count(),1);
 assert.equal(await response.locator('table tbody tr').count(),2);
 assert.equal(await response.locator('tbody tr').first().locator('td').nth(1).innerText(),'$599 | $699');
 assert.equal(await response.locator('tbody tr').first().locator('td').nth(2).innerText(),'Unlocked\nNo plan change');
 assert.equal(await response.locator('pre code').textContent(),'const value = 1;\n  console.log(value);\n');
 assert.match(await response.innerText(),/Literal \*stars\*, _underscores_, \[brackets\], <tag> & symbols\./);
 assert.ok(!(await response.innerText()).includes('HIDDEN CONTENT'));
 assert.equal(await response.locator('button,a[href*="chatgpt.com"]').count(),0);
 assert.equal(app.bridge.history('briefing').at(-1).format,'markdown');assert.equal(sends.length,5);
 await page.reload();await page.locator('[data-task="briefing"]').click();
 await page.waitForFunction(()=>!!document.querySelector('#response table'));
 assert.equal(await response.locator('strong em,em strong').filter({hasText:'both together'}).innerText(),'both together');
 assert.equal(await response.locator('strong').filter({hasText:'CSS bold label'}).count(),1);
 // Exercise hostile Markdown/HTML separately from the conversation fixtures.
 assert.deepEqual(await page.evaluate(async()=>{
   const {renderMarkdown}=await import('/markdown.js');
   const fragment=renderMarkdown('<script>window.injected=true</script><img src=x onerror="window.injected=true"><svg onload="window.injected=true"></svg><iframe src="https://evil.example"></iframe><p style="color:red" onclick="window.injected=true">Safe</p>\n\n[bad](javascript:alert(1)) [data](data:text/html,x) [chat](https://sub.chatgpt.com/c/x) [good](https://example.com)');
   return {dangerous:fragment.querySelectorAll('script,img,svg,iframe,[onclick],[onerror],[style]').length,links:[...fragment.querySelectorAll('a')].map(a=>[a.href,a.target,a.rel])};
 }),{dangerous:0,links:[['https://example.com/','_blank','noopener noreferrer']]});
 await page.screenshot({path:'work/formatting-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(await response.locator('em').first().evaluate(node=>getComputedStyle(node).fontStyle),'italic');
 await page.screenshot({path:'work/formatting-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1050});
 console.log('PASS rich formatting round trip, saved history, literal text, safe links, hostile HTML removal, responsive tables');
 const readerFile=path.join(extension,'conversation-dom.js');
 await writeFile(readerFile,(await readFile(readerFile,'utf8'))+'\nglobalThis.dailyDeskDOM.text = () => "UPDATED PACKAGED READER";\n');
 await page.locator('#sync-latest').click();
 await page.waitForFunction(()=>document.querySelector('#request-status').textContent==='Response is up to date.',null,{timeout:15000});
 assert.match(await page.locator('#response').innerText(),/UPDATED PACKAGED READER/);
 console.log('PASS packaged reader updates load on the next request without restarting the extension');
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
 assert.equal(sends.length,5);console.log('PASS durable delivery receipts, mobile layout, explicit offline errors, zero API calls');
} catch(error) {
 console.log('FAILURE STATE',JSON.stringify(app.bridge.state()));
 for(const tab of context?.pages()||[])console.log('PAGE',tab.url(),await tab.locator('body').innerText().catch(()=>'<unavailable>'));
 throw error;
} finally {await context?.close();await browser?.close();await app.close();}
