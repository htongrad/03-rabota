'use strict';
window.panel03Team = (() => {
  const skills = [
    {id:'prepare', label:'Подготовить рабочее место'},
    {id:'recipe', label:'Приготовить напиток по техкарте'},
    {id:'close', label:'Закрыть смену по чек-листу'},
  ];
  const outcomes = {pass:'Навык подтверждён', practice:'Нужна практика'};
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const latest = (member, skill) => member.adaptation.checks[skill].at(-1);
  const ready = member => Boolean(member.adaptation) && skills.every(({id}) => latest(member,id)?.result === 'pass');
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  const skillName = id => skills.find(skill => skill.id === id).label;

  function validStandard(version) {
    return version && present(version.id) && present(version.title) && instant(version.publishedAt) &&
      present(version.method) && Array.isArray(version.ingredients) && version.ingredients.length > 0 &&
      version.ingredients.every(row => row && present(row.name) && present(row.amount) && present(row.unit));
  }

  function validate(members, points) {
    const ids = new Set(points.map(point => point.id));
    const validAttempt = (attempt, skill) => attempt && present(attempt.id) && instant(attempt.at) && present(attempt.by) &&
      Object.hasOwn(outcomes,attempt.result) && typeof attempt.note === 'string' &&
      (attempt.result !== 'practice' || present(attempt.note)) &&
      (attempt.workId === undefined || (attempt.result === 'practice' && present(attempt.workId))) &&
      (skill === 'recipe' ? validStandard(attempt.standard) : attempt.standard === undefined);

    function validAdaptation(member) {
      const row = member.adaptation;
      return row && instant(row.startedAt) && present(row.mentor) && typeof row.drinkId === 'string' &&
        row.checks && skills.every(({id}) => Array.isArray(row.checks[id]) &&
          row.checks[id].every(attempt => validAttempt(attempt,id)) && unique(row.checks[id])) &&
        (row.admission === undefined || (row.admission && instant(row.admission.at) && present(row.admission.by) && ready(member)));
    }

    return Array.isArray(members) && members.every(member => member && present(member.id) && ids.has(member.pointId) &&
      present(member.name) && present(member.role) && (member.adaptation === undefined || validAdaptation(member))) && unique(members);
  }

  function sourceForWork(members, workId) {
    for (const member of members) {
      if (!member.adaptation) continue;
      for (const {id} of skills) {
        const attempt = member.adaptation.checks[id].find(row => row.workId === workId);
        if (attempt) return {member,skill:id,attempt};
      }
    }
    return null;
  }

  function linkPractice(members, events, {memberId,skill,attemptId}, workId) {
    const member = members.find(row => row.id === memberId);
    const attempts = member?.adaptation?.checks[skill];
    const attempt = attempts?.find(row => row.id === attemptId);
    if (attempt?.result !== 'practice' || events.some(row => row.id === attempt.workId)) return null;
    const checks = {...member.adaptation.checks, [skill]:attempts.map(row => row.id === attemptId ? {...row,workId} : row)};
    return members.map(row => row.id === member.id ? {...row,adaptation:{...row.adaptation,checks}} : row);
  }

  function create({records, hero, escape, effective, getMain, commit, redraw, exit, newWork, openWork}) {
    const date = new Intl.DateTimeFormat('ru', {dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
    const stamp = value => date.format(new Date(value));
    const action = (name, label, {primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-team-action="${name}" ${data}>${label}</button>`;
    const ref = (name, value) => `data-${name}="${escape(value)}"`;
    const back = (name, label) => `<button type="button" class="back" data-team-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const members = () => records().team ?? [];
    const point = () => records().points.find(row => row.id === pointId);
    const member = () => members().find(row => row.id === memberId);
    const work = id => records().events.find(row => row.id === id);
    const recipes = () => (records().recipes ?? []).filter(row => effective(row,pointId));
    const recipeTitle = row => row.name + ' ' + row.volumeMl + ' мл';
    const now = () => new Date().toISOString();
    const errorMessage = '<p class="notice audit-error" role="alert" hidden></p>';
    let pointId, memberId, screen, skill, attemptId, standard, standardFrom, draft;

    function open(id, personId, source) {
      pointId = id;
      memberId = personId;
      screen = personId ? 'member' : 'list';
      if (source) {
        skill = source.skill;
        attemptId = source.attempt.id;
        screen = 'attempt';
      }
    }

    function show(next, message) {
      screen = next;
      redraw(message);
    }

    function store(updated) {
      return commit(member() ? members().map(row => row.id === updated.id ? updated : row) : [...members(),updated]);
    }

    function badge(row) {
      if (row.adaptation?.admission) return 'Допуск оформлен';
      if (ready(row)) return 'Готов к допуску';
      return row.adaptation ? 'В процессе адаптации' : 'Адаптация не назначена';
    }

    function list() {
      const rows = members().filter(row => row.pointId === pointId).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
      return `${back('point','Карточка точки')}${hero('Команда',point().name,true)}
        <div class="audit-layout">
          ${action('add','Добавить сотрудника',{primary:true})}
          ${rows.length ? `<div class="audit-list">${rows.map(row => action('member',
            `<strong>${escape(row.name)}</strong><small>${escape(row.role)} · ${badge(row)}</small>`, {data:ref('member-id',row.id)})).join('')}</div>`
            : '<p class="empty">В команде пока нет сотрудников.</p>'}
        </div>`;
    }

    function memberForm() {
      const row = member();
      return `${back(row ? 'card' : 'list',row ? 'К сотруднику' : 'Команда')}
        ${hero(row ? 'Карточка сотрудника' : 'Новый сотрудник',point().name,true)}
        <form data-form="team-member">
          <label>Имя<input name="name" maxlength="120" value="${escape(row?.name)}" required></label>
          <label>Роль<input name="role" maxlength="80" value="${escape(row?.role ?? 'Бариста')}" required></label>
          ${errorMessage}${submit('Сохранить сотрудника')}
        </form>`;
    }

    function assignment() {
      const row = member();
      const choices = recipes();
      const current = row.adaptation;
      const selected = current?.drinkId ?? (choices.length === 1 ? choices[0].id : '');
      return `${back('card','К сотруднику')}${hero('Адаптация бариста',row.name + ' · ' + point().name,true)}
        <form data-form="team-assign">
          <label>Наставник<input name="mentor" maxlength="120" value="${escape(current?.mentor ?? point().owner)}" required></label>
          <label>Напиток для практики<select name="drinkId">
            <option value="">Выбрать позже</option>
            ${choices.map(item => `<option value="${escape(item.id)}"${item.id === selected ? ' selected' : ''}>${escape(recipeTitle(item))}</option>`).join('')}
          </select></label>
          ${choices.length ? '' : '<p class="empty">Для практики нужна действующая техкарта. Её можно добавить во вкладке «Меню».</p>'}
          <section class="section"><h2>Обязательные навыки</h2><ul>${skills.map(item => `<li>${item.label}</li>`).join('')}</ul></section>
          ${errorMessage}${submit(current ? 'Сохранить программу' : 'Начать адаптацию')}
        </form>`;
    }

    function card() {
      const row = member();
      if (!row.adaptation) return `${back('list','Команда')}${hero(row.name,point().name + ' · ' + row.role,true)}
        <div class="audit-layout">${action('assign','Назначить адаптацию',{primary:true})}${action('edit','Изменить сотрудника')}</div>`;
      const plan = row.adaptation;
      const count = skills.filter(({id}) => latest(row,id)?.result === 'pass').length;
      const next = skills.find(({id}) => latest(row,id)?.result !== 'pass');
      const drink = recipes().find(item => item.id === plan.drinkId);
      return `${back('list','Команда')}${hero(row.name,point().name + ' · ' + row.role,true)}
        <div class="audit-layout">
          <section class="section"><h2>Адаптация бариста</h2><p>Наставник: ${escape(plan.mentor)}</p>
            ${plan.admission ? `<p><strong>Допуск оформлен</strong> · ${escape(stamp(plan.admission.at))}<br>${escape(plan.admission.by)}</p>` : ''}</section>
          <section class="section audit-layout"><h2>Подтверждено навыков: ${count} из ${skills.length}</h2>
            <ul class="audit-results">${skills.map(({id,label}) => {
              const checked = latest(row,id);
              const title = id === 'recipe' && drink ? 'Приготовить ' + recipeTitle(drink) + ' по техкарте' : label;
              return `<li class="audit-result"><div class="audit-result-title">
                <strong>${escape(title)}</strong><span class="audit-status" data-outcome="${checked?.result === 'practice' ? 'issue' : checked?.result ?? ''}">${checked ? outcomes[checked.result] : 'Ожидает проверки'}</span>
              </div>${checked?.result !== 'pass' ? action('check','Проверить навык',{data:ref('skill-id',id)}) : ''}</li>`;
            }).join('')}</ul>
          </section>
          ${plan.admission ? '' : next ? action('check','Продолжить адаптацию',{primary:true,data:ref('skill-id',next.id)}) :
            action('admit','Оформить допуск',{primary:true})}
          ${action('history','История проверок')}
          ${!plan.admission && latest(row,'recipe')?.result !== 'pass' ? action('assign','Настроить программу') : ''}
          ${action('edit','Изменить сотрудника')}
        </div>`;
    }

    function checkScreen() {
      const row = member();
      return `${back('card','К сотруднику')}${hero('Проверка навыка',row.name + ' · ' + point().name,true)}
        ${skill === 'recipe' && !standard ? `<div class="audit-layout"><p class="empty">Выбери напиток с действующей техкартой для этой точки.</p>
          ${action('assign','Выбрать напиток',{primary:true})}</div>` :
        `<form data-form="team-check">
          <section class="section audit-layout"><h2>${escape(skillName(skill))}</h2>
            ${standard ? `<p>${escape(standard.title)}</p>${action('check-standard','Открыть действующую техкарту')}` : ''}</section>
          <fieldset class="audit-options"><legend>Результат</legend><div>${Object.entries(outcomes).map(([id,label]) =>
            `<label><input type="radio" name="result" value="${id}"${draft.result === id ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
          <label>Кто проверил<input name="by" value="${escape(draft.by)}" maxlength="120" required></label>
          <label>Комментарий наставника<textarea name="note" maxlength="1200" rows="3">${escape(draft.note)}</textarea></label>
          ${errorMessage}${submit('Сохранить проверку')}
        </form>`}`;
    }

    function readAttempt(form) {
      const values = new FormData(form);
      const get = name => String(values.get(name) ?? '').trim();
      return {result:get('result'),by:get('by'),note:get('note')};
    }

    function openCheck(id) {
      skill = id;
      const plan = member().adaptation;
      const item = skill === 'recipe' && recipes().find(row => row.id === plan.drinkId);
      const version = item && effective(item,pointId);
      standard = version ? {id:version.id,title:recipeTitle(item),publishedAt:version.publishedAt,
        ingredients:version.ingredients,method:version.method} : null;
      draft = {result:'',by:plan.mentor,note:''};
      show('check');
    }

    function showStandard(version, from) {
      standard = version;
      standardFrom = from;
      show('standard');
    }

    function standardScreen() {
      const label = standardFrom === 'check' ? 'К проверке' : 'К результату';
      return `${back('standard-back',label)}${hero(standard.title,'Техкарта · ' + point().name,true)}
        <div class="audit-layout"><p>Версия от ${escape(stamp(standard.publishedAt))}</p>
        <section class="section"><h2>Состав на порцию</h2><ul class="recipe-composition">${standard.ingredients.map(row =>
          `<li><span>${escape(row.name)}</span><strong>${escape(row.amount.replace('.',','))} ${escape(row.unit)}</strong></li>`).join('')}</ul></section>
        <section class="section"><h2>Порядок приготовления</h2><p class="record">${escape(standard.method)}</p></section></div>`;
    }

    function history() {
      const row = member();
      const attempts = skills.flatMap(({id}) => row.adaptation.checks[id].map(attempt => ({...attempt,skill:id})))
        .sort((a,b) => b.at.localeCompare(a.at));
      return `${back('card','К сотруднику')}${hero('История проверок',row.name,true)}
        ${attempts.length ? `<div class="audit-list">${attempts.map(attempt => action('attempt',
          `<strong>${escape(skillName(attempt.skill))}</strong><small>${outcomes[attempt.result]} · ${escape(stamp(attempt.at))}</small>`,
          {data:ref('attempt-id',attempt.id) + ' ' + ref('skill-id',attempt.skill)})).join('')}</div>` :
          '<p class="empty">Проверок пока нет.</p>'}`;
    }

    function attemptScreen() {
      const row = member();
      const attempt = row.adaptation.checks[skill].find(item => item.id === attemptId);
      const linked = work(attempt.workId);
      const canPractice = attempt.result === 'practice' && !row.adaptation.admission && latest(row,skill).id === attemptId;
      return `${back('history','История проверок')}${hero(outcomes[attempt.result],row.name + ' · ' + point().name,true)}
        <div class="audit-layout">
          <section class="section audit-layout"><h2>${escape(skillName(skill))}</h2><p>${escape(attempt.by)} · ${escape(stamp(attempt.at))}</p>
            ${attempt.note ? `<p class="record">${escape(attempt.note)}</p>` : ''}
            ${attempt.standard ? action('attempt-standard','Техкарта на момент проверки') : ''}</section>
          ${linked ? action('work','Открыть дело по практике',{data:ref('work-id',linked.id)}) : canPractice ?
            action('practice','Назначить практику в «Делах»',{primary:true}) : ''}
          ${canPractice ? action('check','Повторить проверку',{data:ref('skill-id',skill)}) : ''}
          ${action('card','К сотруднику')}
        </div>`;
    }

    function admission() {
      const row = member();
      return `${back('card','К сотруднику')}${hero('Допуск к смене',row.name + ' · ' + point().name,true)}
        <form data-form="team-admit">
          <section class="section"><h2>Все обязательные навыки подтверждены</h2><ul>${skills.map(item => `<li>${item.label}</li>`).join('')}</ul></section>
          <label>Кто подтверждает допуск<input name="by" maxlength="120" value="${escape(row.adaptation.mentor)}" required></label>
          ${errorMessage}${submit('Зафиксировать допуск')}
        </form>`;
    }

    function draw() {
      if (screen === 'list') return list();
      if (screen === 'edit') return memberForm();
      if (screen === 'assign') return assignment();
      if (screen === 'check') return checkScreen();
      if (screen === 'standard') return standardScreen();
      if (screen === 'history') return history();
      if (screen === 'attempt') return attemptScreen();
      if (screen === 'admit') return admission();
      return card();
    }

    function warn(form, message, field) {
      const notice = form.querySelector('[role=alert]');
      notice.textContent = message;
      notice.hidden = false;
      field?.focus();
    }

    function submitForm(form) {
      const values = new FormData(form);
      const get = name => String(values.get(name) ?? '').trim();
      const row = member();
      if (screen === 'edit') {
        const name = get('name'), role = get('role');
        if (!name || !role) return warn(form,'Заполни имя и роль.',form.elements[name ? 'role' : 'name']);
        const updated = {...row,id:row?.id ?? crypto.randomUUID(),pointId,name,role};
        if (!store(updated)) return;
        memberId = updated.id;
        return show('member','Карточка сохранена.');
      }
      if (screen === 'assign') {
        const mentor = get('mentor'), drinkId = get('drinkId');
        if (!mentor) return warn(form,'Укажи наставника.',form.elements.mentor);
        const initial = {startedAt:now(),checks:Object.fromEntries(skills.map(({id}) => [id,[]]))};
        if (store({...row,adaptation:{...(row.adaptation ?? initial),mentor,drinkId}})) show('member','Программа сохранена.');
        return;
      }
      if (screen === 'check') {
        const values = readAttempt(form);
        if (!values.result) return warn(form,'Выбери результат проверки.',form.querySelector('input[name=result]'));
        if (!values.by) return warn(form,'Укажи, кто проверил навык.',form.elements.by);
        if (values.result === 'practice' && !values.note) return warn(form,'Укажи, что нужно отработать.',form.elements.note);
        if (row.adaptation.admission || (skill === 'recipe' && !standard)) return;
        const attempt = {...values,id:crypto.randomUUID(),at:now(),...(standard ? {standard} : {})};
        const checks = {...row.adaptation.checks,[skill]:[...row.adaptation.checks[skill],attempt]};
        if (!store({...row,adaptation:{...row.adaptation,checks}})) return;
        attemptId = attempt.id;
        show(values.result === 'practice' ? 'attempt' : 'member','Проверка сохранена.');
        return;
      }
      if (screen === 'admit' && ready(row) && !row.adaptation.admission) {
        const by = get('by');
        if (!by) return warn(form,'Укажи, кто подтверждает допуск.',form.elements.by);
        if (store({...row,adaptation:{...row.adaptation,admission:{by,at:now()}}})) show('member','Допуск оформлен.');
      }
    }

    function click(button) {
      const data = button.dataset;
      const name = data.teamAction;
      if (name === 'point') return exit(point());
      if (name === 'list') return show('list');
      if (name === 'member') {
        memberId = data.memberId;
        return show('member');
      }
      if (name === 'add') {
        memberId = null;
        return show('edit');
      }
      if (name === 'card') return show('member');
      if (['edit','assign','history'].includes(name)) return show(name);
      if (name === 'check') return openCheck(data.skillId);
      if (name === 'admit' && ready(member()) && !member().adaptation.admission) return show('admit');
      if (name === 'attempt') {
        skill = data.skillId;
        attemptId = data.attemptId;
        return show('attempt');
      }
      if (name === 'work') return openWork(data.workId);
      if (name === 'check-standard') {
        draft = readAttempt(getMain().querySelector('[data-form=team-check]'));
        return showStandard(standard,'check');
      }
      if (name === 'attempt-standard') {
        const attempt = member().adaptation.checks[skill].find(row => row.id === attemptId);
        return showStandard(attempt.standard,'attempt');
      }
      if (name === 'standard-back') return show(standardFrom);
      if (name === 'practice') {
        const row = member();
        const title = 'Практика · ' + row.name + ' · ' + skillName(skill);
        return newWork({memberId,skill,attemptId}, row.pointId, title.slice(0,200), row.adaptation.mentor);
      }
    }

    return {open,draw,submit:submitForm,click};
  }

  return {create, validate, linkPractice, sourceForWork, skillName};
})();
