export const tasks = Object.freeze({
  briefing:{title:'Daily Briefing',chatId:'6a5a3671-1cc8-83ea-966f-7d6fe13d798f'},
  iphone:{title:'iPhone Deal Watch',chatId:'6aad3c40-08ac-83e9-bf5d-70c96bb2654d'}
});
export function allowedSender(sender){
  try{const u=new URL(sender.url);return sender.frameId===0 && !!sender.tab && ['http://127.0.0.1:4317','http://localhost:4317'].includes(u.origin) && ['/', '/setup'].includes(u.pathname);}catch{return false;}
}
export function taskFor(id){return Object.hasOwn(tasks,id)?tasks[id]:null;}
export function canRetry(id){return !!taskFor(id);}
