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
let schoolView = 'observed';
let currentReport;
let stopChart = () => {};
let fetchRequest;

const help = {
  model: ['Риск выгорания по модели', 'Оценка относится к последней полной неделе с понедельника по воскресенье на дату обзора. Доля считается среди оценённых педагогов, изменение — к предыдущей неделе.'],
  survey: ['Результаты опросов', 'Окно опросов заканчивается датой обзора включительно. Учитывается последний ответ каждого педагога за это окно. Доля считается среди ответивших, изменение — к предыдущему окну той же длины.'],
  stages: ['Доли по стадиям', 'За учебный год доля считается от всех педагогов в годовом отчёте. За окно опросов доля считается среди ответивших за этот период.'],
  schools: ['Сравнение школ', 'Название оставляет одну стадию, плюс добавляет, крестик убирает. Длина сегмента соответствует доле стадии среди ответивших. Прогноз на следующие 28 дней использует доли ответов за три предыдущих окна по 28 дней. Для оценки нужно хотя бы два окна с ответами.'],
  trend: ['Как сравнивать линии', 'У графиков общие даты и разные шкалы. В верхнем доля считается среди ответивших, в нижнем — от штата. Наведите указатель на месяц или выберите его клавишами, чтобы увидеть числа.'],
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
  delete change.dataset.direction;
  if (value === null || prior === null) return;
  const difference = Math.round((value - prior) * 1000) / 10;
  change.dataset.direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';
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
  $('review-open').href = `${url}&scope=risk`;
  $('review-open').hidden = !report.review_available;
  $('people-nav').href = url;
  $('people-nav').hidden = !report.people_available;
  $('classic-dossier').hidden = report.people_available;
}

function renderStages(report) {
  const {academic_year: year, current, levels} = report;
  const fullYear = scopeOptions.value === 'year';
  const total = fullYear ? year.teachers : current.surveyed;
  const items = fullYear ? year.levels : levels;
  scopeOptions.options[0].textContent = year.start && year.end
    ? `Учебный год · ${formatMonth.format(new Date(year.start))} — ${formatMonth.format(new Date(year.end))}` : 'Учебный год';
  scopeOptions.options[1].textContent = `Окно опросов · ${report.survey_window_days} дней`;
  txt('scope-people', fullYear ? fraction(year.surveyed, year.teachers) : fraction(current.surveyed, current.staff));
  txt('scope-base-label', 'ответили на опрос');
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
  const forecasting = schoolView === 'forecast';
  $('school-rows').replaceChildren(...rows.map(({school, source, count, part}) => {
    const risk = element('div', undefined, 'school-risk');
    if (part === null) risk.append(element('span'), element('strong', '—'));
    else risk.append(schoolStack(source, [...activeStages].sort()), element('strong', fmtShare(part)));
    if (forecasting) return rowFor(school.name, [integer.format(source.surveyed), integer.format(source.windows), risk]);
    return rowFor(school.name, [integer.format(school.staff), integer.format(school.surveyed), fmtShare(metrics.coverage(school)), integer.format(count), risk]);
  }));
  if (!rows.length) {
    const row = element('tr');
    const cell = element('td', 'На эту дату нет данных по школам.');
    cell.colSpan = forecasting ? 4 : 6;
    row.append(cell);
    $('school-rows').append(row);
  }
});

function renderSchools(schools) {
  const field = $('school-sort').value;
  const forecasting = schoolView === 'forecast';
  const rows = schools.map(school => {
    const source = forecasting ? school.forecast : school;
    const count = [...activeStages].reduce((total, level) => total + (source.levels[level] ?? 0), 0);
    const part = forecasting && !source.available ? null : share(count, source.surveyed);
    return {school, source, count, part};
  });
  const scores = {
    share: row => row.part,
    count: row => row.count,
    coverage: row => metrics.coverage(row.school),
    surveyed: row => row.source.surveyed,
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

function renderSchoolView() {
  const forecasting = schoolView === 'forecast';
  $('observed-head').hidden = forecasting;
  $('forecast-head').hidden = !forecasting;
  $('school-forecast-note').hidden = !forecasting;
  if (forecasting) {
    const {start, end} = currentReport.forecast;
    txt('school-forecast-note', `${fmtPeriod(start, end)} · оценка по прошлым опросам`);
  }
  const options = $('school-sort').options;
  for (const option of options) {
    option.hidden = forecasting && !['share', 'surveyed', 'name'].includes(option.value);
    option.disabled = option.hidden;
    if (option.value === 'surveyed') option.textContent = forecasting ? 'По ответам в расчёте' : 'По числу опрошенных';
  }
  const selectedSort = $('school-sort').selectedOptions[0];
  if (!selectedSort || selectedSort.disabled) $('school-sort').value = 'share';
  document.querySelectorAll('[data-school-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.schoolView === schoolView));
  });
  renderSchools(currentReport.schools);
}
document.querySelectorAll('[data-school-view]').forEach(button => button.addEventListener('click', () => {
  if (!currentReport || button.dataset.schoolView === schoolView) return;
  schoolView = button.dataset.schoolView;
  renderSchoolView();
}));
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
  renderSchoolView();
  renderTrend();
}

function connectTrend(history) {
  const host = $('trend-chart');
  const elevated = history.map(metrics.elevated);
  const coverage = history.map(metrics.coverage);
  const maxElevated = Math.max(0, ...elevated.filter(value => value !== null));
  const step = Math.max(.05, Math.ceil(maxElevated * 5) / 20);
  const tickCount = Math.max(2, Math.ceil(maxElevated / step - 1e-9));
  const panels = [
    {key: 'elevated', label: 'Истощение или бессилие', values: elevated, top: 42, bottom: 130, header: 21, ticks: Array.from({length: tickCount + 1}, (_, i) => step * i), ratio: row => ratioWithShare(row.elevated, row.surveyed)},
    {key: 'coverage', label: 'Ответили на опрос', values: coverage, top: 183, bottom: 271, header: 162, ticks: [0, .25, .5, .75, 1], ratio: row => ratioWithShare(row.surveyed, row.staff)},
  ];
  const hasPoints = panels.some(panel => panel.values.some(value => value !== null));
  host.hidden = !hasPoints;
  $('chart-empty').hidden = hasPoints;
  if (!hasPoints) return () => {};

  const svg = svgElement('svg');
  const tip = element('div', undefined, 'trend-tip');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  host.replaceChildren(svg, tip);
  const left = 45;
  let width = 0;

  function draw() {
    const measured = host.clientWidth;
    if (measured === 0 || measured === width) return;
    width = measured;
    const right = width - 22;
    const distance = (right - left) / Math.max(1, history.length - 1);
    const x = index => left + distance * index;
    const marks = svgElement('g', {'aria-hidden': 'true'});
    svg.setAttribute('viewBox', `0 0 ${width} 310`);
    svg.replaceChildren(marks);
    tip.hidden = true;
    for (const panel of panels) {
      const group = svgElement('g', {class: `trend-${panel.key}`});
      const ceiling = panel.ticks.at(-1);
      const y = value => panel.bottom - value * (panel.bottom - panel.top) / ceiling;
      group.append(svgElement('text', {class: 'trend-panel-label', x: 0, y: panel.header}, panel.label));
      group.append(svgElement('text', {class: 'trend-latest', x: right, y: panel.header, 'text-anchor': 'end'}, fmtShare(panel.values.at(-1))));
      for (const tick of panel.ticks) {
        const ordinate = y(tick);
        group.append(svgElement('line', {class: 'gridline', x1: left, x2: right, y1: ordinate, y2: ordinate}));
        group.append(svgElement('text', {x: left - 6, y: ordinate + 4, 'text-anchor': 'end'}, fmtShare(tick)));
      }
      const path = [];
      const dots = [];
      const labelStride = Math.max(1, Math.ceil(64 / Math.max(1, distance)));
      let drawing = false;
      panel.values.forEach((value, index) => {
        if (value === null) {
          drawing = false;
          return;
        }
        const px = x(index);
        const py = y(value);
        const last = index === panel.values.length - 1;
        path.push(`${drawing ? 'L' : 'M'}${px} ${py}`);
        drawing = true;
        dots.push(svgElement('circle', {class: 'point', cx: px, cy: py, r: 3.4}));
        if (panel.key === 'elevated' && (last || (index % labelStride === 0 && index <= panel.values.length - 1 - labelStride))) {
          const first = index === 0;
          const labelX = px + (first ? 5 : last ? -4 : 0);
          const anchor = first ? 'start' : last ? 'end' : 'middle';
          dots.push(svgElement('text', {class: 'trend-point-label', x: labelX, y: py - 10, 'text-anchor': anchor}, fmtShare(value)));
        }
      });
      group.append(svgElement('path', {class: 'series', d: path.join(' ')}), ...dots);
      marks.append(group);
    }
    const stride = Math.max(1, Math.ceil(58 / Math.max(1, distance)));
    history.forEach((row, index) => {
      const last = index === history.length - 1;
      if (!last && (index % stride !== 0 || index > history.length - 1 - stride)) return;
      const anchor = last ? 'end' : index === 0 ? 'start' : 'middle';
      marks.append(svgElement('text', {x: x(index), y: 294, 'text-anchor': anchor}, monthFormat.format(new Date(row.date))));
    });
    const guide = svgElement('line', {class: 'trend-guide', y1: 42, y2: 271, visibility: 'hidden', 'aria-hidden': 'true'});
    svg.append(guide);
    function clear() {
      guide.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }
    function show(index) {
      const row = history[index];
      const position = x(index);
      guide.setAttribute('x1', position);
      guide.setAttribute('x2', position);
      guide.setAttribute('visibility', 'visible');
      tip.replaceChildren(element('strong', fmtDate(row.date)));
      for (const panel of panels) {
        const detail = element('div');
        detail.append(element('span', panel.label), element('strong', panel.ratio(row)));
        tip.append(detail);
      }
      tip.hidden = false;
      const tipWidth = tip.offsetWidth;
      const target = position + tipWidth + 15 <= width ? position + 15 : position - tipWidth - 15;
      tip.style.left = `${Math.max(0, Math.min(target, width - tipWidth))}px`;
    }
    const targets = history.map((row, index) => {
      const start = index ? x(index) - distance / 2 : left - 10;
      const end = index < history.length - 1 ? x(index) + distance / 2 : right + 10;
      const label = [fmtDate(row.date), ...panels.map(panel => `${panel.label}: ${panel.ratio(row)}`)].join('. ');
      const target = svgElement('rect', {class: 'month-hit', x: start, y: 32, width: end - start, height: 269, role: 'button', 'aria-label': label, tabindex: index === history.length - 1 ? 0 : -1});
      target.addEventListener('pointerenter', () => show(index));
      target.addEventListener('focus', () => show(index));
      target.addEventListener('blur', clear);
      target.addEventListener('click', () => show(index));
      target.addEventListener('keydown', event => {
        if (event.key === 'Escape') { clear(); return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(index); return; }
        const next = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: history.length - 1}[event.key];
        if (next === undefined || !targets[next]) return;
        event.preventDefault();
        targets.forEach((item, position) => item.setAttribute('tabindex', position === next ? 0 : -1));
        targets[next].focus();
      });
      return target;
    });
    svg.append(...targets);
    svg.onpointerleave = clear;
  }
  const observer = new ResizeObserver(draw);
  observer.observe(host);
  draw();
  return () => {
    observer.disconnect();
    svg.remove();
    tip.remove();
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
