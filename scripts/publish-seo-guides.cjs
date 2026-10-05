// Owner-authorized website content. Credentials never enter an artifact or log.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { secret } = require('../../Lemonade/scripts/growth-cloud.cjs');
const posts = [
  { project: 'siplemona-de', origin: 'https://siplemona.de', source: 'lemonade-compare-client-reports.md', slug: 'compare-client-reports-with-local-ai', title: 'How to compare client reports with local AI', description: 'A practical checklist and reusable prompt for comparing client reports, checking conflicting figures and drafting a source-backed client update.', author: 'Lemonade team · AIon X' },
  { project: 'siplemona-de', origin: 'https://siplemona.de', source: 'lemonade-project-brief.md', slug: 'turn-scattered-notes-into-project-brief', title: 'Turn scattered files and notes into a clear project brief', description: 'A project-brief template for freelancers and small businesses: collect the right sources, separate requirements from assumptions and decide what to do next.', author: 'Lemonade team · AIon X' },
  { project: 'cinegen-12360', origin: 'https://cinegenaimedia.com', source: 'cinegen-shot-plan.md', slug: 'plan-product-video-before-generating', title: 'How to plan a product video before generating footage', description: 'Use a reusable shot card to plan a small-business product video, combine real product evidence with illustrative footage and review the finished edit.', author: 'CineGen team · AIon X' },
];
(async () => {
  const receipts = [];
  for (const post of posts) {
    const body = fs.readFileSync(path.resolve('output/seo', post.source), 'utf8');
    const configPath = path.join(process.env.APPDATA, 'signal', 'website-publishing.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const token = config[post.project === 'siplemona-de' ? 'SIGNAL_LEMONADE_PUBLISH_KEY' : 'SIGNAL_CINEGEN_PUBLISH_KEY'] || await secret(post.project, 'SIGNAL_PUBLISH_KEY');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const endpoint = post.origin + '/api/content/posts';
    const previous = await fetch(endpoint + '?slug=' + post.slug, { headers, redirect: 'error' });
    assert([200, 404].includes(previous.status), 'Unable to check previous article version');
    const old = previous.status === 200 ? await previous.json() : undefined;
    if (old) assert(old.title === post.title && (old.body.replaceAll('https://discord.gg/Q4FHt7nDX', 'https://discord.gg/wQ2KdjTdHG') === body.trim() || body.startsWith(old.body.trimEnd() + '\n\n## Join the product community\n\n')), 'Existing article differs; inspect before overwriting');
    const response = await fetch(endpoint, { method: 'PUT', headers, redirect: 'error', body: JSON.stringify({ slug: post.slug, title: post.title, description: post.description, author: post.author, body, status: 'published', expectedVersion: old?.version ?? 0 }) });
    assert(response.ok, `Article publication failed: HTTP ${response.status}`);
    const receipt = await response.json(); assert.equal(receipt.status, 'published');
    const publicUrl = post.origin + '/writing/' + post.slug;
    const live = await fetch(publicUrl); assert.equal(live.status, 200);
    const html = await live.text(); assert(html.includes(post.title) && html.includes('BlogPosting') && html.includes(`href="${publicUrl}"`));
    receipts.push({ title: post.title, url: publicUrl, version: receipt.version, verifiedAt: new Date().toISOString() });
  }
  // Discovery endpoints may be cached briefly. Their verification is reported separately.
  fs.writeFileSync('output/seo/published-guides.json', JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify(receipts));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
