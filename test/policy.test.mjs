import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskFor,allowedSender,canRetry,tasks} from '../extension/policy.js';
test('only the three linked tasks and the local dashboard may invoke the extension',()=>{
  assert.equal(Object.keys(tasks).length,3);
  for(const id of ['briefing','iphone','robinhood']){assert.ok(taskFor(id).chatId);assert.equal(canRetry(id),true);}
  for(const id of ['__proto__','constructor','arbitrary']){assert.equal(taskFor(id),null);assert.equal(canRetry(id),false);}
  assert.equal(allowedSender({url:'http://127.0.0.1:4317/',frameId:0,tab:{id:1}}),true);
  for(const url of ['https://evil.example/','http://127.0.0.1:4317.evil.example/','http://localhost:9999/','http://127.0.0.1:4317/unknown'])assert.equal(allowedSender({url,frameId:0,tab:{id:1}}),false);
  assert.equal(allowedSender({url:'http://127.0.0.1:4317/',frameId:1,tab:{id:1}}),false);
});
