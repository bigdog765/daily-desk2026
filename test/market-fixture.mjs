// Fixed synthetic quotes, used only by isolated tests. Never served in production.
export const marketNow=Date.parse('2026-10-26T15:00:00Z');
export function chartFixture(symbol='VOO') {
  const start=Date.parse('2026-10-26T13:30:00Z')/1000,end=Date.parse('2026-10-26T20:00:00Z')/1000;
  const base=symbol==='VOO'?600:250,direction=symbol==='VOO'?1:-1;
  return {chart:{error:null,result:[{meta:{symbol,currency:'USD',range:'1d',regularMarketPrice:base+direction*6,regularMarketTime:marketNow/1000,
    previousClose:base,chartPreviousClose:base,currentTradingPeriod:{regular:{start,end}}},
    timestamp:Array.from({length:19},(_,i)=>start+i*300),
    indicators:{quote:[{close:Array.from({length:19},(_,i)=>base+direction*(i/3+Math.sin(i)*.8))}]}}]}};
}
