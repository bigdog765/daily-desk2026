const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const signedMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',signDisplay:'exceptZero'});
const signedPercent=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'});
const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const shortDay=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric'});
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function svgNode(tag,attributes,text){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text)node.textContent=text;return node;}
function chart(quote){
  const wrap=element('div','stock-chart');
  if(!quote.points?.length){wrap.append(element('p','chart-empty','Intraday chart unavailable.'));return wrap;}
  const points=quote.points,prices=points.map(point=>point.price);
  if(quote.previousClose!==null)prices.push(quote.previousClose);
  let low=Math.min(...prices),high=Math.max(...prices);
  const pad=Math.max((high-low)*.15,high*.00015);low-=pad;high+=pad;
  const start=quote.sessionStart??points[0].time,end=Math.max(quote.sessionEnd??points.at(-1).time,start+300);
  const x=time=>8+(time-start)/(end-start)*284,y=price=>64-(price-low)/(high-low)*56;
  const svg=svgNode('svg',{viewBox:'0 0 300 72',preserveAspectRatio:'none',role:'img','aria-label':`${quote.symbol} intraday price chart for ${quote.sessionDate}. ${money.format(Math.min(...points.map(p=>p.price)))} to ${money.format(Math.max(...points.map(p=>p.price)))}.${quote.previousClose===null?'':' Dashed line is the previous close.'}`});
  if(quote.previousClose!==null)svg.append(svgNode('line',{x1:8,x2:292,y1:y(quote.previousClose),y2:y(quote.previousClose),class:'chart-baseline'}));
  const path=points.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');
  svg.append(svgNode('path',{d:path+` L${x(points.at(-1).time)},72 L${x(points[0].time)},72 Z`,class:'chart-area'}));
  svg.append(svgNode('path',{d:path,class:'chart-line'}));
  const last=points.at(-1);svg.append(svgNode('circle',{cx:x(last.time),cy:y(last.price),r:2.8,class:'chart-end'}));
  const cursor=svgNode('circle',{cx:x(last.time),cy:y(last.price),r:3,class:'chart-cursor'});svg.append(cursor);
  // Keyboard and pointer access to the actual five-minute observations.
  const scrub=element('input','chart-scrub');scrub.type='range';scrub.min='0';scrub.max=String(points.length-1);scrub.value=scrub.max;scrub.step='1';scrub.setAttribute('aria-label',quote.symbol+' chart time');
  const readout=element('output','chart-readout');
  function inspect(){const point=points[Number(scrub.value)];readout.textContent=clock.format(new Date(point.time*1000))+' · '+money.format(point.price);scrub.setAttribute('aria-valuetext',readout.textContent);cursor.setAttribute('cx',x(point.time));cursor.setAttribute('cy',y(point.price));}
  scrub.addEventListener('input',inspect);inspect();
  scrub.addEventListener('pointermove',event=>{
    const bounds=scrub.getBoundingClientRect(),position=(event.clientX-bounds.left)/bounds.width*300;
    const time=start+(position-8)/284*(end-start);
    scrub.value=String(points.reduce((best,point,index)=>Math.abs(point.time-time)<Math.abs(points[best].time-time)?index:best,0));inspect();
  });
  const legend=element('div','chart-axis');
  legend.append(element('span','',clock.format(new Date(start*1000)).replace(/ [A-Z]+$/,'')),element('span','',quote.previousClose===null?'Previous close unavailable':'Prev. close '+money.format(quote.previousClose)),element('span','',clock.format(new Date(end*1000)).replace(/ [A-Z]+$/,'')));
  wrap.append(svg,legend,scrub,readout);return wrap;
}
function renderQuote(quote){
  const card=element('article','stock');card.dataset.symbol=quote.symbol;
  const direction=quote.change===null||quote.change===0?'flat':quote.change>0?'up':'down';card.classList.add(direction);
  const head=element('div','stock-heading'),identity=element('div','stock-identity');
  identity.append(element('h3','stock-symbol',quote.symbol),element('p','stock-name',quote.name));
  const value=element('div','stock-value');value.append(element('strong','stock-price',quote.price===null?'—':money.format(quote.price)));
  value.append(element('span','stock-change',quote.price===null?'Quote unavailable':quote.change===null?'Change unavailable':`${signedMoney.format(quote.change)} (${signedPercent.format(quote.changePercent)}%)`));
  head.append(identity,value);card.append(head);
  if(quote.price===null){card.append(element('p','stock-warning',quote.error||'Price feed unavailable. Please try again shortly.'));return card;}
  const date=new Date(quote.quoteAt),isToday=day.format(date)===day.format(new Date());
  card.append(element('p','stock-session',(isToday?'Today':shortDay.format(date))+' · '+clock.format(date)+(quote.marketState==='closed'?(isToday?' · Market closed':' · Last session'):'')));
  card.append(chart(quote));
  if(quote.stale)card.append(element('p','stock-warning','Refresh failed · Showing the last successful quote.'));
  else if(quote.marketState==='awaiting-session')card.append(element('p','stock-warning','Waiting for today’s regular-session quote.'));
  else if(quote.delayed)card.append(element('p','stock-warning','Quote is more than 20 minutes old.'));
  return card;
}
export function initMarketPanel(){
  const panel=document.querySelector('#market-panel'),quotes=document.querySelector('#market-quotes'),button=document.querySelector('#refresh-market'),status=document.querySelector('#market-status');
  let busy=false,lastData=null;
  async function refresh(){
    if(busy)return;busy=true;button.disabled=true;panel.setAttribute('aria-busy','true');
    try{
      const response=await fetch('/api/market',{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Stock prices could not be refreshed.');
      const data=await response.json();lastData=data;
      quotes.replaceChildren(...data.quotes.map(renderQuote));
      status.textContent=data.quotes.some(q=>q.error)?'Price feed interrupted · Retry shortly':'5-min charts · USD · Refreshes every minute';
    }catch{
      if(lastData)quotes.replaceChildren(...lastData.quotes.map(q=>renderQuote({...q,stale:q.price!==null})));
      else quotes.replaceChildren(...[{symbol:'VOO',name:'Vanguard S&P 500 ETF'},{symbol:'VB',name:'Vanguard Small-Cap ETF'}].map(q=>renderQuote({...q,price:null})));
      status.textContent='Could not refresh stock prices. Please try again.';
    }finally{busy=false;button.disabled=false;panel.setAttribute('aria-busy','false');}
  }
  button.addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  setInterval(()=>{if(!document.hidden)void refresh();},60000);
  void refresh();
}
