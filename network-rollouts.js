'use strict';
window.panel03Rollouts = (() => {
  const checks = {
    recipe:'Техкарта и расчёт готовы',
    team:'Команда отработала рецепт',
    stock:'Сырьё в наличии',
    equipment:'Оборудование готово',
  };
  const decisions = {expand:'Расширить', revise:'На доработку', stop:'Остановить'};
  const quality = {pass:'Соответствует', issue:'Есть отклонения', skip:'Часть пунктов не проверена'};
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const rate = value => value === null || (typeof value === 'string' && /^\d{1,400}$/.test(value));
  const unique = rows => new Set(rows).size === rows.length;
  const ready = site => site.checks.length === Object.keys(checks).length;

  function validate(rows, points, validDay, completeRecipe) {
    const ids = new Set(points.map(point => point.id));
    const validActivation = row => row && present(row.versionId) && instant(row.at) && rate(row.before);
    const validResult = row => row && present(row.auditId) && instant(row.at) && rate(row.after) &&
      typeof row.note === 'string' && typeof row.quality === 'string' && Object.hasOwn(quality,row.quality);
    function validSite(site) {
      return site && ids.has(site.id) && validDay(site.date) && Array.isArray(site.checks) &&
        site.checks.every(key => typeof key === 'string' && Object.hasOwn(checks,key)) && unique(site.checks) &&
        (site.workId === undefined || present(site.workId)) &&
        (site.activation === undefined || (ready(site) && validActivation(site.activation))) &&
        (site.result === undefined || (site.activation && validResult(site.result)));
    }
    return Array.isArray(rows) && rows.every(row => {
      if (!row || !present(row.id) || !present(row.title) || !present(row.recipeId) ||
          !present(row.recipeTitle) || !present(row.criterion) || !instant(row.createdAt) || !completeRecipe(row.candidate) ||
          !Array.isArray(row.sites) || row.sites.length === 0 || !row.sites.every(validSite) ||
          !unique(row.sites.map(site=>site.id)) || !Array.isArray(row.pilotHistory) ||
          !row.pilotHistory.every(trial => trial && completeRecipe(trial.candidate) &&
            validActivation(trial.activation) && validResult(trial.result) && instant(trial.at))) return false;
      const pilot = row.sites.find(site=>site.id === row.pilotId);
      return Boolean(pilot) && (row.decision === '' ||
        (typeof row.decision === 'string' && Object.hasOwn(decisions,row.decision) && pilot.result)) &&
        row.sites.every(site=>site.id === row.pilotId || !site.activation || row.decision === 'expand');
    }) && unique(rows.map(row=>row.id));
  }

  function replaceSite(row,site) {
    return {...row,sites:row.sites.map(item=>item.id === site.id ? site : item)};
  }

  function linkWork(rows,events,{rolloutId,pointId},workId) {
    const row = rows.find(item=>item.id === rolloutId);
    const site = row?.sites.find(item=>item.id === pointId);
    if (!site || site.activation || row.decision === 'stop' || events.some(event=>event.id === site.workId)) return null;
    return rows.map(item=>item.id === row.id ? replaceSite(row,{...site,workId}) : item);
  }

  function create({records, hero, escape, options, picker, completeRecipe, effective, foodCost, today, validDay,
    getMain, commit, redraw, exit, openAudit, openEquipment, newWork, openWork}) {
    const dateFormat = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeZone:'UTC'});
    const momentFormat = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
    const number = new Intl.NumberFormat('ru-RU');
    const dateText = day => dateFormat.format(new Date(day + 'T00:00:00Z'));
    const momentText = value => momentFormat.format(new Date(value));
    const now = () => new Date().toISOString();
    const point = id => records().points.find(item=>item.id === id);
    const name = id => point(id)?.name ?? 'Точка';
    const rows = () => records().rollouts ?? [];
    const selected = () => rows().find(item=>item.id === rolloutId);
    const targetSite = () => selected().sites.find(item=>item.id === siteId);
    const recipes = () => (records().recipes ?? []).filter(item=>completeRecipe(item.draft) || item.versions.length);
    const recipe = id => (records().recipes ?? []).find(item=>item.id === id);
    const title = item => item.name + ' ' + item.volumeMl + ' мл';
    const work = id => records().events.find(item=>item.id === id);
    const action = (name,label,{primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-rollout-action="${name}" ${data}>${label}</button>`;
    const ref = (name,value) => `data-${name}="${escape(value)}"`;
    const back = (name,label) => `<button type="button" class="back" data-rollout-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const fieldRow = (key,value) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`;
    let screen, rolloutId, siteId, mode, planDraft, versionBack;

    function open() {
      screen = 'home';
      rolloutId = undefined;
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function store(row,nextRecipes) {
      const exists = rows().some(item=>item.id === row.id);
      const updated = exists ? rows().map(item=>item.id === row.id ? row : item) : [...rows(),row];
      return commit(updated,nextRecipes);
    }

    function costText(value) {
      if (value === null) return 'Нет данных';
      const count = BigInt(value);
      const fractions = String(count % 100n).padStart(2,'0').replace(/0+$/,'');
      return number.format(count / 100n) + (fractions ? ',' + fractions : '') + ' %';
    }

    function phase(row) {
      if (row.decision === 'stop') return 'Остановлен';
      if (row.decision === 'revise') return 'Доработка';
      if (row.sites.every(site=>site.result) && row.decision === 'expand') return 'Завершён';
      if (row.decision === 'expand') return 'Расширение';
      const pilot = row.sites.find(site=>site.id === row.pilotId);
      return pilot.result ? 'Решение по пилоту' : pilot.activation ? 'Пилот идёт' : 'Подготовка пилота';
    }

    function sitePhase(row,site) {
      if (site.result) return 'Итог сохранён';
      if (site.activation) return 'Введена новая техкарта';
      if (row.decision === 'stop') return 'Запуск остановлен';
      if (site.id !== row.pilotId && row.decision !== 'expand') return 'После решения по пилоту';
      return ready(site) ? 'Готова к запуску' : 'Готовится';
    }

    function home() {
      return `${back('exit','Обзор')}${hero('Запуски','Управление изменениями',true)}
        <div class="audit-layout">${action('new','Новый запуск',{primary:true})}
          ${rows().length ? `<div class="audit-list">${[...rows()].reverse().map(row =>
            action('open',`<strong>${escape(row.title)}</strong><small>${phase(row)} · ${escape(row.recipeTitle)}</small>`,
              {data:ref('rollout-id',row.id)})).join('')}</div>` : '<p class="empty">Запусков пока нет.</p>'}</div>`;
    }

    function sources(item) {
      if (!item) return {};
      return {...(completeRecipe(item.draft) ? {draft:'Черновик из меню'} : {}),
        ...Object.fromEntries([...item.versions].reverse().map(version =>
          ['version:' + version.id,'Версия от ' + momentText(version.publishedAt)]))};
    }

    function sourceOf(item,key) {
      return key === 'draft' ? item?.draft : item?.versions.find(row=>'version:' + row.id === key);
    }

    function planForm() {
      const available = recipes();
      const row = selected();
      if (!available.length) return `${back(row ? 'card' : 'home',row ? 'К запуску' : 'Запуски')}${hero('План запуска','',true)}
        <p class="empty">Сначала сохрани полную техкарту или готовый черновик во вкладке «Меню».</p>`;
      const current = planDraft.recipeId || row?.recipeId || available[0].id;
      const versions = sources(recipe(current));
      if (mode === 'edit') versions.saved = 'Техкарта, сохранённая в плане';
      const keys = Object.keys(versions);
      const version = mode === 'edit' ? 'saved' : keys[0];
      const label = mode === 'revise' ? 'Новая попытка пилота' : row ? 'Изменить план' : 'Новый запуск';
      return `${back(row ? 'card' : 'home',row ? 'К запуску' : 'Запуски')}${hero(label,'Запуски',true)}
        <form data-form="rollout-plan">
          ${mode === 'revise' ? `<p>Напиток: ${escape(row.recipeTitle)}</p>` : `
            <label>Название запуска<input name="title" maxlength="140" value="${escape(row?.title)}" required></label>
            <label>Напиток<select name="recipeId">${options(Object.fromEntries(available.map(item=>[item.id,title(item)])),current)}</select></label>
            ${picker.picker(records().points,row ? row.sites.map(site=>site.id) : [],
              {name:'rollout-scope',label:'Точки запуска',escape,allLabel:'Выбрать все'})}
            <div id="rollout-pilot">${pilotField(row?.sites.map(site=>site.id) ?? [],row?.pilotId)}</div>
            <label>Критерий результата<textarea name="criterion" rows="3" maxlength="800" required>${escape(row?.criterion)}</textarea></label>`}
          <label>Версия для запуска<select name="source">${options(versions,version)}</select></label>
          ${warning}${submit('Сохранить план')}
        </form>`;
    }

    function pilotField(ids,pilotId) {
      if (ids.length === 1) return `<p>Пилот: ${escape(name(ids[0]))}</p>`;
      if (!ids.length) return '<p>Отметь точки, чтобы назначить пилот.</p>';
      return `<fieldset class="point-picker"><legend>Пилотная точка</legend>
        ${ids.map(id=>`<div class="rollout-pilot-row"><span>${escape(name(id))}</span>
          ${id === pilotId ? '<strong>Пилот</strong>' : action('pick-pilot','Назначить пилотом',{data:ref('point-id',id)})}</div>`).join('')}
      </fieldset>`;
    }

    function card() {
      const row = selected();
      const pilot = row.sites.find(site=>site.id === row.pilotId);
      return `${back('home','Запуски')}${hero(row.title,row.recipeTitle + ' · ' + phase(row),true)}
        <div class="audit-layout">
          <section class="section"><h2>Критерий результата</h2><p class="record">${escape(row.criterion)}</p></section>
          ${action('candidate','Открыть техкарту запуска')}
          <div class="audit-list">${row.sites.map(site=>action('site',
            `<strong>${escape(name(site.id))}</strong><small>${site.id === row.pilotId ? 'Пилот · ' : ''}${escape(sitePhase(row,site))} · ${escape(dateText(site.date))}</small>`,
            {data:ref('point-id',site.id)})).join('')}</div>
          ${!pilot.activation && !row.pilotHistory.length ? action('edit','Изменить план') : ''}
          ${row.decision === 'revise' ? action('revise','Начать новую попытку',{primary:true}) : ''}
          ${row.pilotHistory.length ? action('history','История попыток пилота') : ''}
        </div>`;
    }

    function siteScreen() {
      const row = selected(), site = targetSite();
      const frozen = Boolean(site.activation || row.decision === 'stop' || row.decision === 'revise');
      const eligible = (site.id === row.pilotId && row.decision === '') || row.decision === 'expand';
      return `${back('card','К запуску')}${hero(site.activation ? 'Результат запуска' : 'Готовность к запуску',name(site.id) + ' · ' + row.recipeTitle,true)}
        <div class="audit-layout">
          ${site.activation ? outcomeScreen(row,site) : `
            <form data-form="rollout-ready">
              <label>Плановая дата<input type="date" name="date" value="${escape(site.date)}" max="9999-12-30" required${frozen ? ' disabled' : ''}></label>
              <fieldset class="point-picker"><legend>Подтверждения по точке</legend>
                ${Object.entries(checks).map(([id,label])=>`<label class="check"><input type="checkbox" name="check" value="${id}"
                  ${site.checks.includes(id) ? ' checked' : ''}${frozen ? ' disabled' : ''}> ${label}</label>`).join('')}
              </fieldset>${warning}${frozen ? '' : submit('Сохранить готовность')}
            </form>
            ${frozen ? '' : action('equipment','Открыть оборудование')}
            ${frozen ? '' : work(site.workId) ? action('work','Открыть запланированную проверку') : action('schedule','Запланировать проверку')}
            ${ready(site) && eligible ? action('activate','Подтвердить запуск на точке',{primary:true}) :
              `<p>${escape(sitePhase(row,site))}</p>`}`}
        </div>`;
    }

    function siteAudits(row,site) {
      return (records().audits ?? []).filter(audit=>audit.completedAt && audit.pointId === site.id &&
        audit.drinks.some(drink=>drink.id === row.recipeId && drink.standard.id === site.activation.versionId)).reverse();
    }

    function auditQuality(audit,recipeId) {
      const drink = audit.drinks.find(drink=>drink.id === recipeId);
      const results = drink.checks.map(check=>check.rechecks.filter(row=>row.standard.id === drink.standard.id).at(-1)?.result ?? check.result);
      return results.includes('issue') ? 'issue' : results.includes('skip') ? 'skip' : 'pass';
    }

    function resultSummary(activation,result) {
      return `<section class="section audit-layout"><h2>Итог проверки</h2><dl class="stock-result">
        ${fieldRow('Расчётный фудкост до запуска',costText(activation.before))}
        ${fieldRow('Расчётный фудкост после запуска',costText(result.after))}
        ${fieldRow('Аудит напитка',quality[result.quality])}
        </dl>${result.note ? `<p class="record">${escape(result.note)}</p>` : ''}</section>`;
    }

    function outcomeScreen(row,site) {
      const logs = siteAudits(row,site);
      const result = site.result;
      const item = recipe(row.recipeId);
      const running = item && effective(item,site.id)?.id === site.activation.versionId;
      const count = logs.length;
      return `<p>Техкарта введена ${escape(momentText(site.activation.at))}</p>
        ${result ? resultSummary(site.activation,result) : `
          <p>Критерий результата: ${escape(row.criterion)}</p>
          ${!running ? '<p>На точке действует другая версия. Выбери уже завершённый аудит выпуска.</p>' : ''}
          ${count ? `<form data-form="rollout-result">
            <label>Аудит выпуска<select name="auditId">${options(Object.fromEntries(logs.map(audit=>
              [audit.id,momentText(audit.completedAt) + ' · ' + quality[auditQuality(audit,row.recipeId)]])),logs[0].id)}</select></label>
            <label>Комментарий к результату<textarea name="note" rows="3" maxlength="1000"></textarea></label>
            ${warning}${submit('Сохранить итог')}
          </form>` : '<p class="empty">Заверши аудит на этой точке по выпущенной техкарте.</p>'}`}
        ${action('audit',result ? 'Открыть связанный аудит' : 'Открыть аудит точки')}
        ${result && site.id === row.pilotId && row.decision === '' ?
          `<section class="section audit-layout"><h2>Решение по пилоту</h2>
            ${Object.entries(decisions).map(([id,label])=>action('decide',label,{data:ref('decision',id),primary:id === 'expand'})).join('')}
          </section>` : ''}
        ${result && site.id === row.pilotId && row.decision ? `<p>Решение по пилоту: ${decisions[row.decision]}</p>` : ''}`;
    }

    function candidateScreen() {
      const row = selected();
      return `${back(versionBack,'К запуску')}${hero('Техкарта запуска',row.recipeTitle,true)}
        <div class="audit-layout"><section class="section"><h2>Состав на порцию</h2><ul class="recipe-composition">
          ${row.candidate.ingredients.map(line=>`<li><span>${escape(line.name)}</span><strong>${escape(line.amount.replace('.',','))} ${escape(line.unit)}</strong></li>`).join('')}
          </ul></section><section class="section"><h2>Порядок приготовления</h2><p class="record">${escape(row.candidate.method)}</p></section></div>`;
    }

    function history() {
      const row = selected();
      return `${back('card','К запуску')}${hero('История пилота',name(row.pilotId),true)}
        <div class="audit-layout">${[...row.pilotHistory].reverse().map(trial=>
          `<p>Отправлено на доработку ${escape(momentText(trial.at))}</p>` + resultSummary(trial.activation,trial.result)).join('')}</div>`;
    }

    function draw() {
      if (screen === 'plan') return planForm();
      if (screen === 'card') return card();
      if (screen === 'site') return siteScreen();
      if (screen === 'candidate') return candidateScreen();
      if (screen === 'history') return history();
      return home();
    }

    function warn(form,message,field) {
      const alert = form.querySelector('[role=alert]');
      alert.textContent = message;
      alert.hidden = false;
      field?.focus();
    }

    function planIds(form) {
      const field = form.querySelector('[data-point-picker]');
      return picker.read(field) ?? records().points.map(point=>point.id);
    }

    function persistPlan(form,get) {
      const row = selected();
      const item = recipe(mode === 'revise' ? row.recipeId : get('recipeId'));
      const key = get('source');
      const version = key === 'saved' && item?.id === row?.recipeId ? row.candidate : sourceOf(item,key);
      if (!completeRecipe(version)) return warn(form,'Выбери готовую техкарту.',form.elements.source);
      const candidate = {method:version.method,ingredients:version.ingredients};
      if (mode === 'revise') {
        const pilot = row.sites.find(site=>site.id === row.pilotId);
        const trial = {candidate:row.candidate,activation:pilot.activation,result:pilot.result,at:now()};
        const updated = {...row,candidate,decision:'',pilotHistory:[...row.pilotHistory,trial],
          sites:row.sites.map(site=>({id:site.id,date:site.date,checks:[]}))};
        if (store(updated)) show('card','Новая попытка пилота сохранена.');
        return;
      }
      const ids = planIds(form);
      const pilotId = ids.length === 1 ? ids[0] : planDraft.pilotId;
      if (!ids.length) return warn(form,'Отметь хотя бы одну точку.',form.querySelector('[data-point-option]'));
      if (!ids.includes(pilotId)) return warn(form,'Назначь пилотную точку.',form.querySelector('[data-rollout-action=pick-pilot]'));
      const text = get('title'), criterion = get('criterion');
      if (!text || !criterion) return warn(form,'Укажи название и критерий результата.',text ? form.elements.criterion : form.elements.title);
      const changed = row && (item.id !== row.recipeId || JSON.stringify(candidate) !== JSON.stringify(row.candidate));
      const sites = ids.map(id=>{
        const previous = row?.sites.find(site=>site.id === id);
        const site = previous ?? {id,date:today(),checks:[]};
        return changed ? {...site,checks:[]} : site;
      });
      const updated = {...(row ?? {id:crypto.randomUUID(),createdAt:now(),pilotHistory:[],decision:''}),
        title:text,criterion,recipeId:item.id,recipeTitle:title(item),candidate,pilotId,sites};
      if (!store(updated)) return;
      rolloutId = updated.id;
      show('card','План запуска сохранён.');
    }

    function readReady(form) {
      const values = new FormData(form);
      const date = String(values.get('date') ?? '');
      if (!validDay(date)) {
        warn(form,'Укажи плановую дату.',form.elements.date);
        return false;
      }
      return {...targetSite(),date,checks:values.getAll('check')};
    }

    function saveReady(form) {
      const site = readReady(form);
      return site && store(replaceSite(selected(),site));
    }

    function submitForm(form) {
      const values = new FormData(form);
      const get = key => String(values.get(key) ?? '').trim();
      if (form.dataset.form === 'rollout-plan') return persistPlan(form,get);
      if (form.dataset.form === 'rollout-ready') {
        if (saveReady(form)) show('site','Готовность сохранена.');
        return;
      }
      if (form.dataset.form === 'rollout-result') {
        const row = selected(), site = targetSite();
        const audit = siteAudits(row,site).find(item=>item.id === get('auditId'));
        if (!audit) return warn(form,'Выбери завершённый аудит выпуска.',form.elements.auditId);
        const after = foodCost(records(),site.id,row.recipeId,row.candidate);
        const result = {auditId:audit.id,quality:auditQuality(audit,row.recipeId),after,note:get('note'),at:now()};
        if (store(replaceSite(row,{...site,result}))) show('site','Итог запуска сохранён.');
      }
    }

    function activate() {
      const row = selected(), site = targetSite();
      const allowed = (site.id === row.pilotId && row.decision === '') || row.decision === 'expand';
      const item = recipe(row.recipeId);
      if (site.activation || !allowed || !item) return;
      const form = getMain().querySelector('[data-form=rollout-ready]');
      const updated = readReady(form);
      if (!updated) return;
      if (!ready(updated)) return warn(form,'Подтверди все пункты готовности перед запуском.',form.querySelector('[name=check]:not(:checked)'));
      if (!window.confirm('Ввести техкарту для точки «' + name(site.id) + '» сейчас?')) return;
      const prior = effective(item,site.id);
      const before = prior ? foodCost(records(),site.id,item.id,prior) : null;
      const version = {...row.candidate,pointId:site.id,id:crypto.randomUUID(),publishedAt:now()};
      const next = (records().recipes ?? []).map(recipe=>recipe.id === item.id ?
        {...recipe,versions:[...recipe.versions,version]} : recipe);
      const activation = {versionId:version.id,at:version.publishedAt,before};
      if (store(replaceSite(row,{...updated,activation}),next)) show('site','Техкарта введена на точке.');
    }

    function click(button) {
      const data = button.dataset, name = data.rolloutAction;
      if (name === 'exit') return exit();
      if (name === 'home' || name === 'card' || name === 'history') return show(name);
      if (name === 'new' || name === 'edit' || name === 'revise') {
        mode = name;
        if (name === 'new') rolloutId = undefined;
        planDraft = {recipeId:selected()?.recipeId,pilotId:selected()?.pilotId};
        return show('plan');
      }
      if (name === 'open') {
        rolloutId = data.rolloutId;
        return show('card');
      }
      if (name === 'candidate') {
        versionBack = screen;
        return show('candidate');
      }
      if (name === 'site') {
        siteId = data.pointId;
        return show('site');
      }
      if (name === 'pick-pilot') {
        const form = getMain().querySelector('[data-form=rollout-plan]');
        planDraft.pilotId = data.pointId;
        refreshPilot(form);
        return;
      }
      if (name === 'activate') return activate();
      if (name === 'equipment') {
        if (saveReady(getMain().querySelector('[data-form=rollout-ready]'))) openEquipment(siteId);
        return;
      }
      if (name === 'audit') return openAudit(siteId,targetSite().result?.auditId);
      if (name === 'work') return openWork(targetSite().workId);
      if (name === 'schedule') {
        if (!saveReady(getMain().querySelector('[data-form=rollout-ready]'))) return;
        return newWork({rolloutId,pointId:siteId},targetSite().date,('Проверить готовность · ' + selected().title).slice(0,200));
      }
      if (name === 'decide') {
        const row = selected(), site = targetSite();
        if (row.decision || site.id !== row.pilotId || !site.result) return;
        if (data.decision === 'stop' && !window.confirm('Остановить дальнейший запуск по этому плану?')) return;
        if (store({...row,decision:data.decision})) show('card','Решение по пилоту сохранено.');
      }
    }

    function refreshPilot(form) {
      const ids = planIds(form);
      if (!ids.includes(planDraft.pilotId)) planDraft.pilotId = undefined;
      form.querySelector('#rollout-pilot').innerHTML = pilotField(ids,planDraft.pilotId);
    }

    function change(control,selection) {
      const form = control.form;
      if (form?.dataset.form !== 'rollout-plan') return;
      if (selection !== undefined) refreshPilot(form);
      if (control.name === 'recipeId') {
        planDraft.recipeId = control.value;
        const versions = sources(recipe(control.value));
        if (mode === 'edit' && control.value === selected().recipeId) versions.saved = 'Техкарта, сохранённая в плане';
        form.elements.source.innerHTML = options(versions,Object.keys(versions)[0]);
      }
    }

    return {open,draw,click,change,submit:submitForm};
  }

  return {create,validate,linkWork};
})();
