import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChart,createMarket} from '../src/market.mjs';
import {chartFixture,marketNow} from './market-fixture.mjs';

test('daily change uses the previous regular close, including negative moves',()=>{
  const up=parseChart('VOO',chartFixture('VOO'),marketNow),down=parseChart('VB',chartFixture('VB'),marketNow);
  assert.equal(up.price,606);assert.equal(up.change,6);assert.equal(up.changePercent,1);
  assert.equal(down.price,244);assert.equal(down.change,-6);assert.equal(down.changePercent,-2.4);
  assert.equal(up.sessionDate,'2026-10-26');assert.equal(up.marketState,'open');assert.equal(up.delayed,false);
  const payload=chartFixture();delete payload.chart.result[0].meta.previousClose;
  assert.equal(parseChart('VOO',payload,marketNow).previousClose,600);
  delete payload.chart.result[0].meta.chartPreviousClose;
  assert.equal(parseChart('VOO',payload,marketNow).change,null);
  const fractional=chartFixture('VB');fractional.chart.result[0].meta.previousClose=287.22;fractional.chart.result[0].meta.regularMarketPrice=288.335;
  const change=parseChart('VB',fractional,marketNow).change;
  assert.equal(change,1.115);
  assert.equal(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(change),'$1.12');
});

test('intraday points exclude nulls, other sessions and pre/post-market bars; no invented zero',()=>{
  const payload=chartFixture(),chart=payload.chart.result[0];
  chart.timestamp=[chart.meta.regularMarketTime-86400,chart.meta.currentTradingPeriod.regular.start-300,...chart.timestamp];
  chart.indicators.quote[0].close=[500,590,...chart.indicators.quote[0].close];
  chart.indicators.quote[0].close[5]=null;
  const quote=parseChart('VOO',payload,marketNow);
  assert.equal(quote.points.length,18);assert.ok(quote.points.every(p=>p.price>590));
  assert.equal(quote.points[0].time,chart.meta.currentTradingPeriod.regular.start);
  assert.equal(quote.points.at(-1).time,chart.meta.regularMarketTime);
});

test('closed, delayed, and previous-session data retain their real dates',()=>{
  const payload=chartFixture();
  assert.equal(parseChart('VOO',payload,marketNow+21*60000).delayed,true);
  const closed=parseChart('VOO',payload,Date.parse('2026-10-31T15:00:00Z'));
  assert.equal(closed.marketState,'closed');assert.equal(closed.sessionDate,'2026-10-26');
  const period=payload.chart.result[0].meta.currentTradingPeriod.regular;period.start+=86400;period.end+=86400;
  const pending=parseChart('VOO',payload,marketNow+86400000);
  assert.equal(pending.marketState,'awaiting-session');assert.equal(pending.sessionDate,'2026-10-26');
  assert.equal(pending.points.length,19);
});

test('invalid symbol, currency, missing quote, future data or provider error cannot masquerade as quotes',()=>{
  for(const change of [p=>p.chart.result[0].meta.symbol='BAD',p=>p.chart.result[0].meta.currency='CAD',p=>p.chart.result[0].meta.regularMarketPrice=null,p=>p.chart.result[0].meta.regularMarketTime+=86400,p=>p.chart.error={code:'Not Found'}]){
    const payload=chartFixture();change(payload);assert.throws(()=>parseChart('VOO',payload,marketNow));
  }
  assert.throws(()=>parseChart('MSFT',chartFixture(),marketNow));
});

test('concurrent refreshes share a one-minute cache; partial failures retain honest stale snapshots',async()=>{
  let time=marketNow,calls=0,fail=false;
  const market=createMarket({now:()=>time,fetchImpl:async(url,options)=>{
    calls++;assert.ok(options.signal);assert.equal(url.hostname,'query1.finance.yahoo.com');
    assert.equal(url.searchParams.get('range'),'1d');assert.equal(url.searchParams.get('includePrePost'),'false');
    const symbol=url.pathname.split('/').at(-1);
    return {ok:!(fail&&symbol==='VB'),json:async()=>chartFixture(symbol)};
  }});
  const [a,b]=await Promise.all([market.get(),market.get()]);assert.equal(calls,2);assert.deepEqual(a,b);
  await market.get();assert.equal(calls,2);
  time+=61000;fail=true;
  const partial=await market.get();assert.equal(calls,4);
  assert.equal(partial.quotes[0].stale,false);assert.equal(partial.quotes[1].stale,true);
  assert.equal(partial.quotes[1].price,244);assert.equal(partial.quotes[1].fetchedAt,new Date(marketNow).toISOString());
  await market.get();assert.equal(calls,4);
  time+=61000;fail=false;assert.equal((await market.get()).quotes[1].stale,false);
});

test('initial network failure has no fake numbers, and retries are rate limited',async()=>{
  let calls=0,time=marketNow;
  const market=createMarket({now:()=>time,fetchImpl:async()=>{calls++;throw new Error('Network error');}});
  const data=await market.get();assert.equal(calls,2);
  assert.ok(data.quotes.every(q=>q.price===null&&q.points.length===0&&q.error));
  await market.get();assert.equal(calls,2);time+=61000;await market.get();assert.equal(calls,4);
});

test('requests abort within the configured timeout',async()=>{
  const keepAlive=setTimeout(()=>{},1000);
  try{
    const market=createMarket({timeoutMs:20,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
    const data=await market.get();assert.ok(data.quotes.every(q=>q.error&&q.price===null));
  }finally{clearTimeout(keepAlive);}
});
