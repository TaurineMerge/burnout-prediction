"""Aggregate dated survey and staffing data for the overview preview."""

from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, timedelta

SURVEY_WINDOW_DAYS = 28


def build_overview(db, report_date, school_names, surveys_by_teacher, level_names, model_risk):
    if not db.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_staffing'"
    ).fetchone():
        return None

    staff = [dict(row) for row in db.execute(
        "SELECT * FROM teacher_staffing WHERE started_on <= ? ORDER BY user_id", (report_date,)
    )]

    def snapshot(as_of):
        lower = (date.fromisoformat(as_of) - timedelta(days=SURVEY_WINDOW_DAYS - 1)).isoformat()
        active = [row for row in staff if row["started_on"] <= as_of and (
            row["ended_on"] is None or row["ended_on"] > as_of
        )]
        levels = {}
        for row in active:
            for survey in surveys_by_teacher.get(row["user_id"], ()):
                survey_date = survey["survey_dt"]
                if survey_date > as_of:
                    continue
                if survey_date < max(lower, row["started_on"]):
                    break
                if level_names.get(survey["burnout_level"]) is not None:
                    levels[row["user_id"]] = survey["burnout_level"]
                    break
        return active, levels

    def counts(cohort, levels):
        observed = [levels[row["user_id"]] for row in cohort if row["user_id"] in levels]
        return {
            "staff": len(cohort),
            "surveyed": len(observed),
            "elevated": sum(level >= 2 for level in observed),
        }

    active, levels = snapshot(report_date)
    cohorts = defaultdict(list)
    for row in active:
        cohorts[row["school_id"]].append(row)
    schools = []
    for school_id, cohort in cohorts.items():
        stage_counts = Counter(levels[row["user_id"]] for row in cohort if row["user_id"] in levels)
        schools.append({
            "id": school_id,
            "name": school_names[school_id],
            **counts(cohort, levels),
            "levels": dict(stage_counts),
        })

    history = []
    if staff:
        cursor = date.fromisoformat(min(row["started_on"] for row in staff)).replace(day=1)
        today = date.fromisoformat(report_date)
        while cursor <= today:
            month_end = cursor.replace(day=monthrange(cursor.year, cursor.month)[1])
            as_of = min(month_end, today).isoformat()
            history.append({"date": as_of, **counts(*snapshot(as_of))})
            cursor = month_end + timedelta(days=1)

    distribution = Counter(levels.values())
    workload = Counter(row["workload_fte"] for row in active)
    return {
        "date": report_date,
        "survey_window_days": SURVEY_WINDOW_DAYS,
        "current": {**counts(active, levels), "schools": len(schools)},
        "levels": [
            {"name": name, "code": level, "count": distribution[level]}
            for level, name in sorted(level_names.items())
        ],
        "schools": schools,
        "history": history,
        "workload": {
            "average": sum(value * count for value, count in workload.items()) / len(active)
            if active else None,
            "count": len(active),
            "distribution": [
                {"fte": value, "count": count} for value, count in sorted(workload.items())
            ],
        },
        "model_risk": model_risk,
    }


def build_review(db, account_names, school_names, surveys, level_names, teacher_ids, report_date):
    staffing = {row["user_id"]: row for row in db.execute("SELECT * FROM teacher_staffing")}
    window_start = (date.fromisoformat(report_date) - timedelta(days=SURVEY_WINDOW_DAYS - 1)).isoformat()
    people = []
    for user_id in teacher_ids:
        row = staffing.get(user_id)
        school_id = row["school_id"] if row else None
        latest = next((s for s in surveys.get(user_id, ()) if window_start <= s["survey_dt"] <= report_date), None)
        people.append({
            "id": user_id,
            "name": account_names.get(user_id),
            "school_id": school_id,
            "school": school_names.get(school_id),
            "fte": row["workload_fte"] if row else None,
            "survey_stage": level_names.get(latest["burnout_level"]) if latest else None,
        })
    return sorted(people, key=lambda person: ((person["name"] or "").casefold(), person["id"]))
