"""Weekly Random Forest assessment for the synthetic dashboard."""

from datetime import date, timedelta

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

MODEL_VERSION = "rf-strict-v1"
RISK_THRESHOLD = 0.5
MIN_PRIOR_WEEKS = 6
RAW = [
    "event_hours", "activity_hours", "act_avg_participants_per_hour", "act_msg_cnt",
    "act_msg_char_cnt",
]
BEHAVIOR = [*RAW, "chars_per_msg"]
FEATURES = [
    *BEHAVIOR,
    *(f"{field}_{suffix}" for field in BEHAVIOR for suffix in ("r4", "r12", "rel", "d4", "lag1")),
    "prev_level", "past_level_mean", "past_level_max", "n_past_surveys", "has_prior",
    "week_of_year", "month", "prior_weeks",
]


def add_features(panel):
    frame = panel.sort_values(["user_id", "week_dt"]).copy()
    frame["chars_per_msg"] = frame["act_msg_char_cnt"] / frame["act_msg_cnt"].replace(0, float("nan"))
    by_teacher = frame.groupby("user_id", sort=False)
    for field in BEHAVIOR:
        series = by_teacher[field]
        frame[f"{field}_r4"] = series.transform(lambda s: s.rolling(4, min_periods=1).mean())
        frame[f"{field}_r12"] = series.transform(lambda s: s.rolling(12, min_periods=1).mean())
        prior_median = series.transform(lambda s: s.shift(1).expanding().median())
        frame[f"{field}_rel"] = (frame[f"{field}_r4"] / (prior_median.abs() + 1e-6)).clip(-50, 50)
        prior_mean = series.transform(lambda s: s.shift(1).rolling(4, min_periods=1).mean())
        frame[f"{field}_d4"] = frame[field] - prior_mean
        frame[f"{field}_lag1"] = series.shift(1)

    levels = by_teacher["burnout_level"]
    frame["prev_level"] = levels.transform(lambda s: s.ffill().shift(1))
    frame["past_level_mean"] = levels.transform(lambda s: s.shift(1).rolling(12, min_periods=1).mean())
    frame["past_level_max"] = levels.transform(lambda s: s.shift(1).expanding().max())
    frame["n_past_surveys"] = levels.transform(lambda s: s.notna().cumsum().shift(1, fill_value=0))
    frame["has_prior"] = frame["n_past_surveys"].gt(0).astype(int)
    frame["week_of_year"] = frame["week_dt"].dt.isocalendar().week.astype(int)
    frame["month"] = frame["week_dt"].dt.month
    frame["prior_weeks"] = by_teacher.cumcount()
    return frame


def summarize_risk(connection, report_date, *, risk_scores=None):
    """Fit on earlier weeks and assess the latest Monday–Sunday interval through report_date."""
    cutoff = date.fromisoformat(report_date)
    week_end = cutoff - timedelta(days=(cutoff.weekday() + 1) % 7)
    week_start = week_end - timedelta(days=6)
    after_week = week_end + timedelta(days=1)
    panel = pd.read_sql_query(
        """
        WITH calendar_intervals AS (
            SELECT user_id, date(dttm_from, '-6 days', 'weekday 1') AS week_dt,
                   dttm_from, dttm_to, act_participants_cnt
            FROM user_act_schedule WHERE dttm_from < :after_week
        ), calendar_hours AS (
            SELECT user_id, week_dt, act_participants_cnt,
                   (julianday(MIN(dttm_to, date(week_dt, '+7 days'))) - julianday(dttm_from)) * 24.0 AS hours
            FROM calendar_intervals
        ), weekly_calendar AS (
            SELECT user_id, week_dt, SUM(hours) AS hours,
                   SUM(hours * act_participants_cnt) AS participant_hours
            FROM calendar_hours GROUP BY user_id, week_dt
        ), observed AS (
            SELECT user_id, MAX(week_dt) AS last_week
            FROM (
                SELECT user_id, week_dt FROM weekly_calendar
                UNION ALL
                SELECT user_id, date(activity_dttm, '-6 days', 'weekday 1') AS week_dt
                FROM user_activity_log WHERE activity_dttm < :after_week
            )
            GROUP BY user_id
        )
        SELECT p.user_id, p.week_dt, ROUND(COALESCE(c.hours, 0), 2) AS event_hours, p.activity_hours,
               ROUND(c.participant_hours / NULLIF(c.hours, 0), 2) AS act_avg_participants_per_hour,
               p.act_msg_cnt, p.act_msg_char_cnt,
               CASE WHEN p.week_dt < :score_week THEN p.burnout_level END AS burnout_level
        FROM teacher_burnout_panel AS p
        JOIN observed AS o ON p.user_id = o.user_id AND p.week_dt <= o.last_week
        LEFT JOIN weekly_calendar AS c ON p.user_id = c.user_id AND p.week_dt = c.week_dt
        WHERE p.week_dt <= :score_week
        """,
        connection,
        params={"after_week": after_week.isoformat(), "score_week": week_start.isoformat()},
        parse_dates=["week_dt"],
    )
    panel["burnout_level"] = pd.to_numeric(panel["burnout_level"], errors="coerce")
    frame = add_features(panel)
    week = pd.Timestamp(week_start)
    current = frame[frame["week_dt"].eq(week)]
    eligible = current[current["prior_weeks"].ge(MIN_PRIOR_WEEKS)]
    training = frame[frame["burnout_level"].notna() & frame["prior_weeks"].ge(MIN_PRIOR_WEEKS)]
    target = training["burnout_level"].ge(2)
    summary = {
        "model_version": MODEL_VERSION,
        "threshold": RISK_THRESHOLD,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "observed_count": len(current),
        "scored_count": 0,
        "at_risk_count": None,
    }
    if eligible.empty:
        return {**summary, "status": "insufficient_activity"}
    if target.nunique() < 2:
        return {**summary, "status": "insufficient_labels"}

    model = make_pipeline(
        SimpleImputer(strategy="median", keep_empty_features=True),
        RandomForestClassifier(
            n_estimators=221, max_depth=12, max_features=0.5, min_samples_leaf=25,
            min_samples_split=2, class_weight="balanced_subsample", random_state=42,
        ),
    )
    model.fit(training[FEATURES].astype(float), target)
    probabilities = model.predict_proba(eligible[FEATURES].astype(float))[:, 1]
    flagged = probabilities >= RISK_THRESHOLD
    if risk_scores is not None:
        ids = map(int, eligible.loc[flagged, "user_id"])
        risk_scores.update(zip(ids, map(float, probabilities[flagged]), strict=True))
    return {
        **summary,
        "status": "available",
        "scored_count": len(eligible),
        "at_risk_count": int(flagged.sum()),
    }
