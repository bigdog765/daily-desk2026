// Yahoo's public chart feed needs no account/key. It is not a contracted API;
// keep its adapter isolated and show failures instead of inventing quote data.
export const funds = Object.freeze([
  {symbol:'VOO',name:'Vanguard S&P 500 ETF'},
  {symbol:'VB',name:'Vanguard Small-Cap ETF'}
]);
const positive = value => Number.isFinite(value) && value > 0;
const dateKey = seconds => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000));
const iso = seconds => new Date(seconds*1000).toISOString();

export function parseChart(symbol, payload, now=Date.now()) {
  const fund=funds.find(item=>item.symbol===symbol);
  const chart=payload?.chart?.result?.[0],meta=chart?.meta;
  if(!fund || payload?.chart?.error || meta?.symbol!==symbol || meta.currency!=='USD' ||
    !positive(meta.regularMarketPrice) || !positive(meta.regularMarketTime) ||
    meta.regularMarketTime>now/1000+300 || (meta.range && meta.range!=='1d')) throw new Error('Invalid market quote');
  const sessionDate=dateKey(meta.regularMarketTime);
  const previousClose=positive(meta.previousClose)?meta.previousClose:positive(meta.chartPreviousClose)?meta.chartPreviousClose:null;
  const values=chart.indicators?.quote?.[0]?.close || [];
  const regular=meta.currentTradingPeriod?.regular;
  const hasPeriod=positive(regular?.start)&&positive(regular?.end)&&regular.end>regular.start;
  const quoteInPeriod=hasPeriod&&dateKey(regular.start)===sessionDate;
  // A one-day result can still include null bars or the previous session before
  // today's open. Never mix sessions or draw null prices as zero.
  const points=[...new Map((chart.timestamp||[]).flatMap((time,index)=>
    positive(time)&&positive(values[index])&&time<=meta.regularMarketTime&&dateKey(time)===sessionDate&&
    (!quoteInPeriod || (time>=regular.start && time<=regular.end))
      ?[[time,{time,price:values[index]}]]:[])).values()].sort((a,b)=>a.time-b.time);
  if(quoteInPeriod && points.length && points.at(-1).time<meta.regularMarketTime)
    points.push({time:meta.regularMarketTime,price:meta.regularMarketPrice});
  const marketOpen=hasPeriod&&now/1000>=regular.start&&now/1000<regular.end;
  const awaitingSession=marketOpen&&sessionDate!==dateKey(regular.start);
  // Remove subtraction noise (288.335 - 287.22 becomes 1.114999...) so
  // half-cent changes round consistently with decimal market prices.
  const change=previousClose===null?null:Number((meta.regularMarketPrice-previousClose).toFixed(8));
  return {...fund,currency:'USD',price:meta.regularMarketPrice,previousClose,
    change,changePercent:previousClose===null?null:change/previousClose*100,
    quoteAt:iso(meta.regularMarketTime),sessionDate,points,
    sessionStart:quoteInPeriod?regular.start:points[0]?.time??null,
    sessionEnd:quoteInPeriod?regular.end:points.at(-1)?.time??null,
    marketState:awaitingSession?'awaiting-session':marketOpen?'open':'closed',
    delayed:marketOpen&&now/1000-meta.regularMarketTime>20*60};
}

export function createMarket({fetchImpl=fetch,now=Date.now,cacheMs=60000,timeoutMs=8000}={}) {
  const cache=new Map();
  async function quote(fund) {
    let entry=cache.get(fund.symbol);
    if(entry?.pending)return entry.pending;
    if(entry && now()-entry.attemptedAt<cacheMs)return snapshot(entry,fund);
    entry??={};cache.set(fund.symbol,entry);entry.attemptedAt=now();
    entry.pending=(async()=>{
      try {
        const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+fund.symbol);
        url.search=new URLSearchParams({interval:'5m',range:'1d',includePrePost:'false'}).toString();
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'},redirect:'error'});
        if(!response.ok)throw new Error('Market provider unavailable');
        const payload=await response.json();
        parseChart(fund.symbol,payload,now());
        entry.payload=payload;entry.fetchedAt=new Date(now()).toISOString();entry.error=null;
      } catch {
        entry.error='Price feed unavailable. Please try again shortly.';
      }
      return snapshot(entry,fund);
    })();
    try{return await entry.pending;}finally{entry.pending=null;}
  }
  function snapshot(entry,fund) {
    if(!entry.payload)return {...fund,error:entry.error,price:null,points:[],stale:false};
    return {...parseChart(fund.symbol,entry.payload,now()),fetchedAt:entry.fetchedAt,
      stale:!!entry.error,error:entry.error};
  }
  return {async get(){return {source:'Yahoo Finance',intervalMinutes:5,refreshSeconds:60,quotes:await Promise.all(funds.map(quote))};}};
}
