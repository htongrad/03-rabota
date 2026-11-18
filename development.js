(() => {
  'use strict';

  const key = 'panel-03:network';
  const visitKey = 'panel-03:precision-visits';
  const baselineKey = 'panel-03:network-baselines';
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

  function edit(title, baseline, data, body, persist = save) {
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
        persist(baseline, getNext(data));
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

  const topics = [
    ['drinks', 'Напитки', 'Запиши, что сверил с техкартой и какой результат получил. Учитывай кофейные и софт-позиции.'],
    ['bar', 'Работа бара', 'Отметь, что наблюдал при подготовке станции или в смене, и что требует внимания.'],
    ['team', 'Команда', 'Запиши, какие навыки или пробелы наблюдал и по какой задаче.'],
    ['equipment', 'Оборудование и вода', 'Запиши конкретное наблюдение, проверку, замер или причину, по которой данных пока нет.'],
    ['supply', 'Сырьё', 'Укажи, какие позиции, партии или условия хранения проверил.'],
    ['economy', 'Экономика', 'Отметь, за какой период и по каким данным сверялись продажи, расход, фудкост и маржинальность.']
  ];
  const states = { '': 'Выбери результат', ok: 'В порядке', issue: 'Требует внимания', skipped: 'Не проверено' };
  const topicTitle = Object.fromEntries(topics.map(([id, title]) => [id, title]));
  let selectedVisit = '';

  function visitsFromStorage() {
    const baseline = localStorage.getItem(visitKey) ?? '';
    return { baseline, visits: baseline ? JSON.parse(baseline) : [] };
  }

  function saveVisits(baseline, visits) {
    if ((localStorage.getItem(visitKey) ?? '') !== baseline) throw Error('Запись изменилась в другой вкладке. Открой форму заново.');
    window.panel03Backup.validate({ [key]: read(key, fresh()), [visitKey]: visits });
    localStorage.setItem(visitKey, JSON.stringify(visits));
    window.dispatchEvent(new Event('panel-03:work-changed'));
  }

  function selectState(container, state) {
    const label = node('label', 'field');
    const select = node('select');
    for (const [key, title] of Object.entries(states)) {
      const option = node('option', '', title);
      option.value = key;
      option.selected = key === state;
      select.append(option);
    }
    label.append(node('span', '', 'Результат'), select);
    container.append(label);
    return select;
  }

  function visitCheckEditor(container, topic, check) {
    const [id, title, help] = topic;
    const group = node('fieldset', 'dev-options');
    group.append(node('legend', '', title));
    const state = selectState(group, check?.state || '');
    const note = field(group, 'Наблюдение или причина пропуска', 'note-' + id, check?.note || '', help, 'textarea');
    const controls = node('div', 'stack');
    const label = node('label', 'check');
    const confirmed = node('input');
    confirmed.type = 'checkbox';
    confirmed.checked = Boolean(check?.action);
    label.append(confirmed, node('span', '', 'Добавить связанное действие'));
    controls.append(label);
    const fields = node('div', 'stack');
    const action = check?.action;
    const actionTitle = field(fields, 'Действие', 'action-' + id, action?.title || '', 'Что сделать, чтобы устранить отклонение?');
    const owner = field(fields, 'Ответственный', 'owner-' + id, action?.owner || '', '');
    const due = field(fields, 'Срок', 'due-' + id, action?.due || '', '', 'date');
    const verification = field(fields, 'Способ перепроверки', 'verify-' + id, action?.verification || '', 'Как подтвердить, что отклонение устранено?', 'textarea');
    const sync = () => {
      controls.hidden = state.value !== 'issue';
      fields.hidden = !confirmed.checked;
    };
    state.addEventListener('change', sync);
    confirmed.addEventListener('change', sync);
    controls.append(fields);
    group.append(controls);
    sync();
    container.append(group);
    return day => {
      const observation = note.value.trim();
      let follow = null;
      if (state.value === 'issue' && confirmed.checked) {
        follow = { title: actionTitle.value.trim(), owner: owner.value.trim(), due: due.value,
          verification: verification.value.trim(), closed: null };
        if (!observation || !follow.title || !follow.owner || !follow.due || follow.due < day || !follow.verification) {
          throw Error(title + ': заполни наблюдение, действие, ответственного, срок не раньше визита и способ перепроверки.');
        }
      }
      return { topic: id, state: state.value || '', note: observation, action: follow };
    };
  }

  function editVisit(point, visit) {
    const { baseline, visits } = visitsFromStorage();
    if (visit) {
      visit = visits.find(item => item.id === visit.id && !item.confirmed);
      if (!visit) return;
    }
    edit('Первичная диагностика · ' + point.name, baseline, visits, form => {
      const day = field(form, 'Дата визита', 'date', visit?.date || today(), 'Дата фактической проверки.', 'date', true);
      day.max = today();
      const getChecks = topics.map(topic => visitCheckEditor(form, topic, visit?.checks.find(check => check.topic === topic[0])));
      const label = node('label', 'check');
      const confirm = node('input');
      confirm.type = 'checkbox';
      label.append(confirm, node('span', '', 'Подтвердить завершение визита'));
      form.append(label);
      explain(form, 'Без отметки сохранится черновик. Для завершения нужен результат или причина пропуска по каждому блоку. По каждому отклонению назначь действие.');
      return existing => {
        const checks = getChecks.map(readCheck => readCheck(day.value));
        if (confirm.checked) {
          const missing = checks.filter(check => !check.state || !check.note || (check.state === 'issue' && !check.action));
          if (missing.length) throw Error('Для завершения заполни: ' + missing.map(check => topicTitle[check.topic]).join(', ') + '.');
        }
        const result = { id: visit?.id || crypto.randomUUID(), pointId: point.id, date: day.value, checks, confirmed: confirm.checked };
        selectedPoint = point.id;
        selectedVisit = result.id;
        showMap = true;
        return [...existing.filter(item => item.id !== result.id), result];
      };
    }, saveVisits);
  }

  function editFollowUp(visitId, topic, mode) {
    const { baseline, visits } = visitsFromStorage();
    const visit = visits.find(item => item.id === visitId);
    const action = visit?.checks.find(check => check.topic === topic)?.action;
    if (!action || action.closed || !visit.confirmed) return;
    const closing = mode === 'close';
    edit(closing ? 'Подтвердить перепроверку' : 'Перенести срок', baseline, visits, form => {
      showText(form, 'Действие', action.title);
      showText(form, 'Способ перепроверки', action.verification);
      const day = field(form, closing ? 'Дата перепроверки' : 'Новый срок', 'followup-date', closing ? today() : action.due, '', 'date', true);
      day.min = visit.date;
      if (closing) day.max = today();
      const result = closing ? field(form, 'Результат перепроверки', 'result', '', 'Запиши, что именно подтвердило устранение.', 'textarea', true) : null;
      return existing => {
        const evidence = result?.value.trim() || '';
        if (!day.value || day.value < visit.date || (closing && (day.value > today() || !evidence))) {
          throw Error('Проверь дату и укажи результат перепроверки, если закрываешь действие.');
        }
        const updated = closing ? { ...action, closed: { date: day.value, result: evidence } } : { ...action, due: day.value };
        return existing.map(item => item.id === visit.id ? { ...item, checks: item.checks.map(check =>
          check.topic === topic ? { ...check, action: updated } : check) } : item);
      };
    }, saveVisits);
  }

  function openVisit(pointId, visitId) {
    selectedPoint = pointId;
    selectedVisit = visitId;
    showMap = true;
    if (location.hash !== '#development') location.hash = '#development';
    else render();
    setTimeout(() => {
      const detail = [...page.querySelectorAll('[data-diagnostic-visit]')].find(item => item.dataset.diagnosticVisit === visitId);
      detail?.scrollIntoView?.({ block: 'start' });
      detail?.querySelector('summary')?.focus({ preventScroll: true });
    }, 0);
  }

  window.panel03DiagnosticDeadlines = () => {
    const points = read(key, fresh()).points;
    return visitsFromStorage().visits.filter(visit => visit.confirmed).flatMap(visit => {
      const point = points.find(item => item.id === visit.pointId);
      if (!point) throw Error('Не найдена точка для визита.');
      return visit.checks.filter(check => check.action && !check.action.closed).map(({ topic, action }) => ({
        key: JSON.stringify(['diagnostics', visit.id, topic]), section: 'diagnostics', point: point.name, owner: action.owner,
        date: action.due, title: topicTitle[topic] + ' · ' + action.title, detail: action.verification,
        open: () => openVisit(point.id, visit.id), schedule: () => editFollowUp(visit.id, topic, 'schedule')
      }));
    });
  };

  function visitHistory(parent, point, visits) {
    const history = visits.filter(visit => visit.pointId === point.id).toSorted((left, right) => right.date.localeCompare(left.date));
    const title = node('h4', '', 'Первичная диагностика');
    parent.append(title);
    if (!history.length) parent.append(node('p', 'quiet', 'Записей о визите пока нет.'));
    for (const visit of history) {
      const detail = node('details', 'module stack');
      detail.dataset.diagnosticVisit = visit.id;
      detail.open = visit.id === selectedVisit;
      detail.append(node('summary', '', visit.date + (visit.confirmed ? ' · Визит завершён' : ' · Черновик')));
      for (const check of visit.checks) {
        const block = node('div', 'stack');
        showText(block, topicTitle[check.topic] + ' · ' + (check.state ? states[check.state] : 'Нет результата'), check.note);
        if (check.action) {
          const { title, owner, due, verification, closed } = check.action;
          showText(block, 'Действие', title + '\n' + owner + ' · ' + due + '\n' + verification);
          if (closed) showText(block, 'Перепроверено · ' + closed.date, closed.result);
          else if (visit.confirmed) {
            const actions = node('div', 'quality-actions');
            actions.append(button('Перенести срок', () => editFollowUp(visit.id, check.topic, 'schedule')),
              button('Подтвердить устранение', () => editFollowUp(visit.id, check.topic, 'close')));
            block.append(actions);
          }
        }
        detail.append(block);
      }
      if (!visit.confirmed) detail.append(button('Открыть черновик', () => editVisit(point, visit)));
      parent.append(detail);
    }
    if (!history.some(visit => !visit.confirmed)) parent.append(button('Записать визит', () => editVisit(point), true));
  }

  function latestByPoint(points, visits) {
    const byPoint = new Map();
    for (const visit of visits) {
      if (visit.confirmed && (byPoint.get(visit.pointId)?.date || '') <= visit.date) byPoint.set(visit.pointId, visit);
    }
    return points.map(point => ({ point, visit: byPoint.get(point.id) }));
  }

  function confirmBaseline(profile, latest, diagnosticsRaw, networkRaw) {
    const baselineRaw = localStorage.getItem(baselineKey) ?? '';
    const versions = baselineRaw ? JSON.parse(baselineRaw) : [];
    edit('Подтвердить исходную картину', baselineRaw, versions, form => {
      form.append(node('p', 'quiet', 'Зафиксируй отправную точку, что требует внимания и что проверишь дальше.'));
      const note = field(form, 'Приоритеты и пробелы', 'priority', '', 'Например, какие вопросы требуют первого действия и где пока не хватает сведений.', 'textarea', true);
      return existing => {
        const priority = note.value.trim();
        if (!priority) throw Error('Укажи приоритеты или зафиксируй, что вопросов пока нет.');
        return [...existing, {
          id: crypto.randomUUID(), date: today(), profileId: profile.id,
          visitIds: latest.map(item => item.visit.id).sort(), priority
        }];
      };
    }, (original, entries) => {
      if ((localStorage.getItem(baselineKey) ?? '') !== original ||
          (localStorage.getItem(visitKey) ?? '') !== diagnosticsRaw || (localStorage.getItem(key) ?? '') !== networkRaw) {
        throw Error('Исходные данные изменились. Открой форму заново.');
      }
      window.panel03Backup.validate({ [key]: JSON.parse(networkRaw), [visitKey]: JSON.parse(diagnosticsRaw), [baselineKey]: entries });
      localStorage.setItem(baselineKey, JSON.stringify(entries));
      window.dispatchEvent(new Event('panel-03:work-changed'));
    });
  }

  function initialPicture(latest, visits, versions, baseline) {
    if (!latest.length) return null;
    const card = module('Исходная картина сети');
    const covered = latest.filter(item => item.visit).length;
    const open = visits.filter(visit => visit.confirmed).flatMap(visit => visit.checks).filter(check => check.action && !check.action.closed).length;
    card.append(node('p', '', covered + ' из ' + latest.length + ' точек с завершённым визитом'),
      node('p', 'quiet', 'Открытых действий: ' + open));
    for (const { point, visit } of latest) {
      if (!visit) {
        card.append(node('p', 'quiet', point.name + ' · Нет завершённого визита'));
        continue;
      }
      const skipped = visit.checks.filter(check => check.state === 'skipped').length;
      card.append(button(point.name + ' · ' + visit.date + ' · Не проверено: ' + skipped, () => openVisit(point.id, visit.id)));
    }
    for (const version of [...versions].reverse()) {
      const detail = node('details');
      detail.open = version.id === baseline?.id;
      detail.append(node('summary', '', version.date + (detail.open ? ' · Подтверждённая картина' : ' · Предыдущая картина')));
      showText(detail, 'Приоритеты и пробелы', version.priority);
      for (const id of version.visitIds) {
        const visit = visits.find(item => item.id === id);
        const point = latest.find(item => item.point.id === visit?.pointId)?.point;
        if (point) detail.append(button(point.name + ' · Визит ' + visit.date, () => openVisit(point.id, id)));
      }
      card.append(detail);
    }
    return card;
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

      const { baseline: diagnosticsRaw, visits } = visitsFromStorage();
      const latest = latestByPoint(data.points, visits);
      const versions = read(baselineKey, []);
      const ready = latest.length > 0 && latest.every(item => item.point.reviewed && item.visit);
      const visitIds = ready ? JSON.stringify(latest.map(item => item.visit.id).sort()) : '';
      const confirmed = profile && versions.findLast(version => version.profileId === profile.id && JSON.stringify(version.visitIds) === visitIds);
      const next = data.points.find(point => !point.reviewed);
      const undiagnosed = data.points.find(point => point.reviewed && !visits.some(visit => visit.pointId === point.id && visit.confirmed));
      const mission = module('Следующее действие');
      mission.classList.add('dev-feature');
      if (!profile) {
        mission.append(node('p', '', 'Миссия 1.1 · Определить контур ответственности'), button('Заполнить паспорт', () => editProfile(baseline, data), true));
      } else if (undiagnosed) {
        const draft = visits.find(visit => visit.pointId === undiagnosed.id && !visit.confirmed);
        mission.append(node('p', '', 'Миссия 1.3 · Провести первичную диагностику'),
          button((draft ? 'Продолжить визит · ' : 'Записать визит · ') + undiagnosed.name, () => editVisit(undiagnosed, draft), true));
      } else if (!data.points.length || next) {
        mission.append(node('p', '', 'Миссия 1.2 · Собрать карту сети'),
          button(next ? 'Заполнить «' + next.name + '»' : 'Добавить первую точку', () => {
            if (next) editPoint(baseline, data, next, team, devices);
            else editPoint(baseline, data, emptyPoint(), team, devices);
          }, true));
      } else if (confirmed) {
        mission.append(node('p', '', 'Уровень 1 · Исходная картина сети подтверждена'), node('p', 'quiet', 'Открытые действия видны в рабочих сроках.'));
      } else if (ready) {
        mission.append(node('p', '', 'Миссия 1.4 · Подведи итоги по исходной картине сети'),
          button('Подтвердить исходную картину', () => confirmBaseline(profile, latest, diagnosticsRaw, baseline), true));
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
      const picture = initialPicture(latest, visits, versions, confirmed);
      const panels = picture ? [mission, map, picture] : [mission, map];
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
        visitHistory(card, point, visits);
        panels.splice(1, 0, card);
      }
      page.replaceChildren(...panels);
    } catch (error) {
      page.replaceChildren(node('p', 'error', 'Не удалось открыть карту сети: ' + error.message));
    }
  }

  window.addEventListener('storage', event => {
    if (event.key === null || [key, visitKey, baselineKey, 'panel-03:training', 'panel-03:equipment'].includes(event.key)) render();
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('panel-03:work-changed', render);
  window.dispatchEvent(new Event('panel-03:work-changed'));
})();
