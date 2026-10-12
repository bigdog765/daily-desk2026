import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
export async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw new Error('A local data file could not be read: '+path.basename(file));}}
export class JsonStore{
  constructor(file,value){this.file=file;this.value=value;this.writes=Promise.resolve();}
  async save(){
    const text=JSON.stringify(this.value,null,2);
    this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',text,{mode:0o600});await rename(this.file+'.tmp',this.file);});
    return this.writes;
  }
  static async open(file,fallback){return new JsonStore(file,await readJson(file,fallback));}
}
