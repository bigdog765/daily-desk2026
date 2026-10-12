import crypto from 'node:crypto';
export const MCP_URL='https://agent.robinhood.com/mcp/trading';
const REGISTER='https://agent.robinhood.com/oauth/trading/register';
const TOKEN='https://api.robinhood.com/oauth2/token/';
export async function createRobinhood(settings,origin,{request=fetch}={}){
  const redirect=origin+'/oauth/robinhood/callback';
  let refreshing=null;
  async function post(url,body,json=false){
    const response=await request(url,{method:'POST',headers:{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'},body:json?JSON.stringify(body):new URLSearchParams(body),signal:AbortSignal.timeout(25000),redirect:'error'});
    const result=await response.json();
    if(!response.ok)throw new Error('Robinhood sign-in failed ('+response.status+'). Reconnect Robinhood in API settings.');
    return result;
  }
  async function storeToken(value){
    if(typeof value.access_token!=='string')throw new Error('Robinhood did not return an access token.');
    settings.secrets.robinhood={...settings.secrets.robinhood,...value,expiresAt:Date.now()+Number(value.expires_in||3600)*1000};await settings.saveSecrets();return value.access_token;
  }
  return {
    async connect(){
      if(!settings.secrets.robinhoodClient||settings.secrets.robinhoodClient.redirect!==redirect){
        const client=await post(REGISTER,{client_name:'Daily Desk Local',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},true);
        if(!client.client_id)throw new Error('Robinhood could not register this local website.');
        settings.secrets.robinhoodClient={client_id:client.client_id,redirect};
      }
      const state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
      settings.secrets.robinhoodPending={state,verifier,createdAt:Date.now()};await settings.saveSecrets();
      const url=new URL('https://robinhood.com/oauth');
      url.search=new URLSearchParams({client_id:settings.secrets.robinhoodClient.client_id,response_type:'code',redirect_uri:redirect,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope:'internal',state,resource:MCP_URL}).toString();
      return {url:url.href};
    },
    async callback(query){
      const pending=settings.secrets.robinhoodPending;
      if(!pending||query.get('state')!==pending.state||Date.now()-pending.createdAt>600000)throw new Error('The sign-in session expired or did not match. Start Connect Robinhood again.');
      if(query.get('error'))throw new Error('Robinhood sign-in was not completed.');
      const code=query.get('code');if(!code)throw new Error('Robinhood did not return a sign-in code.');
      delete settings.secrets.robinhoodPending;await settings.saveSecrets();
      return storeToken(await post(TOKEN,{grant_type:'authorization_code',client_id:settings.secrets.robinhoodClient.client_id,code,redirect_uri:redirect,code_verifier:pending.verifier,resource:MCP_URL}));
    },
    async token(){
      const current=settings.secrets.robinhood;
      if(!current?.access_token)throw new Error('Connect Robinhood in API settings before running this task.');
      if(current.expiresAt>Date.now()+60000)return current.access_token;
      if(!current.refresh_token)throw new Error('Robinhood sign-in expired. Reconnect in API settings.');
      if(!refreshing)refreshing=post(TOKEN,{grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:settings.secrets.robinhoodClient.client_id}).then(storeToken).finally(()=>refreshing=null);
      return refreshing;
    },
    async disconnect(){delete settings.secrets.robinhood;delete settings.secrets.robinhoodPending;await settings.saveSecrets();}
  };
}
