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
function element(tag, content, className) {
  const el = document.createElement(tag);
  if (content !== undefined) el.textContent = content;
  if (className) el.className = className;
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
    render(rows.slice(start, start + size), page);
    status.textContent = rows.length ? `${integer.format(start + 1)}–${integer.format(Math.min(start + size, rows.length))} из ${integer.format(rows.length)}` : '';
    prev.disabled = page === 0;
    next.disabled = page + 1 >= total;
    root.hidden = total <= 1;
  }
  prev.addEventListener('click', () => { page--; refresh(); });
  next.addEventListener('click', () => { page++; refresh(); });
  return (values, initialPage = 0) => {
    rows = values;
    page = Math.max(0, Math.min(initialPage, Math.ceil(rows.length / size) - 1));
    refresh();
  };
}
