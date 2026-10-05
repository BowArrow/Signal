import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreativeInstaller, inside, modelPaths } from '../../src/core/runtime/creative-install.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'signal-creative-')); roots.push(root);
  const source = join(root, 'existing'); const base = join(root, 'owned');
  for (const dir of ['python_embeded/Lib/models', 'ComfyUI/models', 'ComfyUI/custom_nodes', 'ComfyUI/user', 'ComfyUI/output']) await mkdir(join(source, dir), { recursive: true });
  for (const [path, value] of Object.entries({ 'python_embeded/python.exe': 'fixture', 'python_embeded/Lib/models/code.py': 'library code', 'ComfyUI/main.py': 'core', 'ComfyUI/models/weight.bin': 'weights', 'ComfyUI/custom_nodes/plugin.py': 'plugin', 'ComfyUI/user/private.json': 'private', 'ComfyUI/output/customer.png': 'customer', 'ComfyUI/extra_model_paths.yaml': 'untrusted custom paths' })) await writeFile(join(source, path), value);
  return { root, source, base, installer: new CreativeInstaller(base, join(root, 'extractor.exe')) };
}
async function finish(installer: CreativeInstaller) { await vi.waitFor(() => expect(['done', 'error', 'cancelled']).toContain(installer.progress.phase)); }
describe('Signal-owned creative setup', () => {
  it('copies an independent core and Python without private files or custom nodes; reuses only model paths', async () => {
    const { installer, source } = await fixture(); const complete = vi.fn(); installer.begin(source, complete); await finish(installer);
    expect(installer.progress.phase).toBe('done'); expect(installer.installed()).toBe(true); expect(complete).toHaveBeenCalledExactlyOnceWith(installer.root);
    expect(await readFile(join(installer.root, 'python_embeded/Lib/models/code.py'), 'utf8')).toBe('library code');
    for (const path of ['ComfyUI/models/weight.bin', 'ComfyUI/custom_nodes/plugin.py', 'ComfyUI/user/private.json', 'ComfyUI/output/customer.png', 'ComfyUI/extra_model_paths.yaml']) expect(existsSync(join(installer.root, path))).toBe(false);
    expect(installer.modelRoots()).toEqual([join(source, 'ComfyUI/models')]);
    await writeFile(join(source, 'ComfyUI/main.py'), 'changed by another app'); expect(await readFile(join(installer.root, 'ComfyUI/main.py'), 'utf8')).toBe('core');
    expect(await readFile(join(source, 'ComfyUI/models/weight.bin'), 'utf8')).toBe('weights');
    expect((await readdir(installer.base)).filter(name => name.startsWith('setup-'))).toEqual([]);
  });
  it('prevents simultaneous setups and cleans only its own staging folder on cancellation', async () => {
    const { installer, source, base } = await fixture(); const complete = vi.fn();
    await mkdir(base); await writeFile(join(base, 'keep.txt'), 'keep');
    installer.begin(source, complete); expect(() => installer.begin(source, complete)).toThrow('already running'); await installer.stop();
    expect(installer.progress.phase).toBe('cancelled'); expect(complete).not.toHaveBeenCalled(); expect(installer.installed()).toBe(false);
    expect(await readdir(base)).toEqual(['keep.txt']); expect(existsSync(join(source, 'python_embeded/python.exe'))).toBe(true);
  });
  it('reuses a completed owned installation without recopying or executing it', async () => {
    const { installer, source } = await fixture(); const complete = vi.fn(); installer.begin(source, complete); await finish(installer); await installer.stop();
    installer.begin('missing', complete); expect(complete).toHaveBeenCalledTimes(2); expect(installer.installed()).toBe(true);
  });
  it('fails a truncated download before extraction or activating the installation', async () => {
    const { installer, root } = await fixture(); await writeFile(join(root, 'extractor.exe'), 'not executed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('incorrect archive')));
    const complete = vi.fn(); installer.begin('', complete); await finish(installer);
    expect(installer.progress.phase).toBe('error'); expect(installer.progress.detail).toContain('SHA-256'); expect(complete).not.toHaveBeenCalled(); expect(await readdir(installer.base)).toEqual([]);
  });
  it('does not replace an existing incomplete installation', async () => {
    const { installer, source } = await fixture(); await mkdir(installer.root, { recursive: true }); await writeFile(join(installer.root, 'keep'), 'user file');
    installer.begin(source, vi.fn()); await finish(installer); expect(installer.progress.phase).toBe('error'); expect(await readFile(join(installer.root, 'keep'), 'utf8')).toBe('user file');
  });
  it('bounds cleanup paths and serializes model roots as quoted YAML values', async () => {
    const { root } = await fixture(); expect(inside(root, join(root, 'stage'))).toBe(true); expect(inside(root, root)).toBe(false); expect(inside(root, join(root, '..', 'other'))).toBe(false);
    expect(modelPaths([root, join(root, 'absent')])).toContain('base_path: "'); expect(modelPaths([root])).not.toContain('custom_nodes:');
  });
});
