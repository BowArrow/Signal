"""Exercise real Windows status readers that deny atomic replacement."""
import ctypes
from ctypes import wintypes
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[3] / 'src/core/video/limited_runtime.py'
spec = importlib.util.spec_from_file_location('limited_runtime', source)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

@unittest.skipUnless(sys.platform == 'win32', 'Windows file sharing regression')
class StatusSharingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'status.json'
        runtime.report(self.path, {'state':'before'})
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
        self.kernel.CreateFileW.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL

    def tearDown(self):
        self.temp.cleanup()

    def reader(self):
        handle = self.kernel.CreateFileW(str(self.path),0x80000000,3,None,3,128,None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        return handle

    def test_short_reader_collision_retries_and_keeps_valid_json(self):
        handle = self.reader()
        timer = threading.Timer(.045, lambda:self.kernel.CloseHandle(handle))
        timer.start()
        try:
            self.assertTrue(runtime.report(self.path, {'state':'running'}))
        finally:
            timer.join()
        self.assertEqual(json.loads(self.path.read_text())['state'],'running')

    def test_persistent_reader_defers_only_periodic_report(self):
        handle = self.reader()
        try:
            self.assertFalse(runtime.report(self.path, {'state':'running'}, defer_busy=True))
            self.assertEqual(json.loads(self.path.read_text())['state'],'before')
            with self.assertRaises(OSError):
                runtime.report(self.path, {'state':'starting'})
        finally:
            self.kernel.CloseHandle(handle)
        self.assertTrue(runtime.report(self.path, {'state':'running'}))

    def test_other_io_errors_still_fail(self):
        with patch.object(runtime.os,'replace',side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError,'disk failure'):
                runtime.report(self.path, {'state':'running'}, defer_busy=True)

if __name__ == '__main__':
    unittest.main()
