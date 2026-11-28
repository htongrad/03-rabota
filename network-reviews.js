'use strict';
window.panel03NetworkReviews = (() => {
  const {categories} = window.panel03NetworkOverview;
  const {formatRate} = window.panel03Economy;
  const stages = ['Показатели','Отклонения','Решения'];
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const unique = rows => new Set(rows).size === rows.length;
  const sourceScope = source => source.kind === 'work' ? source.pointIds : [source.pointId];
  const overlaps = (scope,points,network) => scope === null ? network : scope.some(id => points.includes(id));
  const workKey = ref => JSON.stringify([ref.id,ref.slot]);
  const sourceKey = row => JSON.stringify([row.kind,row.pointId ?? '',row.id,row.slot ?? '',
    row.itemId ?? '',row.drinkId ?? '',row.checkId ?? '',row.reportId ?? '']);
  const decisionFor = (review,source) => review.decisions.find(row => sourceKey(row.source) === sourceKey(source));

  function validate(rows,points,validDay) {
    const pointIds = new Set(points.map(point => point.id));
    const validScope = scope => Array.isArray(scope) && scope.length > 0 &&
      scope.every(id => pointIds.has(id)) && unique(scope);
    const count = n => Number.isSafeInteger(n) && n >= 0;
    const rate = (metric,size) => metric && count(metric.filled) && metric.filled <= size &&
      (metric.rate === null || (metric.filled === size && typeof metric.rate === 'string' && /^\d{1,64}$/.test(metric.rate)));
    const validSnapshot = (snapshot,size) => snapshot && count(snapshot.signalCount) &&
      rate(snapshot.current,size) && rate(snapshot.previous,size);
    const workRef = work => work && present(work.id) && (work.slot === '' || validDay(work.slot));
    function validSource(source) {
      if (!source || typeof source.kind !== 'string' || !Object.hasOwn(categories,source.kind) ||
          !present(source.id) || !present(source.title) || typeof source.note !== 'string') return false;
      if (source.kind === 'work') return workRef(source) && (source.pointIds === null || validScope(source.pointIds));
      if (!pointIds.has(source.pointId)) return false;
      if (source.kind === 'audit') return present(source.drinkId) && present(source.checkId);
      if (source.kind === 'equipment') return present(source.reportId);
      return source.kind !== 'stock' || present(source.itemId);
    }
    function validDecision(row,review) {
      return row && validSource(row.source) && overlaps(sourceScope(row.source),review.pointIds,review.includeNetwork) &&
        (row.kind === 'work' && workRef(row.work) ||
        row.kind === 'watch' && present(row.note) && row.note.length <= 600);
    }
    return Array.isArray(rows) && rows.every(row => row && present(row.id) && validDay(row.start) && validDay(row.end) &&
      row.start <= row.end && validScope(row.pointIds) && typeof row.includeNetwork === 'boolean' &&
      Number.isInteger(row.step) && row.step >= 0 && row.step < stages.length &&
      Array.isArray(row.decisions) && row.decisions.every(item => validDecision(item,row)) &&
      unique(row.decisions.map(item => sourceKey(item.source))) &&
      (row.closedAt === undefined ? row.snapshot === undefined : row.step === 2 && typeof row.closedAt === 'string' &&
        Number.isFinite(Date.parse(row.closedAt)) && validSnapshot(row.snapshot,row.pointIds.length))) &&
      unique(rows.map(row => row.id));
  }

  function updateDecision(rows,id,decision) {
    const review = rows.find(row => row.id === id);
    if (!review || review.closedAt || decisionFor(review,decision.source)?.kind === 'work') return null;
    const decisions = review.decisions.filter(row => sourceKey(row.source) !== sourceKey(decision.source));
    return rows.map(row => row.id === id ? {...review,decisions:[...decisions,decision]} : row);
  }

  function linkWork(rows,origin,event) {
    return updateDecision(rows,origin.reviewId,{kind:'work',source:origin.source,work:{id:event.id,slot:event.date}});
  }

  function create({records,picker,validDay,today,offsetDay,formatPeriod,hero,help,escape,options,getMain,redraw,exit,
    collectSignals,openSource,lookupWork,workRows,openWork,newWork,commit}) {
    const list = () => records().networkReviews ?? [];
    const pointName = id => records().points.find(point => point.id === id)?.name ?? 'Точка';
    const current = () => list().find(row => row.id === id);
    const range = review => formatPeriod(review.start,review.end);
    const action = (name,label,{primary=false,ref='',disabled=false}={}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-review-action="${name}" ${ref}${disabled ? ' disabled' : ''}>${label}</button>`;
    const back = (name,label) => `<button type="button" class="back" data-review-action="${name}">← ${label}</button>`;
    const ref = (name,value) => `data-${name}="${escape(value)}"`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const warning = '<p role="alert" class="notice audit-error" hidden></p>';
    const status = window.panel03WorkItems.taskStatuses;
    let screen, id, source, signals = [], choices = [];

    function open(reviewId) {
      id = reviewId;
      screen = reviewId ? 'review' : 'home';
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function store(updated) {
      return commit(list().map(row => row.id === updated.id ? updated : row));
    }

    function currentSignals(review) {
      return Object.values(collectSignals(new Set(review.pointIds),review.includeNetwork)).flatMap(group => group.rows);
    }

    function comparison(review) {
      const span = Math.round((Date.parse(review.end) - Date.parse(review.start)) / 86400000) + 1;
      const reports = records().periodReports ?? [];
      const rateFor = window.panel03PeriodReports.rateFor;
      return {
        current:rateFor(reports,review.start,review.end,review.pointIds),
        previous:rateFor(reports,offsetDay(review.start,-span),offsetDay(review.start,-1),review.pointIds),
      };
    }

    function summary(review,saved) {
      const {current,previous} = saved;
      const size = review.pointIds.length;
      const percent = value => value.rate !== null ? formatRate(value.rate) : value.filled < size
        ? 'Отчёты по ' + value.filled + ' из ' + size + ' точек' : 'Выручка не положительная';
      const delta = current.rate !== null && previous.rate !== null ? BigInt(current.rate) - BigInt(previous.rate) : null;
      return `<section class="section audit-layout period-total">
        <div class="help-title"><h2>Фактический фудкост</h2>${help('сравнение фудкоста',
          'Сравниваются закрытые отчёты за выбранные даты и за предыдущий период той же длины по тем же точкам.')}</div>
        <dl class="point-details"><div><dt>Выбранный период</dt><dd>${percent(current)}</dd></div>
          <div><dt>Предыдущий период</dt><dd>${percent(previous)}</dd></div>
          ${delta === null ? '' : `<div><dt>Изменение</dt><dd>${delta > 0n ? '+' : ''}${formatRate(delta).replace(' %',' п. п.')}</dd></div>`}
        </dl></section>`;
    }

    function home() {
      const rows = [...list()].reverse();
      function group(name,items) {
        return items.length ? `<section class="section audit-layout"><h2>${name}</h2>
          <div class="audit-list">${items.map(review => action('open',
          `<strong>${escape(range(review))}</strong><small>Точек: ${review.pointIds.length} · ${review.closedAt
            ? 'Решений: ' + review.decisions.length : 'Шаг ' + (review.step+1) + ' из 3'}</small>`,
          {ref:ref('review-id',review.id)})).join('')}</div></section>` : '';
      }
      return `${back('exit','К сводке')}${hero('Разбор сети','Показатели и решения',true)}
        <div class="audit-layout">${records().points.length ? action('new','Новый разбор',{primary:true}) :
          '<p class="empty">Добавь точку во вкладке «Точки».</p>'}
        ${group('Черновики',rows.filter(row => !row.closedAt))}
        ${group('История разборов',rows.filter(row => row.closedAt))}</div>`;
    }

    function setup() {
      const now = today();
      const weekday = new Date(now + 'T00:00:00Z').getUTCDay();
      const end = offsetDay(now,-((weekday+6)%7)-1);
      return `${back('home','К разборам')}${hero('Новый разбор','Период и точки',true)}
        <form data-form="review-setup">
          <label>Начало периода<input type="date" name="start" required value="${offsetDay(end,-6)}"></label>
          <label>Конец периода<input type="date" name="end" required value="${end}"></label>
          ${picker.picker(records().points,null,{name:'review-points',label:'Точки',escape,allLabel:'Выбрать все'})}
          <label class="check"><input type="checkbox" name="network"> Общие дела сети</label>
          ${warning}${submit('Начать разбор')}
        </form>`;
    }

    function caption(row,review) {
      const scope = sourceScope(row);
      const label = scope === null ? 'Вся сеть' : scope.filter(point => review.pointIds.includes(point)).map(pointName).join(', ');
      return categories[row.kind] + ' · ' + label;
    }

    function workDetails(workRef) {
      const item = lookupWork(workRef);
      if (!item) return '<p class="empty">Связанное дело недоступно.</p>';
      const info = [item.work.owner,item.entry.date ? formatPeriod(item.entry.date,item.entry.date) : 'Без даты'].filter(Boolean);
      return `<div class="audit-layout"><strong>${escape(item.entry.title)}</strong>
        <small>${escape(info.join(' · '))}</small><p><span class="task-badge">${status[item.work.status]}</span></p>
        ${action('open-work','Открыть дело',{ref:ref('work-ref',workKey(workRef))})}</div>`;
    }

    function carryover(review) {
      const previous = new Map();
      for (const row of list()) {
        if (!row.closedAt || row.id === review.id) continue;
        for (const decision of row.decisions) {
          if (decision.kind !== 'work') continue;
          const item = lookupWork(decision.work);
          if (item && item.work.status !== 'done' && overlaps(picker.scopeFor(item.work),review.pointIds,review.includeNetwork)) {
            previous.set(workKey(decision.work),decision.work);
          }
        }
      }
      return `<section class="section audit-layout"><h2>Дела из прошлых разборов</h2>
        ${previous.size ? [...previous.values()].map(workDetails).join('') : '<p>Открытых дел по выбранным точкам нет.</p>'}
        </section>`;
    }

    function stageNavigation(review) {
      return `<div class="network-filters" role="group" aria-label="Шаги разбора">${stages.map((label,index) =>
        `<button type="button" class="action" data-review-action="step" data-step="${index}" aria-pressed="${review.step === index}"
          ${index > review.step ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
    }

    function signalList(review) {
      signals = currentSignals(review);
      const {current,previous} = comparison(review);
      const rate = current.rate !== null
        ? `<p class="record">Фактический фудкост · ${previous.rate !== null ? formatRate(previous.rate) + ' → ' : ''}${formatRate(current.rate)}</p>` : '';
      return `<div class="audit-layout">${rate}<h2>Отклонения на момент разбора</h2>
        ${signals.length ? `<div class="network-list">${signals.map((row,index) => {
          const saved = decisionFor(review,row);
          return `<button type="button" class="action network-row" data-review-action="signal" data-index="${index}">
            <span><small>${escape(caption(row,review))}</small><strong>${escape(row.title)}</strong>
            <span class="network-description">${escape(row.note.slice(0,220))}</span>
            ${saved ? `<small>${saved.kind === 'work' ? 'Дело связано' : 'На контроле'}</small>` : ''}</span>
            <span aria-hidden="true">→</span></button>`;
        }).join('')}</div>` : '<p class="empty">В сводке нет открытых отклонений по выбранным точкам.</p>'}
        ${action('next','К решениям',{primary:true})}</div>`;
    }

    function decisionList(review) {
      return `<section class="section audit-layout"><h2>Решения</h2>${review.decisions.length
        ? review.decisions.map((decision,index) => `<article class="review-decision audit-layout">
            <small>${escape(caption(decision.source,review))}</small>
            <strong>${escape(decision.source.title + ' · ' + decision.source.note)}</strong>
            ${decision.kind === 'work' ? workDetails(decision.work) :
              `<p><span class="task-badge">На контроле</span></p><p class="record">${escape(decision.note)}</p>`}
            ${!review.closedAt && decision.kind === 'watch' ? action('edit-note','Изменить пометку',{ref:ref('index',index)}) : ''}
            ${action('open-decision-source','Открыть источник',{ref:ref('index',index)})}</article>`).join('')
        : '<p>Решений пока нет.</p>'}</section>`;
    }

    function reviewScreen(review) {
      const heading = review.closedAt ? 'Итог разбора' : 'Разбор сети';
      const subtitle = review.closedAt ? 'Закрыт · ' + range(review) :
        'Шаг ' + (review.step+1) + ' из 3 · ' + range(review);
      const scope = review.pointIds.map(pointName).join(', ') + (review.includeNetwork ? ' · Общие дела сети' : '');
      const body = review.closedAt ? summary(review,review.snapshot) +
        `<p>Отклонений на момент закрытия: ${review.snapshot.signalCount}</p>` + decisionList(review) :
        review.step === 0 ? summary(review,comparison(review)) + carryover(review) + action('next','К отклонениям',{primary:true}) :
        review.step === 1 ? signalList(review) : decisionList(review) + action('close','Закрыть разбор',{primary:true});
      return `${back('home','К разборам')}${hero(heading,subtitle,true)}<div class="audit-layout">
        <p class="record">${escape(scope)}</p>${review.closedAt ? '' : stageNavigation(review)}${body}
        ${review.closedAt ? '' : action('home','Продолжить позже')}</div>`;
    }

    function detail(review) {
      const decision = decisionFor(review,source);
      return `${back('review',review.step === 1 ? 'К отклонениям' : 'К решениям')}${hero('Отклонение',caption(source,review),true)}
        <div class="audit-layout"><section class="section audit-layout"><h2>${escape(source.title)}</h2>
          <p class="record">${escape(source.note)}</p>${action('open-source','Открыть источник')}</section>
          ${decision?.kind === 'work' ? workDetails(decision.work) :
            `${decision ? `<p class="record">${escape(decision.note)}</p>` : ''}
            ${action('new-work','Создать рабочее дело',{primary:true})}
            ${action('link','Привязать существующее')}
            ${action('watch',decision ? 'Изменить пометку' : 'Оставить на контроле')}`}</div>`;
    }

    function linkForm(review) {
      const scope = sourceScope(source)?.filter(id => review.pointIds.includes(id)) ?? review.pointIds;
      choices = workRows().filter(row => overlaps(picker.scopeFor(row.work),scope,review.includeNetwork));
      choices.sort((a,b) => (a.work.status === 'done') - (b.work.status === 'done') || a.entry.title.localeCompare(b.entry.title,'ru'));
      return `${back('detail','К отклонению')}${hero('Привязать дело',source.title,true)}
        ${choices.length ? `<form data-form="review-link"><label>Рабочее дело<select name="work" required>${options({
          '':'Выбрать',...Object.fromEntries(choices.map(({entry,work},index) => ['w'+index,
            [entry.title,entry.date,taskScope(work),status[work.status]].filter(Boolean).join(' · ')])),
        },'')}</select></label>${warning}${submit('Привязать')}</form>` :
        '<p class="empty">Для этих точек пока нет подходящих дел.</p>'}`;
    }

    function taskScope(work) {
      return picker.scopeFor(work)?.map(pointName).join(', ') ?? 'Вся сеть';
    }

    function watchForm(review) {
      return `${back('detail','К отклонению')}${hero('На контроле',source.title,true)}
        <form data-form="review-watch"><label>Что проверить позже<textarea name="note" maxlength="600" rows="3" required>${escape(decisionFor(review,source)?.note)}</textarea></label>
          ${warning}${submit('Сохранить пометку')}</form>`;
    }

    function draw() {
      const review = current();
      if (screen === 'setup') return setup();
      if (screen === 'review') return reviewScreen(review);
      if (screen === 'detail') return detail(review);
      if (screen === 'link') return linkForm(review);
      if (screen === 'watch') return watchForm(review);
      return home();
    }

    function warn(form,message) {
      const target = form.querySelector('[role=alert]');
      target.textContent = message;
      target.hidden = false;
    }

    function beforeLeave() {
      if (screen !== 'watch') return true;
      const note = getMain().querySelector('[name=note]').value.trim();
      const saved = decisionFor(current(),source)?.note ?? '';
      return note === saved || window.confirm('Выйти без сохранения пометки?');
    }

    function submitForm(form) {
      if (form.dataset.form === 'review-setup') {
        const {start,end,network} = form.elements;
        if (!validDay(start.value) || !validDay(end.value) || start.value > end.value) {
          return warn(form,'Укажи даты периода по порядку.');
        }
        const pointIds = picker.read(form.querySelector('[data-point-picker]')) ?? records().points.map(point => point.id);
        if (!pointIds.length) return warn(form,'Отметь хотя бы одну точку.');
        const draft = {id:crypto.randomUUID(),start:start.value,end:end.value,pointIds,includeNetwork:network.checked,step:0,decisions:[]};
        if (!commit([...list(),draft])) return;
        id = draft.id;
        return show('review');
      }
      let decision;
      if (form.dataset.form === 'review-watch') {
        const note = form.elements.note.value.trim();
        if (!note) return warn(form,'Укажи, что проверить позже.');
        decision = {source,kind:'watch',note};
      } else {
        const value = form.elements.work.value;
        const chosen = value ? choices[Number(value.slice(1))] : null;
        const work = chosen && {id:chosen.record.id,slot:chosen.slot};
        if (!work || !lookupWork(work)) return warn(form,'Выбери доступное дело.');
        decision = {source,kind:'work',work};
      }
      const updated = updateDecision(list(),id,decision);
      if (updated && commit(updated)) show('detail','Решение сохранено.');
    }

    function suggestedTitle(row) {
      if (row.kind === 'stock') return 'Проверить списания · ' + row.title;
      if (row.kind === 'equipment') return 'Проверить оборудование · ' + row.title;
      return 'Разобрать · ' + row.title;
    }

    function click(button) {
      if (!beforeLeave()) return;
      const {reviewAction:name,reviewId,step,index,workRef} = button.dataset;
      if (name === 'exit') return exit();
      if (name === 'open') {
        open(reviewId);
        return redraw();
      }
      const review = current();
      if (name === 'signal') {
        source = signals[Number(index)];
        return show('detail');
      }
      if (name === 'edit-note') {
        source = review.decisions[Number(index)].source;
        return show('watch');
      }
      if (name === 'open-source') return openSource(source);
      if (name === 'open-decision-source') return openSource(review.decisions[Number(index)].source);
      if (name === 'open-work') {
        const [id,slot] = JSON.parse(workRef);
        return openWork({id,slot});
      }
      if (name === 'new-work') {
        const scope = sourceScope(source)?.filter(point => review.pointIds.includes(point)) ?? null;
        return newWork({reviewId:id,source,caption:caption(source,review) + ' · ' + source.title + '\n' + source.note},
          suggestedTitle(source).slice(0,200),scope);
      }
      if (name === 'step' || name === 'next') {
        const next = name === 'next' ? review.step+1 : Number(step);
        if (next !== review.step && store({...review,step:next})) show('review');
        return;
      }
      if (name === 'close') {
        if (review.closedAt || review.step !== 2) return;
        const snapshot = {...comparison(review),signalCount:currentSignals(review).length};
        if (store({...review,closedAt:new Date().toISOString(),snapshot})) show('review','Разбор закрыт.');
        return;
      }
      show(name === 'new' ? 'setup' : name);
    }

    return {open,draw,click,submit:submitForm,beforeLeave};
  }

  return {create,validate,linkWork};
})();
