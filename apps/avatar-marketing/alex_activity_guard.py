"""Fail-closed Windows activity probe and policy. No CIM, hooks, or input injection.

No process titles, command lines, screen pixels, or keyboard contents are collected.
Process-name enumeration failure remains a hold. Ordinary activity is allowed.
"""
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
import os
import json
import time
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo('America/Los_Angeles')
MAX_SAMPLE_AGE_SECONDS = 2
SYSTEM_NAMES = frozenset(('csrss.exe', 'winlogon.exe', 'dwm.exe', 'fontdrvhost.exe'))
GAME_MARKERS = ('fortnite', 'overwatch', 'valorant', 'cyberpunk', 'gta5', 'rocketleague',
                'r5apex', 'cs2.exe', 'steamapps\\common', 'epic games', '\\games\\', 'minecraft',
                'roblox', 'leagueoflegends', 'destiny2', 'diablo', 'eldenring', 'vrserver',
                'vrcompositor', 'parsec', 'moonlight', 'sunshine', 'xbox')

def generation_window_open(now):
    """An explicitly requested one-off test can expire outside the regular window."""
    if now.astimezone(PACIFIC).hour < 14:
        return True
    try:
        expiry = datetime.fromisoformat(os.environ.get('ALEX_MANUAL_GENERATION_UNTIL', ''))
        return expiry.tzinfo is not None and 0 < (expiry-now).total_seconds() <= 3600
    except ValueError:
        return False

def evaluate(sample, now=None, monotonic_now=None, previous=None, starting=False):
    """A snapshot must pass every gate. Hold reason precedes any generation."""
    now = now or datetime.now(timezone.utc)
    monotonic_now = time.monotonic() if monotonic_now is None else monotonic_now
    if now.tzinfo is None:
        return {'ready': False, 'reason': 'Unknown clock timezone.'}
    local = now.astimezone(PACIFIC)
    if not generation_window_open(now):
        return {'ready': False, 'reason': 'Outside 00:00-14:00 America/Los_Angeles.'}
    if starting and local.hour == 13 and local.minute == 59 and local.second >= 58:
        return {'ready': False, 'reason': 'Too close to 14:00 to start another stage safely.'}
    if not isinstance(sample, dict):
        return {'ready': False, 'reason': 'Activity state unavailable.'}
    if sample.get('error'):
        return {'ready': False, 'reason': sample['error']}
    stamp = sample.get('monotonicAt')
    if not isinstance(stamp, (int, float)) or not 0 <= monotonic_now - stamp <= MAX_SAMPLE_AGE_SECONDS:
        return {'ready': False, 'reason': 'Activity sample is stale or invalid.'}
    if sample.get('probeDurationSeconds', 99) > 1:
        return {'ready': False, 'reason': 'Activity probe exceeded its safe duration.'}
    session = sample.get('sessionId')
    if not isinstance(session, int) or session <= 0 or session != sample.get('consoleSessionId') or sample.get('activeSessionIds') != [session]:
        return {'ready': False, 'reason': 'Cannot verify the only active interactive session.'}
    if sample.get('processInventoryComplete') is not True:
        return {'ready': False, 'reason': 'No-gaming process inventory is incomplete.'}
    if sample.get('games'):
        return {'ready': False, 'reason': 'A game, streaming-game client, or game runtime is running.'}
    if previous is not None:
        gap = stamp - previous.get('monotonicAt', stamp - 99)
        if gap < 0 or gap > MAX_SAMPLE_AGE_SECONDS:
            return {'ready': False, 'reason': 'Monitoring gap or system resume; recheck game state.'}
        elapsed_wall = (now - previous['wallAt']).total_seconds()
        if abs(elapsed_wall - gap) > 2:
            return {'ready': False, 'reason': 'Clock changed while generation was supervised.'}
    return {'ready': True, 'reason': 'Authorized generation window and complete process inventory passed; no recognized game running.'}

class LastInput(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.UINT), ('dwTime', wintypes.DWORD)]

class ProcessEntry(ctypes.Structure):
    _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
                ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]

class SessionInfo(ctypes.Structure):
    _fields_ = [('SessionId', wintypes.DWORD), ('pWinStationName', wintypes.LPWSTR), ('State', ctypes.c_int)]

class RawDevice(ctypes.Structure):
    _fields_ = [('hDevice', wintypes.HANDLE), ('dwType', wintypes.DWORD)]

class HidInfo(ctypes.Structure):
    _fields_ = [('vendor', wintypes.DWORD), ('product', wintypes.DWORD),
                ('version', wintypes.DWORD), ('usagePage', wintypes.USHORT), ('usage', wintypes.USHORT)]

class DeviceUnion(ctypes.Union):
    _fields_ = [('hid', HidInfo), ('storage', wintypes.DWORD * 6)]

class DeviceInfo(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('dwType', wintypes.DWORD), ('data', DeviceUnion)]

def checked(value, operation):
    if not value:
        error = ctypes.get_last_error()
        raise OSError(error, f'{operation} failed (Windows error {error}); do not bypass or infer idle.')
    return value

class WindowsProbe:
    """Game process checks, with a latched failure until restart.

    allowed_background is an explicit list of already reviewed executable paths.
    It defaults empty. Games are denied even if accidentally allowlisted.
    """
    def __init__(self, allowed_background=()):
        self.denied = None
        self.allowed = {str(Path(p).resolve()).casefold() for p in allowed_background}
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.u = ctypes.WinDLL('user32', use_last_error=True)
        self.wts = ctypes.WinDLL('wtsapi32', use_last_error=True)
        self.shell = ctypes.WinDLL('shell32', use_last_error=True)
        signatures = {
            'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
            'GetTickCount': ([], wintypes.DWORD),
            'WTSGetActiveConsoleSessionId': ([], wintypes.DWORD),
            'ProcessIdToSessionId': ([wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            'OpenProcess': ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            'QueryFullProcessImageNameW': ([wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            'CreateToolhelp32Snapshot': ([wintypes.DWORD, wintypes.DWORD], wintypes.HANDLE),
            'Process32FirstW': ([wintypes.HANDLE, ctypes.POINTER(ProcessEntry)], wintypes.BOOL),
            'Process32NextW': ([wintypes.HANDLE, ctypes.POINTER(ProcessEntry)], wintypes.BOOL),
        }
        for name, (args, result) in signatures.items():
            f = getattr(self.k, name); f.argtypes = args; f.restype = result
        self.u.GetLastInputInfo.argtypes = [ctypes.POINTER(LastInput)]
        self.u.GetForegroundWindow.restype = wintypes.HWND
        self.u.GetShellWindow.restype = wintypes.HWND
        self.u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.u.GetRawInputDeviceList.argtypes = [ctypes.POINTER(RawDevice), ctypes.POINTER(wintypes.UINT), wintypes.UINT]
        self.u.GetRawInputDeviceList.restype = wintypes.UINT
        self.u.GetRawInputDeviceInfoW.argtypes = [wintypes.HANDLE, wintypes.UINT, ctypes.c_void_p, ctypes.POINTER(wintypes.UINT)]
        self.u.GetRawInputDeviceInfoW.restype = wintypes.UINT
        self.wts.WTSEnumerateSessionsW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(SessionInfo)), ctypes.POINTER(wintypes.DWORD)]
        self.wts.WTSFreeMemory.argtypes = [ctypes.c_void_p]

    def process_path(self, pid):
        handle = checked(self.k.OpenProcess(0x1000, False, pid), f'OpenProcess({pid}, QUERY_LIMITED_INFORMATION)')
        try:
            value = ctypes.create_unicode_buffer(32768); size = wintypes.DWORD(len(value))
            checked(self.k.QueryFullProcessImageNameW(handle, 0, value, ctypes.byref(size)), f'QueryFullProcessImageNameW({pid})')
            return value.value
        finally:
            self.k.CloseHandle(handle)

    def process_rows(self):
        handle = self.k.CreateToolhelp32Snapshot(2, 0)
        if handle == ctypes.c_void_p(-1).value:
            checked(False, 'CreateToolhelp32Snapshot')
        try:
            item = ProcessEntry(); item.dwSize = ctypes.sizeof(item)
            checked(self.k.Process32FirstW(handle, ctypes.byref(item)), 'Process32FirstW')
            rows = []
            while True:
                rows.append((item.th32ProcessID, item.th32ParentProcessID, item.szExeFile))
                if not self.k.Process32NextW(handle, ctypes.byref(item)):
                    if ctypes.get_last_error() != 18:
                        checked(False, 'Process32NextW')
                    return rows
        finally:
            self.k.CloseHandle(handle)

    def controllers(self):
        count = wintypes.UINT()
        if self.u.GetRawInputDeviceList(None, ctypes.byref(count), ctypes.sizeof(RawDevice)) == 0xffffffff:
            checked(False, 'GetRawInputDeviceList')
        devices = (RawDevice * count.value)()
        count_actual = self.u.GetRawInputDeviceList(devices, ctypes.byref(count), ctypes.sizeof(RawDevice))
        if count_actual == 0xffffffff:
            checked(False, 'GetRawInputDeviceList')
        for device in devices[:count_actual]:
            if device.dwType == 2:
                info = DeviceInfo(); info.cbSize = ctypes.sizeof(info); size = wintypes.UINT(ctypes.sizeof(info))
                if self.u.GetRawInputDeviceInfoW(device.hDevice, 0x2000000b, ctypes.byref(info), ctypes.byref(size)) == 0xffffffff:
                    checked(False, 'GetRawInputDeviceInfoW')
                if info.data.hid.usagePage == 1 and info.data.hid.usage in (4, 5, 8):
                    return 'connected'
        # XInput devices are not all exposed as ordinary DirectInput devices.
        x = ctypes.WinDLL('xinput1_4', use_last_error=True)
        x.XInputGetState.argtypes = [wintypes.DWORD, ctypes.c_void_p]
        x.XInputGetState.restype = wintypes.DWORD
        for index in range(4):
            buffer = ctypes.create_string_buffer(32)
            result = x.XInputGetState(index, buffer)
            if result == 0: return 'connected'
            if result != 1167: raise OSError(result, 'XInputGetState failed; controller state unknown.')
        return 'none-connected'

    def capture(self, owned_pids=()):
        if self.denied:
            return {'error': self.denied}
        began = time.monotonic()
        try:
            if not generation_authorized(): raise ValueError('Generation paused or outside Pacific window.')
            session = wintypes.DWORD()
            checked(self.k.ProcessIdToSessionId(os.getpid(), ctypes.byref(session)), 'ProcessIdToSessionId(current)')
            sessions = ctypes.POINTER(SessionInfo)(); count = wintypes.DWORD()
            checked(self.wts.WTSEnumerateSessionsW(None, 0, 1, ctypes.byref(sessions), ctypes.byref(count)), 'WTSEnumerateSessionsW')
            try: active = sorted(sessions[i].SessionId for i in range(count.value) if sessions[i].State == 0)
            finally: self.wts.WTSFreeMemory(sessions)
            rows = self.process_rows()
            games = [pid for pid, _, name in rows if pid not in owned_pids
                     and name.casefold() not in ('epicgameslauncher.exe','epicwebhelper.exe','steam.exe','steamwebhelper.exe')
                     and any(marker in name.casefold() for marker in GAME_MARKERS)]
            ended = time.monotonic()
            return dict(monotonicAt=ended, probeDurationSeconds=ended-began,
                        sessionId=session.value, consoleSessionId=self.k.WTSGetActiveConsoleSessionId(), activeSessionIds=active,
                        processInventoryComplete=True, games=games)
        except (OSError, KeyError, ValueError) as error:
            self.denied = str(error)
            return {'error': self.denied}


def generation_authorized(now=None, require_owned=False, policy=None):
    """Pause policy plus ordinary Pacific window or an expiring manual test."""
    now = now or datetime.now(timezone.utc)
    try:
        if policy is None:
            policy=json.loads((Path(__file__).resolve().parents[2]/'campaigns/alex-creator/activity-policy.json').read_text(encoding='utf-8-sig'))
        return (now.tzinfo is not None and policy.get('version') == 1
                and policy.get('generationEnabled') is True
                and generation_window_open(now)
                and (not require_owned or os.environ.get('ALEX_OWNED_GENERATION') == 'supervised'))
    except (OSError, ValueError):
        return False
