import { BrowserWindow } from 'electron';
import { brandCardSchema, type BrandCardContent } from '../../src/shared/brand-card.js';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** Render only escaped, reviewed copy in a fixed local layout. No page visits or model calls. */
export async function renderBrandCard(input: BrandCardContent, signal: AbortSignal): Promise<Buffer> {
  const value = brandCardSchema.parse(input); signal.throwIfAborted();
  const palette = value.theme === 'lemonade' ? ['#eff6dc', '#172b21', '#346646', '#ccdf83'] : value.theme === 'cinegen' ? ['#17172d', '#f5f2ff', '#b4a6f5', '#373251'] : ['#edf2f7', '#1a293b', '#426889', '#d6e2ee'];
  const win = new BrowserWindow({ width: 1200, height: 675, useContentSize: true, show: false, frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'signal-brand-card' } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const stop = () => { if (!win.isDestroyed()) win.destroy(); };
  const deadline = setTimeout(stop, 20000); signal.addEventListener('abort', stop, { once: true });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1200px;height:675px;overflow:hidden}body{background:${palette[0]};color:${palette[1]};font-family:'Segoe UI',Arial,sans-serif;padding:54px 64px}
      .accent{position:absolute;right:-80px;top:-210px;width:510px;height:510px;border:62px solid ${palette[3]};border-radius:50%;opacity:.45;z-index:0}
      header,main,footer{position:relative;z-index:1}header{height:46px;display:flex;align-items:center;justify-content:space-between;gap:30px}.brand{font-size:30px;font-weight:650;max-width:720px;white-space:nowrap;overflow:hidden}.label{font-size:14px;font-weight:600;letter-spacing:2.8px;text-transform:uppercase;color:${palette[2]}}
      main{margin-top:43px}h1{font-size:60px;line-height:1.35;letter-spacing:-1.8px;font-weight:650;margin:0;max-height:224px;overflow-wrap:anywhere;overflow:hidden}p{font-size:28px;line-height:1.4;margin:24px 0 0;max-height:142px;overflow-wrap:anywhere;overflow:hidden;max-width:1000px;color:${palette[2]}}
      footer{position:absolute;left:64px;right:64px;bottom:45px;padding-top:22px;border-top:1px solid ${palette[2]}55;display:flex;align-items:center;justify-content:space-between;gap:30px;font-size:21px;font-weight:600}.domain{max-width:800px;white-space:nowrap;overflow:hidden}.arrow{font-size:29px;color:${palette[2]}}
      </style></head><body><div class="accent"></div><header><div class="brand">${escape(value.brand)}</div><div class="label">A useful next step</div></header><main><h1>${escape(value.title)}</h1><p>${escape(value.description)}</p></main><footer><div class="domain">${escape(value.domain)}</div><div class="arrow">Explore &rarr;</div></footer></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); signal.throwIfAborted();
    const fits = await win.webContents.executeJavaScript(`(() => {
      for (const [selector,min] of [['h1',40],['p',22],['.brand',20],['.domain',16]]) {
        const el=document.querySelector(selector); let size=parseFloat(getComputedStyle(el).fontSize);
        while ((el.scrollHeight>el.clientHeight+1 || el.scrollWidth>el.clientWidth+1) && size>min) { size-=1; el.style.fontSize=size+'px'; }
        if(el.scrollHeight>el.clientHeight+1 || el.scrollWidth>el.clientWidth+1) return {selector,size,height:el.clientHeight,scrollHeight:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth};
      }
      const bottom=document.querySelector('main').getBoundingClientRect().bottom, footer=document.querySelector('footer').getBoundingClientRect().top;
      return bottom + 20 < footer ? true : {bottom,footer};
    })()`);
    if (fits !== true) throw new Error('The brand card copy does not fit. Shorten its title or description. ');
    signal.throwIfAborted(); const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error('The brand card could not be rendered.');
    signal.throwIfAborted(); return image.toPNG();
  } finally { clearTimeout(deadline); signal.removeEventListener('abort', stop); stop(); }
}
