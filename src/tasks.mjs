import {readFile} from 'node:fs/promises';
import {tasks as linkedTasks} from '../extension/policy.js';
const categories={briefing:'YOUR WORLD',iphone:'DEAL WATCH'};
export const tasks=Object.entries(linkedTasks).map(([id,task])=>({id,...task,category:categories[id]}));
export async function loadPrompts(root){return Object.fromEntries(await Promise.all(tasks.map(async task=>[task.id,await readFile(root+'/prompts/'+task.id+'.md','utf8')])));}
