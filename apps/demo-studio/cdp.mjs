import { randomUUID } from 'node:crypto';

export class Cdp {
  serial = 0;
  pending = new Map();
  async connect(url) {
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.close(); reject(new Error('Product connection timed out.')); }, 10000);
      this.socket.onopen = () => { clearTimeout(timer); resolve(); };
      this.socket.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to the product.')); };
    });
    this.socket.onmessage = event => {
      const value = JSON.parse(event.data);
      const request = this.pending.get(value.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(value.id);
      if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result);
    };
    this.socket.onclose = () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The product window closed. Launch a new demo session.')); }
      this.pending.clear();
    };
    return this;
  }
  call(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error('Launch a demo session first.'));
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeoutMs) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async observe() {
    const revision = randomUUID();
    return this.evaluate(`(() => {
      const revision = ${JSON.stringify(revision)};
      const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="tab"],[contenteditable="true"],summary')].filter(el => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none';
      }).slice(0, 200);
      window.__demoStudio = { revision, nodes };
      return { revision, title: document.title, width: innerWidth, height: innerHeight,
        text: document.body.innerText.slice(0, 14000),
        controls: nodes.map((el,i) => ({ ref: 'e'+i, role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.id || '').slice(0,180),
          disabled: !!el.disabled, editable: el.matches('input:not([type="password"]):not([type="file"]),textarea,[contenteditable="true"]') })) };
    })()`);
  }
  async point(ref, revision, fill = false) {
    return this.evaluate(`(() => {
      const snapshot = window.__demoStudio;
      if (!snapshot || snapshot.revision !== ${JSON.stringify(revision)}) throw new Error('Observe again before interacting.');
      const el = snapshot.nodes[${Number(ref.slice(1))}];
      if (!el || !el.isConnected || el.disabled) throw new Error('This control changed. Observe again.');
      if (el.matches('input[type="password"],input[type="file"]')) throw new Error('Use the product window for passwords or file selection.');
      if (${fill} && !el.matches('input,textarea,[contenteditable="true"]')) throw new Error('This control is not editable.');
      el.scrollIntoView({block:'nearest'});
      const r = el.getBoundingClientRect();
      const x = Math.max(1,Math.min(innerWidth-1,r.x+r.width/2)), y = Math.max(1,Math.min(innerHeight-1,r.y+r.height/2));
      const top = document.elementFromPoint(x,y);
      if (!r.width || !r.height || !(top === el || el.contains(top))) throw new Error('This control is covered. Observe again.');
      window.__demoStudio = null;
      return {x,y};
    })()`);
  }
  async click(point) {
    await this.cursor(point.x,point.y,this.clicksVisible!==false,this.cursorVisible!==false);this.cursorPosition=point;
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  async cursor(x,y,click=false,visible=true){
    return this.evaluate(`(() => {
      let host=document.getElementById('__signal_demo_cursor');
      if(!host){host=document.createElement('div');host.id='__signal_demo_cursor';host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';
        const root=host.attachShadow({mode:'open'});root.innerHTML='<svg width="40" height="48" viewBox="0 0 40 48" style="position:absolute;overflow:visible"><circle cx="8" cy="8" r="20" fill="none" stroke="#e4bd59" stroke-width="3" opacity="0"/><path d="M7 5 L7 35 L15 28 L22 42 L28 39 L21 25 L33 25 Z" fill="white" stroke="#202838" stroke-width="2"/></svg>';document.documentElement.append(host);}
      host.style.display=${JSON.stringify(visible?'block':'none')};const svg=host.shadowRoot.querySelector('svg');svg.style.left=(${x}-7)+'px';svg.style.top=(${y}-5)+'px';
      if(${click})host.shadowRoot.querySelector('circle').animate([{opacity:1,transform:'scale(.7)',transformOrigin:'8px 8px'},{opacity:0,transform:'scale(1.5)',transformOrigin:'8px 8px'}],{duration:650});
      return true;
    })()`);
  }
  async move(x,y,durationMs=700){
    const start=this.cursorPosition||{x:40,y:40};const steps=Math.max(1,Math.ceil(durationMs/25));
    for(let i=1;i<=steps;i++){const t=i/steps,e=t*t*(3-2*t),point={x:start.x+(x-start.x)*e,y:start.y+(y-start.y)*e};
      await this.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await this.cursor(point.x,point.y,false,this.cursorVisible!==false);
      if(durationMs)await new Promise(r=>setTimeout(r,durationMs/steps));
    }
    this.cursorPosition={x,y};
  }
  async key(key, modifiers = 0) {
    const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, a: 65 };
    await this.call('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}) });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, windowsVirtualKeyCode: codes[key] });
  }
  async image(format = 'png') {
    const result = await this.call('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 85 } : {}), captureBeyondViewport: false });
    return Buffer.from(result.data, 'base64');
  }
  close() { this.socket?.close(); }
}
