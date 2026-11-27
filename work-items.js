(() => {
  'use strict';

  const taskStatuses = {open:'К выполнению', waiting:'Ожидает', done:'Готово'};
  const filters = {active:'Активные', waiting:'Ожидают', done:'Готово'};
  const frequencies = {none:'Без повтора', daily:'Ежедневно', weekdays:'По будням',
    weekly:'Еженедельно', monthly:'Ежемесячно', yearly:'Ежегодно'};
  const dayMs = 86400000;
  const asDay = key => new Date(key + 'T00:00:00Z');
  function dayKey(day) {
    return Number.isFinite(+day) && day.getUTCFullYear() <= 9999 ? day.toISOString().slice(0, 10) : '';
  }
  const moveDay = (day, distance) => new Date(+day + distance * dayMs);
  function nextDate(repeat, due, today) {
    const threshold = new Date(Math.max(+asDay(due), +moveDay(asDay(today), -1)));
    const anchor = asDay(repeat.anchor);
    let next = moveDay(threshold, 1);
    if (repeat.frequency === 'weekdays') {
      while ([0,6].includes(next.getUTCDay())) next = moveDay(next, 1);
    } else if (repeat.frequency === 'weekly') {
      const weeks = Math.floor((threshold - anchor) / (7 * dayMs)) + 1;
      next = moveDay(anchor, weeks * 7);
    } else if (repeat.frequency === 'monthly' || repeat.frequency === 'yearly') {
      const step = repeat.frequency === 'monthly' ? 1 : 12;
      const months = (threshold.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
        threshold.getUTCMonth() - anchor.getUTCMonth();
      const monthDate = index => {
        const day = new Date(+anchor);
        day.setUTCMonth(anchor.getUTCMonth() + index, 1);
        const last = new Date(+day);
        last.setUTCMonth(last.getUTCMonth() + 1, 0);
        day.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
        return day;
      };
      const index = Math.floor(months / step) * step;
      next = monthDate(index);
      if (next <= threshold) next = monthDate(index + step);
    }
    const date = dayKey(next);
    return date && (!repeat.until || date <= repeat.until) ? date : '';
  }
  const scopeKey = pointId => pointId ? 'point:' + pointId : 'network';
  const scopePoint = key => key.startsWith('point:') ? key.slice(6) : '';
  const overdue = (task, day) => task.status !== 'done' && Boolean(task.due && task.due < day);

  function validTasks(tasks, points, fields, date) {
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

  function mount({records, save, redraw, goBack, today, formatDate, hero, escape, optionList, hint, main}) {
    let screen = 'list';
    let scope = 'all';
    let filter = 'active';
    let origin = '';
    let taskId = '';
    let fieldId = '';
    let fromCalendar = false;
    const taskFields = () => records().taskFields ?? [];
    const visibleFields = () => taskFields().filter(field => !field.archived);
    const selectedField = () => taskFields().find(field => field.id === fieldId);
    const point = id => records().points.find(point => point.id === id);
    const scopeName = id => point(id)?.name ?? 'Вся сеть';
    const selectedTask = () => records().tasks.find(task => task.id === taskId);
    const scopeChoices = () => Object.fromEntries([['network','Вся сеть'],
      ...records().points.map(point => [scopeKey(point.id), point.name])]);
    const action = (name, label, primary = false) =>
      `<button type="button" data-task-action="${name}" class="action${primary ? ' primary' : ''}">${label}</button>`;
    const badge = (label, late = false) => `<span class="task-badge${late ? ' task-overdue' : ''}">${label}</span>`;
    const taskBadges = task => badge(taskStatuses[task.status]) + (overdue(task, today()) ? badge('Просрочено', true) : '');
    const dueText = task => task.due ? 'Сделать до ' + formatDate(task.due) : 'Без срока';
    const repeatText = task => task.repeat ? frequencies[task.repeat.frequency] : '';
    const canChangeRepeat = task => task?.status !== 'done' && !task?.repeat?.advanced;

    function overview() {
      const tasks = records().tasks;
      const late = tasks.filter(task => overdue(task, today())).length;
      const waiting = tasks.filter(task => task.status === 'waiting').length;
      const open = tasks.filter(task => task.status !== 'done').length;
      return `<section class="section task-summary"><h2>Дела</h2>
        <div class="task-badges">${late ? badge('Просрочено: ' + late, true) : ''}
        ${waiting ? badge('Ожидают: ' + waiting) : ''}
        ${!late && !waiting ? `<small>${open ? 'Активных дел: ' + open : 'Нет активных дел'}</small>` : ''}</div>
        <button type="button" class="action primary" data-action="open-tasks">Открыть дела</button></section>`;
    }

    function open(pointId = '', deadlineId = '') {
      origin = pointId;
      scope = pointId ? scopeKey(pointId) : 'all';
      filter = 'active';
      fromCalendar = Boolean(deadlineId);
      taskId = deadlineId;
      screen = fromCalendar ? 'card' : 'list';
    }

    function list() {
      const options = {'all':'Все точки и сеть', ...scopeChoices()};
      const tasks = records().tasks.filter(task => (scope === 'all' || scopeKey(task.pointId) === scope) &&
        (filter === 'active' ? task.status !== 'done' : task.status === filter));
      tasks.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const empty = {active:'Нет активных дел.', waiting:'Нет дел в ожидании.', done:'Нет завершённых дел.'};
      return `${hero('Дела', 'Кофейное направление', true)}
        <label class="task-scope">Область<select data-task-scope>${optionList(options, scope)}</select></label>
        <div class="periods" role="group" aria-label="Состояние дел">${Object.entries(filters).map(([key, label]) =>
          `<button type="button" data-task-action="filter" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div>
        ${tasks.length ? `<div class="task-list">${tasks.map(task => `
          <button type="button" class="section task-row" data-task-action="card" data-task-id="${escape(task.id)}">
            <strong>${escape(task.title)}</strong><small>${escape(scopeName(task.pointId))} · ${escape(dueText(task))}</small>
            <span class="task-badges">${taskBadges(task)}${task.repeat ? badge(repeatText(task)) : ''}</span>
          </button>`).join('')}</div>` : `<p class="empty">${empty[filter]}</p>`}
        <div class="controls point-controls">${action('exit', origin ? 'Назад к точке' : 'Назад к обзору')}</div>`;
    }

    function card(task) {
      return `${hero(task.title, scopeName(task.pointId), true)}
        <dl class="section point-details">
          <div><dt>Состояние</dt><dd class="task-badges">${taskBadges(task)}</dd></div>
          <div><dt>Сделать до</dt><dd>${task.due ? escape(formatDate(task.due)) : '<small>Пока не указан</small>'}</dd></div>
          ${task.repeat ? `<div><dt>Повтор</dt><dd>${repeatText(task)}${task.repeat.until ? ' · до ' + escape(formatDate(task.repeat.until)) : ''}</dd></div>` : ''}
          <div><dt>Ответственный</dt><dd>${escape(task.owner) || '<small>Пока не указан</small>'}</dd></div>
          ${visibleFields().map(field => `<div><dt class="point-field-title">${escape(field.label)}${hint(field.label, field.hint)}</dt>
            <dd>${escape(task.values?.[field.id]) || '<small>Пока не заполнено</small>'}</dd></div>`).join('')}
          ${task.result ? `<div><dt>Результат</dt><dd class="task-result">${escape(task.result)}</dd></div>` : ''}
        </dl>
        <div class="controls point-controls">
          ${task.status === 'done' ? action('reopen', 'Вернуть в работу', true) : action('close', 'Завершить дело', true)}
          ${task.status === 'open' ? action('wait', 'Отметить ожидание') : ''}
          ${task.status === 'waiting' ? action('reopen', 'Вернуть к выполнению') : ''}
          ${action('edit', 'Изменить дело')}
          ${fromCalendar ? action('exit', 'Назад к календарю') : action('list', 'Назад к делам')}
        </div>`;
    }

    function editForm(task) {
      const pointId = task ? task.pointId : scopePoint(scope);
      const owner = task?.owner ?? point(pointId)?.owner ?? '';
      const repeating = Boolean(task?.repeat);
      const changeRepeat = canChangeRepeat(task);
      return `${hero(task ? 'Изменить дело' : 'Новое дело', scopeName(pointId), true)}
        <form data-form="task-edit">
          <label>Что нужно сделать<input name="title" required maxlength="200" value="${escape(task?.title)}"></label>
          <div class="field-help"><label>Область<select name="scope">
            ${optionList(scopeChoices(), scopeKey(pointId))}</select></label>
            ${hint('область дела','Выбери одну точку или «Вся сеть». Дело по точке будет видно в списке этой точки.')}</div>
          <label><span data-due-label>Сделать до${repeating ? '' : ' · по желанию'}</span><input name="due" type="date" max="9999-12-31" value="${escape(task?.due)}"${repeating ? ' required' : ''}></label>
          ${changeRepeat ? `<div class="field-help"><label>Повтор<select name="frequency">${optionList(frequencies, task?.repeat?.frequency ?? 'none')}</select></label>
            ${hint('повтор','Когда завершишь дело, появится следующее по графику. Изменение срока задаёт новую дату отсчёта.')}</div>
            <label data-repeat-until${repeating ? '' : ' hidden'}>Последний день повтора · по желанию
              <input name="until" type="date" max="9999-12-31" value="${escape(task?.repeat?.until)}"${repeating ? '' : ' disabled'}></label>` : ''}
          <label>Ответственный · по желанию<input name="owner" maxlength="120" value="${escape(owner)}"></label>
          ${visibleFields().map(field => `<div${field.hint ? ' class="field-help"' : ''}>
            <label>${escape(field.label)}<input name="field-${escape(field.id)}" maxlength="120" value="${escape(task?.values?.[field.id])}"></label>
            ${hint(field.label, field.hint)}</div>`).join('')}
          ${task && (task.status === 'done' || task.result) ? `<label>Результат · по желанию
            <textarea name="result" rows="3" maxlength="1200">${escape(task.result)}</textarea></label>` : ''}
          <div class="controls point-controls">
            <button type="submit" class="action primary">Сохранить дело</button>
            ${task ? action('card', 'Назад к делу') : action('list', 'Назад к делам')}
          </div>
        </form>`;
    }

    function closeForm(task) {
      return `${hero('Завершить дело', scopeName(task.pointId), true)}
        <section class="section task-closing"><h2>${escape(task.title)}</h2><small>${escape(dueText(task))}</small></section>
        <form data-form="task-close">
          <label>Результат · по желанию<textarea name="result" rows="3" maxlength="1200">${escape(task.result)}</textarea></label>
          <div class="controls point-controls">
            <button type="submit" class="action primary">Отметить готовым</button>
            ${action('card', 'Назад к делу')}
          </div>
        </form>`;
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
      const task = selectedTask();
      if (screen === 'fields') return fieldList();
      if (screen === 'field') return fieldForm(selectedField());
      if (screen === 'edit') return editForm(task);
      if (task && screen === 'close') return closeForm(task);
      if (task && screen === 'card') return card(task);
      return list();
    }

    function update(task, message, following) {
      const {tasks} = records();
      const added = !taskId;
      const next = added ? [task, ...tasks] : tasks.map(item => item.id === task.id ? task : item);
      if (following) next.unshift(following);
      if (!save({tasks:next})) return;
      if (added) {
        filter = 'active';
        if (scope !== 'all') scope = scopeKey(task.pointId);
      }
      taskId = task.id;
      screen = 'card';
      redraw(message);
    }

    function saveField(field, message) {
      const fields = taskFields();
      const next = fieldId ? fields.map(item => item.id === field.id ? field : item) : [...fields, field];
      if (!save({taskFields:next})) return;
      screen = 'fields';
      redraw(message);
    }
    function complete(task, result) {
      const done = {...task, status:'done', result};
      const repeat = task.repeat;
      if (!repeat || repeat.advanced) return update(done, 'Дело завершено.');
      done.repeat = {...repeat, advanced:true};
      const sequence = repeat.sequence + 1;
      const id = repeat.seriesId + ':repeat:' + sequence;
      if (records().tasks.some(item => item.id === id)) return update(done, 'Дело завершено.');
      const due = nextDate(repeat, task.due, today());
      if (!due) return update(done, 'Дело завершено. График закончился.');
      const following = {...task, id, due, status:'open', result:'', repeat:{...repeat, sequence}};
      update(done, 'Дело завершено. Следующий срок — ' + formatDate(due) + '.', following);
    }

    function click(name, button) {
      const task = selectedTask();
      switch (name) {
        case 'exit': return goBack(origin, fromCalendar ? task?.due : undefined);
        case 'new': taskId = ''; screen = 'edit'; break;
        case 'fields': screen = 'fields'; break;
        case 'new-field': fieldId = ''; screen = 'field'; break;
        case 'edit-field': fieldId = button.dataset.fieldId; screen = 'field'; break;
        case 'archive-field': {
          const field = selectedField();
          if (field) return saveField({...field, archived:!field.archived}, field.archived ? 'Поле возвращено из архива.' : 'Поле перемещено в архив.');
          return;
        }
        case 'list': screen = 'list'; break;
        case 'card': taskId = button.dataset.taskId || taskId; screen = 'card'; break;
        case 'edit': if (!task) return; screen = 'edit'; break;
        case 'close': if (!task || task.status === 'done') return; screen = 'close'; break;
        case 'wait': if (!task || task.status !== 'open') return; return update({...task, status:'waiting'}, 'Дело отмечено как ожидающее.');
        case 'reopen': if (!task || task.status === 'open') return; return update({...task, status:'open'}, 'Дело возвращено в работу.');
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
      if (control.hasAttribute('data-task-scope')) {
        scope = control.value;
        redraw(undefined, false);
        main.querySelector('[data-task-scope]')?.focus({preventScroll:true});
      } else if (control.name === 'frequency' && control.form?.dataset.form === 'task-edit') {
        const {due, until} = control.form.elements;
        const repeating = control.value !== 'none';
        due.required = repeating;
        due.setCustomValidity('');
        control.form.querySelector('[data-due-label]').textContent = repeating ? 'Сделать до' : 'Сделать до · по желанию';
        until.setCustomValidity('');
        until.disabled = !repeating;
        control.form.querySelector('[data-repeat-until]').hidden = !repeating;
      } else if (control.name === 'due' && control.form?.dataset.form === 'task-edit') {
        control.form.elements.until?.setCustomValidity('');
      } else if (control.name === 'scope' && control.form?.dataset.form === 'task-edit' &&
          !taskId && !control.form.hasAttribute('data-owner-edited')) {
        control.form.elements.owner.value = point(scopePoint(control.value))?.owner ?? '';
      }
    }

    function submit(form, get) {
      const task = selectedTask();
      if (form.dataset.form === 'task-close') {
        if (task && task.status !== 'done') complete(task, get('result').trim());
        return;
      }
      if (form.dataset.form === 'task-field') {
        const label = get('label').trim();
        const used = ['Что нужно сделать','Название','Область','Срок','Сделать до','Повтор','Ответственный','Результат','Состояние',
          ...taskFields().filter(item => item.id !== fieldId).map(item => item.label)];
        if (!label || used.some(value => label.localeCompare(value, 'ru', {sensitivity:'base'}) === 0)) {
          form.elements.label.setCustomValidity(!label ? 'Введите название.' : 'Это название уже используется.');
          form.elements.label.reportValidity();
          return;
        }
        return saveField({id:fieldId || crypto.randomUUID(), label, hint:get('hint').trim(),
          archived:selectedField()?.archived ?? false}, 'Поле сохранено.');
      }
      const title = get('title').trim();
      if (!title) {
        form.elements.title.setCustomValidity('Введите название дела.');
        form.elements.title.reportValidity();
        return;
      }
      const key = get('scope');
      const pointId = scopePoint(key);
      if (key !== 'network' && (!pointId || !point(pointId))) return;
      const due = get('due');
      const updated = {
        id:task?.id ?? crypto.randomUUID(), title, pointId, due, owner:get('owner').trim(),
        status:task?.status ?? 'open',
        result:form.elements.result ? get('result').trim() : task?.result ?? '',
      };
      const values = {...task?.values};
      for (const field of visibleFields()) {
        const value = get('field-' + field.id).trim();
        if (value) values[field.id] = value;
        else delete values[field.id];
      }
      if (Object.keys(values).length) updated.values = values;
      if (canChangeRepeat(task)) {
        const frequency = get('frequency');
        if (!Object.hasOwn(frequencies, frequency)) return;
        if (frequency !== 'none') {
          if (!due) return;
          if (frequency === 'weekdays' && [0,6].includes(asDay(due).getUTCDay())) {
            form.elements.due.setCustomValidity('Для повтора по будням выберите день с понедельника по пятницу.');
            form.elements.due.reportValidity();
            return;
          }
          const until = get('until');
          if (until && until < due) {
            form.elements.until.setCustomValidity('Последний день повтора должен быть не раньше срока дела.');
            form.elements.until.reportValidity();
            return;
          }
          const previous = task?.repeat;
          const sameSchedule = previous?.frequency === frequency && task.due === due;
          updated.repeat = {frequency, anchor:sameSchedule ? previous.anchor : due, until,
            seriesId:previous?.seriesId ?? crypto.randomUUID(), sequence:previous?.sequence ?? 0, advanced:false};
        }
      } else if (task.repeat) {
        updated.repeat = task.repeat;
      }
      update(updated, 'Дело сохранено.');
    }

    return {overview, open, isList:() => screen === 'list', draw, click, change, submit};
  }

  window.panel03WorkItems = {validTasks, mount, taskStatuses};
})();
