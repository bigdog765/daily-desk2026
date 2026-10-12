const researchLimits={briefing:6,iphone:8};

export function initialPhase(taskId){return taskId in researchLimits?'research':'execution';}

export function runPlan(taskId,phase){
  if(phase==='report')return {
    reasoning:{effort:'low'},max_output_tokens:6000,tools:[],tool_choice:'none',
    instructions:'Research for this run is finished. This is the final writing step: do not search or request tools. Use only verified evidence collected in THIS run, never old reports as current facts. Produce the requested concise report now, with clickable source URLs. Omit unsupported items and explicitly state any important checks or categories that could not be verified. Do not invent facts to fill gaps. Keep the briefing under 650 words and a deal report under 800 words. If research was cut short, acknowledge the limited coverage and never use NO_STANDOUT_DEAL to imply that a complete deal check succeeded.'
  };
  if(phase==='research')return {
    reasoning:{effort:'low'},max_output_tokens:6000,max_tool_calls:researchLimits[taskId],tool_choice:'required',
    instructions:`This is the research step. You have at most ${researchLimits[taskId]} web tool actions, including searches, page opens, and finds. Plan broad, grouped queries, prioritize primary sources, and stop searching within that allowance. Spend the remaining budget writing compact evidence notes (under 1000 words) with facts, dates, source URLs, and any limitations for the next writing step. Do not keep searching to fill every category. For a briefing, prioritize at most six meaningful items from the past day. For deals, cover the requested retailer groups with grouped searches, then verify only the strongest candidates and their terms. Mark any unverified coverage honestly. If a completed deal check finds nothing qualifying, use NO_STANDOUT_DEAL. The next step will write the final report from this evidence.`
  };
  return {reasoning:{effort:'medium'},max_output_tokens:7000,max_tool_calls:18,instructions:''};
}

export function responseDiagnostics(response,phase){
  const output=response.output||[];
  const tools=output.filter(item=>['web_search_call','mcp_call'].includes(item.type));
  const number=value=>Number.isFinite(value)?value:0;
  return {
    responseId:response.id,phase,status:response.status,
    incompleteReason:response.incomplete_details?.reason||null,
    errorCode:response.error?.code||null,
    maxOutputTokens:response.max_output_tokens??null,maxToolCalls:response.max_tool_calls??null,
    usage:response.usage?{
      input_tokens:number(response.usage.input_tokens),output_tokens:number(response.usage.output_tokens),
      total_tokens:number(response.usage.total_tokens),
      input_tokens_details:{cached_tokens:number(response.usage.input_tokens_details?.cached_tokens)},
      output_tokens_details:{reasoning_tokens:number(response.usage.output_tokens_details?.reasoning_tokens)}
    }:null,
    toolCalls:tools.length,completedToolCalls:tools.filter(item=>item.status==='completed').length,
    outputTextCharacters:output.filter(item=>item.type==='message').flatMap(item=>item.content||[]).reduce((count,part)=>count+(part.type==='output_text'?(part.text||'').length:0),0),
    recordedAt:new Date().toISOString()
  };
}

export function totalUsage(diagnostics){
  const usages=diagnostics.map(item=>item.usage).filter(Boolean);
  if(!usages.length)return null;
  return usages.reduce((sum,usage)=>({
    input_tokens:sum.input_tokens+usage.input_tokens,output_tokens:sum.output_tokens+usage.output_tokens,total_tokens:sum.total_tokens+usage.total_tokens,
    input_tokens_details:{cached_tokens:sum.input_tokens_details.cached_tokens+usage.input_tokens_details.cached_tokens},
    output_tokens_details:{reasoning_tokens:sum.output_tokens_details.reasoning_tokens+usage.output_tokens_details.reasoning_tokens}
  }),{input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}});
}
