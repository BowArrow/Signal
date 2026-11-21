import {app} from 'electron';
import {join} from 'node:path';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createApp} from '../src/core/app.js';
import {silentLogger} from '../src/core/lib/logger.js';
import {AccountVault} from '../electron/main/connection-handlers.js';
import {ConnectionService} from '../src/core/connections/service.js';
import {connectionCredentialId} from '../src/shared/connections.js';
const owner=join(process.env.APPDATA!,'signal'),profile=mkdtempSync(join(tmpdir(),'lemonade-search-audit-'));
copyFileSync(join(owner,'Local State'),join(profile,'Local State'));app.disableHardwareAcceleration();app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const signal=createApp({databaseUrl:join(owner,'signal.db'),logger:silentLogger,migrate:false});
 const vault=new AccountVault(join(owner,'account-credentials'));
 const connections=new ConnectionService(signal,vault,async()=>{throw Error('Existing verified connection required');});
 try {
  const account=connections.accounts().find(a=>a.provider==='search-console'&&a.productId==='CzP0iRc7x8uUdmTdZE25h'&&a.status==='verified');
  if(!account)throw Error('Lemonade Search Console connection unavailable');
  await connections.verify(account.productId,account.id,true);
  const credential=JSON.parse(vault.get('account.'+connectionCredentialId(account))!);
  const result:Record<string,unknown>={checkedAt:new Date().toISOString(),site:'https://siplemona.de/',startDate:'2026-10-13',endDate:'2026-11-09'};
  for(const [key,dimensions] of [['totals',[]],['dates',['date']],['pages',['page']]] as const){
   const response=await fetch('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent('https://siplemona.de/')+'/searchAnalytics/query',{method:'POST',headers:{authorization:'Bearer '+credential.accessToken,'content-type':'application/json'},body:JSON.stringify({startDate:result.startDate,endDate:result.endDate,type:'web',dataState:'final',dimensions,rowLimit:25000})});
   if(!response.ok)throw Error('Search analytics HTTP '+response.status);
   result[key]=await response.json();
  }
  writeFileSync('output/lemonade-work-assistant-20261112/evidence/search-totals.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({totals:result.totals,pages:result.pages}));
 }finally{connections.cancelOAuth();signal.close();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e.message);app.exit(1)});
