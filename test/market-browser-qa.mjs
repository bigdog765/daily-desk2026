import {chromium} from '../node_modules/playwright/index.mjs';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDashboard} from '../server.mjs';
import {createMarket} from '../src/market.mjs';
import {chartFixture,marketNow} from './market-fixture.mjs';

await mkdir('work',{recursive:true});
const scratch=await mkdtemp(path.join(process.cwd(),'work','market-qa-'));
let fail=true,time=marketNow,browser;
const market=createMarket({now:()=>time,fetchImpl:async url=>{
  if(fail)throw new Error('Simulated outage');
  const data=chartFixture(url.pathname.split('/').at(-1)),chart=data.chart.result[0];
  // Friday data returned on Monday must never be labelled today's chart.
  chart.meta.regularMarketTime-=86400*3;
  chart.meta.currentTradingPeriod.regular.start-=86400*3;
  chart.meta.currentTradingPeriod.regular.end-=86400*3;
  chart.timestamp=chart.timestamp.map(t=>t-86400*3);
  return {ok:true,json:async()=>data};
}});
const app=await createDashboard({port:4320,privateDir:scratch,market});
await new Promise(resolve=>app.server.listen(4320,'127.0.0.1',resolve));
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1148/chrome-win/chrome.exe')});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4320');
  await page.waitForFunction(()=>document.querySelectorAll('.stock-price').length===2);
  assert.equal(await page.locator('.stock-price').first().innerText(),'—');
  assert.equal(await page.locator('.stock-chart svg').count(),0);
  assert.match(await page.locator('#connection-label').innerText(),/offline/);
  fail=false;time+=61000;await page.getByRole('button',{name:'Refresh stock prices'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.stock-chart svg').length===2);
  assert.equal(await page.locator('[data-symbol=VOO] .stock-price').innerText(),'$606.00');
  assert.match(await page.locator('[data-symbol=VOO] .stock-session').innerText(),/Oct 23, 2026.*Last session/);
  assert.ok(!(await page.locator('.stock-session').first().innerText()).includes('Today'));
  const slider=page.getByRole('slider',{name:'VOO chart time'});
  await slider.focus();await slider.press('Home');assert.match(await slider.getAttribute('aria-valuetext'),/9:30 AM.*\$600.00/);
  const bounds=await slider.boundingBox();await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+20);
  assert.ok(!(await slider.getAttribute('aria-valuetext')).includes('9:30 AM'));
  await page.screenshot({path:'work/market-test-desktop.png',fullPage:true});
  for(const width of [900,768,590,390,320]){
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'work/market-test-mobile.png',fullPage:true});
  fail=true;time+=61000;await page.getByRole('button',{name:'Refresh stock prices'}).click();
  await page.waitForFunction(()=>document.querySelector('.stock-warning')?.textContent.includes('last successful'));
  assert.equal(await page.locator('[data-symbol=VOO] .stock-price').innerText(),'$606.00');
  assert.equal(await page.locator('.stock-chart svg').count(),2);
  await page.route('**/api/market',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.getByRole('button',{name:'Refresh stock prices'}).click();
  await page.waitForFunction(()=>document.querySelector('#market-status').textContent.includes('Could not refresh'));
  assert.equal(await page.locator('.stock-warning').count(),2);
  assert.equal(await page.locator('[data-symbol=VOO] .stock-price').innerText(),'$606.00');
  assert.deepEqual(errors,[]);
  console.log('PASS market outage, recovery, previous-session labels, keyboard/pointer chart inspection, stale quotes, 320–1440px layout, and operation without an extension');
}finally{await browser?.close();await app.close();}
