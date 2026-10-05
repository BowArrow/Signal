import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import type { CredentialVault } from '../connections/service.js';
import { settings } from '../db/schema.js';
import { newId } from '../lib/id.js';
import { requireProduct } from '../marketing/store.js';
import type { VideoAsset } from '../../shared/video.js';
import { youtubeCanUpload, youtubeMetadataSchema, youtubePolicySchema, type YoutubeDelivery, type YoutubeMetadata, type YoutubePolicy, type YoutubeView } from '../../shared/video-publishing.js';
import { YOUTUBE_CHUNK, YoutubeError } from './youtube.js';

const POLICY = 'video.youtube.policy.', JOB = 'video.youtube.job.', DAY = 86400000;
export class VideoPublishingService {
  private active: { productId: string; controller: AbortController; promise: Promise<void> } | undefined;
  constructor(private readonly app: App, private readonly vault: CredentialVault, private readonly read: (asset: VideoAsset) => Buffer) {}
  private get<T>(key: string) { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private rows<T>(prefix: string) { return this.app.db.select().from(settings).where(like(settings.key, prefix + '%')).all().map(r => r.value as T); }
  private save(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  policies() { return this.rows<YoutubePolicy>(POLICY); }
  policy(productId: string): YoutubePolicy { requireProduct(this.app, productId); return this.get<YoutubePolicy>(POLICY + productId) ?? { productId, enabled: false, accountId: '', channelId: '', channelTitle: '', privacy: 'private', dailyLimit: 1, autoQueue: false, madeForKids: false, containsSyntheticMedia: true, revision: 0, configuredAt: 0 }; }
  jobs() { return this.rows<YoutubeDelivery>(JOB); }
  view(): YoutubeView { return { policies: this.policies(), jobs: this.jobs().sort((a, b) => b.createdAt - a.createdAt).slice(0, 200), accounts: this.app.connections?.accounts().filter(a => a.provider === 'youtube').map(({ id, productId, label, status, grantedScopes }) => ({ id, productId, label, status, grantedScopes })) ?? [] }; }
  private job(productId: string, id: string) { requireProduct(this.app, productId); const job = this.get<YoutubeDelivery>(JOB + id); if (!job || job.productId !== productId) throw new Error('Video delivery not found for this business.'); return job; }
  private put(job: YoutubeDelivery) { this.save(JOB + job.id, { ...job, updatedAt: this.app.clock.now() }); }
  private client(productId: string, accountId: string, signal: AbortSignal, canWrite: () => void) { if (!this.app.connections) throw new Error('Open Connections first.'); return this.app.connections.youtube(productId, accountId, signal, canWrite); }
  private unresolved(productId: string) { return this.jobs().some(j => j.productId === productId && j.startedAt !== undefined && !['delivered', 'cancelled'].includes(j.status)); }
  async configure(productId: string, input: unknown) {
    const value = youtubePolicySchema.parse(input), old = this.policy(productId);
    if (this.unresolved(productId)) throw new Error('Resolve or explicitly stop the existing YouTube upload before changing its settings.');
    this.app.operations?.pause(productId);
    const channel = value.accountId ? await this.client(productId, value.accountId, AbortSignal.timeout(30000), () => { throw new Error('Read only.'); }).channel() : undefined;
    if (value.enabled && !channel) throw new Error('Choose a verified YouTube channel with upload permission.');
    this.app.db.transaction(() => {
      if (this.policy(productId).revision !== old.revision || this.unresolved(productId) || this.app.operations?.state(productId).running) throw new Error('Settings changed while checking the channel. Pause and save again.');
      this.save(POLICY + productId, { ...value, productId, revision: old.revision + 1, configuredAt: this.app.clock.now(), channelId: channel?.id ?? '', channelTitle: channel?.snippet.title ?? '' });
      for (const job of this.jobs().filter(j => j.productId === productId && j.startedAt === undefined && j.status !== 'cancelled')) this.put({ ...job, status: 'cancelled', detail: 'Settings changed before upload; queue again under the new settings.' });
    }, { behavior: 'immediate' });
  }
  metadata(productId: string, sourceId: string, campaignId: string): YoutubeMetadata {
    const source = this.app.video?.job(productId, sourceId), product = requireProduct(this.app, productId);
    const site = product.utmBase;
    if (!source?.assembly || !site) throw new Error('Choose a completed ad with a business website.');
    const url = new URL(source.assembly.destination);
    if (url.origin !== new URL(site).origin) throw new Error('The ad must link to this business website.');
    url.searchParams.set('utm_source', 'signal'); url.searchParams.set('utm_medium', 'video'); url.searchParams.set('utm_campaign', campaignId);
    return youtubeMetadataSchema.parse({ title: source.title.slice(0, 100), description: `${source.assembly.headline}\n\n${source.assembly.callToAction}: ${url}\n\nFrom the team behind ${product.name}.` });
  }
  enqueue(productId: string, sourceId: string, metadata?: YoutubeMetadata) {
    return this.app.db.transaction(() => {
      const policy = this.policy(productId), source = this.app.video?.job(productId, sourceId);
      if (!policy.enabled || !policy.channelId) throw new Error('Enable YouTube delivery in Video production first.');
      if (!source || source.kind !== 'ad' || source.phase !== 'ready' || !source.approvedAt || !source.output || source.output.mime !== 'video/mp4') throw new Error('Review and approve the finished ad before queuing delivery.');
      this.bytes(source.output);
      if (this.jobs().some(j => j.channelId === policy.channelId && j.asset.sha256 === source.output!.sha256 && (j.status !== 'cancelled' || j.startedAt !== undefined))) throw new Error('This video already has a delivery for this channel. Reconcile that delivery instead.');
      const id = newId(), now = this.app.clock.now();
      const job: YoutubeDelivery = { id, productId, sourceId, accountId: policy.accountId, channelId: policy.channelId, revision: policy.revision, asset: structuredClone(source.output), approvedAt: source.approvedAt, metadata: metadata ? youtubeMetadataSchema.parse(metadata) : this.metadata(productId, sourceId, id), privacy: policy.privacy, madeForKids: policy.madeForKids, containsSyntheticMedia: policy.containsSyntheticMedia, status: 'queued', createdAt: now, updatedAt: now, bytesSent: 0, failures: 0, nextCheckAt: 0, leaseUntil: 0, detail: 'Queued. Upload starts while this business is running.' };
      this.put(job); return job;
    }, { behavior: 'immediate' });
  }
  private bytes(asset: VideoAsset) { const bytes = this.read(asset); if (bytes.length < 1 || bytes.length > 80 * 1024 * 1024 || bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('The approved video file has changed or is unavailable.'); return bytes; }
  pause(productId: string) { if (this.active?.productId === productId) this.active.controller.abort(); }
  async stop() { this.active?.controller.abort(); await this.active?.promise; }
  cancel(productId: string, id: string, acceptUncertain: boolean) {
    const job = this.job(productId, id);
    if (job.status === 'delivered' || job.status === 'cancelled') throw new Error('This delivery is already finished.');
    if (job.leaseUntil > this.app.clock.now()) throw new Error('Pause and wait for the current upload check to stop.');
    if (job.startedAt !== undefined && !acceptUncertain) throw new Error('Acknowledge that this video may already exist on YouTube. Stopping does not delete it.');
    this.put({ ...job, status: 'cancelled', detail: job.startedAt !== undefined ? 'Further attempts stopped. The video may exist on YouTube; check the channel.' : 'Cancelled before upload.' });
  }
  retry(productId: string, id: string) {
    const job = this.job(productId, id);
    if (job.status !== 'attention' || job.leaseUntil > this.app.clock.now()) throw new Error('Only an inactive delivery needing attention can be checked again.');
    if (job.startedAt !== undefined && !job.videoId && !this.vault.get('youtube.upload.' + id)) throw new Error('The original upload session is unavailable. Check the channel; Signal will not create a possible duplicate.');
    this.put({ ...job, status: job.videoId ? 'processing' : job.startedAt !== undefined ? 'uploading' : 'queued', failures: 0, nextCheckAt: 0, detail: 'Checking the existing upload before sending more bytes.' });
  }
  async tick() {
    if (this.active || this.app.env.SIGNAL_OFFLINE === '1') return;
    for (const policy of this.policies().filter(p => p.enabled && p.autoQueue && this.app.operations?.state(p.productId).running)) {
      for (const source of this.app.video?.jobs().filter(j => j.productId === policy.productId && j.kind === 'ad' && j.phase === 'ready' && j.approvedAt && j.approvedAt > policy.configuredAt) ?? []) {
        if (this.jobs().some(j => j.sourceId === source.id && j.channelId === policy.channelId)) continue;
        try { this.enqueue(policy.productId, source.id); } catch { /* Invalid or duplicate assets are never submitted. */ }
      }
    }
    const now = this.app.clock.now();
    const candidate = this.jobs().filter(j => ['queued', 'uploading', 'processing'].includes(j.status) && j.nextCheckAt <= now && j.leaseUntil <= now && (j.videoId || this.app.operations?.state(j.productId).running)).sort((a, b) => a.nextCheckAt - b.nextCheckAt || a.createdAt - b.createdAt)[0];
    if (!candidate) return;
    const leaseId = newId();
    const claimed = this.app.db.transaction(() => {
      const job = this.job(candidate.productId, candidate.id); if (job.leaseUntil > now || !['queued', 'uploading', 'processing'].includes(job.status)) return false;
      if (job.startedAt === undefined) {
        const policy = this.policy(job.productId);
        const limits = this.policies().filter(p => p.enabled && p.channelId === job.channelId).map(p => p.dailyLimit);
        const limit = Math.min(policy.dailyLimit, ...limits);
        const attempts = this.jobs().filter(j => j.id !== job.id && j.channelId === job.channelId && ((j.startedAt !== undefined && j.startedAt > now - DAY) || j.leaseUntil > now));
        if (attempts.length >= limit) { this.put({ ...job, nextCheckAt: Math.min(...attempts.map(j => j.startedAt === undefined ? j.leaseUntil : j.startedAt + DAY)) + 1, detail: 'Waiting for this channel’s rolling daily upload allowance.' }); return false; }
      }
      this.put({ ...job, leaseId, leaseUntil: now + 120000 }); return true;
    }, { behavior: 'immediate' });
    if (!claimed) return;
    const controller = new AbortController(); const promise = this.step(candidate.productId, candidate.id, leaseId, controller.signal);
    this.active = { productId: candidate.productId, controller, promise };
    try { await promise; } finally { this.active = undefined; }
  }
  private async step(productId: string, id: string, leaseId: string, signal: AbortSignal) {
    const latest = () => { const job = this.job(productId, id); if (job.leaseId !== leaseId) throw new Error('Upload lease changed.'); return job; };
    const checkpoint = (patch: Partial<YoutubeDelivery>) => this.put({ ...latest(), ...patch });
    const canWrite = () => {
      signal.throwIfAborted(); const job = latest(), policy = this.policy(productId), source = this.app.video?.job(productId, job.sourceId);
      const account = this.app.connections?.accounts().find(a => a.id === job.accountId && a.productId === productId);
      if (this.app.env.SIGNAL_OFFLINE === '1' || !this.app.operations?.state(productId).running || !policy.enabled || policy.revision !== job.revision || policy.channelId !== job.channelId || policy.accountId !== job.accountId || job.leaseUntil <= this.app.clock.now() || !account || account.status !== 'verified' || !youtubeCanUpload(account) || source?.phase !== 'ready' || source.approvedAt !== job.approvedAt || source.output?.sha256 !== job.asset.sha256) throw new Error('Upload paused or its approval, channel or settings changed.');
    };
    try {
      let job = latest(); const client = this.client(productId, job.accountId, signal, canWrite);
      const channel = await client.channel(); if (channel.id !== job.channelId) throw new YoutubeError('The connected YouTube channel changed. Reconnect the original channel.');
      if (job.videoId) {
        const remote = await client.video(job.videoId);
        if (remote.id !== job.videoId || remote.snippet.channelId !== job.channelId || remote.snippet.title !== job.metadata.title || remote.snippet.description !== job.metadata.description) throw new YoutubeError('The remote video does not match this delivery. Check YouTube Studio.');
        if (['failed', 'rejected', 'deleted'].includes(remote.status.uploadStatus) || ['failed', 'terminated'].includes(remote.processingDetails?.processingStatus ?? '')) throw new YoutubeError('YouTube could not process or accept this video. Check YouTube Studio.');
        if (remote.status.uploadStatus !== 'processed' || (remote.processingDetails && remote.processingDetails.processingStatus !== 'succeeded')) {
          if (this.app.clock.now() - job.startedAt! > DAY) throw new YoutubeError('YouTube processing has not completed after 24 hours. Check YouTube Studio.');
          checkpoint({ status: 'processing', nextCheckAt: this.app.clock.now() + 60000, detail: 'Uploaded; waiting for YouTube processing.' }); return;
        }
        const receipt = { id: remote.id, url: 'https://www.youtube.com/watch?v=' + remote.id, privacy: remote.status.privacyStatus, confirmedAt: this.app.clock.now() };
        const matches = remote.status.privacyStatus === job.privacy && remote.status.selfDeclaredMadeForKids === job.madeForKids && (remote.status.containsSyntheticMedia ?? false) === job.containsSyntheticMedia;
        checkpoint({ receipt, status: matches ? 'delivered' : 'attention', failures: 0, detail: matches ? `YouTube confirmed this video is ${receipt.privacy}.` : `YouTube reports ${receipt.privacy} visibility. Visibility or audience/AI disclosure differs from your settings; review YouTube Studio. Unverified API projects may be restricted to private uploads.` }); return;
      }
      canWrite(); const bytes = this.bytes(job.asset), sessionKey = 'youtube.upload.' + id;
      let session = this.vault.get(sessionKey);
      if (!session) {
        if (job.startedAt !== undefined) throw new YoutubeError('The original upload session is unavailable. Check the channel before creating another video.');
        if (!this.vault.available()) throw new YoutubeError('Unlock secure storage before uploading.');
        checkpoint({ startedAt: this.app.clock.now(), status: 'uploading', detail: 'Opening a resumable YouTube upload.' });
        session = await client.start(latest()); this.vault.set(sessionKey, session);
        checkpoint({ nextCheckAt: this.app.clock.now(), detail: 'Upload session saved. Ready to send video.' }); return;
      }
      const progress = await client.progress(session, bytes.length);
      if (progress.bytes < job.bytesSent) throw new YoutubeError('YouTube upload progress moved backwards. Check the existing session before continuing.');
      checkpoint({ bytesSent: progress.bytes, ...(progress.videoId ? { videoId: progress.videoId, status: 'processing' as const } : {}), nextCheckAt: this.app.clock.now() + progress.retryAfterMs, detail: progress.videoId ? 'Upload accepted; checking processing and visibility.' : 'Resuming the saved upload.' });
      if (progress.videoId || progress.retryAfterMs) return;
      canWrite(); job = latest();
      const sent = await client.chunk(session, bytes.length, progress.bytes, bytes.subarray(progress.bytes, Math.min(bytes.length, progress.bytes + YOUTUBE_CHUNK)));
      if (sent.bytes < progress.bytes || sent.bytes > Math.min(bytes.length, progress.bytes + YOUTUBE_CHUNK)) throw new YoutubeError('YouTube acknowledged unexpected upload bytes. Check the existing session.');
      checkpoint({ bytesSent: sent.bytes, ...(sent.videoId ? { videoId: sent.videoId, status: 'processing' as const } : {}), failures: 0, nextCheckAt: this.app.clock.now() + sent.retryAfterMs, detail: sent.videoId ? 'Upload accepted; checking processing and visibility.' : `Uploaded ${Math.round(sent.bytes / job.asset.bytes * 100)}%.` });
    } catch (error) {
      const job = latest();
      const interrupted = signal.aborted, retryable = error instanceof YoutubeError && error.retryable;
      const failures = job.failures + (interrupted ? 0 : 1), hold = !interrupted && (!retryable || failures >= 5);
      checkpoint({ failures, status: hold ? 'attention' : job.status, nextCheckAt: this.app.clock.now() + Math.max(30000 * 2 ** Math.min(failures, 6), error instanceof YoutubeError ? error.retryAfterMs : 0), detail: interrupted ? 'Paused. Run resumes the existing upload; accepted uploads may still finish on YouTube.' : error instanceof YoutubeError ? error.message : 'Upload needs attention. Check the connection, approved file and operating settings.' });
    } finally {
      if (this.job(productId, id).leaseId === leaseId) checkpoint({ leaseUntil: 0 });
    }
  }
}
