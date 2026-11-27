(() => {
  'use strict';

  const taskStatuses = {open:'К выполнению', waiting:'Ожидает', done:'Готово'};
  const filters = {active:'Активные', waiting:'Ожидают', done:'Готово'};
  const scopeKey = pointId => pointId ? 'point:' + pointId : 'network';
  const scopePoint = key => key.startsWith('point:') ? key.slice(6) : '';
  const overdue = (task, day) => task.status !== 'done' && Boolean(task.due && task.due < day);

  function validTasks(tasks, points, date) {
    const ids = new Set(points.map(point => point.id));
    const text = value => typeof value === 'string';
    return Array.isArray(tasks) && tasks.every(task => task && text(task.id) && task.id && text(task.title) &&
      task.title.trim() && (task.pointId === '' || ids.has(task.pointId)) && (task.due === '' || date(task.due)) &&
      text(task.owner) && text(task.status) && Object.hasOwn(taskStatuses, task.status) && text(task.result)) &&
      new Set(tasks.map(task => task.id)).size === tasks.length;
  }

  function mount({records, save, redraw, goBack, today, formatDate, hero, escape, optionList, hint, main}) {
    let screen = 'list';
    let scope = 'all';
    let filter = 'active';
    let origin = '';
    let taskId = '';
    const point = id => records().points.find(point => point.id === id);
    const scopeName = id => point(id)?.name ?? 'Вся сеть';
    const selectedTask = () => records().tasks.find(task => task.id === taskId);
    const scopeChoices = () => Object.fromEntries([['network','Вся сеть'],
      ...records().points.map(point => [scopeKey(point.id), point.name])]);
    const action = (name, label, primary = false) =>
      `<button type="button" data-task-action="${name}" class="action${primary ? ' primary' : ''}">${label}</button>`;
    const badge = (label, late = false) => `<span class="task-badge${late ? ' task-overdue' : ''}">${label}</span>`;
    const taskBadges = task => badge(taskStatuses[task.status]) + (overdue(task, today()) ? badge('Просрочено', true) : '');
    const dueText = task => task.due ? 'Срок ' + formatDate(task.due) : 'Без срока';

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

    function open(pointId = '') {
      origin = pointId;
      scope = pointId ? scopeKey(pointId) : 'all';
      filter = 'active';
      taskId = '';
      screen = 'list';
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
            <span class="task-badges">${taskBadges(task)}</span>
          </button>`).join('')}</div>` : `<p class="empty">${empty[filter]}</p>`}
        <div class="controls point-controls">${action('exit', origin ? 'Назад к точке' : 'Назад к обзору')}</div>`;
    }

    function card(task) {
      return `${hero(task.title, scopeName(task.pointId), true)}
        <dl class="section point-details">
          <div><dt>Состояние</dt><dd class="task-badges">${taskBadges(task)}</dd></div>
          <div><dt>Срок</dt><dd>${task.due ? escape(formatDate(task.due)) : '<small>Пока не указан</small>'}</dd></div>
          <div><dt>Ответственный</dt><dd>${escape(task.owner) || '<small>Пока не указан</small>'}</dd></div>
          ${task.result ? `<div><dt>Результат</dt><dd class="task-result">${escape(task.result)}</dd></div>` : ''}
        </dl>
        <div class="controls point-controls">
          ${task.status === 'done' ? action('reopen', 'Вернуть в работу', true) : action('close', 'Завершить дело', true)}
          ${task.status === 'open' ? action('wait', 'Отметить ожидание') : ''}
          ${task.status === 'waiting' ? action('reopen', 'Вернуть к выполнению') : ''}
          ${action('edit', 'Изменить дело')}
          ${action('list', 'Назад к делам')}
        </div>`;
    }

    function editForm(task) {
      const pointId = task ? task.pointId : scopePoint(scope);
      const owner = task?.owner ?? point(pointId)?.owner ?? '';
      return `${hero(task ? 'Изменить дело' : 'Новое дело', scopeName(pointId), true)}
        <form data-form="task-edit">
          <label>Что нужно сделать<input name="title" required maxlength="200" value="${escape(task?.title)}"></label>
          <div class="field-help"><label>Область<select name="scope">
            ${optionList(scopeChoices(), scopeKey(pointId))}</select></label>
            ${hint('область дела','Выбери одну точку или «Вся сеть». Дело по точке будет видно в списке этой точки.')}</div>
          <label>Срок · по желанию<input name="due" type="date" max="9999-12-31" value="${escape(task?.due)}"></label>
          <label>Ответственный · по желанию<input name="owner" maxlength="120" value="${escape(owner)}"></label>
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

    function draw() {
      const task = selectedTask();
      if (screen === 'edit') return editForm(task);
      if (task && screen === 'close') return closeForm(task);
      if (task && screen === 'card') return card(task);
      return list();
    }

    function update(task, message) {
      const tasks = records().tasks;
      const added = !taskId;
      const next = added ? [task, ...tasks] : tasks.map(item => item.id === task.id ? task : item);
      if (!save(next)) return;
      if (added) {
        filter = 'active';
        if (scope !== 'all') scope = scopeKey(task.pointId);
      }
      taskId = task.id;
      screen = 'card';
      redraw(message);
    }

    function click(name, button) {
      const task = selectedTask();
      switch (name) {
        case 'exit': return goBack(origin);
        case 'new': taskId = ''; screen = 'edit'; break;
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
      } else if (control.name === 'scope' && control.form?.dataset.form === 'task-edit' &&
          !taskId && !control.form.hasAttribute('data-owner-edited')) {
        control.form.elements.owner.value = point(scopePoint(control.value))?.owner ?? '';
      }
    }

    function submit(form, get) {
      const task = selectedTask();
      if (form.dataset.form === 'task-close') {
        if (task && task.status !== 'done') update({...task, status:'done', result:get('result').trim()}, 'Дело завершено.');
        return;
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
      update({
        id:task?.id ?? crypto.randomUUID(), title, pointId, due:get('due'), owner:get('owner').trim(),
        status:task?.status ?? 'open', result:task?.result ?? '',
      }, 'Дело сохранено.');
    }

    return {overview, open, isList:() => screen === 'list', draw, click, change, submit};
  }

  window.panel03WorkItems = {validTasks, mount};
})();
