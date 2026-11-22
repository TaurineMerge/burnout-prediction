'use strict';

const normalized = value => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
const search = $('people-search');
const school = $('people-school');
const params = new URLSearchParams(location.search);
const period = new URLSearchParams();
for (const key of ['date', 'window']) {
  if (params.has(key)) period.set(key, params.get(key));
}
let people = [];
let model = null;
let scope = params.get('scope') === 'risk' ? 'risk' : 'all';
let order = params.get('sort') === 'risk' ? 'risk' : params.get('sort') === 'name' ? 'name' : scope === 'risk' ? 'risk' : 'name';
const isFlagged = person => person.risk_score !== null && model && person.risk_score >= model.threshold;

function detailLine(main, caption, className) {
  const cell = element('div', undefined, 'person-cell');
  cell.append(element('span', main, className));
  if (caption) cell.append(element('small', caption));
  return cell;
}

const showPeople = createPager('people-pager', 12, (rows, page) => {
  const state = new URLSearchParams(period);
  if (scope === 'risk') state.set('scope', scope);
  if (order !== (scope === 'risk' ? 'risk' : 'name')) state.set('sort', order);
  if (search.value.trim()) state.set('q', search.value.trim());
  if (school.value !== 'all') state.set('school', school.value);
  if (page) state.set('page', page + 1);
  history.replaceState(null, '', state.size ? `/people?${state}` : '/people');

  $('people-rows').replaceChildren(...rows.map(person => {
    const name = person.name || `Педагог ${person.id}`;
    const dossier = new URLSearchParams(state);
    dossier.set('user_id', person.id);
    const link = element('a', name, 'person-name');
    link.href = `/dossier?${dossier}`;
    const identity = element('div', undefined, 'person-cell');
    const affiliation = person.school ?? 'Школа не указана';
    identity.append(link, element('small', person.in_staff ? affiliation : `${affiliation} · Вне штата на дату`));

    const survey = detailLine(person.survey_stage ?? 'Нет ответа', person.survey_in_period ? fmtDate(person.latest_survey.survey_dt) : '', person.survey_stage ? '' : 'muted');
    const flagged = isFlagged(person);
    const score = person.risk_score === null ? '' : `${scoreFormat.format(person.risk_score * 100)} из 100`;
    const assessment = scope === 'risk'
      ? detailLine(score, '', 'flagged-label')
      : detailLine(score ? (flagged ? 'Группа риска' : 'Ниже порога') : 'Нет оценки', score, flagged ? 'flagged-label' : 'muted');
    const row = rowFor(identity, [survey, assessment, element('span', '›', 'person-arrow')]);
    row.lastElementChild.setAttribute('aria-hidden', 'true');
    row.addEventListener('click', event => {
      if (!event.target.closest('a') && !window.getSelection()?.toString()) location.assign(link.href);
    });
    return row;
  }));
});
const scoreFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});

function renderPeople(initialPage = 0) {
  const terms = normalized(search.value).trim().split(/\s+/).filter(Boolean);
  const filtered = terms.length || school.value !== 'all';
  const visible = people.filter(person => (
    (scope === 'all' ? person.in_staff : isFlagged(person)) &&
    (school.value === 'all' || String(person.school_id) === school.value) &&
    terms.every(term => normalized(person.name ?? '').includes(term))
  ));
  visible.sort((a, b) => {
    const byName = (a.name ?? '').localeCompare(b.name ?? '', 'ru');
    return order === 'risk' ? (b.risk_score ?? -1) - (a.risk_score ?? -1) || byName : byName;
  });
  $('all-people').setAttribute('aria-pressed', scope === 'all');
  $('risk-people').setAttribute('aria-pressed', scope === 'risk');
  for (const column of ['name', 'risk']) {
    const header = $(`people-${column}-col`);
    if (column === order) header.setAttribute('aria-sort', column === 'risk' ? 'descending' : 'ascending');
    else header.removeAttribute('aria-sort');
    $(`sort-${column}`).lastElementChild.textContent = column === order ? (column === 'risk' ? '↓' : '↑') : '';
  }
  const hasModel = model?.status === 'available';
  $('sort-risk').disabled = !hasModel;
  txt('people-period', hasModel ? `Оценка модели за ${fmtPeriod(model.week_start, model.week_end)}` : 'На эту дату у модели нет оценки');
  $('clear-people').hidden = !filtered;
  $('people-match').hidden = Boolean(visible.length);
  txt('people-match', filtered ? 'По этим условиям никого не найдено.' : scope === 'risk'
    ? (hasModel ? 'За эту неделю модель никого не отметила.' : 'Выберите «Все педагоги», чтобы открыть список.')
    : 'На эту дату в списке нет педагогов.');
  $('people-table').hidden = !visible.length;
  showPeople(visible, initialPage);
}

async function loadPeople() {
  const back = period.size ? `/?${period}` : '/';
  $('overview-link').href = back;
  $('overview-nav').href = back;
  try {
    const response = await fetch(`/api/people?${period}`);
    if (!response.ok) throw new Error('Не удалось загрузить список. Обновите страницу.');
    const result = await response.json();
    people = result.people;
    model = result.model_risk;
    txt('people-date', `На ${fmtDate(result.date)}`);
    txt('people-window', `${result.survey_window_days} дней`);
    txt('all-count', integer.format(people.filter(person => person.in_staff).length));
    txt('risk-count', model?.status === 'available' ? integer.format(people.filter(isFlagged).length) : '—');

    const schools = new Map(people.filter(person => person.school).map(person => [person.school_id, person.school]));
    for (const [id, name] of [...schools].sort((a, b) => a[1].localeCompare(b[1], 'ru'))) school.add(new Option(name, id));
    search.value = params.get('q') ?? '';
    if (schools.has(Number(params.get('school')))) school.value = params.get('school');

    search.addEventListener('input', () => renderPeople());
    school.addEventListener('change', () => renderPeople());
    $('clear-people').addEventListener('click', () => {
      search.value = '';
      school.value = 'all';
      renderPeople();
      search.focus();
    });
    for (const [id, value] of [['all-people', 'all'], ['risk-people', 'risk']]) {
      $(id).addEventListener('click', () => {
        if (scope === value) return;
        scope = value;
        order = scope === 'risk' ? 'risk' : 'name';
        renderPeople();
      });
    }
    for (const value of ['name', 'risk']) {
      $(`sort-${value}`).addEventListener('click', () => {
        order = value;
        renderPeople();
      });
    }
    $('people-result').hidden = false;
    txt('people-status', '');
    const initialPage = Number(params.get('page'));
    renderPeople(Number.isSafeInteger(initialPage) ? initialPage - 1 : 0);
  } catch (error) {
    txt('people-status', error.message);
  }
}

loadPeople();
