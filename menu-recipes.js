'use strict';
window.panel03Recipes = (() => {
  const pointPicker = window.panel03Points;
  const text = value => typeof value === 'string';
  const filled = value => text(value) && Boolean(value.trim());
  const positive = value => /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value) && Number.isFinite(Number(value.replace(',', '.'))) &&
    Number(value.replace(',', '.')) > 0;
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;

  function completeRecipe(recipe) {
    return !!recipe && filled(recipe.method) && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 &&
      recipe.ingredients.every(row => row && filled(row.name) && text(row.amount) && positive(row.amount) && filled(row.unit));
  }

  function validate(recipes, points) {
    const content = recipe => recipe && pointPicker.validScope(recipe, points) && text(recipe.method) &&
      Array.isArray(recipe.ingredients) && recipe.ingredients.every(row =>
        row && text(row.name) && text(row.amount) && text(row.unit));
    return Array.isArray(recipes) && recipes.every(item => item && filled(item.id) && filled(item.name) &&
      Number.isSafeInteger(item.volumeMl) && item.volumeMl > 0 && Array.isArray(item.versions) &&
      item.versions.every(version => content(version) && completeRecipe(version) && filled(version.id) &&
        text(version.publishedAt) && Number.isFinite(Date.parse(version.publishedAt))) && unique(item.versions) &&
      (item.draft === undefined ? item.versions.length > 0 : content(item.draft))) && unique(recipes);
  }

  function effective(item, pointId = '') {
    let common;
    for (let index = item.versions.length - 1; index >= 0; index -= 1) {
      const version = item.versions[index];
      const assigned = pointPicker.scopeFor(version);
      if (assigned?.includes(pointId)) return version;
      if (!assigned && !common) common = version;
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
    const scopeName = selection => pointPicker.scopeName(selection, points());
    function versionType(version) {
      const assigned = pointPicker.scopeFor(version);
      if (!assigned) return 'Общая версия';
      return assigned.length === 1 ? 'Версия для точки' : 'Версия для нескольких точек';
    }
    const stamp = version => dateFormat.format(new Date(version.publishedAt));
    const picker = (name, label, selection, options) => pointPicker.picker(points(), selection, {name,label,escape,...options});
    const action = (name, label, primary = false) => `<button type="button" class="action${primary ? ' primary' : ''}" data-recipe-action="${name}">${label}</button>`;
    const back = (name, label) => `<button type="button" class="back" data-recipe-action="${name}">← ${label}</button>`;
    const normalized = value => value.trim().toLocaleLowerCase('ru').normalize('NFC');
    const contents = recipe => `<section class="section"><h2>Состав на порцию</h2>
      <ul class="recipe-composition">${recipe.ingredients.map(row => `<li><span>${escape(row.name)}</span><strong>${escape(row.amount.replace('.', ','))} ${escape(row.unit)}</strong></li>`).join('')}</ul></section>
      <section class="section"><h2>Порядок приготовления</h2><p class="record">${escape(recipe.method)}</p></section>`;

    function open() {
      screen = 'list';
      itemId = query = '';
      scope = filter = null;
      dirty = false;
      editor = preview = null;
    }

    function beforeLeave() {
      return !dirty || window.confirm('В черновике есть несохранённые изменения. Выйти без сохранения?');
    }

    function rows() {
      const search = normalized(query);
      const visible = records().filter(drink => normalized(title(drink)).includes(search) &&
        (!filter || filter.some(id => {
          const draftScope = drink.draft && pointPicker.scopeFor(drink.draft);
          return effective(drink, id) || (drink.draft && (!draftScope || draftScope.includes(id)));
        })));
      if (!visible.length) return `<p class="empty">${records().length ? 'По заданным условиям ничего не найдено.' :
        'Нажми «+», чтобы добавить первую позицию меню.'}</p>`;
      return visible.sort((first, second) => title(first).localeCompare(title(second), 'ru', {numeric:true})).map(drink => {
        const version = filter?.length === 1 ? effective(drink, filter[0]) : undefined;
        const details = version ? versionType(version) : '';
        return `<button type="button" class="section recipe-row" data-recipe-action="item" data-recipe-id="${escape(drink.id)}">
          <span><strong>${escape(title(drink))}</strong><small>${escape(details || (drink.versions.length ? 'Есть действующая техкарта' : 'Черновик'))}</small></span>
          <span aria-hidden="true">›</span></button>`;
      }).join('');
    }

    function list() {
      return `${hero('Меню и техкарты', 'Кофейное направление', true)}
        <div class="recipe-layout">
          <label>Поиск по меню<input type="search" name="recipe-search" value="${escape(query)}" placeholder="Напиток или объём"></label>
          ${picker('recipe-filter', 'Фильтр по точкам', filter, {allLabel:'Выбрать все'})}
          <div class="recipe-layout" id="recipe-results">${rows()}</div>
          ${records().some(drink => drink.versions.length) ? action('all-history', 'Открыть историю изменений') : ''}
        </div>`;
    }

    function card() {
      const drink = item();
      const choices = points().map(point => {
        const published = effective(drink, point.id);
        return {...point, detail:published ? versionType(published) : 'Техкарта ещё не введена'};
      });
      const allDetail = effective(drink) ? 'Есть общая техкарта' : 'Общая техкарта ещё не введена';
      return `${back('list', 'Меню и техкарты')}${hero(title(drink), 'Меню и техкарты', true)}
        <div class="recipe-layout">
          ${pointPicker.picker(choices, scope, {name:'recipe-scope', label:'Точки для просмотра или правки',
            escape, allLabel:'Выбрать все', allDetail})}
          <div class="recipe-layout" id="recipe-card-actions">${cardActions(drink)}</div>
          ${drink.versions.length ? action('history', 'История версий') : ''}
        </div>`;
    }

    function activeVersions(drink) {
      const selected = scope ?? points().map(point => point.id);
      const grouped = new Map();
      for (const id of selected) {
        const version = effective(drink, id);
        if (!grouped.has(version)) grouped.set(version, []);
        grouped.get(version).push(id);
      }
      const common = effective(drink);
      if (scope === null && common && !grouped.has(common)) grouped.set(common, []);
      return grouped;
    }

    function cardActions(drink) {
      const hasVersion = [...activeVersions(drink).keys()].some(Boolean);
      const unavailable = scope?.length === 0 ? 'Отметь хотя бы одну точку для просмотра или правки.' :
        'Для выбранных точек пока нет действующей техкарты.';
      return `${hasVersion ? action('current', 'Открыть состав и приготовление', true) : `<p class="empty">${unavailable}</p>`}
        ${drink.draft ? action('draft', 'Продолжить черновик · ' + escape(scopeName(pointPicker.scopeFor(drink.draft)))) :
          scope?.length === 0 ? '' : action('draft', 'Создать новую версию')}`;
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
          ${picker('recipe-target', 'Где будет действовать', editor.selection, {hint:hint('где действует техкарта',
            'Сними галочки с точек, где рецепт должен остаться прежним. Версия для выбранных точек имеет приоритет перед общей.')})}
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
        <div class="recipe-layout"><p>Где будет действовать <strong>${escape(scopeName(pointPicker.scopeFor(preview)))}</strong></p>
          ${contents(preview)}${action('publish', 'Ввести в действие', true)}</div>`;
    }

    function history() {
      const drinks = historyId ? [item()] : records();
      const releases = drinks.flatMap(drink => [...drink.versions].reverse().map(version => ({drink,version})));
      if (!historyId) releases.sort((a,b) => Date.parse(b.version.publishedAt) - Date.parse(a.version.publishedAt));
      return `${back(historyId ? 'card' : 'list', historyId ? 'К позиции' : 'Меню и техкарты')}
        ${hero(historyId ? 'История версий' : 'История изменений', historyId ? title(item()) : 'Меню и техкарты', true)}
        <div class="recipe-layout">${releases.map(({drink,version}) => {
          const assigned = pointPicker.scopeFor(version);
          const targets = assigned ?? [''];
          const current = targets.filter(id => effective(drink, id)?.id === version.id).length;
          const status = current === targets.length ? 'Действует' : current ? 'Действует частично' : 'Предыдущая';
          return `<button type="button" class="section recipe-row" data-recipe-action="release" data-recipe-id="${escape(drink.id)}" data-version-id="${escape(version.id)}">
            <span><strong>${escape(historyId ? scopeName(pointPicker.scopeFor(version)) : title(drink))}</strong>
            <small>${historyId ? '' : escape(scopeName(pointPicker.scopeFor(version))) + ' · '}${escape(stamp(version))} · ${status}</small></span>
            <span aria-hidden="true">›</span></button>`;
        }).join('')}</div>`;
    }

    function recipe() {
      const drink = item();
      const historical = screen === 'release';
      const selected = historical ? new Map([[drink.versions.find(row => row.id === versionId), []]]) : activeVersions(drink);
      return `${back(historical ? 'history-back' : 'card', historical ? 'К истории' : 'К позиции')}
        ${hero(title(drink), 'Техкарта', true)}
        <div class="recipe-layout">${[...selected].map(([version, ids]) => {
          if (!version) return `<p class="empty">Техкарта ещё не введена: ${escape(scopeName(ids))}.</p>`;
          const label = scopeName(ids.length ? ids : pointPicker.scopeFor(version));
          return `<div class="recipe-layout"><p>${escape(versionType(version))} · ${escape(label)}<br>
            <small>Введена в действие ${escape(stamp(version))}</small></p>${contents(version)}</div>`;
        }).join('')}</div>`;
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
      const selection = drink?.draft ? pointPicker.scopeFor(drink.draft) : drink ? scope : filter;
      let source = drink?.draft;
      if (!source && drink) {
        const versions = [...activeVersions(drink).keys()];
        source = selection && versions.length === 1 ? versions[0] : effective(drink);
      }
      editor = {name:drink?.name ?? '', volume:drink?.volumeMl ?? '', selection,
        ingredients:source?.ingredients?.length ? source.ingredients : [blank], method:source?.method ?? ''};
      dirty = false;
      screen = 'edit';
    }

    function readEditor(form) {
      const name = form.elements.drinkName?.value ?? editor.name;
      const volume = form.elements.volume?.value ?? editor.volume;
      return {name, volume, selection:pointPicker.read(form.querySelector('[data-point-picker]')),
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
      if (values.selection?.length === 0) {
        return error(form, 'Отметь хотя бы одну точку или выбери всю сеть.', form.querySelector('[data-point-all]'));
      }
      const draft = {...pointPicker.scopeFields(values.selection), ingredients, method:values.method.trim()};
      if (submittingButton?.value !== 'preview') {
        scope = values.selection;
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
        scope = pointPicker.scopeFor(version);
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
      } else if (name === 'recipe-search') {
        query = target.value;
        getMain().querySelector('#recipe-results').innerHTML = rows();
      }
    }

    function selectPoints(pickerName, selection) {
      if (pickerName === 'recipe-filter') {
        filter = selection;
        getMain().querySelector('#recipe-results').innerHTML = rows();
      } else if (pickerName === 'recipe-scope') {
        scope = selection;
        getMain().querySelector('#recipe-card-actions').innerHTML = cardActions(item());
      }
    }

    return {open, draw, click, change, selectPoints, submit, beforeLeave, isList:() => screen === 'list'};
  }

  return {validate, completeRecipe, effective, create};
})();
