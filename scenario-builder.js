'use strict';
window.panel03Scenarios = (() => {
  const stock = window.panel03Stock;
  const units = stock.units;
  const kinds = {
    inventory:'Инвентаризация', audit:'Итог аудита', readiness:'Готовность к запуску',
    difference:'Расчёт расхождения', condition:'Условие', work:'Создать рабочее дело',
  };
  const metrics = {shortage:'Недостача', surplus:'Излишек', absolute:'Модуль расхождения'};
  const comparisons = {gt:'Больше', ge:'Больше или равно', eq:'Равно', lt:'Меньше', le:'Меньше или равно'};
  const sourceKinds = ['inventory','audit','readiness','difference'];
  const labels = {running:'В работе',done:'Завершён',stopped:'Остановлен'};
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const recordDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
  const unique = rows => new Set(rows.map(row=>row.id)).size === rows.length;
  const branchIndex = (steps,index,branch) => branch === 'end' ? steps.length :
    branch === 'next' ? index+1 : steps.findIndex(row=>row.id === branch);
  const stepOf = (steps,id) => steps.find(step=>step.id === id);
  const outputOf = (run,id) => run.entries.find(entry=>entry.id === id)?.output;

  function compatible(type,source) {
    if (type === 'difference') return source === 'inventory';
    if (type === 'condition') return ['difference','audit','readiness'].includes(source);
    return type === 'work' && sourceKinds.includes(source);
  }

  function planError(steps) {
    if (!steps.length) return 'Добавь хотя бы один шаг.';
    const paths = new Map([[0,new Set()]]);
    for (const [index,step] of steps.entries()) {
      const position = 'Шаг ' + (index+1) + '. ';
      const offered = paths.get(index);
      if (!offered) return position + 'К этому шагу нет перехода.';
      if (['difference','condition','work'].includes(step.type) && !(step.type === 'work' && !step.source)) {
        if (!offered.has(step.source) || !compatible(step.type,stepOf(steps,step.source)?.type)) {
          return position + 'Выбери источник, который выполняется раньше во всех ведущих сюда ветках.';
        }
      }
      if (step.type === 'condition') {
        const source = stepOf(steps,step.source)?.type;
        if (!nonnegative(step.threshold) || !Object.hasOwn(comparisons,step.operator) ||
            (source === 'difference' ? !Object.hasOwn(metrics,step.metric) || !Object.hasOwn(units,step.unit) :
              step.threshold % 1000 !== 0)) return position + 'Проверь порог и единицу условия.';
      }
      const next = step.type === 'condition' ? [step.yes,step.no].map(value=>branchIndex(steps,index,value)) : [index+1];
      if (next.some(target=>target <= index)) return position + 'Переход должен вести к следующему шагу или завершению.';
      const now = new Set([...offered,step.id]);
      for (const target of next) {
        const earlier = paths.get(target);
        paths.set(target,earlier ? new Set([...earlier].filter(id=>now.has(id))) : now);
      }
    }
    return '';
  }

  function nextIndex(steps,index,output) {
    const step = steps[index];
    return step.type === 'condition' ? branchIndex(steps,index,output.answer ? step.yes : step.no) : index+1;
  }

  function validate(book) {
    const validSteps = steps => Array.isArray(steps) && steps.length <= 50 &&
      steps.every(step=>step && present(step.id) && !['next','end'].includes(step.id) &&
        typeof step.type === 'string' && Object.hasOwn(kinds,step.type) &&
        (step.type !== 'work' || (typeof step.source === 'string' && typeof step.title === 'string' && typeof step.owner === 'string'))) &&
      unique(steps) && !planError(steps);
    const validLine = line => line && present(line.id) && present(line.name) && typeof line.unit === 'string' &&
      Object.hasOwn(units,line.unit) && nonnegative(line.actual) && (line.expected === null || Number.isSafeInteger(line.expected));
    const validContext = output => present(output.pointId) && present(output.label);
    function validOutput(out,type) {
      if (!out) return false;
      if (type === 'condition') return typeof out.answer === 'boolean' && present(out.label);
      if (type === 'work') return present(out.workId) && typeof out.label === 'string';
      if (!validContext(out)) return false;
      if (type === 'inventory') return Array.isArray(out.lines) && out.lines.length > 0 && out.lines.every(validLine);
      if (type === 'difference') return validLine(out.line);
      return nonnegative(out.count);
    }
    function validRun(run) {
      if (!run || !present(run.id) || !present(run.templateId) || !present(run.name) || !recordDate(run.createdAt) ||
          !validSteps(run.steps) || !Array.isArray(run.entries) ||
          typeof run.status !== 'string' || !Object.hasOwn(labels,run.status)) return false;
      let cursor = 0;
      for (const entry of run.entries) {
        const step = run.steps[cursor];
        if (!step || !entry || entry.id !== step.id || !validOutput(entry.output,step.type)) return false;
        cursor = nextIndex(run.steps,cursor,entry.output);
      }
      return run.cursor === cursor && (cursor === run.steps.length ? run.status === 'done' : run.status !== 'done');
    }
    return book && Array.isArray(book.templates) && book.templates.every(row=>
      row && present(row.id) && present(row.name) && validSteps(row.steps)) && unique(book.templates) &&
      Array.isArray(book.runs) && book.runs.every(validRun) && unique(book.runs);
  }

  function advance(run,output) {
    const index = nextIndex(run.steps,run.cursor,output);
    return {...run,cursor:index,status:index === run.steps.length ? 'done' : 'running',
      entries:[...run.entries,{id:run.steps[run.cursor].id,output}]};
  }

  function linkWork(book,{runId,stepId,label},workId) {
    const run = book.runs.find(row=>row.id === runId);
    if (!run || run.status !== 'running' || run.steps[run.cursor]?.id !== stepId || run.steps[run.cursor].type !== 'work') return null;
    return {...book,runs:book.runs.map(row=>row.id === run.id ? advance(run,{workId,label}) : row)};
  }

  function sourceForWork(book,id) {
    for (const run of book?.runs ?? []) {
      const entry = run.entries.find(row=>row.output.workId === id);
      if (entry) return {run,entry};
    }
    return null;
  }

  function variance(line) { return BigInt(line.actual) - BigInt(line.expected); }
  const measures = {kg:['mass',1000n],g:['mass',1n],l:['volume',1000n],ml:['volume',1n],pcs:['count',1n]};

  function evaluate(step,source) {
    let value;
    if (source.line) {
      const {line} = source;
      if (line.expected === null) return {error:'У этой позиции нет учётного остатка. Вернись к выбору пересчёта или останови выполнение.'};
      const [sourceFamily,sourceFactor] = measures[line.unit];
      const [targetFamily,targetFactor] = measures[step.unit];
      if (sourceFamily !== targetFamily) return {error:'Единицы пересчёта и порога несовместимы. Выбери другую строку или настрой условие в сценарии.'};
      const difference = variance(line);
      value = step.metric === 'absolute' ? (difference < 0 ? -difference : difference) :
        step.metric === 'shortage' ? (difference < 0 ? -difference : 0n) : (difference > 0 ? difference : 0n);
      return compare(step,value*sourceFactor,BigInt(step.threshold)*targetFactor);
    }
    return compare(step,BigInt(source.count)*1000n,BigInt(step.threshold));
  }

  function compare(step,value,threshold) {
    const tests = {gt:value > threshold,ge:value >= threshold,eq:value === threshold,lt:value < threshold,le:value <= threshold};
    const answer = tests[step.operator];
    return {answer,label:answer ? 'Условие выполнено' : 'Условие не выполнено'};
  }

  function create({records, hero, escape, options, help, commit, redraw, exit, openWork, newWork, rolloutRemaining, getMain}) {
    const empty = {templates:[],runs:[]};
    const date = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeZone:'Europe/Moscow'});
    const number = new Intl.NumberFormat('ru-RU');
    const dateText = value => date.format(new Date(value));
    const pointName = id => records().points.find(row=>row.id === id)?.name ?? 'Точка';
    const book = () => records().scenarioBook ?? empty;
    const run = () => book().runs.find(row=>row.id === runId);
    const template = () => book().templates.find(row=>row.id === templateId);
    const action = (name,label,{primary=false,data='',disabled=false}={}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-scenario-action="${name}" ${data}${disabled ? ' disabled' : ''}>${label}</button>`;
    const ref = (name,value) => `data-${name}="${escape(value)}"`;
    const back = (name,label) => `<button type="button" class="back" data-scenario-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const label = (step) => kinds[step.type];
    let screen, templateId, runId, draft, stepIndex, stepDraft, dirty = false;

    function open(id) {
      runId = id;
      screen = id ? 'run' : 'home';
      dirty = false;
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function formatAmount(value,unit) {
      const count = BigInt(value);
      const positive = count < 0 ? -count : count;
      const tail = String(positive % 1000n).padStart(3,'0').replace(/0+$/,'');
      return (count < 0 ? '−' : '') + number.format(positive / 1000n) + (tail ? ','+tail : '') +
        (unit ? ' ' + units[unit] : '');
    }

    function thresholdLabel(step) {
      return comparisons[step.operator] + ' ' + formatAmount(step.threshold,step.unit);
    }

    function home() {
      const rows = book();
      const runs = [...rows.runs].reverse();
      return `${back('exit','Обзор')}${hero('Сценарии','Конструктор сценариев',true)}
        <div class="audit-layout">${action('new','Новый сценарий',{primary:true})}
          ${rows.templates.length ? `<section class="section audit-layout"><div class="help-title"><h2>Мои сценарии</h2>
            ${help('сценарии','Собери и сохрани список шагов. Один сценарий можно выполнять снова для разных записей.')}</div>
            <div class="audit-list">${rows.templates.map(row=>action('template',escape(row.name),{data:ref('template-id',row.id)})).join('')}</div></section>` : ''}
          ${runs.length ? `<section class="section audit-layout"><h2>Выполнения</h2><div class="audit-list">${runs.map(row=>action('open-run',
            `<strong>${escape(row.name)}</strong><small>${labels[row.status]} · ${escape(dateText(row.createdAt))}</small>`,
            {data:ref('run-id',row.id)})).join('')}</div></section>` : ''}
        </div>`;
    }

    function destination(steps,branch) {
      return branch === 'next' ? 'Следующий шаг' : branch === 'end' ? 'Завершить' :
        stepOf(steps,branch) ? label(stepOf(steps,branch)) : 'Выбрать переход';
    }

    function stepRows(steps,editable) {
      return `<ol class="scenario-steps">${steps.map((step,index)=>`<li class="section audit-layout">
        <strong>${index+1}. ${label(step)}</strong>
        ${step.type === 'condition' ? `<small>${escape(thresholdLabel(step))}</small>
          <p>Да · ${escape(destination(steps,step.yes))}<br>Нет · ${escape(destination(steps,step.no))}</p>` : ''}
        ${editable ? `<div class="scenario-controls">${action('edit-step','Изменить',{data:ref('index',index)})}
          ${action('up','Выше',{data:ref('index',index),disabled:index===0})}
          ${action('down','Ниже',{data:ref('index',index),disabled:index===steps.length-1})}
          ${action('remove','Убрать',{data:ref('index',index)})}</div>` : ''}
        </li>`).join('')}</ol>`;
    }

    function preview() {
      const row = template();
      return `${back('home','Сценарии')}${hero(row.name,'Сценарий',true)}
        <div class="audit-layout">${action('start','Начать выполнение',{primary:true})}
          ${stepRows(row.steps,false)}${action('edit','Редактировать сценарий')}</div>`;
    }

    function editor() {
      return `${back('editor-back',templateId ? 'К сценарию' : 'Сценарии')}${hero('Редактор сценария','Список шагов',true)}
        <form data-form="scenario-editor">
          <label>Название сценария<input name="name" maxlength="140" value="${escape(draft.name)}" required></label>
          ${draft.steps.length ? stepRows(draft.steps,true) : '<p class="empty">Добавь первый шаг.</p>'}
          ${action('add-step','Добавить шаг',{disabled:draft.steps.length >= 50})}
          ${warning}${submit('Сохранить сценарий')}
        </form>`;
    }

    function configure() {
      const existing = draft.steps[stepIndex];
      const step = stepDraft;
      const type = step.type;
      const before = draft.steps.slice(0,stepIndex);
      const available = before.filter(step=>compatible(type,step.type));
      const defaultSource = step.source ?? available.at(-1)?.id ?? '';
      const sourceType = stepOf(before,defaultSource)?.type;
      const sourceOptions = {'':type === 'work' ? 'Самостоятельное дело' : 'Выбрать источник',
        ...Object.fromEntries(available.map(step=>[step.id,(before.indexOf(step)+1)+'. '+label(step)]))};
      const targets = {next:'Следующий шаг',end:'Завершить',
        ...Object.fromEntries(draft.steps.slice(stepIndex+1).map(step=>[step.id,(draft.steps.indexOf(step)+1)+'. '+label(step)]))};
      const input = value => value === undefined ? '' : String(value / 1000).replace('.',',');
      return `${back('editor','К списку шагов')}${hero(existing ? 'Настройка шага' : 'Добавить шаг','Редактор сценария',true)}
        <form data-form="scenario-step">
          <label>Действие<select name="type">${options(kinds,type)}</select></label>
          ${['difference','condition','work'].includes(type) ?
            `<div><div class="help-title"><label for="scenario-source">Данные из шага</label>
              ${help('данные из шага','Панель возьмёт результат уже пройденного шага. Этот шаг должен выполняться на каждой ветке, которая ведёт сюда.')}</div>
              <select name="source" id="scenario-source">${options(sourceOptions,defaultSource)}</select></div>` :
            '<p>Запись для этого шага выбирается при выполнении сценария.</p>'}
          ${type === 'condition' ? `${sourceType === 'difference' ?
            `<label>Что проверяем<select name="metric">${options(metrics,step.metric || 'shortage')}</select></label>
              <label>Единица порога<select name="unit">${options(units,step.unit || 'l')}</select></label>` :
              '<p>Порог сравнивается с количеством открытых отклонений или неподтверждённых пунктов.</p>'}
            <label>Условие перехода<select name="operator">${options(comparisons,step.operator ?? 'gt')}</select></label>
            <label>Порог<input name="threshold" inputmode="decimal" maxlength="12" value="${escape(step.rawThreshold ?? input(step.threshold))}" required></label>
            <div><div class="help-title"><label for="scenario-if-yes">Если да</label>
              ${help('переходы','При выполнении условия панель предложит ветку «Да», иначе — ветку «Нет». Можно перейти вперёд или завершить выполнение.')}</div>
              <select name="yes" id="scenario-if-yes">${options(targets,step.yes ?? 'next')}</select></div>
            <label>Если нет<select name="no">${options(targets,step.no ?? 'end')}</select></label>` : ''}
          ${type === 'work' ? `<label>Название дела · по желанию<input name="title" maxlength="140" value="${escape(step.title)}"></label>
            <label>Ответственный · по желанию<input name="owner" maxlength="120" value="${escape(step.owner)}"></label>` : ''}
          ${warning}${submit('Сохранить шаг')}
        </form>`;
    }

    function recordsFor(type) {
      const data = records();
      if (type === 'inventory') return (data.stock ?? []).flatMap(ledger=>{
        const items = new Map(ledger.items.map(row=>[row.id,row]));
        return ledger.journal.filter(row=>row.kind === 'count').map(row=>{
          const caption = dateText(row.date + 'T12:00:00Z') + ' · ' + row.lines.map(line=>items.get(line.itemId).name).join(', ');
          const lines = row.lines.map(line=>({id:line.itemId,name:items.get(line.itemId).name,unit:items.get(line.itemId).unit,
            expected:line.expected,actual:line.actual}));
          return {id:JSON.stringify([ledger.id,row.id]),pointId:ledger.id,label:caption,lines};
        });
      }).reverse();
      if (type === 'audit') return (data.audits ?? []).filter(row=>row.completedAt).map(row=>({
        id:row.id,pointId:row.pointId,label:dateText(row.completedAt) + ' · ' + row.drinks.map(drink=>drink.title).join(', '),
        count:row.drinks.flatMap(drink=>drink.checks).filter(window.panel03Audits.isOpenIssue).length,
      })).reverse();
      return (data.rollouts ?? []).flatMap(row=>row.sites.map(site=>({id:JSON.stringify([row.id,site.id]),pointId:site.id,
        label:row.title,count:rolloutRemaining(site)}))).reverse();
    }

    function contextText(out,type) {
      if (type === 'condition') return out.label;
      if (type === 'work') return out.label || 'Рабочее дело создано.';
      if (type === 'audit') return pointName(out.pointId) + ' · Открытых отклонений: ' + out.count;
      if (type === 'readiness') return pointName(out.pointId) + ' · Не подтверждено пунктов: ' + out.count;
      if (type === 'inventory') return pointName(out.pointId) + ' · ' + out.label;
      const line = out.line;
      const amounts = pointName(out.pointId) + ' · ' + line.name + '\nПо учёту: ' +
        (line.expected === null ? 'нет начального остатка' : formatAmount(line.expected,line.unit)) +
        '\nПо факту: ' + formatAmount(line.actual,line.unit);
      if (line.expected === null) return amounts;
      const difference = variance(line);
      if (difference === 0n) return amounts + '\nРасхождений нет.';
      return amounts + (difference < 0n ? '\nНедостача: ' : '\nИзлишек: ') +
        formatAmount(difference < 0n ? -difference : difference,line.unit);
    }

    function dataSelect(items,caption,labels) {
      return `<label>${caption}<select name="input">${options({'':'Выбрать',...Object.fromEntries(items.map(row=>[row.id,labels(row)]))},'')}</select></label>`;
    }

    function runStep(row,step) {
      const source = outputOf(row,step.source);
      if (['inventory','audit','readiness'].includes(step.type)) {
        const items = recordsFor(step.type);
        return items.length ? `<form data-form="scenario-input">${dataSelect(items,'Запись',row=>pointName(row.pointId) + ' · ' + row.label)}
          ${warning}${submit('Продолжить')}</form>` : '<p class="empty">В панели пока нет подходящей записи для этого шага.</p>';
      }
      if (step.type === 'difference') {
        return `<form data-form="scenario-input">${dataSelect(source.lines,'Сырьё',line=>line.name + ' · ' + units[line.unit])}
          ${warning}${submit('Рассчитать расхождение')}</form>`;
      }
      if (step.type === 'condition') {
        const result = evaluate(step,source);
        return `<section class="section audit-layout"><p class="record">${escape(contextText(source,stepOf(row.steps,step.source).type))}</p>
          <p>${escape(step.unit ? metrics[step.metric] + ' · ' : '')}${escape(thresholdLabel(step))}</p>
          <p><strong>${escape(result.error || result.label)}</strong></p></section>
          ${result.error ? '' : action('condition','Продолжить по ветке «' + (result.answer ? 'Да' : 'Нет') + '»',{primary:true})}`;
      }
      const workTitle = step.title || (source ? 'Проверить · ' + source.label : 'Дело по сценарию · ' + row.name);
      return `<section class="section audit-layout"><h2>Рабочее дело</h2><p>${escape(workTitle)}</p>
        ${source ? `<p class="record">${escape(contextText(source,stepOf(row.steps,step.source).type))}</p>` : ''}
        ${step.owner ? `<p>Ответственный: ${escape(step.owner)}</p>` : ''}</section>
        ${action('work','Открыть форму дела',{primary:true})}`;
    }

    function execution() {
      const row = run();
      const running = row.status === 'running';
      const previous = row.entries.at(-1);
      return `${back('home','Сценарии')}${hero(row.name,running ? 'Шаг ' + (row.cursor+1) + ' из ' + row.steps.length : labels[row.status],true)}
        <div class="audit-layout">
          ${row.entries.length ? `<details class="section" ${running ? '' : 'open'}><summary>Выполненные шаги</summary>
            <ol class="scenario-steps">${row.entries.map(entry=>{
              const step = stepOf(row.steps,entry.id);
              return `<li class="audit-result"><strong>${label(step)}</strong><p class="record">${escape(contextText(entry.output,step.type))}</p>
                ${entry.output.workId && records().events.some(row=>row.id===entry.output.workId) ?
                  action('open-work','Открыть дело',{data:ref('work-id',entry.output.workId)}) : ''}</li>`;
            }).join('')}</ol></details>` : ''}
          ${running ? `<h2>${label(row.steps[row.cursor])}</h2>${runStep(row,row.steps[row.cursor])}
            ${action('home','Продолжить позже')}
            ${previous && stepOf(row.steps,previous.id).type !== 'work' ? action('previous','К предыдущему шагу') : ''}
            ${action('stop','Остановить выполнение')}` : ''}
        </div>`;
    }

    function draw() {
      if (screen === 'template') return preview();
      if (screen === 'editor') return editor();
      if (screen === 'step') return configure();
      if (screen === 'run') return execution();
      return home();
    }

    function warn(form,message) {
      const node = form.querySelector('[role=alert]');
      node.textContent = message;
      node.hidden = false;
    }

    function remember(form) {
      const type = form.elements.type.value;
      const step = {id:stepDraft.id,type};
      const get = name=>form.elements[name]?.value ?? '';
      if (['difference','condition','work'].includes(type)) step.source = get('source');
      if (type === 'condition') {
        Object.assign(step,{threshold:stock.readQuantity(get('threshold')),unit:get('unit'),metric:get('metric'),
          operator:get('operator'),yes:get('yes'),no:get('no')});
      }
      if (type === 'work') Object.assign(step,{title:get('title').trim(),owner:get('owner').trim()});
      return step;
    }

    function setStep(step) {
      draft.steps[stepIndex] = step;
      dirty = true;
    }

    function storeRun(updated,message) {
      const rows = book();
      const runs = rows.runs.some(row=>row.id === updated.id) ?
        rows.runs.map(row=>row.id === updated.id ? updated : row) : [...rows.runs,updated];
      if (!commit({...rows,runs})) return;
      runId = updated.id;
      show('run',message);
    }

    function submitForm(form) {
      if (form.dataset.form === 'scenario-editor') {
        const name = form.elements.name.value.trim();
        const error = planError(draft.steps);
        if (!name || error) return warn(form,error || 'Укажи название сценария.');
        const row = {...draft,name,id:templateId ?? crypto.randomUUID()};
        const data = book();
        const templates = templateId ? data.templates.map(item=>item.id === row.id ? row : item) : [...data.templates,row];
        if (commit({...data,templates})) {
          templateId = row.id;
          dirty = false;
          show('template','Сценарий сохранён.');
        }
        return;
      }
      if (form.dataset.form === 'scenario-step') {
        const updated = remember(form);
        if (updated.type === 'condition' && updated.threshold === null) return warn(form,'Укажи число для порога.');
        setStep(updated);
        show('editor');
        return;
      }
      const row = run(), step = row.steps[row.cursor];
      const value = form.elements.input.value;
      const context = outputOf(row,step.source);
      const out = step.type === 'difference' ? context.lines.find(line=>line.id === value) :
        recordsFor(step.type).find(item=>item.id === value);
      if (!out) return warn(form,'Выбери запись для шага.');
      const output = step.type === 'difference' ? {pointId:context.pointId,label:out.name,line:out} : out;
      storeRun(advance(row,output));
    }

    function beforeLeave() {
      return !dirty || window.confirm('Выйти без сохранения изменений сценария?');
    }

    function click(button) {
      const {scenarioAction:name,index,templateId:id,runId:chosen,workId} = button.dataset;
      if (name === 'exit') return exit();
      if (name === 'home') return show('home');
      if (name === 'editor-back') {
        if (beforeLeave()) {
          dirty = false;
          show(templateId ? 'template' : 'home');
        }
        return;
      }
      if (name === 'editor') return show('editor');
      if (name === 'template') {
        templateId = id;
        return show('template');
      }
      if (name === 'new' || name === 'edit') {
        if (name === 'new') templateId = undefined;
        draft = template() ? {...template(),steps:[...template().steps]} : {name:'',steps:[]};
        dirty = false;
        return show('editor');
      }
      if (['add-step','edit-step','up','down','remove'].includes(name)) {
        draft.name = getMain().querySelector('[data-form=scenario-editor]').elements.name.value;
        stepIndex = name === 'add-step' ? draft.steps.length : Number(index);
        if (name === 'add-step' || name === 'edit-step') {
          stepDraft = draft.steps[stepIndex] ?? {id:crypto.randomUUID(),type:'inventory'};
          return show('step');
        }
        dirty = true;
        if (name === 'remove') draft.steps.splice(stepIndex,1);
        else {
          const target = stepIndex + (name === 'up' ? -1 : 1);
          [draft.steps[target],draft.steps[stepIndex]] = [draft.steps[stepIndex],draft.steps[target]];
        }
        return show('editor');
      }
      if (name === 'start') {
        const row = template();
        return storeRun({id:crypto.randomUUID(),templateId:row.id,name:row.name,steps:row.steps,
          createdAt:new Date().toISOString(),cursor:0,entries:[],status:'running'});
      }
      if (name === 'open-run') {
        runId = chosen;
        return show('run');
      }
      if (name === 'open-work') return openWork(workId);
      const row = run(), step = row.steps[row.cursor];
      if (name === 'previous') {
        const previous = row.entries.at(-1);
        const priorIndex = row.steps.findIndex(step=>step.id === previous?.id);
        if (priorIndex !== -1 && row.steps[priorIndex].type !== 'work') return storeRun({...row,cursor:priorIndex,entries:row.entries.slice(0,-1)});
      }
      if (name === 'stop' && window.confirm('Остановить этот проход сценария?')) return storeRun({...row,status:'stopped'});
      if (name === 'condition') {
        const result = evaluate(step,outputOf(row,step.source));
        if (!result.error) storeRun(advance(row,result));
      }
      if (name === 'work') {
        const source = outputOf(row,step.source);
        const title = step.title || (source ? 'Проверить · ' + source.label : 'Дело по сценарию · ' + row.name);
        const context = source ? contextText(source,stepOf(row.steps,step.source).type) : '';
        return newWork({runId:row.id,stepId:step.id,label:context},title.slice(0,200),source?.pointId,step.owner || undefined);
      }
    }

    function change(field) {
      if (field.form?.dataset.form !== 'scenario-step') return;
      dirty = true;
      if (field.name === 'type') {
        stepDraft = {id:stepDraft.id,type:field.value};
        show('step');
      } else if (field.name === 'source' && stepDraft.type === 'condition') {
        stepDraft = {...remember(field.form),rawThreshold:field.form.elements.threshold.value};
        show('step');
      }
    }

    function input(field) {
      if (['scenario-editor','scenario-step'].includes(field.form?.dataset.form)) dirty = true;
    }

    return {open,draw,click,submit:submitForm,change,input,beforeLeave};
  }

  return {create,validate,linkWork,sourceForWork};
})();
