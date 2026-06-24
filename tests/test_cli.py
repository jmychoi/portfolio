import unittest
from contextlib import redirect_stderr
from datetime import datetime
from io import StringIO

from aggregate import build_parser


class AggregateCliTests(unittest.TestCase):
    def test_date_defaults_to_current_local_date(self):
        before = datetime.now().astimezone().date().isoformat()
        arguments = build_parser().parse_args(["sample/sources/2026-01-02"])
        after = datetime.now().astimezone().date().isoformat()
        self.assertIn(arguments.date, {before, after})

    def test_date_override_accepts_iso_date(self):
        arguments = build_parser().parse_args(
            ["sample/sources/2026-01-02", "--date", "2025-12-31"]
        )
        self.assertEqual(arguments.date, "2025-12-31")

    def test_invalid_date_override_is_rejected(self):
        with redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit):
                build_parser().parse_args(
                    ["sample/sources/2026-01-02", "--date", "2025-02-29"]
                )


if __name__ == "__main__":
    unittest.main()
