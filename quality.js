(() => {
  'use strict';

  const prefix = 'panel-03:quality:';
  const cardKey = 'panel-03:techcards';
  const status = { pass: 'Соответствует', fail: 'Отклонение', skip: 'Не проверено' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const editor = $('#quality-editor');
  const form = $('#quality-form');
  const error = $('#quality-error');
  const journal = $('#quality-checks');
  const tooltip = $('#quality-tooltip');
  let fieldNumber = 0;
  let active;

  function el(tag, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, run, className = 'action') {
    const control = el('button', text, className);
    control.type = 'button';
    control.addEventListener('click', run);
    return control;
  }

  function help(label, description) {
    const control = button('', () => {
      $('#quality-tooltip-title').textContent = label;
      $('#quality-tooltip-text').textContent = description;
      tooltip.showModal();
      $('#quality-tooltip-close').focus();
    }, 'quality-help');
    control.setAttribute('aria-label', 'Пояснение: ' + label);
    control.append(el('span', '?'));
    return control;
  }

  function heading(label, description, tag = 'h3') {
    const row = el('div', '', 'quality-heading');
    row.append(el(tag, label, 'quality-title'), help(label, description));
    return row;
  }

  function action(label, description, run, className) {
    const row = el('div', '', 'quality-actions');
    row.append(button(label, run, className), help(label, description));
    return row;
  }

  function field(label, description, options = {}) {
    const wrapper = el('div', '', 'quality-field');
    const row = el('div', '', 'quality-heading');
    const caption = el('label', label);
    const control = el(options.choices ? 'select' : options.multiline ? 'textarea' : 'input');
    control.id = 'quality-field-' + ++fieldNumber;
    caption.htmlFor = control.id;
    control.required = options.required !== false;
    if (options.choices) {
      for (const [value, text] of Object.entries(options.choices)) {
        const option = el('option', text);
        option.value = value;
        control.append(option);
      }
    } else if (!options.multiline) {
      control.type = options.type || 'text';
      if (control.type === 'number') control.step = 'any';
      if (control.type === 'date') {
        control.min = '0001-01-01';
        control.max = '9999-12-31';
      }
    }
    control.maxLength = options.multiline ? 800 : 160;
    control.value = options.value ?? '';
    row.append(caption, help(label, description));
    wrapper.append(row, control);
    return { wrapper, control };
  }

  function dateKey(date = new Date()) {
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return [year, month, String(date.getDate()).padStart(2, '0')].join('-');
  }

  function formatDate(key) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(key + 'T12:00:00'));
  }

  function dateField(label, description) {
    return field(label, description, { type: 'date', value: dateKey() });
  }

  function numberField(label, description) {
    return field(label, description, { type: 'number' });
  }

  function value(item) {
    return item.control.value.trim();
  }

  function requireText(item) {
    const text = value(item);
    if (!text) {
      item.control.focus();
      throw Error('Заполни поле «' + item.wrapper.querySelector('label').textContent + '».');
    }
    return text;
  }

  function setActive(wrapper, enabled) {
    wrapper.hidden = !enabled;
    for (const item of wrapper.querySelectorAll('input, select, textarea')) item.disabled = !enabled;
  }

  function planFields(container) {
    const group = el('div', '', 'quality-fields');
    const actionField = field('Что сделать', 'Укажи конкретное исправление. Например, вернуть утверждённую настройку и приготовить новую пробу.', { multiline: true });
    const owner = field('Ответственный', 'Укажи сотрудника или роль, которая выполнит действие. Для исправления на месте можно указать себя.');
    const due = dateField('Срок', 'Дата, к которой должно быть выполнено действие. Для исправления на месте укажи текущую дату.');
    const method = field('Как перепроверить', 'Опиши, когда и в каких условиях повторить тот же замер или наблюдение.', { multiline: true });
    group.append(actionField.wrapper, owner.wrapper, due.wrapper, method.wrapper);
    container.append(group);
    return {
      toggle(enabled) { setActive(group, enabled); },
      read() { return { action: requireText(actionField), owner: requireText(owner), due: value(due), method: requireText(method) }; }
    };
  }

  function assessment(container, definition) {
    const mode = field('Проведение проверки', 'Выбери «Не проверено», если измерить или наблюдать критерий сейчас невозможно. Такой результат остаётся без оценки.', {
      choices: { done: 'Проведена', skip: 'Не проверено' }, value: 'done'
    });
    const actualNumber = numberField('Фактическое значение', 'Запиши измерение в единицах критерия. Панель проверит, входит ли оно в диапазон, включая его границы.');
    const presence = field('Признак обнаружен', 'Сравни с конкретным описанием из стандарта. Выбери «Да», только если описанный признак наблюдается полностью.', {
      choices: { '': 'Выбери вариант', yes: 'Да', no: 'Нет' }
    });
    const actualText = field('Наблюдение', 'Запиши, что увидел или почувствовал. Например, «на поверхности заметны крупные пузырьки».', { multiline: true });
    const reason = field('Причина пропуска', 'Укажи, почему измерение или наблюдение пришлось пропустить.');
    const note = field('Комментарий к замеру', 'При необходимости запиши условия замера, отклонение или показания прибора.', { required: false, multiline: true });
    const output = el('output', '', 'quality-result');
    output.setAttribute('aria-live', 'polite');
    const resultLine = el('div', '', 'quality-heading');
    resultLine.append(output, help('Результат', 'Замер соответствует, если значение входит в диапазон. Наблюдение соответствует, если признак обнаружен. Пропущенный критерий не получает оценки.'));
    container.append(mode.wrapper, actualNumber.wrapper, presence.wrapper, actualText.wrapper, note.wrapper, reason.wrapper, resultLine);
    const plan = planFields(container);

    function result() {
      if (value(mode) === 'skip') return 'skip';
      const rule = definition();
      if (!rule) return '';
      if (rule.type === 'observable') return { yes: 'pass', no: 'fail' }[value(presence)] || '';
      if (!value(actualNumber) || !Number.isFinite(rule.min) || !Number.isFinite(rule.max) || rule.min > rule.max) return '';
      const measured = actualNumber.control.valueAsNumber;
      if (!Number.isFinite(measured)) return '';
      return measured >= rule.min && measured <= rule.max ? 'pass' : 'fail';
    }

    function update() {
      const skipped = value(mode) === 'skip';
      const type = definition()?.type;
      setActive(actualNumber.wrapper, !skipped && type === 'numeric');
      setActive(note.wrapper, !skipped && type === 'numeric');
      setActive(presence.wrapper, !skipped && type === 'observable');
      setActive(actualText.wrapper, !skipped && type === 'observable');
      setActive(reason.wrapper, skipped);
      const current = result();
      output.textContent = status[current] || 'Результат появится после ввода';
      output.dataset.result = current;
      plan.toggle(current === 'fail');
    }

    return {
      update,
      read() {
        const outcome = result();
        if (!outcome) throw Error('Заполни критерий и его фактический результат.');
        const detail = outcome === 'skip' ? requireText(reason) :
          definition().type === 'numeric' ? value(note) : requireText(actualText);
        const measured = outcome !== 'skip' && definition().type === 'numeric' ? actualNumber.control.valueAsNumber : null;
        return { outcome, detail, measured, plan: outcome === 'fail' ? plan.read() : null };
      }
    };
  }

  function validRule(rule) {
    return rule.type === 'numeric'
      ? Number.isFinite(rule.min) && Number.isFinite(rule.max) && rule.min <= rule.max && Boolean(rule.unit)
      : Boolean(rule.expected);
  }

  function definitionFields(container, saved = {}, required = false, allowRecipe = false) {
    const rule = saved.rule || {};
    const label = field('Критерий', 'Один проверяемый параметр. Например, масса выхода эспрессо или чистота чашки при выдаче.', { required, value: saved.name });
    const choices = { observable: 'Наблюдаемый признак', numeric: 'Числовой диапазон' };
    if (allowRecipe) choices.recipe = 'Числовой критерий из техкарты';
    const tip = allowRecipe
      ? 'Задай проверяемый признак, числовой диапазон или привяжи замер к действующей техкарте.'
      : 'Для замера задай числовые границы из техкарты. Для вкуса и подачи опиши конкретный наблюдаемый признак.';
    const type = field('Способ оценки', tip, { choices, value: rule.type || 'observable' });
    const expected = field('Что должно наблюдаться', 'Укажи конкретный проверяемый признак из стандарта. Например, «на поверхности нет крупных пузырьков».', { required, value: rule.expected });
    const min = field('Нижняя граница', 'Минимальное допустимое значение по техкарте. Граница включается в диапазон.', { type: 'number', required, value: rule.min });
    const max = field('Верхняя граница', 'Максимальное допустимое значение. Для точного значения введи одинаковые границы.', { type: 'number', required, value: rule.max });
    const unit = field('Единица измерения', 'Укажи ту же единицу, что в техкарте и в замере. Например, г, мл или с.', { required, value: rule.unit });
    const numericFields = el('div', '', 'quality-fields');
    const range = el('div', '', 'quality-pair');
    range.append(min.wrapper, max.wrapper);
    numericFields.append(range, unit.wrapper);
    container.append(label.wrapper, type.wrapper, expected.wrapper, numericFields);

    function update() {
      const numeric = value(type) === 'numeric';
      setActive(expected.wrapper, value(type) === 'observable');
      setActive(numericFields, numeric);
    }

    type.control.addEventListener('input', update);
    type.control.addEventListener('change', update);
    update();

    function read() {
      if (value(type) === 'recipe') return { name: value(label), rule: { type: 'recipe' } };
      const rule = value(type) === 'observable' ? { type: 'observable', expected: value(expected) } :
        { type: 'numeric', min: min.control.valueAsNumber, max: max.control.valueAsNumber, unit: value(unit) };
      return { name: value(label), rule };
    }
    return { read, label };
  }

  function ruleFields(container) {
    const definition = definitionFields(container, {}, true);
    const assessed = assessment(container, () => definition.read().rule);
    container.addEventListener('input', assessed.update);
    container.addEventListener('change', assessed.update);
    assessed.update();

    return () => {
      const criterion = definition.read();
      requireText(definition.label);
      if (!validRule(criterion.rule)) throw Error('Укажи допустимый диапазон с единицей измерения или наблюдаемый признак.');
      return { ...criterion, initial: assessed.read(), repeats: [] };
    };
  }

  function showEditor(title, render, submit = 'Сохранить', tip = 'Записывает проверку в этом браузере. После сохранения она появится в журнале.') {
    active = null;
    error.hidden = true;
    const titleElement = $('#quality-editor-title');
    titleElement.textContent = title;
    const save = $('#quality-save');
    save.textContent = submit;
    const oldTip = save.nextElementSibling;
    if (oldTip) oldTip.remove();
    save.after(help(submit, tip));
    const body = $('#quality-editor-body');
    body.replaceChildren();
    active = render(body);
    if (!editor.open) editor.showModal();
    titleElement.focus({ preventScroll: true });
    editor.scrollTop = 0;
  }

  function openCheck(selected = null) {
    showEditor('Проверка напитка', body => {
      const location = field('Точка', 'Введи название кофейни. Используй одно и то же название во всех проверках этой точки.');
      const date = dateField('Дата проверки', 'День, когда проведена исходная проверка.');
      const drink = field('Напиток', 'Укажи напиток так, как он называется в техкарте или меню.');
      const reference = field('Техкарта или стандарт', 'При необходимости укажи название и версию документа, по которому проводится проверка.', { required: false });
      const criteria = el('div', '', 'quality-list');
      const rows = new Map();
      body.append(location.wrapper, date.wrapper);
      if (selected) {
        body.append(heading(selected.version.title + ' · ' + selected.portion.name,
          'Критерии взяты из выбранной версии техкарты и сохранятся вместе с проверкой.'));
        line(body, 'Версия техкарты:', String(selected.version.number));
      } else {
        body.append(drink.wrapper, reference.wrapper);
      }
      body.append(criteria);

      function addCriterion() {
        const group = el('fieldset', '', 'quality-criterion quality-fields');
        group.append(el('legend', 'Критерий оценки'));
        const read = ruleFields(group);
        const remove = action('Убрать критерий', 'Убирает этот критерий из текущей формы до сохранения записи.', () => {
          rows.delete(group);
          group.remove();
          updateRemove();
        });
        group.append(remove);
        rows.set(group, { read, remove });
        criteria.append(group);
        updateRemove();
        return group;
      }

      function updateRemove() {
        for (const row of rows.values()) row.remove.hidden = rows.size <= 1;
      }

      const readings = [];
      if (selected) {
        for (const criterion of selected.portion.criteria) {
          const group = el('fieldset', '', 'quality-criterion quality-fields');
          group.append(el('legend', criterion.name));
          line(group, 'Стандарт:', ruleLabel(criterion.rule));
          line(group, 'Способ проверки:', criterion.method);
          const assessed = assessment(group, () => criterion.rule);
          group.addEventListener('input', assessed.update);
          group.addEventListener('change', assessed.update);
          assessed.update();
          criteria.append(group);
          readings.push(() => ({ ...criterion, initial: assessed.read(), repeats: [] }));
        }
      } else {
        addCriterion();
        body.append(action('Добавить критерий', 'Добавляет ещё один измеряемый параметр или наблюдаемый признак для того же напитка.', () => {
          const group = addCriterion();
          group.querySelector('input').focus();
        }));
      }
      return () => {
        const record = {
          id: crypto.randomUUID(), location: requireText(location), date: value(date),
          drink: selected?.version.title ?? requireText(drink),
          reference: selected ? '' : value(reference),
          criteria: (selected ? readings : Array.from(rows.values(), row => row.read)).map(read => read())
        };
        if (selected) {
          record.techCard = { id: selected.id, version: selected.version.number, portion: selected.portion.name };
        }
        localStorage.setItem(prefix + record.id, JSON.stringify(record));
        return record.id;
      };
    });
  }

  function latest(criterion) {
    return criterion.repeats.findLast(attempt => attempt.outcome !== 'skip') || criterion.initial;
  }

  function ruleLabel(rule) {
    return rule.type === 'numeric' ? rule.min + '–' + rule.max + ' ' + rule.unit : rule.expected;
  }

  function openRepeat(record, index, original) {
    const criterion = record.criteria[index];
    showEditor('Повторная проверка', body => {
      body.append(el('p', record.location + ' · ' + record.drink + ' · ' + criterion.name, 'quality-title'));
      body.append(el('p', 'Стандарт: ' + ruleLabel(criterion.rule), 'quality-note'));
      line(body, 'Способ проверки:', criterion.method);
      if (latest(criterion).plan) body.append(el('p', 'План: ' + latest(criterion).plan.method, 'quality-note'));
      const date = dateField('Дата повторной проверки', 'Укажи день повторного замера или наблюдения по этому же стандарту.');
      date.control.min = criterion.repeats.at(-1)?.date || record.date;
      body.append(date.wrapper);
      const assessed = assessment(body, () => criterion.rule);
      body.addEventListener('input', assessed.update);
      body.addEventListener('change', assessed.update);
      assessed.update();
      return () => {
        const key = prefix + record.id;
        if (localStorage.getItem(key) !== original) throw Error('Запись изменилась. Открой её и повтори действие.');
        const updated = { ...criterion, repeats: [...criterion.repeats, { ...assessed.read(), date: value(date) }] };
        const criteria = record.criteria.map((item, i) => i === index ? updated : item);
        localStorage.setItem(key, JSON.stringify({ ...record, criteria }));
        return record.id;
      };
    });
  }

  function line(parent, label, text) {
    if (!text) return;
    const paragraph = el('p', '', 'quality-note');
    paragraph.append(el('strong', label + ' '), document.createTextNode(text));
    parent.append(paragraph);
  }

  function showAttempt(container, title, attempt, rule) {
    const result = el('p', title + ' · ' + status[attempt.outcome], 'quality-result quality-note');
    result.dataset.result = attempt.outcome;
    container.append(result);
    if (attempt.measured !== null) line(container, 'Замер:', attempt.measured + ' ' + rule.unit);
    line(container, attempt.outcome === 'skip' ? 'Причина:' : 'Наблюдение:', attempt.detail);
    if (attempt.plan) {
      const plan = attempt.plan;
      line(container, 'Действие:', plan.action);
      line(container, 'Ответственный и срок:', plan.owner + ' · ' + formatDate(plan.due));
      line(container, 'Как перепроверить:', plan.method);
    }
  }

  function savedRecords() {
    const records = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const original = localStorage.getItem(key);
      try {
        const record = JSON.parse(original);
        if (record && prefix + record.id === key && Array.isArray(record.criteria)) records.push({ record, original });
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return records.sort((a, b) => b.record.date.localeCompare(a.record.date) || a.record.location.localeCompare(b.record.location, 'ru'));
  }

  function render(keepOpen = '') {
    const opened = new Set(Array.from(journal.querySelectorAll('details[open]'), node => node.dataset.id));
    if (keepOpen) opened.add(keepOpen);
    journal.replaceChildren();
    try {
      const records = savedRecords();
      let openIssues = 0;
      for (const { record, original } of records) {
        const failures = record.criteria.filter(criterion => latest(criterion).outcome === 'fail').length;
        const skipped = record.criteria.filter(criterion => latest(criterion).outcome === 'skip').length;
        openIssues += failures;
        const details = el('details', '', 'module quality-record');
        details.dataset.id = record.id;
        details.open = opened.has(record.id);
        const summary = el('summary', record.location + ' · ' + record.drink);
        summary.append(el('p', formatDate(record.date) + ' · ' + failures + ' откл. · ' + skipped + ' не проверено', 'quiet'));
        details.append(summary);
        const body = el('div', '', 'quality-details');
        line(body, 'Техкарта или стандарт:', record.reference);
        if (record.techCard) line(body, 'Техкарта:', record.drink + ' · ' + record.techCard.portion + ' · версия ' + record.techCard.version);
        for (const [index, criterion] of record.criteria.entries()) {
          const block = el('section', '', 'quality-criterion quality-fields');
          block.append(heading(criterion.name, 'Здесь видны критерий из стандарта, исходный результат и история повторных проверок. Замечание закрывается при результате «Соответствует».', 'h4'));
          line(block, 'Стандарт:', ruleLabel(criterion.rule));
          line(block, 'Способ проверки:', criterion.method);
          showAttempt(block, 'Исходная проверка', criterion.initial, criterion.rule);
          for (const repeat of criterion.repeats) showAttempt(block, formatDate(repeat.date), repeat, criterion.rule);
          if (latest(criterion).outcome !== 'pass') {
            block.append(action('Перепроверить', 'Добавляет результат по тому же критерию. Исходное наблюдение и все предыдущие попытки сохраняются.', () => openRepeat(record, index, original)));
          }
          body.append(block);
        }
        body.append(action('Удалить проверку', 'Удаляет эту запись вместе с её критериями и историей повторных проверок.', () => {
          if (!window.confirm('Удалить проверку и историю повторных проверок?')) return;
          try {
            if (localStorage.getItem(prefix + record.id) !== original) throw Error('Запись изменилась. Открой её и повтори действие.');
            localStorage.removeItem(prefix + record.id);
            render();
          } catch {
            $('#quality-storage-message').textContent = 'Удалить запись не удалось. Обнови журнал и попробуй снова.';
          }
        }, 'action danger'));
        details.append(body);
        journal.append(details);
      }
      $('#quality-count').textContent = openIssues ? 'Открытые отклонения: ' + openIssues : 'Открытых отклонений нет';
      $('#quality-storage-message').textContent = records.length ? '' : 'Проверок пока нет.';
    } catch {
      $('#quality-storage-message').textContent = 'Журнал недоступен. Проверь разрешения браузера.';
      $('#quality-count').textContent = 'Журнал недоступен';
    }
  }

  function readCatalog() {
    const raw = localStorage.getItem(cardKey);
    return { raw, cards: raw === null ? [] : JSON.parse(raw) };
  }

  function writeCard(catalog, updated) {
    if (localStorage.getItem(cardKey) !== catalog.raw) {
      throw Error('Техкарты изменились в другой вкладке. Закрой форму и открой актуальный черновик.');
    }
    const cards = catalog.cards.filter(card => card.id !== updated.id);
    localStorage.setItem(cardKey, JSON.stringify([...cards, updated]));
  }

  function activeVersion(card) {
    return card.versions.at(-1);
  }

  function normalized(text) {
    return text.toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');
  }

  function repeatedFields(container, initial, labels, addFields) {
    const list = el('div', '', 'quality-fields');
    const rows = new Map();
    function add(item) {
      const group = el('fieldset', '', 'quality-criterion quality-fields');
      group.append(el('legend', labels.item));
      const read = addFields(group, item);
      const remove = action('Убрать ' + labels.remove, labels.removeHelp, () => {
        rows.delete(group);
        group.remove();
        addButton.querySelector('button').focus();
      });
      group.append(remove);
      rows.set(group, read);
      list.append(group);
      return group;
    }

    const addButton = action('Добавить ' + labels.add, labels.addHelp, () => {
      const group = add();
      group.querySelector('input, textarea, select')?.focus();
    });
    for (const item of initial.length ? initial : [undefined]) add(item);
    container.append(list, addButton);
    return () => Array.from(rows.values(), read => read());
  }

  function cardIngredient(container, saved = {}) {
    const name = field('Ингредиент', 'Укажи название ингредиента так, как оно записано в спецификации.', { required: false, value: saved.name });
    const amount = field('Количество', 'Укажи количество ингредиента на одну порцию. Допускаются дробные значения.', { type: 'number', required: false, value: saved.amount });
    const unit = field('Единица количества', 'Укажи единицу из рецептуры, например г, мл или шт.', { required: false, value: saved.unit });
    const pair = el('div', '', 'quality-pair');
    pair.append(amount.wrapper, unit.wrapper);
    container.append(name.wrapper, pair);
    return () => ({ name: value(name), amount: amount.control.valueAsNumber, unit: value(unit) });
  }

  function cardPortion(container, saved = {}) {
    const name = field('Размер порции', 'Укажи название или объём варианта из меню. У каждого размера свой состав и критерии.', { required: false, value: saved.name });
    container.append(name.wrapper);
    const ingredients = repeatedFields(container, saved.ingredients || [], {
      item: 'Ингредиент',
      add: 'ингредиент',
      remove: 'ингредиент',
      addHelp: 'Добавляет ещё одну строку состава для этой порции.',
      removeHelp: 'Убирает ингредиент из черновика порции.'
    }, cardIngredient);
    const preparation = field('Порядок приготовления', 'Запиши один шаг на строку. При просмотре техкарты шаги отображаются по порядку.', { multiline: true, required: false, value: saved.preparation });
    const service = field('Требования к подаче', 'Укажи посуду или упаковку и требования к выдаче для этого размера.', { multiline: true, required: false, value: saved.service });
    container.append(preparation.wrapper, service.wrapper);
    const criteria = repeatedFields(container, saved.criteria || [], {
      item: 'Критерий оценки',
      add: 'критерий',
      remove: 'критерий',
      addHelp: 'Добавляет отдельный замер или наблюдаемый признак для этой порции.',
      removeHelp: 'Убирает критерий из черновика порции.'
    }, (group, criterion = {}) => {
      const definition = definitionFields(group, criterion);
      const method = field('Способ проверки', 'Опиши инструмент, момент замера или условия наблюдения. Подсказка будет доступна при проверке и перепроверке.', { multiline: true, required: false, value: criterion.method });
      group.append(method.wrapper);
      return () => ({ ...definition.read(), method: value(method) });
    });
    return () => ({ name: value(name), ingredients: ingredients(), preparation: value(preparation), service: value(service), criteria: criteria() });
  }

  function validateCard(draft) {
    if (!draft.title) throw Error('Укажи название напитка.');
    if (!draft.portions.length) throw Error('Добавь хотя бы один размер порции.');
    const names = new Set();
    for (const [index, portion] of draft.portions.entries()) {
      const context = 'Порция «' + (portion.name || String(index + 1)) + '». ';
      const name = normalized(portion.name);
      if (!name || names.has(name)) throw Error(context + 'Укажи уникальное название размера.');
      names.add(name);
      if (!portion.ingredients.length || portion.ingredients.some(item =>
        !item.name || !Number.isFinite(item.amount) || item.amount <= 0 || !item.unit)) {
        throw Error(context + 'Для каждого ингредиента укажи название, количество больше нуля и единицу.');
      }
      if (!portion.preparation || !portion.service) throw Error(context + 'Заполни порядок приготовления и требования к подаче.');
      const criteria = new Set();
      if (!portion.criteria.length) throw Error(context + 'Добавь хотя бы один критерий проверки.');
      for (const criterion of portion.criteria) {
        const label = normalized(criterion.name);
        if (!label || criteria.has(label) || !criterion.method || !validRule(criterion.rule)) {
          throw Error(context + 'Каждому критерию нужны уникальное название, допустимый диапазон или признак и способ проверки.');
        }
        criteria.add(label);
      }
    }
  }

  function openCardEditor(card = null) {
    const catalog = readCatalog();
    const current = card && catalog.cards.find(item => item.id === card.id);
    if (card && !current) throw Error('Техкарта изменилась. Обнови список.');
    const draft = current?.draft || activeVersion(current || { versions: [] }) || {};
    showEditor(current ? 'Черновик техкарты' : 'Новая техкарта', body => {
      const title = field('Название напитка', 'Укажи название, под которым напиток будет виден в списке техкарт и проверок.', { required: false, value: draft.title });
      body.append(title.wrapper);
      const portions = repeatedFields(body, draft.portions || [], {
        item: 'Размер порции',
        add: 'размер',
        remove: 'размер',
        addHelp: 'Добавляет порцию со своим составом, приготовлением, подачей и критериями.',
        removeHelp: 'Убирает размер из черновика вместе с его составом и критериями.'
      }, cardPortion);
      return () => {
        const updated = { id: current?.id ?? crypto.randomUUID(), versions: current?.versions ?? [], draft: { title: value(title), portions: portions() } };
        writeCard(catalog, updated);
        return updated.id;
      };
    }, 'Сохранить черновик', 'Сохраняет черновик. Заполнить недостающие данные можно перед активацией.');
  }

  function activateCard(card, catalog) {
    try {
      validateCard(card.draft);
      const sameName = catalog.cards.some(other => other.id !== card.id &&
        activeVersion(other) && normalized(activeVersion(other).title) === normalized(card.draft.title));
      if (sameName) throw Error('Для напитка с таким названием уже есть действующая техкарта. Создай новую версию в ней.');
      const revision = { ...card.draft, number: card.versions.length + 1, effective: dateKey() };
      writeCard(catalog, { ...card, draft: null, versions: [...card.versions, revision] });
      renderCards(card.id);
    } catch (problem) {
      $('#techcards-message').textContent = problem instanceof DOMException ? 'Не удалось сохранить техкарту в браузере.' : problem.message;
    }
  }

  function showVersion(version, label) {
    const details = el('details', '', 'quality-criterion');
    details.append(el('summary', label + ' · ' + formatDate(version.effective)));
    const body = el('div', '', 'quality-details');
    line(body, 'Напиток:', version.title);
    for (const portion of version.portions) {
      const group = el('section', '', 'quality-criterion quality-fields');
      group.append(heading(portion.name, 'Состав, приготовление, подача и критерии проверки именно для этого размера.', 'h4'));
      line(group, 'Состав:', portion.ingredients.map(item => item.name + ' — ' + item.amount + ' ' + item.unit).join(', '));
      group.append(el('p', 'Порядок приготовления', 'quality-result'));
      const steps = el('ol', '', 'quality-steps');
      for (const step of portion.preparation.split('\n').map(text => text.trim()).filter(Boolean)) steps.append(el('li', step));
      group.append(steps);
      line(group, 'Подача:', portion.service);
      for (const criterion of portion.criteria) line(group, criterion.name + ':', ruleLabel(criterion.rule) + ' · ' + criterion.method);
      body.append(group);
    }
    details.append(body);
    return details;
  }

  function renderCards(keepOpen = '') {
    const list = $('#techcards-list');
    const opened = new Set(Array.from(list.querySelectorAll('[data-card-id][open]'), item => item.dataset.cardId));
    if (keepOpen) opened.add(keepOpen);
    list.replaceChildren();
    const message = $('#techcards-message');
    try {
      const catalog = readCatalog();
      message.textContent = catalog.cards.length ? '' : 'Техкарт пока нет.';
      for (const card of catalog.cards) {
        const version = activeVersion(card);
        const details = el('details', '', 'module quality-record');
        details.dataset.cardId = card.id;
        details.open = opened.has(card.id);
        const title = version?.title || card.draft?.title || 'Техкарта без названия';
        const body = el('div', '', 'quality-details');
        const labels = [];
        if (version) labels.push('Действует версия ' + version.number);
        if (card.draft) labels.push('Есть черновик');
        const summary = el('summary', title);
        summary.append(el('p', labels.join(' · '), 'quiet'));
        details.append(summary);
        if (version) body.append(showVersion(version, 'Действующая версия ' + version.number));
        body.append(action(card.draft ? 'Открыть черновик' : 'Создать новую версию',
          card.draft ? 'Открывает сохранённые изменения для редактирования.' : 'Копирует действующую версию в новый черновик.',
          () => {
            try { openCardEditor(card); }
            catch (problem) { message.textContent = problem.message; }
          }));
        if (card.draft) body.append(action('Активировать черновик', 'После согласования сделай черновик действующей версией для всей сети. Прежняя версия перейдёт в архив.', () => activateCard(card, catalog), 'action primary'));
        if (card.versions.length > 1) {
          const archive = el('details', '', 'quality-criterion');
          archive.append(el('summary', 'Архив версий'));
          const versions = el('div', '', 'quality-details');
          for (const version of card.versions.slice(0, -1).reverse()) versions.append(showVersion(version, 'Версия ' + version.number));
          archive.append(versions);
          body.append(archive);
        }
        details.append(body);
        list.append(details);
      }
    } catch {
      message.textContent = 'Не удалось прочитать техкарты из браузера.';
    }
  }

  function startCheck() {
    let cards;
    try {
      cards = readCatalog().cards.filter(activeVersion);
    } catch {
      $('#quality-storage-message').textContent = 'Техкарты недоступны. Можно начать проверку с ручным вводом.';
      openCheck();
      return;
    }
    if (!cards.length) {
      openCheck();
      return;
    }
    showEditor('Проверка напитка', body => {
      const choices = new Map(cards.map(card => [card.id, activeVersion(card)]));
      const card = field('Техкарта', 'Выбери действующую техкарту напитка. Для разовой проверки выбери ручной ввод.', {
        choices: { '': 'Выбери техкарту', manual: 'Ручной ввод', ...Object.fromEntries(cards.map(item => [item.id, activeVersion(item).title])) }
      });
      const portionSlot = el('div');
      let portion;
      function update() {
        portionSlot.replaceChildren();
        const version = choices.get(value(card));
        portion = version ? field('Размер порции', 'Панель подставит критерии и способы проверки выбранного размера.', {
          choices: Object.fromEntries(version.portions.map((item, i) => [String(i), item.name])), value: '0'
        }) : null;
        if (portion) portionSlot.append(portion.wrapper);
      }
      card.control.addEventListener('change', update);
      body.append(card.wrapper, portionSlot);
      return () => {
        const id = requireText(card);
        const version = choices.get(id);
        if (version) {
          const current = readCatalog().cards.find(item => item.id === id);
          if (!current || activeVersion(current)?.number !== version.number) throw Error('Техкарта обновилась. Открой выбор заново.');
          openCheck({ id, version, portion: version.portions[Number(value(portion))] });
        } else {
          openCheck();
        }
        return null;
      };
    }, 'Продолжить', 'Открывает форму проверки с критериями выбранной порции или с ручным вводом.');
  }

  const economyKey = 'panel-03:economy';
  const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
  const units = new Map([
    ['мг', ['mass', .001]], ['г', ['mass', 1]], ['гр', ['mass', 1]], ['кг', ['mass', 1000]],
    ['мл', ['volume', 1]], ['л', ['volume', 1000]],
    ['шт', ['count', 1]], ['шт.', ['count', 1]], ['штука', ['count', 1]]
  ]);
  let calculation = { card: '', portion: '', date: dateKey() };

  function readEconomy() {
    const raw = localStorage.getItem(economyKey);
    const data = raw === null ? { supplies: [], links: [] } : JSON.parse(raw);
    return { raw, data };
  }

  function saveEconomy(snapshot, data) {
    if (localStorage.getItem(economyKey) !== snapshot.raw) {
      throw Error('Данные экономики изменились в другой вкладке. Открой запись заново.');
    }
    localStorage.setItem(economyKey, JSON.stringify(data));
  }

  function dateIsValid(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && dateKey(new Date(date + 'T12:00:00')) === date;
  }

  function economyError(problem) {
    $('#economy-message').textContent = problem instanceof DOMException ? 'Не удалось сохранить данные в браузере.' : problem.message;
  }

  function money(cents) { return rubles.format(cents / 100); }
  function cents(sum) { return Math.round((sum + Number.EPSILON * Math.abs(sum)) * 100); }

  function priceFor(supply, date) {
    return supply.prices.reduce((latest, price) => {
      return price.date <= date && (!latest || price.date >= latest.date) ? price : latest;
    }, null);
  }

  function convertAmount(amount, from, to, density) {
    const first = normalized(from);
    const second = normalized(to);
    const [fromType, fromScale] = units.get(first) || [];
    const [toType, toScale] = units.get(second) || [];
    if (first === second) return amount;
    if (!fromType || !toType) return null;
    if (fromType === toType) return amount * fromScale / toScale;
    if (!(density > 0)) return null;
    if (fromType === 'volume' && toType === 'mass') return amount * fromScale * density / toScale;
    if (fromType === 'mass' && toType === 'volume') return amount * fromScale / density / toScale;
    return null;
  }

  function openPriceEditor(id, proposal) {
    try {
      const snapshot = readEconomy();
      const supplied = snapshot.data.supplies.find(item => item.id === id);
      if (proposal && !supplied) throw Error('Закупочная позиция недоступна.');
      showEditor(supplied ? 'Новая закупочная цена' : 'Закупочная цена', body => {
        if (supplied) body.append(heading(supplied.name, 'Новая цена добавится в историю этого сырья.'));
        const name = supplied ? null : field('Сырьё или упаковка', 'Укажи наименование закупочной позиции. Например, конкретное зерно или стакан 250 мл.');
        const price = numberField('Цена упаковки, ₽', 'Укажи полную закупочную цену упаковки в рублях. Используй одну и ту же основу цен для всех позиций. Нулевая цена допустима.');
        price.control.min = '0';
        const amount = numberField('Количество в упаковке', 'Укажи количество, за которое платишь эту цену. Например, 1 для пакета 1 кг или 50 для упаковки из 50 стаканов.');
        const unit = field('Единица закупки', 'Укажи единицу количества в упаковке, например кг, г, л, мл или шт.');
        const date = dateField('Действует с', 'Цена применяется начиная с этой даты. Новая запись за ту же дату уточняет цену в расчёте и сохраняет прежнюю в истории.');
        const density = field('Плотность, г/мл', 'Заполни, если в закупке и техкарте используются масса и объём. Укажи сколько граммов весит 1 мл именно этого сырья.', { type: 'number', required: false });
        if (name) body.append(name.wrapper);
        body.append(price.wrapper, amount.wrapper, unit.wrapper, date.wrapper, density.wrapper);
        const previous = supplied ? priceFor(supplied, '9999-12-31') : null;
        if (previous) {
          amount.control.value = String(previous.amount);
          unit.control.value = previous.unit;
          density.control.value = previous.density ?? '';
        }
        if (proposal) {
          price.control.value = String(proposal.cost / 100);
          amount.control.value = String(proposal.amount);
          unit.control.value = proposal.unit;
          date.control.value = proposal.date;
          density.control.value = '';
          line(body, 'Поставщик из пробы:', proposal.supplier);
        }
        return () => {
          const cost = price.control.valueAsNumber;
          const pack = amount.control.valueAsNumber;
          const ratio = value(density) ? density.control.valueAsNumber : null;
          const effective = value(date);
          const title = supplied?.name ?? requireText(name);
          if (!Number.isFinite(cost) || cost < 0 || !Number.isSafeInteger(cents(cost))) throw Error('Укажи закупочную цену от нуля.');
          if (!Number.isFinite(pack) || pack <= 0) throw Error('Количество в упаковке должно быть больше нуля.');
          if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0)) throw Error('Плотность должна быть больше нуля.');
          if (!dateIsValid(effective)) throw Error('Укажи дату начала действия цены.');
          if (!supplied && snapshot.data.supplies.some(item => normalized(item.name) === normalized(title))) {
            throw Error('Закупочная позиция с таким названием уже есть. Добавь новую цену в её карточке.');
          }
          const entry = { cost: cents(cost), amount: pack, unit: requireText(unit), date: effective, density: ratio };
          if (proposal) {
            if (supplied.prices.some(item => item.reviewId === proposal.reviewId)) throw Error('Цена из этой пробы уже записана.');
            entry.reviewId = proposal.reviewId;
            entry.supplier = proposal.supplier;
          }
          const supply = supplied ? { ...supplied, prices: [...supplied.prices, entry] } :
            { id: crypto.randomUUID(), name: title, prices: [entry] };
          const supplies = supplied ? snapshot.data.supplies.map(item => item.id === supply.id ? supply : item) :
            [...snapshot.data.supplies, supply];
          saveEconomy(snapshot, { ...snapshot.data, supplies });
          return supply.id;
        };
      }, 'Сохранить цену', 'Добавляет закупочную цену в историю. Панель применит её к расчётам начиная с указанной даты.');
    } catch (problem) {
      economyError(problem);
    }
  }

  function renderPrices(supplies, keepOpen) {
    const list = $('#economy-prices-list');
    const opened = new Set(Array.from(list.querySelectorAll('[data-supply][open]'), node => node.dataset.supply));
    if (keepOpen) opened.add(keepOpen);
    list.replaceChildren();
    if (!supplies.length) list.append(el('p', 'Закупочных цен пока нет.', 'quiet'));
    for (const supply of supplies) {
      const card = el('details', '', 'quality-criterion');
      card.dataset.supply = supply.id;
      card.open = opened.has(supply.id);
      const summary = el('summary', supply.name);
      const recent = priceFor(supply, dateKey());
      summary.append(el('p', recent ? money(recent.cost) + ' за ' + recent.amount + ' ' + recent.unit : 'Цена ещё не действует', 'quiet'));
      const body = el('div', '', 'quality-details');
      body.append(action('Добавить цену', 'Записывает новую цену для этой закупочной позиции. Старые цены остаются в истории.', () => openPriceEditor(supply.id)));
      if ($('#suppliers-specs')) body.append(supplierAction('Требования к сырью', 'Открывает критерии проверки этой закупочной позиции.', () => {
        location.hash = '#suppliers';
        openSupplySpec(supply.id);
      }));
      body.append(heading('История цен', 'Список записей по датам начала действия. Более поздняя запись за ту же дату уточняет расчёт.', 'h4'));
      const recentFirst = [...supply.prices].reverse().sort((a, b) => b.date.localeCompare(a.date));
      for (const price of recentFirst) {
        const density = price.density ? ' · ' + price.density + ' г/мл' : '';
        line(body, formatDate(price.date) + ':', money(price.cost) + ' за ' + price.amount + ' ' + price.unit + density + (price.supplier ? ' · ' + price.supplier : ''));
      }
      card.append(summary, body);
      list.append(card);
    }
  }

  function linkKey(card, portion, ingredient) {
    return JSON.stringify([card, normalized(portion), normalized(ingredient.name), normalized(ingredient.unit)]);
  }

  function estimateIngredient(snapshot, card, portion, ingredient, date) {
    const key = linkKey(card, portion, ingredient);
    const linked = snapshot.data.links.find(pair => pair.key === key)?.supply;
    const supply = snapshot.data.supplies.find(item => item.id === linked);
    const price = supply ? priceFor(supply, date) : null;
    const converted = price ? convertAmount(ingredient.amount, ingredient.unit, price.unit, price.density) : null;
    const cost = converted === null ? null : cents(converted / price.amount * (price.cost / 100));
    const reason = !supply ? 'Свяжи ингредиент с закупочной позицией.' :
      !price ? 'На выбранную дату нет действующей цены.' :
      converted === null ? 'Единицы несовместимы. Проверь единицы или укажи плотность для перевода массы в объём.' :
      !Number.isSafeInteger(cost) ? 'Сумма выходит за пределы расчёта.' : '';
    return { key, supply, price, cost: reason ? null : cost, reason };
  }

  function purchaseLink(snapshot, { key, supply }, refresh, message) {
    const link = field('Закупочная позиция', 'Связь сохранится для этого напитка, размера порции и ингредиента. При обновлении цены панель пересчитает стоимость.', {
      choices: { '': 'Не связана', ...Object.fromEntries(snapshot.data.supplies.map(item => [item.id, item.name])) },
      required: false, value: supply?.id
    });
    link.control.addEventListener('change', () => {
      try {
        const id = value(link);
        const links = snapshot.data.links.filter(pair => pair.key !== key);
        if (id) links.push({ key, supply: id });
        saveEconomy(snapshot, { ...snapshot.data, links });
        refresh();
      } catch (problem) {
        link.control.value = supply?.id ?? '';
        message.textContent = problem.message;
      }
    });
    return link;
  }

  function renderCost(snapshot, portion, target, focusLink) {
    if (!dateIsValid(calculation.date)) {
      target.append(el('p', 'Укажи дату закупочных цен.', 'quiet'));
      return;
    }

    let total = 0;
    let missing = 0;
    const rows = el('div', '', 'stack');
    for (const [index, ingredient] of portion.ingredients.entries()) {
      const item = el('section', '', 'quality-criterion quality-fields');
      const estimate = estimateIngredient(snapshot, calculation.card, portion.name, ingredient, calculation.date);
      const { cost, price, reason } = estimate;
      const validCost = cost !== null && Number.isSafeInteger(total + cost);
      item.append(heading(ingredient.name + ' · ' + ingredient.amount + ' ' + ingredient.unit,
        'Количество берётся из действующей техкарты. Выбери закупочную позицию для этой строки.', 'h4'));
      const link = purchaseLink(snapshot, estimate, () => renderEconomy('', index), $('#economy-message'));
      item.append(link.wrapper);
      if (price) line(item, 'Цена закупки:', money(price.cost) + ' за ' + price.amount + ' ' + price.unit + ' · с ' + formatDate(price.date));
      if (validCost) {
        total += cost;
        line(item, 'На порцию:', money(cost));
      } else {
        missing++;
        item.append(el('p', reason || 'Сумма выходит за пределы расчёта.', 'error'));
      }
      if (focusLink === index) queueMicrotask(() => link.control.focus({ preventScroll: true }));
      rows.append(item);
    }
    const summary = el('section', '', 'module');
    summary.setAttribute('aria-live', 'polite');
    summary.append(heading(missing ? 'Расчёт неполный' : 'Итог за порцию',
      'Итог — сумма стоимости ингредиентов по строкам. Каждая строка округляется до копеек.'));
    const result = missing ? 'Посчитанные строки: ' + money(total) + ' · без расчёта: ' + missing : money(total);
    summary.append(el('p', result, 'quality-result'));
    target.append(summary, rows);
  }

  function renderEconomy(keepOpen = '', focusLink) {
    const container = $('#economy-calculation');
    if (!container) return;
    container.replaceChildren();
    $('#economy-message').textContent = '';
    try {
      const snapshot = readEconomy();
      renderPrices(snapshot.data.supplies, keepOpen);
      const cards = readCatalog().cards.filter(activeVersion);
      if (!cards.length) {
        container.append(el('p', 'Для расчёта нужна действующая техкарта.', 'quiet'));
        return;
      }

      const chosen = cards.find(card => card.id === calculation.card) || cards[0];
      const version = activeVersion(chosen);
      const portion = version.portions.find(item => item.name === calculation.portion) || version.portions[0];
      calculation = { ...calculation, card: chosen.id, portion: portion.name };
      const cardField = field('Напиток', 'Выбери действующую техкарту. Панель возьмёт состав из её текущей версии.', {
        choices: Object.fromEntries(cards.map(card => [card.id, activeVersion(card).title])), value: chosen.id
      });
      const portionField = field('Размер порции', 'Для каждого размера состав и количество ингредиентов берутся отдельно.', {
        choices: Object.fromEntries(version.portions.map((item, i) => [i, item.name])), value: String(version.portions.indexOf(portion))
      });
      const date = field('Дата закупочных цен', 'Панель возьмёт последнюю цену на эту дату или ранее. Рецептура берётся из действующей техкарты.', { type: 'date', value: calculation.date });
      cardField.control.addEventListener('change', () => {
        calculation = { ...calculation, card: value(cardField), portion: '' };
        renderEconomy();
      });
      portionField.control.addEventListener('change', () => {
        calculation.portion = version.portions[Number(value(portionField))].name;
        renderEconomy();
      });
      date.control.addEventListener('change', () => { calculation.date = value(date); renderEconomy(); });
      container.append(cardField.wrapper, portionField.wrapper, date.wrapper);
      line(container, 'Техкарта:', 'версия ' + version.number);
      renderCost(snapshot, portion, container, focusLink);
    } catch (problem) {
      economyError(problem);
    }
  }

  const salesKey = 'panel-03:sales';
  const reportFilter = { from: '', to: '', point: '' };
  const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });

  function readSales() {
    const raw = localStorage.getItem(salesKey);
    return { raw, rows: raw === null ? [] : JSON.parse(raw) };
  }

  function historicalVersion(card, date) {
    return card.versions.reduce((latest, version) => {
      return version.effective <= date && (!latest || version.effective >= latest.effective) ? version : latest;
    }, null);
  }

  function sameSale(left, right) {
    return left.date === right.date && normalized(left.point) === normalized(right.point) &&
      normalized(left.portion) === normalized(right.portion) &&
      (left.cardId && right.cardId ? left.cardId === right.cardId : normalized(left.drink) === normalized(right.drink));
  }

  function openSalesIdentity() {
    try {
      const cards = readCatalog().cards.filter(activeVersion);
      showEditor('Дневные продажи', body => {
        const date = dateField('Дата продажи', 'Введи дату строки кассового отчёта. Состав и закупочные цены подбираются на этот день.');
        const point = field('Точка', 'Название кофейни. Используй одинаковое название для всех её записей.');
        const card = field('Техкарта', 'Выбери напиток из справочника. Если его там нет, выбери ручной ввод.', {
          choices: { manual: 'Ручной ввод', ...Object.fromEntries(cards.map(item => [item.id, activeVersion(item).title])) },
          value: cards[0]?.id ?? 'manual'
        });
        const drink = field('Название напитка', 'Название напитка в кассовом отчёте при ручном вводе.');
        const manualPortion = field('Размер порции', 'Укажи вариант из кассового отчёта. Например, 250 мл.');
        const portionSlot = el('div');
        let portion;
        function update() {
          const selected = cards.find(item => item.id === value(card));
          const version = selected && (historicalVersion(selected, value(date)) || activeVersion(selected));
          const previous = portion && value(portion);
          setActive(drink.wrapper, !version);
          setActive(manualPortion.wrapper, !version);
          portionSlot.replaceChildren();
          portion = version ? field('Размер порции', 'Выбери размер, проданный по этой строке кассового отчёта.', {
            choices: Object.fromEntries(version.portions.map(item => [item.name, item.name])),
            value: version.portions.some(item => item.name === previous) ? previous : version.portions[0].name
          }) : null;
          if (portion) portionSlot.append(portion.wrapper);
        }
        date.control.addEventListener('change', update);
        card.control.addEventListener('change', update);
        body.append(date.wrapper, point.wrapper, card.wrapper, drink.wrapper, manualPortion.wrapper, portionSlot);
        update();
        return () => {
          const day = value(date);
          if (!dateIsValid(day)) throw Error('Укажи дату продажи.');
          const selected = cards.find(item => item.id === value(card));
          const version = selected && (historicalVersion(selected, day) || activeVersion(selected));
          openSalesAmounts({
            date: day, point: requireText(point), cardId: selected?.id ?? null,
            drink: version?.title ?? requireText(drink),
            portion: requireText(portion || manualPortion)
          });
          return null;
        };
      }, 'Продолжить', 'Открывает ввод количества и выручки. Если такая строка уже есть, подставляет её значения для правки.');
    } catch (problem) {
      $('#sales-message').textContent = problem.message;
    }
  }

  function openSalesAmounts(identity) {
    const snapshot = readSales();
    const existing = snapshot.rows.find(row => sameSale(row, identity));
    showEditor(existing ? 'Изменить дневные продажи' : 'Дневные продажи', body => {
      line(body, 'Дата и точка:', formatDate(identity.date) + ' · ' + identity.point);
      line(body, 'Напиток:', identity.drink + ' · ' + identity.portion);
      const quantity = field('Продано порций', 'Количество проданных порций после исключения возвратов. Приготовленные возвращённые порции укажи отдельно.', { type: 'number', value: existing?.quantity });
      const revenue = field('Выручка после скидок и возвратов, ₽', 'Фактическая выручка по этой строке кассы с учётом скидок и возвратов.', { type: 'number', value: existing ? existing.revenue / 100 : undefined });
      const returned = field('Приготовленные возвращённые порции', 'Укажи количество приготовленных порций, которые были возвращены, если оно известно. Их себестоимость добавится к затратам. Явный ноль означает, что таких порций не было.', { type: 'number', required: false, value: existing?.returned });
      for (const count of [quantity, returned]) {
        count.control.min = '0';
        count.control.step = '1';
      }
      body.append(quantity.wrapper, revenue.wrapper, returned.wrapper);
      return () => {
        const sold = quantity.control.valueAsNumber;
        const refunds = value(returned) ? returned.control.valueAsNumber : null;
        const total = revenue.control.valueAsNumber;
        const proceeds = Math.sign(total) * cents(Math.abs(total));
        if (!Number.isSafeInteger(sold) || sold < 0 || (refunds !== null && (!Number.isSafeInteger(refunds) || refunds < 0))) {
          throw Error('Количество порций должно быть целым числом от нуля.');
        }
        if (!Number.isSafeInteger(proceeds)) throw Error('Укажи выручку числом.');
        if (localStorage.getItem(salesKey) !== snapshot.raw) throw Error('Продажи изменились в другой вкладке. Открой запись заново.');
        const row = { ...identity, id: existing?.id ?? crypto.randomUUID(), quantity: sold, revenue: proceeds, returned: refunds };
        localStorage.setItem(salesKey, JSON.stringify([...snapshot.rows.filter(item => item.id !== row.id), row]));
        return row.id;
      };
    }, 'Сохранить продажи', 'Сохраняет одну строку на день, точку, напиток и порцию. Повторный ввод обновляет эту строку.');
  }

  function saleRecipe(row, cards) {
    const explicit = cards.find(card => card.id === row.cardId);
    const candidates = explicit ? [explicit] : cards.filter(card =>
      normalized(historicalVersion(card, row.date)?.title || '') === normalized(row.drink));
    const card = candidates.length === 1 ? candidates[0] : null;
    const version = card && historicalVersion(card, row.date);
    const portion = version?.portions.find(item => normalized(item.name) === normalized(row.portion));
    return { card, version, portion };
  }

  function costForSale(row, cards, economy) {
    const { card, version, portion } = saleRecipe(row, cards);
    if (!portion) return { cost: null, card, reason: version ? 'В техкарте на эту дату нет такого размера порции.' : 'На дату продажи нет однозначно подходящей техкарты.' };
    const count = row.quantity + (row.returned ?? 0);
    if (count === 0) return { cost: 0, card, version };
    const items = portion.ingredients.map(ingredient => ({
      ingredient, ...estimateIngredient(economy, card.id, portion.name, ingredient, row.date)
    }));
    const missing = items.filter(item => item.cost === null);
    if (missing.length) return { cost: null, version, card, portion, missing, reason: 'Нужны закупочные данные по составу.' };
    const total = items.reduce((sum, item) => sum + item.cost, 0) * count;
    return Number.isSafeInteger(total) ? { cost: total, card, version } : { cost: null, card, version, reason: 'Сумма выходит за пределы расчёта.' };
  }

  function salesTotals(entries) {
    const result = { quantity: 0, revenue: 0, cost: 0, coveredRevenue: 0, positiveRevenue: 0, coveredPositiveRevenue: 0, coveredRows: 0 };
    for (const { row, estimate } of entries) {
      result.quantity += row.quantity;
      result.revenue += row.revenue;
      result.positiveRevenue += Math.max(0, row.revenue);
      if (estimate.cost !== null) {
        result.cost += estimate.cost;
        result.coveredRevenue += row.revenue;
        result.coveredPositiveRevenue += Math.max(0, row.revenue);
        result.coveredRows++;
      }
    }
    return result;
  }

  function salesMetrics(title, entries) {
    const stats = salesTotals(entries);
    const card = el('section', '', 'module quality-fields');
    card.append(heading(title, 'Выручка и порции включают все строки. Себестоимость и показатели на её основе считаются по строкам с полными данными.'));
    line(card, 'Продано порций:', String(stats.quantity));
    line(card, 'Выручка:', money(stats.revenue));
    const covered = stats.coveredRows + ' из ' + entries.length;
    line(card, 'Строк с себестоимостью:', covered);
    if (stats.positiveRevenue > 0) {
      line(card, 'Покрытие положительной выручки:', percentFormat.format(stats.coveredPositiveRevenue / stats.positiveRevenue));
    }
    if (stats.coveredRows) {
      if (stats.coveredRows < entries.length) line(card, 'Выручка по рассчитанным строкам:', money(stats.coveredRevenue));
      line(card, 'Прямая себестоимость:', money(stats.cost));
      line(card, 'Маржинальный доход:', money(stats.coveredRevenue - stats.cost));
    } else {
      line(card, 'Прямая себестоимость и маржинальный доход:', 'нет данных');
    }
    const rates = el('div', '', 'quality-pair');
    const food = el('div');
    const margin = el('div');
    food.append(heading('Фудкост', 'Прямая себестоимость сырья и упаковки, делённая на выручку по тем же строкам. Рассчитывается при положительной выручке.', 'h4'));
    margin.append(heading('Маржинальность', 'Маржинальный доход, делённый на выручку по тем же строкам. Рассчитывается при положительной выручке.', 'h4'));
    food.append(el('p', stats.coveredRevenue > 0 ? percentFormat.format(stats.cost / stats.coveredRevenue) : '—', 'quality-result'));
    margin.append(el('p', stats.coveredRevenue > 0 ? percentFormat.format((stats.coveredRevenue - stats.cost) / stats.coveredRevenue) : '—', 'quality-result'));
    rates.append(food, margin);
    card.append(rates);
    return card;
  }

  function renderSalesRows(entries, economy) {
    const list = $('#sales-rows');
    const expanded = new Set(Array.from(list.querySelectorAll('details[open]'), item => item.dataset.sale));
    list.replaceChildren();
    for (const { row, estimate } of entries) {
      const item = el('details', '', 'module quality-record');
      item.dataset.sale = row.id;
      item.open = expanded.has(row.id);
      const summary = el('summary', row.drink + ' · ' + row.portion);
      summary.append(el('p', formatDate(row.date) + ' · ' + row.point + ' · ' + money(row.revenue), 'quiet'));
      const body = el('div', '', 'quality-details');
      line(body, 'Продано порций:', String(row.quantity));
      line(body, 'Приготовлено и возвращено:', row.returned === null ? 'не указано' : String(row.returned));
      if (estimate.version) line(body, 'Техкарта:', 'версия ' + estimate.version.number);
      if (estimate.cost !== null) line(body, 'Прямая себестоимость:', money(estimate.cost));
      if (estimate.reason) body.append(el('p', estimate.reason, 'error'));
      for (const missing of estimate.missing || []) {
        const problem = el('section', '', 'quality-criterion quality-fields');
        line(problem, missing.ingredient.name + ':', missing.reason);
        problem.append(purchaseLink(economy, missing, () => renderSales(), $('#sales-message')).wrapper);
        body.append(problem);
      }
      body.append(action('Изменить', 'Открывает количество, выручку и возвраты за этот день для правки.', () => {
        try { openSalesAmounts(row); }
        catch (problem) { $('#sales-message').textContent = problem.message; }
      }));
      item.append(summary, body);
      list.append(item);
    }
  }

  function renderSales() {
    const report = $('#sales-report');
    if (!report) return;
    const message = $('#sales-message');
    message.textContent = '';
    report.replaceChildren();
    try {
      const rows = readSales().rows;
      const cards = readCatalog().cards;
      const economy = readEconomy();
      const points = new Map(rows.map(row => [normalized(row.point), row.point]));
      const filters = $('#sales-filters');
      filters.replaceChildren();
      const from = field('Период с', 'Первая дата отчёта, включительно. Пустое поле означает, что нижней границы нет.', { type: 'date', value: reportFilter.from, required: false });
      const to = field('Период по', 'Последняя дата отчёта, включительно. Пустое поле означает, что верхней границы нет.', { type: 'date', value: reportFilter.to, required: false });
      const point = field('Точка отчёта', 'Выбери одну кофейню или посмотри сводку по всем точкам.', {
        choices: { '': 'Все точки', ...Object.fromEntries(points) }, value: reportFilter.point, required: false
      });
      for (const [name, input] of Object.entries({ from, to, point })) input.control.addEventListener('change', () => {
        reportFilter[name] = value(input);
        renderSales();
      });
      const dates = el('div', '', 'quality-pair');
      dates.append(from.wrapper, to.wrapper);
      filters.append(dates, point.wrapper);
      const invalid = reportFilter.from && reportFilter.to && reportFilter.from > reportFilter.to;
      const matching = invalid ? [] : rows.filter(row =>
        (!reportFilter.from || row.date >= reportFilter.from) && (!reportFilter.to || row.date <= reportFilter.to) &&
        (!reportFilter.point || normalized(row.point) === reportFilter.point));
      const entries = matching.sort((a, b) => b.date.localeCompare(a.date))
        .map(row => ({ row, estimate: costForSale(row, cards, economy) }));
      renderSalesRows(entries, economy);
      if (invalid) message.textContent = 'Начальная дата должна быть не позже конечной.';
      else if (!entries.length) report.append(el('p', 'За выбранный период записей нет.', 'quiet'));
      else {
        report.append(salesMetrics('Итог за период', entries));
        const groups = new Map();
        for (const entry of entries) {
          const { row } = entry;
          const key = JSON.stringify([entry.estimate.card?.id || row.cardId || normalized(row.drink), normalized(row.portion)]);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(entry);
        }
        for (const items of groups.values()) {
          const { drink, portion } = items[0].row;
          report.append(salesMetrics(drink + ' · ' + portion, items));
        }
      }
    } catch (problem) {
      $('#sales-rows').replaceChildren();
      message.textContent = 'Отчёт недоступен. Проверь сохранённые данные и разрешения браузера.';
      console.warn(problem);
    }
  }

  const stockKey = 'panel-03:stock';
  const writeOffReasons = {
    tuning: 'Настройка', tasting: 'Дегустация', training: 'Обучение', spoilage: 'Порча', other: 'Другое'
  };
  const quantityFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 });
  const stockEpsilon = 1e-9;

  function readStock() {
    const raw = localStorage.getItem(stockKey);
    return { raw, data: raw === null ? { writeOffs: [], checks: [] } : JSON.parse(raw) };
  }

  function saveStock(snapshot, group, row) {
    if (localStorage.getItem(stockKey) !== snapshot.raw) {
      throw Error('Журнал изменился в другой вкладке. Открой запись заново.');
    }
    const rows = snapshot.data[group].filter(item => item.id !== row.id);
    localStorage.setItem(stockKey, JSON.stringify({ ...snapshot.data, [group]: [...rows, row] }));
    return row.id;
  }

  function stockError(problem) {
    $('#stock-message').textContent = problem instanceof DOMException ? 'Не удалось сохранить запись в браузере.' : problem.message;
  }

  function stockForm(title, draw, save, tip) {
    try {
      const supplies = readEconomy().data.supplies;
      if (!supplies.length) throw Error('Добавь закупочную позицию в разделе «Закупочные цены».');
      showEditor(title, body => draw(body, supplies, readStock()), save, tip);
    } catch (problem) {
      stockError(problem);
    }
  }

  function stockIdentity(body, supplies, previous) {
    const point = field('Точка', 'Укажи название кофейни так же, как в дневных записях о продажах.', { value: previous?.point });
    const supply = field('Закупочная позиция', 'Выбери конкретное сырьё или упаковку из справочника закупок.', {
      choices: { '': 'Выбери позицию', ...Object.fromEntries(supplies.map(item => [item.id, item.name])) },
      value: previous?.supply
    });
    body.append(point.wrapper, supply.wrapper);
    return { point, supply };
  }

  function stockNumber(label, tip, amount) {
    const input = field(label, tip, { type: 'number', value: amount });
    input.control.min = '0';
    return input;
  }

  function stockAmount(input, positive = false) {
    const number = input.control.valueAsNumber;
    if (!Number.isFinite(number) || number < 0 || (positive && number === 0)) {
      const label = $('label', input.wrapper).textContent;
      throw Error('Проверь поле «' + label + '» и укажи ' + (positive ? 'число больше нуля.' : 'число от нуля.'));
    }
    return number;
  }

  function openWriteOff(previous) {
    stockForm(previous ? 'Изменить списание' : 'Списание сырья', (body, supplies, snapshot) => {
      const { point, supply } = stockIdentity(body, supplies, previous);
      const date = field('Дата списания', 'День, когда сырьё фактически израсходовали или списали.', { type: 'date', value: previous?.date ?? dateKey() });
      const amount = stockNumber('Количество', 'Фактическое количество сырья или упаковки вне продаж.', previous?.amount);
      const unit = field('Единица измерения', 'Единица списания, например г, кг, мл, л или шт.', { value: previous?.unit });
      const reason = field('Причина', 'Выбери, почему сырьё израсходовано вне продаж. Приготовленные возвраты вносятся в продажи.', {
        choices: { '': 'Выбери причину', ...writeOffReasons }, value: previous?.reason
      });
      const note = field('Комментарий', 'Добавь пояснение к записи. Для причины «Другое» укажи, на что ушло сырьё.', { multiline: true, required: false, value: previous?.note });
      const pair = el('div', '', 'quality-pair');
      pair.append(amount.wrapper, unit.wrapper);
      body.append(date.wrapper, pair, reason.wrapper, note.wrapper);
      return () => {
        const day = value(date);
        if (!dateIsValid(day)) throw Error('Укажи дату списания.');
        const category = requireText(reason);
        if (category === 'other') requireText(note);
        const row = {
          id: previous?.id ?? crypto.randomUUID(), point: requireText(point), supply: requireText(supply), date: day,
          amount: stockAmount(amount, true), unit: requireText(unit), reason: category, note: value(note)
        };
        return saveStock(snapshot, 'writeOffs', row);
      };
    }, 'Сохранить списание', 'Добавляет запись в журнал. Сверка учтёт её по дате, точке и закупочной позиции.');
  }

  function openStockCheck(previous) {
    stockForm(previous ? 'Изменить сверку' : 'Сверка расхода', (body, supplies, snapshot) => {
      const { point, supply } = stockIdentity(body, supplies, previous);
      const from = field('Период с', 'Первый день периода включительно. Начальный остаток берётся до операций этого дня.', { type: 'date', value: previous?.from ?? dateKey() });
      const to = field('Период по', 'Последний день периода включительно. Конечный остаток берётся после операций этого дня.', { type: 'date', value: previous?.to ?? dateKey() });
      const unit = field('Единица сверки', 'Используй одну единицу для остатков и движений. Продажи и списания будут приведены к ней.', { value: previous?.unit });
      supply.control.addEventListener('change', () => {
        if (value(unit)) return;
        const selected = supplies.find(item => item.id === value(supply));
        if (selected) unit.control.value = priceFor(selected, value(to))?.unit ?? '';
      });
      const inputs = {
        opening: stockNumber('Начальный остаток', 'Фактическое количество перед первым днём периода.', previous?.opening),
        closing: stockNumber('Конечный остаток', 'Фактическое количество после последнего дня периода.', previous?.closing),
        received: stockNumber('Поставки', 'Сумма поступлений от поставщиков за выбранный период.', previous?.received ?? 0),
        incoming: stockNumber('Перемещения на точку', 'Количество, полученное с других точек за период.', previous?.incoming ?? 0),
        outgoing: stockNumber('Перемещения с точки', 'Количество, переданное на другие точки за период.', previous?.outgoing ?? 0),
        returned: stockNumber('Возвраты поставщику', 'Количество сырья, отправленное обратно поставщику за период.', previous?.returned ?? 0)
      };
      const coverage = field('Данные о продажах', 'Подтверди, когда в панель внесены все продажи точки за этот период, либо сверено, что продаж не было.', {
        choices: { open: 'Ещё не подтверждены', complete: 'Все продажи учтены' }, value: previous?.coverage ?? 'open'
      });
      const note = field('Причина или следующее действие', 'Если расхождение уже объяснено, запиши причину. Иначе запиши, какие данные нужно проверить.', { multiline: true, required: false, value: previous?.note });
      const dates = el('div', '', 'quality-pair');
      dates.append(from.wrapper, to.wrapper);
      body.append(dates, unit.wrapper);
      const quantities = el('div', '', 'quality-pair');
      for (const input of Object.values(inputs)) quantities.append(input.wrapper);
      body.append(quantities, coverage.wrapper, note.wrapper);
      return () => {
        if (!dateIsValid(value(from)) || !dateIsValid(value(to)) || value(from) > value(to)) throw Error('Укажи корректный период сверки.');
        const quantities = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, stockAmount(input)]));
        const row = {
          id: previous?.id ?? crypto.randomUUID(), point: requireText(point), supply: requireText(supply),
          from: value(from), to: value(to), unit: requireText(unit), coverage: value(coverage), note: value(note), ...quantities
        };
        return saveStock(snapshot, 'checks', row);
      };
    }, 'Сохранить сверку', 'Сохраняет остатки, движения и заметку. Результат пересчитывается по записям о продажах и списаниях за этот период.');
  }

  function stockQuantity(number, unit) {
    return quantityFormat.format(Math.abs(number) < stockEpsilon ? 0 : number) + ' ' + unit;
  }

  function reconcileStock(check, supply, economy, cards, sales, writeOffs) {
    const inPeriod = row => row.date >= check.from && row.date <= check.to && normalized(row.point) === normalized(check.point);
    const actual = check.opening + check.received + check.incoming - check.outgoing - check.returned - check.closing;
    const gaps = new Map();
    function missing(label) { gaps.set(label, (gaps.get(label) ?? 0) + 1); }
    function converted(amount, unit, date) {
      if (amount === 0) return 0;
      return convertAmount(amount, unit, check.unit, priceFor(supply, date)?.density);
    }

    if (!Number.isFinite(actual)) missing('Фактический расход выходит за пределы расчёта');
    if (actual < -stockEpsilon) missing('Фактический расход отрицательный. Проверь остатки и движения');
    if (check.coverage !== 'complete') missing('Полнота продаж за период не подтверждена');
    let expected = 0;
    for (const row of sales.filter(inPeriod)) {
      const count = row.quantity + (row.returned ?? 0);
      if (count === 0 && row.returned !== null) continue;
      const { card, portion } = saleRecipe(row, cards);
      if (!portion) {
        missing('Нет техкарты или размера порции на дату продажи');
        continue;
      }
      for (const ingredient of portion.ingredients) {
        const key = linkKey(card.id, portion.name, ingredient);
        const linked = economy.links.find(item => item.key === key)?.supply;
        if (!linked || !economy.supplies.some(item => item.id === linked)) {
          missing('Ингредиент в техкарте не связан с закупочной позицией');
          continue;
        }
        if (linked !== supply.id) continue;
        if (row.returned === null) missing('В продажах не указано количество приготовленных возвратов');
        const amount = converted(ingredient.amount * count, ingredient.unit, row.date);
        if (amount === null || !Number.isFinite(amount)) missing('Нельзя привести расход по техкарте к единице сверки');
        else expected += amount;
      }
    }

    let logged = 0;
    for (const row of writeOffs.filter(item => item.supply === supply.id && inPeriod(item))) {
      const amount = converted(row.amount, row.unit, row.date);
      if (amount === null || !Number.isFinite(amount)) missing('Нельзя привести списание к единице сверки');
      else logged += amount;
    }
    const explanation = expected + logged;
    if (!Number.isFinite(explanation)) missing('Расчётный расход выходит за пределы расчёта');
    return { actual, expected, logged, explanation, difference: actual - explanation, gaps };
  }

  function renderWriteOff(row, supply, keepOpen) {
    const card = el('details', '', 'module quality-record');
    card.dataset.stockItem = row.id;
    card.open = keepOpen.has(row.id);
    const summary = el('summary', (supply?.name || 'Закупочная позиция недоступна') + ' · ' + stockQuantity(row.amount, row.unit));
    summary.append(el('p', formatDate(row.date) + ' · ' + row.point, 'quiet'));
    const body = el('div', '', 'quality-details');
    line(body, 'Причина:', writeOffReasons[row.reason]);
    line(body, 'Комментарий:', row.note);
    body.append(action('Изменить списание', 'Открывает эту запись для исправления.', () => openWriteOff(row)));
    card.append(summary, body);
    return card;
  }

  function renderCheck(row, supply, economy, cards, sales, writeOffs, keepOpen) {
    const card = el('details', '', 'module quality-record');
    card.dataset.stockItem = row.id;
    card.open = keepOpen.has(row.id);
    const summary = el('summary', (supply?.name || 'Закупочная позиция недоступна') + ' · ' + row.point);
    summary.append(el('p', formatDate(row.from) + ' — ' + formatDate(row.to), 'quiet'));
    const body = el('div', '', 'quality-details');
    if (supply) {
      const result = reconcileStock(row, supply, economy, cards, sales, writeOffs);
      body.append(heading(result.gaps.size ? 'Сверка неполная' : 'Результат сверки',
        'Фактический расход равен начальному остатку плюс поставки и входящие перемещения, минус исходящие перемещения, возвраты поставщику и конечный остаток. Из фактического расхода вычитаются продажи по техкартам и списания.'));
      const qty = value => Number.isFinite(value) ? stockQuantity(value, row.unit) : 'проверь данные';
      line(body, 'Фактический расход:', qty(result.actual));
      line(body, 'Расход по продажам и приготовленным возвратам:', qty(result.expected));
      line(body, 'Расход по журналу списаний:', qty(result.logged));
      line(body, 'Объяснённый расход по внесённым данным:', qty(result.explanation));
      if (result.gaps.size) {
        const list = el('ul', '', 'quality-steps');
        for (const [reason, count] of result.gaps) list.append(el('li', reason + (count > 1 ? ' (' + count + ')' : '')));
        body.append(list);
      } else {
        line(body, 'Необъяснённое расхождение:', qty(result.difference));
      }
    } else {
      body.append(el('p', 'Для сверки нужна закупочная позиция.', 'error'));
    }
    line(body, 'Причина или следующее действие:', row.note);
    body.append(action('Изменить сверку', 'Открывает остатки, движения и примечание. Результат пересчитывается по текущему журналу.', () => openStockCheck(row)));
    card.append(summary, body);
    return card;
  }

  function renderStock(id = '') {
    const journal = $('#stock-writeoffs');
    if (!journal) return;
    const checks = $('#stock-checks');
    const keepOpen = new Set(Array.from(document.querySelectorAll('[data-stock-item][open]'), item => item.dataset.stockItem));
    if (id) keepOpen.add(id);
    journal.replaceChildren();
    checks.replaceChildren();
    $('#stock-message').textContent = '';
    try {
      const { data } = readStock();
      const { data: economy } = readEconomy();
      const sales = readSales().rows;
      const cards = readCatalog().cards;
      const supply = row => economy.supplies.find(item => item.id === row.supply);
      for (const row of data.writeOffs.sort((a, b) => b.date.localeCompare(a.date))) {
        journal.append(renderWriteOff(row, supply(row), keepOpen));
      }
      for (const row of data.checks.sort((a, b) => b.to.localeCompare(a.to))) {
        checks.append(renderCheck(row, supply(row), economy, cards, sales, data.writeOffs, keepOpen));
      }
      if (!data.writeOffs.length) journal.append(el('p', 'Списаний пока нет.', 'quiet'));
      if (!data.checks.length) checks.append(el('p', 'Сверок пока нет.', 'quiet'));
    } catch (problem) {
      stockError(problem);
    }
  }

  const trainingKey = 'panel-03:training';
  const starterSkill = {
    id: 'espresso', version: 1, name: 'Приготовление эспрессо',
    task: 'Найди действующую техкарту, самостоятельно приготовь эспрессо и взвесь выход.',
    criteria: [
      { name: 'Работа по техкарте', rule: { type: 'observable', expected: 'Бариста сам находит действующую техкарту и соблюдает указанный в ней порядок приготовления.' } },
      { name: 'Масса выхода', rule: { type: 'recipe' } }
    ]
  };

  function readTraining() {
    const raw = localStorage.getItem(trainingKey);
    return { raw, data: raw === null ? { team: [], skills: [starterSkill], attempts: [] } : JSON.parse(raw) };
  }

  function writeTraining(snapshot, group, item) {
    if (localStorage.getItem(trainingKey) !== snapshot.raw) throw Error('Данные обучения изменились в другой вкладке. Открой форму заново.');
    const updated = snapshot.data[group].filter(row => row.id !== item.id);
    localStorage.setItem(trainingKey, JSON.stringify({ ...snapshot.data, [group]: [...updated, item] }));
  }

  function trainingError(problem) {
    $('#training-message').textContent = problem instanceof DOMException ? 'Не удалось сохранить данные в браузере.' : problem.message;
  }

  function openTeamMember(previous) {
    const snapshot = readTraining();
    showEditor(previous ? 'Карточка бариста' : 'Новый бариста', body => {
      const name = field('Имя или рабочий псевдоним', 'Укажи имя или псевдоним, по которому однозначно находишь бариста.', { value: previous?.name });
      const point = field('Точка', 'Текущая кофейня бариста. При переводе измени точку в карточке. В прошлых попытках сохранится место проверки.', { value: previous?.point });
      body.append(name.wrapper, point.wrapper);
      return () => {
        const person = { id: previous?.id ?? crypto.randomUUID(), name: requireText(name), point: requireText(point) };
        if (snapshot.data.team.some(item => item.id !== person.id && normalized(item.name) === normalized(person.name) && normalized(item.point) === normalized(person.point))) {
          throw Error('В этой точке уже есть бариста с таким именем. Укажи отличающийся рабочий псевдоним.');
        }
        writeTraining(snapshot, 'team', person);
        return person.id;
      };
    }, 'Сохранить карточку', 'Сохраняет имя и точку. Записи о проверках хранятся в этом браузере.');
  }

  function openSkill(previous) {
    const snapshot = readTraining();
    showEditor(previous ? 'Шаблон навыка' : 'Новый навык', body => {
      const name = field('Название навыка', 'Коротко назови действие, которое проверяется на практике.', { value: previous?.name });
      const task = field('Практическое задание и условия', 'Опиши, что должен сделать бариста, что ему доступно и в каких условиях проходит проверка.', { multiline: true, value: previous?.task });
      body.append(name.wrapper, task.wrapper);
      const criteria = repeatedFields(body, previous?.criteria ?? [], {
        item: 'Обязательный критерий', add: 'критерий', remove: 'критерий',
        addHelp: 'Добавляет обязательный результат. Для подтверждения навыка нужно выполнить каждый критерий.',
        removeHelp: 'Убирает критерий из будущих проверок. В истории прошлых попыток он сохранится.'
      }, (group, item) => definitionFields(group, item, true, true).read);
      return () => {
        const title = requireText(name);
        if (snapshot.data.skills.some(item => item.id !== previous?.id && normalized(item.name) === normalized(title))) {
          throw Error('Шаблон с таким названием уже есть.');
        }
        const rules = criteria();
        if (!rules.length) throw Error('Добавь хотя бы один обязательный критерий.');
        const names = new Set();
        for (const item of rules) {
          const label = normalized(item.name);
          if (!label || names.has(label) || (item.rule.type !== 'recipe' && !validRule(item.rule))) {
            throw Error('Дай критериям уникальные названия и укажи проверяемые признаки или допустимые диапазоны.');
          }
          names.add(label);
        }
        const skill = { id: previous?.id ?? crypto.randomUUID(), version: (previous?.version ?? 0) + 1, name: title, task: requireText(task), criteria: rules };
        writeTraining(snapshot, 'skills', skill);
        return skill.id;
      };
    }, 'Сохранить шаблон', 'Сохраняет шаблон для следующих проверок. В журнале остаются условия и критерии каждой проведённой попытки.');
  }

  function selectTrainingRecipe(container, cards, references) {
    const cardField = field('Действующая техкарта', 'Выбери действующую карту с числовым критерием, например диапазоном выхода эспрессо.', {
      choices: { '': 'Выбери техкарту', ...Object.fromEntries(cards.map(card => [card.id, activeVersion(card).title])) }
    });
    const portionSlot = el('div', '', 'quality-fields');
    const rulesSlot = el('div', '', 'quality-fields');
    const chosenCard = () => cards.find(card => card.id === value(cardField));
    let portionField;
    let selections = [];
    container.append(cardField.wrapper, portionSlot, rulesSlot);

    function chooseRules() {
      const version = activeVersion(chosenCard());
      const portion = version.portions[Number(value(portionField))];
      const options = portion.criteria.filter(criterion => criterion.rule.type === 'numeric');
      rulesSlot.replaceChildren();
      selections = references.map(reference => {
        const exact = options.findIndex(criterion => normalized(criterion.name) === normalized(reference.name));
        const input = field('Замер «' + reference.name + '»', 'Выбери числовой критерий из этой порции. Диапазон и единица сохранятся в попытке.', {
          choices: { '': 'Выбери замер', ...Object.fromEntries(options.map((criterion, i) => [String(i), criterion.name])) },
          value: exact >= 0 ? String(exact) : ''
        });
        rulesSlot.append(input.wrapper);
        return { input, options };
      });
      if (!options.length) rulesSlot.prepend(el('p', 'В этой порции нет числовых критериев. Выбери другую или дополни техкарту.', 'quiet'));
    }

    cardField.control.addEventListener('change', () => {
      portionSlot.replaceChildren();
      rulesSlot.replaceChildren();
      selections = [];
      const card = chosenCard();
      if (!card) return;
      const version = activeVersion(card);
      portionField = field('Размер порции', 'Выбери размер напитка, который приготовит бариста.', {
        choices: Object.fromEntries(version.portions.map((portion, i) => [String(i), portion.name])), value: '0'
      });
      portionSlot.append(portionField.wrapper);
      portionField.control.addEventListener('change', chooseRules);
      chooseRules();
    });

    if (!cards.length) container.append(el('p', 'Для этого навыка нужна действующая техкарта с числовым критерием.', 'quiet'));
    return () => {
      requireText(cardField);
      const version = activeVersion(chosenCard());
      const portion = version.portions[Number(value(portionField))];
      return selections.map(({ input, options }) => {
        const selected = options[Number(requireText(input))];
        return { rule: selected.rule, method: selected.method, source: version.title + ' · ' + portion.name + ' · версия ' + version.number + ' · ' + selected.name };
      });
    };
  }

  function pickTraining(memberId, skillId) {
    const snapshot = readTraining();
    const { team, skills } = snapshot.data;
    if (!team.length || !skills.length) throw Error('Добавь бариста и шаблон навыка перед проверкой.');
    const cards = readCatalog().cards.filter(activeVersion);
    showEditor('Проверка навыка', body => {
      const member = field('Бариста', 'Выбери карточку сотрудника. История проверки появится в этой карточке.', {
        choices: Object.fromEntries(team.map(person => [person.id, person.name + ' · ' + person.point])),
        value: memberId ?? team[0].id
      });
      const skillField = field('Навык', 'Выбери один практический навык для этой попытки.', {
        choices: Object.fromEntries(skills.map(skill => [skill.id, skill.name])),
        value: skillId ?? skills[0].id
      });
      const criteria = el('div', '', 'quality-fields');
      let readRecipe;
      function selectedSkill() { return skills.find(item => item.id === value(skillField)); }
      function update() {
        criteria.replaceChildren();
        const selected = selectedSkill();
        const references = selected.criteria.filter(item => item.rule.type === 'recipe');
        readRecipe = references.length ? selectTrainingRecipe(criteria, cards, references) : () => [];
      }
      body.append(member.wrapper, skillField.wrapper, criteria);
      skillField.control.addEventListener('change', update);
      update();
      return () => {
        const person = team.find(item => item.id === value(member));
        const skill = selectedSkill();
        const recipeRules = readRecipe();
        let index = 0;
        const resolved = skill.criteria.map(criterion =>
          criterion.rule.type === 'recipe' ? { ...criterion, ...recipeRules[index++] } : criterion);
        openTrainingAttempt(snapshot, person, skill, resolved);
        return null;
      };
    }, 'Продолжить', 'Открывает оценку с заданием и выбранными критериями.');
  }

  function criterionObservation(group, criterion, failedLabel = 'Требует отработки') {
    group.append(el('legend', criterion.name));
    line(group, 'Критерий:', ruleLabel(criterion.rule));
    line(group, 'Способ проверки:', criterion.method);
    line(group, 'Техкарта:', criterion.source);
    const numeric = criterion.rule.type === 'numeric';
    const actual = numeric ? numberField('Фактическое значение', 'Запиши замер в единице, указанной в критерии. Обе границы диапазона включены.') :
      field('Признак обнаружен', 'Укажи, наблюдался ли описанный результат.', { choices: { '': 'Выбери вариант', yes: 'Да', no: 'Нет' } });
    const notes = field('Наблюдение', 'Кратко запиши, что именно произошло. Для числового замера можно дополнить фактическое значение комментарием.',
      { multiline: true, required: !numeric });
    const result = el('output', '', 'quality-result');
    result.setAttribute('aria-live', 'polite');
    const resultRow = el('div', '', 'quality-heading');
    resultRow.append(result, help('Результат критерия', 'Критерий выполнен, когда замер входит в диапазон или требуемый признак наблюдался.'));
    group.append(actual.wrapper, notes.wrapper, resultRow);
    function outcome() {
      if (!value(actual)) return null;
      if (!numeric) return value(actual) === 'yes';
      const measured = actual.control.valueAsNumber;
      if (!Number.isFinite(measured)) return null;
      return measured >= criterion.rule.min && measured <= criterion.rule.max;
    }
    function update() {
      const passed = outcome();
      result.textContent = passed === null ? 'Внеси результат' : passed ? 'Выполнен' : failedLabel;
      result.dataset.result = passed === false ? 'fail' : '';
    }
    group.addEventListener('input', update);
    group.addEventListener('change', update);
    update();
    return {
      outcome, read() {
        const passed = outcome();
        if (passed === null) throw Error('Внеси результат для критерия «' + criterion.name + '».');
        return { ...criterion, passed, measured: numeric ? actual.control.valueAsNumber : null, notes: numeric ? value(notes) : requireText(notes) };
      }
    };
  }

  function openTrainingAttempt(snapshot, person, skill, criteria) {
    showEditor('Практическая проверка', body => {
      line(body, 'Бариста:', person.name);
      line(body, 'Задание:', skill.task);
      const date = dateField('Дата проверки', 'Фактическая дата попытки.');
      const point = field('Точка проверки', 'Укажи место, где прошла попытка.', { value: person.point });
      const reviewer = field('Проверяющий', 'Укажи имя или рабочий псевдоним человека, который наблюдал попытку.');
      const independent = field('Выполнено без подсказок', 'Подтверждение требует самостоятельной работы и выполнения каждого обязательного критерия.', {
        choices: { '': 'Выбери вариант', yes: 'Да', no: 'Нет' }
      });
      body.append(date.wrapper, point.wrapper, reviewer.wrapper, independent.wrapper);
      const checks = criteria.map(criterion => {
        const group = el('fieldset', '', 'quality-criterion quality-fields');
        body.append(group);
        return criterionObservation(group, criterion);
      });
      const feedback = field('Обратная связь', 'Коротко запиши, что получилось и над чем ещё стоит поработать.', { multiline: true, required: false });
      const exercise = field('Что отработать', 'Укажи конкретное упражнение по непройденному критерию или по самостоятельному выполнению.', { multiline: true, required: false });
      const next = field('Дата повторной проверки', 'При отработке укажи, когда повторить проверку. Для подтверждённого навыка можно оставить пустым.', { type: 'date', required: false });
      body.append(feedback.wrapper, exercise.wrapper, next.wrapper);
      function update() {
        const needsPractice = value(independent) === 'no' || checks.some(check => check.outcome() === false);
        exercise.control.required = needsPractice;
        next.control.required = needsPractice;
      }
      body.addEventListener('input', update);
      body.addEventListener('change', update);
      update();
      return () => {
        const day = value(date);
        const retest = value(next);
        if (!dateIsValid(day) || (retest && (!dateIsValid(retest) || retest < day))) throw Error('Укажи корректные даты. Перепроверка не может быть раньше попытки.');
        const unaided = requireText(independent) === 'yes';
        const results = checks.map(check => check.read());
        const passed = unaided && results.every(item => item.passed);
        if (!passed && !retest) throw Error('Укажи дату повторной проверки.');
        const row = {
          id: crypto.randomUUID(), personId: person.id, skillId: skill.id, version: skill.version,
          skill: skill.name, task: skill.task, date: day, point: requireText(point), reviewer: requireText(reviewer),
          independent: unaided, passed, results, feedback: value(feedback),
          exercise: passed ? value(exercise) : requireText(exercise), next: retest
        };
        writeTraining(snapshot, 'attempts', row);
        return person.id;
      };
    }, 'Сохранить попытку', 'Добавляет результат в историю. Подтверждение требует всех обязательных критериев и работы без подсказок.');
  }

  function trainingAction(label, tip, run, className) {
    return action(label, tip, () => {
      try { run(); }
      catch (problem) { trainingError(problem); }
    }, className);
  }

  function renderAttempt(attempt) {
    const details = el('details', '', 'quality-criterion');
    const state = attempt.passed ? 'Подтверждён' : 'На отработке';
    details.append(el('summary', formatDate(attempt.date) + ' · ' + attempt.skill + ' · ' + state));
    const body = el('div', '', 'quality-details');
    line(body, 'Точка и проверяющий:', attempt.point + ' · ' + attempt.reviewer);
    line(body, 'Шаблон:', 'версия ' + attempt.version);
    line(body, 'Задание:', attempt.task);
    line(body, 'Без подсказок:', attempt.independent ? 'да' : 'нет');
    for (const result of attempt.results) {
      const criterion = el('div', '', 'quality-criterion');
      line(criterion, result.name + ':', result.passed ? 'выполнен' : 'требует отработки');
      line(criterion, 'Критерий:', ruleLabel(result.rule));
      line(criterion, 'Замер:', result.measured === null ? '' : String(result.measured) + ' ' + result.rule.unit);
      line(criterion, 'Наблюдение:', result.notes);
      line(criterion, 'Техкарта:', result.source);
      body.append(criterion);
    }
    line(body, 'Обратная связь:', attempt.feedback);
    line(body, 'Отработать:', attempt.exercise);
    if (attempt.next) line(body, 'Перепроверка:', formatDate(attempt.next));
    details.append(body);
    return details;
  }

  function renderTraining(keepOpen = '') {
    const teamList = $('#training-team');
    if (!teamList) return;
    const skillList = $('#training-skills');
    const opened = new Set(Array.from(document.querySelectorAll('[data-training-id][open]'), item => item.dataset.trainingId));
    if (keepOpen) opened.add(keepOpen);
    teamList.replaceChildren();
    skillList.replaceChildren();
    $('#training-message').textContent = '';
    try {
      const { data } = readTraining();
      if (!data.team.length) teamList.append(el('p', 'Карточек бариста пока нет.', 'quiet'));
      for (const person of data.team) {
        const record = el('details', '', 'module quality-record');
        record.dataset.trainingId = person.id;
        record.open = opened.has(person.id);
        record.append(el('summary', person.name + ' · ' + person.point));
        const body = el('div', '', 'quality-details');
        body.append(trainingAction('Изменить карточку', 'Открывает имя и текущую точку для правки.', () => openTeamMember(person)));
        const attempts = data.attempts.filter(item => item.personId === person.id).reverse().sort((a, b) => b.date.localeCompare(a.date));
        for (const skill of data.skills) {
          const latest = attempts.find(item => item.skillId === skill.id);
          const row = el('section', '', 'quality-criterion');
          const state = !latest ? 'Не проверен' : latest.passed ? 'Подтверждён' : 'На отработке';
          line(row, skill.name + ':', state);
          if (latest?.version !== undefined && latest.version !== skill.version) line(row, 'Проверен по шаблону:', 'версия ' + latest.version);
          if (latest?.next) line(row, 'Перепроверка:', formatDate(latest.next));
          row.append(trainingAction('Проверить навык', 'Добавляет практическую попытку для этого бариста и навыка.', () => pickTraining(person.id, skill.id)));
          body.append(row);
        }
        if (attempts.length) {
          body.append(heading('История проверок', 'Открой попытку, чтобы увидеть фактические результаты, обратную связь и критерии на момент проверки.', 'h4'));
          body.append(...attempts.map(renderAttempt));
        }
        record.append(body);
        teamList.append(record);
      }
      for (const skill of data.skills) {
        const record = el('details', '', 'module quality-record');
        record.dataset.trainingId = skill.id;
        record.open = opened.has(skill.id);
        record.append(el('summary', skill.name + ' · версия ' + skill.version));
        const body = el('div', '', 'quality-details');
        line(body, 'Задание:', skill.task);
        for (const criterion of skill.criteria) line(body, criterion.name + ':', criterion.rule.type === 'recipe' ? 'выбирается числовой критерий действующей техкарты' : ruleLabel(criterion.rule));
        body.append(trainingAction('Изменить шаблон', 'Меняет условия для будущих попыток. Прошлые записи сохраняют прежние критерии.', () => openSkill(skill)));
        record.append(body);
        skillList.append(record);
      }
    } catch (problem) {
      trainingError(problem);
    }
  }

  const equipmentKey = 'panel-03:equipment';
  const deviceKinds = { machine: 'Кофемашина', grinder: 'Кофемолка', water: 'Водоподготовка' };
  const jobKinds = { planned: 'Плановое обслуживание', issue: 'Неисправность' };
  const jobStates = { scheduled: 'Запланировано', progress: 'В работе', recheck: 'На перепроверке', done: 'Закрыто' };
  let equipmentPoint = '';

  function readEquipment() {
    const raw = localStorage.getItem(equipmentKey);
    return { raw, data: raw === null ? { devices: [], jobs: [], water: [] } : JSON.parse(raw) };
  }

  function saveEquipment(snapshot, group, row) {
    if (localStorage.getItem(equipmentKey) !== snapshot.raw) throw Error('Журнал изменился в другой вкладке. Открой запись заново.');
    const items = snapshot.data[group].filter(item => item.id !== row.id);
    localStorage.setItem(equipmentKey, JSON.stringify({ ...snapshot.data, [group]: [...items, row] }));
    return row.id;
  }

  function equipmentAction(label, tip, run, className) {
    return action(label, tip, () => {
      try { run(); }
      catch (problem) {
        $('#equipment-message').textContent = problem instanceof DOMException ? 'Не удалось открыть данные в браузере.' : problem.message;
      }
    }, className);
  }

  function deviceTitle(device) {
    return deviceKinds[device.kind] + ' · ' + device.model + (device.serial ? ' · ' + device.serial : '');
  }

  function openDevice(previous) {
    const snapshot = readEquipment();
    showEditor(previous ? 'Паспорт оборудования' : 'Новое оборудование', body => {
      const point = field('Точка', 'Название кофейни. Используй то же название, что в других разделах панели.', { value: previous?.point ?? currentEquipmentPoint(snapshot.data) });
      const kind = field('Тип оборудования', 'Выбери группу для паспорта.', { choices: deviceKinds, value: previous?.kind ?? 'machine' });
      const model = field('Модель', 'Перепиши модель из паспорта или с маркировки оборудования.', { value: previous?.model });
      const serial = field('Серийный номер', 'Укажи номер с маркировки, если он известен. Он помогает различить одинаковые модели.', { required: false, value: previous?.serial });
      const owner = field('Ответственный', 'Укажи сотрудника, роль или сервис, который отвечает за обслуживание.', { value: previous?.owner });
      body.append(point.wrapper, kind.wrapper, model.wrapper, serial.wrapper, owner.wrapper);
      return () => saveEquipment(snapshot, 'devices', {
        id: previous?.id ?? crypto.randomUUID(), point: requireText(point), kind: value(kind),
        model: requireText(model), serial: value(serial), owner: requireText(owner)
      });
    }, 'Сохранить паспорт', 'Добавляет паспорт или обновляет его поля. Записи обслуживания остаются в истории.');
  }

  function deviceField(devices, previous, required = true) {
    return field('Паспорт оборудования', 'Выбери конкретную единицу оборудования. В её паспорте будет видна связь с этой записью.', {
      choices: { '': required ? 'Выбери оборудование' : 'Без привязки к паспорту', ...Object.fromEntries(devices.map(device => [device.id, device.point + ' · ' + deviceTitle(device)])) },
      value: previous, required
    });
  }

  function openEquipmentJob(previous, preferred) {
    const snapshot = readEquipment();
    const devices = snapshot.data.devices;
    if (!devices.length) throw Error('Сначала добавь паспорт оборудования.');
    const selected = previous?.device || preferred || devices.find(device => normalized(device.point) === equipmentPoint)?.id || devices[0].id;
    showEditor(previous ? 'Работа по оборудованию' : 'Новая работа по оборудованию', body => {
      const device = deviceField(devices, selected);
      const kind = field('Тип работы', 'Плановое обслуживание или заявка по наблюдаемой неисправности.', { choices: jobKinds, value: previous?.kind ?? 'planned' });
      const state = field('Статус', 'После выполнения запиши результат. «На перепроверке» означает, что нужно отдельно подтвердить результат.', { choices: jobStates, value: previous?.state ?? 'scheduled' });
      const date = field('Дата записи', 'Когда работа была запланирована или когда заметили неисправность.', { type: 'date', value: previous?.date ?? dateKey() });
      const due = field('Срок работы', 'Дата, к которой нужно выполнить работу. Срок берётся из регламента или согласуется с ответственным.', { type: 'date', value: previous?.due });
      const owner = field('Ответственный', 'Кому поручена работа.', { value: previous?.owner ?? devices.find(item => item.id === selected)?.owner });
      const description = field('Работа или наблюдение', 'Опиши плановую работу либо признаки неисправности и их влияние на работу точки.', { multiline: true, value: previous?.description });
      const result = field('Результат работ', 'Запиши, что сделали и что изменилось. При закрытии добавь итог перепроверки, если она была нужна.', { multiline: true, required: false, value: previous?.result });
      const follow = el('div', '', 'quality-fields');
      const recheck = field('Что перепроверить', 'Опиши конкретный признак, замер или часть работы, которую нужно проверить.', { value: previous?.recheck });
      const next = field('Дата перепроверки', 'Когда вернуться к результату обслуживания.', { type: 'date', value: previous?.next });
      follow.append(recheck.wrapper, next.wrapper);
      const recheckResult = field('Результат перепроверки', 'Запиши, что фактически подтвердил повторный осмотр или замер.', { multiline: true, value: previous?.recheckResult });
      const closed = field('Дата закрытия', 'Фактическая дата, когда работа была закрыта.', { type: 'date', value: previous?.closed ?? dateKey() });
      body.append(device.wrapper, kind.wrapper, state.wrapper, date.wrapper, due.wrapper, owner.wrapper, description.wrapper, result.wrapper, follow, recheckResult.wrapper, closed.wrapper);
      state.control.addEventListener('change', update);
      device.control.addEventListener('change', () => {
        if (!previous) owner.control.value = devices.find(item => item.id === value(device))?.owner ?? '';
      });
      function update() {
        const status = value(state);
        result.control.required = status === 'done' || status === 'recheck';
        setActive(follow, status === 'recheck');
        setActive(closed.wrapper, status === 'done');
        setActive(recheckResult.wrapper, status === 'done' && Boolean(previous?.recheck));
      }
      update();
      return () => {
        const status = value(state);
        const dateFields = [date, due];
        if (status === 'recheck') dateFields.push(next);
        if (status === 'done') dateFields.push(closed);
        if (dateFields.some(item => !dateIsValid(value(item)))) throw Error('Укажи даты работы и перепроверки.');
        if (dateFields.slice(1).some(item => value(item) < value(date))) throw Error('Срок работы, перепроверка и закрытие должны быть не раньше даты записи.');
        return saveEquipment(snapshot, 'jobs', {
          id: previous?.id ?? crypto.randomUUID(), device: requireText(device), kind: value(kind), state: status,
          date: value(date), due: value(due), owner: requireText(owner), description: requireText(description),
          result: result.control.required ? requireText(result) : value(result),
          recheck: status === 'recheck' ? requireText(recheck) : previous?.recheck ?? '',
          next: status === 'recheck' ? value(next) : previous?.next ?? '',
          recheckResult: status === 'done' && previous?.recheck ? requireText(recheckResult) : '',
          closed: status === 'done' ? value(closed) : ''
        });
      };
    }, 'Сохранить работу', 'Добавляет работу в общий список и в историю выбранного оборудования.');
  }

  function readWaterAttempt(container, rule, minDate = '') {
    const date = dateField('Дата замера', 'Дата фактического замера.');
    if (minDate) date.control.min = minDate;
    const measurement = numberField('Фактическое значение', 'Введи результат в той же единице, что и заданный диапазон.');
    const output = el('output', '', 'quality-result');
    output.setAttribute('aria-live', 'polite');
    const row = el('div', '', 'quality-heading');
    row.append(output, help('Результат замера', 'Панель сравнивает значение с заданным диапазоном. Обе границы входят в диапазон.'));
    const follow = el('div', '', 'quality-fields');
    const nextAction = field('Что сделать', 'Запиши согласованное действие при отклонении.', { multiline: true });
    const owner = field('Ответственный', 'Укажи, кто выполнит действие и организует следующий замер.');
    const next = field('Дата повторного замера', 'Когда проверить тот же показатель повторно.', { type: 'date' });
    follow.append(nextAction.wrapper, owner.wrapper, next.wrapper);
    container.append(date.wrapper, measurement.wrapper, row, follow);
    function outcome() {
      const range = rule();
      const amount = measurement.control.valueAsNumber;
      if (!value(measurement) || !Number.isFinite(amount) || !validRule(range)) return null;
      return amount >= range.min && amount <= range.max;
    }
    function update() {
      const passed = outcome();
      setActive(follow, passed === false);
      output.textContent = passed === null ? 'Введи диапазон и результат' : passed ? 'В диапазоне' : 'Отклонение';
      output.dataset.result = passed === false ? 'fail' : '';
    }
    container.addEventListener('input', update);
    container.addEventListener('change', update);
    update();
    return () => {
      const day = value(date);
      const passed = outcome();
      if (passed === null) throw Error('Проверь диапазон, единицу и фактический замер.');
      if (!dateIsValid(day) || (minDate && day < minDate)) throw Error('Дата замера должна быть не раньше предыдущего замера.');
      const nextDate = value(next);
      if (!passed && (!dateIsValid(nextDate) || nextDate < day)) throw Error('Укажи дату повторного замера не раньше текущего.');
      return {
        date: day, amount: measurement.control.valueAsNumber, passed,
        plan: passed ? null : { action: requireText(nextAction), owner: requireText(owner), date: nextDate }
      };
    };
  }

  function openWater() {
    const snapshot = readEquipment();
    const devices = snapshot.data.devices;
    showEditor('Замер воды', body => {
      const point = field('Точка', 'Кофейня, где отобрана проба.', { value: currentEquipmentPoint(snapshot.data) });
      const device = deviceField(devices, '', false);
      const sample = field('Место отбора', 'Укажи точное место отбора, чтобы повторить замер там же.');
      const indicator = field('Показатель', 'Название показателя из регламента точки или документации оборудования.');
      const method = field('Метод замера', 'Укажи прибор или методику и условия, нужные для повторного замера.', { multiline: true });
      const unit = field('Единица измерения', 'Используй ту же единицу для границ и фактического замера.');
      const min = numberField('Нижняя граница', 'Минимальное значение по регламенту точки или документации оборудования.');
      const max = numberField('Верхняя граница', 'Максимальное значение по тому же источнику.');
      const range = el('div', '', 'quality-pair');
      range.append(min.wrapper, max.wrapper);
      body.append(point.wrapper, device.wrapper, sample.wrapper, indicator.wrapper, method.wrapper, unit.wrapper, range);
      device.control.addEventListener('change', () => {
        const selected = devices.find(item => item.id === value(device));
        if (selected) point.control.value = selected.point;
      });
      const rule = () => ({ type: 'numeric', min: min.control.valueAsNumber, max: max.control.valueAsNumber, unit: value(unit) });
      const read = readWaterAttempt(body, rule);
      return () => {
        const site = requireText(point);
        const selected = devices.find(item => item.id === value(device));
        if (selected && normalized(selected.point) !== normalized(site)) throw Error('Паспорт оборудования должен относиться к выбранной точке.');
        const item = {
          id: crypto.randomUUID(), point: site, device: selected?.id ?? '', sample: requireText(sample),
          indicator: requireText(indicator), method: requireText(method), rule: rule(), attempts: [read()]
        };
        return saveEquipment(snapshot, 'water', item);
      };
    }, 'Сохранить замер', 'Записывает исходный диапазон и фактический результат в журнал воды.');
  }

  function openWaterRepeat(item) {
    const snapshot = readEquipment();
    const current = snapshot.data.water.find(row => row.id === item.id);
    if (!current) throw Error('Замер недоступен. Обнови журнал.');
    showEditor('Повторный замер воды', body => {
      line(body, 'Место отбора:', current.point + ' · ' + current.sample);
      line(body, 'Показатель и диапазон:', current.indicator + ' · ' + ruleLabel(current.rule));
      line(body, 'Метод:', current.method);
      const read = readWaterAttempt(body, () => current.rule, current.attempts.at(-1).date);
      return () => saveEquipment(snapshot, 'water', { ...current, attempts: [...current.attempts, read()] });
    }, 'Сохранить повторный замер', 'Добавляет замер к исходной записи с теми же показателем, методом и диапазоном.');
  }

  function dueForJob(job) { return job.state === 'recheck' ? job.next : job.due; }

  function jobCaption(job) {
    const late = job.state !== 'done' && dueForJob(job) < dateKey();
    return (late ? 'Просрочено · ' : '') + jobStates[job.state] + ' · ' + formatDate(job.closed || dueForJob(job));
  }

  function makeJournalRecord(id, title, caption, opened) {
    const record = el('details', '', 'module quality-record');
    record.dataset.journalId = id;
    record.open = opened.has(id);
    const summary = el('summary', title);
    if (caption) summary.append(el('p', caption, 'quiet'));
    const body = el('div', '', 'quality-details');
    record.append(summary, body);
    return { record, body };
  }

  function currentEquipmentPoint(data) {
    const points = [...data.devices, ...data.water].map(item => item.point);
    return points.find(point => normalized(point) === equipmentPoint) ?? '';
  }

  function renderEquipment(keepOpen = '') {
    const passports = $('#equipment-passports');
    if (!passports) return;
    const jobsList = $('#equipment-jobs');
    const waterList = $('#equipment-water');
    const opened = new Set(Array.from(document.querySelectorAll('[data-journal-id][open]'), item => item.dataset.journalId));
    if (keepOpen) opened.add(keepOpen);
    passports.replaceChildren();
    jobsList.replaceChildren();
    waterList.replaceChildren();
    $('#equipment-message').textContent = '';
    try {
      const { data } = readEquipment();
      const points = new Map([...data.devices, ...data.water].map(item => [normalized(item.point), item.point]));
      const filter = field('Точка', 'Ограничивает один и тот же список паспортов, работ и замеров выбранной точкой.', {
        choices: { '': 'Все точки', ...Object.fromEntries(points) }, value: points.has(equipmentPoint) ? equipmentPoint : '', required: false
      });
      if (!points.has(equipmentPoint)) equipmentPoint = '';
      filter.control.addEventListener('change', () => { equipmentPoint = value(filter); renderEquipment(); });
      $('#equipment-filter').replaceChildren(filter.wrapper);
      const matches = point => !equipmentPoint || normalized(point) === equipmentPoint;
      const devices = data.devices.filter(item => matches(item.point));
      const known = new Map(devices.map(item => [item.id, item]));
      const jobs = data.jobs.filter(item => known.has(item.device)).sort((a, b) =>
        Number(a.state === 'done') - Number(b.state === 'done') || dueForJob(a).localeCompare(dueForJob(b)));
      const water = data.water.filter(item => matches(item.point)).sort((a, b) => b.attempts.at(-1).date.localeCompare(a.attempts.at(-1).date));
      for (const device of devices) {
        const history = jobs.filter(item => item.device === device.id);
        const nextMaintenance = history.find(item => item.kind === 'planned' && item.state !== 'done');
        const { record, body } = makeJournalRecord(device.id, deviceTitle(device), device.point, opened);
        line(body, 'Ответственный:', device.owner);
        line(body, 'Ближайшее обслуживание:', nextMaintenance ? jobCaption(nextMaintenance) : 'не назначено');
        const jobHistory = history.slice().sort((a, b) => (b.closed || b.date).localeCompare(a.closed || a.date));
        for (const job of jobHistory) {
          const entry = el('div', '', 'quality-criterion');
          line(entry, jobKinds[job.kind] + ':', jobCaption(job));
          line(entry, 'Работа или наблюдение:', job.description);
          line(entry, 'Результат:', job.result);
          line(entry, 'Результат перепроверки:', job.recheckResult);
          body.append(entry);
        }
        for (const sample of data.water.filter(item => item.device === device.id)) {
          const latest = sample.attempts.at(-1);
          line(body, 'Вода · ' + sample.indicator + ':', formatDate(latest.date) + ' · ' + sample.sample + ' · ' +
            latest.amount + ' ' + sample.rule.unit + ' · ' + (latest.passed ? 'в диапазоне' : 'отклонение'));
        }
        body.append(equipmentAction('Изменить паспорт', 'Открывает данные оборудования для редактирования.', () => openDevice(device)));
        body.append(equipmentAction('Добавить работу', 'Открывает новую работу, связанную с этим паспортом.', () => openEquipmentJob(null, device.id)));
        passports.append(record);
      }
      for (const job of jobs) {
        const device = known.get(job.device);
        const { record, body } = makeJournalRecord(job.id, jobKinds[job.kind] + ' · ' + device.model, jobCaption(job), opened);
        line(body, 'Точка и оборудование:', device.point + ' · ' + deviceTitle(device));
        line(body, 'Дата записи:', formatDate(job.date));
        line(body, 'Срок работы:', formatDate(job.due));
        line(body, 'Ответственный:', job.owner);
        line(body, 'Работа или наблюдение:', job.description);
        line(body, 'Результат работ:', job.result);
        if (job.recheck) line(body, 'План перепроверки:', job.recheck + ' · ' + formatDate(job.next));
        line(body, 'Результат перепроверки:', job.recheckResult);
        body.append(equipmentAction('Изменить работу', 'Открывает сроки, статус и результат обслуживания.', () => openEquipmentJob(job)));
        jobsList.append(record);
      }
      for (const item of water) {
        const last = item.attempts.at(-1);
        const caption = last.passed ? 'В диапазоне' : last.plan.date < dateKey() ? 'Отклонение · перепроверка просрочена' : 'Отклонение';
        const { record, body } = makeJournalRecord(item.id, item.indicator + ' · ' + item.point, item.sample + ' · ' + caption, opened);
        line(body, 'Место отбора:', item.sample);
        const device = data.devices.find(row => row.id === item.device);
        if (device) line(body, 'Паспорт:', deviceTitle(device));
        line(body, 'Метод:', item.method);
        line(body, 'Диапазон:', ruleLabel(item.rule));
        for (const attempt of item.attempts) {
          const reading = el('div', '', 'quality-criterion');
          line(reading, formatDate(attempt.date) + ':', attempt.amount + ' ' + item.rule.unit + ' · ' + (attempt.passed ? 'в диапазоне' : 'отклонение'));
          if (attempt.plan) {
            line(reading, 'Действие:', attempt.plan.action);
            line(reading, 'Ответственный:', attempt.plan.owner);
            line(reading, 'Повторный замер:', formatDate(attempt.plan.date));
          }
          body.append(reading);
        }
        body.append(equipmentAction('Повторить замер', 'Добавляет замер с тем же местом отбора, методом и исходным диапазоном.', () => openWaterRepeat(item)));
        waterList.append(record);
      }
      if (!devices.length) passports.append(el('p', 'Паспортов пока нет.', 'quiet'));
      if (!jobs.length) jobsList.append(el('p', 'Работ пока нет.', 'quiet'));
      if (!water.length) waterList.append(el('p', 'Замеров пока нет.', 'quiet'));
    } catch (problem) {
      $('#equipment-message').textContent = 'Не удалось прочитать журнал оборудования.';
      console.warn(problem);
    }
  }

  const suppliersKey = 'panel-03:suppliers';
  const sampleKinds = { lot: 'Партия', sample: 'Образец', replacement: 'Образец для замены' };
  const sampleDecisions = { approved: 'Одобрено', repeat: 'Нужна повторная проба', rejected: 'Отклонено' };

  function readSuppliers() {
    const raw = localStorage.getItem(suppliersKey);
    return { raw, data: raw === null ? { suppliers: [], specs: [], samples: [] } : JSON.parse(raw) };
  }

  function writeSuppliers(snapshot, group, item) {
    if (localStorage.getItem(suppliersKey) !== snapshot.raw) throw Error('Данные изменились в другой вкладке. Открой запись заново.');
    const items = snapshot.data[group].filter(row => row.id !== item.id);
    localStorage.setItem(suppliersKey, JSON.stringify({ ...snapshot.data, [group]: [...items, item] }));
    return item.id;
  }

  function supplierAction(label, tip, run, className) {
    return action(label, tip, () => {
      try { run(); }
      catch (problem) {
        const message = $(location.hash === '#economy' ? '#economy-message' : '#suppliers-message');
        if (message) message.textContent = problem.message;
      }
    }, className);
  }

  function supplierChoices(items) {
    return Object.fromEntries(items.map(item => [item.id, item.name]));
  }

  function openSupplier(previous) {
    const snapshot = readSuppliers();
    const supplies = readEconomy().data.supplies;
    showEditor(previous ? 'Карточка поставщика' : 'Новый поставщик', body => {
      const name = field('Название поставщика', 'Укажи рабочее название поставщика.', { value: previous?.name });
      const contact = field('Рабочий контакт', 'Укажи рабочий канал связи или контакт по поставкам.', { value: previous?.contact });
      body.append(name.wrapper, contact.wrapper);
      const positions = repeatedFields(body, previous?.positions ?? [], {
        item: 'Закупочная позиция', add: 'позицию', remove: 'позицию',
        addHelp: 'Связывает с поставщиком ещё одну существующую позицию из экономики.',
        removeHelp: 'Убирает позицию из карточки поставщика. История проб сохраняется.'
      }, (group, current) => {
        const item = field('Закупочная позиция', 'Выбери сырьё, с которым работает поставщик.', {
          choices: { '': 'Выбери позицию', ...supplierChoices(supplies) }, value: current, required: false
        });
        group.append(item.wrapper);
        return () => value(item);
      });
      return () => {
        const title = requireText(name);
        if (snapshot.data.suppliers.some(item => item.id !== previous?.id && normalized(item.name) === normalized(title))) {
          throw Error('Поставщик с таким названием уже существует.');
        }
        return writeSuppliers(snapshot, 'suppliers', { id: previous?.id ?? crypto.randomUUID(), name: title,
          contact: requireText(contact), positions: [...new Set(positions().filter(Boolean))] });
      };
    }, 'Сохранить поставщика', 'Сохраняет рабочий контакт и связи с закупочными позициями.');
  }

  function openSupplySpec(id) {
    const snapshot = readSuppliers();
    const supply = readEconomy().data.supplies.find(item => item.id === id);
    if (!supply) throw Error('Закупочная позиция недоступна.');
    const previous = snapshot.data.specs.find(item => item.id === id);
    showEditor('Требования к сырью', body => {
      body.append(heading(supply.name, 'Требования используются при новых проверках этой закупочной позиции.'));
      const readings = repeatedFields(body, previous?.criteria ?? [], {
        item: 'Критерий требования', add: 'критерий', remove: 'критерий',
        addHelp: 'Добавляет наблюдаемый признак или числовой диапазон.',
        removeHelp: 'Убирает критерий из будущих проб. Прошлые записи сохраняются.'
      }, (group, saved) => {
        const fields = definitionFields(group, saved, true);
        const method = field('Способ проверки', 'Укажи, как воспроизвести проверку: прибор, условия дегустации или порядок наблюдения.', { multiline: true, value: saved?.method });
        group.append(method.wrapper);
        return () => ({ ...fields.read(), method: requireText(method) });
      });
      return () => {
        const criteria = readings();
        if (!criteria.length) throw Error('Добавь хотя бы один проверяемый критерий.');
        const seen = new Set();
        for (const criterion of criteria) {
          const label = normalized(criterion.name);
          if (!label || seen.has(label) || !validRule(criterion.rule)) throw Error('Заполни критерии, укажи уникальные названия и проверяемые границы или признаки.');
          seen.add(label);
        }
        return writeSuppliers(snapshot, 'specs', { id, version: (previous?.version ?? 0) + 1, criteria });
      };
    }, 'Сохранить требования', 'Сохраняет новую версию требований к этой позиции. Старые пробы остаются с исходными критериями.');
  }

  function pickSample() {
    const snapshot = readSuppliers();
    const { data } = readEconomy();
    const { suppliers, specs } = snapshot.data;
    const supplies = data.supplies.filter(item => specs.some(spec => spec.id === item.id));
    if (!suppliers.length || !supplies.length) throw Error('Добавь поставщика и требования хотя бы к одной закупочной позиции.');
    showEditor('Новая партия или образец', body => {
      const supplier = field('Поставщик', 'Выбери поставщика партии или образца, включая кандидата на замену.', {
        choices: supplierChoices(suppliers), value: suppliers[0].id
      });
      const supply = field('Закупочная позиция', 'Выбери позицию, по требованиям к которой проверяется партия или образец.', { choices: supplierChoices(supplies), value: supplies[0].id });
      const kind = field('Тип записи', 'Отметь, что оцениваешь партию, образец или замену для действующего сырья.', { choices: sampleKinds, value: 'sample' });
      const lot = field('Номер партии', 'Укажи номер, если он есть.', { required: false });
      body.append(supplier.wrapper, supply.wrapper, kind.wrapper, lot.wrapper);
      return () => {
        const spec = specs.find(item => item.id === value(supply));
        openSampleAttempt({
          id: crypto.randomUUID(), supplier: requireText(supplier), supply: requireText(supply),
          kind: value(kind), lot: value(lot), spec, attempts: []
        });
        return null;
      };
    }, 'Продолжить', 'Открывает оценку партии или образца по требованиям выбранной позиции.');
  }

  function sampleImpact(supply, quote, date) {
    const { data } = readEconomy();
    const affected = [];
    for (const card of readCatalog().cards) {
      const version = activeVersion(card);
      if (!version) continue;
      for (const portion of version.portions) {
        const items = portion.ingredients.filter(ingredient => {
          const key = linkKey(card.id, portion.name, ingredient);
          return data.links.some(link => link.key === key && link.supply === supply);
        });
        if (!items.length) continue;
        const costs = items.map(ingredient => {
          const old = estimateIngredient({ data }, card.id, portion.name, ingredient, date).cost;
          const amount = quote ? convertAmount(ingredient.amount, ingredient.unit, quote.unit) : null;
          const next = amount === null ? null : cents(amount / quote.amount * quote.cost / 100);
          return old !== null && Number.isSafeInteger(next) ? next - old : null;
        });
        const delta = costs.every(cost => cost !== null) ? costs.reduce((sum, cost) => sum + cost, 0) : null;
        affected.push({ title: version.title + ' · ' + portion.name, delta });
      }
    }
    return affected;
  }

  function openSampleAttempt(sample) {
    const snapshot = readSuppliers();
    const supply = readEconomy().data.supplies.find(item => item.id === sample.supply);
    const company = snapshot.data.suppliers.find(item => item.id === sample.supplier);
    if (!supply || !company) throw Error('Поставщик или закупочная позиция недоступны.');
    const previous = sample.attempts.at(-1);
    showEditor(previous ? 'Повторная проба' : 'Проверка партии или образца', body => {
      line(body, 'Поставщик и сырьё:', company.name + ' · ' + supply.name);
      line(body, 'Требования:', 'версия ' + sample.spec.version);
      if (previous?.follow) line(body, 'План повторной пробы:', previous.follow);
      const date = dateField('Дата пробы', 'Когда проверена партия или образец.');
      if (previous) date.control.min = previous.date;
      const conditions = field('Условия пробы', 'Укажи условия приготовления, дегустации или замера, необходимые для повторения.', { multiline: true });
      body.append(date.wrapper, conditions.wrapper);
      const readings = sample.spec.criteria.map(criterion => {
        const group = el('fieldset', '', 'quality-criterion quality-fields');
        body.append(group);
        return criterionObservation(group, criterion, 'Отклонение');
      });
      const cost = field('Цена образца или упаковки, ₽', 'Если поставщик дал цену, укажи её целиком за указанное количество.', { type: 'number', required: false, value: previous?.quote ? previous.quote.cost / 100 : undefined });
      cost.control.min = '0';
      const amount = field('Количество по цене', 'Количество, за которое указана цена. Например, 1 для одного килограмма.', { type: 'number', required: false, value: previous?.quote?.amount });
      const unit = field('Единица цены', 'Единица количества, входящего в указанную цену. Например, кг, л или шт.', { required: false, value: previous?.quote?.unit });
      const pair = el('div', '', 'quality-pair');
      pair.append(amount.wrapper, unit.wrapper);
      const decision = field('Решение', 'Фиксирует итог пробы после оценки критериев.', { choices: { '': 'Выбери решение', ...sampleDecisions } });
      const reason = field('Обоснование решения', 'Запиши, почему принято решение и какие наблюдения на него повлияли.', { multiline: true });
      const follow = field('Что проверить повторно', 'Укажи, что уточнить на повторной пробе.', { multiline: true, required: false });
      const next = field('Срок повторной пробы', 'Плановая дата повторной пробы, если известна.', { type: 'date', required: false });
      const transition = field('Дата перехода', 'Плановая дата применения новой цены или сырья, если переход согласован.', { type: 'date', required: false });
      const impactNote = field('Заметка о замене', 'Уточни затронутые напитки, изменение рецептуры или условия перехода. Панель посчитает разницу цены для уже связанных техкарт.', { multiline: true, required: false });
      body.append(cost.wrapper, pair, decision.wrapper, reason.wrapper, follow.wrapper, next.wrapper, transition.wrapper, impactNote.wrapper);
      function update() {
        setActive(follow.wrapper, value(decision) === 'repeat');
        setActive(next.wrapper, value(decision) === 'repeat');
        setActive(transition.wrapper, value(decision) === 'approved');
        setActive(impactNote.wrapper, sample.kind === 'replacement');
      }
      decision.control.addEventListener('change', update);
      update();
      return () => {
        const day = value(date);
        if (!dateIsValid(day) || (previous && day < previous.date)) throw Error('Укажи дату пробы не раньше предыдущей.');
        const state = requireText(decision);
        const nextDate = state === 'repeat' ? value(next) : '';
        const transitionDate = state === 'approved' ? value(transition) : '';
        if (nextDate && (!dateIsValid(nextDate) || nextDate < day)) throw Error('Срок повторной пробы должен быть не раньше даты пробы.');
        if (transitionDate && (!dateIsValid(transitionDate) || transitionDate < day)) throw Error('Дата перехода должна быть не раньше даты пробы.');
        let quote = null;
        if ([cost, amount, unit].some(item => value(item))) {
          const price = cost.control.valueAsNumber;
          const size = amount.control.valueAsNumber;
          if (!Number.isSafeInteger(cents(price)) || price < 0 || !Number.isFinite(size) || size <= 0) throw Error('Для цены укажи сумму от нуля, количество больше нуля и единицу.');
          quote = { cost: cents(price), amount: size, unit: requireText(unit) };
        }
        const results = readings.map(item => item.read());
        const attempt = {
          id: crypto.randomUUID(), date: day, conditions: requireText(conditions), results, quote, decision: state,
          reason: requireText(reason), follow: state === 'repeat' ? value(follow) : '', next: nextDate, transition: transitionDate,
          impactNote: value(impactNote),
          impact: sample.kind === 'replacement' ? sampleImpact(sample.supply, quote, transitionDate || day) : []
        };
        return writeSuppliers(snapshot, 'samples', { ...sample, attempts: [...sample.attempts, attempt] });
      };
    }, 'Сохранить пробу', 'Оставляет фактические результаты и решение в истории этой партии или образца.');
  }

  function showSampleAttempt(attempt) {
    const details = el('details', '', 'quality-criterion');
    details.append(el('summary', formatDate(attempt.date) + ' · ' + sampleDecisions[attempt.decision]));
    const body = el('div', '', 'quality-details');
    line(body, 'Условия:', attempt.conditions);
    for (const result of attempt.results) {
      const item = el('div', '', 'quality-criterion');
      line(item, result.name + ':', result.passed ? 'соответствует' : 'отклонение');
      line(item, 'Требование:', ruleLabel(result.rule));
      line(item, 'Способ проверки:', result.method);
      if (result.measured !== null) line(item, 'Замер:', result.measured + ' ' + result.rule.unit);
      line(item, 'Наблюдение:', result.notes);
      body.append(item);
    }
    line(body, 'Обоснование:', attempt.reason);
    line(body, 'Повторная проба:', attempt.follow);
    if (attempt.next) line(body, 'Срок повторной пробы:', formatDate(attempt.next));
    if (attempt.transition) line(body, 'Дата перехода:', formatDate(attempt.transition));
    if (attempt.quote) {
      const price = attempt.quote;
      line(body, 'Цена:', money(price.cost) + ' за ' + price.amount + ' ' + price.unit);
      const kilogram = convertAmount(1, 'кг', price.unit);
      const costPerKilo = kilogram === null ? null : cents(kilogram / price.amount * (price.cost / 100));
      if (Number.isSafeInteger(costPerKilo)) line(body, 'В пересчёте на килограмм:', money(costPerKilo));
    }
    line(body, 'Заметка о замене:', attempt.impactNote);
    if (attempt.impact.length) {
      body.append(heading('Изменение затрат на порцию', 'Сравниваются цена действующей закупки и предложение при том же количестве сырья в текущей техкарте.', 'h4'));
      for (const item of attempt.impact) line(body, item.title + ':', item.delta === null ? 'неполный расчёт цены' : (item.delta > 0 ? '+' : '') + money(item.delta));
    }
    details.append(body);
    return details;
  }

  function renderSuppliers(keepOpen = '') {
    const companies = $('#suppliers-list');
    if (!companies) return;
    const specs = $('#suppliers-specs');
    const samples = $('#suppliers-samples');
    const opened = new Set(Array.from(document.querySelectorAll('[data-journal-id][open]'), item => item.dataset.journalId));
    if (keepOpen) opened.add(keepOpen);
    companies.replaceChildren();
    specs.replaceChildren();
    samples.replaceChildren();
    $('#suppliers-message').textContent = '';
    try {
      const { data } = readSuppliers();
      const supplies = readEconomy().data.supplies;
      const supplyName = id => supplies.find(item => item.id === id)?.name ?? 'Закупочная позиция';
      const companyName = id => data.suppliers.find(item => item.id === id)?.name ?? 'Поставщик';
      for (const company of data.suppliers) {
        const { record, body } = makeJournalRecord(company.id, company.name, company.contact, opened);
        for (const id of company.positions) line(body, 'Закупочная позиция:', supplyName(id));
        body.append(supplierAction('Изменить поставщика', 'Открывает контакт и связи с закупочными позициями.', () => openSupplier(company)));
        companies.append(record);
      }
      for (const supply of supplies) {
        const spec = data.specs.find(item => item.id === supply.id);
        const { record, body } = makeJournalRecord(supply.id, supply.name, spec ? 'Требования · версия ' + spec.version : 'Требования ещё не заданы', opened);
        for (const criterion of spec?.criteria ?? []) line(body, criterion.name + ':', ruleLabel(criterion.rule) + ' · ' + criterion.method);
        for (const sample of data.samples.filter(item => item.supply === supply.id)) {
          const last = sample.attempts.at(-1);
          line(body, 'Проба:', formatDate(last.date) + ' · ' + companyName(sample.supplier) + ' · ' + sampleDecisions[last.decision]);
        }
        body.append(supplierAction('Настроить требования', 'Открывает критерии и методы проверки для этой позиции.', () => openSupplySpec(supply.id)));
        specs.append(record);
      }
      const sorted = data.samples.slice().sort((a, b) => b.attempts.at(-1).date.localeCompare(a.attempts.at(-1).date));
      for (const sample of sorted) {
        const last = sample.attempts.at(-1);
        const { record, body } = makeJournalRecord(sample.id, supplyName(sample.supply) + ' · ' + companyName(sample.supplier),
          sampleKinds[sample.kind] + ' · ' + sampleDecisions[last.decision], opened);
        line(body, 'Номер партии:', sample.lot);
        line(body, 'Требования:', 'версия ' + sample.spec.version);
        for (const attempt of sample.attempts) body.append(showSampleAttempt(attempt));
        if (last.decision === 'repeat') body.append(supplierAction('Повторить пробу', 'Добавляет ещё одну попытку по тем же требованиям.', () => openSampleAttempt(sample)));
        if (last.decision === 'approved' && last.quote) {
          const recorded = supplies.find(item => item.id === sample.supply)?.prices.some(price => price.reviewId === last.id);
          if (recorded) line(body, 'Закупочная цена:', 'записана в истории цен');
          else body.append(supplierAction('Добавить закупочную цену', 'Открывает форму цены с данными этой пробы. Дату действия можно проверить перед сохранением.', () => {
            location.hash = '#economy';
            $('#economy-price-start').closest('details').open = true;
            openPriceEditor(sample.supply, { ...last.quote, date: last.transition || dateKey(), reviewId: last.id, supplier: companyName(sample.supplier) });
          }));
        }
        samples.append(record);
      }
      if (!data.suppliers.length) companies.append(el('p', 'Поставщиков пока нет.', 'quiet'));
      if (!supplies.length) specs.append(el('p', 'Сначала добавь закупочные позиции в «Экономике».', 'quiet'));
      if (!data.samples.length) samples.append(el('p', 'Проб пока нет.', 'quiet'));
    } catch (problem) {
      $('#suppliers-message').textContent = 'Не удалось прочитать журнал поставщиков.';
      console.warn(problem);
    }
  }

  const deadlineSections = { quality: 'Качество', equipment: 'Оборудование', water: 'Вода', training: 'Обучение', suppliers: 'Сырьё и поставщики' };
  const deadlineFilter = { point: '', section: '' };

  function collectDeadlines() {
    const rows = [];
    const warnings = [];
    function load(label, collect) {
      try { collect(); }
      catch { warnings.push(label); }
    }
    load('Качество', () => {
      for (const { record, original } of savedRecords()) {
        for (const [index, criterion] of record.criteria.entries()) {
          const attempt = latest(criterion);
          if (attempt.outcome !== 'fail') continue;
          rows.push({
            section: 'quality', point: record.location, owner: attempt.plan?.owner || '',
            date: attempt.plan?.due || '', title: record.drink + ' · ' + criterion.name,
            detail: attempt.plan?.action || 'Уточнить действие по отклонению',
            route: 'quality', id: record.id, selector: '[data-id]',
            schedule: () => editDeadline('Срок исправления', attempt.plan?.due, (date) => {
              if (localStorage.getItem(prefix + record.id) !== original) throw Error('Проверка изменилась. Открой её заново.');
              const plan = { ...attempt.plan, due: date };
              const updated = { ...attempt, plan };
              const initial = attempt === criterion.initial ? updated : criterion.initial;
              const repeats = criterion.repeats.map(item => item === attempt ? updated : item);
              const criteria = record.criteria.map((item, i) => i === index ? { ...item, initial, repeats } : item);
              localStorage.setItem(prefix + record.id, JSON.stringify({ ...record, criteria }));
            })
          });
        }
      }
    });
    load('Оборудование и вода', () => {
      const snapshot = readEquipment();
      const { data } = snapshot;
      for (const job of data.jobs) {
        if (job.state === 'done') continue;
        const device = data.devices.find(item => item.id === job.device);
        rows.push({
          section: 'equipment', point: device?.point || '', owner: job.owner,
          date: dueForJob(job) || '', title: (job.state === 'recheck' ? 'Перепроверка · ' : '') + (device?.model || 'Оборудование'),
          detail: job.state === 'recheck' ? job.recheck : job.description,
          route: 'equipment', id: job.id, selector: '[data-journal-id]',
          schedule: () => editDeadline(job.state === 'recheck' ? 'Дата перепроверки' : 'Срок работы', dueForJob(job), date => {
            saveEquipment(snapshot, 'jobs', { ...job, [job.state === 'recheck' ? 'next' : 'due']: date });
          }, job.date)
        });
      }
      for (const item of data.water) {
        const last = item.attempts.at(-1);
        if (last.passed) continue;
        rows.push({
          section: 'water', point: item.point, owner: last.plan?.owner || '',
          date: last.plan?.date || '', title: item.indicator + ' · повторный замер',
          detail: item.sample + ' · ' + (last.plan?.action || 'Уточнить действие'),
          route: 'equipment', id: item.id, selector: '[data-journal-id]',
          schedule: () => editDeadline('Дата повторного замера', last.plan?.date, date => {
            const attempts = item.attempts.map(attempt => attempt === last ? { ...attempt, plan: { ...attempt.plan, date } } : attempt);
            saveEquipment(snapshot, 'water', { ...item, attempts });
          }, last.date)
        });
      }
    });
    load('Обучение', () => {
      const snapshot = readTraining();
      const { data } = snapshot;
      for (const person of data.team) {
        for (const skill of data.skills) {
          const attempts = data.attempts.filter(item => item.personId === person.id && item.skillId === skill.id)
            .reverse().sort((a, b) => b.date.localeCompare(a.date));
          const last = attempts[0];
          if (!last || (last.passed && !last.next)) continue;
          rows.push({
            section: 'training', point: person.point, owner: last.reviewer,
            date: last.next || '', title: person.name + ' · ' + skill.name,
            detail: last.exercise || 'Повторная проверка подтверждённого навыка',
            route: 'training', id: person.id, selector: '[data-training-id]',
            schedule: () => editDeadline('Дата повторной проверки', last.next, date => {
              writeTraining(snapshot, 'attempts', { ...last, next: date });
            }, last.date)
          });
        }
      }
    });
    load('Сырьё и поставщики', () => {
      const snapshot = readSuppliers();
      const { data } = snapshot;
      const supplies = readEconomy().data.supplies;
      for (const item of data.samples) {
        const last = item.attempts.at(-1);
        if (last.decision !== 'repeat') continue;
        const company = data.suppliers.find(row => row.id === item.supplier)?.name || 'Поставщик';
        const supply = supplies.find(row => row.id === item.supply)?.name || 'Сырьё';
        rows.push({
          section: 'suppliers', point: '', owner: '', date: last.next || '',
          title: company + ' · ' + supply, detail: last.follow || 'Повторная проба',
          route: 'suppliers', id: item.id, selector: '[data-journal-id]',
          schedule: () => editDeadline('Срок повторной пробы', last.next, date => {
            const attempts = item.attempts.map(attempt => attempt === last ? { ...attempt, next: date } : attempt);
            writeSuppliers(snapshot, 'samples', { ...item, attempts });
          }, last.date)
        });
      }
    });
    return { rows, warnings };
  }

  function editDeadline(label, original, save, earliest = '') {
    showEditor('Рабочий срок', body => {
      const date = field(label, 'Новая дата будет записана в исходном журнале и сразу обновит обзор.', { type: 'date', value: original || dateKey() });
      if (earliest) date.control.min = earliest;
      body.append(date.wrapper);
      return () => {
        const day = value(date);
        if (!dateIsValid(day) || (earliest && day < earliest)) throw Error('Укажи дату не раньше исходной записи.');
        save(day);
        return 'deadline';
      };
    }, 'Сохранить срок', 'Изменяет срок в исходной записи. Результат проверки вносится в её журнале.');
  }

  function openDeadline(row) {
    location.hash = '#' + row.route;
    const renderSource = {
      quality: () => render(row.id), equipment: () => renderEquipment(row.id),
      training: () => renderTraining(row.id), suppliers: () => renderSuppliers(row.id)
    };
    // Run after route handling, which resets page scrolling.
    setTimeout(() => {
      renderSource[row.route]();
      const record = Array.from(document.querySelectorAll(row.selector)).find(node =>
        (node.dataset.id || node.dataset.journalId || node.dataset.trainingId) === row.id);
      if (record) {
        record.open = true;
        record.scrollIntoView({ block: 'start' });
        record.querySelector('summary')?.focus({ preventScroll: true });
      }
    }, 0);
  }

  function deadlineGroup(day, today, end) {
    if (!day || !dateIsValid(day)) return 'Без срока';
    if (day < today) return 'Просрочено';
    if (day === today) return 'Сегодня';
    if (day <= end) return 'Ближайшие 7 дней';
    return 'Позже';
  }

  function renderDeadlines() {
    const container = $('#working-deadlines');
    if (!container) return;
    container.replaceChildren();
    const { rows, warnings } = collectDeadlines();
    const date = dateKey();
    const week = new Date(date + 'T12:00:00');
    week.setDate(week.getDate() + 7);
    const end = dateKey(week);
    container.append(heading('Рабочие сроки', 'Открытые действия из журналов. Нажми «Открыть запись» для результата или «Изменить срок» для переноса даты.'));
    const filters = el('div', '', 'quality-fields');
    const points = new Map(rows.filter(row => row.point).map(row => [normalized(row.point), row.point]));
    const point = field('Точка для сроков', 'Выбери точку. Общие пробы поставщиков находятся в варианте «Без привязки к точке».', {
      choices: { '': 'Все точки', ...Object.fromEntries(points), unassigned: 'Без привязки к точке' }, value: deadlineFilter.point, required: false
    });
    const section = field('Раздел для сроков', 'Ограничивает список одним рабочим направлением.', {
      choices: { '': 'Все разделы', ...deadlineSections }, value: deadlineFilter.section, required: false
    });
    for (const [name, input] of Object.entries({ point, section })) input.control.addEventListener('change', () => {
      deadlineFilter[name] = value(input);
      renderDeadlines();
    });
    filters.append(point.wrapper, section.wrapper);
    container.append(filters);
    if (warnings.length) container.append(el('p', 'Не удалось прочитать часть журналов: ' + warnings.join(', '), 'error'));
    const filtered = rows.filter(row =>
      (!deadlineFilter.section || row.section === deadlineFilter.section) &&
      (!deadlineFilter.point || (deadlineFilter.point === 'unassigned' ? !row.point : normalized(row.point) === deadlineFilter.point)));
    for (const group of ['Просрочено', 'Сегодня', 'Ближайшие 7 дней', 'Позже', 'Без срока']) {
      const items = filtered.filter(row => deadlineGroup(row.date, date, end) === group)
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title, 'ru'));
      if (!items.length) continue;
      const block = el('section', '', 'quality-fields');
      block.append(heading(group + ' · ' + items.length,
        group === 'Ближайшие 7 дней' ? 'Сроки с завтрашнего дня по седьмой день включительно.' :
        group === 'Без срока' ? 'Открытые действия, которым нужно назначить корректную дату.' :
        'Открытые действия, сгруппированные по дате в браузере.', 'h4'));
      for (const row of items) {
        const entry = el('div', '', 'quality-criterion quality-fields');
        line(entry, row.title, row.detail);
        line(entry, 'Раздел:', deadlineSections[row.section]);
        line(entry, 'Точка:', row.point || 'без привязки');
        line(entry, 'Срок:', dateIsValid(row.date) ? formatDate(row.date) : 'не назначен');
        if (row.owner) line(entry, 'Ответственный:', row.owner);
        entry.append(action('Открыть запись', 'Переходит к исходной записи и раскрывает её для проверки результата.', () => openDeadline(row)));
        entry.append(action('Изменить срок', 'Назначает или переносит дату в исходном журнале.', () => {
          try { row.schedule(); }
          catch {
            container.append(el('p', 'Не удалось открыть запись. Обнови обзор и повтори действие.', 'error'));
          }
        }));
        block.append(entry);
      }
      container.append(block);
    }
    if (!filtered.length) container.append(el('p', rows.length ? 'По выбранным фильтрам открытых действий нет.' : 'Открытых действий со сроками нет.', 'quiet'));
  }

  $('#quality-tooltip-close').addEventListener('click', () => tooltip.close());
  $('#quality-start').append(action('Проверка напитка', 'Создай запись для одного напитка в одной кофейне. В неё можно включить несколько критериев.', startCheck, 'action primary'));
  $('#quality-journal-title').append(heading('Журнал проверок', 'Открой запись, чтобы увидеть оценку и повторно проверить отклонение. Состояние в журнале определяется последней проверкой по каждому критерию.'));
  $('#quality-cancel').append(action('Отмена', 'Закрывает форму и отменяет изменения, сделанные после её открытия.', () => editor.close()));
  $('#techcards-start')?.append(action('Новая техкарта', 'Создаёт черновик с рецептурой и измеримыми критериями для каждого размера порции.', () => {
    try { openCardEditor(); }
    catch (problem) { $('#techcards-message').textContent = problem.message; }
  }, 'action primary'));
  $('#sales-start')?.append(action('Добавить продажи', 'Открывает дневной ввод из кассового отчёта. Для существующей строки будут подставлены её данные.', openSalesIdentity, 'action primary'));
  $('#stock-writeoff-start')?.append(action('Записать списание', 'Открывает запись расхода сырья вне продаж.', () => openWriteOff(), 'action primary'));
  $('#stock-check-start')?.append(action('Новая сверка', 'Сравнивает расход по остаткам с продажами и журналом списаний за выбранный период.', () => openStockCheck(), 'action primary'));
  $('#equipment-passports-start')?.append(equipmentAction('Добавить оборудование', 'Создаёт паспорт оборудования с привязкой к точке.', () => openDevice(), 'action primary'));
  $('#equipment-jobs-start')?.append(equipmentAction('Добавить работу', 'Открывает плановое обслуживание или заявку по неисправности.', () => openEquipmentJob(), 'action primary'));
  $('#equipment-water-start')?.append(equipmentAction('Записать замер воды', 'Сохраняет результат, условия и допустимый диапазон.', openWater, 'action primary'));
  $('#suppliers-start')?.append(supplierAction('Добавить поставщика', 'Создаёт карточку с рабочим контактом и связанным сырьём.', () => openSupplier(), 'action primary'));
  $('#suppliers-sample-start')?.append(supplierAction('Записать пробу', 'Открывает проверку одной партии или образца по требованиям закупочной позиции.', pickSample, 'action primary'));
  $('#economy-suppliers-link')?.after(help('Сырьё и поставщики', 'Открывает контакты, требования к сырью и журнал проб.'));
  $('#training-team-start')?.append(trainingAction('Добавить бариста', 'Создаёт личную карточку с точкой и историей проверок.', () => openTeamMember(), 'action primary'));
  $('#training-skill-start')?.append(trainingAction('Новый навык', 'Создаёт шаблон задания и обязательных критериев.', () => openSkill(), 'action primary'));
  $('#economy-stock-link')?.after(help('Списания и сверка', 'Открывает журнал расхода вне продаж и сверку по остаткам.'));
  $('#economy-sales-link')?.after(help('Продажи и отчёт', 'Показывает выручку, прямую себестоимость, фудкост и маржинальность по точкам и периодам.'));
  $('#economy-price-start')?.append(action('Новая закупочная позиция', 'Добавляет сырьё или упаковку и первую цену, по которой их можно учитывать в расчёте.', () => openPriceEditor(), 'action primary'));
  $('#economy-calculation-title')?.append(heading('Себестоимость порции', 'Расчёт по составу действующей техкарты и закупочным ценам на выбранную дату.'));
  $('#quality-techcards-link')?.after(help('Техкарты', 'Открывает действующие рецептуры, черновики и архив версий.'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!active) return;
    try {
      const id = active();
      if (id) {
        editor.close();
        if (!location.hash || location.hash === '#overview') renderDeadlines();
        else if (location.hash === '#techcards') renderCards(id);
        else if (location.hash === '#economy') renderEconomy(id);
        else if (location.hash === '#sales') renderSales();
        else if (location.hash === '#stock') renderStock(id);
        else if (location.hash === '#training') renderTraining(id);
        else if (location.hash === '#equipment') renderEquipment(id);
        else if (location.hash === '#suppliers') renderSuppliers(id);
        else render(id);
      }
    } catch (problem) {
      error.textContent = problem instanceof DOMException ? 'Не удалось сохранить запись в браузере.' : problem.message;
      error.hidden = false;
    }
  });
  window.addEventListener('storage', event => {
    if (!location.hash || location.hash === '#overview') renderDeadlines();
    if (event.key === null || event.key.startsWith(prefix)) render();
    if (event.key === null || event.key === cardKey) renderCards();
    if (event.key === null || event.key === cardKey || event.key === economyKey) renderEconomy();
    if (event.key === null || event.key === cardKey || event.key === economyKey || event.key === salesKey) {
      if (location.hash === '#sales') renderSales();
    }
    if (location.hash === '#stock' && [null, cardKey, economyKey, salesKey, stockKey].includes(event.key)) renderStock();
    if (location.hash === '#training' && (event.key === null || event.key === trainingKey)) renderTraining();
    if (location.hash === '#equipment' && (event.key === null || event.key === equipmentKey)) renderEquipment();
    if (location.hash === '#suppliers' && [null, suppliersKey, economyKey].includes(event.key)) renderSuppliers();
  });
  window.addEventListener('hashchange', () => {
    if (!location.hash || location.hash === '#overview') renderDeadlines();
    if (location.hash === '#economy') renderEconomy();
    if (location.hash === '#sales') renderSales();
    if (location.hash === '#stock') renderStock();
    if (location.hash === '#training') renderTraining();
    if (location.hash === '#equipment') renderEquipment();
    if (location.hash === '#suppliers') renderSuppliers();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!location.hash || location.hash === '#overview')) renderDeadlines();
  });
  renderDeadlines();
  render();
  renderCards();
  if (location.hash === '#economy') renderEconomy();
  if (location.hash === '#sales') renderSales();
  if (location.hash === '#stock') renderStock();
  if (location.hash === '#training') renderTraining();
  if (location.hash === '#equipment') renderEquipment();
  if (location.hash === '#suppliers') renderSuppliers();
})();
