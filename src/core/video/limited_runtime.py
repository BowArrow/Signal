"""Own a Windows renderer job with enforced commit limits and a separate watchdog.

The child waits for its job assignment before importing torch or ComfyUI.
The watchdog uses Win32 counters, not a PowerShell/CIM subprocess.
"""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time

GIB = 1024 ** 3


class BasicLimit(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]


class ExtendedLimit(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BasicLimit), ('IoInfo', IoCounters),
                ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]


class MemoryStatus(ctypes.Structure):
    _fields_ = [('dwLength', wintypes.DWORD), ('dwMemoryLoad', wintypes.DWORD)] + [
        (name, ctypes.c_uint64) for name in ('ullTotalPhys', 'ullAvailPhys', 'ullTotalPageFile', 'ullAvailPageFile', 'ullTotalVirtual', 'ullAvailVirtual', 'ullAvailExtendedVirtual')]


def win32():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateJobObjectW': ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
        'SetInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
        'QueryInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
        'AssignProcessToJobObject': ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        'SetProcessWorkingSetSizeEx': ([wintypes.HANDLE, ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD], wintypes.BOOL),
        'GetProcessWorkingSetSizeEx': ([wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
        'TerminateJobObject': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        'GlobalMemoryStatusEx': ([ctypes.POINTER(MemoryStatus)], wintypes.BOOL),
        'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
    }
    for name, (args, result) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes = args
        function.restype = result
    return kernel


def checked(value):
    if not value:
        raise ctypes.WinError(ctypes.get_last_error())
    return value


def memory(kernel):
    current = MemoryStatus()
    current.dwLength = ctypes.sizeof(current)
    checked(kernel.GlobalMemoryStatusEx(ctypes.byref(current)))
    return {'availableRamBytes': current.ullAvailPhys, 'availableCommitBytes': current.ullAvailPageFile}


def report(path, state):
    state['updatedAt'] = int(time.time() * 1000)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state), encoding='utf-8')
    os.replace(temporary, path)


def supervise(args):
    if sys.platform != 'win32':
        raise RuntimeError('This managed renderer requires Windows memory enforcement.')
    kernel = win32()
    status = Path(args.status).resolve()
    status.parent.mkdir(parents=True, exist_ok=True)
    state = {'state': 'starting', 'supervisorPid': os.getpid(), 'ramLimitBytes': int(args.ram_gb * GIB), 'gpuLimitBytes': 0 if args.cpu_only else int(args.gpu_gb * GIB),
             'reserveRamBytes': int(args.reserve_ram_gb * GIB), 'reserveCommitBytes': int(args.reserve_commit_gb * GIB),
             'workingSetLimitBytes': int(min(args.ram_gb, args.working_set_gb) * GIB)}
    dynamic = getattr(args, 'dynamic_vram', False)
    device_budget = int(getattr(args, 'device_vram_gb', 8) * GIB)
    gpu_read = None
    if dynamic:
        import pynvml
        pynvml.nvmlInit()
        device = pynvml.nvmlDeviceGetHandleByIndex(0)
        def gpu_read():
            info = pynvml.nvmlDeviceGetMemoryInfo(device)
            return {'availableGpuBytes': info.free, 'usedGpuBytes': info.used,
                    'gpuTemperatureC': pynvml.nvmlDeviceGetTemperature(device, pynvml.NVML_TEMPERATURE_GPU)}
        state.update(gpuLimitBytes=0, gpuControl='dynamic headroom target with sampled watchdog; not a hard allocation cap', reserveGpuBytes=GIB)
        state['deviceVramBudgetBytes'] = device_budget
    current = memory(kernel)
    if gpu_read:
        current.update(gpu_read())
    state.update(current)
    if gpu_read and (current['availableGpuBytes'] < 3 * GIB or current['usedGpuBytes'] >= device_budget or current['gpuTemperatureC'] >= 78):
        state.update(state='held', reason='Not enough GPU headroom, or GPU is already warm.')
        report(status, state)
        return 72
    if current['availableRamBytes'] < state['reserveRamBytes'] + 2 * GIB or current['availableCommitBytes'] < state['ramLimitBytes'] + state['reserveCommitBytes']:
        state.update(state='held', reason='Not enough memory headroom to start the renderer safely.')
        report(status, state)
        return 72
    job = checked(kernel.CreateJobObjectW(None, None))
    child = None
    try:
        limits = ExtendedLimit()
        # Process + entire descendant job commit limits, and kill on supervisor exit.
        limits.BasicLimitInformation.LimitFlags = 0x100 | 0x200 | 0x2000
        limits.ProcessMemoryLimit = limits.JobMemoryLimit = state['ramLimitBytes']
        checked(kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        verified = ExtendedLimit()
        checked(kernel.QueryInformationJobObject(job, 9, ctypes.byref(verified), ctypes.sizeof(verified), None))
        if verified.JobMemoryLimit != state['ramLimitBytes'] or verified.ProcessMemoryLimit != state['ramLimitBytes']:
            raise RuntimeError('Windows did not retain the renderer memory limit.')
        command = [sys.executable, '-s', str(Path(__file__).resolve()), '--worker', '--gpu-gb', str(args.gpu_gb), *(['--cpu-only'] if args.cpu_only else []), *(['--dynamic-vram'] if dynamic else []), '--', *args.command]
        allocator = 'cudaMallocAsync' if dynamic else 'native'
        environment = dict(os.environ, PYTORCH_CUDA_ALLOC_CONF='backend:' + allocator, PYTORCH_ALLOC_CONF='backend:' + allocator)
        child = subprocess.Popen(command, stdin=subprocess.PIPE, env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        checked(kernel.AssignProcessToJobObject(job, wintypes.HANDLE(int(child._handle))))
        # Keep file-backed model pages pageable instead of consuming all free RAM.
        # The commit ceiling above remains independent and unchanged.
        process_handle = wintypes.HANDLE(int(child._handle))
        checked(kernel.SetProcessWorkingSetSizeEx(process_handle, 1024 * 1024, state['workingSetLimitBytes'], 0x2 | 0x4))
        minimum, maximum, flags = ctypes.c_size_t(), ctypes.c_size_t(), wintypes.DWORD()
        checked(kernel.GetProcessWorkingSetSizeEx(process_handle, ctypes.byref(minimum), ctypes.byref(maximum), ctypes.byref(flags)))
        if maximum.value > state['workingSetLimitBytes'] or not flags.value & 0x4:
            raise RuntimeError('Windows did not retain the physical working-set limit.')
        state['workingSetEnforced'] = True
        state.update(state='running', pid=child.pid, enforced=True)
        report(status, state)
        child.stdin.write(b'limits-active\n')
        child.stdin.close()
        last_report = 0
        while child.poll() is None:
            usage = ExtendedLimit()
            checked(kernel.QueryInformationJobObject(job, 9, ctypes.byref(usage), ctypes.sizeof(usage), None))
            state['peakJobCommitBytes'] = usage.PeakJobMemoryUsed
            state['peakProcessCommitBytes'] = usage.PeakProcessMemoryUsed
            current = memory(kernel)
            if gpu_read:
                current.update(gpu_read())
            state.update(current)
            state['minimumAvailableRamBytes'] = min(state.get('minimumAvailableRamBytes', current['availableRamBytes']), current['availableRamBytes'])
            state['minimumAvailableCommitBytes'] = min(state.get('minimumAvailableCommitBytes', current['availableCommitBytes']), current['availableCommitBytes'])
            if gpu_read:
                state['peakSystemGpuUsedBytes'] = max(state.get('peakSystemGpuUsedBytes', 0), current['usedGpuBytes'])
                state['peakGpuTemperatureC'] = max(state.get('peakGpuTemperatureC', 0), current['gpuTemperatureC'])
            if gpu_read and (current['availableGpuBytes'] < state['reserveGpuBytes'] or current['usedGpuBytes'] >= device_budget or current['gpuTemperatureC'] >= 78):
                checked(kernel.TerminateJobObject(job, 73))
                child.wait(timeout=10)
                state.update(state='stopped', reason='Renderer stopped to preserve GPU memory or temperature headroom.')
                report(status, state)
                return 73
            if current['availableRamBytes'] < state['reserveRamBytes'] or current['availableCommitBytes'] < state['reserveCommitBytes']:
                checked(kernel.TerminateJobObject(job, 73))
                child.wait(timeout=10)
                state.update(state='stopped', reason='Renderer stopped to preserve system memory headroom.')
                report(status, state)
                return 73
            if time.monotonic() - last_report > 2:
                report(status, state)
                last_report = time.monotonic()
            time.sleep(0.25)
        state.update(state='exited', exitCode=child.returncode)
        report(status, state)
        return child.returncode
    finally:
        if child is not None and child.poll() is None:
            kernel.TerminateJobObject(job, 74)
            child.wait(timeout=10)
        kernel.CloseHandle(job)


def worker(args):
    if sys.stdin.buffer.readline() != b'limits-active\n':
        raise RuntimeError('Renderer memory enforcement was not confirmed.')
    # A tiny, non-GPU workload verifies the real Windows allocation limit.
    if args.command == ['allocation-test']:
        blocks = []
        try:
            for _ in range(64):
                blocks.append(bytearray(16 * 1024 * 1024))
        except MemoryError:
            print(json.dumps({'allocationDenied': True, 'allocatedMiB': len(blocks) * 16}), flush=True)
            return 0
        raise RuntimeError('Test allocation escaped its Windows memory cap.')
    if args.command == ['watchdog-test']:
        time.sleep(30)
        return 0
    if args.cpu_only or getattr(args, 'dynamic_vram', False):
        script = Path(args.command[0]).resolve()
        sys.path.insert(0, str(script.parent))
        sys.argv = [str(script), *args.command[1:]]
        runpy.run_path(str(script), run_name='__main__')
        return 0
    import torch
    if torch.cuda.is_available():
        device = torch.cuda.current_device()
        total = torch.cuda.get_device_properties(device).total_memory
        torch.cuda.set_per_process_memory_fraction(min(0.5, args.gpu_gb * GIB / total), device)
    if args.command == ['gpu-allocation-test']:
        blocks = []
        try:
            for _ in range(16):
                blocks.append(torch.empty(32 * 1024 * 1024, dtype=torch.uint8, device='cuda'))
        except torch.cuda.OutOfMemoryError:
            print(json.dumps({'gpuAllocationDenied': True, 'allocatedMiB': len(blocks) * 32}), flush=True)
            return 0
        raise RuntimeError('Test GPU allocation escaped its PyTorch cap.')
    script = Path(args.command[0]).resolve()
    sys.path.insert(0, str(script.parent))
    sys.argv = [str(script), *args.command[1:]]
    runpy.run_path(str(script), run_name='__main__')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', action='store_true')
    parser.add_argument('--cpu-only', action='store_true')
    parser.add_argument('--dynamic-vram', action='store_true', help='Use the LTX dynamic allocator with an independent NVML watchdog; no PyTorch-only cap claim.')
    parser.add_argument('--device-vram-gb', type=float, default=8, help='Dynamic-mode whole-device usage stop threshold in GiB, including other apps. Sampled, not a hard allocation cap.')
    parser.add_argument('--ram-gb', type=float, default=16)
    parser.add_argument('--working-set-gb', type=float, default=8)
    parser.add_argument('--gpu-gb', type=float, default=5)
    parser.add_argument('--reserve-ram-gb', type=float, default=6)
    parser.add_argument('--reserve-commit-gb', type=float, default=8)
    parser.add_argument('--status')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == '--':
        args.command.pop(0)
    if args.dynamic_vram and (args.cpu_only or not args.command or Path(args.command[0]).name != 'ltx_runtime.py'):
        parser.error('Dynamic mode is only available through the managed LTX entry point.')
    if not args.command or not 0.1 <= args.ram_gb <= 16 or not 0.05 <= args.working_set_gb <= 8 or not 0.1 <= args.gpu_gb <= 5 or not 1 <= args.device_vram_gb <= 8 or args.reserve_ram_gb < 6 or args.reserve_commit_gb < 8:
        parser.error('Use a command and conservative memory limits: RAM <=16 GiB, GPU <=5 GiB, system reserves >=6/8 GiB.')
    try:
        sys.exit(worker(args) if args.worker else supervise(args))
    except Exception as error:
        print('Signal renderer stopped: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(74)
