"""Own only a newly created generation tree; hold or stop on any unsafe state.

The child bootstrap blocks on stdin until its anonymous Windows Job Object has
kill-on-close enabled and membership verified. No arbitrary PID termination.
"""
import argparse
import os
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import queue
import threading
import time

from alex_activity_guard import WindowsProbe, evaluate, MAX_SAMPLE_AGE_SECONDS, generation_authorized

def memory_api(workspace):
    spec = importlib.util.spec_from_file_location('alex_existing_limits', Path(workspace)/'src/core/video/limited_runtime.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

class OwnedTree:
    def __init__(self, command, workspace, python=None):
        self.command = command; self.workspace = str(workspace); self.python = python or sys.executable
        self.api = memory_api(workspace); self.k = self.api.win32()
        self.k.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        self.k.IsProcessInJob.restype = wintypes.BOOL
        self.job = None; self.child = None; self.stopped = False

    def start(self):
        self.job = self.api.checked(self.k.CreateJobObjectW(None, None))
        try:
            limits = self.api.ExtendedLimit(); limits.BasicLimitInformation.LimitFlags = 0x2000
            self.api.checked(self.k.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            verified = self.api.ExtendedLimit()
            self.api.checked(self.k.QueryInformationJobObject(self.job, 9, ctypes.byref(verified), ctypes.sizeof(verified), None))
            if not verified.BasicLimitInformation.LimitFlags & 0x2000:
                raise RuntimeError('Kill-on-supervisor-exit was not retained.')
            self.child = subprocess.Popen([self.python, '-B', str(Path(__file__).resolve()), '--owned-worker', *self.command],
                                          cwd=self.workspace, stdin=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            self.api.checked(self.k.AssignProcessToJobObject(self.job, wintypes.HANDLE(int(self.child._handle))))
            member = wintypes.BOOL()
            self.api.checked(self.k.IsProcessInJob(wintypes.HANDLE(int(self.child._handle)), self.job, ctypes.byref(member)))
            if not member.value:
                raise RuntimeError('Owned child Job Object membership was not verified.')
            return self
        except BaseException:
            # The bootstrap has not been released on assignment failure.
            # Terminate only this Popen child if it was never assigned.
            if self.child is not None and self.child.poll() is None:
                self.child.terminate(); self.child.wait(timeout=5)
            self.close()
            raise

    def release(self):
        self.child.stdin.write(b'alex-owned-tree-active\n'); self.child.stdin.close()

    def members(self):
        if not self.job: return []
        data = ctypes.create_string_buffer(8 + 4096 * ctypes.sizeof(ctypes.c_size_t))
        self.api.checked(self.k.QueryInformationJobObject(self.job, 3, data, len(data), None))
        count = ctypes.c_uint32.from_buffer(data, 4).value
        if count > 4096: raise RuntimeError('Owned process inventory overflow.')
        return list((ctypes.c_size_t * count).from_buffer(data, 8))

    def stop(self):
        if self.job:
            self.api.checked(self.k.TerminateJobObject(self.job, 75))
            deadline = time.monotonic() + 5
            while self.members():
                if time.monotonic() >= deadline:
                    raise RuntimeError('Owned-tree exit could not be confirmed; do not retry generation.')
                time.sleep(0.05)
        if self.child is not None: self.child.wait(timeout=5)
        self.stopped = True

    def close(self):
        if self.job:
            try:
                if self.members(): self.stop()
            finally:
                self.k.CloseHandle(self.job); self.job = None

def bounded_sample(probe, owned_pids=(), timeout=1):
    # A stuck sensor must not prevent the supervising thread from stopping its
    # owned job. The daemon performs only reads and is never retried on timeout.
    result=queue.Queue(maxsize=1)
    def read():
        try:result.put(probe.capture(owned_pids))
        except BaseException as error:result.put({'error':'Activity probe failed: '+str(error)})
    threading.Thread(target=read,daemon=True).start()
    try:return result.get(timeout=timeout)
    except queue.Empty:return {'error':'Activity probe timed out; no retry during this stage.'}

def supervise(command, workspace, probe=None, clock=None, sleeper=time.sleep, owner_factory=OwnedTree, sample_timeout=1):
    """No retries after a probe error or stopped stage. Completed artifacts survive."""
    probe = probe or WindowsProbe()
    clock = clock or (lambda: datetime.now(timezone.utc))
    first = bounded_sample(probe, timeout=sample_timeout)
    now = clock(); decision = evaluate(first, now, starting=True)
    if not decision['ready']:
        return {'state':'deferred', 'started':False, **decision}
    previous = {**first, 'wallAt':now}
    owner = owner_factory(command, workspace)
    try:
        owner.start()
        # Verify once more while the owned bootstrap is still blocked on stdin.
        second = bounded_sample(probe,owner.members(),sample_timeout); now = clock()
        decision = evaluate(second, now, previous=previous, starting=True)
        if not decision['ready']:
            owner.stop()
            return {'state':'deferred','started':False,'ownedTreeExitVerified':True,**decision}
        previous = {**second, 'wallAt':now}
        owner.release()
        while True:
            sample = bounded_sample(probe,owner.members(),sample_timeout)
            now = clock(); decision = evaluate(sample, now, previous=previous)
            if not decision['ready']:
                owner.stop()
                return {'state':'stopped', 'started':True, 'ownedTreeExitVerified':True, **decision}
            previous = {**sample, 'wallAt':now}
            if owner.child.poll() is not None:
                code = owner.child.returncode
                # A descendant still running is not a completed stage.
                if owner.members():
                    owner.stop()
                    return {'state':'stopped','started':True,'ownedTreeExitVerified':True,'ready':False,'reason':'A stage left descendants running.'}
                return {'state':'completed' if code == 0 else 'failed', 'started':True,'exitCode':code,'ready':code == 0}
            sleeper(0.25)
    finally:
        owner.close()

def main():
    if len(sys.argv)>1 and sys.argv[1]=='--owned-worker':
        if sys.stdin.buffer.readline()!=b'alex-owned-tree-active\n':
            raise RuntimeError('Parent did not verify owned-tree enforcement.')
        if generation_authorized(): os.environ['ALEX_OWNED_GENERATION']='supervised'
        return subprocess.call(sys.argv[2:], stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    parser=argparse.ArgumentParser()
    parser.add_argument('--workspace',type=Path,required=True)
    parser.add_argument('--probe',action='store_true')
    parser.add_argument('--check-generation',action='store_true')
    parser.add_argument('--require-owned',action='store_true')
    parser.add_argument('--manual-window-minutes',type=int,choices=range(1,61),help='Explicit one-off owner-requested test only; does not enable recurring work.')
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    if args.manual_window_minutes:
        os.environ['ALEX_MANUAL_GENERATION_UNTIL']=(datetime.now(timezone.utc)+timedelta(minutes=args.manual_window_minutes)).isoformat()
    policy=json.loads((args.workspace/'campaigns/alex-creator/activity-policy.json').read_text(encoding='utf-8-sig'))
    if args.check_generation:
        if not generation_authorized(require_owned=args.require_owned,policy=policy): raise RuntimeError('Generation paused, outside window, or not supervised.')
        sample=WindowsProbe().capture()
        result=evaluate(sample)
        print(json.dumps(result)); return 0 if result['ready'] else 75
    if args.probe:
        sample=WindowsProbe(policy.get('allowedBackgroundExecutables',[])).capture()
        result={'sample':sample,'decision':evaluate(sample)}
        print(json.dumps(result)); return 0 if result['decision']['ready'] else 75
    if not generation_authorized(policy=policy):
        print(json.dumps({'state':'deferred','started':False,'ready':False,'reason':'Generation paused or outside 00:00-14:00 America/Los_Angeles.'})); return 75
    command=args.command[1:] if args.command[:1]==['--'] else args.command
    if not command: raise RuntimeError('No generation command supplied.')
    result=supervise(command,args.workspace,probe=WindowsProbe())
    # Keep the target's final JSON receipt as the last stdout record consumed by
    # production-job.mjs (in particular, the edited-export receipt path).
    print(json.dumps({'generationGuard':result}),file=sys.stderr)
    return 0 if result['state']=='completed' else 75

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error:
        print(json.dumps({'state':'held','ready':False,'reason':str(error)}),file=sys.stderr)
        sys.exit(75)
