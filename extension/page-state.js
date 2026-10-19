// Read-only checks of the rendered page. No cookies, tokens, or conversation text
// are included in diagnostics. This function must remain self-contained for injection.
export function inspectPage(chatId){
  const visible=node=>!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const count=selector=>document.querySelectorAll(selector).length;
  const dom=globalThis.dailyDeskDOM;
  const editors=dom.editor()?[dom.editor()]:[];
  const assistantCount=dom.messages('assistant').length;
  const userCount=dom.messages('user').length;
  const uiText=[...document.querySelectorAll('h1,h2,[role="alert"],[role="dialog"]')].filter(node=>visible(node)&&!node.closest('[data-message-author-role]')).map(node=>node.innerText).join('\n');
  const signIn=[...document.querySelectorAll('button,a')].some(node=>visible(node)&&/^(Log in|Sign in)$/i.test(node.innerText.trim()));
  let status='loading',error=null;
  if(location.origin!=='https://chatgpt.com'||location.pathname!=='/c/'+chatId){status='wrong-page';error='The browser did not open the linked ChatGPT conversation. Check that this account still has access to it.';}
  else if(/just a moment|verify (you are|that you are) human|security verification/i.test(document.title+'\n'+uiText)||document.querySelector('iframe[src*="challenges.cloudflare.com"]')){status='verification';error='ChatGPT is showing a browser verification screen. Complete it in your normal browser, then use Sync latest.';}
  else if(/unable to load conversation|conversation (not found|unavailable)|you do not have access|you don.t have access/i.test(uiText)){status='unavailable';error='ChatGPT says this conversation is unavailable to the signed-in account. The linked chat or account needs checking.';}
  else if(signIn&&!assistantCount&&!userCount){status='signed-out';error='ChatGPT is showing Log in in the browser used by the extension. Sign into that browser profile, then use Sync latest.';}
  else if(/application error|something went wrong|a client.side exception/i.test(uiText)){status='page-error';error='ChatGPT displayed a page error before the conversation became available. Try Sync latest again after the page recovers.';}
  else if(assistantCount||editors.length)status='ready';
  return {status,error,diagnostics:{status,readyState:document.readyState,visibility:document.visibilityState,assistantCount,userCount,composerCount:editors.length,conversationTurnCount:count('[data-testid^="conversation-turn"]'),frameCount:count('iframe'),bodyCharacters:document.body?.innerText?.length||0,structure:dom.structure()}};
}
