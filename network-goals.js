'use strict';
window.panel03NetworkGoals = (() => {
  const {formatRate} = window.panel03Economy;
  const {rateFor,findPeriod} = window.panel03PeriodReports;
  const idFor = (start,end,ids) => JSON.stringify([start,end,[...ids].sort()]);
  const validLimit = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000;

  function validate(rows,points,validDay) {
    const ids = new Set(points.map(point => point.id));
    return Array.isArray(rows) && rows.every(row => row && validDay(row.start) && validDay(row.end) && row.start <= row.end &&
      Array.isArray(row.pointIds) && row.pointIds.length > 0 && row.pointIds.every(id => ids.has(id)) &&
      new Set(row.pointIds).size === row.pointIds.length && row.id === idFor(row.start,row.end,row.pointIds) &&
      validLimit(row.limit)) && new Set(rows.map(row => row.id)).size === rows.length;
  }

  function limitFrom(raw) {
    const value = raw.trim().replace(',','.');
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return NaN;
    const [whole,fraction = ''] = value.split('.');
    return Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  }

  function nextMonth(day,end=false) {
    const date = new Date(day + 'T00:00:00Z');
    const oldDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth()+1);
    const next = new Date(+date);
    next.setUTCMonth(next.getUTCMonth()+1,0);
    const previous = new Date(+date);
    previous.setUTCDate(0);
    const offset = end && oldDay === previous.getUTCDate() ? next.getUTCDate() : Math.min(oldDay,next.getUTCDate());
    date.setUTCDate(offset);
    return date.toISOString().slice(0,10);
  }

  function create({records,picker,today,validDay,formatPeriod,hero,escape,help,redraw,exit,commit,openReport,openReview}) {
    const list = () => records().networkGoals ?? [];
    const points = () => records().points;
    const title = goal => formatPeriod(goal.start,goal.end);
    const action = (name,label,{ref='',primary=false}={}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-goal-action="${name}" ${ref}>${label}</button>`;
    const ref = id => `data-goal-id="${escape(id)}"`;
    const back = (name,label) => `<button type="button" class="back" data-goal-action="${name}">← ${label}</button>`;
    let draft, editId, dirty;

    function open() {
      draft = editId = undefined;
      dirty = false;
    }

    function goalCard(goal) {
      const reports = records().periodReports ?? [];
      const {filled,rate} = rateFor(reports,goal.start,goal.end,goal.pointIds);
      const missing = filled < goal.pointIds.length;
      const delta = rate === null ? null : BigInt(rate) - BigInt(goal.limit);
      const above = delta !== null && delta > 0n;
      const result = missing ? 'Ожидает отчётов' : rate === null ? 'Выручка равна нулю или отрицательна' : formatRate(rate);
      const reported = new Set(findPeriod(reports,goal.start,goal.end)?.rows.map(row => row.pointId));
      const names = ids => picker.scopeName(ids,points());
      return `<article class="section audit-layout goal-card">
        <h2>${escape(title(goal))}</h2><small>${escape(names(goal.pointIds))}</small>
        <dl class="point-details"><div><dt>Цель</dt><dd>Не выше ${formatRate(goal.limit)}</dd></div>
          <div><dt>Факт</dt><dd>${result}</dd></div></dl>
        ${missing ? `<p class="record">Готово ${filled} из ${goal.pointIds.length}. Ждём отчёты по точкам
          <strong>${escape(names(goal.pointIds.filter(id => !reported.has(id))))}</strong>.</p>` : ''}
        ${delta === null ? '' : `<p><span class="audit-status" data-outcome="${above ? 'issue' : 'pass'}">${above
          ? 'Выше цели на ' + formatRate(delta).replace(' %',' п. п.') : 'Цель достигнута'}</span></p>`}
        <div class="goal-actions">
          ${action('report',missing ? 'Открыть «Факт за период»' : 'Открыть отчёт',{ref:ref(goal.id),primary:missing})}
          ${above ? action('review','Открыть разбор',{ref:ref(goal.id)}) : ''}
          ${action('copy','Перенести на новый период',{ref:ref(goal.id)})}
          ${action('edit','Изменить цель',{ref:ref(goal.id)})}
        </div></article>`;
    }

    function home() {
      const goals = [...list()].sort((a,b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
      return `${back('exit','К сводке')}${hero('Цели сети','Фактический фудкост',true)}
        <div class="audit-layout">${points().length ? action('new','Задать цель на период',{primary:true}) :
          '<p class="empty">Добавь точку во вкладке «Точки».</p>'}
          ${goals.map(goalCard).join('')}</div>`;
    }

    function editor() {
      const limit = draft.limit === undefined ? '' : String(draft.limit/100).replace('.',',');
      return `${back('cancel','К целям')}${hero('Цель по фудкосту','Фактический фудкост выбранных точек',true)}
        <form data-form="network-goal">
          <label>Начало периода<input type="date" name="start" value="${escape(draft.start)}" required></label>
          <label>Конец периода<input type="date" name="end" value="${escape(draft.end)}" required></label>
          <div class="field-help"><label>Максимальный фудкост, %<input name="limit" inputmode="decimal"
            maxlength="6" value="${limit}" required></label>
            ${help('максимальный фудкост','Цель достигнута, если фактический фудкост равен этому значению или ниже.')}</div>
          ${picker.picker(points(),draft.pointIds?.length === points().length ? null : draft.pointIds,
            {name:'goal-points',label:'Точки',escape,allLabel:'Выбрать все'})}
          <p class="notice audit-error" role="alert" hidden></p>
          <button type="submit" class="action primary">Сохранить цель</button>
        </form>`;
    }

    function beforeLeave() {
      return !dirty || window.confirm('Выйти без сохранения цели?');
    }

    function click(button) {
      const {goalAction:name,goalId} = button.dataset;
      if (name === 'exit') return exit();
      if (name === 'cancel') {
        if (beforeLeave()) {
          open();
          redraw();
        }
        return;
      }
      const goal = list().find(row => row.id === goalId);
      if (name === 'report') return openReport(goal);
      if (name === 'review') return openReview(goal);
      editId = name === 'edit' ? goal.id : undefined;
      if (name === 'copy') {
        const start = nextMonth(goal.start), end = nextMonth(goal.end,true);
        draft = {...goal,start:validDay(start) ? start : goal.start,end:validDay(end) ? end : goal.end};
      } else if (goal) {
        draft = goal;
      } else {
        const end = today();
        draft = {start:end.slice(0,7) + '-01',end,pointIds:null};
      }
      dirty = false;
      redraw();
    }

    function warn(form,message) {
      const alert = form.querySelector('[role=alert]');
      alert.textContent = message;
      alert.hidden = false;
    }

    function submit(form) {
      const start = form.elements.start.value, end = form.elements.end.value;
      const limit = limitFrom(form.elements.limit.value);
      const pointIds = picker.read(form.querySelector('[data-point-picker]')) ?? points().map(point => point.id);
      if (!validDay(start) || !validDay(end) || start > end) return warn(form,'Укажи даты периода по порядку.');
      if (!validLimit(limit)) return warn(form,'Укажи фудкост от 0 до 100 % с точностью до двух знаков.');
      if (!pointIds.length) return warn(form,'Отметь хотя бы одну точку.');
      const id = idFor(start,end,pointIds);
      const remaining = list().filter(row => row.id !== editId);
      if (remaining.some(row => row.id === id)) {
        return warn(form,'За эти даты и по этим точкам уже есть цель. Открой её в списке.');
      }
      if (!commit([...remaining,{id,start,end,pointIds,limit}])) return;
      open();
      redraw('Цель сохранена.');
    }

    function input(field) {
      if (field.form?.dataset.form === 'network-goal') dirty = true;
    }

    return {open,draw:() => draft ? editor() : home(),click,submit,input,beforeLeave};
  }

  return {create,validate};
})();
