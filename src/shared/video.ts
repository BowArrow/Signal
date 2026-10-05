import { z } from 'zod';
import { localUrl } from './marketing.js';
import { youtubePolicySchema, type YoutubeView } from './video-publishing.js';
import { videoCampaignPolicySchema, type VideoCampaignView } from './video-campaigns.js';
import { adDirectorBriefSchema, type AdDirectorPlan } from './ad-director.js';

const point = z.tuple([z.number().min(-12).max(12), z.number().min(-12).max(12), z.number().min(0).max(10)]);
export const videoShotSchema = z.object({
  description: z.string().trim().min(20).max(1800),
  openingAction: z.string().trim().min(10).max(350),
  geometry: z.string().trim().min(20).max(500),
  lensMm: z.number().min(24).max(85),
  lighting: z.string().trim().min(15).max(400),
  acting: z.string().trim().min(15).max(400),
  beats: z.array(z.object({ start: z.number().min(0).max(15), end: z.number().min(0).max(15), action: z.string().min(10).max(450) }).strict()).min(2).max(4),
  environment: z.enum(['studio', 'office', 'outdoors']),
  cameraStart: point, cameraEnd: point, lookAt: point,
  actors: z.array(z.object({ characterId: z.string().min(1).max(100), start: point, end: point }).strict()).min(1).max(3),
}).strict();
export type VideoShot = z.infer<typeof videoShotSchema>;
export const videoBriefSchema = z.object({
  title: z.string().trim().min(3).max(120), brief: z.string().trim().min(30).max(2200),
  characterIds: z.array(z.string().min(1).max(100)).min(1).max(3).refine(ids => new Set(ids).size === ids.length),
  duration: z.number().int().min(5).max(15), ratio: z.enum(['16:9', '9:16', '1:1']),
}).strict();
export type VideoBrief = z.infer<typeof videoBriefSchema>;
export interface VideoAsset { file: string; sha256: string; bytes: number; mime: 'image/jpeg' | 'video/mp4' | 'audio/wav'; }
export interface VideoMusic { id: string; productId: string; title: string; asset: VideoAsset; duration: number; createdAt: number; }
export const narrationSchema = z.object({ text: z.string().trim().min(3).max(900), voice: z.enum(['af_heart', 'am_michael', 'bf_emma', 'bm_george']), speed: z.number().min(0.8).max(1.2), start: z.number().min(0).max(20), captions: z.boolean() }).strict();
export interface NarrationAudio { path: string; duration: number; cues: { text: string; start: number; end: number }[]; }
const overlayText = (max: number) => z.string().trim().max(max).refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Use a single line of printable text.');
export const videoAdSchema = z.object({
  title: z.string().trim().min(3).max(120), ratio: z.enum(['16:9', '9:16', '1:1']),
  clips: z.array(z.object({ jobId: z.string().min(1).max(100), start: z.number().min(0).max(300), duration: z.number().min(1).max(15), caption: overlayText(90) }).strict()).min(1).max(6),
  headline: overlayText(60).refine(Boolean, 'Enter an end-card headline.'),
  callToAction: overlayText(40).refine(Boolean, 'Enter a call to action.'),
  destination: z.string().url().max(160).refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }, 'Use a public HTTPS destination.'),
  narration: narrationSchema.optional(), music: z.object({ trackId: z.string().min(1).max(100), gainDb: z.number().min(-36).max(-6) }).strict().optional(), keepSourceAudio: z.boolean().optional(),
}).strict().refine(value => value.clips.reduce((total, clip) => total + clip.duration, 3) <= 60, 'Keep the finished ad at or below 60 seconds, including its 3-second end card.');
export type VideoAd = z.infer<typeof videoAdSchema>;
export type VideoAssembly = Omit<VideoAd, 'clips'> & { clips: (VideoAd['clips'][number] & { asset: VideoAsset })[]; musicAsset?: VideoAsset };
export interface VideoCharacter { id: string; productId: string; name: string; description: string; createdAt: number; reference?: VideoAsset; approvedAt?: number; }
export const storyBibleSchema = z.object({ premise: z.string().trim().min(10).max(500), audience: z.string().trim().min(5).max(500), visualStyle: z.string().trim().min(10).max(600), world: z.string().trim().min(10).max(1000), rules: z.string().trim().max(1000) }).strict();
export type VideoBible = z.infer<typeof storyBibleSchema> & { productId: string; revision: number };
export interface VideoReview { consistent: boolean; polished: boolean; followsBrief: boolean; issues: string[]; description: string; model: string; checkedAt: number; }
export interface VideoJob {
  cloudEstimate?: { cents: number; priceRevision: string };
  sourceTaskId?: string;
  localModel?: 'h3' | 'ltx25'; renderer?: 'local' | 'cloud'; localProfile?: 'mick4' | 'preview4' | 'quality20'; sparseAttention?: boolean; localCheckpoint?: 'w4a8' | 'int8';
  id: string; productId: string; kind: 'character' | 'shot' | 'ad'; title: string; brief: string;
  characterId?: string; characters: VideoCharacter[]; duration: number; ratio: VideoBrief['ratio'];
  phase: 'queued' | 'planning' | 'blockout' | 'submitting' | 'remote' | 'review' | 'ready' | 'attention' | 'paused';
  detail: string; createdAt: number; updatedAt: number;
  shot?: VideoShot; blockout?: VideoAsset; output?: VideoAsset; review?: VideoReview;
  bible?: VideoBible;
  assembly?: VideoAssembly; approvedAt?: number;
  remoteFinished?: boolean;
  submittedAt?: number; remote?: { provider: 'higgsfield' | 'minimax' | 'comfy'; id: string; statusUrl?: string }; nextPollAt?: number;
}
export const videoConfigSchema = z.object({ blenderPath: z.string().max(2000), ffmpegPath: z.string().max(2000), dailyCloudLimit: z.number().int().min(0).max(30), agentCloudEnabled: z.boolean().default(false), h3DailyBudgetUsd: z.number().finite().min(0).max(1000).multipleOf(0.01).default(0), h3MaxShotUsd: z.number().finite().min(0).max(50).multipleOf(0.01).default(0), agentDailyLimit: z.number().int().min(0).max(12).default(2), renderer: z.enum(['local', 'cloud']).default('local'), localModel: z.enum(['h3', 'ltx25']).default('h3'), comfyUrl: localUrl.default('http://127.0.0.1:8188'), localProfile: z.enum(['mick4', 'preview4', 'quality20']).default('mick4'), localCheckpoint: z.enum(['w4a8', 'int8']).default('w4a8'), sparseAttention: z.boolean().default(false) }).strict();
export type VideoConfig = z.infer<typeof videoConfigSchema>;
export interface VideoView { adDirector?: AdDirectorPlan[]; campaigns?: VideoCampaignView; cloudBudget: { attemptedCents: number; limitCents: number; maxShotCents: number; priceRevision: string }; localRenderHold?: string | undefined; publishing?: YoutubeView; config: VideoConfig; higgsfieldConnected: boolean; minimaxConnected: boolean; blenderReady: boolean; ffmpegReady: boolean; narrationReady: boolean; music: VideoMusic[]; offline: boolean; characters: VideoCharacter[]; bibles: VideoBible[]; jobs: VideoJob[]; }
export const videoActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ad-research'), productId: z.string(), value: adDirectorBriefSchema }).strict(),
  z.object({ type: z.literal('ad-produce'), productId: z.string(), id: z.string(), index: z.number().int().min(0).max(2), characterId: z.string() }).strict(),
  z.object({ type: z.literal('ad-assemble'), productId: z.string(), id: z.string(), index: z.number().int().min(0).max(2), productClipId: z.string() }).strict(),
  z.object({ type: z.literal('campaign-configure'), productId: z.string(), value: videoCampaignPolicySchema }).strict(),
  z.object({ type: z.literal('youtube-configure'), productId: z.string(), value: youtubePolicySchema }).strict(),
  z.object({ type: z.literal('youtube-queue'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('youtube-retry'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('youtube-cancel'), productId: z.string(), id: z.string(), acceptUncertain: z.boolean() }).strict(),
  z.object({ type: z.literal('check-local') }).strict(),
  z.object({ type: z.literal('install-narration') }).strict(),
  z.object({ type: z.literal('import-music'), productId: z.string(), title: z.string().trim().min(3).max(120) }).strict(),
  z.object({ type: z.literal('bible'), productId: z.string(), value: storyBibleSchema }).strict(),
  z.object({ type: z.literal('configure'), value: videoConfigSchema, higgsfieldId: z.string().max(500), higgsfieldSecret: z.string().max(4000), minimaxKey: z.string().max(4000) }).strict(),
  z.object({ type: z.literal('choose-tool'), tool: z.enum(['blender', 'ffmpeg']) }).strict(),
  z.object({ type: z.literal('character'), productId: z.string(), name: z.string().trim().min(2).max(100), description: z.string().trim().min(30).max(1800), generate: z.boolean(), source: z.enum(['local', 'higgsfield']).optional() }).strict(),
  z.object({ type: z.literal('approve-character'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('shot'), productId: z.string(), value: videoBriefSchema }).strict(),
  z.object({ type: z.literal('import-clip'), productId: z.string(), title: z.string().trim().min(3).max(120) }).strict(),
  z.object({ type: z.literal('approve-clip'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('assemble'), productId: z.string(), value: videoAdSchema }).strict(),
  z.object({ type: z.literal('pause'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('resume'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('open'), productId: z.string(), id: z.string(), asset: z.enum(['output', 'blockout', 'blend']) }).strict(),
]);
export type VideoAction = z.infer<typeof videoActionSchema>;
export function videoFrames(job: Pick<VideoJob, 'duration' | 'renderer'>) { const frames = Math.round(job.duration * 24); return job.renderer === 'local' ? frames + ((5 - frames % 17 + 17) % 17) : frames; }
