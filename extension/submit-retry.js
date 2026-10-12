// Self-contained DOM interaction. Only the exact user-requested message is sent.
export async function submitRetry(chatId){
  const allowed=['6aa2d72e-2a4c-83e9-b95a-7264914b4067','6a5a3671-1cc8-83ea-966f-7d6fe13d798f','6aad3c40-08ac-83e9-bf5d-70c96bb2654d'];
  const prompt='Try again today';
  const matches=()=>allowed.includes(chatId)&&location.origin==='https://chatgpt.com'&&location.pathname==='/c/'+chatId;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=node=>node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const findEditor=()=>[...document.querySelectorAll('#prompt-textarea,textarea[data-testid="prompt-textarea"],[contenteditable="true"][data-testid="prompt-textarea"]')].find(node=>visible(node)&&(node.isContentEditable||node.tagName==='TEXTAREA'));
  if(!matches())return {error:'This conversation is not enabled for a new daily prompt.',submitted:false};
  let editor;
  for(let attempt=0;attempt<100;attempt++){
    if(!matches())return {error:'Sign into the expected ChatGPT conversation first.',submitted:false};
    editor=findEditor();
    if(editor&&!editor.disabled)break;
    await wait(250);
  }
  if(!editor||editor.disabled)return {error:'The message box is unavailable. Check your signed-in browser connection in Connection setup.',submitted:false};
  if(document.querySelector('[data-testid="stop-button"],[data-is-streaming="true"],button[aria-label="Stop generating"]'))return {error:'This chat is already responding. Wait for it to finish, then use View response.',submitted:false};
  const value=()=>editor.tagName==='TEXTAREA'?editor.value:editor.innerText;
  const existingDraft=value().trim();
  if(existingDraft&&existingDraft!==prompt)return {error:'An unsent draft exists in this conversation. It was preserved; the daily prompt was not sent.',submitted:false};
  const usersBefore=[...document.querySelectorAll('[data-message-author-role="user"]')];
  const idsBefore=usersBefore.map(node=>node.getAttribute('data-message-id')).filter(Boolean);
  editor.focus();
  if(existingDraft===prompt){
    // A prior attempt may have entered the exact requested prompt without sending.
    // Reuse it on this explicit click; never append a duplicate or replace other text.
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  }else if(editor.tagName==='TEXTAREA'){
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,prompt);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  }else{
    const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    const inserted=document.execCommand('insertText',false,prompt);
    if(!inserted||value().trim()!==prompt)return {error:'Could not enter the prompt in the message box. No send was attempted.',submitted:false};
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));
  }
  let send;
  for(let attempt=0;attempt<40;attempt++){
    editor=findEditor()||editor;
    send=[...document.querySelectorAll('button[data-testid="send-button"],button#composer-submit-button,button[aria-label="Send prompt"],button[aria-label="Send message"]')].find(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
    if(send&&value().trim()===prompt)break;
    await wait(150);
  }
  if(!matches()||value().trim()!==prompt||!send||send.disabled||send.getAttribute('aria-disabled')==='true'||!visible(send))return {error:'The message composer did not enable Send. The prompt was not sent.',submitted:false};
  // One click only. Never click confirmation controls or automatically retry a send.
  send.click();
  for(let attempt=0;attempt<80;attempt++){
    const users=[...document.querySelectorAll('[data-message-author-role="user"]')];
    const latest=users.at(-1);
    const id=latest?.getAttribute('data-message-id');
    const isNew=(id&&!idsBefore.includes(id))||users.length>usersBefore.length;
    if(isNew&&latest.innerText.trim()===prompt)return {submitted:true,after:{userId:id||null,userCount:users.length,prompt}};
    await wait(250);
  }
  return {error:'Send was clicked, but the new message could not be confirmed. Use View response to check for a reply before sending again.',submitted:'unknown'};
}
