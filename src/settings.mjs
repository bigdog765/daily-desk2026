import {readFile,writeFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {JsonStore} from './store.mjs';
export const MODELS=['gpt-5.4-mini','gpt-5.4','gpt-6-astra'];
function protect(value,decrypt=false){
  if(process.platform!=='win32')return Promise.resolve(value);
  const operation=decrypt?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($inputText); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='';child.stdout.on('data',data=>out+=data);child.stderr.resume();
    child.on('error',()=>reject(new Error('Windows credential protection is unavailable.')));
    child.on('close',code=>code===0?resolve(Buffer.from(out.trim(),'base64')):reject(new Error('Windows could not unlock the saved credentials for this user.')));
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}
export async function createSettings(privateDir,{env=process.env}={}){
  const preferences=await JsonStore.open(path.join(privateDir,'settings.json'),{model:'gpt-5.4-mini',robinhoodModel:'gpt-5.4'});
  const secretPath=path.join(privateDir,process.platform==='win32'?'credentials.dpapi':'credentials.json');
  let secrets={};
  try{secrets=JSON.parse((await protect(await readFile(secretPath),true)).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let writing=Promise.resolve();
  async function saveSecrets(){
    const snapshot=JSON.stringify(secrets);
    writing=writing.catch(()=>{}).then(async()=>{const data=await protect(Buffer.from(snapshot));await writeFile(secretPath+'.tmp',data,{mode:0o600});await rename(secretPath+'.tmp',secretPath);});return writing;
  }
  const apiKey=()=>secrets.apiKey||env.OPENAI_API_KEY||'';
  return {
    apiKey,secrets,preferences,
    model:id=>id==='robinhood'?preferences.value.robinhoodModel:preferences.value.model,
    saveSecrets,
    public(){return {keyAvailable:!!apiKey(),keySource:secrets.apiKey?'saved':env.OPENAI_API_KEY?'environment':'none',model:preferences.value.model,robinhoodModel:preferences.value.robinhoodModel,models:MODELS,robinhoodConnected:!!secrets.robinhood?.access_token,accountNumber:secrets.accountNumber?'••••'+secrets.accountNumber.slice(-4):null};},
    async update(body){
      for(const name of ['model','robinhoodModel'])if(body[name]!==undefined){if(!MODELS.includes(body[name]))throw new Error('Choose one of the available models.');}
      if(body.apiKey!==undefined&&body.apiKey!==''&&(typeof body.apiKey!=='string'||body.apiKey.length<20||body.apiKey.length>1000||/\s/.test(body.apiKey)))throw new Error('Enter a valid API key.');
      if(body.accountNumber!==undefined&&body.accountNumber!==''&&!/^\d{4,30}$/.test(body.accountNumber))throw new Error('Enter the numeric brokerage account number.');
      for(const name of ['model','robinhoodModel'])if(body[name])preferences.value[name]=body[name];
      if(body.apiKey)secrets.apiKey=body.apiKey;
      if(body.accountNumber)secrets.accountNumber=body.accountNumber;
      await saveSecrets();await preferences.save();return this.public();
    }
  };
}
