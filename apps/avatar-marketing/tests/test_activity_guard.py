import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
import threading
import unittest
from unittest.mock import patch
import uuid

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'apps/avatar-marketing'))
from alex_activity_guard import evaluate, WindowsProbe
from alex_generation_supervisor import OwnedTree, supervise, bounded_sample

import tempfile
ARTIFACTS=Path(tempfile.mkdtemp(prefix='alex-guard-evidence-'))

def moment(value): return datetime.fromisoformat(value)

def good(**patches):
    result=dict(monotonicAt=100.0,probeDurationSeconds=.01,sessionId=8,consoleSessionId=8,
                activeSessionIds=[8],idleMs=600000,lastInputTick=42,notificationState=5,
                desktopForeground=True,controllerState='none-connected',processInventoryComplete=True,
                games=[],unapprovedProcesses=[])
    result.update(patches); return result

class PolicyTests(unittest.TestCase):
    def decide(self,sample=None,at='2026-10-25T08:00:00+00:00',**kwargs):
        return evaluate(good() if sample is None else sample,moment(at),monotonic_now=100.0,**kwargs)

    def test_window_and_boundary(self):
        cases=[('2026-10-25T06:59:59+00:00',False),('2026-10-25T07:00:00+00:00',True),
               ('2026-10-25T20:59:57+00:00',True),('2026-10-25T21:00:00+00:00',False)]
        for when,ready in cases:
            with self.subTest(when=when):self.assertEqual(self.decide(at=when)['ready'],ready)
        self.assertFalse(self.decide(at='2026-10-25T20:59:58+00:00',starting=True)['ready'])
        self.assertTrue(self.decide(at='2026-10-25T20:59:58+00:00')['ready'])

    def test_pacific_dst(self):
        for when in ['2026-11-01T08:30:00+00:00','2026-11-01T09:30:00+00:00','2026-11-01T21:59:57+00:00','2027-03-14T20:59:57+00:00']:
            self.assertTrue(self.decide(at=when)['ready'])
        for when in ['2026-11-01T22:00:00+00:00','2027-03-14T21:00:00+00:00']:
            self.assertFalse(self.decide(at=when)['ready'])

    def test_unknown_and_stale_states_fail_closed(self):
        states=[{},'bad',{'error':'Access denied (5)'},good(monotonicAt=97),good(monotonicAt=101),
                good(probeDurationSeconds=1.1),good(processInventoryComplete=False),good(consoleSessionId=9),
                good(activeSessionIds=[8,9])]
        for state in states:
            with self.subTest(state=state):self.assertFalse(self.decide(state)['ready'])

    def test_mouse_browser_and_controller_do_not_hold(self):
        states=[good(idleMs=0,lastInputTick=43),good(notificationState=2),good(notificationState=3),
                good(desktopForeground=False),good(controllerState='connected'),good(unapprovedProcesses=[456])]
        for state in states:
            with self.subTest(state=state):self.assertTrue(self.decide(state)['ready'])

    def test_game_holds(self):
        self.assertFalse(self.decide(good(games=[123]))['ready'])

    def test_input_resume_monitor_gap_and_clock_jump_stop(self):
        previous={**good(monotonicAt=99.75),'wallAt':moment('2026-10-25T07:59:59.750+00:00')}
        self.assertTrue(self.decide(previous=previous)['ready'])
        self.assertTrue(self.decide(good(lastInputTick=43),previous=previous)['ready'])
        self.assertFalse(self.decide(previous={**previous,'monotonicAt':97})['ready'])
        self.assertFalse(self.decide(previous={**previous,'wallAt':moment('2026-10-25T07:50:00+00:00')})['ready'])

    def test_permission_failure_is_latched_without_retry(self):
        probe=object.__new__(WindowsProbe);probe.denied='OpenProcess denied (5)'
        probe.k=object();probe.u=object()
        self.assertEqual(probe.capture(),{'error':'OpenProcess denied (5)'})
        self.assertEqual(probe.capture(),{'error':'OpenProcess denied (5)'})

class FakeProbe:
    def __init__(self,states):self.states=iter(states)
    def capture(self,*args):return {**good(monotonicAt=time.monotonic()),**next(self.states)}

class FakeOwner:
    def __init__(self,*args):
        self.started=False;self.released=False;self.stopped=False;self.closed=False
        self.child=self;self.returncode=None
    def start(self):self.started=True
    def release(self):self.released=True
    def members(self):return [9876] if self.started and not self.stopped else []
    def poll(self):return None
    def stop(self):self.stopped=True
    def close(self):self.closed=True

class SupervisorTests(unittest.TestCase):
    def run_case(self,states,times=None):
        owner=FakeOwner(); times=iter(times or ['2026-10-25T08:00:00+00:00']*10)
        result=supervise(['test-only'],ROOT,probe=FakeProbe(states),clock=lambda:moment(next(times)),sleeper=lambda _:None,owner_factory=lambda *args:owner)
        return result,owner

    def test_initial_hold_never_creates_a_child(self):
        result,owner=self.run_case([{'games':[123]}]);self.assertFalse(owner.started);self.assertEqual(result['state'],'deferred')

    def test_game_before_release_never_starts_target(self):
        result,owner=self.run_case([{}, {'games':[123]}]);self.assertTrue(owner.stopped);self.assertFalse(owner.released);self.assertFalse(result['started'])

    def test_game_start_stops_owned_tree(self):
        result,owner=self.run_case([{}, {}, {'games':[123]}]);self.assertTrue(owner.released and owner.stopped and owner.closed);self.assertTrue(result['ownedTreeExitVerified'])

    def test_window_closure_stops_owned_tree(self):
        result,owner=self.run_case([{}, {}, {}],['2026-10-25T20:59:55+00:00','2026-10-25T20:59:55+00:00','2026-10-25T21:00:00+00:00']);self.assertTrue(owner.stopped);self.assertIn('Outside',result['reason'])

    def test_unknown_state_stops_owned_tree(self):
        result,owner=self.run_case([{}, {}, {'error':'Process enumeration unavailable'}]);self.assertTrue(owner.stopped);self.assertEqual(result['state'],'stopped')

    def test_probe_timeout_stops_owned_tree(self):
        release=threading.Event()
        class StuckProbe:
            calls=0
            def capture(self,*args):
                self.calls+=1
                if self.calls==3:release.wait(2)
                return good(monotonicAt=time.monotonic())
        owner=FakeOwner();probe=StuckProbe()
        try:
            result=supervise(['test-only'],ROOT,probe=probe,clock=lambda:moment('2026-10-25T08:00:00+00:00'),sleeper=lambda _:None,owner_factory=lambda *args:owner,sample_timeout=.02)
            self.assertTrue(owner.released and owner.stopped and owner.closed)
            self.assertIn('timed out',result['reason']);self.assertEqual(probe.calls,3)
        finally:release.set()

    def test_probe_exception_is_unknown_state(self):
        class BrokenProbe:
            def capture(self,*args):raise RuntimeError('Synthetic sensor error')
        self.assertIn('Synthetic sensor error',bounded_sample(BrokenProbe())['error'])

class LiveOwnershipTests(unittest.TestCase):
    def test_lightweight_owned_tree_stop_preserves_unrelated_process(self):
        folder=ARTIFACTS/str(uuid.uuid4());folder.mkdir(parents=True)
        marker=folder/'owned-pids.json'
        sentinel=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(15)'],creationflags=subprocess.CREATE_NO_WINDOW)
        code=('import subprocess,sys,os,time,json,pathlib; '
              'child=subprocess.Popen([sys.executable,"-B","-c","import time;time.sleep(15)"],creationflags=subprocess.CREATE_NO_WINDOW); '
              'pathlib.Path(sys.argv[1]).write_text(json.dumps([os.getpid(),child.pid])); time.sleep(15)')
        tree=OwnedTree([sys.executable,'-B','-c',code,str(marker)],ROOT)
        try:
            tree.start()
            self.assertFalse(marker.exists(),'Target must wait for explicit release after ownership verification.')
            tree.release()
            deadline=time.monotonic()+4
            while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(marker.exists())
            owned=json.loads(marker.read_text());members=tree.members()
            self.assertTrue(set(owned).issubset(set(members)))
            tree.stop()
            self.assertEqual(tree.members(),[])
            self.assertIsNone(sentinel.poll(),'Unrelated sentinel must survive owned-tree termination.')
            (folder/'result.json').write_text(json.dumps({'ownedParentAndDescendantStopped':True,'unrelatedSentinelAlive':True,'noModelsLoaded':True}))
        finally:
            tree.close()
            if sentinel.poll() is None:sentinel.terminate()
            sentinel.wait(timeout=5)

if __name__=='__main__':unittest.main(verbosity=2)
