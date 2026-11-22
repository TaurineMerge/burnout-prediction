'use strict';

const params = new URLSearchParams(location.search);
const userId = params.get('user_id');
params.delete('user_id');
const back = params.size ? `/people?${params}` : '/people';
const period = new URLSearchParams();
for (const key of ['date', 'window']) {
  if (params.has(key)) period.set(key, params.get(key));
}
const overview = period.size ? `/?${period}` : '/';
$('back-to-people').href = back;
$('people-nav').href = back;
$('overview-link').href = overview;
$('overview-nav').href = overview;
$('dossier-info').addEventListener('click', () => $('dossier-info-dialog').showModal());

const displayNumber = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
const staffingFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
const shortDate = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'});
const dayMs = 86400000;
const weekMs = 7 * dayMs;
const isoDate = time => new Date(time).toISOString().slice(0, 10);

const showSurveys = createPager('survey-history-pager', 6, rows => {
  $('survey-history-rows').replaceChildren(...rows.map(survey => {
    const row = element('li');
    const stage = element('span', survey.burnout_type, 'survey-history-stage');
    stage.dataset.level = survey.burnout_level;
    const time = element('time', fmtDate(survey.survey_dt), 'muted');
    time.dateTime = survey.survey_dt;
    row.append(stage, time);
    return row;
  }));
});

function renderWorkload(asOf, history) {
  const date = new Date(asOf);
  const latestMonday = date.getTime() - (date.getUTCDay() + 6) * dayMs;
  const firstMonday = latestMonday - 7 * weekMs;
  const lastWeekEnd = isoDate(latestMonday + weekMs - dayMs);
  const byWeek = new Map(history.map(week => [week.week_dt, week]));
  const weeks = Array.from({length: 8}, (_, index) => {
    const monday = firstMonday + index * weekMs;
    const start = isoDate(monday);
    return {start, end: isoDate(monday + 6 * dayMs), values: byWeek.get(start)};
  });
  txt('workload-period', fmtPeriod(weeks[0].start, lastWeekEnd));
  const hasData = weeks.some(week => week.values);
  $('workload-empty').hidden = hasData;
  $('workload-figure').hidden = !hasData;
  if (!hasData) return;

  const peak = Math.max(...weeks.map(({values}) => Math.max(values?.event_hours ?? 0, values?.activity_hours ?? 0)));
  const top = Math.max(10, Math.ceil(peak / 10) * 10);
  $('workload-scale').replaceChildren(...[top, top / 2, 0].map(hours => element('span', `${hours} ч`)));

  let selected = weeks.findLastIndex(week => week.values);
  const readout = $('workload-readout');

  function showWeek(index) {
    const {start, end, values} = weeks[index];
    const label = fmtPeriod(start, end);
    const hours = values
      ? `По расписанию ${displayNumber.format(values.event_hours)} ч · Активность ${displayNumber.format(values.activity_hours)} ч`
      : 'Нет данных за неделю';
    readout.replaceChildren(element('strong', label), element('span', hours));
  }

  const buttons = weeks.map(({start, end, values}, index) => {
    const button = element('button', undefined, 'workload-week');
    button.type = 'button';
    const glyph = element('span', undefined, 'workload-bars');
    glyph.setAttribute('aria-hidden', 'true');
    if (values) {
      for (const [key, kind] of [['event_hours', 'scheduled'], ['activity_hours', 'logged']]) {
        const fill = element('span', undefined, kind);
        fill.style.height = `${values[key] / top * 100}%`;
        glyph.append(fill);
      }
    } else {
      glyph.append(element('span', '—', 'missing-week'));
    }
    button.append(glyph, element('span', shortDate.format(new Date(start)), 'workload-tick'));
    button.setAttribute('aria-label', values
      ? `${fmtPeriod(start, end)}. По расписанию ${displayNumber.format(values.event_hours)} ч. Активность ${displayNumber.format(values.activity_hours)} ч.`
      : `${fmtPeriod(start, end)}. Нет данных за неделю.`);
    button.addEventListener('pointerenter', () => showWeek(index));
    button.addEventListener('pointerleave', () => showWeek(selected));
    button.addEventListener('focus', () => showWeek(index));
    button.addEventListener('blur', () => showWeek(selected));
    button.addEventListener('click', () => {
      selected = index;
      buttons.forEach((item, position) => item.setAttribute('aria-pressed', position === selected));
      showWeek(selected);
    });
    button.setAttribute('aria-pressed', index === selected);
    return button;
  });
  $('workload-weeks').replaceChildren(...buttons);
  showWeek(selected);
}

async function loadDossier() {
  if (!userId) {
    txt('dossier-status', 'Выберите педагога в списке.');
    return;
  }
  try {
    const query = new URLSearchParams(period);
    query.set('user_id', userId);
    const response = await fetch(`/api/dossier?${query}`);
    if (response.status === 404) throw new Error('Педагог не найден. Вернитесь к списку.');
    if (!response.ok) throw new Error('Не удалось загрузить досье. Обновите страницу.');
    const {person, model_risk: model, date, survey_window_days: windowDays, history, surveys} = await response.json();
    const name = person.name || `Педагог ${person.id}`;
    document.title = `${name} · Мониторинг педагогов`;
    txt('teacher-name', name);
    txt('teacher-school', person.school ?? 'Школа не указана');
    $('teacher-fte').hidden = person.fte === null || !person.in_staff;
    $('teacher-staffing-status').hidden = person.in_staff;
    if (person.fte !== null) txt('teacher-fte', `Ставка ${staffingFormat.format(person.fte)}`);
    txt('teacher-as-of', `На ${fmtDate(date)}`);
    const scored = person.risk_score !== null;
    const flagged = scored && person.risk_score >= model.threshold;
    txt('teacher-risk', scored ? (flagged ? 'В группе риска' : 'Ниже порога риска') : 'Нет оценки');
    $('teacher-risk').classList.toggle('flagged-label', flagged);
    $('teacher-points').hidden = !scored;
    txt('teacher-points', scored ? `${displayNumber.format(person.risk_score * 100)} из 100` : '');
    txt('dossier-threshold', model?.status === 'available' ? ` в ${displayNumber.format(model.threshold * 100)} из 100` : '');
    txt('teacher-week', model?.status === 'available' ? fmtPeriod(model.week_start, model.week_end) : 'На выбранную дату');

    txt('teacher-window', `${windowDays} дней`);
    txt('teacher-stage', person.survey_stage ?? 'Нет ответа');
    if (person.survey_stage) $('teacher-stage').dataset.level = person.latest_survey.burnout_level;
    txt('teacher-survey-note', person.latest_survey
      ? `${person.survey_in_period ? 'Ответ' : 'Предыдущий ответ'} от ${fmtDate(person.latest_survey.survey_dt)}`
      : '');
    $('teacher-survey-note').hidden = !person.latest_survey;

    renderWorkload(date, history);
    showSurveys(surveys);
    $('survey-history-empty').hidden = Boolean(surveys.length);
    $('dossier-status').hidden = true;
    $('dossier-content').hidden = false;
  } catch (error) {
    txt('dossier-status', error.message);
  }
}

loadDossier();
