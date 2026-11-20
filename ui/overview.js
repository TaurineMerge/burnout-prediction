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
const activeStages = new Set(['2', '3']);
let currentReport;
let stopChart = () => {};
let fetchRequest;

const help = {
  model: ['Риск выгорания по модели', 'Модель учитывает активность, расписание и прошлые опросы. В группу риска входят педагоги, для которых оценка выше порога. Доля считается среди всех оценённых педагогов. Изменение сравнивается с предыдущей завершённой неделей.'],
  survey: ['Результаты опросов', 'В числителе педагоги с истощением или бессилием по последнему опросу за выбранный период. В знаменателе все ответившие за этот период. Изменение сравнивается с предыдущим окном той же длины.'],
  stages: ['Доли по стадиям', 'За учебный год доля считается от всех педагогов в годовом отчёте. На дату обзора доля считается среди ответивших за выбранное окно опросов.'],
  schools: ['Сравнение школ', 'Охват показывает долю ответивших от текущего штата школы. Число педагогов и доля справа относятся к выбранным стадиям. Доля считается среди ответивших.'],
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
  txt('model-note', model?.status === 'available' ? fmtPeriod(model.week_start, model.week_end)
    : report.model_enabled ? 'Нет оценки на эту дату' : 'Расчёт отключён');
  txt('survey-period', fmtPeriod(report.survey_from, report.date));
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
    ? `${formatMonth.format(new Date(year.start))} — ${formatMonth.format(new Date(year.end))}` : 'Учебный год';
  txt('scope-people', integer.format(total));
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

const showSchools = createPager('school-pager', 8, rows => {
  $('school-rows').replaceChildren(...rows.map(({school, count, part}) => {
    const risk = element('div', undefined, 'school-risk');
    risk.append(bar('risk-track', part), element('strong', fmtShare(part)));
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
for (const button of document.querySelectorAll('[data-stage]')) {
  button.addEventListener('click', () => {
    const stage = button.dataset.stage;
    if (activeStages.has(stage)) {
      if (activeStages.size === 1) return;
      activeStages.delete(stage);
    } else {
      activeStages.add(stage);
    }
    button.setAttribute('aria-pressed', String(activeStages.has(stage)));
    if (currentReport) renderSchools(currentReport.schools);
  });
}
$('school-sort').addEventListener('change', () => { if (currentReport) renderSchools(currentReport.schools); });

const showHistory = createPager('chart-pager', 6, rows => {
  $('history-rows').replaceChildren(...rows.map(row => rowFor(fmtDate(row.date), [
    fraction(row.surveyed, row.staff), fmtShare(metrics.elevated(row)), fmtShare(metrics.coverage(row)),
  ])));
});
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
  showHistory([...report.history].reverse());
  stopChart();
  stopChart = connectStatCard(report.history);
}

function connectStatCard(history) {
  // Parameters from the DesignBookmark Stat Card.
  const springs = {point: [200, 17], indicator: [380, 30]};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = [...document.querySelectorAll('#trend-switch button')];
  const indicator = document.querySelector('.switch-indicator');
  const host = $('trend-chart');
  const svg = svgElement('svg');
  const axis = svgElement('g');
  const area = svgElement('path', {class: 'area'});
  const stroke = svgElement('path', {class: 'series'});
  const dots = svgElement('g');
  svg.append(axis, area, stroke, dots);
  host.append(svg);

  const spring = (x, [k, c]) => ({x, target: x, velocity: 0, k, c});
  const shift = spring(0, springs.indicator);
  const size = spring(1, springs.indicator);
  let metric = buttons.find(button => button.getAttribute('aria-pressed') === 'true').dataset.metric;
  let ceiling = 1;
  let frame = 0;
  let previousTime = 0;
  let width = 0;
  let points = [];
  const baseline = 157;

  function geometry(index) {
    return 40 + index * (width - 58) / Math.max(1, history.length - 1);
  }

  function drawAxes() {
    svg.setAttribute('viewBox', `0 0 ${width} 196`);
    axis.replaceChildren();
    for (let tick = 0; tick <= 4; tick++) {
      const y = baseline - tick * (baseline - 12) / 4;
      axis.append(svgElement('line', {class: 'gridline', x1: 40, x2: width - 17, y1: y, y2: y}));
      axis.append(svgElement('text', {x: 34, y: y + 4, 'text-anchor': 'end'}, fmtShare(ceiling * tick / 4)));
    }
    const stride = Math.max(1, Math.ceil((history.length - 1) / Math.max(1, Math.floor((width - 58) / 58))));
    history.forEach((row, index) => {
      const last = index === history.length - 1;
      if ((!last && index % stride !== 0) || (!last && index > history.length - 1 - stride)) return;
      axis.append(svgElement('text', {x: geometry(index), y: 180, 'text-anchor': last ? 'end' : index === 0 ? 'start' : 'middle'}, monthFormat.format(new Date(row.date))));
    });
    dots.replaceChildren(...history.map(row => {
      const dot = svgElement('circle', {class: 'point', r: 3.5});
      const sample = metric === 'elevated' ? fraction(row.elevated, row.surveyed) : fraction(row.surveyed, row.staff);
      dot.append(svgElement('title', {}, `${fmtDate(row.date)} · ${fmtShare(metrics[metric](row))} · ${sample}`));
      return dot;
    }));
  }

  function paint() {
    indicator.style.transform = `translateX(${shift.x}px) scaleX(${size.x})`;
    const segments = [];
    let segment = [];
    points.forEach((point, index) => {
      const dot = dots.children[index];
      dot.style.display = point ? '' : 'none';
      if (!point) {
        if (segment.length) segments.push(segment);
        segment = [];
        return;
      }
      const x = geometry(index);
      const y = baseline - Math.max(0, Math.min(1, point.x)) * (baseline - 12);
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      segment.push([x, y]);
    });
    if (segment.length) segments.push(segment);
    const line = group => group.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    stroke.setAttribute('d', segments.map(line).join(' '));
    area.setAttribute('d', segments.map(group => `${line(group)} L${group.at(-1)[0]} ${baseline} L${group[0][0]} ${baseline} Z`).join(' '));
  }

  function animate(now) {
    const dt = previousTime ? Math.min((now - previousTime) / 1000, 1 / 30) : 1 / 60;
    previousTime = now;
    const active = [shift, size, ...points].filter(Boolean);
    let moving = false;
    for (const s of active) {
      for (let substep = 0; substep < 4; substep++) {
        s.velocity += (s.k * (s.target - s.x) - s.c * s.velocity) * dt / 4;
        s.x += s.velocity * dt / 4;
      }
      if (Math.abs(s.x - s.target) < 0.0005 && Math.abs(s.velocity) < 0.002) {
        s.x = s.target;
        s.velocity = 0;
      } else {
        moving = true;
      }
    }
    paint();
    frame = moving ? requestAnimationFrame(animate) : 0;
    if (!frame) previousTime = 0;
  }

  function select(next, immediate = false) {
    metric = next;
    const series = history.map(metrics[metric]);
    const max = Math.max(0, ...series.filter(x => x !== null));
    ceiling = metric === 'coverage' ? 1 : Math.max(.2, Math.ceil(max * 5) / 5);
    const targetSeries = series.map(x => x === null ? null : x / ceiling);
    points = targetSeries.map((x, i) => x === null ? null : points[i] || spring(x, springs.point));
    points.forEach((point, i) => { if (point) point.target = targetSeries[i]; });
    const latest = series.at(-1) ?? null;
    const prev = series.at(-2) ?? null;
    const change = latest === null || prev === null ? null : (latest - prev) * 100;
    txt('trend-value', fmtShare(latest));
    txt('trend-delta', change === null ? '' : `${pp.format(change)} п. п. к прошлому срезу`);
    host.hidden = !series.some(x => x !== null);
    $('chart-empty').hidden = !host.hidden;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metric === metric)));
    const activeButton = buttons.find(button => button.dataset.metric === metric);
    shift.target = activeButton.offsetLeft;
    size.target = activeButton.offsetWidth;
    width = Math.max(200, host.clientWidth);
    drawAxes();
    if (immediate || reduced.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      for (const s of [shift, size, ...points].filter(Boolean)) {
        s.x = s.target;
        s.velocity = 0;
      }
      paint();
    } else if (!frame) {
      frame = requestAnimationFrame(animate);
    }
  }

  buttons.forEach(button => { button.onclick = () => select(button.dataset.metric); });
  const preferenceChange = () => select(metric, true);
  reduced.addEventListener('change', preferenceChange);
  const observer = new ResizeObserver(() => {
    if (host.clientWidth > 0 && width !== host.clientWidth) select(metric, true);
  });
  observer.observe(host);
  select(metric, true);
  return () => {
    cancelAnimationFrame(frame);
    reduced.removeEventListener('change', preferenceChange);
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
