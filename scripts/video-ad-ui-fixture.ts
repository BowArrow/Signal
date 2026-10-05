import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { settings, products } from '../src/core/db/schema.js';
import { videoConfigSchema, type VideoJob } from '../src/shared/video.js';
const app = createApp({ databaseUrl: process.argv[2]!, logger: silentLogger });
try {
  const root = join(resolve(process.argv[3]!), 'video-assets'); mkdirSync(root, { recursive: true });
  const source = resolve('data/video-ad-validation/sound.mp4'); const bytes = readFileSync(source); const sha256 = createHash('sha256').update(bytes).digest('hex'); const file = sha256 + '.mp4'; copyFileSync(source, join(root, file));
  const product = app.db.select().from(products).all().find(p => p.key === 'lemonade')!;
  // Isolated offline UI fixture only: no provider token and no network authorization.
  app.db.insert(settings).values({ key: 'video.youtube.policy.' + product.id, value: { productId: product.id, enabled: true, accountId: 'youtube-ui-fixture', channelId: 'UC' + 'a'.repeat(22), channelTitle: 'Fixture channel', privacy: 'private', dailyLimit: 1, autoQueue: false, madeForKids: false, containsSyntheticMedia: true, revision: 1, configuredAt: Date.now() } }).run();
  app.db.insert(settings).values({ key: 'connections.account.youtube-ui-fixture', value: { id: 'youtube-ui-fixture', productId: product.id, provider: 'youtube', label: 'Fixture channel', status: 'verified', grantedScopes: ['https://www.googleapis.com/auth/youtube.upload'], identity: 'Fixture channel', site: '', username: '', detail: 'Offline fixture', checkedAt: Date.now(), expiresAt: null, refreshable: false, createdAt: Date.now() } }).run();
  const fixture: VideoJob = { id: 'ad-source-fixture', productId: product.id, kind: 'shot', title: 'Synthetic editing fixture', brief: 'Colored test footage and a tone. No product demonstration or live campaign.', duration: 4, ratio: '16:9', characters: [], phase: 'ready', approvedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), detail: 'Fixture approval only.', output: { file, sha256, bytes: bytes.length, mime: 'video/mp4' } };
  for (const [key, value] of [['video.job.' + fixture.id, fixture], ['video.config', videoConfigSchema.parse({ blenderPath: '', ffmpegPath: process.argv[4], dailyCloudLimit: 0 })]] as const) app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const musicPath = resolve('data/video-audio-validation/music.wav');
  if (existsSync(musicPath)) {
    const data = readFileSync(musicPath); const hash = createHash('sha256').update(data).digest('hex'); const file = hash + '.wav'; copyFileSync(musicPath, join(root, file));
    const track = { id: 'music-fixture', productId: product.id, title: 'Synthetic test tone', duration: 1, createdAt: Date.now(), asset: { file, sha256: hash, bytes: data.length, mime: 'audio/wav' } };
    app.db.insert(settings).values({ key: 'video.music.' + track.id, value: track }).onConflictDoUpdate({ target: settings.key, set: { value: track } }).run();
  }
} finally { app.close(); }
