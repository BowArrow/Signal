const {app,safeStorage}=require('electron');
const {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {createHash}=require('node:crypto');
const Database=require('better-sqlite3');
const temporary=process.env.SIGNAL_LTD_HELPER_PROFILE;
if(!temporary)throw Error('Use the launcher');
const owner=join(process.env.APPDATA,'signal'),folder=resolve('output/ltd-rollout');
const targets=[
 {key:'lifetimo',to:'contact@lifetimo.com',source:'https://lifetimo.com/privacy-policy/'},
 {key:'ltdhunt',to:'support@ltdhunt.com',source:'https://ltdhunt.com/privacy-policy/'},
];
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2));
app.disableHardwareAcceleration();app.setPath('userData',temporary);mkdirSync(temporary,{recursive:true});copyFileSync(join(owner,'Local State'),join(temporary,'Local State'));
app.whenReady().then(async()=>{
 const db=new Database(join(owner,'signal.db'),{readonly:true,fileMustExist:true,nativeBinding:resolve('native/better_sqlite3-electron.node')});
 try {
  const product=db.prepare("SELECT id FROM products WHERE key='lemonade'").get();if(!product)throw Error('Missing Lemonade');
  const rows=db.prepare('SELECT key,value FROM settings').all();
  console.log(JSON.stringify({localMatches:rows.filter(r=>/AION C LLC|scene planning to final cut|yadira\.whitney/i.test(r.value)).map(r=>({key:r.key,typo:/AION C LLC/i.test(r.value),subject:/scene planning to final cut/i.test(r.value)})),outreachRecords:rows.filter(r=>/^sales\.(outreach|reply)\./.test(r.key)).map(r=>{const v=JSON.parse(r.value);return {key:r.key,status:v.status,subject:v.subject,attemptedAt:v.attemptedAt,sentAt:v.sentAt}}),operationStates:rows.filter(r=>/^operations\.policy\./.test(r.key)).map(r=>({key:r.key,running:JSON.parse(r.value).running}))}));
  if(!safeStorage.isEncryptionAvailable())throw Error('Encrypted storage unavailable');
  const accounts=db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(r=>JSON.parse(r.value));
  const account=accounts.find(a=>a.provider==='gmail'&&a.status==='verified');
  if(!account||!account.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send'))throw Error('Verified Lemonade Gmail sending permission required');
  const family=account.credentialId||account.id;
  const credentialFile=createHash('sha256').update('account.'+family).digest('hex')+'.enc';
  const saved=JSON.parse(safeStorage.decryptString(readFileSync(join(owner,'account-credentials',credentialFile))));
  let token=saved.accessToken;
  if(saved.refreshToken){
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:saved.refreshToken,client_id:saved.clientId,...(saved.clientSecret?{client_secret:saved.clientSecret}:{})})});
   if(!response.ok)throw Error('Google refresh HTTP '+response.status);const next=await response.json();if(typeof next.access_token!=='string')throw Error('Missing renewed token');token=next.access_token;
  }
  async function gmail(path,body){const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('Gmail HTTP '+response.status);return response.json();}

  function textParts(p){return (p?.mimeType==='text/plain'&&p.body?.data?Buffer.from(p.body.data,'base64url').toString('utf8'):'')+(p?.parts??[]).map(textParts).join('\n');}
  const queries=[{key:'same-template',q:'in:sent newer_than:30d "AION C LLC"',max:25}];
  const report=[];
  for(const query of queries){
   const page=await gmail('messages?'+new URLSearchParams({q:query.q,maxResults:String(query.max)}));const messages=[];
   for(const m of page.messages??[]){const full=await gmail('messages/'+m.id+'?format=full');const headers=full.payload?.headers??[],h=n=>headers.find(h=>h.name.toLowerCase()===n)?.value??'';const content=textParts(full.payload)||full.snippet||'';
    messages.push({id:m.id,date:new Date(Number(full.internalDate)).toISOString(),from:h('from'),subject:h('subject'),...(query.key==='same-template'?{sendingApplications:headers.filter(h=>h.name.toLowerCase()==='received').map(h=>h.value.match(/from (\d+) named unknown/)?.[1]).filter(Boolean)}:{}),...(query.key==='google-access'?{accessMentions:content.split('\n').filter(l=>/access to|connected|220200093735|polsia|apollo|composio|pipedream/i.test(l)).map(l=>l.slice(0,350)),clientIds:[...new Set(content.match(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/g)||[])]}:{})});
   }
   report.push({query:query.key,hasMore:!!page.nextPageToken,messages});
  }
  save(join(folder,'sender-same-template.json'),report);console.log(JSON.stringify(report));
 } finally {db.close();}
}).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1);});
