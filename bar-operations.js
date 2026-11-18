(() => {
  'use strict';

  const storageKey = 'panel-03:bar-operations';
  const networkKey = 'panel-03:network';
  const cardsKey = 'panel-03:techcards';
  const equipmentKey = 'panel-03:equipment';
  const supplyKey = 'panel-03:suppliers';
  const phases = { opening: 'Открытие', closing: 'Закрытие' };
  const outcomes = { pass: 'Соответствует', fail: 'Отклонение', unchecked: 'Не проверено' };
  const shifts = {
    opening: [
      ['Станция и чистота', 'Сверь состояние станции, инвентаря и рабочих поверхностей с процедурой открытия.'],
      ['Аллергены', 'Сверь сведения о составе, доступ к актуальной информации и порядок работы по стандарту точки.'],
      ['Техника и вода', 'Сверь готовность техники и актуальный результат контроля воды в журнале.'],
      ['Сырьё и доступность меню', 'Сверь доступность сырья, маркировку и условия хранения с действующими требованиями.']
    ],
    closing: [
      ['Станция и чистота', 'Сверь уборку станции и инвентаря с процедурой закрытия.'],
      ['Техника и вода', 'Сверь состояние техники и операции по завершению дня с процедурой для этой точки.'],
      ['Остатки и передача смены', 'Сверь маркировку и хранение остатков, зафиксируй списания и передай открытые вопросы.']
    ]
  };

  function snapshot(read) {
    return {
      network: read(networkKey, { points: [] }), cards: read(cardsKey, []),
      equipment: read(equipmentKey, { devices: [], water: [] }),
      suppliers: read(supplyKey, { samples: [] })
    };
  }

  function recipeOn(card, day) {
    return card.versions.reduce((latest, version) =>
      version.effective <= day && (!latest || version.effective >= latest.effective) ? version : latest, undefined);
  }

  function passed(record) {
    return record.checks.every(check => check.outcome === 'pass');
  }

  function status(record) {
    if (!record) return 'Нет проверки';
    if (passed(record)) return 'Подтверждено';
    return record.checks.some(check => check.outcome === 'fail') ? 'Есть отклонения' : 'Есть непроверенные пункты';
  }

  function newest(records) {
    return records.toSorted((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  window.panel03BarOperations = ({ read, edit, node, button, module, field, explain, today, openRecord }) => {
    function records() {
      return read(storageKey, []);
    }

    function raw(keys) {
      return new Map(keys.map(key => [key, localStorage.getItem(key)]));
    }

    function persist(expected, next) {
      for (const [key, original] of expected) {
        if (localStorage.getItem(key) !== original) throw Error('Связанные данные изменились. Открой форму заново.');
      }
      const related = [networkKey, cardsKey, equipmentKey, supplyKey, 'panel-03:economy', 'panel-03:menu-changes'].flatMap(key => {
        const data = localStorage.getItem(key);
        return data === null ? [] : [[key, JSON.parse(data)]];
      });
      window.panel03Backup.validate({ ...Object.fromEntries(related), [storageKey]: next });
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event('panel-03:work-changed'));
    }

    function select(form, label, items, help, initial = '') {
      const caption = node('label', 'field');
      const control = node('select');
      caption.append(node('span', '', label), control);
      form.append(caption);
      if (help) explain(form, help);
      setOptions(control, items, initial);
      return control;
    }

    function setOptions(control, items, initial = '') {
      control.replaceChildren(...items.map(([value, label]) => {
        const option = node('option', '', label);
        option.value = value;
        if (value === initial) option.setAttribute('selected', '');
        return option;
      }));
    }

    function checkField(form, name, help, rule) {
      const part = node('div', 'module stack');
      part.append(node('h4', '', name));
      form.append(part);
      if (rule?.type === 'numeric') {
        const range = rule.min + '–' + rule.max + ' ' + rule.unit;
        const measured = field(part, 'Фактическое значение · ' + range, 'reading', '', help, 'number');
        measured.step = 'any';
        const note = field(part, 'Наблюдение или причина пропуска', 'note', '', 'Укажи метод или что помешало сделать замер.');
        return () => {
          const amount = measured.value === '' ? null : Number(measured.value);
          if (amount !== null && !Number.isFinite(amount)) throw Error('Проверь число в пункте «' + name + '».');
          const outcome = amount === null ? 'unchecked' : amount >= rule.min && amount <= rule.max ? 'pass' : 'fail';
          const evidence = note.value.trim();
          if (amount === null && !evidence) throw Error('Укажи причину пропуска в пункте «' + name + '».');
          return { name, outcome, amount, note: evidence, rule };
        };
      }

      const result = select(part, 'Результат', [['', 'Выбери результат'], ...Object.entries(outcomes)], help);
      const note = field(part, 'Что сверено или почему пункт пропущен', 'note', '', 'Укажи наблюдаемый факт, источник нормы или причину пропуска.');
      return () => {
        const evidence = note.value.trim();
        if (!result.value || !evidence) throw Error('Заполни результат и пояснение для «' + name + '».');
        return { name, outcome: result.value, amount: null, note: evidence, rule: rule || null };
      };
    }

    function actionFields(form) {
      const box = node('div', 'module stack');
      box.append(node('h4', '', 'Действие по результату'));
      explain(box, 'При отклонении или пропуске укажи, что сделать, ответственного и срок. Действие появится в рабочих сроках и календаре.');
      const title = field(box, 'Что сделать и как перепроверить', 'action', '', 'Опиши следующий шаг и факт, по которому подтвердится результат.');
      const owner = field(box, 'Ответственный', 'owner', '', 'Укажи, кто выполнит действие.');
      const due = field(box, 'Срок', 'due', '', 'Дата повторной проверки или завершения действия.', 'date');
      form.append(box);
      return (checks, day) => {
        if (checks.every(check => check.outcome === 'pass')) return null;
        if (!title.value.trim() || !owner.value.trim() || !due.value || due.value < day) {
          throw Error('Укажи действие, ответственного и срок от даты проверки.');
        }
        return { title: title.value.trim(), owner: owner.value.trim(), due: due.value, closed: null };
      };
    }

    function base(point, day, author, checks, action) {
      if (!day || day > today() || !author.trim()) throw Error('Проверь дату и укажи, кто выполнил проверку.');
      return { id: crypto.randomUUID(), pointId: point.id, date: day, createdAt: new Date().toISOString(), author: author.trim(), checks, action };
    }

    function editShift(point, phase) {
      const current = records();
      const previous = newest(current.filter(item => item.pointId === point.id && item.type === 'shift' && item.phase === phase))[0];
      edit(phases[phase] + ' · ' + point.name, raw([storageKey, networkKey]), current, form => {
        const day = field(form, 'Дата смены', 'date', today(), 'Запиши фактическую дату открытия или закрытия.', 'date', true);
        day.max = today();
        const author = field(form, 'Кто проверил', 'author', '', 'Имя сотрудника, который выполнил проверку.', 'text', true);
        explain(form, 'Стартовый список покрывает обязательные блоки смены. Сверяй каждый пункт с правилом точки и записывай фактическое наблюдение. Дополнительные пункты переходят в следующую форму для этой точки. Результаты заполняются заново.');
        const checks = shifts[phase].map(([name, help]) => checkField(form, name, help));
        const additional = node('div', 'stack');
        form.append(additional);
        function addCheckpoint(name = '') {
          const item = node('div', 'stack');
          const label = field(item, 'Название дополнительного пункта', 'check-name', name, 'Укажи локальную процедуру или проверяемое условие.');
          const collect = checkField(item, 'Дополнительный пункт', 'Сравни наблюдение с процедурой точки.');
          const readCheck = () => {
            if (!label.value.trim()) throw Error('Назови дополнительный пункт или убери его.');
            return { ...collect(), name: label.value.trim() };
          };
          item.append(button('Убрать пункт', () => {
            checks.splice(checks.indexOf(readCheck), 1);
            item.remove();
          }));
          checks.push(readCheck);
          additional.append(item);
        }
        for (const item of previous?.checks.slice(shifts[phase].length) || []) addCheckpoint(item.name);
        form.append(button('Добавить пункт точки', () => addCheckpoint()));
        const actionFor = actionFields(form);
        return list => {
          const results = checks.map(check => check());
          if (new Set(results.map(item => item.name.toLocaleLowerCase('ru'))).size !== results.length) throw Error('Названия пунктов должны различаться.');
          return [...list, { ...base(point, day.value, author.value, results, actionFor(results, day.value)), type: 'shift', phase, template: 1 }];
        };
      }, persist);
    }

    const menu = window.panel03BarMenu?.({
      read, edit, node, button, module, field, explain, select, today, order: newest, recipeOn, passed, records, openRecord,
      startCalibration: (point, selection) => editCalibration(point, selection)
    });

    function editCalibration(point, selection) {
      const { cards, suppliers, equipment } = snapshot(read);
      const published = cards.filter(card => card.versions.length);
      const deviceOptions = point.deviceIds.map(id => equipment.devices.find(item => item.id === id)).filter(Boolean);
      edit('Калибровка · ' + point.name, raw([storageKey, networkKey, cardsKey, equipmentKey, supplyKey, ...(menu ? [menu.changeKey] : [])]), records(), form => {
        const day = field(form, 'Дата проверки', 'date', today(), 'По этой дате подбирается действовавшая редакция техкарты.', 'date', true);
        day.max = today();
        const author = field(form, 'Кто проверил', 'author', '', 'Имя сотрудника, который выполнил калибровку.', 'text', true);
        const cardChoice = select(form, 'Техкарта', [], 'Выбери напиток из справочника сети. Калибровка доступна для кофе и софт-позиций.');
        const portionChoice = select(form, 'Порция', [], 'Порция определяет набор требований и допустимые значения.');
        const device = select(form, 'Оборудование', [['', 'Без привязки'], ...deviceOptions.map(item => [item.id, item.model])],
          'Если проверка зависит от техники, выбери карточку оборудования этой точки.');
        const batch = field(form, 'Партия сырья', 'batch', '', 'Внеси номер с маркировки или точное описание. Если партия не влияет на проверку, укажи причину.', 'text', true);
        const approvedLots = suppliers.samples.filter(item => item.kind === 'lot' && window.panel03Backup.approvedLot(item.attempts.at(-1)))
          .map(item => [JSON.stringify([item.id, item.attempts.at(-1).id]), item.lot || 'Партия без номера']);
        const lot = select(form, 'Связать с принятой партией', [['', 'Без привязки'], ...approvedLots],
          'Выбери совпадающую партию из журнала поставщиков. Запись сохранит конкретный результат приёмки.');
        const adjustment = field(form, 'Условия и настройка', 'adjustment', '', 'Укажи применённые настройки, исходные условия и что понадобится для повторения результата.', 'textarea', true);
        const readings = node('div', 'stack');
        form.append(readings);
        const actionFor = actionFields(form);
        let getChecks = [];
        let version;
        let portionIndex;
        let change;
        let acknowledged;

        function changePortion() {
          portionIndex = portionChoice.value === '' ? -1 : Number(portionChoice.value);
          const portion = version?.portions[portionIndex];
          readings.replaceChildren();
          getChecks = [];
          change = undefined;
          acknowledged = undefined;
          if (!portion) return;
          change = menu?.changeFor(point.id, cardChoice.value, portion.name, day.value);
          if (change) {
            const confirmation = node('label', 'check');
            acknowledged = node('input');
            acknowledged.type = 'checkbox';
            confirmedChange(readings, confirmation, acknowledged, change);
          }
          readings.append(node('p', 'quiet', 'Редакция ' + version.number + ' действует с ' + version.effective));
          if (!portion.criteria.length) readings.append(node('p', '', 'Добавь критерии в техкарту и опубликуй редакцию для этой порции.'));
          getChecks = portion.criteria.map(({ name, rule, method }) => {
            const expectation = rule.type === 'numeric' ? 'Панель оценит замер по диапазону техкарты.' : rule.expected;
            return checkField(readings, name, [expectation, method && 'Метод: ' + method].filter(Boolean).join(' '), rule);
          });
        }

        function confirmedChange(container, label, control, entry) {
          label.append(control, node('span', '', 'Проверка проведена после изменения'));
          container.append(node('p', '', entry.date + ' · ' + entry.note), label);
          explain(container, 'Отметь только если напиток приготовлен с учётом указанного сырья, техники или настройки.');
        }

        function changeCard(wanted = '') {
          const card = published.find(item => item.id === cardChoice.value);
          version = card && recipeOn(card, day.value);
          const selected = wanted && version?.portions.findIndex(item => menu?.portionKey(item.name) === wanted);
          setOptions(portionChoice, [['', 'Выбери порцию'], ...(version?.portions.map((item, index) => [String(index), item.name]) || [])], selected >= 0 && wanted ? String(selected) : '');
          changePortion();
        }

        function changeDay(initial = false) {
          const keep = initial ? selection?.cardId : cardChoice.value;
          const wanted = initial ? selection?.portionKey : version?.portions[portionIndex]?.name;
          const key = initial ? wanted : wanted && menu?.portionKey(wanted);
          const available = published.flatMap(card => {
            const version = recipeOn(card, day.value);
            return version ? [[card.id, version.title]] : [];
          });
          setOptions(cardChoice, [['', 'Выбери техкарту'], ...available], available.some(([id]) => id === keep) ? keep : '');
          changeCard(key);
        }

        day.addEventListener('change', () => changeDay());
        cardChoice.addEventListener('change', () => changeCard());
        portionChoice.addEventListener('change', changePortion);
        changeDay(true);
        return list => {
          if (!getChecks.length) throw Error('Выбери порцию с критериями в действовавшей техкарте.');
          if (change && !acknowledged.checked) throw Error('Подтверди, что проверка выполнена после отмеченного изменения.');
          if (!batch.value.trim() || !adjustment.value.trim()) throw Error('Заполни происхождение сырья и условия калибровки.');
          const [sampleId, attemptId] = lot.value ? JSON.parse(lot.value) : ['', ''];
          const sample = suppliers.samples.find(item => item.id === sampleId);
          if (sample && sample.attempts.find(item => item.id === attemptId)?.date > day.value) throw Error('Приёмка партии датирована позже калибровки.');
          const checks = getChecks.map(check => check());
          return [...list, {
            ...base(point, day.value, author.value, checks, actionFor(checks, day.value)), type: 'calibration',
            cardId: cardChoice.value, version: version.number, portion: portionIndex, deviceId: device.value || '',
            batch: batch.value.trim(), sampleId, attemptId, adjustment: adjustment.value.trim(),
            ...(change ? { changeId: change.id } : {})
          }];
        };
      }, persist);
    }

    function editAction(id, close) {
      const entries = records();
      const record = entries.find(item => item.id === id);
      if (!record?.action || record.action.closed) throw Error('Действие уже недоступно.');
      edit(close ? 'Результат действия' : 'Новый срок', raw([storageKey]), entries, form => {
        const day = field(form, close ? 'Дата перепроверки' : 'Новый срок', 'date', close ? today() : record.action.due,
          'Дата будет отражена в исходной записи.', 'date', true);
        day.min = record.date;
        if (close) day.max = today();
        const evidence = close && field(form, 'Что подтвердило результат', 'result', '', 'Укажи факт и кем он перепроверен. Для обновления готовности запиши новую проверку.', 'textarea', true);
        return list => {
          if (!day.value || day.value < record.date || (close && (day.value > today() || !evidence.value.trim()))) {
            throw Error('Проверь дату и заполни подтверждение результата.');
          }
          const action = close ? { ...record.action, closed: { date: day.value, result: evidence.value.trim() } } : { ...record.action, due: day.value };
          return list.map(item => item.id === id ? { ...item, action } : item);
        };
      }, persist);
    }

    function calibrationLabel(record, cards) {
      const version = cards.find(item => item.id === record.cardId)?.versions.find(item => item.number === record.version);
      return (version?.title || 'Техкарта') + ' · ' + (version?.portions[record.portion]?.name || 'Порция') + ' · ред. ' + record.version;
    }

    function title(record, cards) {
      return record.type === 'shift' ? phases[record.phase] : calibrationLabel(record, cards);
    }

    function recordCard(record, sources, focus) {
      const detail = node('details', 'module stack');
      detail.dataset.barRecord = record.id;
      detail.open = focus === record.id;
      const label = title(record, sources.cards);
      detail.append(node('summary', '', record.date + ' · ' + label + ' · ' + status(record)), node('p', 'quiet', 'Проверил: ' + record.author));
      if (record.type === 'calibration') {
        const sample = sources.suppliers.samples.find(item => item.id === record.sampleId);
        const device = sources.equipment.devices.find(item => item.id === record.deviceId);
        const card = sources.cards.find(item => item.id === record.cardId);
        if (card && recipeOn(card, today())?.number !== record.version) detail.append(node('p', 'quiet', 'Для текущей редакции нужна отдельная проверка.'));
        const recipeLink = node('a', 'action', 'Открыть техкарты');
        recipeLink.href = '#techcards';
        detail.append(recipeLink, node('p', '', 'Партия: ' + record.batch + (sample?.lot ? ' · Приёмка ' + sample.lot : '')),
          node('p', '', 'Условия: ' + record.adjustment));
        if (device) detail.append(node('p', '', 'Оборудование: ' + device.model));
        record.checks.forEach(check => {
          const { rule } = check;
          const range = rule?.type === 'numeric' ? ' · Норма ' + rule.min + '–' + rule.max + ' ' + rule.unit : '';
          detail.append(node('p', '', check.name + ' · ' + outcomes[check.outcome] +
            (check.amount === null ? '' : ' · ' + check.amount + ' ' + (rule?.unit || '')) + range + (check.note ? ' · ' + check.note : '')));
          if (rule?.type === 'observable') explain(detail, rule.expected);
        });
      } else {
        for (const check of record.checks) detail.append(node('p', '', check.name + ' · ' + outcomes[check.outcome] + ' · ' + check.note));
      }
      if (record.action) {
        const action = record.action;
        detail.append(node('p', '', action.title + ' · ' + action.owner + ' · ' + action.due));
        if (action.closed) detail.append(node('p', '', 'Перепроверено ' + action.closed.date + ' · ' + action.closed.result));
        else detail.append(button('Перенести срок', () => editAction(record.id, false)), button('Записать результат действия', () => editAction(record.id, true)));
      }
      return detail;
    }

    function pointSection(point, focus, menuReport, shift) {
      const sources = snapshot(read);
      const entries = newest(records().filter(item => item.pointId === point.id));
      const shiftsCard = module('Сменные проверки');
      explain(shiftsCard, 'Готовность к работе берётся из последней проверки открытия сегодня. Закрытие оценивается отдельно. Пропуск пункта и отклонение требуют повторной проверки.');
      const sourcesLinks = node('div', 'quality-actions');
      for (const [href, label] of [['#equipment', 'Техника и вода'], ['#suppliers', 'Сырьё и поставщики'], ['#stock', 'Списания']]) {
        const link = node('a', 'action', label);
        link.href = href;
        sourcesLinks.append(link);
      }
      shiftsCard.append(sourcesLinks);
      for (const [phase, label] of Object.entries(phases)) {
        const row = entries.find(item => item.type === 'shift' && item.phase === phase && item.date === today());
        shiftsCard.append(node('p', '', label + ' сегодня · ' + status(row)), button('Записать ' + label.toLowerCase(), () => editShift(point, phase)));
      }
      if (shift) {
        const message = shift.closing ? 'Последнее обязательное закрытие · ' + shift.closing.date + ' · ' + status(shift.closing) :
          'Последнее обязательное закрытие · Нет проверки';
        shiftsCard.append(node('p', 'quiet', message));
      }
      const calibration = module('Калибровки напитков');
      explain(calibration, 'Выбери техкарту и порцию, запиши условия, партию и фактические результаты. Результат относится к этой точке, порции и редакции техкарты.');
      if (menuReport) calibration.append(menu.pointSection(menuReport, focus));
      calibration.append(button('Записать калибровку', () => editCalibration(point), true));
      const history = module('История смен и калибровок');
      if (!entries.length) history.append(node('p', 'quiet', 'Проверок пока нет.'));
      const visible = entries.slice(0, 10);
      for (const record of visible) history.append(recordCard(record, sources, focus));
      if (entries.length > visible.length) {
        const older = node('details', 'module stack');
        const remaining = entries.slice(visible.length);
        older.append(node('summary', '', 'Более ранние записи · ' + remaining.length));
        older.open = remaining.some(item => item.id === focus);
        function loadOlder() {
          if (older.open && older.children.length === 1) {
            older.append(...remaining.map(record => recordCard(record, sources, focus)));
          }
        }
        older.addEventListener('toggle', loadOlder);
        loadOlder();
        history.append(older);
      }
      const section = node('div', 'stack');
      section.append(shiftsCard, calibration, history);
      return section;
    }

    function shiftProgress(points) {
      const day = today();
      const shifts = newest(records().filter(item => item.type === 'shift' && item.date <= day));
      return new Map(points.map(point => {
        const entries = shifts.filter(item => item.pointId === point.id);
        const opening = entries.find(item => item.phase === 'opening' && item.date === day);
        const lastDay = entries.find(item => item.date < day)?.date;
        const closing = entries.find(item => item.phase === 'closing' && (item.date === day || item.date === lastDay));
        return [point.id, { opening, closing, ready: Boolean(opening && closing && passed(opening) && passed(closing)) }];
      }));
    }

    function deadlines() {
      const { network, cards } = snapshot(read);
      return records().filter(record => record.action && !record.action.closed).map(record => {
        const point = network.points.find(item => item.id === record.pointId);
        if (!point) throw Error('Не найдена точка для записи бара.');
        return {
          key: JSON.stringify(['bar', record.id]), section: 'bar', point: point.name, owner: record.action.owner,
          date: record.action.due, title: title(record, cards), detail: record.action.title,
          open: () => openRecord(point.id, record.id), schedule: () => editAction(record.id, false), separateEditor: true
        };
      });
    }

    return { pointSection, shiftProgress, status, passed, deadlines, menu };
  };
})();
