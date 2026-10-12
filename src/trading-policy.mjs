export const READ_TOOLS=['get_accounts','get_portfolio','get_scans','run_scan','get_earnings_results','get_equity_fundamentals','get_financials','get_equity_tradability','get_equity_quotes','get_equity_orders','get_trade_approval_setting','get_trade_approvals','get_sec_filing_index','get_sec_filing','get_sec_filing_facts','get_sec_filing_facts_catalog','search'];
export const ORDER_TOOLS=['review_equity_order','place_equity_order'];
export function parseArguments(value){try{const args=typeof value==='string'?JSON.parse(value):value;return args&&typeof args==='object'&&!Array.isArray(args)?args:null;}catch{return null;}}
export function brokerPreview(output){
  const value=parseArguments(output);if(!value||value.isError)return null;
  const data=value.structuredContent?.data||value.data;
  if(data&&typeof data==='object')return data;
  for(const part of value.content||[]){if(part.type==='text'){const parsed=brokerPreview(part.text);if(parsed)return parsed;}}
  return null;
}
function normalized(args){return {account_number:args.account_number,symbol:args.symbol,side:args.side,type:args.type,quantity:args.quantity??null,dollar_amount:args.dollar_amount??null,limit_price:args.limit_price??null,market_hours:args.market_hours||'regular_hours',time_in_force:args.time_in_force||'gfd'};}
export function orderCheck(args,{accountNumber,review,orderConsumed=false,refId,now=new Date(),placement=false}={}){
  if(!args)return 'The order arguments are invalid.';
  if(!accountNumber||args.account_number!==accountNumber)return 'Select your brokerage account in API settings. The order must use that exact account.';
  const keys=new Set(['account_number','symbol','side','type','quantity','dollar_amount','limit_price','market_hours','time_in_force','ref_id']);
  if(Object.keys(args).some(key=>!keys.has(key)))return 'Unsupported order fields are blocked.';
  if(args.side!=='buy')return 'Only BUY orders are permitted.';
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(args.symbol||''))return 'A valid equity ticker is required.';
  if((args.market_hours||'regular_hours')!=='regular_hours'||(args.time_in_force||'gfd')!=='gfd')return 'Only regular-hours orders that expire today are permitted.';
  const dollar=args.dollar_amount!==undefined,shares=args.quantity!==undefined;
  if(dollar===shares)return 'Specify either a dollar amount or a share quantity.';
  let amount;
  if(dollar){if(args.type!=='market'||args.limit_price!==undefined)return 'Dollar-based fractional orders must use the broker-supported market order type.';amount=Number(args.dollar_amount);}
  else{if(args.type!=='limit'||!Number.isInteger(Number(args.quantity))||Number(args.quantity)<=0||!Number.isFinite(Number(args.limit_price))||Number(args.limit_price)<=0)return 'Share-based orders require positive whole shares and a limit price.';amount=Number(args.quantity)*Number(args.limit_price);}
  if(!Number.isFinite(amount)||amount<=0||amount>20)return 'The order exceeds the $20 maximum or has an invalid amount.';
  if(orderConsumed)return 'This run has already used its one order attempt. No additional order is allowed.';
  if(placement){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    const minute=Number(parts.hour)*60+Number(parts.minute);
    if(['Sat','Sun'].includes(parts.weekday)||minute<570||minute>=960)return 'The regular U.S. trading session is closed. Orders for a future session are blocked.';
    if(!review||JSON.stringify(normalized(args))!==JSON.stringify(normalized(review.args)))return 'The order must exactly match the broker preview from this run.';
    const preview=brokerPreview(review.output);
    if(!preview||preview.symbol!==args.symbol||preview.side!=='buy'||!preview.quote_data||!preview.market_data_disclosure)return 'A valid broker preview with current quote disclosure is required before submission.';
    if(!preview.order_checks||typeof preview.order_checks!=='object'||Object.keys(preview.order_checks).length)return 'The broker preview contains an alert or could not confirm its checks. No order will be submitted.';
    if(Date.now()-review.receivedAt>120000)return 'The broker preview is older than two minutes. Run the task again for a fresh preview.';
    if(!refId||args.ref_id!==refId)return 'The order must use this run’s fixed idempotency key.';
  }
  return null;
}
