'use strict';
window.panel03ReviewOutcomes = (() => {
  const {sourceKey} = window.panel03NetworkReviews;
  const stock = window.panel03Stock;
  const {formatRate} = window.panel03Economy;
  const {rateFor,findPeriod} = window.panel03PeriodReports;
  const {nextMonth,limitFrom} = window.panel03NetworkGoals;
  const kinds = {foodcost:'Фактический фудкост',audit:'Перепроверка аудита',stock:'Новый пересчёт сырья'};
  const idFor = (review,key) => JSON.stringify([review,key]);
  const text = value => typeof value === 'string' && Boolean(value.trim());
  const amount = value => Number.isSafeInteger(value) && value >= 0;
  const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const sameCriterion = (a,b) => a.kind === b.kind && a.start === b.start && a.end === b.end &&
    a.limit === b.limit && a.unit === b.unit;
  const matches = (attempt,criterion,evidence) => sameCriterion(attempt.criterion,criterion) &&
    attempt.evidence.value === evidence.value && attempt.evidence.recordId === evidence.recordId &&
    attempt.evidence.at === evidence.at;
  const passed = ({criterion,evidence}) => criterion.kind === 'audit' ? evidence.value === 'pass' :
    BigInt(evidence.value) <= BigInt(criterion.limit);

  function validate(rows,reviews,validDay) {
    const parents = new Map(reviews.map(row => [row.id,row]));
    function goodRow(row) {
      if (!row || !text(row.reviewId) || !text(row.decisionKey) || row.id !== idFor(row.reviewId,row.decisionKey)) return false;
      let key;
      try { key = JSON.parse(row.decisionKey); } catch { return false; }
      if (!Array.isArray(key) || key.length !== 8 || !key.every(part => typeof part === 'string') ||
          !Object.hasOwn(window.panel03NetworkOverview.categories,key[0])) return false;
      const review = parents.get(row.reviewId);
      function goodCriterion(item) {
        if (item?.kind === 'foodcost') return validDay(item.start) && validDay(item.end) &&
          (!review || item.start > review.end) && item.end >= item.start && amount(item.limit) && item.limit <= 10000;
        if (item?.kind === 'audit') return key[0] === 'audit';
        return item?.kind === 'stock' && key[0] === 'stock' && amount(item.limit) &&
          typeof item.unit === 'string' && Object.hasOwn(stock.units,item.unit);
      }
      function goodAttempt(item) {
        if (!item || !text(item.id) || !stamp(item.savedAt) || !goodCriterion(item.criterion) || !item.evidence) return false;
        const {value,recordId,at} = item.evidence;
        const kind = item.criterion.kind;
        const validEvidence = kind === 'foodcost' ? typeof value === 'string' && /^\d{1,64}$/.test(value) :
          kind === 'audit' ? ['pass','issue'].includes(value) && stamp(at) && amount(recordId) :
          amount(value) && text(recordId) && validDay(at);
        return validEvidence && (item.followup === undefined || (!passed(item) && text(item.followup?.id) &&
          (item.followup.slot === '' || validDay(item.followup.slot))));
      }
      return goodCriterion(row.criterion) && Array.isArray(row.attempts) && row.attempts.every(goodAttempt) &&
        new Set(row.attempts.map(item => item.id)).size === row.attempts.length;
    }
    return Array.isArray(rows) && rows.every(goodRow) && new Set(rows.map(row => row.id)).size === rows.length;
  }

  function merge(local,incoming) {
    const all = new Map(local.map(row => [row.id,row]));
    for (const row of incoming) {
      const saved = all.get(row.id);
      if (!saved) {
        all.set(row.id,row);
        continue;
      }
      const attempts = [...saved.attempts];
      for (const item of row.attempts) {
        const index = attempts.findIndex(old => old.id === item.id || matches(old,item.criterion,item.evidence));
        if (index === -1) attempts.push(item);
        else if (!attempts[index].followup && item.followup) attempts[index] = {...attempts[index],followup:item.followup};
      }
      all.set(row.id,{...saved,attempts});
    }
    return [...all.values()];
  }

  function observe(data,review,decision,criterion) {
    const source = decision.source;
    if (criterion.kind === 'audit') {
      const audit = data.audits?.find(item => item.id === source.id && item.pointId === source.pointId);
      const issue = window.panel03Audits.issueAt(audit,source.drinkId,source.checkId);
      const checks = issue?.check.rechecks ?? [];
      const index = checks.findLastIndex(row => Date.parse(row.at) >= Date.parse(issue.audit.completedAt));
      const last = checks[index];
      return last ? {evidence:{value:last.result,at:last.at,recordId:index}} :
        {waiting:'Ждём повторную проверку аудита.'};
    }
    if (criterion.kind === 'stock') {
      const book = data.stock?.find(item => item.id === source.pointId);
      const base = book?.journal.find(item => item.id === source.id);
      if (!base) return {waiting:'Исходный пересчёт недоступен.'};
      const latest = stock.latestCounts(book).get(source.itemId);
      if (!latest || latest.row.id === base.id) return {waiting:'Ждём новый подтверждённый пересчёт этой позиции.'};
      if (latest.line.expected === null) return {waiting:'В новом пересчёте пока нет учётного остатка.'};
      if (book.items.find(item => item.id === source.itemId)?.unit !== criterion.unit) return {waiting:'Единица учёта изменилась. Проверь критерий.'};
      return {evidence:{value:Math.max(0,latest.line.expected-latest.line.actual),recordId:latest.row.id,at:latest.row.date}};
    }
    const reports = data.periodReports ?? [];
    const fact = rateFor(reports,criterion.start,criterion.end,review.pointIds);
    if (fact.filled < review.pointIds.length) {
      const reported = new Set(findPeriod(reports,criterion.start,criterion.end)?.rows.map(item => item.pointId));
      const missing = review.pointIds.filter(id => !reported.has(id)).map(id => data.points.find(point => point.id === id)?.name ?? 'Точка');
      return {waiting:'Ждём отчёты по точкам · ' + missing.join(', ')};
    }
    return fact.rate === null ? {waiting:'Суммарная выручка равна нулю или отрицательна.'} : {evidence:{value:fact.rate}};
  }

  function statusFor(data,review,decision) {
    const row = data.reviewOutcomes?.find(item => item.id === idFor(review.id,sourceKey(decision.source)));
    if (!row) return 'К проверке';
    const last = newest(row.attempts);
    const {evidence} = observe(data,review,decision,row.criterion);
    if (evidence && !row.attempts.some(item => matches(item,row.criterion,evidence))) return 'К проверке';
    if (!last || !sameCriterion(last.criterion,row.criterion)) return 'Ждёт данных';
    return passed(last) ? 'Цель достигнута' : 'Нужно продолжение';
  }

  const newest = rows => rows.reduce((last,row) => !last || Date.parse(row.savedAt) >= Date.parse(last.savedAt) ? row : last,null);

  function linkWork(rows,origin,event) {
    const row = rows.find(item => item.id === origin.outcomeId);
    const attempt = row?.attempts.find(item => item.id === origin.attemptId);
    if (!attempt || passed(attempt) || attempt.followup) return null;
    const attempts = row.attempts.map(item => item.id === attempt.id ? {...item,followup:{id:event.id,slot:event.date}} : item);
    return rows.map(item => item.id === row.id ? {...item,attempts} : item);
  }

  function create({records,validDay,offsetDay,formatPeriod,hero,escape,options,redraw,exit,commit,
    openReport,openSource,lookupWork,openWork,newWork}) {
    const action = (name,label,{primary=false,ref=''}={}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-outcome-action="${name}" ${ref}>${label}</button>`;
    const back = (name,label) => `<button type="button" class="back" data-outcome-action="${name}">← ${label}</button>`;
    const all = () => records().reviewOutcomes ?? [];
    const current = () => all().find(row => row.id === outcomeId);
    const formatDate = value => formatPeriod(value,value);
    const auditDate = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
    const pointName = id => records().points.find(point => point.id === id)?.name ?? 'Точка';
    const workStatuses = window.panel03WorkItems.taskStatuses;
    let outcomeId, review, decision, editing, draft, dirty;

    function stockBook() { return records().stock?.find(row => row.id === decision.source.pointId); }
    function unitFor() { return stockBook()?.items.find(item => item.id === decision.source.itemId)?.unit; }

    function defaultCriterion(kind) {
      if (kind === 'audit') return {kind};
      if (kind === 'stock') return {kind,limit:0,unit:unitFor()};
      const pointIds = review.pointIds;
      const goal = records().networkGoals?.find(row => row.start === review.start && row.end === review.end &&
        row.pointIds.length === pointIds.length && pointIds.every(id => row.pointIds.includes(id)));
      const start = nextMonth(review.start), end = nextMonth(review.end,true);
      if (validDay(start) && validDay(end) && start > review.end) return {kind,start,end,limit:goal?.limit};
      const span = (Date.parse(review.end) - Date.parse(review.start)) / 86400000 + 1;
      return {kind,start:offsetDay(review.end,1),end:offsetDay(review.end,span),limit:goal?.limit};
    }

    function open(parent,item) {
      review = parent;
      decision = item;
      outcomeId = idFor(review.id,sourceKey(decision.source));
      editing = !current();
      const kind = decision.source.kind;
      draft = current()?.criterion ?? defaultCriterion(kind === 'audit' || (kind === 'stock' && unitFor()) ? kind : 'foodcost');
      dirty = false;
    }

    function store(row) {
      return commit([...all().filter(item => item.id !== row.id),row]);
    }


    const title = () => (decision.kind === 'work' && lookupWork(decision.work)?.entry.title) || decision.source.title;
    const threshold = ({kind,limit,unit}) => kind === 'audit' ? 'Соответствует' : 'Не выше ' +
      (kind === 'stock' ? stock.amount(limit,unit) : formatRate(limit));
    const evidenceText = ({criterion,evidence}) => criterion.kind === 'foodcost' ? formatRate(evidence.value) :
      criterion.kind === 'stock' ? stock.amount(evidence.value,criterion.unit) : evidence.value === 'pass' ? 'Соответствует' : 'Отклонение';
    function difference(criterion,evidence) {
      if (criterion.kind !== 'foodcost') return '';
      const delta = BigInt(evidence.value) - BigInt(criterion.limit);
      if (!delta) return '<p>Фудкост на уровне цели.</p>';
      return '<p>Фудкост ' + (delta > 0n ? 'выше' : 'ниже') + ' порога на ' +
        formatRate(delta < 0n ? -delta : delta).replace(' %',' п. п.') + '</p>';
    }

    function sourceButton(criterion,attemptId,waiting=false) {
      const label = criterion.kind === 'foodcost' ? 'Открыть контрольный отчёт' :
        criterion.kind === 'stock' ? waiting ? 'Открыть исходный пересчёт' : 'Открыть пересчёт' : 'Открыть аудит';
      return action('source',label,{ref:attemptId ? 'data-attempt="' + escape(attemptId) + '"' : ''});
    }

    function editor() {
      const allowed = {foodcost:kinds.foodcost};
      const kind = decision.source.kind;
      if (kind === 'audit' || (kind === 'stock' && (unitFor() || draft.kind === 'stock'))) allowed[kind] = kinds[kind];
      return `${back('cancel','К проверке')}${hero('Критерий проверки',title(),true)}
        <form data-form="review-outcome">
          <label>Источник факта<select name="kind">${options(allowed,draft.kind)}</select></label>
          ${draft.kind === 'foodcost' ? `<label>Начало контрольного периода<input type="date" name="start" value="${escape(draft.start)}" required></label>
          <label>Конец контрольного периода<input type="date" name="end" value="${escape(draft.end)}" required></label>
          <label>Максимальный фудкост, %<input name="limit" inputmode="decimal" value="${draft.limit === undefined ? '' :
            String(draft.limit/100).replace('.',',')}" required></label>` :
          draft.kind === 'stock' ? `<label>Допустимая недостача, ${stock.units[draft.unit]}<input name="limit" inputmode="decimal"
            value="${String(draft.limit/1000).replace('.',',')}" required></label>` :
          '<p class="record">Критерий · «Соответствует» в повторной проверке того же отклонения.</p>'}
          <p class="notice audit-error" role="alert" hidden></p>
          <button type="submit" class="action primary">Сохранить критерий</button>
        </form>`;
    }

    function history(row) {
      if (!row.attempts.length) return '';
      const attempts = [...row.attempts].reverse().sort((a,b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
      return `<section class="section audit-layout"><h2>История проверок</h2>${attempts.map(item => {
        const link = item.followup && lookupWork(item.followup);
        const result = passed(item) ? 'Цель достигнута' : 'Нужно продолжение';
        const ref = {ref:'data-attempt="' + escape(item.id) + '"'};
        return `<article class="review-decision audit-layout">
          <small>${escape(auditDate.format(new Date(item.savedAt)))} · ${kinds[item.criterion.kind]}</small>
          <strong>${result}</strong>
          <p>Критерий · ${threshold(item.criterion)}<br>Факт · ${evidenceText(item)}</p>
          ${item.criterion.kind === 'foodcost' ? `<small>${escape(formatPeriod(item.criterion.start,item.criterion.end))}</small>` :
            `<small>${escape(item.criterion.kind === 'audit' ? auditDate.format(new Date(item.evidence.at)) : formatDate(item.evidence.at))}</small>`}
          ${sourceButton(item.criterion,item.id)}
          ${link ? `<p>${escape(link.entry.title)} · ${workStatuses[link.work.status]}</p>${action('work','Открыть следующее дело',ref)}` :
            item.followup ? '<p class="empty">Следующее дело недоступно.</p>' :
            passed(item) ? '' : action('followup','Создать следующее дело',ref)}
          </article>`;
      }).join('')}</section>`;
    }

    function draw() {
      if (editing) return editor();
      const row = current();
      const {criterion} = row;
      const {evidence,waiting} = observe(records(),review,decision,criterion);
      const ready = evidence && !row.attempts.some(item => matches(item,criterion,evidence));
      const success = evidence && passed({criterion,evidence});
      const scope = criterion.kind === 'foodcost' ? review.pointIds.map(pointName).join(', ') : pointName(decision.source.pointId);
      return `${back('exit','К решению')}${hero('Проверка результата',title(),true)}
        <div class="audit-layout"><section class="section audit-layout"><h2>${kinds[criterion.kind]}</h2>
          <p>${escape(scope)}</p>
          ${criterion.kind === 'foodcost' ? `<p>Контрольный период · ${escape(formatPeriod(criterion.start,criterion.end))}</p>
            <p>Исходный фудкост · ${review.snapshot.current.rate === null ? 'Нет данных' : formatRate(review.snapshot.current.rate)}</p>` : ''}
          <p>Критерий · ${threshold(criterion)}</p>
          ${evidence ? `<p>Факт · <strong>${evidenceText({criterion,evidence})}</strong></p>
            <p><span class="audit-status" data-outcome="${success ? 'pass' : 'issue'}">${success ? 'Цель достигнута' : 'Нужно продолжение'}</span></p>
            ${difference(criterion,evidence)}
            ${ready ? action('save','Сохранить проверку',{primary:true}) +
              (success ? '' : action('save-work','Сохранить и создать новое дело')) : '<p>Эта проверка уже сохранена.</p>'}` :
            `<p><span class="task-badge">Ждёт данных</span></p><p>${escape(waiting)}</p>`}
          ${sourceButton(criterion,undefined,!evidence)}${action('edit','Изменить критерий')}</section>
          ${history(row)}</div>`;
    }

    function beforeLeave() { return !dirty || window.confirm('Выйти без сохранения критерия?'); }

    function submit(form) {
      const kind = form.elements.kind.value;
      let criterion = {kind};
      let error;
      if (kind === 'foodcost') {
        const start = form.elements.start.value, end = form.elements.end.value;
        const limit = limitFrom(form.elements.limit.value);
        criterion = {kind,start,end,limit};
        if (!validDay(start) || !validDay(end) || start <= review.end || end < start) {
          error = 'Контрольный период начинается после даты окончания разбора.';
        } else if (!amount(limit) || limit > 10000) error = 'Укажи фудкост от 0 до 100 % с точностью до двух знаков.';
      } else if (kind === 'stock') {
        const limit = stock.readQuantity(form.elements.limit.value);
        criterion = {kind,limit,unit:unitFor() ?? draft.unit};
        if (!amount(limit)) error = 'Укажи допустимую недостачу с точностью до трёх знаков.';
      }
      if (error) {
        const alert = form.querySelector('[role=alert]');
        alert.textContent = error;
        alert.hidden = false;
        return;
      }
      const row = current() ?? {id:outcomeId,reviewId:review.id,decisionKey:sourceKey(decision.source),attempts:[]};
      if (!store({...row,criterion})) return;
      dirty = editing = false;
      redraw('Критерий сохранён.');
    }

    function nextWork(item) {
      const source = decision.source;
      const scope = source.pointId ? [source.pointId] : source.pointIds ?? review.pointIds;
      newWork({outcomeId,attemptId:item.id,caption:'Продолжение проверки · ' + title()},
        ('Продолжить · ' + title()).slice(0,200),scope);
    }

    function click(button) {
      const {outcomeAction:name,attempt:attemptId} = button.dataset;
      if (name === 'exit' || name === 'cancel') {
        if (!beforeLeave()) return;
        if (name === 'exit' || !current()) return exit();
        dirty = editing = false;
        return redraw();
      }
      const row = current();
      const attempt = row.attempts.find(item => item.id === attemptId);
      if (name === 'source') {
        const criterion = attempt?.criterion ?? row.criterion;
        if (criterion.kind === 'foodcost') return openReport({...criterion,pointIds:review.pointIds});
        const source = decision.source;
        const observed = attempt?.evidence ?? observe(records(),review,decision,criterion).evidence;
        if (criterion.kind === 'stock' && observed) return openSource({...source,id:observed.recordId});
        if (criterion.kind === 'audit') return openSource({...source,recheck:observed});
        return openSource(source);
      }
      if (name === 'followup') return nextWork(attempt);
      if (name === 'work') return openWork(attempt.followup);
      if (name === 'edit') {
        draft = row.criterion;
        editing = true;
        return redraw();
      }
      if (name !== 'save' && name !== 'save-work') return;
      const {evidence} = observe(records(),review,decision,row.criterion);
      if (!evidence || row.attempts.some(item => matches(item,row.criterion,evidence))) return;
      const saved = {id:crypto.randomUUID(),savedAt:new Date().toISOString(),criterion:row.criterion,evidence};
      if (!store({...row,attempts:[...row.attempts,saved]})) return;
      if (name === 'save-work' && !passed(saved)) return nextWork(saved);
      redraw('Проверка сохранена.');
    }

    function input(field) { if (field.form?.dataset.form === 'review-outcome') dirty = true; }
    function change(field) {
      if (field.form?.dataset.form === 'review-outcome' && field.name === 'kind') {
        draft = defaultCriterion(field.value);
        redraw();
      }
    }

    return {open,draw,click,submit,input,change,beforeLeave};
  }

  return {create,validate,merge,statusFor,linkWork};
})();
