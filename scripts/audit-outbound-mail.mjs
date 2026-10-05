// Owner-authorized, two-recipient LTD placement inquiries. No scheduled sends.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mode = 'check';
if (!['check', 'send', 'record'].includes(mode)) throw Error('Choose check, send or record');
const env = { ...process.env, SIGNAL_LTD_HELPER_PROFILE: mkdtempSync(join(tmpdir(),'signal-ltd-mail-')), SIGNAL_LTD_MAIL_MODE: mode };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [resolve('scripts/audit-outbound-mail.cjs'),'--disable-gpu'], {env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
child.on('exit',code=>{process.exitCode=code??1;});
