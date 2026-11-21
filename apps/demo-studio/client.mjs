import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspace } from './studio.mjs';

export async function studioCommand(command, connectionFile = process.env.DEMO_STUDIO_CONNECTION || join(workspace,'data/demo-studio/connection.json')) {
  const connection = JSON.parse(await readFile(connectionFile,'utf8'));
  const url = new URL(connection.url);
  if(url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Demo Studio must run on this computer.');
  const response = await fetch(new URL('/api/command',url),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(command.action==='edit.render'?900000:180000)});
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || 'Demo Studio request failed.'),{code:result.code}); return result;
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = process.argv[2] === '--file' ? await readFile(process.argv[3],'utf8') : process.argv[2] || '{"action":"status"}';
    console.log(JSON.stringify(await studioCommand(JSON.parse(input)),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
