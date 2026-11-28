'use strict';
window.panel03Stock = (() => {
  const units = {kg:'кг',g:'г',l:'л',ml:'мл',pcs:'шт'};
  const movements = {receipt:'Приход',use:'Расход',waste:'Списание'};
  const scale = 1000;
  const limit = 9999999999;
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const quantity = value => Number.isSafeInteger(value) && value >= 0 && value <= limit;
  const unique = rows => new Set(rows).size === rows.length;

  function readQuantity(value) {
    const input = value.trim();
    if (!/^(?:\d{1,7}(?:[.,]\d{1,3})?|[.,]\d{1,3})$/.test(input)) return null;
    const [whole, fraction = ''] = input.replace(',','.').split('.');
    return Number(whole) * scale + Number(fraction.padEnd(3,'0'));
  }

  function validate(books, points, validDay) {
    const pointIds = new Set(points.map(row => row.id));
    function validBook(book) {
      if (!book || !pointIds.has(book.id) || !Array.isArray(book.items) ||
          !book.items.every(item => item && present(item.id) && present(item.name) &&
            typeof item.unit === 'string' && Object.hasOwn(units,item.unit)) ||
          !unique(book.items.map(item => item.id)) || !Array.isArray(book.journal)) return false;
      const ids = new Set(book.items.map(item => item.id));
      const validCountLines = (lines, valid) => Array.isArray(lines) && lines.length > 0 &&
        lines.every(line => line && ids.has(line.itemId) && valid(line)) && unique(lines.map(line => line.itemId));
      const validMovement = row => typeof row.kind === 'string' && Object.hasOwn(movements,row.kind) &&
        ids.has(row.itemId) && quantity(row.amount) && row.amount > 0;
      const validCount = row => validCountLines(row.lines,line =>
        quantity(line.actual) && (line.expected === null || Number.isSafeInteger(line.expected)));
      return book.journal.every(row => row && present(row.id) && validDay(row.date) && typeof row.note === 'string' &&
        (row.kind === 'count' ? validCount(row) : validMovement(row))) && unique(book.journal.map(row => row.id)) &&
        (book.draft === undefined || (book.draft && validDay(book.draft.date) && typeof book.draft.note === 'string' &&
          validCountLines(book.draft.lines,line => line.actual === null || quantity(line.actual))));
    }
    return Array.isArray(books) && books.every(validBook) && unique(books.map(book => book.id));
  }

  function balances(book, date) {
    const result = new Map();
    const rows = book.journal.filter(row => row.date <= date).sort((a,b) => a.date.localeCompare(b.date));
    for (const row of rows) {
      if (row.kind === 'count') {
        for (const line of row.lines) result.set(line.itemId,line.actual);
      } else if (result.has(row.itemId)) {
        const change = row.kind === 'receipt' ? row.amount : -row.amount;
        result.set(row.itemId,result.get(row.itemId) + change);
      }
    }
    return result;
  }

  function lastCountDates(book) {
    const dates = new Map();
    for (const row of book.journal) {
      if (row.kind !== 'count') continue;
      for (const line of row.lines) {
        if (!dates.has(line.itemId) || dates.get(line.itemId) < row.date) dates.set(line.itemId,row.date);
      }
    }
    return dates;
  }

  function create({records, hero, escape, options, getMain, today, validDay, commit, redraw, exit}) {
    const formatter = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3});
    const dateFormat = new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
    const dateText = date => dateFormat.format(new Date(date + 'T00:00:00Z'));
    const action = (name, label, {primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-stock-action="${name}" ${data}>${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const back = (name,label) => `<button type="button" class="back" data-stock-action="${name}">← ${label}</button>`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const books = () => records().stock ?? [];
    const point = () => records().points.find(row => row.id === pointId);
    const book = () => books().find(row => row.id === pointId) ?? {id:pointId,items:[],journal:[]};
    const item = id => book().items.find(row => row.id === id);
    const items = () => [...book().items].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    const valueText = value => formatter.format(value / scale);
    const amount = (value,unit) => valueText(value) + ' ' + units[unit];
    const expectedText = (value,unit) => value === null ? 'Нет начального остатка' : amount(value,unit);
    const diffText = (actual,expected,unit) => expected === null || actual === null ? '—' :
      (actual > expected ? '+' : '') + amount(actual - expected,unit);
    let screen, pointId, itemId, countId, expected;

    function open(id) {
      pointId = id;
      screen = 'home';
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function store(updated) {
      const all = books();
      return commit(all.some(row => row.id === updated.id) ? all.map(row => row.id === updated.id ? updated : row) : [...all,updated]);
    }

    function home() {
      const row = book();
      const current = balances(row,today());
      return `${back('point','Карточка точки')}${hero('Сырьё',point().name,true)}
        <div class="audit-layout">
          <section class="section audit-layout"><h2>Остатки по учёту</h2>
            ${row.items.length ? `<div class="audit-list">${items().map(entry => action('edit-item',
              `<strong>${escape(entry.name)}</strong><small>${escape(expectedText(current.get(entry.id) ?? null,entry.unit))}</small>`,
              {data:'data-item-id="' + escape(entry.id) + '"'})).join('')}</div>` : '<p>Добавь сырьё, чтобы начать учёт.</p>'}
          </section>
          ${row.draft ? action('resume','Продолжить пересчёт',{primary:true}) :
            row.items.length ? action('start','Начать инвентаризацию',{primary:true}) : ''}
          ${action('add','Добавить сырьё',{primary:row.items.length === 0})}
          ${row.items.length ? action('movement','Записать движение') : ''}
          ${action('journal','Журнал движений')}
          ${action('history','История инвентаризаций')}
        </div>`;
    }

    function itemForm() {
      const selected = item(itemId);
      const locked = selected && (book().journal.some(row => row.itemId === selected.id ||
        row.lines?.some(line => line.itemId === selected.id)) || book().draft?.lines.some(line => line.itemId === selected.id));
      return `${back('home','К сырью')}${hero(selected ? 'Карточка сырья' : 'Новое сырьё',point().name,true)}
        <form data-form="stock-item">
          <label>Название<input name="name" maxlength="140" value="${escape(selected?.name)}" required></label>
          <label>Единица учёта<select name="unit"${locked ? ' disabled' : ''}>${options(units,selected?.unit ?? 'kg')}</select></label>
          ${locked ? '<small>Единица зафиксирована в записях этой позиции.</small>' : ''}
          ${warning}${submit('Сохранить сырьё')}
        </form>`;
    }

    function movementForm() {
      const choices = items().map(entry => [entry.id,entry.name + ' · ' + units[entry.unit]]);
      return `${back('home','К сырью')}${hero('Движение сырья',point().name,true)}
        <form data-form="stock-movement">
          <label>Сырьё<select name="itemId">${options(Object.fromEntries(choices),choices[0]?.[0])}</select></label>
          <label>Операция<select name="kind">${options(movements,'receipt')}</select></label>
          <label>Дата<input type="date" name="date" value="${today()}" max="${today()}" required></label>
          <label>Количество<input name="amount" inputmode="decimal" maxlength="12" required></label>
          <label>Комментарий<textarea name="note" maxlength="800" rows="3"></textarea></label>
          ${warning}${submit('Сохранить движение')}
        </form>`;
    }

    function setup() {
      const draft = book().draft;
      return `${back(draft ? 'resume' : 'home',draft ? 'К пересчёту' : 'К сырью')}${hero('Инвентаризация',point().name,true)}
        <form data-form="stock-setup">
          <label>Дата пересчёта<input type="date" name="date" value="${escape(draft?.date ?? today())}" max="${today()}" required></label>
          <fieldset class="point-picker"><legend>Сырьё для пересчёта</legend>
            <label class="check"><input type="checkbox" data-stock-all${!draft || draft.lines.length === items().length ? ' checked' : ''}> Выбрать всё</label>
            <div class="audit-choices">${items().map(row =>
              `<label class="check"><input type="checkbox" name="item" value="${escape(row.id)}"${!draft || draft.lines.some(line => line.itemId === row.id) ? ' checked' : ''}>
               ${escape(row.name)} · ${escape(units[row.unit])}</label>`).join('')}</div>
          </fieldset>
          ${warning}${submit('Перейти к пересчёту')}
        </form>`;
    }

    function countForm() {
      const row = book();
      const draft = row.draft;
      expected = balances(row,draft.date);
      return `${hero('Пересчёт сырья',point().name + ' · ' + dateText(draft.date),true)}
        <form data-form="stock-count">
          ${draft.lines.map(line => {
            const entry = item(line.itemId);
            const baseline = expected.get(entry.id) ?? null;
            return `<section class="section audit-layout"><h2>${escape(entry.name)}</h2>
              <p>По учёту: ${escape(expectedText(baseline,entry.unit))}</p>
              <label>Фактический остаток, ${escape(units[entry.unit])}<input name="actual" inputmode="decimal" maxlength="12"
                aria-label="${escape('Фактический остаток · ' + entry.name + ', ' + units[entry.unit])}"
                data-item-id="${escape(entry.id)}" value="${escape(line.actual === null ? '' : valueText(line.actual).replace(/[\s\u202f]/g,''))}"></label>
              <p>Отклонение: <strong data-stock-difference>${escape(diffText(line.actual,baseline,entry.unit))}</strong></p>
            </section>`;
          }).join('')}
          ${warning}${submit('Проверить итог')}
          ${action('pause','Продолжить позже')}
          ${action('setup','Изменить дату или сырьё')}
        </form>`;
    }

    function resultRows(lines) {
      return lines.map(line => {
        const entry = item(line.itemId);
        return `<section class="section audit-layout"><h2>${escape(entry.name)}</h2>
          <dl class="recipe-composition stock-result">
            <div><dt>По учёту</dt><dd>${escape(expectedText(line.expected,entry.unit))}</dd></div>
            <div><dt>По факту</dt><dd>${escape(amount(line.actual,entry.unit))}</dd></div>
            <div><dt>Расхождение</dt><dd>${escape(diffText(line.actual,line.expected,entry.unit))}</dd></div>
          </dl></section>`;
      }).join('');
    }

    function compare(row) {
      const baseline = balances(row,row.draft.date);
      return row.draft.lines.map(line => ({...line,expected:baseline.get(line.itemId) ?? null}));
    }

    function review() {
      const row = book();
      const draft = row.draft;
      return `${hero('Итог пересчёта',point().name + ' · ' + dateText(draft.date),true)}
        <form data-form="stock-review">${resultRows(compare(row))}
          <label>Комментарий к расхождению<textarea name="note" maxlength="800" rows="3">${escape(draft.note)}</textarea></label>
          <p>После подтверждения учёт продолжится с фактических остатков.</p>
          ${warning}${submit('Подтвердить остаток')}
          ${action('resume','Вернуться к пересчёту')}
        </form>`;
    }

    function journal() {
      const rows = book().journal.filter(row => row.kind !== 'count').reverse().sort((a,b)=>b.date.localeCompare(a.date));
      return `${back('home','К сырью')}${hero('Журнал движений',point().name,true)}
        ${rows.length ? `<div class="audit-layout">${rows.map(row => {
          const entry = item(row.itemId);
          return `<section class="section audit-layout"><h2>${escape(entry.name)}</h2>
            <p><strong>${escape(movements[row.kind])} · ${escape(amount(row.amount,entry.unit))}</strong> · ${escape(dateText(row.date))}</p>
            ${row.note ? `<p class="record">${escape(row.note)}</p>` : ''}</section>`;
        }).join('')}</div>` : '<p class="empty">Движений пока нет.</p>'}`;
    }

    function history() {
      const rows = book().journal.filter(row => row.kind === 'count').reverse().sort((a,b)=>b.date.localeCompare(a.date));
      return `${back('home','К сырью')}${hero('История инвентаризаций',point().name,true)}
        ${rows.length ? `<div class="audit-list">${rows.map(row => {
          const differences = row.lines.filter(line => line.expected !== null && line.actual !== line.expected).length;
          return action('count-details',
            `<strong>${escape(dateText(row.date))}</strong><small>Позиций: ${row.lines.length} · Расхождений: ${differences}</small>`,
            {data:'data-count-id="' + escape(row.id) + '"'});
        }).join('')}</div>` : '<p class="empty">Подтверждённых инвентаризаций пока нет.</p>'}`;
    }

    function details() {
      const row = book().journal.find(entry => entry.id === countId);
      return `${back('history','К истории')}${hero('Итог инвентаризации',point().name + ' · ' + dateText(row.date),true)}
        <div class="audit-layout">${resultRows(row.lines)}${row.note ? `<p class="record">${escape(row.note)}</p>` : ''}</div>`;
    }

    function draw() {
      if (screen === 'item') return itemForm();
      if (screen === 'movement') return movementForm();
      if (screen === 'setup') return setup();
      if (screen === 'count') return countForm();
      if (screen === 'review') return review();
      if (screen === 'journal') return journal();
      if (screen === 'history') return history();
      if (screen === 'details') return details();
      return home();
    }

    function warn(form, message, field) {
      const notice = form.querySelector('[role=alert]');
      notice.textContent = message;
      notice.hidden = false;
      field?.focus();
      return false;
    }

    function checkDate(row, date, ids, form) {
      if (!validDay(date) || date > today()) return warn(form,'Укажи дату не позже сегодняшнего дня.',form.elements.date);
      const dates = lastCountDates(row);
      if (ids.some(id => dates.has(id) && dates.get(id) > date)) {
        return warn(form,'Выбери дату не раньше последней подтверждённой инвентаризации по этому сырью.',form.elements.date);
      }
      return true;
    }

    function saveCount(form, complete = false) {
      const row = book();
      const fields = Array.from(form.querySelectorAll('[name=actual]'));
      const lines = [];
      for (const field of fields) {
        const input = field.value.trim();
        const actual = readQuantity(input);
        if (actual === null && (input || complete)) return warn(form,
          input ? 'Введи количество с точностью до трёх знаков после запятой.' : 'Укажи фактический остаток. Если сырья нет, введи 0.',field);
        lines.push({itemId:field.dataset.itemId,actual});
      }
      if (lines.every((line,index) => line.actual === row.draft.lines[index].actual)) return true;
      return store({...row,draft:{...row.draft,lines}});
    }

    function saveReview(form) {
      const row = book();
      const note = form.elements.note.value.trim();
      return note === row.draft.note || store({...row,draft:{...row.draft,note}});
    }

    function submitForm(form) {
      const row = book();
      const values = new FormData(form);
      const get = name => String(values.get(name) ?? '').trim();
      if (screen === 'item') {
        const name = get('name');
        if (!name) return warn(form,'Укажи название сырья.',form.elements.name);
        const old = item(itemId);
        if (row.items.some(entry => entry.id !== itemId && entry.name.localeCompare(name,'ru',{sensitivity:'base'}) === 0)) {
          return warn(form,'Сырьё с таким названием уже есть.',form.elements.name);
        }
        const updated = {id:old?.id ?? crypto.randomUUID(),name,unit:get('unit') || old?.unit};
        const next = old ? row.items.map(entry => entry.id === old.id ? updated : entry) : [...row.items,updated];
        if (store({...row,items:next})) show('home','Сырьё сохранено.');
      } else if (screen === 'movement') {
        const itemId = get('itemId'), date = get('date'), kind = get('kind');
        const amount = readQuantity(get('amount'));
        if (!amount) return warn(form,'Введи количество больше нуля с точностью до трёх знаков.',form.elements.amount);
        if (!checkDate(row,date,[itemId],form)) return;
        const entry = {id:crypto.randomUUID(),kind,itemId,date,amount,note:get('note')};
        if (store({...row,journal:[...row.journal,entry]})) show('home','Движение сохранено.');
      } else if (screen === 'setup') {
        const date = get('date'), ids = values.getAll('item');
        if (!ids.length) return warn(form,'Отметь хотя бы одну позицию.',form.querySelector('[name=item]'));
        if (!checkDate(row,date,ids,form)) return;
        const old = row.draft;
        const lines = ids.map(itemId => ({itemId,actual:old?.lines.find(line => line.itemId === itemId)?.actual ?? null}));
        if (store({...row,draft:{date,lines,note:old?.note ?? ''}})) show('count');
      } else if (screen === 'count') {
        if (saveCount(form,true)) show('review');
      } else if (screen === 'review') {
        if (!checkDate(row,row.draft.date,row.draft.lines.map(line=>line.itemId),form)) return;
        const entry = {id:crypto.randomUUID(),kind:'count',date:row.draft.date,note:get('note'),lines:compare(row)};
        const next = {...row,journal:[...row.journal,entry]};
        delete next.draft;
        if (!store(next)) return;
        countId = entry.id;
        show('details','Остатки подтверждены.');
      }
    }

    function beforeLeave() {
      if (screen === 'count') return saveCount(getMain().querySelector('[data-form=stock-count]'));
      if (screen === 'review') return saveReview(getMain().querySelector('[data-form=stock-review]'));
      return true;
    }

    function click(button) {
      const data = button.dataset, name = data.stockAction;
      if (name === 'point') return exit(point());
      if (['home','journal','history','movement'].includes(name)) return show(name);
      if (name === 'add' || name === 'edit-item') {
        itemId = data.itemId;
        return show('item');
      }
      if (name === 'start' || name === 'setup') {
        if (beforeLeave()) show('setup');
        return;
      }
      if (name === 'resume') {
        if (beforeLeave()) show('count');
        return;
      }
      if (name === 'pause') {
        if (beforeLeave()) show('home','Черновик сохранён.');
        return;
      }
      if (name === 'count-details') {
        countId = data.countId;
        return show('details');
      }
    }

    function change(field) {
      const form = field.form;
      if (form?.dataset.form !== 'stock-setup') return;
      const all = form.querySelector('[data-stock-all]');
      const inputs = [...form.querySelectorAll('[name=item]')];
      if (field === all) inputs.forEach(input => { input.checked = all.checked; });
      const selected = inputs.filter(input=>input.checked).length;
      all.checked = selected === inputs.length;
      all.indeterminate = selected > 0 && !all.checked;
    }

    function input(field) {
      if (field.name !== 'actual' || field.form?.dataset.form !== 'stock-count') return;
      const entry = item(field.dataset.itemId);
      field.closest('section').querySelector('[data-stock-difference]').textContent =
        diffText(readQuantity(field.value),expected.get(entry.id) ?? null,entry.unit);
    }

    return {open,draw,submit:submitForm,click,change,input,beforeLeave};
  }

  return {create,validate,readQuantity,units};
})();
