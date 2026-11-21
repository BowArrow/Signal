import {studioCommand} from '../apps/demo-studio/client.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const command=JSON.parse(readFileSync(process.argv[2],'utf8'));
const result=await studioCommand(command);
mkdirSync('output/lemonade-work-assistant-20261112/receipts',{recursive:true});
writeFileSync('output/lemonade-work-assistant-20261112/receipts/'+command.action+'-'+Date.now()+'.json',JSON.stringify(result,null,2));
if(['product.resume','session.open','launch'].includes(command.action))console.log(JSON.stringify({saved:result.saved,sessionId:result.sessionId,keys:Object.keys(result),observation:result.observation,ready:result.product?.ready}));
else console.log(JSON.stringify(result));
