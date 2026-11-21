import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

export async function prepareProfile(folder,sessionId,{resume=false}={}){
  const home=join(folder,'home'),samples=join(folder,'sample-documents'),configPath=join(home,'studio-config.json');
  for(const dir of [home,samples,join(folder,'assets')])await mkdir(dir,{recursive:true});
  if(!resume){
    await writeFile(join(samples,'supplier-original.txt'),'FICTIONAL DEMO DATA\nSupplier: Harbor Paper\nDelivery: November 4\nQuantity: 120 boxes\nPrice: $2,400\n',{flag:'wx'});
    await writeFile(join(samples,'supplier-revised.txt'),'FICTIONAL DEMO DATA\nSupplier: Harbor Paper\nDelivery: November 11\nQuantity: 120 boxes\nPrice: $2,520\n',{flag:'wx'});
    await writeFile(join(home,'settings.json'),JSON.stringify({autoUpdate:false,defaultModel:null,watchedFolders:[],decisionMode:'off',theme:'dark'}),{flag:'wx'});
  }
  if(!await access(configPath).then(()=>true,()=>false)){
    const approved=[];
    for(const [id,name] of [['supplier-original','supplier-original.txt'],['supplier-revised','supplier-revised.txt']]){
      const path=resolve(samples,name),bytes=await readFile(path);
      approved.push({id,name,path,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    await writeFile(configPath,JSON.stringify({version:1,sessionId,samples:approved},null,2),{flag:'wx'});
  }
  return {home,fixtureDir:samples,configPath};
}
