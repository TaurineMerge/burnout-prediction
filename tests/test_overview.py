import sqlite3
import unittest
from contextlib import closing

from overview import build_overview


class OverviewTests(unittest.TestCase):
    def test_snapshot_uses_active_staff_and_latest_fresh_survey(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.row_factory = sqlite3.Row
            db.execute("""CREATE TABLE teacher_staffing (
                user_id, school_id, workload_fte, started_on, ended_on
            )""")
            db.executemany("INSERT INTO teacher_staffing VALUES (?, ?, ?, ?, ?)", [
                (1, 10, 1.00, "2026-03-01", None),
                (2, 10, 1.25, "2026-03-01", None),
                (3, 20, 1.50, "2026-03-01", None),
                (4, 20, 1.00, "2026-03-01", "2026-04-20"),
                (5, 20, 1.00, "2026-04-21", None),
            ])
            surveys = {
                1: [
                    {"survey_dt": "2026-04-21", "burnout_level": 3},
                    {"survey_dt": "2026-04-20", "burnout_level": 0},
                    {"survey_dt": "2026-04-05", "burnout_level": 3},
                ],
                2: [{"survey_dt": "2026-03-23", "burnout_level": 3}],
                3: [{"survey_dt": "2026-03-24", "burnout_level": 2}],
            }
            levels = {0: "Нет признаков", 1: "Первый", 2: "Второй", 3: "Третий"}
            report = build_overview(db, "2026-04-20", {10: "А", 20: "Б"}, surveys, levels, None)
        self.assertEqual(report["current"], {"staff": 3, "surveyed": 2, "elevated": 1, "schools": 2})
        self.assertEqual([level["count"] for level in report["levels"]], [1, 0, 1, 0])
        self.assertEqual(report["workload"]["average"], 1.25)
        self.assertEqual(report["history"][0], {"date": "2026-03-31", "staff": 4, "surveyed": 2, "elevated": 2})

    def test_legacy_database_has_no_staffing_overview(self):
        with closing(sqlite3.connect(":memory:")) as db:
            self.assertIsNone(build_overview(db, "2026-04-20", {}, {}, {}, None))
