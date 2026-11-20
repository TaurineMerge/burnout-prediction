'use strict';

const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const percent = new Intl.NumberFormat('ru-RU', {style: 'percent', maximumFractionDigits: 1});
const pp = new Intl.NumberFormat('ru-RU', {signDisplay: 'exceptZero', maximumFractionDigits: 1});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
const monthFormat = new Intl.DateTimeFormat('ru-RU', {month: 'short', timeZone: 'UTC'});
const fmtDate = value => dateFormat.format(new Date(value));
const share = (count, base) => base ? count / base : null;
const fmtShare = value => value === null ? '—' : percent.format(value);
const fraction = (count, total) => `${integer.format(count)} из ${integer.format(total)}`;
const txt = (id, value) => { $(id).textContent = value; };
const metrics = {
  elevated: row => share(row.elevated, row.surveyed),
  coverage: row => share(row.surveyed, row.staff),
};

function element(tag, content, className) {
  const el = document.createElement(tag);
  if (content !== undefined) el.textContent = content;
  if (className) el.className = className;
  return el;
}

function svgElement(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

function bar(className, fraction) {
  const track = element('span', undefined, className);
  track.setAttribute('aria-hidden', 'true');
  const fill = element('span');
  fill.style.width = `${(fraction ?? 0) * 100}%`;
  track.append(fill);
  return track;
}

function renderOverview(data) {
  const {current, levels, schools, workload, model_risk: model, history} = data;
  $('report-date').dateTime = data.date;
  txt('report-date', fmtDate(data.date));
  txt('staff-value', integer.format(current.staff));
  txt('staff-note', `Школ в срезе: ${integer.format(current.schools)}`);
  txt('coverage-value', fmtShare(metrics.coverage(current)));
  txt('coverage-note', `${fraction(current.surveyed, current.staff)} · за ${data.survey_window_days} дней`);
  txt('elevated-value', fmtShare(metrics.elevated(current)));
  txt('elevated-note', `${fraction(current.elevated, current.surveyed)} с опросом`);
  txt('missing-value', integer.format(current.staff - current.surveyed));
  txt('missing-note', 'Нет результата за окно опроса');
  txt('distribution-note', current.surveyed ? `Педагогов со свежим опросом: ${integer.format(current.surveyed)}` : 'Свежих опросов в этом срезе нет.');
  $('level-bar').replaceChildren();
  $('level-bar').hidden = !current.surveyed;
  $('levels').replaceChildren(...levels.map(level => {
    const levelShare = share(level.count, current.surveyed);
    const tone = `tone-${level.code}`;
    if (level.count) {
      const segment = element('span', undefined, tone);
      segment.style.flexGrow = level.count;
      $('level-bar').append(segment);
    }
    const label = element('span');
    label.append(element('span', undefined, `swatch ${tone}`), level.name);
    const row = element('li');
    row.append(label, element('strong', integer.format(level.count)), element('span', fmtShare(levelShare)));
    return row;
  }));

  const sortBy = {
    share: (a, b) => (metrics.elevated(b) ?? -1) - (metrics.elevated(a) ?? -1),
    count: (a, b) => b.elevated - a.elevated,
    coverage: (a, b) => (metrics.coverage(b) ?? -1) - (metrics.coverage(a) ?? -1),
    name: () => 0,
  };
  const sort = $('school-sort');
  function renderSchools() {
    const sorted = [...schools].sort((a, b) => sortBy[sort.value](a, b) || a.name.localeCompare(b.name, 'ru'));
    $('school-rows').replaceChildren(...sorted.map(school => {
      const row = element('tr');
      const name = element('th', school.name);
      name.scope = 'row';
      const risk = element('td');
      const inner = element('div', undefined, 'school-risk');
      const riskShare = metrics.elevated(school);
      const label = element('span', undefined, 'school-risk-label');
      label.append(element('strong', fmtShare(riskShare)));
      if (school.surveyed) label.append(element('small', fraction(school.elevated, school.surveyed)));
      inner.append(bar('risk-track', riskShare), label);
      risk.append(inner);
      row.append(name, element('td', integer.format(school.staff)), element('td', integer.format(school.surveyed)), element('td', fmtShare(metrics.coverage(school))), risk);
      return row;
    }));
    if (!sorted.length) {
      const row = element('tr');
      const cell = element('td', 'На эту дату нет кадровых данных по школам.');
      cell.colSpan = 5;
      row.append(cell);
      $('school-rows').append(row);
    }
  }
  sort.addEventListener('change', renderSchools);
  renderSchools();

  txt('workload-note', workload.average === null ? 'На эту дату нет данных о ставках.' : `В среднем ${decimal.format(workload.average)} ставки · педагогов: ${integer.format(workload.count)}`);
  $('workload-bars').replaceChildren(...workload.distribution.map(group => {
    const row = element('li');
    row.append(element('span', decimal.format(group.fte)), bar('workload-track', share(group.count, workload.count)), element('span', integer.format(group.count)));
    return row;
  }));
  if (model?.status === 'available') {
    txt('model-value', fraction(model.at_risk_count, model.scored_count));
    const week = dateFormat.formatRange(new Date(model.week_start), new Date(model.week_end));
    txt('model-note', `Модель отметила риск уровня 2+. Период: ${week} С данными за неделю: ${integer.format(model.observed_count)}.`);
  } else {
    txt('model-value', '—');
    txt('model-note', model ? 'Недостаточно данных для оценки.' : 'Расчёт модели отключён.');
  }

  $('history-rows').replaceChildren(...history.map(row => {
    const tr = element('tr');
    const name = element('th', fmtDate(row.date));
    name.scope = 'row';
    tr.append(name, ...[row.staff, row.surveyed, row.elevated].map(x => element('td', integer.format(x))), element('td', fmtShare(metrics.elevated(row))), element('td', fmtShare(metrics.coverage(row))));
    return tr;
  }));
  txt('method-note', `Срез на дату отчёта. По каждому педагогу учитывается последний опрос за ${data.survey_window_days} дней. Ставки взяты из демонстрационного кадрового реестра.`);
  $('report').hidden = false;
  $('load-status').hidden = true;
  connectStatCard(history);
}

function connectStatCard(history) {
  // Parameters from DesignBookmark's stat.js. The demo springs were defined there,
  // independently of the generic spring tokens shared by the motion gallery.
  const springs = {point: [200, 17], value: [160, 22], indicator: [380, 30]};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = [...document.querySelectorAll('.switch button')];
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
  let metric = 'elevated';
  let ceiling = 1;
  let frame = 0;
  let previousTime = 0;
  let width = 0;
  let points = [];
  let value = null;
  let delta = null;
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
    txt('trend-value', fmtShare(value ? Math.min(1, Math.max(0, value.x)) : null));
    txt('trend-delta', delta ? `${pp.format(delta.x)} п. п.` : '');
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
    const active = [shift, size, value, delta, ...points].filter(Boolean);
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
    value = latest === null ? null : value || spring(latest, springs.value);
    delta = change === null ? null : delta || spring(change, springs.value);
    if (value) value.target = latest;
    if (delta) delta.target = change;
    const row = history.at(-1);
    txt('trend-sample', row && latest !== null ? (metric === 'elevated' ? `${fraction(row.elevated, row.surveyed)} с опросом` : `${fraction(row.surveyed, row.staff)} в штате`) : '');
    $('trend-delta').title = change === null ? '' : 'Изменение к предыдущему срезу';
    $('trend-value').setAttribute('aria-label', fmtShare(latest));
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
      for (const s of [shift, size, value, delta, ...points].filter(Boolean)) {
        s.x = s.target;
        s.velocity = 0;
      }
      paint();
    } else if (!frame) {
      frame = requestAnimationFrame(animate);
    }
  }

  buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.metric)));
  reduced.addEventListener('change', () => select(metric, true));
  new ResizeObserver(() => {
    if (host.clientWidth > 0 && width !== host.clientWidth) select(metric, true);
  }).observe(host);
  select(metric, true);
}

async function start() {
  try {
    const response = await fetch('/api/overview');
    if (response.status === 409) {
      txt('load-status', 'В базе нет кадрового реестра. Создайте новую демонстрационную базу и перезапустите дашборд.');
      return;
    }
    if (!response.ok) throw new Error('Не удалось загрузить обзор');
    renderOverview(await response.json());
  } catch (error) {
    $('report').hidden = true;
    $('load-status').hidden = false;
    txt('load-status', 'Не удалось загрузить данные. Обновите страницу, чтобы повторить.');
    console.error(error);
  }
}

start();
