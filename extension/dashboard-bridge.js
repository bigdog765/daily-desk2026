(() => {
  if(!['http://127.0.0.1:4317','http://localhost:4317'].includes(location.origin)||!['/','/setup'].includes(location.pathname))return;
  window.addEventListener('message',event=>{
    const value=event.data;
    if(event.source!==window||event.origin!==location.origin||value?.channel!=='daily-desk-page-v1'||!['ping','read','retry'].includes(value.action)||typeof value.id!=='string')return;
    if(value.id.length>100)return;
    chrome.runtime.sendMessage({channel:'daily-desk-v1',action:value.action,taskId:value.taskId},response=>{
      const error=chrome.runtime.lastError;
      window.postMessage({channel:'daily-desk-extension-v1',id:value.id,...(error?{ok:false,error:'Reload the dashboard after installing or updating its extension.'}:response)},location.origin);
    });
  });
})();
