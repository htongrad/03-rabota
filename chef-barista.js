(() => {
  'use strict';

  const modes = {
    learn: 'Осваиваю профессию',
    open: 'Открываю кофейню',
    take: 'Принимаю действующую точку',
    network: 'Управляю несколькими точками',
  };
  const templates = {
    shifts: {
      title: 'Первичная проверка смен',
      items: {
        recipe: 'Смены используют согласованную рецептуру фильтра',
        access: 'На баре доступна действующая версия рецепта',
        records: 'Отклонения в смене фиксируются',
      },
    },
    opening: {
      title: 'Проверка готовности бара',
      items: {
        equipment: 'Работоспособность оборудования проверена',
        stock: 'Сырьё для стартового меню на месте',
        team: 'Команда показала готовность к работе по меню',
      },
    },
  };
  const practice = { id: 'practice', name: 'Учебная кофейня «Центр»', owner: 'Управляющий' };
  const outcomes = { '': 'Выбери результат', pass: 'В порядке', issue: 'Есть отклонение', skip: 'Не применимо' };
  const verdicts = { '': 'Выбери результат', pass: 'Соответствует', retry: 'Нужна ещё одна проверка' };
  const empty = () => ({ mode: '', points: [], audits: [] });
  const validDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const strings = (value, ...fields) => isObject(value) && fields.every(field => typeof value[field] === 'string');
  const id = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  const needsAction = item => item.result === 'issue' && item.action?.checks.at(-1)?.result !== 'pass';
  const pointFor = (state, pointId) => pointId === practice.id ? practice : state.points.find(point => point.id === pointId);
  const standardFields = ['standard', 'version', 'source'];
  const actionFields = ['owner', 'due', 'criterion', ...standardFields];
  const reviewFields = ['result', 'shiftOne', 'shiftTwo', 'evidence', 'nextDue'];
  const validStandard = value => standardFields.every(name => value[name].trim());
  const isDraft = (value, fields) => value === undefined ||
    (isObject(value) && fields.every(name => typeof value[name] === 'string'));

  function validate(state) {
    if (!isObject(state) || (state.mode !== '' && !Object.hasOwn(modes, state.mode)) ||
        !Array.isArray(state.points) || !Array.isArray(state.audits) ||
        !state.points.every(point => strings(point, 'name', 'owner') && id(point.id) && point.name.trim()) ||
        !unique(state.points)) throw Error('Некорректные данные шеф-бариста.');
    for (const audit of state.audits) {
      if (!strings(audit, 'pointId', 'template', 'date') || !id(audit.id) || !pointFor(state, audit.pointId) ||
          !Object.hasOwn(templates, audit.template) || !validDate(audit.date) || typeof audit.finished !== 'boolean' ||
          !Number.isSafeInteger(audit.updatedAt) || !Array.isArray(audit.items)) throw Error('Некорректная проверка.');
      const keys = Object.keys(templates[audit.template].items);
      if (audit.items.length !== keys.length || !audit.items.every((item, index) =>
        strings(item, 'key', 'result', 'note') && item.key === keys[index] && Object.hasOwn(outcomes, item.result) &&
        (!audit.finished || (item.result && (item.result !== 'issue' || item.note.trim()))) &&
        isDraft(item.actionDraft, actionFields) && isDraft(item.reviewDraft, reviewFields))) {
        throw Error('Некорректные результаты проверки.');
      }
      for (const item of audit.items) {
        const action = item.action;
        if (action === null) continue;
        if (!audit.finished || item.result !== 'issue' || !strings(action, ...actionFields) ||
            !action.owner.trim() || !action.criterion.trim() || !validDate(action.due) ||
            typeof action.calendar !== 'boolean' || typeof action.approval !== 'boolean' ||
            (item.key === 'recipe' && !action.approval && !validStandard(action)) ||
            !Array.isArray(action.checks) || !action.checks.every((check, index) =>
              strings(check, 'date', 'result', 'evidence', ...standardFields) && validDate(check.date) &&
              check.evidence.trim() && (check.result === 'retry' ||
                (check.result === 'pass' && index === action.checks.length - 1)))) throw Error('Некорректное действие.');
      }
    }
    if (!unique(state.audits)) throw Error('Повторяющиеся проверки.');
    return state;
  }

  const addMissing = (current, incoming) => {
    const ids = new Set(current.map(row => row.id));
    return [...current, ...incoming.filter(row => !ids.has(row.id))];
  };
  const merge = (current, incoming) => ({
    mode: current.mode || incoming.mode,
    points: addMissing(current.points, incoming.points),
    audits: addMissing(current.audits, incoming.audits),
  });

  function calendarEvents(state) {
    return state.audits.filter(audit => audit.pointId !== practice.id).flatMap(audit => audit.items
      .filter(item => item.action?.calendar)
      .map(item => {
        const action = item.action;
        const title = (action.approval ? 'Согласовать стандарт' : 'Перепроверка') + ' · ' + pointFor(state, audit.pointId).name;
        return {
          id: 'chef:' + audit.id + ':' + item.key, auditId: audit.id, itemKey: item.key,
          title, date: action.due, allDay: true, start: '', end: '', repeat: 'none', ending: 'never', exceptions: {},
        };
      }));
  }

  function attach({ main, escape, hero, showNotice, getState, commit, today, formatDate, render }) {
    let view = { screen: 'home' };
    const changeView = next => {
      view = next;
      showNotice('');
      render();
      window.scrollTo(0, 0);
      main.querySelector('h1')?.focus({ preventScroll: true });
    };
    const go = (screen, auditId, key) => changeView({ screen, auditId, key });
    const auditFor = (state, value) => state.audits.find(audit => audit.id === value);
    const attributes = (screen, target = '', key = '') =>
      `data-chef="${screen}" data-target="${escape(target)}" data-key="${escape(key)}"`;
    const button = (label, screen, target, key, primary = false) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" ${attributes(screen, target, key)}>${escape(label)}</button>`;
    const form = (type, content, submit, back) =>
      `<form data-chef-form="${type}">${content}<div class="chef-controls"><button type="submit" class="action primary">${submit}</button>${back || ''}</div></form>`;
    const help = (label, message) => `<button type="button" class="help" data-hint="${escape(message)}" aria-label="Подсказка: ${escape(label)}" aria-expanded="false"><span aria-hidden="true">?</span></button>`;
    const option = (choices, selected) => Object.entries(choices).map(([key, label]) =>
      `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');
    const input = (label, name, value, required = false, type = 'text', max = 200) => `<label>${label}
      <input name="${name}" type="${type}" value="${escape(value)}"${required ? ' required' : ''}${type === 'text' ? ` maxlength="${max}"` : ''}></label>`;
    const textarea = (label, name, value, required = false) => `<label>${label}
      <textarea name="${name}" rows="2" maxlength="1200"${required ? ' required' : ''}>${escape(value)}</textarea></label>`;
    const select = (label, name, choices, value, required = true) =>
      `<label>${label}<select name="${name}"${required ? ' required' : ''}>${option(choices, value)}</select></label>`;
    const back = (screen = 'home', target = '', key = '', label = 'Назад') => button(label, screen, target, key);
    const heading = (title, sub = '') => hero(title, sub, true).replace('<h1>', '<h1 tabindex="-1">');
    const update = (mutate, next, message) => {
      const state = structuredClone(getState());
      mutate(state);
      if (!commit(state)) return;
      if (next) {
        changeView(next);
        if (message) showNotice(message);
      }
    };
    const pointName = (state, audit) => pointFor(state, audit.pointId).name;
    const forRoute = state => state.audits.filter(audit => (audit.pointId === practice.id) === (state.mode === 'learn'));
    const status = audit => !audit.finished ? 'Черновик' : audit.items.some(needsAction) ? 'Требует действия' :
      audit.items.some(item => item.result === 'issue') ? 'Устранение подтверждено' : 'Проверка завершена';
    const nextAction = state => forRoute(state).flatMap(audit => !audit.finished ? [] :
      audit.items.filter(needsAction).map(item => ({ audit, item }))).sort((a, b) =>
        (a.item.action?.due || '9999').localeCompare(b.item.action?.due || '9999'))[0];
    const record = (text, detail) => `<section class="section chef-stack"><h2>${escape(text)}</h2><p>${escape(detail)}</p></section>`;

    function situation(state) {
      return `${heading('С чего начинаем?')}
        <div class="chef-stack">${Object.entries(modes).map(([key, label]) => button(label, 'choose-mode', key, '', key === state.mode)).join('')}
        ${state.mode ? back() : ''}</div>`;
    }
    function home(state) {
      if (!state.mode) return situation(state);
      const active = nextAction(state);
      const draft = forRoute(state).filter(audit => !audit.finished).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      let recommendation;
      if (active) {
        const { audit, item } = active;
        const action = item.action;
        const label = !action ? 'Назначить действие' : action.approval ? 'Уточнить действующий стандарт' : 'Перепроверить результат';
        const due = action ? ' · ' + (action.due < today() ? 'Просрочено · ' : 'Срок · ') + formatDate(action.due) : '';
        recommendation = `<h2>${label}</h2><small>${escape(pointName(state, audit) + due)}</small><p>${escape(item.note)}</p>
          ${button(label, action && !action.approval ? 'review' : 'action', audit.id, item.key, true)}`;
      } else if (draft) {
        recommendation = `<h2>Продолжить проверку</h2><p>${escape(pointName(state, draft))}</p>
          ${button('Продолжить черновик', 'audit', draft.id, '', true)}`;
      } else if (state.mode === 'learn') {
        const completed = forRoute(state).some(audit => audit.finished);
        recommendation = `<h2>${completed ? 'Практика завершена' : 'Пройти первую практику'}</h2><p>${practice.name}</p>
          ${button(completed ? 'Открыть учебную точку' : 'Начать практику', 'point', practice.id, '', true)}`;
      } else {
        const hasPoints = state.points.length > 0;
        recommendation = `<h2>${hasPoints ? 'Выбрать точку для проверки' : 'Добавить первую точку'}</h2>
          ${button(hasPoints ? 'Открыть точки' : 'Добавить точку', hasPoints ? 'points' : 'point-form', '', '', true)}`;
      }
      return `${heading('Рабочий день', modes[state.mode])}<div class="chef-stack">
        <section class="section chef-stack">${recommendation}</section>
        <section class="section chef-route chef-stack"><h2>Мой маршрут</h2>
        ${progress(state)}${button('Открыть маршрут', 'route')}</section>
        ${button('Точки и инструменты', 'points')}${button('Сменить ситуацию', 'mode')}</div>`;
    }
    function steps(state) {
      const audits = forRoute(state);
      const settled = audits.some(audit => audit.finished && !audit.items.some(needsAction));
      return [
        { title: state.mode === 'learn' ? 'Открыть учебную точку' : 'Добавить точку', done: state.mode === 'learn' || state.points.length > 0 },
        { title: 'Провести проверку', done: audits.some(audit => audit.finished) },
        { title: 'Подтвердить результат', done: settled },
      ];
    }
    function progress(state) {
      const count = steps(state).filter(step => step.done).length;
      return `<progress aria-label="Прогресс маршрута" value="${count}" max="3"></progress><small>Подтверждено ${count} из 3</small>`;
    }
    function route(state) {
      return `${heading('Мой маршрут', modes[state.mode])}<div class="chef-stack">
        <section class="section chef-stack">${progress(state)}<ol>${steps(state).map(step =>
          `<li>${step.title} <small>· ${step.done ? 'Готово' : 'Предстоит'}</small></li>`).join('')}</ol></section>
        ${button('Открыть рабочий день', 'home', '', '', true)}</div>`;
    }
    function points(state) {
      return `${heading('Точки и инструменты')}<div class="chef-stack">
        ${state.points.map(point => button(point.name, 'point', point.id)).join('')}
        ${button('Добавить точку', 'point-form', '', '', true)}
        ${button(practice.name + ' · Практика', 'point', practice.id)}${back()}</div>`;
    }
    function pointPage(state, point) {
      const training = point.id === practice.id;
      const audits = state.audits.filter(audit => audit.pointId === point.id).sort((a, b) => b.updatedAt - a.updatedAt);
      return `${heading(point.name, training ? 'Практика · условные данные' : point.owner || 'Карточка точки')}
        <div class="chef-stack">${training ? record('Задание', 'Две смены готовят фильтр по разным рецептам. Зафиксируй отклонение и проверь исправление.') : ''}
        ${button('Начать проверку', 'new-audit', point.id, '', true)}
        ${training ? '' : button('Изменить карточку', 'point-form', point.id)}
        ${audits.length ? '<h2>История проверок</h2>' : ''}
        ${audits.map(audit => button(formatDate(audit.date) + ' · ' + status(audit), 'audit', audit.id)).join('')}
        ${back('points')}</div>`;
    }
    function auditPage(state, audit) {
      const title = templates[audit.template].title;
      const top = heading(title, pointName(state, audit) + ' · ' + formatDate(audit.date));
      if (!audit.finished) return top + form('audit', `
        <div class="field-help">${input('Дата проверки', 'date', audit.date, true, 'date')}
        ${help('Результаты проверки', 'Если пункт не относится к этой точке, выбери «Не применимо». Для отклонения опиши, что увидел.')}</div>
        ${audit.items.map(item => `<section class="section chef-stack" aria-labelledby="audit-${item.key}"><h2 id="audit-${item.key}">${templates[audit.template].items[item.key]}</h2>
          ${select('Результат', 'result-' + item.key, outcomes, item.result)}
          <div data-observation="${item.key}"${item.result === 'issue' ? '' : ' hidden'}>
          ${textarea('Что обнаружено', 'note-' + item.key, item.note, item.result === 'issue')}</div></section>`).join('')}`,
        'Завершить проверку', back('point', audit.pointId, '', 'Сохранить черновик и выйти'));
      return `${top}<div class="chef-stack"><p class="record">${status(audit)}</p>${audit.items.map(item => `
        <section class="section chef-stack"><h2>${templates[audit.template].items[item.key]}</h2><small>${outcomes[item.result]}</small>
        ${item.result === 'issue' ? `<p>${escape(item.note)}</p>
          ${item.action ? `<p>${escape(item.action.criterion)}</p><small>${escape(item.action.owner)} · ${escape(formatDate(item.action.due))}</small>
          ${item.action.checks.map(check => `<p class="chef-evidence"><strong>${escape(formatDate(check.date))} · ${verdicts[check.result]}</strong><br>${escape(check.evidence)}
          ${check.standard ? `<br><small>${escape([check.standard, check.version, check.source].filter(Boolean).join(' · '))}</small>` : ''}</p>`).join('')}` : ''}
          ${needsAction(item) ? `${button(item.action && !item.action.approval ? 'Перепроверить результат' : item.action ? 'Уточнить стандарт' : 'Назначить действие',
            item.action && !item.action.approval ? 'review' : 'action', audit.id, item.key, true)}
          ${item.action && !item.action.approval ? button('Изменить действие', 'action', audit.id, item.key) : ''}` : ''}` : ''}</section>`).join('')}
        ${back('point', audit.pointId)}</div>`;
    }
    function actionPage(state, audit, item) {
      const action = item.action;
      const recipe = item.key === 'recipe';
      const saved = item.actionDraft;
      const approval = saved?.approval === 'yes' || (!saved && (action?.approval ?? recipe));
      const defaultCriterion = recipe ? 'Обе смены готовят фильтр по согласованной версии.' : templates[audit.template].items[item.key];
      const values = { owner: pointFor(state, audit.pointId).owner, due: today(), criterion: defaultCriterion, ...action, ...saved };
      return `${heading(action ? 'Изменить действие' : 'Назначить действие', pointName(state, audit))}
        ${record('Наблюдение', item.note)}${form('action', `
          ${input('Ответственный', 'owner', values.owner, true)}
          ${input('Срок', 'due', values.due, true, 'date')}
          ${recipe || item.key === 'access' ? select('Действующая версия', 'approval',
            {yes:'Предстоит согласовать', no:'Версия подтверждена'}, approval ? 'yes' : 'no') : ''}
          <div class="chef-stack" data-standard${approval ? ' hidden' : ''}>
          ${input(recipe ? 'Название рецепта' : 'Стандарт', 'standard', values.standard, recipe && !approval)}
          ${input('Версия или дата стандарта', 'version', values.version, recipe && !approval)}
          ${input('Источник стандарта', 'source', values.source, recipe && !approval)}
          </div>
          <div class="field-help">${textarea('Как проверить результат', 'criterion', values.criterion, true)}
          ${help('Критерий проверки', 'Опиши результат, который можно увидеть или измерить при повторной проверке.')}</div>
          ${audit.pointId === practice.id ? '' : `<label class="check"><input name="calendar" type="checkbox"${(saved ? saved.calendar === 'on' : action?.calendar) ? ' checked' : ''}> Показать срок в календаре</label>`}`,
          'Сохранить действие', back('audit', audit.id))}`;
    }
    function reviewPage(state, audit, item) {
      const action = item.action;
      const draft = item.reviewDraft ?? {};
      const recipe = item.key === 'recipe';
      const pending = recipe ? draft.shiftOne === 'retry' || draft.shiftTwo === 'retry' : draft.result === 'retry';
      const results = { '': 'Выбери результат', pass: 'Соответствует', retry: 'Есть отклонение' };
      return `${heading('Повторная проверка', pointName(state, audit))}
        ${record('Ожидаемый результат', action.criterion)}
        ${form('review', `
          ${action.standard ? `<p class="record">${escape([action.standard, action.version, action.source].filter(Boolean).join(' · '))}</p>` : ''}
          ${recipe ? select('Первая смена', 'shiftOne', results, draft.shiftOne) + select('Вторая смена', 'shiftTwo', results, draft.shiftTwo) :
            select('Результат', 'result', verdicts, draft.result)}
          ${textarea('Запись о повторной проверке', 'evidence', draft.evidence, true)}
          <div data-next-due${pending ? '' : ' hidden'}>${input('Срок следующей проверки', 'nextDue', draft.nextDue ?? action.due, pending, 'date')}</div>`,
          'Зафиксировать результат', back('audit', audit.id))}`;
    }
    function draw() {
      const state = getState();
      const audit = auditFor(state, view.auditId);
      const item = audit?.items.find(item => item.key === view.key);
      const point = pointFor(state, view.auditId);
      switch (view.screen) {
        case 'mode': return situation(state);
        case 'route': return route(state);
        case 'points': return points(state);
        case 'point': return point ? pointPage(state, point) : points(state);
        case 'point-form': return heading(point ? 'Изменить точку' : 'Новая точка') + form('point',
          input('Название точки', 'name', point?.name, true, 'text', 120) +
          input('Ответственный на точке', 'owner', point?.owner, false, 'text', 120),
          'Сохранить точку', back(point ? 'point' : 'points', point?.id));
        case 'audit': return audit ? auditPage(state, audit) : home(state);
        case 'action': return item && needsAction(item) ? actionPage(state, audit, item) : home(state);
        case 'review': return item && needsAction(item) && item.action && !item.action.approval ? reviewPage(state, audit, item) : home(state);
        default: return home(state);
      }
    }

    function createAudit(pointId) {
      const state = getState();
      if (!pointFor(state, pointId)) return;
      const template = state.mode === 'open' && pointId !== practice.id ? 'opening' : 'shifts';
      const existing = state.audits.find(audit => !audit.finished && audit.pointId === pointId && audit.template === template);
      if (existing) return go('audit', existing.id);
      const auditId = crypto.randomUUID();
      const training = pointId === practice.id;
      update(next => next.audits.push({
        id: auditId, pointId, template, date: today(), finished: false, updatedAt: Date.now(),
        items: Object.keys(templates[template].items).map(key => ({
          key, result: training && key === 'recipe' ? 'issue' : '',
          note: training && key === 'recipe' ? 'Первая смена использует версию А, вторая — версию Б.' : '', action: null,
        })),
      }), { screen: 'audit', auditId });
    }

    function click(button) {
      const { chef: screen, target, key } = button.dataset;
      if (screen === 'new-audit') return createAudit(target);
      if (screen === 'choose-mode' && Object.hasOwn(modes, target)) {
        return update(state => { state.mode = target; }, { screen: 'home' });
      }
      go(screen, target, key);
    }

    function valuesFor(form) {
      const values = new FormData(form);
      return name => String(values.get(name) ?? '');
    }
    function applyAudit(audit, get) {
      audit.date = validDate(get('date')) ? get('date') : audit.date;
      for (const item of audit.items) {
        item.result = get('result-' + item.key);
        item.note = get('note-' + item.key);
      }
    }
    function adjustFields(form, name) {
      const get = valuesFor(form);
      if (name.startsWith('result-')) {
        const key = name.slice(7);
        const field = form.querySelector('[data-observation="' + key + '"]');
        field.hidden = get(name) !== 'issue';
        const note = field.querySelector('textarea');
        note.required = !field.hidden;
        if (field.hidden) note.setCustomValidity('');
      } else if (name === 'approval') {
        const fields = form.querySelector('[data-standard]');
        fields.hidden = get('approval') === 'yes';
        for (const input of fields.querySelectorAll('input')) {
          input.required = !fields.hidden && view.key === 'recipe';
          if (fields.hidden) input.setCustomValidity('');
        }
      } else if (form.dataset.chefForm === 'review') {
        const fields = form.querySelector('[data-next-due]');
        fields.hidden = !['result', 'shiftOne', 'shiftTwo'].some(field => get(field) === 'retry');
        fields.querySelector('input').required = !fields.hidden;
      }
    }
    function draft(form, field) {
      const type = form.dataset.chefForm;
      if (type === 'point') return;
      field.setCustomValidity('');
      adjustFields(form, field.name);
      const get = valuesFor(form);
      update(state => {
        const audit = auditFor(state, view.auditId);
        if (type === 'audit') {
          applyAudit(audit, get);
          audit.updatedAt = Date.now();
          return;
        }
        const item = audit.items.find(item => item.key === view.key);
        const fields = type === 'action' ? [...actionFields, 'approval', 'calendar'] : reviewFields;
        item[type + 'Draft'] = Object.fromEntries(fields.map(name => [name, get(name)]));
      });
    }
    function requireText(form, get, fields) {
      for (const name of fields) {
        if (get(name).trim()) continue;
        const element = form.elements.namedItem(name);
        element.setCustomValidity('Заполни это поле.');
        element.reportValidity();
        return false;
      }
      return true;
    }
    function submit(form) {
      const type = form.dataset.chefForm;
      const get = valuesFor(form);
      const state = getState();
      if (type === 'point') {
        if (!requireText(form, get, ['name'])) return;
        const existing = state.points.find(point => point.id === view.auditId);
        const point = { id: existing?.id ?? crypto.randomUUID(), name: get('name').trim(), owner: get('owner').trim() };
        return update(next => { next.points = [...next.points.filter(row => row.id !== point.id), point]; },
          { screen: 'point', auditId: point.id }, 'Карточка точки сохранена.');
      }
      const audit = auditFor(state, view.auditId);
      if (!audit) return;
      const item = audit.items.find(item => item.key === view.key);
      const edit = mutate => update(next => {
        const updated = auditFor(next, audit.id);
        mutate(updated, updated.items.find(item => item.key === view.key));
        updated.updatedAt = Date.now();
      }, { screen: 'audit', auditId: audit.id }, 'Запись сохранена.');
      if (type === 'audit' && !audit.finished) {
        if (audit.items.every(item => get('result-' + item.key) === 'skip')) {
          showNotice('Отметь результат хотя бы одного применимого пункта.');
          return;
        }
        if (!requireText(form, get, audit.items.filter(item => get('result-' + item.key) === 'issue').map(item => 'note-' + item.key))) return;
        return edit(updated => { applyAudit(updated, get); updated.finished = true; });
      }
      if (!item || !needsAction(item)) return;
      if (type === 'action') {
        const approval = get('approval') === 'yes';
        if (!requireText(form, get, ['owner', 'criterion', ...(item.key === 'recipe' && !approval ? standardFields : [])])) return;
        const values = Object.fromEntries(actionFields.map(field => [field, get(field).trim()]));
        if (!validDate(values.due)) return;
        return edit((_, updated) => {
          updated.action = { ...values, approval, calendar: audit.pointId !== practice.id && get('calendar') === 'on',
            checks: updated.action?.checks ?? [] };
          delete updated.actionDraft;
        });
      }
      if (type === 'review' && item.action && !item.action.approval && requireText(form, get, ['evidence'])) {
        if (item.key === 'recipe' && !validStandard(item.action)) return;
        const result = item.key === 'recipe' ?
          (get('shiftOne') === 'pass' && get('shiftTwo') === 'pass' ? 'pass' : 'retry') : get('result');
        const nextDue = get('nextDue');
        if (result === 'retry' && !validDate(nextDue)) return;
        return edit((_, updated) => {
          const evidence = item.key === 'recipe' ? 'Первая смена: ' + (get('shiftOne') === 'pass' ? 'соответствует' : 'есть отклонение') +
            '. Вторая смена: ' + (get('shiftTwo') === 'pass' ? 'соответствует' : 'есть отклонение') + '. ' + get('evidence').trim() : get('evidence').trim();
          const standard = Object.fromEntries(standardFields.map(key => [key, item.action[key]]));
          updated.action.checks.push({ date: today(), result, evidence, ...standard });
          if (result === 'retry') updated.action.due = nextDue;
          delete updated.reviewDraft;
        });
      }
    }
    return { draw, click, draft, submit, go, enterAudit(auditId, key) {
      const item = auditFor(getState(), auditId)?.items.find(item => item.key === key);
      go(item && needsAction(item) && item.action?.approval ? 'action' :
        item && needsAction(item) && item.action ? 'review' : 'audit', auditId, key);
    }, reset() { view = { screen: 'home' }; } };
  }

  window.panel03Chef = { empty, validate, merge, calendarEvents, attach };
})();
