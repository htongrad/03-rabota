(() => {
  'use strict';

  const taskStatuses = {open:'К выполнению', waiting:'Ожидает', done:'Готово'};
  const filters = {active:'Активные', waiting:'Ожидают', done:'Готово'};
  const frequencies = {none:'', daily:'', weekdays:'', weekly:'', monthly:'', yearly:''};
  const emptyWork = {pointId:'', owner:'', status:'open', result:''};

  function validLegacyTasks(tasks, points, fields, date) {
    const ids = new Set(points.map(point => point.id));
    const fieldIds = new Set(fields.map(field => field.id));
    const text = value => typeof value === 'string';
    const valuesValid = values => values === undefined || (values && typeof values === 'object' &&
      !Array.isArray(values) && Object.entries(values).every(([id, value]) => fieldIds.has(id) && text(value)));
    const repeatValid = (repeat, due) => repeat === undefined || (repeat && date(due) && date(repeat.anchor) &&
      text(repeat.seriesId) && repeat.seriesId && Number.isSafeInteger(repeat.sequence) && repeat.sequence >= 0 &&
      text(repeat.frequency) && Object.hasOwn(frequencies, repeat.frequency) && repeat.frequency !== 'none' && typeof repeat.advanced === 'boolean' &&
      (repeat.until === '' || date(repeat.until)) && (repeat.advanced ||
        (repeat.anchor <= due && (!repeat.until || repeat.until >= due))));
    return Array.isArray(tasks) && tasks.every(task => task && text(task.id) && task.id && text(task.title) &&
      task.title.trim() && (task.pointId === '' || ids.has(task.pointId)) && (task.due === '' || date(task.due)) &&
      text(task.owner) && text(task.status) && Object.hasOwn(taskStatuses, task.status) && text(task.result) &&
      valuesValid(task.values) && repeatValid(task.repeat, task.due)) &&
      new Set(tasks.map(task => task.id)).size === tasks.length;
  }

  function validWork(work, points, fields) {
    const ids = new Set(fields.map(field => field.id));
    return work && (work.pointId === '' || points.some(point => point.id === work.pointId)) &&
      typeof work.owner === 'string' && validProgress(work) &&
      (work.values === undefined || (work.values && typeof work.values === 'object' && !Array.isArray(work.values) &&
        Object.entries(work.values).every(([id, value]) => ids.has(id) && typeof value === 'string')));
  }

  function validProgress(state) {
    return state && typeof state.status === 'string' && Object.hasOwn(taskStatuses, state.status) &&
      typeof state.result === 'string';
  }

  function migrate(events, tasks) {
    const used = new Set(events.map(event => event.id));
    const latest = new Map();
    for (const task of tasks) {
      const repeat = task.repeat;
      if (!repeat || repeat.advanced || task.status === 'done') continue;
      const current = latest.get(repeat.seriesId);
      if (!current || current.repeat.sequence < repeat.sequence) latest.set(repeat.seriesId, task);
    }
    return events.concat(tasks.map(task => {
      const repeat = latest.get(task.repeat?.seriesId) === task ? task.repeat : null;
      let id = 'task:' + task.id;
      while (used.has(id)) id = 'task:' + id;
      used.add(id);
      const work = {pointId:task.pointId, owner:task.owner, status:task.status, result:task.result};
      if (task.values) work.values = task.values;
      const item = {id, legacyTaskId:task.id, title:task.title, date:task.due, allDay:true, start:'', end:'',
        repeat:repeat?.frequency ?? 'none', ending:repeat?.until ? 'date' : 'never', until:repeat?.until ?? '',
        exceptions:{}, work};
      if (repeat && (work.status !== 'open' || work.result)) {
        item.workLog = {[item.date]:{status:work.status, result:work.result}};
        item.work = {...work, status:'open', result:''};
      }
      return item;
    }));
  }

  function workFor(record, entry, slot) {
    const work = entry?.work ?? record.work ?? emptyWork;
    return record.workLog?.[slot] ? {...work, ...record.workLog[slot]} : work;
  }

  const scopeKey = pointId => pointId ? 'point:' + pointId : 'network';
  const scopePoint = key => key.startsWith('point:') ? key.slice(6) : '';

  function mount({records, rows, save, redraw, goBack, hero, escape, optionList, formatDate, today, main}) {
    let screen = 'list';
    let scope = 'all';
    let filter = 'active';
    let origin = '';
    let fieldId = '';
    const taskFields = () => records().taskFields ?? [];
    const selectedField = () => taskFields().find(field => field.id === fieldId);
    const point = id => records().points.find(item => item.id === id);
    const scopeName = id => point(id)?.name ?? 'Вся сеть';
    const scopeChoices = () => Object.fromEntries([['network','Вся сеть'],
      ...records().points.map(point => [scopeKey(point.id), point.name])]);
    const action = (name, label, primary = false) => `<button type="button" data-task-action="${name}" class="action${primary ? ' primary' : ''}">${label}</button>`;

    function open(pointId = '') {
      origin = pointId;
      scope = pointId ? scopeKey(pointId) : 'all';
      filter = 'active';
      fieldId = '';
      screen = 'list';
    }

    function list() {
      const items = rows().filter(({work}) => (scope === 'all' || scopeKey(work.pointId) === scope) &&
        (filter === 'active' ? work.status !== 'done' : work.status === filter));
      items.sort((a, b) => (a.entry.date || '9999').localeCompare(b.entry.date || '9999') ||
        (a.entry.start ?? '').localeCompare(b.entry.start ?? ''));
      const empty = {active:'Нет активных дел.', waiting:'Нет дел в ожидании.', done:'Нет завершённых дел.'};
      return `${hero('Дела', 'Кофейное направление', true)}
        <label class="task-scope">Область<select data-task-scope>${optionList({'all':'Все точки и сеть', ...scopeChoices()}, scope)}</select></label>
        <div class="periods" role="group" aria-label="Состояние дел">${Object.entries(filters).map(([key, label]) =>
          `<button type="button" data-task-action="filter" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div>
        ${items.length ? `<div class="task-list">${items.map(({record, slot, entry, work}) => `
          <button type="button" class="section task-row" data-event="${escape(record.id)}" data-slot="${slot}">
            <strong>${escape(entry.title)}</strong><small>${escape(scopeName(work.pointId))} ·
              ${entry.date ? escape(formatDate(entry.date)) + (entry.allDay ? ' · Весь день' : ' · ' + escape(entry.start)) : 'Без даты'}</small>
            <span class="task-badges"><span class="task-badge">${taskStatuses[work.status]}</span>
              ${entry.date && entry.date < today() && work.status !== 'done' ? '<span class="task-badge task-overdue">Просрочено</span>' : ''}</span>
          </button>`).join('')}</div>` : `<p class="empty">${empty[filter]}</p>`}
        <div class="controls point-controls">${action('exit', origin ? 'Назад к точке' : 'Назад к обзору')}</div>`;
    }

    function fieldList() {
      return `${hero('Поля дел', 'Дела', true)}
        <section class="section point-settings-section"><h2>Дополнительные поля</h2>
          ${taskFields().map(field => `<button type="button" class="action" data-task-action="edit-field" data-field-id="${escape(field.id)}">
            ${escape(field.label)}${field.archived ? ' · в архиве' : ''}</button>`).join('')}
          ${action('new-field','Добавить поле',true)}</section>
        <div class="controls point-controls">${action('list','Назад к делам')}</div>`;
    }
    function fieldForm(field) {
      return `${hero(field ? 'Изменить поле' : 'Новое поле', 'Поля дел', true)}
        <form data-form="task-field">
          <label>Название<input name="label" maxlength="80" value="${escape(field?.label)}" required></label>
          <label>Всплывающая подсказка · по желанию<textarea name="hint" rows="3" maxlength="240">${escape(field?.hint)}</textarea></label>
          <div class="controls point-controls"><button type="submit" class="action primary">Сохранить поле</button>
            ${field ? action('archive-field',field.archived ? 'Вернуть из архива' : 'В архив') : ''}
            ${action('fields','Назад к полям')}</div>
          ${field && !field.archived ? '<small>Архивирование скрывает поле. Значения снова будут видны после его возврата.</small>' : ''}
        </form>`;
    }
    function draw() {
      if (screen === 'fields') return fieldList();
      if (screen === 'field') return fieldForm(selectedField());
      return list();
    }
    function saveField(field, message) {
      const fields = taskFields();
      const next = fieldId ? fields.map(item => item.id === field.id ? field : item) : [...fields, field];
      if (!save({taskFields:next})) return;
      screen = 'fields';
      redraw(message);
    }
    function click(name, button) {
      switch (name) {
        case 'exit': return goBack(origin);
        case 'fields': screen = 'fields'; break;
        case 'new-field': fieldId = ''; screen = 'field'; break;
        case 'edit-field': fieldId = button.dataset.fieldId; screen = 'field'; break;
        case 'archive-field': {
          const field = selectedField();
          if (field) return saveField({...field, archived:!field.archived}, field.archived ? 'Поле возвращено из архива.' : 'Поле перемещено в архив.');
          return;
        }
        case 'list': screen = 'list'; break;
        case 'filter': {
          const key = button.dataset.filter;
          if (!Object.hasOwn(filters, key)) return;
          filter = key;
          redraw(undefined, false);
          main.querySelector('[data-filter="' + key + '"]')?.focus({preventScroll:true});
          return;
        }
        default: return;
      }
      redraw();
    }
    function change(control) {
      if (!control.hasAttribute('data-task-scope')) return;
      scope = control.value;
      redraw(undefined, false);
      main.querySelector('[data-task-scope]')?.focus({preventScroll:true});
    }
    function submit(form, get) {
      if (form.dataset.form !== 'task-field') return;
      const label = get('label').trim();
      const used = ['Что нужно сделать','Название','Дата','Начало','Окончание','Область','Срок','Сделать до',
        'Повтор','Ответственный','Результат','Состояние',
        ...taskFields().filter(item => item.id !== fieldId).map(item => item.label)];
      if (!label || used.some(value => label.localeCompare(value, 'ru', {sensitivity:'base'}) === 0)) {
        form.elements.label.setCustomValidity(!label ? 'Введите название.' : 'Это название уже используется.');
        form.elements.label.reportValidity();
        return;
      }
      saveField({id:fieldId || crypto.randomUUID(), label, hint:get('hint').trim(),
        archived:selectedField()?.archived ?? false}, 'Поле сохранено.');
    }
    return {open, isList:() => screen === 'list', createPoint:() => scopePoint(scope), scopeChoices,
      scopeName, draw, click, change, submit};
  }
  window.panel03WorkItems = {taskStatuses, emptyWork, scopeKey, scopePoint, validLegacyTasks, validWork, validProgress, migrate, workFor, mount};
})();
