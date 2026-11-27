'use strict';
window.panel03Audits = (() => {
  const criteria = [
    {id:'version', label:'Смена использует действующую техкарту', task:'Обновить техкарту на смене'},
    {id:'ingredients', label:'Состав и дозировки соответствуют техкарте', task:'Сверить состав и дозировки на смене'},
    {id:'method', label:'Порядок приготовления соответствует техкарте', task:'Скорректировать порядок приготовления'},
  ];
  const outcomes = {pass:'Соответствует', issue:'Отклонение', skip:'Не проверено'};
  const text = value => typeof value === 'string';
  const present = value => text(value) && Boolean(value.trim());
  const instant = value => text(value) && Number.isFinite(Date.parse(value));

  function validStandard(version) {
    return version && present(version.id) && instant(version.publishedAt) && present(version.method) &&
      Array.isArray(version.ingredients) && version.ingredients.length > 0 &&
      version.ingredients.every(row => row && present(row.name) && present(row.amount) && present(row.unit));
  }

  function validAnswer(answer, allowed, partial = false) {
    return answer && text(answer.note) && ((partial && answer.result === '') ||
      (allowed.includes(answer.result) && (partial || answer.result !== 'issue' || present(answer.note))));
  }

  function validate(audits, points) {
    const pointIds = new Set(points.map(point => point.id));
    const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
    const check = (row, position, finished) => row && row.id === criteria[position].id &&
      validAnswer(row, Object.keys(outcomes), !finished) &&
      (row.workId === undefined || (finished && row.result === 'issue' && present(row.workId))) &&
      Array.isArray(row.rechecks) && row.rechecks.every(entry =>
        entry && finished && row.result === 'issue' && instant(entry.at) && validStandard(entry.standard) && validAnswer(entry, ['pass','issue'])) &&
      row.rechecks.slice(0,-1).every(entry => entry.result === 'issue');
    return Array.isArray(audits) && audits.every(audit =>
      audit && present(audit.id) && pointIds.has(audit.pointId) && audit.template === 'recipes' &&
      instant(audit.createdAt) && (audit.completedAt === '' || instant(audit.completedAt)) &&
      Array.isArray(audit.drinks) && audit.drinks.length > 0 && audit.drinks.every(drink =>
        drink && present(drink.id) && present(drink.title) && validStandard(drink.standard) &&
        Array.isArray(drink.checks) && drink.checks.length === criteria.length &&
        drink.checks.every((row, position) => check(row, position, Boolean(audit.completedAt)))) &&
      unique(audit.drinks) && Number.isSafeInteger(audit.cursor) && audit.cursor >= 0 &&
      audit.cursor < audit.drinks.length * criteria.length) && unique(audits);
  }

  const closed = check => check.rechecks.at(-1)?.result === 'pass';

  function issueAt(audit, drinkId, checkId) {
    const drink = audit?.drinks.find(row => row.id === drinkId);
    const check = drink?.checks.find(row => row.id === checkId);
    return audit?.completedAt && check?.result === 'issue' ? {audit,drink,check} : null;
  }

  function updateCheck(audit, drinkId, checkId, changes) {
    return {...audit, drinks:audit.drinks.map(drink => drink.id === drinkId
      ? {...drink, checks:drink.checks.map(check => check.id === checkId ? {...check,...changes} : check)} : drink)};
  }

  function sourceForWork(audits, workId) {
    for (const audit of audits) {
      for (const drink of audit.drinks) {
        const check = drink.checks.find(row => row.workId === workId);
        if (check) return {audit,drink,check};
      }
    }
    return null;
  }

  function create({records, hero, escape, effective, getMain, commit, redraw, exit, newWork, openWork}) {
    const date = new Intl.DateTimeFormat('ru', {dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
    const stamp = value => date.format(new Date(value));
    const action = (name, label, {primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-audit-action="${name}" ${data}>${label}</button>`;
    const ref = (name, value) => `data-${name}="${escape(value)}"`;
    const back = (name, label) => `<button type="button" class="back" data-audit-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const audits = () => records().audits ?? [];
    const point = () => records().points.find(row => row.id === pointId);
    const audit = () => audits().find(row => row.id === auditId);
    const pointAudits = () => audits().filter(row => row.pointId === pointId);
    const work = id => records().events.find(row => row.id === id);
    const criterion = id => criteria.find(row => row.id === id);
    const standardFor = id => {
      const item = records().recipes?.find(row => row.id === id);
      const version = item && effective(item, pointId);
      if (!version) return null;
      const {publishedAt, method, ingredients} = version;
      return {id:version.id, publishedAt, method, ingredients};
    };

    let pointId, auditId, screen, fromStandard, recheck, selection;

    function open(id, inspectionId) {
      pointId = id;
      auditId = inspectionId;
      screen = !inspectionId ? 'home' : audit().completedAt ? 'summary' : 'check';
      recheck = null;
      selection = null;
    }

    function setScreen(next, message) {
      screen = next;
      redraw(message);
    }

    function store(next) {
      const exists = audits().some(row => row.id === next.id);
      return commit(exists ? audits().map(row => row.id === next.id ? next : row) : [...audits(), next]);
    }

    function auditRow(row) {
      const titles = row.drinks.map(drink => drink.title).join(' · ');
      const openIssues = row.drinks.flatMap(drink => drink.checks).filter(check => check.result === 'issue' && !closed(check)).length;
      const state = !row.completedAt ? 'Черновик' : openIssues ? 'Открытые отклонения: ' + openIssues : 'Завершён';
      return action('open', `<strong>${escape(titles)}</strong><small>${escape(state)} · ${escape(stamp(row.completedAt || row.createdAt))}</small>`,
        {data:ref('audit-id', row.id)});
    }

    function home() {
      const choices = (records().recipes ?? []).filter(row => effective(row, pointId));
      const drafts = pointAudits().filter(row => !row.completedAt).reverse();
      return `${back('point', 'Карточка точки')}${hero('Аудиты точки', point().name, true)}
        <div class="audit-layout">
          ${drafts.length ? `<section class="section audit-layout"><h2>Черновики</h2><div class="audit-list">${drafts.map(auditRow).join('')}</div></section>` : ''}
          ${choices.length ? `<form data-form="audit-start">
            <section class="section"><h2>Напитки по техкартам</h2><p>Сверка версии, состава и приготовления.</p></section>
            <fieldset class="point-picker"><legend>Напитки</legend><div class="audit-choices">${choices.map(({id,name,volumeMl}) =>
              `<label class="check"><input type="checkbox" name="drink" value="${escape(id)}"${(selection ? selection.includes(id) : choices.length === 1) ? ' checked' : ''}>
                ${escape(name)} ${volumeMl} мл</label>`).join('')}</div></fieldset>
            <p class="notice audit-error" role="alert" hidden></p>${submit('Начать аудит')}</form>`
            : '<p class="empty">Для точки нужна действующая техкарта. Добавь её во вкладке «Меню».</p>'}
          ${action('history','История аудитов')}
        </div>`;
    }

    function history() {
      const rows = pointAudits().filter(row => row.completedAt).reverse();
      return `${back('home', 'Аудиты точки')}${hero('История аудитов', point().name, true)}
        ${rows.length ? `<div class="audit-list">${rows.map(auditRow).join('')}</div>` : '<p class="empty">Завершённых аудитов пока нет.</p>'}`;
    }

    function current(inspection = audit()) {
      const drink = inspection.drinks[Math.floor(inspection.cursor / criteria.length)];
      return {drink, check:drink.checks[inspection.cursor % criteria.length]};
    }

    function answerFields(values, isRecheck = false) {
      return `<fieldset class="audit-options"><legend>Результат</legend><div>${Object.entries(outcomes)
        .filter(([id]) => !isRecheck || id !== 'skip').map(([id,label]) =>
          `<label><input type="radio" name="result" value="${id}"${values.result === id ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
        <label>Что обнаружено<textarea name="note" maxlength="1200" rows="3">${escape(values.note)}</textarea></label>
        <p class="notice audit-error" role="alert" hidden></p>`;
    }

    function step() {
      const record = audit();
      const {drink,check} = current(record);
      const size = record.drinks.length * criteria.length;
      return `${hero(drink.title, point().name + ' · Проверка ' + (record.cursor + 1) + ' из ' + size, true)}
        <form data-form="audit-step">
          <section class="section audit-layout">
            <h2>${criterion(check.id).label}</h2>
            ${action('standard','Открыть техкарту проверки')}
          </section>
          ${answerFields(check)}
          ${submit(record.cursor + 1 === size ? 'Завершить аудит' : 'Дальше')}
          ${record.cursor ? action('previous','Предыдущий пункт') : ''}
          ${action('pause','Продолжить позже')}
        </form>`;
    }

    function recheckForm() {
      const {drink,check} = issueAt(audit(), recheck.drinkId, recheck.checkId);
      return `${back('summary','Итог аудита')}${hero('Перепроверка', point().name + ' · ' + drink.title, true)}
        <form data-form="audit-recheck">
          <section class="section audit-layout"><h2>${criterion(check.id).label}</h2>
            <p class="record">${escape(check.note)}</p>${action('standard','Открыть действующую техкарту')}</section>
          ${answerFields(recheck, true)}
          ${submit('Сохранить перепроверку')}
        </form>`;
    }

    function standard() {
      const {drink,standard:version} = fromStandard;
      return `${back('close-standard', fromStandard.returnTo === 'summary' ? 'К итогу аудита' : 'К проверке')}${hero(drink.title, 'Техкарта · ' + point().name, true)}
        <div class="audit-layout"><p>Версия от ${escape(stamp(version.publishedAt))}</p>
          <section class="section"><h2>Состав на порцию</h2><ul class="recipe-composition">${version.ingredients.map(row =>
            `<li><span>${escape(row.name)}</span><strong>${escape(row.amount.replace('.', ','))} ${escape(row.unit)}</strong></li>`).join('')}</ul></section>
          <section class="section"><h2>Порядок приготовления</h2><p class="record">${escape(version.method)}</p></section>
        </div>`;
    }

    function issueCard(drink, check) {
      const event = work(check.workId);
      const refData = ref('drink-id', drink.id) + ' ' + ref('check-id', check.id);
      const isClosed = closed(check);
      return `<li class="audit-result">
        <div class="audit-result-title"><strong>${criterion(check.id).label}</strong><span class="audit-status" data-outcome="${isClosed ? 'pass' : 'issue'}">${isClosed ? 'Закрыто' : 'Отклонение'}</span></div>
        <p class="record">${escape(check.note)}</p>
        ${event ? action('work', 'Открыть связанное дело', {data:ref('work-id', event.id)}) :
          !isClosed ? action('new-work', 'Создать дело по отклонению', {primary:true,data:refData}) : ''}
        ${check.rechecks.map((row, index) => `<div class="audit-recheck-log">
          <p><strong>${escape(outcomes[row.result])}</strong> · ${escape(stamp(row.at))}</p>
          ${row.note ? `<p class="record">${escape(row.note)}</p>` : ''}
          ${action('recheck-standard', 'Техкарта перепроверки', {data:refData + ' ' + ref('recheck-index', index)})}
        </div>`).join('')}
        ${isClosed ? '' : action('recheck', 'Перепроверить на точке', {data:refData})}
      </li>`;
    }

    function summary() {
      const record = audit();
      const checks = record.drinks.flatMap(drink => drink.checks);
      const issues = checks.filter(check => check.result === 'issue').length;
      return `${back('history','История аудитов')}${hero('Итог аудита', point().name, true)}
        <div class="audit-layout">
          <p>${escape(stamp(record.completedAt))}</p>
          <div class="task-badges"><span class="task-badge">Соответствует: ${checks.filter(row => row.result === 'pass').length}</span>
            <span class="task-badge">Отклонения: ${issues}</span><span class="task-badge">Не проверено: ${checks.filter(row => row.result === 'skip').length}</span></div>
          ${record.drinks.map(drink => `<section class="section audit-layout"><h2>${escape(drink.title)}</h2>
            ${action('audit-standard','Техкарта на момент аудита',{data:ref('drink-id',drink.id)})}
            <ul class="audit-results">${drink.checks.map(check => check.result === 'issue' ? issueCard(drink,check) :
              `<li class="audit-result"><div class="audit-result-title"><strong>${criterion(check.id).label}</strong>
                <span class="audit-status" data-outcome="${check.result}">${outcomes[check.result]}</span></div>
                ${check.note ? `<p class="record">${escape(check.note)}</p>` : ''}</li>`).join('')}</ul></section>`).join('')}
        </div>`;
    }

    function draw() {
      if (screen === 'home') return home();
      if (screen === 'history') return history();
      if (screen === 'check') return step();
      if (screen === 'recheck') return recheckForm();
      if (screen === 'standard') return standard();
      return summary();
    }

    function warn(form, message, field) {
      const notice = form.querySelector('[role=alert]');
      notice.textContent = message;
      notice.hidden = false;
      field?.focus();
    }

    function answer(form) {
      const values = new FormData(form);
      return {result:String(values.get('result') ?? ''), note:String(values.get('note') ?? '').trim()};
    }

    function checkAnswer(form, values) {
      if (!values.result) {
        warn(form, 'Выбери результат проверки.', form.querySelector('input[name=result]'));
        return false;
      }
      if (values.result === 'issue' && !values.note) {
        warn(form, 'Опиши, что обнаружено.', form.elements.note);
        return false;
      }
      return true;
    }

    function start(form) {
      selection = new FormData(form).getAll('drink');
      if (!selection.length) {
        warn(form,'Отметь хотя бы один напиток.', form.querySelector('input[name=drink]'));
        return;
      }
      const drinks = selection.map(id => {
        const item = records().recipes.find(row => row.id === id);
        return {id, title:item.name + ' ' + item.volumeMl + ' мл', standard:standardFor(id),
          checks:criteria.map(({id}) => ({id, result:'', note:'', rechecks:[]}))};
      });
      const id = crypto.randomUUID();
      if (!store({id, pointId, template:'recipes', createdAt:new Date().toISOString(), completedAt:'', cursor:0, drinks})) return;
      auditId = id;
      setScreen('check');
    }

    function saveStep(form, next, requireAnswer = false) {
      const record = audit();
      const {drink,check} = current(record);
      const values = answer(form);
      if (requireAnswer && !checkAnswer(form, values)) return false;
      const updated = updateCheck(record, drink.id, check.id, values);
      if (next >= record.drinks.length * criteria.length) {
        const all = updated.drinks.flatMap(row => row.checks);
        const missing = all.findIndex(row => !validAnswer(row, Object.keys(outcomes)));
        if (missing !== -1) {
          if (!store({...updated,cursor:missing})) return false;
          setScreen('check', 'Заполни этот пункт перед завершением аудита.');
          return false;
        }
        return store({...updated,completedAt:new Date().toISOString()});
      }
      const unchanged = check.result === values.result && check.note === values.note && record.cursor === next;
      return unchanged || store({...updated,cursor:next});
    }

    function submitForm(form) {
      if (screen === 'home') return start(form);
      if (screen === 'check') {
        const next = audit().cursor + 1;
        const complete = next === audit().drinks.length * criteria.length;
        if (saveStep(form,next,true)) setScreen(complete ? 'summary' : 'check', complete ? 'Аудит сохранён.' : '');
        return;
      }
      if (screen === 'recheck') {
        const values = answer(form);
        if (!checkAnswer(form,values)) return;
        const {audit:record, drink, check} = issueAt(audit(),recheck.drinkId,recheck.checkId);
        const entry = {...values, at:new Date().toISOString(), standard:recheck.standard};
        if (!store(updateCheck(record,drink.id,check.id,{rechecks:[...check.rechecks,entry]}))) return;
        recheck = null;
        setScreen('summary', values.result === 'pass' ? 'Отклонение закрыто.' : 'Перепроверка сохранена. Отклонение открыто.');
      }
    }

    function beforeLeave() {
      if (screen === 'check') return saveStep(getMain().querySelector('[data-form=audit-step]'), audit().cursor);
      if (screen === 'recheck') {
        const values = answer(getMain().querySelector('[data-form=audit-recheck]'));
        return (!values.result && !values.note) || window.confirm('Выйти без сохранения перепроверки?');
      }
      if (screen === 'standard' && fromStandard.returnTo === 'recheck' && (recheck.result || recheck.note)) {
        return window.confirm('Выйти без сохранения перепроверки?');
      }
      return true;
    }

    function showStandard(drink, standard) {
      fromStandard = {drink, standard, returnTo:screen};
      setScreen('standard');
    }

    function click(button) {
      const {auditAction:name, auditId:chosen, drinkId, checkId, workId, recheckIndex} = button.dataset;
      if (name === 'point') return exit(point());
      if (name === 'home' || name === 'history') return setScreen(name);
      if (name === 'summary') {
        if (beforeLeave()) setScreen('summary');
        return;
      }
      if (name === 'open') {
        open(pointId,chosen);
        return redraw();
      }
      if (name === 'previous' || name === 'pause') {
        const next = audit().cursor - (name === 'previous' ? 1 : 0);
        if (saveStep(getMain().querySelector('[data-form=audit-step]'),next)) {
          setScreen(name === 'previous' ? 'check' : 'home', name === 'pause' ? 'Черновик сохранён.' : '');
        }
        return;
      }
      if (name === 'close-standard') return setScreen(fromStandard.returnTo);
      if (name === 'standard') {
        if (screen === 'check' && beforeLeave()) {
          const {drink} = current();
          showStandard(drink,drink.standard);
        } else if (screen === 'recheck') {
          recheck = {...recheck,...answer(getMain().querySelector('[data-form=audit-recheck]'))};
          showStandard(issueAt(audit(),recheck.drinkId,recheck.checkId).drink,recheck.standard);
        }
        return;
      }
      if (name === 'audit-standard') {
        const drink = audit().drinks.find(row => row.id === drinkId);
        return showStandard(drink,drink.standard);
      }
      if (name === 'work') return openWork(workId);
      const issue = issueAt(audit(),drinkId,checkId);
      if (!issue) return;
      if (name === 'recheck-standard') return showStandard(issue.drink,issue.check.rechecks[Number(recheckIndex)].standard);
      if (name === 'new-work' && !closed(issue.check)) {
        const title = criterion(checkId).task + ' · ' + issue.drink.title;
        return newWork({auditId, drinkId, checkId},issue.audit.pointId,title.slice(0,200));
      }
      if (name === 'recheck' && !closed(issue.check)) {
        const version = standardFor(drinkId);
        if (!version) return redraw('Для перепроверки нужна действующая техкарта.');
        recheck = {drinkId,checkId,standard:version,result:'',note:''};
        setScreen('recheck');
      }
    }

    return {open, draw, click, submit:submitForm, beforeLeave};
  }

  return {validate, issueAt, updateCheck, sourceForWork, create};
})();
