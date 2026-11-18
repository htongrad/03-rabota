(() => {
  'use strict';

  const key = 'panel-03:network';
  const page = document.getElementById('development-content');
  const instruction = document.getElementById('instruction-role');
  if (!page || !instruction) return;

  const fresh = () => ({ profiles: [], points: [] });
  const emptyPoint = () => ({ name: '', manager: '', menu: '', teamIds: [], deviceIds: [], equipmentNotes: '', reviewed: false });
  const today = () => {
    const date = new Date();
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0')).join('-');
  };
  const normalize = value => value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
  let selectedPoint = '';
  let showMap = false;

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function button(label, click, primary = false) {
    const element = node('button', primary ? 'action primary' : 'action', label);
    element.type = 'button';
    element.addEventListener('click', click);
    return element;
  }

  function module(title) {
    const card = node('section', 'module stack');
    card.append(node('h3', '', title));
    return card;
  }

  function read(storageKey, fallback) {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? fallback : JSON.parse(raw);
  }

  function save(baseline, next) {
    if ((localStorage.getItem(key) ?? '') !== baseline) throw Error('Запись изменилась в другой вкладке. Открой форму заново.');
    window.panel03Backup.validate({ [key]: next });
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event('panel-03:work-changed'));
  }

  function edit(title, baseline, data, body) {
    const dialog = node('dialog');
    const form = node('form', 'dev-editor');
    const heading = node('h2', '', title);
    heading.id = 'development-editor-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    form.append(heading);
    const getNext = body(form);
    const error = node('p', 'error dev-status');
    error.setAttribute('role', 'alert');
    const actions = node('div', 'actions');
    const submit = node('button', 'action primary', 'Сохранить');
    submit.type = 'submit';
    actions.append(button('Отмена', () => dialog.close()), submit);
    form.append(error, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        save(baseline, getNext(data));
        dialog.close();
        render();
      } catch (problem) {
        error.textContent = problem.message || 'Не удалось сохранить запись.';
      }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
  }

  function explain(container, text) {
    const details = node('details', 'quiet dev-help');
    details.append(node('summary', '', 'Пояснение'), node('p', '', text));
    container.append(details);
  }

  function field(form, label, name, value, help, type = 'text', required = false) {
    const wrapper = node('div', 'stack');
    const caption = node('label', 'field');
    const input = node(type === 'textarea' ? 'textarea' : 'input');
    input.name = name;
    if (type !== 'textarea') input.type = type;
    input.value = value;
    input.required = required;
    input.maxLength = type === 'textarea' ? 8000 : 160;
    caption.append(node('span', '', label), input);
    wrapper.append(caption);
    if (help) explain(wrapper, help);
    form.append(wrapper);
    return input;
  }

  function showText(parent, label, value) {
    parent.append(node('h4', '', label), node('p', value ? 'dev-copy' : 'quiet', value || 'Данные не внесены'));
  }

  function getProfile(data) {
    return data.profiles.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id))[0];
  }

  function editProfile(baseline, data, profile) {
    edit('Паспорт должности', baseline, data, form => {
      const fields = [
        ['Назначение', 'purpose', 'Какой результат обеспечивает шеф-бариста для сети.'],
        ['Область работы', 'scope', 'Какие точки, напитки и рабочие процессы входят в твою ответственность.'],
        ['Подчинение и замещение', 'leadership', 'Кому ты подчиняешься и кто подхватывает срочные вопросы в твоё отсутствие.'],
        ['Обязанности и решения', 'authority', 'Кто принимает решение, кто выполняет действие и как подтверждается результат.'],
        ['Основание подтверждения', 'basis', 'Укажи, где и с кем согласовали эту редакцию.']
      ];
      const inputs = fields.map(([title, name, help]) => [name, field(form, title, name, profile?.[name] ?? '', help, 'textarea', true)]);
      const effective = field(form, 'Дата действия версии', 'effective', today(), 'Дата, с которой применяется эта редакция паспорта.', 'date', true);
      effective.max = today();
      return existing => {
        const item = Object.fromEntries(inputs.map(([name, input]) => [name, input.value.trim()]));
        if (Object.values(item).some(value => !value)) throw Error('Заполни все обязательные поля.');
        return { ...existing, profiles: [...existing.profiles, {
          ...item, id: crypto.randomUUID(), effective: effective.value, savedAt: new Date().toISOString()
        }] };
      };
    });
  }

  function profileCard(profile, baseline, data) {
    const card = module('Паспорт должности');
    if (profile) {
      showText(card, 'Назначение', profile.purpose);
      showText(card, 'Область работы', profile.scope);
      showText(card, 'Подчинение и замещение', profile.leadership);
      showText(card, 'Обязанности и решения', profile.authority);
      showText(card, 'Основание подтверждения', profile.basis);
      card.append(node('p', 'quiet', 'Дата действия версии: ' + profile.effective));
      const prior = data.profiles.filter(entry => entry.id !== profile.id).toSorted((a, b) => b.savedAt.localeCompare(a.savedAt));
      for (const entry of prior) {
        const details = node('details');
        details.append(node('summary', '', 'Предыдущая версия · ' + entry.effective));
        for (const [label, value] of [['Назначение', entry.purpose], ['Область работы', entry.scope], ['Подчинение и замещение', entry.leadership], ['Обязанности и решения', entry.authority], ['Основание подтверждения', entry.basis]]) showText(details, label, value);
        card.append(details);
      }
    } else card.append(node('p', 'quiet', 'Добавь область работы и правила принятия решений.'));
    card.append(button(profile ? 'Сохранить новую версию' : 'Заполнить паспорт', () => editProfile(baseline, data, profile)));
    return card;
  }

  function choices(form, label, options, selected, help, href) {
    const group = node('fieldset', 'dev-options');
    group.append(node('legend', '', label));
    explain(group, help);
    const inputs = [];
    const known = new Set(options.map(item => item.id));
    for (const item of [...options, ...selected.filter(id => !known.has(id)).map(id => ({ id, title: 'Недоступная карточка' }))]) {
      const row = node('label');
      const input = node('input');
      input.type = 'checkbox';
      input.checked = selected.includes(item.id);
      inputs.push([item.id, input]);
      row.append(input, node('span', '', item.title));
      group.append(row);
    }
    if (!inputs.length) {
      const link = node('a', '', 'Открыть журнал');
      link.href = href;
      link.addEventListener('click', () => form.closest('dialog').close());
      group.append(link);
    }
    form.append(group);
    return () => inputs.filter(([, input]) => input.checked).map(([id]) => id);
  }

  function editPoint(baseline, data, point, team, devices) {
    edit(point.id ? 'Карточка точки' : 'Новая точка', baseline, data, form => {
      const name = field(form, 'Название', 'name', point.name, 'Короткое название, по которому узнаешь точку в списке.', 'text', true);
      const manager = field(form, 'Управляющий', 'manager', point.manager, 'Кому передать срочный вопрос на этой точке.');
      const menu = field(form, 'Меню напитков', 'menu', point.menu, 'Укажи, какие локальные позиции, включая софт, добавлены или отсутствуют по сравнению с общим меню.', 'textarea');
      const teamIds = choices(form, 'Команда', team.map(person => ({ id: person.id, title: person.name })), point.teamIds,
        'Одна карточка сотрудника может использоваться на нескольких точках.', '#training');
      const deviceIds = choices(form, 'Оборудование', devices.map(device => ({ id: device.id, title: device.model + (device.serial ? ' · ' + device.serial : '') })), point.deviceIds,
        'Выбери карточки техники из журнала оборудования.', '#equipment');
      const equipmentNotes = field(form, 'Что ещё используется', 'equipmentNotes', point.equipmentNotes, 'Опиши оборудование, для которого карточки пока нет.', 'textarea');
      const reviewedRow = node('label', 'check');
      const reviewed = node('input');
      reviewed.type = 'checkbox';
      reviewed.checked = point.reviewed;
      reviewedRow.append(reviewed, node('span', '', 'Сведения по точке проверены'));
      form.append(reviewedRow);
      explain(form, 'Подтверди после сверки управляющего, меню, команды и оборудования. Если часть сведений ещё предстоит собрать, оставь отметку пустой.');
      return existing => {
        const title = name.value.trim();
        if (!title) throw Error('Укажи название точки.');
        if (existing.points.some(item => item.id !== point.id && normalize(item.name) === normalize(title))) throw Error('Точка с таким названием уже есть.');
        const updated = { id: point.id || crypto.randomUUID(), name: title, manager: manager.value.trim(), menu: menu.value.trim(),
          teamIds: teamIds(), deviceIds: deviceIds(), equipmentNotes: equipmentNotes.value.trim(), reviewed: reviewed.checked };
        if (updated.reviewed && (!updated.manager || !updated.menu || !updated.teamIds.length || !(updated.deviceIds.length || updated.equipmentNotes))) {
          throw Error('Для подтверждения заполни управляющего, меню, команду и оборудование.');
        }
        selectedPoint = updated.id;
        showMap = true;
        return { ...existing, points: point.id ? existing.points.map(item => item.id === point.id ? updated : item) : [...existing.points, updated] };
      };
    });
  }

  function listLabels(ids, items, label) {
    return ids.map(id => {
      const item = items.find(entry => entry.id === id);
      return item ? label(item) : 'Карточка недоступна';
    }).join('\n');
  }

  function render() {
    try {
      const baseline = localStorage.getItem(key) ?? '';
      const data = baseline ? JSON.parse(baseline) : fresh();
      const profile = getProfile(data);
      instruction.replaceChildren(profileCard(profile, baseline, data));
      const team = read('panel-03:training', { team: [] }).team;
      const devices = read('panel-03:equipment', { devices: [] }).devices;
      function openMap(point) {
        selectedPoint = point?.id || '';
        showMap = true;
        if (location.hash !== '#development') location.hash = '#development';
        else render();
      }

      const next = data.points.find(point => !point.reviewed);
      const mission = module('Следующее действие');
      mission.classList.add('dev-feature');
      if (!profile) {
        mission.append(node('p', '', 'Миссия 1.1 · Определить контур ответственности'), button('Заполнить паспорт', () => editProfile(baseline, data), true));
      } else if (!data.points.length || next) {
        mission.append(node('p', '', 'Миссия 1.2 · Собрать карту сети'),
          button(next ? 'Заполнить «' + next.name + '»' : 'Добавить первую точку', () => {
            if (next) editPoint(baseline, data, next, team, devices);
            else editPoint(baseline, data, emptyPoint(), team, devices);
          }, true));
      } else {
        mission.append(node('p', '', 'Карта сети заполнена. Дальше — первичная диагностика точки.'));
      }

      const map = module('Карта сети');
      const reviewedCount = data.points.filter(point => point.reviewed).length;
      map.append(node('p', 'quiet', data.points.length ? 'Проверено карточек: ' + reviewedCount + ' из ' + data.points.length : 'Добавь точки, с которыми работаешь.'));
      const list = node('div', 'dev-list');
      for (const point of data.points) {
        const row = button('', () => openMap(point));
        row.classList.add('dev-point');
        row.append(node('span', '', point.name), node('small', 'quiet', point.reviewed ? 'Сведения проверены' : 'К заполнению'));
        if (point.id === selectedPoint && showMap) row.setAttribute('aria-current', 'true');
        list.append(row);
      }
      map.append(list, button('Добавить точку', () => editPoint(baseline, data, emptyPoint(), team, devices)));
      const point = showMap && data.points.find(item => item.id === selectedPoint);
      const panels = [mission, map];
      if (point) {
        const card = module(point.name);
        showText(card, 'Управляющий', point.manager);
        showText(card, 'Меню напитков', point.menu);
        showText(card, 'Команда', listLabels(point.teamIds, team, item => item.name));
        showText(card, 'Оборудование', [listLabels(point.deviceIds, devices, item => item.model), point.equipmentNotes].filter(Boolean).join('\n'));
        const links = node('p');
        links.className = 'quality-actions';
        for (const [href, text] of [['#techcards', 'Общий справочник напитков'], ['#quality', 'Журнал качества']]) {
          const link = node('a', 'action', text);
          link.href = href;
          links.append(link);
        }
        card.append(links, button('Заполнить карточку', () => editPoint(baseline, data, point, team, devices), true));
        panels.splice(1, 0, card);
      }
      page.replaceChildren(...panels);
    } catch (error) {
      page.replaceChildren(node('p', 'error', 'Не удалось открыть карту сети: ' + error.message));
    }
  }

  window.addEventListener('storage', event => {
    if (event.key === null || [key, 'panel-03:training', 'panel-03:equipment'].includes(event.key)) render();
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('panel-03:work-changed', render);
  render();
})();
