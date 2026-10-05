"""Small Windows integration tests; never load a model or use the GPU."""
import argparse
import ctypes
from ctypes import wintypes
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'src/core/video/limited_runtime.py'
ROOT = SCRIPT.parents[3] / 'data/runtime-limit-validation'
ROOT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('limits', SCRIPT)
limits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limits)


class LimitsTest(unittest.TestCase):
    def test_dynamic_gpu_watchdog_stops_only_its_job_without_loading_gpu(self):
        worker = self.folder / 'ltx_runtime.py'
        worker.write_text('import time; time.sleep(30)')
        args = argparse.Namespace(status=str(self.status), ram_gb=0.25, working_set_gb=0.25, gpu_gb=5, reserve_ram_gb=6, reserve_commit_gb=8, cpu_only=False, dynamic_vram=True, command=[str(worker)])
        readings = iter([SimpleNamespace(free=4 * limits.GIB, used=6 * limits.GIB), SimpleNamespace(free=limits.GIB // 2, used=9 * limits.GIB)])
        nvml = SimpleNamespace(nvmlInit=lambda: None, nvmlDeviceGetHandleByIndex=lambda _: 0, nvmlDeviceGetMemoryInfo=lambda _: next(readings), nvmlDeviceGetTemperature=lambda *_: 35, NVML_TEMPERATURE_GPU=0)
        with patch.dict(sys.modules, {'pynvml': nvml}), patch.object(limits, 'memory', return_value={'availableRamBytes': 20 * limits.GIB, 'availableCommitBytes': 40 * limits.GIB}):
            self.assertEqual(limits.supervise(args), 73)
        state = json.loads(self.status.read_text())
        self.assertEqual(state['gpuLimitBytes'], 0)
        self.assertIn('GPU memory', state['reason'])

    def test_eight_gib_device_budget_stops_even_with_free_vram(self):
        worker = self.folder / 'ltx_runtime.py'
        worker.write_text('import time; time.sleep(30)')
        args = argparse.Namespace(status=str(self.status), ram_gb=0.25, working_set_gb=0.25, gpu_gb=5, reserve_ram_gb=6, reserve_commit_gb=8, cpu_only=False, dynamic_vram=True, device_vram_gb=8, command=[str(worker)])
        # There is still 2 GiB free: the old 1 GiB free-memory guard would miss it.
        readings = iter([SimpleNamespace(free=4 * limits.GIB, used=6 * limits.GIB), SimpleNamespace(free=2 * limits.GIB, used=8 * limits.GIB)])
        nvml = SimpleNamespace(nvmlInit=lambda: None, nvmlDeviceGetHandleByIndex=lambda _: 0, nvmlDeviceGetMemoryInfo=lambda _: next(readings), nvmlDeviceGetTemperature=lambda *_: 35, NVML_TEMPERATURE_GPU=0)
        with patch.dict(sys.modules, {'pynvml': nvml}), patch.object(limits, 'memory', return_value={'availableRamBytes': 20 * limits.GIB, 'availableCommitBytes': 40 * limits.GIB}):
            self.assertEqual(limits.supervise(args), 73)
        state = json.loads(self.status.read_text())
        self.assertEqual(state['deviceVramBudgetBytes'], 8 * limits.GIB)
        self.assertEqual(state['state'], 'stopped')

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix='check-', dir=ROOT))
        self.status = self.folder / 'status.json'

    def command(self, mode, *extra):
        return [sys.executable, '-s', str(SCRIPT), '--ram-gb', '0.25', '--status', str(self.status), *extra, '--', mode]

    def test_windows_denies_allocation_at_cap(self):
        result = subprocess.run(self.command('allocation-test'), capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['allocationDenied'])
        state = json.loads(self.status.read_text())
        self.assertTrue(state['enforced'])
        self.assertEqual(state['ramLimitBytes'], 256 * 1024 * 1024)
        self.assertTrue(state['workingSetEnforced'])
        self.assertEqual(state['workingSetLimitBytes'], 256 * 1024 * 1024)

    def test_cpu_worker_runs_without_importing_torch(self):
        worker = self.folder / 'cpu-check.py'
        worker.write_text('import json,sys; print(json.dumps({"torchLoaded": "torch" in sys.modules}))')
        result = subprocess.run(self.command(str(worker), '--cpu-only'), capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)['torchLoaded'])
        state = json.loads(self.status.read_text())
        self.assertTrue(state['enforced'])
        self.assertEqual(state['gpuLimitBytes'], 0)

    def test_physical_working_set_stays_below_cap_while_committed_memory_is_larger(self):
        worker = self.folder / 'working-set-check.py'
        worker.write_text('''import ctypes,json
from ctypes import wintypes
class Counters(ctypes.Structure):
    _fields_ = [('cb',wintypes.DWORD),('faults',wintypes.DWORD)] + [(name,ctypes.c_size_t) for name in ('peak','working','pp','p','pnp','np','page','peakpage','private')]
kernel=ctypes.WinDLL('kernel32'); kernel.GetCurrentProcess.restype=wintypes.HANDLE
psapi=ctypes.WinDLL('psapi'); psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD]
data=bytearray(128*1024*1024)
for i in range(0,len(data),4096): data[i]=1
c=Counters(); c.cb=ctypes.sizeof(c)
assert psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(c),ctypes.sizeof(c))
print(json.dumps({'working':c.working,'private':c.private}))
''')
        result = subprocess.run(self.command(str(worker), '--cpu-only', '--working-set-gb', '0.0625'), capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        measured = json.loads(result.stdout)
        self.assertGreater(measured['private'], 128 * 1024**2)
        self.assertLessEqual(measured['working'], 68 * 1024**2)

    def test_low_headroom_prevents_child_launch(self):
        result = subprocess.run(self.command('watchdog-test', '--reserve-commit-gb', '100000'), capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 72, result.stderr)
        state = json.loads(self.status.read_text())
        self.assertEqual(state['state'], 'held')
        self.assertNotIn('pid', state)

    def test_memory_drop_stops_job_without_allocating_memory(self):
        args = argparse.Namespace(status=str(self.status), ram_gb=0.25, working_set_gb=8, gpu_gb=5, reserve_ram_gb=6, reserve_commit_gb=8, cpu_only=False, command=['watchdog-test'])
        enough = {'availableRamBytes': 20 * limits.GIB, 'availableCommitBytes': 40 * limits.GIB}
        low = {'availableRamBytes': 5 * limits.GIB, 'availableCommitBytes': 40 * limits.GIB}
        with patch.object(limits, 'memory', side_effect=[enough, low]):
            self.assertEqual(limits.supervise(args), 73)
        self.assertEqual(json.loads(self.status.read_text())['state'], 'stopped')

    def test_supervisor_exit_kills_only_its_worker(self):
        parent = subprocess.Popen(self.command('watchdog-test'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        handle = None
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if self.status.exists():
                    state = json.loads(self.status.read_text())
                    if state.get('state') == 'running':
                        handle = kernel.OpenProcess(0x100000, False, state['pid'])
                        break
                time.sleep(0.05)
            self.assertTrue(handle, 'Capped worker did not start')
            parent.kill()
            parent.wait(timeout=5)
            self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0, 'Worker survived supervisor termination')
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=5)
            if handle:
                kernel.CloseHandle(handle)


if __name__ == '__main__':
    unittest.main()
