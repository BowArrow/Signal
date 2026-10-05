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
 const db=new Database(join(owner,'signal.db'),{fileMustExist:true,nativeBinding:resolve('native/better_sqlite3-electron.node')});
 try {
  const product=db.prepare("SELECT id FROM products WHERE key='lemonade'").get();if(!product)throw Error('Missing Lemonade');
  const mode=process.env.SIGNAL_LTD_MAIL_MODE;
  if(mode==='record'){
   const backups=join(process.env.LOCALAPPDATA,'Signal/backups');mkdirSync(backups,{recursive:true});await db.backup(join(backups,`before-ltd-delivery-${Date.now()}.db`));
   const updates=[];
   db.transaction(()=>{
    for(const key of ['kenmoo','lifetimo','ltdhunt']){
     const campaign=`lemonade-ltd-${key}-20260921`,id=`${campaign}-admin`;
     const row=db.prepare('SELECT value FROM studio_leads WHERE id=? AND product_id=?').get(id,product.id);if(!row)throw Error('Missing LTD prospect');
     const receiptPath=join(folder,`${key}-email-receipt.json`),formPath=join(folder,`${key}-receipt.json`);
     const receipt=existsSync(receiptPath)?read(receiptPath):existsSync(formPath)?read(formPath):null;
     const accepted=receipt&&['sent_copy_verified','form_accepted','user_confirmed_submission'].includes(receipt.status);
     const value=JSON.parse(row.value);
     const marker='\n\n[2026-09-21 rollout]';
     value.notes=value.notes.split(marker)[0]+marker+' '+(accepted?`Founder inquiry sent. ${receipt.status}; receipt: ${existsSync(receiptPath)?receiptPath:formPath}. Awaiting administrator response; no community placement or permission confirmed.`:`No confirmed delivery. ${receipt?.status??'chat unavailable; email pending'}. Finished ad: https://siplemona.de/ads/lemonade-ltd/`);
     if(accepted){value.stage=value.stage==='discovered'?'contacted':value.stage;value.followUpAt=Date.parse('2026-09-24T17:00:00Z');}
     // This is a review reminder, not consent or an automatic follow-up.
     db.prepare('UPDATE studio_leads SET value=? WHERE id=? AND product_id=?').run(JSON.stringify(value),id,product.id);
     updates.push({key,stage:value.stage,permission:value.permission,status:receipt?.status??'pending'});
    }
   })();
   save(join(folder,'signal-recorded.json'),{at:new Date().toISOString(),updates});console.log(JSON.stringify({updates}));return;
  }
  if(!safeStorage.isEncryptionAvailable())throw Error('Encrypted storage unavailable');
  const accounts=db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(r=>JSON.parse(r.value));
  const account=accounts.find(a=>a.productId===product.id&&a.provider==='gmail'&&a.status==='verified');
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
  const from='sales@aionx.aionapp.org';
  const aliases=await gmail('settings/sendAs');if(!aliases.sendAs?.some(a=>a.sendAsEmail.toLowerCase()===from&&a.verificationStatus==='accepted'))throw Error('Sales alias is not verified');
  for(const target of targets){
   const draft=read(join(folder,`${target.key}-request.json`));if(draft.email!==from||/[\r\n]/.test(draft.subject))throw Error('Unexpected sender or subject');
   const receiptPath=join(folder,`${target.key}-email-receipt.json`);
   if(existsSync(receiptPath)){
    const previous=read(receiptPath);
    if(previous.status==='gmail_accepted'&&mode==='check'){
     const sent=await gmail('messages/'+encodeURIComponent(previous.messageId)+'?format=full');
     const h=n=>sent.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value??'';
     const body=sent.payload?.body?.data?Buffer.from(sent.payload.body.data,'base64url').toString('utf8').replace(/\r\n/g,'\n').trim():'';
     if(sent.id!==previous.messageId||sent.threadId!==previous.threadId||!sent.labelIds?.includes('SENT')||h('from')!==`Casey at Lemonade <${from}>`||h('to')!==target.to||h('subject')!==draft.subject||body!==draft.message.trim())throw Error('Accepted message content mismatch; do not resend');
     previous.status='sent_copy_verified';previous.providerInternetId=h('message-id');previous.verifiedAt=new Date().toISOString();save(receiptPath,previous);
    }
    console.log(JSON.stringify({key:target.key,status:previous.status,skipped:true}));continue;
   }
   const prior=await gmail('messages?'+new URLSearchParams({q:`in:anywhere {from:${target.to} to:${target.to}}`,maxResults:'1'}));
   if(prior.messages?.length){console.log(JSON.stringify({key:target.key,status:'existing_conversation_review_required'}));continue;}
   if(mode==='check'){console.log(JSON.stringify({key:target.key,to:target.to,from,verifiedSender:true,noPriorConversation:true}));continue;}
   const internetId=`<signal-ltd-${target.key}-20260921@aionx.aionapp.org>`;
   const lines=[`From: Casey at Lemonade <${from}>`,`To: ${target.to}`,`Subject: ${draft.subject}`,`Message-ID: ${internetId}`,`Date: ${new Date().toUTCString()}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(draft.message).toString('base64').match(/.{1,76}/g).join('\r\n')];
   const receipt={key:target.key,to:target.to,from,source:target.source,status:'attempting',at:new Date().toISOString(),internetId,draftFile:`${target.key}-request.json`};
   writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx'});
   const accepted=await gmail('messages/send',{raw:Buffer.from(lines.join('\r\n')).toString('base64url')});
   receipt.status='gmail_accepted';receipt.messageId=accepted.id;receipt.threadId=accepted.threadId;save(receiptPath,receipt);
   const sent=await gmail('messages/'+encodeURIComponent(accepted.id)+'?format=full');
   const h=n=>sent.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value??'';
   const body=sent.payload?.body?.data?Buffer.from(sent.payload.body.data,'base64url').toString('utf8').replace(/\r\n/g,'\n').trim():'';
   // Gmail can replace the RFC Message-ID; reconcile by the returned provider ID,
   // thread ID, SENT label, exact sender/recipient/subject and full body instead.
   if(sent.id!==accepted.id||sent.threadId!==accepted.threadId||!sent.labelIds?.includes('SENT')||h('from')!==`Casey at Lemonade <${from}>`||h('to')!==target.to||h('subject')!==draft.subject||body!==draft.message.trim())throw Error('Sent copy did not match the authorized message; do not resend');
   receipt.status='sent_copy_verified';receipt.providerInternetId=h('message-id');receipt.verifiedAt=new Date().toISOString();save(receiptPath,receipt);
   console.log(JSON.stringify({key:target.key,to:target.to,status:receipt.status,messageId:accepted.id}));
  }
 } finally {db.close();}
}).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1);});
