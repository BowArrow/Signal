/* global require, console, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
// Render the existing vector brand with bundled Chromium. No AI or network calls.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
  try {
    const svg = readFileSync(resolve('electron/renderer/public/signal.svg'), 'utf8');
    await win.loadURL('data:text/html,<html><body></body></html>');
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512]; const images = [];
    for (const size of sizes) {
      const value = await win.webContents.executeJavaScript(`(async () => {
        const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))}; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size}; canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      images.push(Buffer.from(value, 'base64'));
    }
    mkdirSync('build', { recursive: true });
    writeFileSync('build/icon.png', images[7]); writeFileSync('build/tray.png', images[2]);
    const layers = images.slice(0, 7); const header = Buffer.alloc(6 + layers.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(layers.length, 4); let offset = header.length;
    layers.forEach((png, index) => { const at = 6 + index * 16; header[at] = header[at + 1] = sizes[index] === 256 ? 0 : sizes[index]; header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length; });
    writeFileSync('build/icon.ico', Buffer.concat([header, ...layers]));
    console.log('Signal icon: seven Windows sizes, 512px PNG, and tray PNG generated.');
  } finally { win.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
