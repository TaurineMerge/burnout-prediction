import sqlite3
import unittest
from contextlib import closing

from overview import build_overview, build_review


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
            short_report = build_overview(
                db, "2026-04-20", {10: "А", 20: "Б"}, surveys, levels, None, window_days=7,
            )
        self.assertEqual(report["current"], {"staff": 3, "surveyed": 2, "elevated": 1, "schools": 2})
        self.assertEqual([level["count"] for level in report["levels"]], [1, 0, 1, 0])
        self.assertEqual(report["workload"]["average"], 1.25)
        self.assertEqual(report["history"][0], {"date": "2026-03-31", "staff": 4, "surveyed": 2, "elevated": 2})
        self.assertEqual(report["schools"][0]["levels"], {0: 1})
        self.assertEqual(report["schools"][1]["levels"], {2: 1})
        self.assertEqual(short_report["survey_from"], "2026-04-14")
        self.assertEqual(short_report["current"]["surveyed"], 1)
        self.assertEqual(short_report["previous"]["surveyed"], 0)

    def test_review_uses_flags_and_only_fresh_survey_context(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE teacher_staffing (user_id, school_id, workload_fte)")
            db.execute("INSERT INTO teacher_staffing VALUES (1, 10, 1.5)")
            surveys = {1: [
                {"survey_dt": "2026-04-21", "burnout_level": 3},
                {"survey_dt": "2026-04-13", "burnout_level": 1},
            ], 2: [{"survey_dt": "2026-03-20", "burnout_level": 3}]}
            people = build_review(
                db, {1: "А", 2: "Б", 3: "В"}, {10: "Школа"}, surveys,
                {1: "Напряжённость", 3: "Бессилие"}, [1, 2], "2026-04-20",
                risk_scores={1: 0.65, 2: 0.55},
            )
        self.assertEqual([person["id"] for person in people], [1, 2])
        self.assertEqual((people[0]["survey_stage"], people[0]["fte"]), ("Напряжённость", 1.5))
        self.assertIsNone(people[1]["survey_stage"])
        self.assertEqual(people[0]["risk_score"], 0.65)

    def test_school_forecast_uses_only_prior_complete_windows(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE teacher_staffing (user_id, school_id, started_on, ended_on, workload_fte)")
            db.executemany("INSERT INTO teacher_staffing VALUES (?, ?, '2026-01-01', NULL, 1)", [
                (1, 10), (2, 10), (3, 10), (4, 20),
            ])
            answers = {
                1: [("2026-04-21", 0), ("2026-04-19", 2), ("2026-04-05", 3), ("2026-03-23", 3), ("2026-02-15", 1)],
                2: [("2026-04-01", 0), ("2026-03-02", 1), ("2026-02-04", 0)],
                3: [("2026-04-12", 1), ("2026-02-08", 2)],
                4: [("2026-04-13", 3)],
            }
            surveys = {uid: [{"survey_dt": day, "burnout_level": level} for day, level in rows]
                       for uid, rows in answers.items()}
            report = build_overview(
                db, "2026-04-20", {10: "А", 20: "Б"}, surveys,
                {0: "Нет признаков", 1: "Первый", 2: "Второй", 3: "Третий"}, None, window_days=7,
            )
        self.assertEqual(report["forecast"], {"start": "2026-04-21", "end": "2026-05-18"})
        self.assertEqual(report["schools"][0]["forecast"], {
            "windows": 3, "surveyed": 8, "levels": {0: 2, 1: 3, 2: 2, 3: 1}, "available": True,
        })
        self.assertEqual(report["schools"][1]["forecast"], {
            "windows": 1, "surveyed": 1, "levels": {3: 1}, "available": False,
        })

    def test_legacy_database_has_no_staffing_overview(self):
        with closing(sqlite3.connect(":memory:")) as db:
            self.assertIsNone(build_overview(db, "2026-04-20", {}, {}, {}, None))
