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

const monthDay = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'});
const fmtPeriod = (start, end) => monthDay.formatRange(new Date(start), new Date(end));
const formatMonth = new Intl.DateTimeFormat('ru-RU', {month: 'long', timeZone: 'UTC'});

function rowFor(label, cells) {
  const tr = element('tr');
  const th = element('th');
  th.scope = 'row';
  th.append(label);
  tr.append(th, ...cells.map(item => {
    const td = element('td');
    td.append(item);
    return td;
  }));
  return tr;
}

function createPager(id, size, render) {
  const root = $(id);
  const prev = element('button', 'Назад');
  const next = element('button', 'Дальше');
  const status = element('span');
  status.setAttribute('aria-live', 'polite');
  root.replaceChildren(prev, status, next);
  let rows = [];
  let page = 0;
  function refresh() {
    const total = Math.max(1, Math.ceil(rows.length / size));
    const start = page * size;
    render(rows.slice(start, start + size));
    status.textContent = `${page + 1} / ${total}`;
    prev.disabled = page === 0;
    next.disabled = page + 1 >= total;
    root.hidden = total <= 1;
  }
  prev.addEventListener('click', () => { page--; refresh(); });
  next.addEventListener('click', () => { page++; refresh(); });
  return values => { rows = values; page = 0; refresh(); };
}

function renderSignals(data) {
  const {current, model_risk: model} = data;
  const elevated = metrics.elevated(current);
  txt('elevated-value', fmtShare(elevated));
  txt('elevated-base', current.surveyed ? fraction(current.elevated, current.surveyed) : '');
  txt('survey-coverage', `Охват ${fmtShare(metrics.coverage(current))}`);
  if (model?.status === 'available') {
    txt('model-value', integer.format(model.at_risk_count));
    txt('model-base', `из ${integer.format(model.scored_count)} · ${fmtShare(share(model.at_risk_count, model.scored_count))}`);
    txt('model-note', fmtPeriod(model.week_start, model.week_end));
  } else {
    txt('model-value', '—');
    txt('model-note', model ? 'Недостаточно данных' : 'Расчёт отключён');
  }
  $('review-open').hidden = !data.review_available;
  const info = {
    model: ['Группа риска', model?.status === 'available'
      ? `Порог модели: ${percent.format(model.threshold)}. Охват расчёта: ${fraction(model.scored_count, model.observed_count)} педагогов с активностью за неделю. Оценка помогает выбрать, с кем обсудить поддержку. Вероятность ухода из школы модель не оценивает.`
      : 'Оценка риска доступна после расчёта модели за завершённую неделю.'],
    survey: ['Охват опросами', `В штате ${current.staff} педагогов. У ${current.staff - current.surveyed} нет результата за последние ${data.survey_window_days} дней. Доля уровня 2+ считается среди ответивших.`],
    stages: ['Периоды опросов', `«Учебный год» использует последний известный уровень каждого педагога во всей демонстрационной выгрузке, включая записи позже даты отчёта. Проценты считаются от всех педагогов выгрузки. «Свежие» показывает последний опрос за ${data.survey_window_days} дней на дату отчёта. Проценты считаются среди ответивших, уровень 0 доступен в этой вкладке.`],
    schools: ['Сравнение школ', `В таблице учитываются свежие опросы. «Доля» использует число ответивших в школе, а «Охват» — число педагогов в штате. Стадию можно сменить над таблицей. Нажмите заголовок столбца для сортировки.`],
  };
  document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => {
    const [title, body] = info[button.dataset.info];
    txt('info-title', title);
    txt('info-body', body);
    $('info-dialog').showModal();
  }));
}

function connectStages(data) {
  const {academic_year: year, current, levels} = data;
  const buttons = [...document.querySelectorAll('#stage-switch button')];
  function render(scope) {
    const isYear = scope === 'year';
    const total = isYear ? year.teachers : current.surveyed;
    const items = isYear ? year.levels : levels;
    const period = year.start && year.end
      ? `${formatMonth.format(new Date(year.start))} — ${formatMonth.format(new Date(year.end))}` : '';
    txt('stage-context', isYear
      ? [period, `${year.months} мес.`, `${year.teachers} педагогов`, `школ: ${year.schools}`].filter(Boolean).join(' · ')
      : `${current.surveyed} с опросом из ${current.staff} · за ${data.survey_window_days} дней`);
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === scope)));
    $('stage-metrics').dataset.scope = scope;
    $('stage-metrics').replaceChildren(...items.map(stage => {
      const stageShare = share(stage.count, total);
      const metric = element('li');
      const value = element('div', undefined, 'stage-value');
      value.append(element('strong', integer.format(stage.count), 'stage-count'), element('span',
        isYear ? (total ? percent.format(stage.percent / 100) : '—') : fmtShare(stageShare)));
      metric.append(element('div', stage.name, 'stage-label'), value, bar(`stage-track tone-${stage.code}`, stageShare));
      return metric;
    }));
  }
  buttons.forEach(button => button.addEventListener('click', () => render(button.dataset.scope)));
  render('year');
}

function connectSchools(schools) {
  const buttons = [...document.querySelectorAll('[data-sort]')];
  const stage = $('school-stage');
  let field = 'share';
  let descending = true;
  const count = row => stage.value === 'elevated' ? row.elevated : row.levels[stage.value] ?? 0;
  const score = {
    staff: row => row.staff, surveyed: row => row.surveyed,
    coverage: metrics.coverage, count, share: row => share(count(row), row.surveyed),
  };
  function render() {
    const sign = descending ? -1 : 1;
    const sorted = [...schools].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, 'ru');
      if (field === 'name') return sign * byName;
      const x = score[field](a);
      const y = score[field](b);
      if (x === null || y === null) return Number(x === null) - Number(y === null) || byName;
      return sign * (x - y) || byName;
    });
    $('school-rows').replaceChildren(...sorted.map(row => {
      const part = score.share(row);
      const risk = element('div', undefined, 'school-risk');
      risk.append(bar('risk-track', part), element('strong', fmtShare(part)));
      return rowFor(row.name, [integer.format(row.staff), integer.format(row.surveyed), fmtShare(metrics.coverage(row)), integer.format(count(row)), risk]);
    }));
    if (!sorted.length) {
      const row = element('tr');
      const cell = element('td', 'На эту дату нет данных по школам.');
      cell.colSpan = 6;
      row.append(cell);
      $('school-rows').append(row);
    }
    for (const button of buttons) {
      const selected = button.dataset.sort === field;
      const th = button.closest('th');
      if (selected) th.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
      button.querySelector('span').textContent = selected ? (descending ? '↓' : '↑') : '↕';
    }
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    if (field === button.dataset.sort) descending = !descending;
    else { field = button.dataset.sort; descending = field !== 'name'; }
    render();
    txt('schools-status', `Сортировка: ${button.firstChild.textContent.trim()}, ${descending ? 'по убыванию' : 'по возрастанию'}`);
  }));
  stage.addEventListener('change', render);
  render();
}

function connectDialogs(data) {
  const showHistory = createPager('chart-pager', 6, rows => {
    $('history-rows').replaceChildren(...rows.map(row => rowFor(fmtDate(row.date), [
      fraction(row.surveyed, row.staff), integer.format(row.elevated),
      fmtShare(metrics.elevated(row)), fmtShare(metrics.coverage(row)),
    ])));
  });
  $('chart-open').addEventListener('click', () => {
    showHistory([...data.history].reverse());
    $('chart-dialog').showModal();
  });

  if (!data.review_available) return;
  const school = $('review-school');
  let people = null;
  const showPeople = createPager('review-pager', 8, rows => {
    $('review-rows').replaceChildren(...rows.map(person => {
      const name = element('a', person.name || `Педагог ${person.id}`);
      name.href = `/classic?user_id=${encodeURIComponent(person.id)}#teacher`;
      return rowFor(name, [person.school || '—', person.survey_stage || 'Нет ответа', person.fte === null ? '—' : decimal.format(person.fte)]);
    }));
  });
  function filterPeople() {
    const filtered = people.filter(person => school.value === 'all' || String(person.school_id) === school.value);
    txt('review-status', filtered.length ? '' : 'В этой школе нет отмеченных педагогов.');
    $('review-table').hidden = !filtered.length;
    showPeople(filtered);
  }
  school.addEventListener('change', () => { if (people) filterPeople(); });
  $('review-open').addEventListener('click', async () => {
    $('review-dialog').showModal();
    if (people) return;
    txt('review-status', 'Загружаем список…');
    try {
      const response = await fetch('/api/overview/review');
      if (!response.ok) throw new Error('Review list unavailable');
      people = (await response.json()).people;
      const schools = new Map(people.filter(p => p.school_id !== null).map(p => [p.school_id, p.school]));
      for (const [id, name] of [...schools].sort((a, b) => a[1].localeCompare(b[1], 'ru'))) {
        school.add(new Option(name, id));
      }
      filterPeople();
    } catch (error) {
      txt('review-status', 'Список не загрузился. Закройте окно и попробуйте снова.');
    }
  });
}

function renderOverview(data) {
  $('report-date').dateTime = data.date;
  txt('report-date', fmtDate(data.date));
  renderSignals(data);
  connectStages(data);
  connectSchools(data.schools);
  connectDialogs(data);
  $('report').hidden = false;
  $('load-status').hidden = true;
  connectStatCard(data.history);
}

function connectStatCard(history) {
  // Parameters from DesignBookmark's stat.js. The demo springs were defined there,
  // independently of the generic spring tokens shared by the motion gallery.
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
  let metric = 'elevated';
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
