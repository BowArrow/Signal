import { join, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CreativeInstaller } from '../src/core/runtime/creative-install.js';

if (!process.env['APPDATA'] || !process.env['LOCALAPPDATA']) throw new Error('Windows user folders are unavailable.');
const profile = join(process.env['APPDATA'], 'signal');
const installer = new CreativeInstaller(join(profile, 'runtime', 'creative'), resolve('node_modules/7zip-bin/win/x64/7za.exe'));
const source = join(process.env['LOCALAPPDATA'], 'ai.dndrom.desktop/runtime/comfy-0.34.0/ComfyUI_windows_portable');
let prepared = '';
installer.begin(source, folder => { prepared = folder; });
while (!prepared && !['error', 'cancelled'].includes(installer.progress.phase)) {
  console.log(JSON.stringify(installer.progress)); await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!prepared) throw new Error(installer.progress.detail);
// A Python version check does not load PyTorch, ComfyUI, models, or a GPU.
const python = spawnSync(join(prepared, 'python_embeded/python.exe'), ['--version'], { windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000 });
if (python.status !== 0) throw new Error('The copied Python runtime could not start.');
const result = { installed: installer.installed(), folder: prepared, python: python.stdout.trim(), modelRoots: installer.modelRoots(), gpuStarted: false, ownerSettingsChanged: false };
mkdirSync('data/creative-validation', { recursive: true }); writeFileSync('data/creative-validation/owned-setup.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
