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

  function definitionFields(container, saved = {}, required = false) {
    const rule = saved.rule || {};
    const label = field('Критерий', 'Один проверяемый параметр. Например, масса выхода эспрессо или чистота чашки при выдаче.', { required, value: saved.name });
    const type = field('Способ оценки', 'Для замера задай числовые границы из техкарты. Для вкуса и подачи опиши конкретный наблюдаемый признак.', {
      choices: { observable: 'Наблюдаемый признак', numeric: 'Числовой диапазон' }, value: rule.type || 'observable'
    });
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
      setActive(expected.wrapper, !numeric);
      setActive(numericFields, numeric);
    }

    type.control.addEventListener('input', update);
    type.control.addEventListener('change', update);
    update();

    function read() {
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

  function openPriceEditor(id) {
    try {
      const snapshot = readEconomy();
      const supplied = snapshot.data.supplies.find(item => item.id === id);
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
      body.append(heading('История цен', 'Список записей по датам начала действия. Более поздняя запись за ту же дату уточняет расчёт.', 'h4'));
      const recentFirst = [...supply.prices].reverse().sort((a, b) => b.date.localeCompare(a.date));
      for (const price of recentFirst) {
        const density = price.density ? ' · ' + price.density + ' г/мл' : '';
        line(body, formatDate(price.date) + ':', money(price.cost) + ' за ' + price.amount + ' ' + price.unit + density);
      }
      card.append(summary, body);
      list.append(card);
    }
  }

  function linkKey(card, portion, ingredient) {
    return JSON.stringify([card, normalized(portion), normalized(ingredient.name), normalized(ingredient.unit)]);
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
      const key = linkKey(calculation.card, portion.name, ingredient);
      const linked = snapshot.data.links.find(pair => pair.key === key)?.supply;
      const supply = snapshot.data.supplies.find(item => item.id === linked);
      const price = supply ? priceFor(supply, calculation.date) : null;
      const converted = price ? convertAmount(ingredient.amount, ingredient.unit, price.unit, price.density) : null;
      const cost = converted === null ? null : cents(converted / price.amount * (price.cost / 100));
      const validCost = cost !== null && Number.isSafeInteger(cost) && Number.isSafeInteger(total + cost);
      item.append(heading(ingredient.name + ' · ' + ingredient.amount + ' ' + ingredient.unit,
        'Количество берётся из действующей техкарты. Выбери закупочную позицию для этой строки.', 'h4'));
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
          renderEconomy('', index);
        } catch (problem) {
          link.control.value = supply?.id ?? '';
          economyError(problem);
        }
      });
      item.append(link.wrapper);
      if (price) line(item, 'Цена закупки:', money(price.cost) + ' за ' + price.amount + ' ' + price.unit + ' · с ' + formatDate(price.date));
      if (validCost) {
        total += cost;
        line(item, 'На порцию:', money(cost));
      } else {
        missing++;
        const reason = !supply ? 'Свяжи ингредиент с закупочной позицией.' :
          !price ? 'На выбранную дату нет действующей цены.' :
          converted === null ? 'Единицы несовместимы. Проверь единицы или укажи плотность для перевода массы в объём.' :
          'Проверь количество и цену. Сумма выходит за пределы расчёта.';
        item.append(el('p', reason, 'error'));
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

  $('#quality-tooltip-close').addEventListener('click', () => tooltip.close());
  $('#quality-start').append(action('Проверка напитка', 'Создай запись для одного напитка в одной кофейне. В неё можно включить несколько критериев.', startCheck, 'action primary'));
  $('#quality-journal-title').append(heading('Журнал проверок', 'Открой запись, чтобы увидеть оценку и повторно проверить отклонение. Состояние в журнале определяется последней проверкой по каждому критерию.'));
  $('#quality-cancel').append(action('Отмена', 'Закрывает форму и отменяет изменения, сделанные после её открытия.', () => editor.close()));
  $('#techcards-start')?.append(action('Новая техкарта', 'Создаёт черновик с рецептурой и измеримыми критериями для каждого размера порции.', () => {
    try { openCardEditor(); }
    catch (problem) { $('#techcards-message').textContent = problem.message; }
  }, 'action primary'));
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
        if (location.hash === '#techcards') renderCards(id);
        else if (location.hash === '#economy') renderEconomy(id);
        else render(id);
      }
    } catch (problem) {
      error.textContent = problem instanceof DOMException ? 'Не удалось сохранить запись в браузере.' : problem.message;
      error.hidden = false;
    }
  });
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(prefix)) render();
    if (event.key === null || event.key === cardKey) renderCards();
    if (event.key === null || event.key === cardKey || event.key === economyKey) renderEconomy();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#economy') renderEconomy();
  });
  render();
  renderCards();
  if (location.hash === '#economy') renderEconomy();
})();
