'use strict';
window.panel03PeriodReports = (() => {
  const {formatMoney,formatRate} = window.panel03Economy;
  const idFor = (start,end) => start + '..' + end;
  const safe = value => Number.isSafeInteger(value);
  const complete = row => row.revenue !== null && row.cost !== null;
  const unique = values => new Set(values).size === values.length;
  const emptyRow = pointId => ({pointId,revenue:null,cost:null});
  const from = (rows,id) => rows.find(row => row.pointId === id) ?? emptyRow(id);

  function validate(periods,points,validDay) {
    const ids = new Set(points.map(point => point.id));
    const validMoney = (value,nonnegative) => safe(value) && (!nonnegative || value >= 0);
    function validRows(rows,partial) {
      return Array.isArray(rows) && rows.every(row => row && ids.has(row.pointId) &&
        ((partial && row.revenue === null) || validMoney(row.revenue,false)) &&
        ((partial && row.cost === null) || validMoney(row.cost,true))) && unique(rows.map(row => row.pointId));
    }
    function validDraft(draft) {
      return draft && Array.isArray(draft.pointIds) && draft.pointIds.length > 0 &&
        draft.pointIds.every(id => ids.has(id)) && unique(draft.pointIds) && validRows(draft.values,true);
    }
    return Array.isArray(periods) && periods.every(period => period &&
      validDay(period.start) && validDay(period.end) && period.start <= period.end &&
      period.id === idFor(period.start,period.end) && validRows(period.rows,false) &&
      (period.draft === undefined ? period.rows.length > 0 : validDraft(period.draft))) &&
      unique(periods.map(period => period.id));
  }

  function merge(local,incoming) {
    const result = new Map(local.map(row => [row.id,row]));
    for (const other of incoming) {
      const saved = result.get(other.id);
      if (!saved) {
        result.set(other.id,other);
        continue;
      }
      const known = new Set(saved.rows.map(row => row.pointId));
      result.set(other.id,{
        ...other,...saved,rows:[...saved.rows,...other.rows.filter(row => !known.has(row.pointId))],
      });
    }
    return [...result.values()];
  }

  function parseMoney(raw) {
    const text = raw.trim().replace(/\s*₽$/,'').replace(/^−/,'-');
    if (!text) return null;
    if (!/^-?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?$/.test(text)) return NaN;
    const [rubles,fraction = ''] = text.replace(/[ \u00a0\u202f-]/g,'').split(/[.,]/);
    const value = Number(rubles)*100 + Number(fraction.padEnd(2,'0'));
    if (!safe(value)) return NaN;
    return text.startsWith('-') && value ? -value : value;
  }

  function totals(rows) {
    return rows.reduce((sum,row) => ({
      revenue:sum.revenue + BigInt(row.revenue),cost:sum.cost + BigInt(row.cost),
    }),{revenue:0n,cost:0n});
  }

  function percentage({revenue,cost}) {
    const divisor = BigInt(revenue);
    if (divisor <= 0n) return null;
    return (BigInt(cost)*20000n + divisor) / (2n*divisor);
  }

  function rateFor(periods,start,end,pointIds) {
    const period = periods.find(row => row.id === idFor(start,end));
    const rows = period?.rows.filter(row => pointIds.includes(row.pointId)) ?? [];
    const rate = rows.length === pointIds.length ? percentage(totals(rows)) : null;
    return {filled:rows.length,rate:rate?.toString() ?? null};
  }

  function create({records,picker,validDay,today,formatPeriod,hero,help,escape,redraw,exit,commit,getMain}) {
    const inputMoney = decimal => decimal === null ? '' : formatMoney(decimal).replace(/\s*₽$/,'');
    const back = (name,label) => `<button type="button" class="back" data-period-action="${name}">← ${label}</button>`;
    const action = (name,label,{primary=false,ref='',disabled=false}={}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-period-action="${name}" ${ref}${disabled ? ' disabled' : ''}>${label}</button>`;
    const submit = (label,value='next',primary=true) =>
      `<button type="submit" class="action${primary ? ' primary' : ''}" value="${value}">${label}</button>`;
    const attr = (name,value) => `data-${name}="${escape(value)}"`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const all = () => records().periodReports ?? [];
    const current = () => all().find(row => row.id === currentId);
    const points = () => records().points;
    const pointName = id => points().find(point => point.id === id).name;
    const title = period => formatPeriod(period.start,period.end);
    const reportRows = period => period.draft.pointIds.map(id => from(period.draft.values,id));
    const scopeCount = rows => rows.filter(complete).length + ' из ' + rows.length;
    let screen, currentId, pointId, shownIds;

    function open() {
      screen = 'home';
      currentId = pointId = shownIds = undefined;
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function store(period) {
      const remaining = all().filter(item => item.id !== period.id);
      return commit([...remaining,period]);
    }

    function home() {
      const rows = [...all()].sort((a,b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
      const hasPoints = points().length > 0;
      function list(label,items,next) {
        if (!items.length) return '';
        return `<section class="section audit-layout"><h2>${label}</h2><div class="audit-list">${items.map(period => {
          const caption = next === 'draft' ? 'Готово ' + scopeCount(reportRows(period)) : 'Точек: ' + period.rows.length;
          return action(next,`<strong>${escape(title(period))}</strong><small>${escape(caption)}</small>`,{ref:attr('period-id',period.id)});
        }).join('')}</div></section>`;
      }
      return `${back('exit','К сводке')}${hero('Факт за период','Экономика бара',true)}
        <div class="audit-layout">${hasPoints ? action('new','Новый период',{primary:true}) : '<p class="empty">Добавь точку во вкладке «Точки».</p>'}
        ${list('Черновики',rows.filter(row => row.draft),'draft')}
        ${list('Закрытые периоды',rows.filter(row => row.rows.length),'closed')}</div>`;
    }

    function pointPicker(rows,selected) {
      return picker.picker(rows,selected,{
        name:'period-reports',label:'Точки',escape,allLabel:'Выбрать все',
      });
    }

    function setup() {
      const last = today();
      return `${back('home','К периодам')}${hero('Новый период','Даты включительно',true)}
        <form data-form="period-setup">
          <label>Начало периода<input type="date" name="start" required value="${last.slice(0,7)}-01"></label>
          <label>Конец периода<input type="date" name="end" required value="${last}"></label>
          ${pointPicker(points(),null)}
          ${warning}${submit('Начать заполнение')}
        </form>`;
    }

    function editScope(period,closed) {
      const choices = closed ? points().filter(point => period.rows.some(row => row.pointId === point.id)) : points();
      const selected = closed ? shownIds : period.draft.pointIds;
      return `${back(closed ? 'view-closed' : 'draft-data','К периоду')}${hero('Точки за период',title(period),true)}
        <form data-form="${closed ? 'period-closed-scope' : 'period-scope'}">
          ${pointPicker(choices,selected?.length === choices.length ? null : selected)}
          ${warning}${submit('Применить')}
        </form>`;
    }

    function missing(row) {
      if (row.revenue === null && row.cost === null) return 'Нужны выручка и себестоимость расхода';
      return row.revenue === null ? 'Нужна выручка' : 'Нужна себестоимость расхода';
    }

    function explainedRate(row) {
      const rate = percentage(row);
      return rate === null ? 'Фудкост недоступен при выручке ≤ 0 ₽' : formatRate(rate);
    }

    function draftData(period) {
      const rows = reportRows(period);
      const ready = rows.every(complete);
      return `${back('home','К периодам')}${hero('Закрытие периода',title(period),true)}
        <div class="audit-layout">
          <p>Заполнено ${scopeCount(rows)} точек.</p>
          ${action('scope','Изменить точки')}
          <div class="audit-list">${rows.map(row => action('point',
            `<strong>${escape(pointName(row.pointId))}</strong><small>${complete(row) ? explainedRate(row) : missing(row)}</small>`,
            {ref:attr('point-id',row.pointId)})).join('')}</div>
          ${!ready ? '<p class="empty">Итог по выбранным точкам появится после заполнения всех сумм.</p>' : ''}
          ${action(ready ? 'review' : 'continue',ready ? 'Проверить итог' : 'Продолжить заполнение',{primary:true})}
          ${action('home','Продолжить позже')}
        </div>`;
    }

    function pointStep(period) {
      const row = from(period.draft.values,pointId);
      const ids = period.draft.pointIds;
      const step = ids.indexOf(pointId)+1;
      const rows = reportRows(period);
      const lastStep = step === ids.length && rows.every(row => row.pointId === pointId || complete(row));
      return `${back('draft-data','К данным периода')}${hero('Закрытие периода',title(period),true)}
        <form data-form="period-point">
          <p>Точка ${step} из ${ids.length} · Заполнено ${scopeCount(rows)}</p>
          <h2>${escape(pointName(pointId))}</h2>
          <div class="field-help"><label>Выручка бара<input name="revenue" inputmode="decimal" maxlength="28" value="${escape(inputMoney(row.revenue))}"></label>
            ${help('выручка бара','Возьми итоговую выручку только по бару за указанные даты по правилам твоего отчёта.')}</div>
          <div class="field-help"><label>Себестоимость расхода сырья<input name="cost" inputmode="decimal" maxlength="28" value="${escape(inputMoney(row.cost))}"></label>
            ${help('расход сырья','Введи итоговую стоимость израсходованного сырья в рублях из отчёта за те же даты. Используй один способ учёта на всех точках.')}</div>
          <section class="section period-total"><p>Фактический фудкост точки</p>
            <strong data-point-rate>${complete(row) ? explainedRate(row) : '—'}</strong></section>
          ${warning}
          ${submit(lastStep ? 'Проверить итог' : 'Следующая точка')}
          ${submit('Продолжить позже','later',false)}
        </form>`;
    }

    function summary(period,closed) {
      const rows = closed ? period.rows.filter(row => !shownIds || shownIds.includes(row.pointId)) : reportRows(period);
      const sum = totals(rows);
      return `${back(closed ? 'home' : 'draft-data',closed ? 'К периодам' : 'К данным периода')}
        ${hero('Факт за период',title(period),true)}
        <div class="audit-layout">
          ${closed ? action('closed-scope','Точки отчёта · ' + rows.length) : ''}
          <section class="section audit-layout period-total">
            <div class="help-title"><h2>Фактический фудкост</h2>
              ${help('фактический фудкост','Панель делит общую себестоимость расхода сырья на общую выручку выбранных точек и показывает результат в процентах.')}</div>
            <strong>${explainedRate(sum)}</strong>
            <dl class="point-details"><div><dt>Выручка бара</dt><dd>${formatMoney(sum.revenue)}</dd></div>
              <div><dt>Себестоимость расхода сырья</dt><dd>${formatMoney(sum.cost)}</dd></div></dl>
          </section>
          <section class="section audit-layout"><h2>По точкам</h2><dl class="point-details period-point-details">
            ${rows.map(row => `<div><dt>${escape(pointName(row.pointId))}</dt>
              <dd>${explainedRate(row)}<small>Выручка ${formatMoney(row.revenue)} · Сырьё ${formatMoney(row.cost)}</small></dd></div>`).join('')}
          </dl></section>
          ${closed ? action('correct',period.draft ? 'Продолжить черновик' : 'Исправить суммы',{primary:true}) :
            action('finish','Закрыть период',{primary:true}) + action('draft-data','Вернуться к суммам')}
        </div>`;
    }

    function draw() {
      const period = current();
      if (screen === 'setup') return setup();
      if (screen === 'scope' || screen === 'closed-scope') return editScope(period,screen === 'closed-scope');
      if (screen === 'draft') return draftData(period);
      if (screen === 'point') return pointStep(period);
      if (screen === 'review' || screen === 'closed') return summary(period,screen === 'closed');
      return home();
    }

    function warn(form,message) {
      const node = form.querySelector('[role=alert]');
      node.textContent = message;
      node.hidden = false;
    }

    function formRow(form) {
      return {pointId,revenue:parseMoney(form.elements.revenue.value),cost:parseMoney(form.elements.cost.value)};
    }

    function validInput(row) {
      return !Number.isNaN(row.revenue) && !Number.isNaN(row.cost) && (row.cost === null || row.cost >= 0);
    }

    function storePoint(form,required) {
      const row = formRow(form);
      if (!validInput(row)) {
        warn(form,'Проверь суммы. Укажи рубли с точностью до копеек и расход сырья от 0 ₽.');
        return false;
      }
      if (required && !complete(row)) {
        warn(form,'Введи обе суммы. Если сумма равна нулю, укажи 0.');
        return false;
      }
      const period = current();
      const saved = from(period.draft.values,pointId);
      if (row.revenue === saved.revenue && row.cost === saved.cost) return true;
      const values = period.draft.values.filter(item => item.pointId !== pointId);
      return store({...period,draft:{...period.draft,values:[...values,row]}});
    }

    function beforeLeave() {
      return screen !== 'point' || storePoint(getMain().querySelector('[data-form=period-point]'),false);
    }

    function showPoint(id) {
      pointId = id;
      show('point');
    }

    function start(period,ids) {
      const updated = {...period,draft:{pointIds:ids,values:period.rows}};
      return store(updated);
    }

    function submitForm(form,submitter) {
      const period = current();
      if (form.dataset.form === 'period-point') {
        const pause = submitter?.value === 'later';
        if (!storePoint(form,!pause)) return;
        if (pause) return show('home','Черновик сохранён.');
        const rows = reportRows(current());
        const next = rows[rows.findIndex(row => row.pointId === pointId)+1] ?? rows.find(row => !complete(row));
        return next ? showPoint(next.pointId) : show('review');
      }
      const field = form.querySelector('[data-point-picker]');
      const ids = picker.read(field) ?? [...field.querySelectorAll('[data-point-option]')].map(option => option.value);
      if (!ids.length) return warn(form,'Отметь хотя бы одну точку.');
      if (form.dataset.form === 'period-closed-scope') {
        shownIds = ids;
        return show('closed');
      }
      if (form.dataset.form === 'period-scope') {
        const values = new Map(period.rows.map(row => [row.pointId,row]));
        for (const row of period.draft.values) values.set(row.pointId,row);
        if (store({...period,draft:{pointIds:ids,values:[...values.values()]}})) show('draft');
        return;
      }
      const {start:starts,end:ends} = form.elements;
      const startDate = starts.value, endDate = ends.value;
      if (!validDay(startDate) || !validDay(endDate) || startDate > endDate) {
        return warn(form,'Укажи даты периода по порядку.');
      }
      const id = idFor(startDate,endDate);
      const existing = all().find(item => item.id === id);
      if (existing?.draft) {
        currentId = id;
        return show('draft','За эти даты уже есть черновик.');
      }
      const base = existing ?? {id,start:startDate,end:endDate,rows:[]};
      if (!start(base,ids)) return;
      currentId = id;
      const next = reportRows(current()).find(row => !complete(row));
      if (next) showPoint(next.pointId);
      else show('draft','За эти даты уже есть закрытые суммы. Их можно исправить.');
    }

    function click(button) {
      const {periodAction:name,periodId,pointId:id} = button.dataset;
      if (name === 'exit') return exit();
      if (name === 'home') return show('home');
      if (name === 'new') return show('setup');
      if (name === 'closed' || name === 'draft') {
        currentId = periodId;
        shownIds = undefined;
        return show(name);
      }
      const period = current();
      if (name === 'draft-data') {
        if (beforeLeave()) show('draft');
        return;
      }
      if (name === 'point') return showPoint(id);
      if (name === 'continue') return showPoint(reportRows(period).find(row => !complete(row)).pointId);
      if (name === 'correct') {
        if (period.draft || start(period,shownIds ?? period.rows.map(row => row.pointId))) show('draft');
        return;
      }
      if (name === 'finish') {
        const rows = reportRows(period);
        if (!rows.every(complete)) return show('draft');
        const saved = new Map(period.rows.map(row => [row.pointId,row]));
        for (const row of rows) saved.set(row.pointId,row);
        const updated = {...period,rows:[...saved.values()]};
        delete updated.draft;
        if (!store(updated)) return;
        shownIds = rows.map(row => row.pointId);
        return show('closed','Период закрыт.');
      }
      show(name === 'view-closed' ? 'closed' : name);
    }

    function input(field) {
      if (field.form?.dataset.form !== 'period-point') return;
      const row = formRow(field.form);
      const label = validInput(row) && complete(row) ? explainedRate(row) : '—';
      field.form.querySelector('[data-point-rate]').textContent = label;
    }

    return {open,draw,submit:submitForm,click,input,beforeLeave};
  }

  return {create,validate,merge,rateFor};
})();
