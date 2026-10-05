import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = resolve('docs/marketing-research/Signal-Growth-Research');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [resolve('scripts/render-growth-report.mjs')], { env, windowsHide: true, encoding: 'utf8' });
  process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? ''); process.exit(child.status ?? 1);
}
const { app, BrowserWindow } = await import('electron');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\[\^(\d+)\]/g, '<sup><a href="#source-$1">$1</a></sup>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');
const lines = readFileSync(`${root}.md`, 'utf8').split(/\r?\n/); const parts = []; let paragraph = []; let table = [];
function flush() { if (paragraph.length) { parts.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } if (table.length) { const rows = table.filter(row => !/^\|[\s:|-]+\|$/.test(row)); parts.push(`<table>${rows.map((row, i) => `<tr>${row.split('|').slice(1, -1).map(cell => `<${i ? 'td' : 'th'}>${inline(cell.trim())}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`); table = []; } }
for (const line of lines) {
  const heading = /^(#{1,3}) (.+)$/.exec(line); const source = /^\[\^(\d+)\]: (.+)$/.exec(line);
  if (heading) { flush(); parts.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
  else if (source) { flush(); parts.push(`<p class="source" id="source-${source[1]}"><b>${source[1]}.</b> ${inline(source[2])}</p>`); }
  else if (line.startsWith('|')) { if (paragraph.length) flush(); table.push(line); }
  else if (!line.trim()) flush();
  else paragraph.push(line);
} flush();
writeFileSync(`${root}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signal Growth Research</title><style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#202b38;line-height:1.62;font-size:11pt;margin:0}main{max-width:850px;margin:auto;padding:50px 45px}.eyebrow{color:#bc572d;text-transform:uppercase;font-size:10pt;letter-spacing:2px}h1{font-size:32pt;line-height:1.15;margin:22px 0 40px;max-width:620px;color:#142a39}h2{font-size:17pt;color:#173e49;margin:30px 0 12px;break-after:avoid}h3{font-size:13pt;break-after:avoid}p{margin:0 0 14px;orphans:3;widows:3}a{color:#245b73;text-decoration:none;overflow-wrap:anywhere}sup{font-size:8pt;margin-left:2px}table{width:100%;border-collapse:collapse;font-size:9pt;line-height:1.45;margin:20px 0}th{background:#e6edef;text-align:left;color:#153746}td,th{padding:9px;border-bottom:1px solid #d5dfe1;vertical-align:top}tr{break-inside:avoid}.source{font-size:9pt;line-height:1.5}code{font-size:9pt;background:#eff3f4;padding:2px 4px}@media print{main{padding:0;max-width:none}h1{font-size:29pt}h2{margin-top:24px}body{font-size:10.5pt}}
</style></head><body><main><div class="eyebrow">Signal / Research & implementation / 13 September 2026</div>${parts.join('\n')}</main></body></html>`);
void app.whenReady().then(async () => {
try {
  const window = new BrowserWindow({ show: false, width: 1000, height: 1100, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadFile(`${root}.html`);
  writeFileSync(`${root}.preview.png`, (await window.webContents.capturePage()).toPNG());
  const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.65, bottom: 0.65, left: 0.65, right: 0.65 }, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#71808b">Signal Growth Research · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  writeFileSync(`${root}.pdf`, pdf);
  console.log(JSON.stringify({ report: `${root}.pdf`, bytes: pdf.length, pages: (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length }));
  window.destroy();
} finally { app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
