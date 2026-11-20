'use strict';

const normalized = value => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
const search = $('people-search');
const school = $('people-school');
const sort = $('people-sort');
let people = [];

const showPeople = createPager('people-pager', 12, rows => {
  $('people-rows').replaceChildren(...rows.map(person => {
    const link = element('a', person.name || `Педагог ${person.id}`);
    link.href = `/classic?user_id=${encodeURIComponent(person.id)}#teacher`;
    const risk = person.risk_score === null ? '—' : integer.format(Math.round(person.risk_score * 100));
    return rowFor(link, [person.school ?? '—', person.survey_stage ?? 'Нет ответа', person.fte === null ? '—' : decimal.format(person.fte), risk]);
  }));
});

function renderPeople() {
  const terms = normalized(search.value).trim().split(/\s+/).filter(Boolean);
  const visible = people.filter(person => {
    const name = normalized(person.name || '');
    return terms.every(term => name.includes(term)) && (school.value === 'all' || String(person.school_id) === school.value);
  });
  visible.sort((a, b) => {
    const byName = (a.name || '').localeCompare(b.name || '', 'ru');
    return sort.value === 'risk' ? (b.risk_score ?? -1) - (a.risk_score ?? -1) || byName : byName;
  });
  txt('people-status', visible.length ? '' : 'По этим условиям никого не найдено.');
  $('people-table').hidden = !visible.length;
  showPeople(visible);
}

async function loadPeople() {
  const params = new URLSearchParams(window.location.search);
  const back = params.size ? `/?${params}` : '/';
  $('overview-link').href = back;
  $('overview-nav').href = back;
  try {
    const response = await fetch(`/api/overview/review?${params}`);
    if (response.status === 404) {
      txt('people-status', 'На эту дату нет оценки модели.');
      return;
    }
    if (!response.ok) throw new Error('Не удалось загрузить список.');
    const result = await response.json();
    people = result.people;
    const risk = result.model_risk;
    txt('people-period', `Группа риска · ${fmtPeriod(risk.week_start, risk.week_end)} · ${people.length} чел.`);
    const schools = new Map(people.filter(person => person.school_id !== null && person.school).map(person => [person.school_id, person.school]));
    for (const [id, name] of [...schools].sort((a, b) => a[1].localeCompare(b[1], 'ru'))) {
      school.add(new Option(name, id));
    }
    search.addEventListener('input', renderPeople);
    school.addEventListener('change', renderPeople);
    sort.addEventListener('change', renderPeople);
    $('people-result').hidden = false;
    renderPeople();
  } catch (error) {
    txt('people-status', error.message);
  }
}

loadPeople();
