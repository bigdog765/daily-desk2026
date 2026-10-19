// This function runs only in the exact task conversation, in Chrome's isolated world.
// It reads rendered assistant text. It does not read cookies, credentials, or send messages.
export async function readResponse(chatId,after=null){
  const dom=globalThis.dailyDeskDOM;
  const expected='/c/'+chatId;
  if(location.origin!=='https://chatgpt.com'||location.pathname!==expected)return {error:'The expected ChatGPT conversation is not open. Sign into ChatGPT normally, then try again.'};
  const deadline=Date.now()+(after?600000:55000);
  let previous='',stableSince=0;
  while(Date.now()<deadline){
    if(location.pathname!==expected)return {error:'ChatGPT redirected to sign-in. Sign into ChatGPT in your normal browser, then try again.'};
    const all=dom.messages('assistant');
    const message=all.at(-1);
    const users=after?dom.messages('user'):[];
    const sentUser=after?(after.userId?users.find(node=>dom.messageId(node)===after.userId):users.length>=after.userCount?users.at(-1):null):null;
    const isNewResponse=!after||!!(sentUser&&dom.text(sentUser)===after.prompt&&message&&(sentUser.compareDocumentPosition(message)&Node.DOCUMENT_POSITION_FOLLOWING));
    const text=dom.text(message);
    const streaming=dom.streaming();
    if(text && !streaming && isNewResponse){
      if(text!==previous){previous=text;stableSince=Date.now();}
      else if(Date.now()-stableSince>=1500){
        const sources=[...message.querySelectorAll('a[href]')].map(a=>({title:a.textContent.trim().slice(0,300),url:a.href})).filter(a=>/^https?:\/\//.test(a.url)).slice(0,100);
        const visibleConfirmation=[...message.querySelectorAll('button'),...document.querySelectorAll('[role="dialog"] button,[role="alertdialog"] button')].some(button=>button.getClientRects().length&&/^(Allow|Approve|Confirm trade|Confirm order|Submit order)( once| always)?$/i.test(button.innerText.trim()));
        if(visibleConfirmation)return {error:'ChatGPT is waiting for permission or an order confirmation. This extension does not click approval controls. Your previous report is still saved.'};
        return {text:text.slice(0,200000),sources,messageId:dom.messageId(message)};
      }
    }else {previous='';stableSince=0;}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  return {error:after?'A completed new response is not available yet. Use Sync latest shortly to check again. The prompt will not be resent automatically.':'The conversation opened, but no completed response became available. Use Sync latest once ChatGPT has finished responding.'};
}
