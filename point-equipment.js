'use strict';
window.panel03Equipment = (() => {
  const results = {ok:'В порядке', issue:'Нужна диагностика', fixed:'Проблема устранена', unresolved:'Проблема сохраняется'};
  const hasText = value => typeof value === 'string' && Boolean(value.trim());
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

  function validate(items, points, validDay) {
    const pointIds = new Set(points.map(row => row.id));
    function validReport(report) {
      return report && hasText(report.id) && instant(report.at) && typeof report.note === 'string' &&
        (report.eventId === undefined || hasText(report.eventId)) &&
        (report.kind === 'inspection'
          ? ['ok','issue'].includes(report.result) && hasText(report.eventId) && validDay(report.slot) && validDay(report.day)
          : report.kind === 'diagnosis' && ['fixed','unresolved'].includes(report.result)) &&
        (!['issue','unresolved'].includes(report.result) || hasText(report.note));
    }
    function validAsset(asset) {
      return asset && hasText(asset.id) && hasText(asset.name) && pointIds.has(asset.pointId) &&
        typeof asset.inventory === 'string' && Array.isArray(asset.history) && asset.history.every(validReport) &&
        new Set(asset.history.map(row => row.id)).size === asset.history.length &&
        Array.isArray(asset.planIds) && asset.planIds.every(hasText) && new Set(asset.planIds).size === asset.planIds.length &&
        (asset.activePlanId === '' || asset.planIds.includes(asset.activePlanId)) &&
        (asset.issue === undefined || (asset.issue &&
          asset.history.some(row => row.id === asset.issue.reportId && row.kind === 'inspection' && row.result === 'issue') &&
          (asset.issue.workId === undefined || hasText(asset.issue.workId))));
    }
    return Array.isArray(items) && items.every(validAsset) && new Set(items.map(row => row.id)).size === items.length;
  }

  function sourceForWork(items, id) {
    for (const asset of items) {
      if (asset.planIds.includes(id)) return {asset,kind:'inspection'};
      if (asset.issue?.workId === id || asset.history.some(row => row.kind === 'diagnosis' && row.eventId === id)) {
        return {asset,kind:'diagnosis'};
      }
    }
    return null;
  }

  const replaceAsset = (items, asset) => items.map(row => row.id === asset.id ? asset : row);

  function linkDiagnosis(items, events, source, workId) {
    const asset = items.find(row => row.id === source.assetId);
    if (!asset?.issue || asset.issue.reportId !== source.reportId || events.some(row => row.id === asset.issue.workId)) return null;
    return replaceAsset(items,{...asset,issue:{...asset.issue,workId}});
  }

  function create({records, hero, escape, labels, options, getMain, today, nextDay, validDay, nextInspection,
    inspectionEntry, commit, redraw, exit, newWork, openWork}) {
    const stamp = new Intl.DateTimeFormat('ru', {dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
    const dayLabel = new Intl.DateTimeFormat('ru', {weekday:'short',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
    const dayText = day => dayLabel.format(new Date(day + 'T00:00:00Z'));
    const dateText = instant => stamp.format(new Date(instant));
    const action = (name, label, {primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-equipment-action="${name}" ${data}>${label}</button>`;
    const ref = (name,value) => `data-${name}="${escape(value)}"`;
    const back = (name,label) => `<button type="button" class="back" data-equipment-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const assets = () => records().equipment ?? [];
    const point = () => records().points.find(row => row.id === pointId);
    const asset = () => assets().find(row => row.id === assetId);
    const work = id => records().events.find(row => row.id === id);
    const getPlan = row => work(row.activePlanId);
    const status = row => row.issue ? 'Требует внимания' : 'В эксплуатации';
    const priorInspection = (row,id,slot) => row.history.find(report => report.kind === 'inspection' && report.eventId === id && report.slot === slot);
    const sameDayClosed = row => row.history.some(report => report.kind === 'inspection' && report.day === today());
    const planStart = row => sameDayClosed(row) ? nextDay(today()) : today();
    const duration = entry => entry.allDay ? 'Весь день' : entry.start + '–' + entry.end;
    let screen, pointId, assetId, inspection;

    function show(next, message) {
      screen = next;
      redraw(message);
    }

    function open(id, equipId, source) {
      pointId = id;
      assetId = equipId;
      screen = equipId ? 'asset' : 'list';
      if (source?.kind === 'inspection') {
        inspection = {id:source.id,slot:source.slot};
        screen = priorInspection(asset(),source.id,source.slot) ? 'history' : 'inspection';
      } else if (source?.kind === 'diagnosis' && asset().issue?.workId === source.id) {
        screen = 'diagnosis';
      }
    }

    function store(row, events) {
      const updated = asset() ? replaceAsset(assets(),row) : [...assets(),row];
      return commit(updated,events);
    }

    function list() {
      const rows = assets().filter(row => row.pointId === pointId).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
      return `${back('point','Карточка точки')}${hero('Оборудование',point().name,true)}
        <div class="audit-layout">${action('add','Добавить оборудование',{primary:true})}
          ${rows.length ? `<div class="audit-list">${rows.map(row => action('asset',
            `<strong>${escape(row.name)}</strong><small>${escape(status(row))}</small>`,{data:ref('asset-id',row.id)})).join('')}</div>` :
            '<p class="empty">На этой точке пока нет оборудования.</p>'}
        </div>`;
    }

    function editor() {
      const row = asset();
      return `${back(row ? 'card' : 'list',row ? 'К оборудованию' : 'К списку оборудования')}
        ${hero(row ? 'Карточка оборудования' : 'Новое оборудование',point().name,true)}
        <form data-form="equipment-edit">
          <label>Название<input name="name" maxlength="140" value="${escape(row?.name)}" required></label>
          <label>Инвентарный номер · по желанию<input name="inventory" maxlength="100" value="${escape(row?.inventory)}"></label>
          ${warning}${submit('Сохранить оборудование')}
        </form>`;
    }

    function issueCard(row) {
      if (!row.issue) return '';
      const report = row.history.find(item => item.id === row.issue.reportId);
      const linked = work(row.issue.workId);
      return `<section class="section audit-layout"><h2>Открыта диагностика</h2>
        <p class="record">${escape(report.note)}</p>
        ${linked ? action('work','Открыть дело на диагностику',{data:ref('work-id',linked.id)}) :
          action('new-diagnosis','Создать дело на диагностику',{primary:true})}
        ${action('diagnosis','Отметить результат диагностики')}
      </section>`;
    }

    function card() {
      const row = asset();
      const plan = getPlan(row);
      const next = plan && nextInspection(plan);
      return `${back('list','Оборудование')}${hero(row.name,point().name + ' · Оборудование',true)}
        <div class="audit-layout">
          <section class="section"><span class="audit-status" data-outcome="${row.issue ? 'issue' : 'pass'}">${status(row)}</span>
            ${row.inventory ? `<p>Инвентарный номер: ${escape(row.inventory)}</p>` : ''}</section>
          ${issueCard(row)}
          <section class="section audit-layout"><h2>Плановый осмотр</h2>
            ${next ? `<p>${escape(dayText(next.entry.date))} · ${escape(duration(next.entry))}</p>` :
              `<p>${plan ? 'Предстоящих осмотров пока нет.' : 'График ещё не настроен.'}</p>`}
            ${plan ? `<p>${escape(labels[plan.repeat])}${plan.work.owner ? ' · ' + escape(plan.work.owner) : ''}</p>` : ''}
            ${next ? action('inspection','Открыть ближайший осмотр',{primary:true,data:ref('work-id',plan.id) + ' ' + ref('slot',next.slot)}) : ''}
            ${action('schedule',plan ? 'Изменить график' : 'Настроить график')}
          </section>
          ${action('history','История обслуживания')}
          ${action('edit','Изменить оборудование')}
        </div>`;
    }

    function schedule() {
      const row = asset();
      const plan = getPlan(row);
      const firstDay = planStart(row);
      const date = plan && nextInspection(plan)?.entry.date || firstDay;
      return `${back('card','К оборудованию')}${hero('График осмотров',row.name + ' · ' + point().name,true)}
        <form data-form="equipment-schedule">
          <label>Первый осмотр по графику<input type="date" name="date" min="${firstDay}" max="9999-12-30" value="${escape(date < firstDay ? firstDay : date)}" required></label>
          <label class="check"><input type="checkbox" name="allDay"${plan?.allDay ? ' checked' : ''}> Весь день</label>
          <div class="times" data-equipment-times${plan?.allDay ? ' hidden' : ''}>
            <label>Начало<input type="time" name="start" value="${escape(plan?.start || '10:00')}"${plan?.allDay ? '' : ' required'}></label>
            <label>Окончание<input type="time" name="end" value="${escape(plan?.end || '10:15')}"${plan?.allDay ? '' : ' required'}></label>
          </div>
          <label>Повтор<select name="repeat">${options(labels,plan?.repeat ?? 'weekly')}</select></label>
          <label>Ответственный · по желанию<input name="owner" maxlength="120" value="${escape(plan?.work.owner ?? point().owner)}"></label>
          ${warning}${submit('Сохранить график')}
          ${plan ? action('stop','Остановить график') : ''}
        </form>`;
    }

    function reportForm(diagnosis) {
      const row = asset();
      const entry = !diagnosis && inspectionEntry(work(inspection.id),inspection.slot);
      return `${back('card','К оборудованию')}${hero(diagnosis ? 'Результат диагностики' : 'Плановый осмотр',row.name + ' · ' + point().name,true)}
        <form data-form="equipment-report">
          ${entry ? `<p>${escape(dayText(entry.date))} · ${escape(duration(entry))}</p>` : ''}
          <fieldset class="audit-options"><legend>Результат</legend><div>${(diagnosis ? ['fixed','unresolved'] : ['ok','issue']).map(id =>
            `<label><input type="radio" name="result" value="${id}"><span>${results[id]}</span></label>`).join('')}</div></fieldset>
          <label>${diagnosis ? 'Комментарий' : 'Что обнаружено'}<textarea name="note" maxlength="1200" rows="3"></textarea></label>
          ${warning}${submit(diagnosis ? 'Сохранить диагностику' : 'Сохранить осмотр')}
        </form>`;
    }

    function history() {
      const row = asset();
      return `${back('card','К оборудованию')}${hero('История обслуживания',row.name + ' · ' + point().name,true)}
        ${row.history.length ? `<div class="audit-layout">${[...row.history].reverse().map(report => `
          <section class="section audit-layout"><h2>${report.kind === 'inspection' ? 'Плановый осмотр' : 'Диагностика'}</h2>
            <p><strong>${results[report.result]}</strong> · ${escape(dateText(report.at))}</p>
            ${report.kind === 'inspection' ? `<p>По графику: ${escape(dayText(report.day))}</p>` : ''}
            ${report.note ? `<p class="record">${escape(report.note)}</p>` : ''}
            ${report.kind === 'diagnosis' && work(report.eventId) ? action('work','Открыть дело на диагностику',{data:ref('work-id',report.eventId)}) : ''}
          </section>`).join('')}</div>` : '<p class="empty">Осмотров пока нет.</p>'}`;
    }

    function draw() {
      if (screen === 'list') return list();
      if (screen === 'edit') return editor();
      if (screen === 'schedule') return schedule();
      if (screen === 'inspection' || screen === 'diagnosis') return reportForm(screen === 'diagnosis');
      if (screen === 'history') return history();
      return card();
    }

    function warn(form, message, field) {
      const notice = form.querySelector('[role=alert]');
      notice.textContent = message;
      notice.hidden = false;
      field?.focus();
    }

    function stopEvent(row) {
      const plan = getPlan(row);
      if (!plan) return records().events;
      const cutoff = planStart(row);
      if (plan.repeat === 'none' && plan.date < cutoff) return records().events;
      return records().events.map(event => event.id === plan.id ? {...event,stopBefore:cutoff} : event);
    }

    function savePlan(row, form, get, values) {
      const date = get('date'), allDay = values.has('allDay'), repeat = get('repeat');
      const start = allDay ? '' : get('start'), end = allDay ? '' : get('end');
      if (!validDay(date) || date < planStart(row)) return warn(form,'Укажи допустимую дату осмотра.',form.elements.date);
      if (!allDay && (!start || !end || start >= end)) return warn(form,'Окончание должно быть позже начала.',form.elements.end);
      const id = crypto.randomUUID();
      const description = ('Плановый осмотр · ' + row.name).slice(0,200);
      const event = {id,title:description,date,allDay,start,end,repeat,ending:'never',exceptions:{},
        work:{pointId:row.pointId,owner:get('owner'),status:'open',result:''}};
      if (store({...row,activePlanId:id,planIds:[...row.planIds,id]},[...stopEvent(row),event])) show('asset','График сохранён.');
    }

    function saveReport(row, form, get) {
      const result = get('result'), note = get('note');
      const diagnosis = screen === 'diagnosis';
      if (!(diagnosis ? ['fixed','unresolved'] : ['ok','issue']).includes(result)) {
        return warn(form,'Выбери результат.',form.querySelector('input[name=result]'));
      }
      if (['issue','unresolved'].includes(result) && !note) return warn(form,'Опиши, что обнаружено.',form.elements.note);
      const kind = diagnosis ? 'diagnosis' : 'inspection';
      const report = {id:crypto.randomUUID(),kind,result,note,at:new Date().toISOString()};
      const eventId = diagnosis ? row.issue?.workId : inspection.id;
      const event = work(eventId);
      if (!diagnosis) {
        const entry = inspectionEntry(event,inspection.slot);
        if (!entry || priorInspection(row,eventId,inspection.slot)) return show('asset','Этот осмотр уже сохранён или снят с графика.');
        report.slot = inspection.slot;
        report.day = entry.date;
        report.eventId = eventId;
      } else {
        if (!row.issue) return show('asset');
        if (eventId) report.eventId = eventId;
      }
      const updated = {...row,history:[...row.history,report]};
      if (!diagnosis && result === 'issue' && !row.issue) updated.issue = {reportId:report.id};
      if (diagnosis && result === 'fixed') delete updated.issue;
      let events;
      if (event && (!diagnosis || (result === 'fixed' && event.repeat === 'none'))) {
        const progress = {status:'done',result:results[result] + (note ? ' · ' + note : '')};
        const completed = event.repeat === 'none' ? {...event,work:{...event.work,...progress}} :
          {...event,workLog:{...event.workLog,[inspection.slot]:progress}};
        events = records().events.map(item => item.id === event.id ? completed : item);
      }
      if (store(updated,events)) show('asset',diagnosis ? 'Диагностика сохранена.' : 'Осмотр сохранён.');
    }

    function submitForm(form) {
      const values = new FormData(form);
      const get = name => String(values.get(name) ?? '').trim();
      const row = asset();
      if (screen === 'edit') {
        const name = get('name');
        if (!name) return warn(form,'Укажи название оборудования.',form.elements.name);
        const updated = {...(row ?? {id:crypto.randomUUID(),pointId,history:[],planIds:[],activePlanId:''}),
          name,inventory:get('inventory')};
        if (!store(updated)) return;
        assetId = updated.id;
        return show('asset','Оборудование сохранено.');
      }
      if (screen === 'schedule') return savePlan(row,form,get,values);
      if (screen === 'inspection' || screen === 'diagnosis') return saveReport(row,form,get);
    }

    function change(field) {
      if (field.name !== 'allDay' || field.form?.dataset.form !== 'equipment-schedule') return;
      field.form.querySelector('[data-equipment-times]').hidden = field.checked;
      field.form.elements.start.required = field.form.elements.end.required = !field.checked;
    }

    function click(button) {
      const data = button.dataset;
      const name = data.equipmentAction;
      if (name === 'point') return exit(point());
      if (name === 'list') return show('list');
      if (name === 'asset') {
        assetId = data.assetId;
        return show('asset');
      }
      if (name === 'add') {
        assetId = null;
        return show('edit');
      }
      if (name === 'card') return show('asset');
      if (['edit','schedule','history','diagnosis'].includes(name)) return show(name);
      if (name === 'inspection') {
        inspection = {id:data.workId,slot:data.slot};
        return show('inspection');
      }
      if (name === 'work') return openWork(data.workId);
      if (name === 'new-diagnosis') {
        const row = asset();
        return newWork({assetId,reportId:row.issue.reportId},row.pointId,('Диагностика · ' + row.name).slice(0,200));
      }
      if (name === 'stop' && window.confirm('Остановить будущие осмотры? История обслуживания сохранится.')) {
        const row = asset();
        if (store({...row,activePlanId:''},stopEvent(row))) show('asset','График остановлен.');
      }
    }

    return {open,draw,submit:submitForm,change,click};
  }

  return {create,validate,linkDiagnosis,sourceForWork};
})();
