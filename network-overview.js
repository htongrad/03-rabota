'use strict';
window.panel03NetworkOverview = (() => {
  const categories = {
    audit:'Аудит', equipment:'Оборудование', stock:'Сырьё', work:'Дела', economy:'Экономика',
  };
  const auditDate = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeZone:'Europe/Moscow'});

  function collect({records,workRows,scopeFor,today,selected,includeNetwork,effective}) {
    const groups = Object.fromEntries(Object.keys(categories).map(kind => [kind,{rows:[],hasData:false}]));
    const {panel03Audits:audits,panel03Stock:stock,panel03Economy:economy} = window;
    for (const audit of records.audits ?? []) {
      if (!selected.has(audit.pointId) || !audit.completedAt) continue;
      groups.audit.hasData = true;
      for (const drink of audit.drinks) {
        for (const check of drink.checks.filter(audits.isOpenIssue)) {
          groups.audit.rows.push({kind:'audit',pointId:audit.pointId,id:audit.id,drinkId:drink.id,checkId:check.id,
            at:new Date(audit.completedAt).toISOString(),title:drink.title,note:check.note});
        }
      }
    }
    for (const asset of records.equipment ?? []) {
      if (!selected.has(asset.pointId)) continue;
      groups.equipment.hasData = true;
      if (!asset.issue) continue;
      const report = asset.history.find(row => row.id === asset.issue.reportId);
      groups.equipment.rows.push({kind:'equipment',pointId:asset.pointId,id:asset.id,at:report.day,
        title:asset.name,note:'Нужна диагностика'});
    }
    for (const book of records.stock ?? []) {
      if (!selected.has(book.id)) continue;
      const items = new Map(book.items.map(item => [item.id,item]));
      for (const {row,line} of stock.latestCounts(book).values()) {
        if (line.expected === null) continue;
        groups.stock.hasData = true;
        if (line.actual >= line.expected) continue;
        const item = items.get(line.itemId);
        groups.stock.rows.push({kind:'stock',pointId:book.id,id:row.id,at:row.date,
          title:item.name,note:'Недостача ' + stock.amount(line.expected - line.actual,item.unit)});
      }
    }
    const overdue = new Map();
    for (const {record,entry,slot,work} of workRows()) {
      const scope = scopeFor(work);
      if (!entry.date || (scope === null ? !includeNetwork : !scope.some(id => selected.has(id)))) continue;
      groups.work.hasData = true;
      if (entry.date >= today || work.status === 'done') continue;
      const previous = overdue.get(record.id);
      if (!previous || entry.date > previous.at) {
        overdue.set(record.id,{kind:'work',pointIds:scope,id:record.id,slot,at:entry.date,title:entry.title,note:'Просрочено'});
      }
    }
    groups.work.rows = [...overdue.values()];

    const recipes = new Map((records.recipes ?? []).map(recipe => [recipe.id,recipe]));
    for (const point of records.economy ?? []) {
      if (!selected.has(point.id)) continue;
      for (const drink of point.drinks) {
        if (drink.goal === undefined) continue;
        const recipe = recipes.get(drink.id);
        const version = recipe && effective(recipe,point.id);
        if (!version) continue;
        const cost = economy.foodCost(records,point.id,drink.id,version);
        if (cost === null) continue;
        groups.economy.hasData = true;
        if (BigInt(cost) > BigInt(drink.goal)) {
          groups.economy.rows.push({kind:'economy',pointId:point.id,id:drink.id,
            title:recipe.name + ' ' + recipe.volumeMl + ' мл',
            note:economy.formatRate(cost) + ' при цели ' + economy.formatRate(drink.goal)});
        }
      }
    }
    for (const group of Object.values(groups)) {
      group.rows.sort((a,b) => (b.at ?? '').localeCompare(a.at ?? '') || a.title.localeCompare(b.title,'ru'));
    }
    return groups;
  }

  function create({records,workRows,picker,effective,today,hero,help,escape,showDay,getMain,redraw,exit,openSource}) {
    const plural = new Intl.PluralRules('ru-RU');
    let category = 'all';
    let selected = null;
    let includeNetwork = false;
    let editing = false;
    let displayed = [];

    function scope() {
      const points = records().points;
      return new Set(points.filter(point => selected === null || selected.includes(point.id)).map(point => point.id));
    }

    function selectPoints() {
      const points = records().points;
      return `<button type="button" class="back" data-network-action="cancel">← К сводке</button>
        ${hero('Точки для сводки','',true)}
        <form data-form="network-overview">
          ${picker.picker(points,selected,{name:'network-overview',label:'Точки',escape,allLabel:'Выбрать все',
            hint:help('точки сводки','Отметь нужные точки. Дело, назначенное на несколько выбранных точек, появится одной строкой.')})}
          <label class="check"><input type="checkbox" name="network"${includeNetwork ? ' checked' : ''}> Общие дела сети</label>
          <button type="submit" class="action primary">Применить</button>
        </form>`;
    }

    function line(row,index,points) {
      const scopeName = row.kind === 'work'
        ? (row.pointIds === null ? 'Вся сеть' : row.pointIds.filter(id => points.has(id)).map(id => points.get(id)).join(', '))
        : points.get(row.pointId);
      const date = row.kind === 'audit' ? auditDate.format(new Date(row.at)) : row.at ? showDay(row.at) : '';
      const note = row.note.length > 140 ? row.note.slice(0,137).trimEnd() + '…' : row.note;
      return `<button type="button" class="action network-row" data-network-action="source" data-index="${index}">
        <span><small>${escape(categories[row.kind] + ' · ' + scopeName)}</small>
          <strong>${escape(row.title)}</strong>
          <span class="network-description">${escape(note)}${date ? ' · ' + escape(date) : ''}</span>
        </span><span aria-hidden="true">→</span></button>`;
    }

    function draw() {
      if (editing) return selectPoints();
      const state = records();
      const chosen = scope();
      const points = new Map(state.points.filter(point => chosen.has(point.id)).map(point => [point.id,point.name]));
      const groups = collect({records:state,workRows,scopeFor:picker.scopeFor,today:today(),selected:chosen,includeNetwork,effective});
      const active = category === 'all' ? Object.values(groups) : [groups[category]];
      displayed = active.flatMap(group => group.rows);
      const count = chosen.size;
      const pointTerm = {one:'точка',few:'точки',many:'точек',other:'точки'}[plural.select(count)];
      const caption = count + ' ' + pointTerm + (includeNetwork ? ' · Дела сети' : '');
      const filters = [['all','Все'],...Object.entries(categories)].map(([kind,label]) => {
        const group = groups[kind];
        const amount = group ? ' · ' + (group.hasData ? group.rows.length : '—') : '';
        return `<button type="button" class="action" data-network-action="category" data-kind="${kind}"
          aria-pressed="${category === kind}">${label + amount}</button>`;
      }).join('');
      const empty = count === 0 && !includeNetwork ? 'Выбери точки или общие дела сети.' :
        active.some(group => group.hasData) ? 'По доступным данным отклонений нет.' : 'Пока нет данных для сводки.';
      return `<button type="button" class="back" data-network-action="exit">← Обзор</button>
        ${hero('Сводка сети','Открытые отклонения и последние сверки',true)}
        <button type="button" class="action network-points" data-network-action="points">
          <strong>${caption}</strong><span>Изменить выбор</span></button>
        <div class="network-filters" role="group" aria-label="Категории сводки">${filters}</div>
        <div class="help-title"><h2>Требует внимания</h2>
          ${help('показатели сводки','Сводка обновляется по исходным записям. Прочерк означает, что для показателя пока нет данных.')}</div>
        ${displayed.length ? `<div class="network-list">${displayed.map((row,index) => line(row,index,points)).join('')}</div>` :
          `<p class="empty">${empty}</p>`}`;
    }

    function click(button) {
      const {networkAction:action,kind,index} = button.dataset;
      if (action === 'exit') return exit();
      if (action === 'source') return openSource(displayed[Number(index)]);
      if (action === 'category') {
        category = kind;
        redraw('',false);
        getMain().querySelector('[data-network-action=category][aria-pressed=true]').focus({preventScroll:true});
        return;
      }
      editing = action === 'points';
      redraw();
    }

    function submit(form) {
      const choices = picker.read(form.querySelector('[data-point-picker]'));
      selected = choices?.length === records().points.length && choices.length ? null : choices;
      includeNetwork = form.elements.network.checked;
      editing = false;
      redraw();
    }

    return {open() { editing = false; },draw,click,submit};
  }

  return {create};
})();
