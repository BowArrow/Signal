import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Studio } from './studio.mjs';
import { apiDescription } from './protocol.mjs';
import { stopLtxRuntime } from './ltx-runtime.mjs';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), 'ui');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',md:'text/plain; charset=utf-8',txt:'text/plain; charset=utf-8',json:'application/json' };
export function sameSecret(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new Error('Request exceeds 32 KB.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export async function startServer({ studio = new Studio(), port = Number(process.env.DEMO_STUDIO_PORT || 4319), connectionFile = join(studio.root, 'connection.json') } = {}) {
  await studio.initialize();
  const token = randomBytes(32).toString('hex'); let origin;
  const server = createServer(async (req,res) => {
    const json = (status,value) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(403,{error:'Only the local studio can access this service.'});
    const url = new URL(req.url,origin);
    const bearer = req.headers.authorization?.replace(/^Bearer /,'');
    const cookie = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('demo_studio='))?.slice(12);
    const authorized = sameSecret(bearer,token) || sameSecret(cookie,token);
    try {
      if (req.method === 'POST' && url.pathname === '/connect') {
        if (!sameSecret(bearer,token)) return json(401,{error:'Open the studio using its launcher to connect.'});
        res.setHeader('Set-Cookie',`demo_studio=${token}; HttpOnly; SameSite=Strict; Path=/`); return json(200,{connected:true});
      }
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200,{'Content-Type':types['.'+name.split('.').at(-1)]}); return res.end(await readFile(join(uiRoot,name)));
      }
      if (!authorized) return json(401,{error:'Open the studio using its launcher to connect.'});
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200,await studio.status());
      if (req.method === 'GET' && url.pathname === '/api/help') return json(200,apiDescription);
      if (req.method === 'POST' && url.pathname === '/api/command') return json(200,await studio.command(await body(req)));
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        studio.requireSession(); res.writeHead(200,{'Content-Type':'image/png'}); return res.end(await studio.cdp.image());
      }
      const asset = /^\/assets\/([a-f0-9-]{36})\/([a-zA-Z0-9-]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a|md|txt|json))$/.exec(url.pathname);
      if (req.method === 'GET' && asset) {
        const file = join(studio.root,'sessions',asset[1],'assets',asset[2]);
        const info = await stat(file); const range = req.headers.range;
        const headers = { 'Content-Type':types[asset[3]], 'Accept-Ranges':'bytes' };
        if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="${asset[2]}"`;
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (!match) return json(416,{error:'Invalid byte range.'});
          const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]),info.size-1) : info.size-1;
          if (start > end || start >= info.size) return json(416,{error:'Range outside asset.'});
          res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${info.size}`}); createReadStream(file,{start,end}).pipe(res); return;
        }
        res.writeHead(200,{...headers,'Content-Length':info.size}); createReadStream(file).pipe(res); return;
      }
      return json(404,{error:'Unknown studio route.'});
    } catch (error) {
      if (!res.headersSent) json(error.code === 'ENOENT' ? 404 : 400,{error:error.message,code:error.code||'STUDIO_ERROR'}); else res.end();
    }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  await mkdir(dirname(connectionFile),{recursive:true});
  await writeFile(connectionFile,JSON.stringify({url:origin,token,pid:process.pid,createdAt:new Date().toISOString()},null,2),{mode:0o600});
  return {server,studio,origin,token,connectionFile,async close() { await studio.command({action:'close'}); await stopLtxRuntime({shutdown:true}); await new Promise(resolve=>server.close(resolve)); }};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = await startServer();
  console.log(`Demo Studio is ready at ${instance.origin}. Use scripts/start-demo-studio.ps1 to open the connected window.`);
  let stopping = false;
  const stop = async () => { if(stopping) return; stopping=true; await instance.close(); process.exit(0); };
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
}
