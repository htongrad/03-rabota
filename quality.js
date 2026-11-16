(() => {
  'use strict';

  const prefix = 'panel-03:quality:';
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

  function ruleFields(container) {
    const label = field('Критерий', 'Один проверяемый параметр. Например, масса выхода эспрессо или чистота чашки при выдаче.');
    const type = field('Способ оценки', 'Для замера задай числовые границы из техкарты. Для вкуса и подачи опиши конкретный наблюдаемый признак.', {
      choices: { observable: 'Наблюдаемый признак', numeric: 'Числовой диапазон' }, value: 'observable'
    });
    const expected = field('Что должно наблюдаться', 'Укажи проверяемый признак из стандарта. Например, «на поверхности нет крупных пузырьков». Используй наблюдаемое описание.');
    const min = numberField('Нижняя граница', 'Минимальное допустимое значение по техкарте. Граница включается в диапазон.');
    const max = numberField('Верхняя граница', 'Максимальное допустимое значение. Для точного значения введи одинаковые границы.');
    const unit = field('Единица измерения', 'Укажи ту же единицу, что в техкарте и в замере. Например, г, мл или с.');
    const range = el('div', '', 'quality-pair');
    range.append(min.wrapper, max.wrapper);
    container.append(label.wrapper, type.wrapper, expected.wrapper, range, unit.wrapper);

    function read() {
      if (value(type) === 'observable') return { type: 'observable', expected: value(expected) };
      return { type: 'numeric', min: min.control.valueAsNumber, max: max.control.valueAsNumber, unit: value(unit) };
    }
    const assessed = assessment(container, read);

    function update() {
      const numeric = value(type) === 'numeric';
      setActive(expected.wrapper, !numeric);
      setActive(range, numeric);
      setActive(unit.wrapper, numeric);
      assessed.update();
    }

    container.addEventListener('input', update);
    container.addEventListener('change', update);
    update();

    return () => {
      const name = requireText(label);
      const rule = read();
      if (rule.type === 'numeric') {
        if (!Number.isFinite(rule.min) || !Number.isFinite(rule.max) || rule.min > rule.max) {
          min.control.focus();
          throw Error('Укажи допустимый диапазон. Нижняя граница должна быть меньше верхней или равна ей.');
        }
        requireText(unit);
      } else {
        requireText(expected);
      }
      return { name, rule, initial: assessed.read(), repeats: [] };
    };
  }

  function showEditor(title, render) {
    active = null;
    error.hidden = true;
    $('#quality-editor-title').textContent = title;
    const body = $('#quality-editor-body');
    body.replaceChildren();
    active = render(body);
    editor.showModal();
    editor.scrollTop = 0;
  }

  function openCheck() {
    showEditor('Проверка напитка', body => {
      const location = field('Точка', 'Введи название кофейни. Используй одно и то же название во всех проверках этой точки.');
      const date = dateField('Дата проверки', 'День, когда проведена исходная проверка.');
      const drink = field('Напиток', 'Укажи напиток так, как он называется в техкарте или меню.');
      const reference = field('Техкарта или стандарт', 'При необходимости укажи название и версию документа, по которому проводится проверка.', { required: false });
      const criteria = el('div', '', 'quality-list');
      const rows = new Map();
      body.append(location.wrapper, date.wrapper, drink.wrapper, reference.wrapper, criteria);

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

      addCriterion();
      body.append(action('Добавить критерий', 'Добавляет ещё один измеряемый параметр или наблюдаемый признак для того же напитка.', () => {
        const group = addCriterion();
        group.querySelector('input').focus();
      }));
      return () => {
        const record = {
          id: crypto.randomUUID(), location: requireText(location), drink: requireText(drink),
          date: value(date), reference: value(reference),
          criteria: Array.from(rows.values(), row => row.read())
        };
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
        for (const [index, criterion] of record.criteria.entries()) {
          const block = el('section', '', 'quality-criterion quality-fields');
          block.append(heading(criterion.name, 'Здесь видны критерий из стандарта, исходный результат и история повторных проверок. Замечание закрывается при результате «Соответствует».', 'h4'));
          line(block, 'Стандарт:', ruleLabel(criterion.rule));
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

  $('#quality-tooltip-close').addEventListener('click', () => tooltip.close());
  $('#quality-start').append(action('Проверка напитка', 'Создай запись для одного напитка в одной кофейне. В неё можно включить несколько критериев.', openCheck, 'action primary'));
  $('#quality-journal-title').append(heading('Журнал проверок', 'Открой запись, чтобы увидеть оценку и повторно проверить отклонение. Состояние в журнале определяется последней проверкой по каждому критерию.'));
  $('#quality-cancel').append(action('Отмена', 'Закрывает форму и отменяет изменения, сделанные после её открытия.', () => editor.close()));
  $('#quality-save').after(help('Сохранить', 'Записывает проверку в этом браузере. После сохранения она появится в журнале.'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!active) return;
    try {
      const id = active();
      editor.close();
      render(id);
    } catch (problem) {
      error.textContent = problem instanceof DOMException ? 'Проверку не удалось сохранить в браузере.' : problem.message;
      error.hidden = false;
    }
  });
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(prefix)) render();
  });
  render();
})();
