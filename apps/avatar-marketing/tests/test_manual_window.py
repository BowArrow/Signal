from datetime import datetime, timezone, timedelta
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from alex_activity_guard import generation_authorized, generation_window_open

class ManualWindowTests(unittest.TestCase):
    def test_bounded_expiring_manual_window(self):
        now=datetime(2026,11,9,23,tzinfo=timezone.utc)
        for minutes,expected in [(30,True),(-1,False),(61,False)]:
            with patch.dict(os.environ,{'ALEX_MANUAL_GENERATION_UNTIL':(now+timedelta(minutes=minutes)).isoformat()}):
                self.assertEqual(generation_window_open(now),expected)
                self.assertFalse(generation_authorized(now,policy={'version':1,'generationEnabled':False}))
    def test_no_implicit_override(self):
        with patch.dict(os.environ,{'ALEX_MANUAL_GENERATION_UNTIL':''}):
            self.assertFalse(generation_window_open(datetime(2026,11,9,23,tzinfo=timezone.utc)))
            self.assertTrue(generation_window_open(datetime(2026,11,9,18,tzinfo=timezone.utc)))

if __name__=='__main__':unittest.main()
