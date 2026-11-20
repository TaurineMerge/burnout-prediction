'use strict';

const metrics = {
  elevated: row => share(row.elevated, row.surveyed),
  coverage: row => share(row.surveyed, row.staff),
};

function svgElement(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

const scopeOptions = $('stage-period');
const stageNames = {'0': 'Нет признаков', '1': 'Напряжённость', '2': 'Истощение', '3': 'Бессилие'};
const activeStages = new Set(['2', '3']);
let currentReport;
let stopChart = () => {};
let fetchRequest;

const help = {
  model: ['Риск выгорания по модели', 'Оценка относится к последней полной неделе с понедельника по воскресенье на дату обзора. Доля считается среди оценённых педагогов, изменение — к предыдущей неделе.'],
  survey: ['Результаты опросов', 'Окно опросов заканчивается датой обзора включительно. Учитывается последний ответ каждого педагога за это окно. Доля считается среди ответивших, изменение — к предыдущему окну той же длины.'],
  stages: ['Доли по стадиям', 'За учебный год доля считается от всех педагогов в годовом отчёте. За окно опросов доля считается среди ответивших за этот период.'],
  schools: ['Сравнение школ', 'Нажмите название стадии, чтобы оставить только её. Плюс добавляет стадию, крестик снимает. Цвет каждого сегмента соответствует стадии, его длина — её доле среди ответивших. Охват считается от штата школы.'],
  trend: ['Как сравнивать линии', 'Сплошная линия показывает долю истощения или бессилия среди ответивших. Пунктир показывает долю ответивших среди педагогов. Сравнение помогает заметить изменение охвата, но по агрегатам нельзя узнать, кто перестал отвечать.'],
};
for (const button of document.querySelectorAll('[data-info]')) {
  button.addEventListener('click', () => {
    const [title, text] = help[button.dataset.info];
    txt('info-title', title);
    txt('info-body', text);
    $('info-dialog').showModal();
  });
}

const modelShare = risk => risk?.status === 'available' ? share(risk.at_risk_count, risk.scored_count) : null;
const changeNumber = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});

function writeSignal(id, count, base, value, prior) {
  txt(`${id}-value`, value === null ? '—' : integer.format(count));
  txt(`${id}-base`, value === null ? '' : `из ${integer.format(base)}`);
  txt(`${id}-share`, value === null ? '' : fmtShare(value));
  const change = $(`${id}-change`);
  change.textContent = '';
  if (value === null || prior === null) return;
  const difference = Math.round((value - prior) * 1000) / 10;
  change.textContent = difference ? `${difference > 0 ? '↑' : '↓'} ${changeNumber.format(Math.abs(difference))} п. п.` : 'Без изменений';
  change.title = id === 'model' ? 'К предыдущей неделе' : 'К предыдущему периоду той же длины';
}

function renderSignals(report) {
  const {current, previous, model_risk: model, previous_model_risk: prior} = report;
  writeSignal('model', model?.at_risk_count, model?.scored_count, modelShare(model), modelShare(prior));
  writeSignal('elevated', current.elevated, current.surveyed, metrics.elevated(current), previous ? metrics.elevated(previous) : null);
  txt('model-note', model?.status === 'available' ? `Полная неделя · ${fmtPeriod(model.week_start, model.week_end)}`
    : report.model_enabled ? 'Нет оценки на эту дату' : 'Расчёт отключён');
  txt('survey-period', `${report.survey_window_days} дней · ${fmtPeriod(report.survey_from, report.date)}`);
  const url = `/people?${new URLSearchParams({date: report.date, window: report.survey_window_days})}`;
  $('review-open').href = url;
  $('review-open').hidden = !report.review_available;
  $('people-nav').href = url;
  $('people-nav').hidden = !report.review_available;
}

function renderStages(report) {
  const {academic_year: year, current, levels} = report;
  const fullYear = scopeOptions.value === 'year';
  const total = fullYear ? year.teachers : current.surveyed;
  const items = fullYear ? year.levels : levels;
  scopeOptions.options[0].textContent = year.start && year.end
    ? `Учебный год · ${formatMonth.format(new Date(year.start))} — ${formatMonth.format(new Date(year.end))}` : 'Учебный год';
  scopeOptions.options[1].textContent = `Окно опросов · ${report.survey_window_days} дней`;
  txt('scope-people', fullYear ? integer.format(total) : fraction(current.surveyed, current.staff));
  txt('scope-base-label', fullYear ? 'всего педагогов' : 'ответили на опрос');
  txt('scope-schools', integer.format(fullYear ? year.schools : current.schools));
  $('stage-metrics').dataset.scope = fullYear ? 'year' : 'current';
  $('stage-metrics').replaceChildren(...items.map(stage => {
    const stageShare = share(stage.count, total);
    const item = element('li');
    const value = element('div', undefined, 'stage-value');
    const proportion = fullYear && total ? percent.format(stage.percent / 100) : fmtShare(stageShare);
    const label = element('span', proportion);
    label.title = fullYear ? 'Доля от всех педагогов' : 'Доля среди ответивших';
    value.append(element('strong', integer.format(stage.count), 'stage-count'), label);
    item.append(element('div', stage.name, 'stage-label'), value, bar(`stage-track tone-${stage.code}`, stageShare));
    return item;
  }));
}
scopeOptions.addEventListener('change', () => { if (currentReport) renderStages(currentReport); });

function schoolStack(school, stages) {
  const track = element('span', undefined, 'risk-track');
  if (!school.surveyed) {
    track.setAttribute('aria-hidden', 'true');
    return track;
  }
  const details = stages.map(code => {
    const part = share(school.levels[code] ?? 0, school.surveyed);
    const label = `${stageNames[code]}: ${fmtShare(part)}`;
    if (part > 0) {
      const segment = element('span', undefined, `stage-color tone-${code}`);
      segment.style.width = `${part * 100}%`;
      segment.title = label;
      segment.setAttribute('aria-hidden', 'true');
      track.append(segment);
    }
    return label;
  });
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', details.join(', '));
  return track;
}

const showSchools = createPager('school-pager', 8, rows => {
  $('school-rows').replaceChildren(...rows.map(({school, count, part}) => {
    const risk = element('div', undefined, 'school-risk');
    risk.append(schoolStack(school, [...activeStages].sort()), element('strong', fmtShare(part)));
    return rowFor(school.name, [integer.format(school.staff), integer.format(school.surveyed), fmtShare(metrics.coverage(school)), integer.format(count), risk]);
  }));
  if (!rows.length) {
    const row = element('tr');
    const cell = element('td', 'На эту дату нет данных по школам.');
    cell.colSpan = 6;
    row.append(cell);
    $('school-rows').append(row);
  }
});

function renderSchools(schools) {
  const field = $('school-sort').value;
  const rows = schools.map(school => {
    const count = [...activeStages].reduce((total, level) => total + (school.levels[level] ?? 0), 0);
    return {school, count, part: share(count, school.surveyed)};
  });
  const scores = {
    share: row => row.part,
    count: row => row.count,
    coverage: row => metrics.coverage(row.school),
    surveyed: row => row.school.surveyed,
    staff: row => row.school.staff,
  };
  rows.sort((a, b) => {
    const byName = a.school.name.localeCompare(b.school.name, 'ru');
    if (field === 'name') return byName;
    return (scores[field](b) ?? -1) - (scores[field](a) ?? -1) || byName;
  });
  document.querySelectorAll('th[data-key]').forEach(th => {
    if (th.dataset.key === field) th.setAttribute('aria-sort', field === 'name' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
  showSchools(rows);
}
const stageChips = new Map();
function updateChips() {
  for (const [code, {chip, single, toggle}] of stageChips) {
    const selected = activeStages.has(code);
    chip.dataset.selected = selected;
    single.setAttribute('aria-pressed', String(selected && activeStages.size === 1));
    toggle.textContent = selected ? '×' : '+';
    toggle.title = `${selected ? 'Убрать' : 'Добавить'}: ${stageNames[code]}`;
    toggle.setAttribute('aria-label', toggle.title);
    toggle.disabled = selected && activeStages.size === 1;
  }
  if (currentReport) renderSchools(currentReport.schools);
}

for (const code of ['1', '2', '3', '0']) {
  const chip = element('span', undefined, 'stage-chip');
  const single = element('button', undefined, 'stage-single');
  const dot = element('span', undefined, `stage-dot stage-color tone-${code}`);
  dot.setAttribute('aria-hidden', 'true');
  single.append(dot, stageNames[code]);
  single.title = `Только: ${stageNames[code]}`;
  single.setAttribute('aria-label', single.title);
  const toggle = element('button', undefined, 'stage-toggle');
  single.addEventListener('click', () => {
    activeStages.clear();
    activeStages.add(code);
    updateChips();
  });
  toggle.addEventListener('click', () => {
    if (activeStages.has(code)) activeStages.delete(code);
    else activeStages.add(code);
    updateChips();
  });
  chip.append(single, toggle);
  $('stage-filters').append(chip);
  stageChips.set(code, {chip, single, toggle});
}
updateChips();
$('school-sort').addEventListener('change', () => { if (currentReport) renderSchools(currentReport.schools); });

const showHistory = createPager('chart-pager', 6, rows => {
  $('history-rows').replaceChildren(...rows.map(row => rowFor(fmtDate(row.date), [
    ratioWithShare(row.elevated, row.surveyed), ratioWithShare(row.surveyed, row.staff),
  ])));
});
const ratioWithShare = (count, total) => total ? `${fraction(count, total)} (${fmtShare(share(count, total))})` : '—';

function renderTrend() {
  const history = currentReport.history.slice(-Number($('trend-range').value));
  const latest = history.at(-1);
  txt('trend-elevated', fmtShare(latest ? metrics.elevated(latest) : null));
  txt('trend-coverage', fmtShare(latest ? metrics.coverage(latest) : null));
  showHistory([...history].reverse());
  stopChart();
  stopChart = connectTrend(history);
}
$('trend-range').addEventListener('change', () => { if (currentReport) renderTrend(); });
$('chart-open').addEventListener('click', () => {
  const showTable = $('chart-values').hidden;
  $('chart-values').hidden = !showTable;
  $('chart-view').hidden = showTable;
  $('chart-open').setAttribute('aria-expanded', String(showTable));
  txt('chart-open', showTable ? 'Показать график' : 'Таблица значений');
});

function renderOverview(report) {
  currentReport = report;
  $('report-date').min = report.min_date;
  $('report-date').max = report.max_date;
  $('report-date').value = report.date;
  $('report-window').value = report.survey_window_days;
  $('period-controls').hidden = false;
  $('report').hidden = false;
  renderSignals(report);
  renderStages(report);
  renderSchools(report.schools);
  renderTrend();
}

function connectTrend(history) {
  const host = $('trend-chart');
  const series = [
    {key: 'elevated', label: 'Истощение или бессилие', ratio: row => ratioWithShare(row.elevated, row.surveyed)},
    {key: 'coverage', label: 'Ответили на опрос', ratio: row => ratioWithShare(row.surveyed, row.staff)},
  ];
  const hasPoints = history.some(row => series.some(({key}) => metrics[key](row) !== null));
  host.hidden = !hasPoints;
  $('chart-empty').hidden = hasPoints;
  if (!hasPoints) return () => {};

  const svg = svgElement('svg', {'aria-hidden': 'true'});
  host.replaceChildren(svg);
  const top = 14;
  const bottom = 192;
  const left = 42;
  let width = 0;

  function draw() {
    const measured = host.clientWidth;
    if (measured === 0 || measured === width) return;
    width = measured;
    const right = width - 18;
    const x = index => left + (right - left) * index / Math.max(1, history.length - 1);
    const y = value => bottom - value * (bottom - top);
    svg.setAttribute('viewBox', `0 0 ${width} 232`);
    svg.replaceChildren();
    for (let tick = 0; tick <= 5; tick++) {
      const ordinate = y(tick / 5);
      svg.append(svgElement('line', {class: 'gridline', x1: left, x2: right, y1: ordinate, y2: ordinate}));
      svg.append(svgElement('text', {x: left - 6, y: ordinate + 4, 'text-anchor': 'end'}, percent.format(tick / 5)));
    }
    const stride = Math.max(1, Math.ceil((history.length - 1) / Math.max(1, Math.floor((right - left) / 58))));
    history.forEach((row, index) => {
      const last = index === history.length - 1;
      if (!last && (index % stride !== 0 || index > history.length - 1 - stride)) return;
      const anchor = last ? 'end' : index === 0 ? 'start' : 'middle';
      svg.append(svgElement('text', {x: x(index), y: 216, 'text-anchor': anchor}, monthFormat.format(new Date(row.date))));
    });
    for (const {key, label, ratio} of series) {
      const group = svgElement('g', {class: `trend-${key}`});
      const path = [];
      const points = [];
      let drawing = false;
      history.forEach((row, index) => {
        const value = metrics[key](row);
        if (value === null) {
          drawing = false;
          return;
        }
        path.push(`${drawing ? 'L' : 'M'}${x(index)} ${y(value)}`);
        drawing = true;
        const dot = svgElement('circle', {class: 'point', cx: x(index), cy: y(value), r: 3.4});
        dot.append(svgElement('title', {}, `${fmtDate(row.date)} · ${label} · ${ratio(row)}`));
        points.push(dot);
      });
      group.append(svgElement('path', {class: 'series', d: path.join(' ')}), ...points);
      svg.append(group);
    }
  }
  const observer = new ResizeObserver(draw);
  observer.observe(host);
  draw();
  return () => {
    observer.disconnect();
    svg.remove();
  };
}

async function loadReport(params, initial = false) {
  fetchRequest?.abort();
  const request = new AbortController();
  fetchRequest = request;
  $('report').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/overview?${params}`, {signal: request.signal});
    if (!response.ok) {
      if (response.status === 400 && initial) return loadReport(new URLSearchParams());
      throw new Error(response.status === 409 ? 'В базе нет кадрового реестра.' : 'Не удалось получить данные за этот период.');
    }
    const report = await response.json();
    if (request.signal.aborted) return;
    if (!initial && params.size) scopeOptions.value = 'current';
    renderOverview(report);
    $('load-status').hidden = true;
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState(null, '', url);
  } catch (error) {
    if (request.signal.aborted) return;
    $('load-status').hidden = false;
    txt('load-status', error.message);
    if (currentReport) {
      $('report-date').value = currentReport.date;
      $('report-window').value = currentReport.survey_window_days;
    }
  } finally {
    if (!request.signal.aborted) $('report').setAttribute('aria-busy', 'false');
  }
}

function readControls() {
  if (!$('report-date').reportValidity()) return;
  loadReport(new URLSearchParams({date: $('report-date').value, window: $('report-window').value}));
}
$('report-date').addEventListener('change', readControls);
$('report-window').addEventListener('change', readControls);
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.has('date') || initialParams.has('window')) scopeOptions.value = 'current';
loadReport(initialParams, true);
