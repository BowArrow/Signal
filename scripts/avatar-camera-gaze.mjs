// Run the existing CineGen reference-eye renderer locally on avatar frames.
// The renderer learns iris appearance from the owner's recording and retains
// current eyelid contours, with blink/pose bypasses. No network requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/avatar-research/2026-10-19');
const work = path.join(out, 'face-refinement');
const cine = path.resolve(root, '../CineGen/src/Components/Pages/Editor/retouch');
const bin = path.join(process.env.LOCALAPPDATA, 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin');
const input = path.join(out, 'casey-avatar-relaxed.mp4');
const output = path.join(out, 'casey-avatar-camera.mp4');
const sha = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const { createReferenceEyes } = await import(pathToFileURL(path.join(cine, 'referenceEyes.js')).href);
const data = JSON.parse(fs.readFileSync(path.join(work, 'tracking.json'), 'utf8'));
if (data.sourceSha256 !== sha(path.join(out, 'avatar-motion-reference-no-watermark.mp4'))) throw new Error('Stale source tracking');
const { width, height } = data, bytes = width * height * 4;
function context(pixels) {
    return {
        canvas: { width, height }, pixels,
        getImageData(x, y, w, h) {
            const result = new Uint8ClampedArray(w * h * 4);
            for (let row = 0; row < h; row++) result.set(this.pixels.subarray(((row + y) * width + x) * 4, ((row + y) * width + x + w) * 4), row * w * 4);
            return new ImageData(result, w, h);
        },
        putImageData(image, x, y) {
            if (x !== 0 || y !== 0 || image.width !== width || image.height !== height) throw new Error('Expected full-frame result');
            this.pixels = image.data;
        },
    };
}
const engine = createReferenceEyes();
for (const reference of data.references) {
    const ctx = context(new Uint8ClampedArray(fs.readFileSync(path.join(work, reference.file))));
    engine.observe(ctx, reference.detection, reference.gaze, reference.time);
}
if (!engine.hasReference()) throw new Error('No valid camera-facing moment found in original recording');
const referenceSummary = engine.summary();
const chosen = data.references.find(r => r.time === referenceSummary.time);
fs.copyFileSync(path.join(work, chosen.file), path.join(work, 'selected-reference.rgba'));
console.log(JSON.stringify({ reference: referenceSummary, gaze: chosen.gaze }));
const before = path.join(work, 'relaxed.rgba'), after = path.join(work, 'camera.rgba');
execFileSync(path.join(bin, 'ffmpeg.exe'), ['-v', 'error', '-y', '-i', input, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', before]);
if (fs.statSync(before).size !== bytes * 150) throw new Error('Unexpected input frame count');
const sourceFd = fs.openSync(before, 'r'), outputFd = fs.openSync(after, 'w');
const checks = [];
try {
    for (let i = 0; i < 150; i++) {
        const pixels = new Uint8ClampedArray(bytes);
        if (fs.readSync(sourceFd, pixels, 0, bytes, i * bytes) !== bytes) throw new Error('Incomplete frame');
        const ctx = context(pixels), tracking = data.frames[i];
        const check = engine.render(ctx, tracking.detection, i / 25, { strength: .9, gaze: tracking.gaze });
        // Explicitly check that the renderer never touches the lower face.
        const lm = tracking.detection.faceLandmarks[0];
        const belowEyes = Math.ceil(Math.max(lm[145].y, lm[374].y) * height + 20);
        const start = belowEyes * width * 4;
        for (let p = start; p < bytes; p++) if (ctx.pixels[p] !== pixels[p]) throw new Error('Eye correction touched lower face');
        fs.writeSync(outputFd, ctx.pixels);
        checks.push({ frame: i, ...check });
    }
} finally { fs.closeSync(sourceFd); fs.closeSync(outputFd); }
execFileSync(path.join(bin, 'ffmpeg.exe'), ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`, '-framerate', '25', '-i', after, '-i', input,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-t', '6', '-movflags', '+faststart', output]);
execFileSync(path.join(bin, 'ffmpeg.exe'), ['-v', 'error', '-i', output, '-f', 'null', 'NUL']);
const audioHash = filename => execFileSync(path.join(bin, 'ffmpeg.exe'), ['-v', 'error', '-i', filename, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).toString().trim();
if (audioHash(input) !== audioHash(output)) throw new Error('Audio changed during gaze correction');
const probe = JSON.parse(execFileSync(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', output]));
const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
if (+video.nb_frames !== 150 || Math.abs(+video.duration - +audio.duration) > .04) throw new Error('Frame/audio duration mismatch');
const receipt = { inputSha256: sha(input), outputSha256: sha(output), referenceSummary, referenceGaze: chosen.gaze,
    referenceRendererSha256: sha(path.join(cine, 'referenceEyes.js')), appearanceRendererSha256: sha(path.join(cine, 'irisAppearance.js')),
    frames: 150, correctedFrames: checks.filter(c => c.corrected).length, width, height, seconds: 6,
    fullDecodePassed: true, audioPacketsUnchanged: true, lowerFaceUnchangedBeforeEncoding: true,
    qualityApproved: false, checks };
fs.writeFileSync(output.replace('.mp4', '.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ output, correctedFrames: receipt.correctedFrames, fullDecodePassed: true, audioPacketsUnchanged: true }));
