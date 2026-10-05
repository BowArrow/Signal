import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { renderBrandCard } from '../electron/main/brand-card.js';
import { normalizeCampaignImage } from '../electron/main/campaign-images.js';
import type { BrandCardContent } from '../src/shared/brand-card.js';

const folder = resolve('data/brand-card-validation'); mkdirSync(folder, { recursive: true });
app.setPath('userData', join(folder, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* Render several hidden windows in this isolated check. */ });
void app.whenReady().then(async () => {
  const examples: Record<string, BrandCardContent> = {
    lemonade: { brand: 'Lemonade', theme: 'lemonade', domain: 'siplemona.de', title: 'Ask across your document library', description: 'Bring related documents into one conversation. Ask a focused question and check the cited sources before relying on the answer.' },
    cinegen: { brand: 'CineGen', theme: 'cinegen', domain: 'cinegenaimedia.com', title: 'Take your concept to an editable sequence', description: 'Start with a concept, build a storyboard, and arrange generated clips on a timeline. Shape the sequence around the story you want to tell.' },
    long: { brand: 'Lemonade', theme: 'lemonade', domain: 'siplemona.de', title: 'A clear headline for a detailed campaign about working through a collection of source documents and checking the relevant evidence before making your next decision'.slice(0,160), description: 'Long descriptions still need to remain readable. This deliberately extended layout sample checks that a complete paragraph fits below the headline and above the footer. It exercises the maximum supported description length without silently clipping the copy or placing it over the business website address.'.padEnd(320, '.') },
    escaped: { brand: 'Literal <b>Brand</b>', theme: 'neutral', domain: 'example.test', title: '<img src="https://example.test/x"> is text', description: 'Markup such as <script>alert(1)</script> and ampersands & quotes must appear as literal characters.' },
  };
  const report: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(examples)) {
    const rendered = await renderBrandCard(value, new AbortController().signal);
    const normalized = normalizeCampaignImage(rendered);
    assert.equal(normalized.width, 1200); assert.equal(normalized.height, 675); assert.ok(normalized.bytes.length <= 1000000);
    writeFileSync(join(folder, `${name}.jpg`), normalized.bytes);
    report[name] = { width: normalized.width, height: normalized.height, bytes: normalized.bytes.length, input: value };
    assert.equal(BrowserWindow.getAllWindows().length, 0);
  }
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(renderBrandCard(examples.lemonade!, stopped.signal));
  const during = new AbortController(); const pending = renderBrandCard(examples.lemonade!, during.signal); during.abort(); await assert.rejects(pending);
  await assert.rejects(renderBrandCard({ ...examples.lemonade!, brand: 'W'.repeat(100) }, new AbortController().signal), /does not fit/);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  writeFileSync(join(folder, 'report.json'), JSON.stringify({ ok: true, softwareRendering: true, visibleWindows: false, abortedRendersCleanedUp: true, oversizedCopyRejected: true, examples: report }, null, 2));
  console.log(JSON.stringify({ ok: true, examples: Object.keys(report), abortedRendersCleanedUp: true, oversizedCopyRejected: true }));
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
