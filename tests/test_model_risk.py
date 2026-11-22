import json
import sqlite3
import unittest
from contextlib import closing
from importlib.util import find_spec
from pathlib import Path

from dashboard import create_app

DATABASE = Path(__file__).resolve().parents[1] / "data" / "teacher_burnout.db"


@unittest.skipUnless(find_spec("sklearn"), "install requirements-model.txt")
class ModelRiskTests(unittest.TestCase):
    def test_dashboard_serves_aggregate_for_last_complete_week(self):
        app = create_app(DATABASE, fact_through="2026-04-20", model_risk=True)
        payload = app({"REQUEST_METHOD": "GET", "PATH_INFO": "/api/summary"}, lambda *_: None)
        result = json.loads(b"".join(payload))["model_risk"]
        self.assertEqual(result["status"], "available")
        self.assertEqual((result["week_start"], result["week_end"]), ("2026-04-13", "2026-04-19"))
        self.assertGreater(result["scored_count"], 0)
        self.assertLessEqual(result["scored_count"], result["observed_count"])
        self.assertLessEqual(result["at_risk_count"], result["scored_count"])
        self.assertNotIn("user_id", result)

    def test_cutoff_excludes_current_survey_and_future_week_data(self):
        from unittest.mock import patch

        from model_risk import add_features, summarize_risk

        with closing(sqlite3.connect(":memory:")) as db, closing(sqlite3.connect(DATABASE)) as original:
            original.backup(db)
            event_id = db.execute(
                "SELECT schedule_id FROM user_act_schedule WHERE dttm_from >= '2026-04-13' "
                "AND dttm_from < '2026-04-20' ORDER BY dttm_from LIMIT 1"
            ).fetchone()[0]
            db.execute(
                "UPDATE user_act_schedule SET dttm_from = '2026-04-19 23:30:00', "
                "dttm_to = '2026-04-20 00:30:00' WHERE schedule_id = ?", (event_id,),
            )
            with patch("model_risk.add_features", wraps=add_features) as features:
                before = summarize_risk(db, "2026-04-20")
                before_panel = features.call_args.args[0].sort_values(["user_id", "week_dt"])
                db.execute("DELETE FROM survey_act WHERE calendar_dt >= '2026-04-13'")
                db.execute("DELETE FROM user_activity_log WHERE activity_dttm >= '2026-04-20'")
                db.execute("DELETE FROM user_act_schedule WHERE dttm_from >= '2026-04-20'")
                db.execute(
                    "UPDATE user_act_schedule SET dttm_to = '2026-04-21 01:00:00' WHERE schedule_id = ?",
                    (event_id,),
                )
                after = summarize_risk(db, "2026-04-20")
                after_panel = features.call_args.args[0].sort_values(["user_id", "week_dt"])
            self.assertTrue(before_panel.reset_index(drop=True).equals(after_panel.reset_index(drop=True)))
            self.assertEqual(before, after)

    def test_no_completed_week_has_no_risk_count(self):
        from model_risk import summarize_risk

        with closing(sqlite3.connect(DATABASE)) as db:
            risk = summarize_risk(db, "2025-09-02")
        self.assertEqual(risk["status"], "insufficient_activity")
        self.assertIsNone(risk["at_risk_count"])
