import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { brandSchema } from '../src/shared/studio.ts';
import { DEFAULT_MARKETING } from '../src/core/marketing/store.ts';

const profile = join(process.env.APPDATA, 'signal');
const db = new Database(join(profile, 'signal.db'), { fileMustExist: true, nativeBinding: resolve('native/better_sqlite3-node.node') });
const posts = JSON.parse(readFileSync('output/seo/published-guides.json', 'utf8'));
const note = 'Shared community for Lemonade and CineGen: AION X Discord, https://discord.gg/wQ2KdjTdHG. Owner supplied this invite and Discord verified no expiry. Use it as an optional place to discuss relevant workflows and product questions in website materials. It does not authorize mass invitations, direct messages, unsolicited reply links or fabricated member activity. A bot and chosen channels must be connected before server posting.';
try {
  for (const post of posts) { const r = await fetch(post.url); if (!r.ok || !(await r.text()).includes('https://discord.gg/wQ2KdjTdHG')) throw Error('Live article/community verification failed'); }
  const folder = join(profile, 'backups'); mkdirSync(folder, { recursive: true });
  await db.backup(join(folder, 'before-seo-context-' + Date.now() + '.db'));
  const changed = db.transaction(() => {
    const result = [];
    for (const key of ['lemonade', 'cinegen']) {
      const product = db.prepare('SELECT id, name, utm_base, target_buyer, positioning, proof_points FROM products WHERE key=?').get(key);
      if (!product) throw Error('Expected owner product missing');
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get('studio.brand.' + product.id);
      const voice = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('marketing.operator.v1')?.value ?? '{}').voice ?? DEFAULT_MARKETING.voice;
      const brand = brandSchema.parse(row ? JSON.parse(row.value) : {
        audience: product.target_buyer, problem: product.positioning,
        offer: `Try ${product.name} at ${product.utm_base}. Confirm current pricing before mentioning it.`,
        proof: JSON.parse(product.proof_points).join('\n') || 'No verified proof supplied yet. Do not invent results.', voice,
        constraints: 'No invented testimonials, revenue, benchmarks, discounts or product features. Disclose our affiliation when relevant.',
        visualStyle: 'Clear product demonstrations, legible typography, restrained color, real screenshots for product claims.',
      });
      if (!brand.constraints.includes('https://discord.gg/wQ2KdjTdHG')) {
        const updated = brandSchema.parse({ ...brand, constraints: brand.constraints + '\n\n' + note });
        db.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run('studio.brand.' + product.id, JSON.stringify(updated), Date.now());
      }
      for (const post of posts.filter(p => new URL(p.url).origin === new URL(product.utm_base).origin)) {
        if (!db.prepare('SELECT id FROM marketing_memory WHERE product_id=? AND source=? AND status=?').get(product.id, post.url, 'active')) db.prepare('INSERT INTO marketing_memory(id,product_id,title,body,kind,source,confidence,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), product.id, post.title, 'Published website guide, independently verified at ' + post.verifiedAt + '. ' + post.url + '. Contains a reusable checklist and a link to the shared AION X community. Publication is not evidence of Google indexing, traffic or sales. Avoid duplicating this topic.', 'observation', post.url, 1, 'active', Date.now());
      }
      result.push(product.name);
    }
    return result;
  })();
  console.log(JSON.stringify({ updatedProducts: changed, publishedArticleObservations: posts.length, outboundMessagesSent: 0 }));
} finally { db.close(); }
