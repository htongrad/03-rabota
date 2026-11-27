'use strict';
window.panel03Recipes = (() => {
  const text = value => typeof value === 'string';
  const filled = value => text(value) && Boolean(value.trim());
  const positive = value => /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value) && Number.isFinite(Number(value.replace(',', '.'))) &&
    Number(value.replace(',', '.')) > 0;
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;

  function validate(recipes, points) {
    const scopes = new Set(['', ...points.map(point => point.id)]);
    const content = recipe => recipe && scopes.has(recipe.pointId) && text(recipe.method) &&
      Array.isArray(recipe.ingredients) && recipe.ingredients.every(row =>
        row && text(row.name) && text(row.amount) && text(row.unit));
    const complete = recipe => filled(recipe.method) && recipe.ingredients.length > 0 &&
      recipe.ingredients.every(row => filled(row.name) && positive(row.amount) && filled(row.unit));
    return Array.isArray(recipes) && recipes.every(item => item && filled(item.id) && filled(item.name) &&
      Number.isSafeInteger(item.volumeMl) && item.volumeMl > 0 && Array.isArray(item.versions) &&
      item.versions.every(version => content(version) && complete(version) && filled(version.id) &&
        text(version.publishedAt) && Number.isFinite(Date.parse(version.publishedAt))) && unique(item.versions) &&
      (item.draft === undefined ? item.versions.length > 0 : content(item.draft))) && unique(recipes);
  }

  function effective(item, pointId = '') {
    let common;
    for (let index = item.versions.length - 1; index >= 0; index -= 1) {
      const version = item.versions[index];
      if (version.pointId === pointId) return version;
      if (!version.pointId && !common) common = version;
    }
    return common;
  }

  function create({getRecords, commit, redraw, hero, escape, hint, getMain}) {
    const dateFormat = new Intl.DateTimeFormat('ru', {dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Moscow'});
    const blank = {name:'', amount:'', unit:''};
    let screen, itemId, scope, filter, query, historyId, versionId, editor, dirty, preview;
    const records = () => getRecords().recipes ?? [];
    const points = () => getRecords().points;
    const item = () => records().find(row => row.id === itemId);
    const title = drink => drink.name + ' ' + drink.volumeMl + ' мл';
    const scopeName = id => id ? points().find(point => point.id === id)?.name ?? 'Точка' : 'Вся сеть';
    const versionType = version => version.pointId ? 'Версия для точки' : 'Общая версия';
    const stamp = version => dateFormat.format(new Date(version.publishedAt));
    const options = (value, common) => [{id:'',name:common}, ...points()].map(point =>
      `<option value="${escape(point.id)}"${point.id === value ? ' selected' : ''}>${escape(point.name)}</option>`).join('');
    const action = (name, label, primary = false) => `<button type="button" class="action${primary ? ' primary' : ''}" data-recipe-action="${name}">${label}</button>`;
    const back = (name, label) => `<button type="button" class="back" data-recipe-action="${name}">← ${label}</button>`;
    const normalized = value => value.trim().toLocaleLowerCase('ru').normalize('NFC');
    const contents = recipe => `<section class="section"><h2>Состав на порцию</h2>
      <ul class="recipe-composition">${recipe.ingredients.map(row => `<li><span>${escape(row.name)}</span><strong>${escape(row.amount.replace('.', ','))} ${escape(row.unit)}</strong></li>`).join('')}</ul></section>
      <section class="section"><h2>Порядок приготовления</h2><p class="record">${escape(recipe.method)}</p></section>`;

    function open() {
      screen = 'list';
      itemId = scope = filter = query = '';
      dirty = false;
      editor = preview = null;
    }

    function beforeLeave() {
      return !dirty || window.confirm('В черновике есть несохранённые изменения. Выйти без сохранения?');
    }

    function rows() {
      const search = normalized(query);
      const visible = records().filter(drink => normalized(title(drink)).includes(search) &&
        (!filter || effective(drink, filter) || (drink.draft && ['', filter].includes(drink.draft.pointId))));
      if (!visible.length) return `<p class="empty">${records().length ? 'По заданным условиям ничего не найдено.' :
        'Нажми «+», чтобы добавить первую позицию меню.'}</p>`;
      return visible.sort((first, second) => title(first).localeCompare(title(second), 'ru', {numeric:true})).map(drink => {
        const version = effective(drink, filter);
        const details = filter && version ? versionType(version) : '';
        return `<button type="button" class="section recipe-row" data-recipe-action="item" data-recipe-id="${escape(drink.id)}">
          <span><strong>${escape(title(drink))}</strong><small>${escape(details || (drink.versions.length ? 'Есть действующая техкарта' : 'Черновик'))}</small></span>
          <span aria-hidden="true">›</span></button>`;
      }).join('');
    }

    function list() {
      return `${back('overview', 'Обзор')}${hero('Меню и техкарты', 'Кофейное направление', true)}
        <div class="recipe-layout">
          <label>Поиск по меню<input type="search" name="recipe-search" value="${escape(query)}" placeholder="Напиток или объём"></label>
          <label>Фильтр по точке<select name="recipe-filter">${options(filter, 'Все точки')}</select></label>
          <div class="recipe-layout" id="recipe-results">${rows()}</div>
          ${records().some(drink => drink.versions.length) ? action('all-history', 'Открыть историю изменений') : ''}
        </div>`;
    }

    function card() {
      const drink = item();
      const version = effective(drink, scope);
      const current = [{id:'',name:'Вся сеть'}, ...points()].map(point => {
        const published = effective(drink, point.id);
        return `<li><span>${escape(point.name)}</span><small>${published ? versionType(published) : 'Техкарта ещё не введена'}</small></li>`;
      }).join('');
      return `${back('list', 'Меню и техкарты')}${hero(title(drink), 'Меню и техкарты', true)}
        <div class="recipe-layout">
          <section class="section"><h2>Какая версия действует</h2><ul class="recipe-composition">${current}</ul></section>
          <label>Точка для просмотра или правки<select name="recipe-scope">${options(scope, 'Вся сеть')}</select></label>
          <div class="recipe-layout" id="recipe-card-actions">${cardActions(drink, version)}</div>
          ${drink.versions.length ? action('history', 'История версий') : ''}
        </div>`;
    }

    function cardActions(drink, version) {
      return `${version ? action('current', 'Открыть состав и приготовление', true) : '<p class="empty">Для выбранной точки пока нет действующей техкарты.</p>'}
        ${drink.draft ? action('draft', 'Продолжить черновик · ' + escape(scopeName(drink.draft.pointId))) :
          action('draft', 'Создать новую версию')}`;
    }

    function ingredient(row, position) {
      return `<fieldset class="recipe-ingredient"><legend>Ингредиент ${position}</legend>
        <label>Название<input name="ingredient" maxlength="140" value="${escape(row.name)}"></label>
        <div class="times">
          <label>Количество<input name="amount" inputmode="decimal" maxlength="24" value="${escape(row.amount)}"></label>
          <label>Единица<input name="unit" list="recipe-units" maxlength="24" value="${escape(row.unit)}"></label>
        </div>
        ${action('remove-row', 'Убрать ингредиент')}</fieldset>`;
    }

    function form() {
      const drink = item();
      const editableTitle = !drink?.versions.length;
      return `${back('edit-back', drink ? 'К позиции' : 'Меню и техкарты')}
        ${hero(drink ? 'Черновик техкарты' : 'Новая позиция', drink ? title(drink) : 'Меню и техкарты', true)}
        <form data-form="recipe" novalidate>
          ${editableTitle ? `<label>Название напитка<input name="drinkName" maxlength="140" value="${escape(editor.name)}" required></label>
            <label>Объём, мл<input name="volume" inputmode="numeric" maxlength="12" value="${escape(editor.volume)}" required></label>` : ''}
          <div class="field-help"><label>Где будет действовать<select name="pointId">${options(editor.pointId, 'Вся сеть')}</select></label>
            ${hint('где действует техкарта', 'Версия для точки имеет приоритет. Общий рецепт действует на всех точках без своей версии.')}</div>
          <section class="section recipe-layout">
            <h2>Состав на порцию</h2>
            <div class="recipe-layout" id="recipe-ingredients">${editor.ingredients.map((row,index) => ingredient(row,index + 1)).join('')}</div>
            <datalist id="recipe-units"><option value="г"><option value="кг"><option value="мл"><option value="л"><option value="шт"></datalist>
            ${action('add-row', 'Добавить ингредиент')}
          </section>
          <label>Порядок приготовления<textarea name="method" maxlength="8000" rows="5">${escape(editor.method)}</textarea></label>
          <p class="notice recipe-error" role="alert" hidden></p>
          <button type="submit" class="action" value="draft">Сохранить черновик</button>
          <button type="submit" class="action primary" value="preview">Проверить и ввести в действие</button>
        </form>`;
    }

    function review() {
      return `${back('preview-back', 'К черновику')}${hero('Проверка техкарты', title(preview), true)}
        <div class="recipe-layout"><p>Где будет действовать <strong>${escape(scopeName(preview.pointId))}</strong></p>
          ${contents(preview)}${action('publish', 'Ввести в действие', true)}</div>`;
    }

    function history() {
      const drinks = historyId ? [item()] : records();
      const releases = drinks.flatMap(drink => [...drink.versions].reverse().map(version => ({drink,version})));
      if (!historyId) releases.sort((a,b) => Date.parse(b.version.publishedAt) - Date.parse(a.version.publishedAt));
      return `${back(historyId ? 'card' : 'list', historyId ? 'К позиции' : 'Меню и техкарты')}
        ${hero(historyId ? 'История версий' : 'История изменений', historyId ? title(item()) : 'Меню и техкарты', true)}
        <div class="recipe-layout">${releases.map(({drink,version}) => {
          const current = effective(drink,version.pointId)?.id === version.id;
          return `<button type="button" class="section recipe-row" data-recipe-action="release" data-recipe-id="${escape(drink.id)}" data-version-id="${escape(version.id)}">
            <span><strong>${escape(historyId ? scopeName(version.pointId) : title(drink))}</strong>
            <small>${historyId ? '' : escape(scopeName(version.pointId)) + ' · '}${escape(stamp(version))} · ${current ? 'Действует' : 'Предыдущая'}</small></span>
            <span aria-hidden="true">›</span></button>`;
        }).join('')}</div>`;
    }

    function recipe() {
      const drink = item();
      const version = screen === 'release' ? drink.versions.find(row => row.id === versionId) : effective(drink, scope);
      return `${back(screen === 'release' ? 'history-back' : 'card', screen === 'release' ? 'К истории' : 'К позиции')}
        ${hero(title(drink), 'Техкарта', true)}
        <div class="recipe-layout">
          <p>${escape(versionType(version))} · ${escape(scopeName(version.pointId))}<br><small>Введена в действие ${escape(stamp(version))}</small></p>
          ${contents(version)}
        </div>`;
    }

    function draw() {
      if (screen === 'list') return list();
      if (screen === 'card') return card();
      if (screen === 'edit') return form();
      if (screen === 'preview') return review();
      if (screen === 'history') return history();
      return recipe();
    }

    function edit(drink) {
      const source = drink?.draft ?? (drink ? effective(drink, scope) : undefined);
      editor = {name:drink?.name ?? '', volume:drink?.volumeMl ?? '', pointId:drink?.draft?.pointId ?? (drink ? scope : filter),
        ingredients:source?.ingredients?.length ? source.ingredients : [blank], method:source?.method ?? ''};
      dirty = false;
      screen = 'edit';
    }

    function readEditor(form) {
      const name = form.elements.drinkName?.value ?? editor.name;
      const volume = form.elements.volume?.value ?? editor.volume;
      return {name, volume, pointId:form.elements.pointId.value,
        ingredients:[...form.querySelectorAll('.recipe-ingredient')].map(row => ({
          name:row.querySelector('[name=ingredient]').value,
          amount:row.querySelector('[name=amount]').value,
          unit:row.querySelector('[name=unit]').value,
        })), method:form.elements.method.value};
    }

    function error(form, message, field) {
      const feedback = form.querySelector('.recipe-error');
      feedback.textContent = message;
      feedback.hidden = false;
      field.focus();
    }

    function store(drink, message) {
      const current = records();
      const next = itemId ? current.map(row => row.id === itemId ? drink : row) : [...current, drink];
      if (!commit(next)) return;
      itemId = drink.id;
      dirty = false;
      editor = preview = null;
      screen = 'card';
      redraw(message);
    }

    function submit(form, submittingButton) {
      const values = readEditor(form);
      const name = values.name.trim();
      const volumeMl = Number(values.volume);
      const fields = form.elements;
      if (!name) return error(form, 'Введи название напитка.', fields.drinkName);
      if (!/^\d+$/.test(String(values.volume).trim()) || !Number.isSafeInteger(volumeMl) || volumeMl < 1) {
        return error(form, 'Укажи объём целым числом в миллилитрах.', fields.volume);
      }
      if (fields.drinkName && records().some(row => row.id !== itemId && normalized(row.name) === normalized(name) && row.volumeMl === volumeMl)) {
        return error(form, 'Позиция с таким названием и объёмом уже есть в каталоге.', fields.drinkName);
      }
      const ingredients = values.ingredients.map(row => ({name:row.name.trim(), amount:row.amount.trim(), unit:row.unit.trim()}));
      const draft = {pointId:values.pointId, ingredients, method:values.method.trim()};
      if (submittingButton?.value !== 'preview') {
        scope = draft.pointId;
        store({id:itemId || crypto.randomUUID(), name, volumeMl, versions:item()?.versions ?? [], draft}, 'Черновик сохранён.');
        return;
      }
      const fieldsets = [...form.querySelectorAll('.recipe-ingredient')];
      for (const [index,row] of ingredients.entries()) {
        if (!row.name && !row.amount && !row.unit && ingredients.length > 1) continue;
        const invalid = !row.name ? ['ingredient','название ингредиента'] : !positive(row.amount) ? ['amount','количество больше нуля'] :
          !row.unit ? ['unit','единицу измерения'] : null;
        if (invalid) return error(form, `Строка ${index + 1}. Укажи ${invalid[1]}.`, fieldsets[index].querySelector('[name=' + invalid[0] + ']'));
      }
      draft.ingredients = ingredients.filter(row => row.name);
      if (!draft.ingredients.length) return error(form, 'Добавь хотя бы один ингредиент.', fieldsets[0].querySelector('[name=ingredient]'));
      if (!draft.method) return error(form, 'Опиши порядок приготовления.', fields.method);
      editor = values;
      preview = {name, volumeMl, ...draft};
      screen = 'preview';
      dirty = true;
      redraw();
    }

    function click(button) {
      const action = button.dataset.recipeAction;
      if (action === 'overview') return false;
      if (action === 'list') {
        screen = 'list';
      } else if (action === 'item') {
        itemId = button.dataset.recipeId;
        scope = filter;
        screen = 'card';
      } else if (action === 'new' || action === 'draft') {
        if (action === 'new') itemId = '';
        edit(item());
      } else if (action === 'add-row' || action === 'remove-row') {
        const list = getMain().querySelector('#recipe-ingredients');
        const adding = action === 'add-row';
        const removed = adding ? null : button.closest('.recipe-ingredient');
        const focus = removed?.nextElementSibling?.querySelector('input') ?? removed?.previousElementSibling?.querySelector('input');
        removed?.remove();
        if (adding || !list.children.length) list.insertAdjacentHTML('beforeend', ingredient(blank, list.children.length + 1));
        [...list.children].forEach((row,index) => row.querySelector('legend').textContent = 'Ингредиент ' + (index + 1));
        (focus ?? list.lastElementChild.querySelector('input')).focus();
        dirty = true;
        return true;
      } else if (action === 'edit-back') {
        if (!beforeLeave()) return true;
        dirty = false;
        screen = itemId ? 'card' : 'list';
      } else if (action === 'preview-back') {
        screen = 'edit';
      } else if (action === 'publish') {
        const {name,volumeMl,...content} = preview;
        const version = {...content, id:crypto.randomUUID(), publishedAt:new Date().toISOString()};
        scope = version.pointId;
        store({id:itemId || crypto.randomUUID(), name, volumeMl, versions:[...(item()?.versions ?? []), version]}, 'Техкарта введена в действие.');
        return true;
      } else if (action === 'history' || action === 'all-history' || action === 'history-back') {
        if (action !== 'history-back') historyId = action === 'history' ? itemId : '';
        screen = 'history';
      } else if (action === 'release') {
        itemId = button.dataset.recipeId;
        versionId = button.dataset.versionId;
        screen = 'release';
      } else if (['card','current'].includes(action)) {
        screen = action;
      } else {
        return false;
      }
      redraw();
      return true;
    }

    function change(target) {
      const name = target.name;
      if (target.form?.dataset.form === 'recipe') {
        dirty = true;
        target.form.querySelector('.recipe-error').hidden = true;
      } else if (name === 'recipe-filter' || name === 'recipe-search') {
        if (name === 'recipe-filter') filter = target.value;
        else query = target.value;
        getMain().querySelector('#recipe-results').innerHTML = rows();
      } else if (name === 'recipe-scope') {
        scope = target.value;
        getMain().querySelector('#recipe-card-actions').innerHTML = cardActions(item(), effective(item(), scope));
      }
    }

    return {open, draw, click, change, submit, beforeLeave, isList:() => screen === 'list'};
  }

  return {validate, effective, create};
})();
