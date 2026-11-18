(() => {
  'use strict';

  const planKey = 'panel-03:menu-plans';
  const changeKey = 'panel-03:menu-changes';
  const cardKey = 'panel-03:techcards';
  const pointKey = 'panel-03:network';
  const portionKey = name => name.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
  const scopeKey = item => JSON.stringify([item.cardId, item.portionKey]);
  const causes = { supplies: 'Изменилось сырьё или партия', equipment: 'Изменилась техника или настройка' };

  function addDays(day, days) {
    const next = new Date(day + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  function latestBy(entries, keyOf) {
    const result = new Map();
    for (const entry of entries) {
      const key = keyOf(entry);
      const current = result.get(key);
      if (!current || entry.date > current.date ||
          (entry.date === current.date && (entry.createdAt > current.createdAt ||
            (entry.createdAt === current.createdAt && entry.id > current.id)))) result.set(key, entry);
    }
    return result;
  }

  window.panel03BarMenu = ({ read, edit, node, button, module, field, explain, select, today, order, recipeOn, passed, records, openRecord, startCalibration }) => {
    function sources() {
      return {
        plans: read(planKey, []), changes: read(changeKey, []), cards: read(cardKey, []),
        network: read(pointKey, { points: [] }), attempts: order(records().filter(record => record.type === 'calibration'))
      };
    }

    function planEditor(point) {
      const day = today();
      const source = sources();
      const pointId = point?.id || '';
      const plans = latestBy(source.plans.filter(item => item.date <= day), item => item.pointId);
      const previous = plans.get(pointId);
      const options = new Map();
      for (const card of source.cards) {
        const version = recipeOn(card, day);
        if (!version) continue;
        for (const portion of version.portions) {
          const row = { cardId: card.id, portionKey: portionKey(portion.name) };
          options.set(scopeKey(row), version.title + ' · ' + portion.name);
        }
      }
      function retainUnavailable(row) {
        const key = scopeKey(row);
        const card = source.cards.find(item => item.id === row.cardId);
        const original = card?.versions.find(version => version.number === row.version);
        const name = original?.portions.find(portion => portionKey(portion.name) === row.portionKey)?.name || row.portionKey;
        if (!options.has(key)) options.set(key, (original?.title || 'Техкарта') + ' · ' + name + ' · связь требует проверки');
      }
      for (const row of previous?.rows || []) retainUnavailable(row);
      if (point) for (const row of plans.get('')?.rows || []) retainUnavailable(row);
      const raw = snapshot([planKey, cardKey, pointKey]);
      edit(point ? 'Меню · ' + point.name : 'Общее меню сети', raw, source.plans, form => {
        explain(form, point
          ? 'Оставь список пустым, чтобы подтвердить общее меню без изменений. Для общих позиций можно выбрать исключение или установить свой график.'
          : 'Включи все общие позиции, в том числе софт. Каждая порция добавляется отдельно. Новая техкарта не попадает в меню без явного выбора.');
        if (!options.size) {
          const link = node('a', 'action', 'Открыть техкарты');
          link.href = '#techcards';
          link.addEventListener('click', () => form.closest('dialog').close());
          form.append(node('p', 'quiet', 'Сначала опубликуй техкарту с порциями.'), link);
        }
        const rows = [];
        const list = node('div', 'stack');
        form.append(list);
        function addRow(initial = null) {
          const box = module(point ? 'Правило точки' : 'Позиция общего меню');
          const selection = select(box, 'Напиток и порция', [['', 'Выбери порцию'], ...options],
            'Связь сохраняется по техкарте и названию порции. При переименовании или удалении порции сверь меню.', initial ? scopeKey(initial) : '');
          const mode = point ? select(box, 'Применение на точке', [
            ['include', 'Включить или заменить общий график'], ['exclude', 'Исключить из меню точки']
          ], 'Убирай только позицию, которую на точке действительно не готовят.', initial?.mode || 'include') : null;
          const frequency = select(box, 'Когда проверять', [['opening', 'При каждом открытии'], ['periodic', 'По графику']],
            'Для эспрессо используй проверку при открытии. Для остальных позиций задай интервал в днях.', initial?.interval === 0 ? 'opening' : 'periodic');
          const days = field(box, 'Интервал в днях', 'interval', String(initial?.interval || 7),
            'Стартовый интервал — 7 дней. Задай от 1 до 365 дней с учётом продукта и процесса.', 'number');
          days.min = '1';
          days.max = '365';
          days.step = '1';
          function update() {
            const excluded = mode?.value === 'exclude';
            frequency.parentElement.hidden = excluded;
            days.closest('.stack').hidden = excluded || frequency.value === 'opening';
            days.disabled = days.closest('.stack').hidden;
          }
          mode?.addEventListener('change', update);
          frequency.addEventListener('change', update);
          update();
          const collect = () => {
            if (!selection.value) throw Error('Выбери техкарту и порцию в каждой строке меню.');
            const [cardId, name] = JSON.parse(selection.value);
            const state = mode?.value || 'include';
            const interval = state === 'exclude' || frequency.value === 'opening' ? 0 : Number(days.value);
            if (state === 'include' && frequency.value === 'periodic' && (!Number.isInteger(interval) || interval < 1 || interval > 365)) {
              throw Error('Укажи целый интервал от 1 до 365 дней.');
            }
            const card = source.cards.find(item => item.id === cardId);
            const active = card && recipeOn(card, day);
            const current = active?.portions.some(portion => portionKey(portion.name) === name);
            const retained = previous?.rows.find(row => row.cardId === cardId && row.portionKey === name);
            const inherited = plans.get('')?.rows.find(row => row.cardId === cardId && row.portionKey === name);
            const version = current ? active.number : retained?.version || inherited?.version;
            if (!version) throw Error('Для позиции нет опубликованной техкарты с выбранной порцией.');
            const since = retained?.mode === state && retained.interval === interval ? retained.since : day;
            return { cardId, portionKey: name, version, mode: state, interval, since };
          };
          box.append(button('Убрать строку', () => {
            rows.splice(rows.indexOf(collect), 1);
            box.remove();
          }));
          rows.push(collect);
          list.append(box);
        }
        for (const row of previous?.rows || []) addRow(row);
        if (options.size) form.append(button('Добавить порцию', () => addRow()));
        return existing => {
          const selected = rows.map(row => row());
          if (new Set(selected.map(scopeKey)).size !== selected.length) throw Error('Для каждой порции оставь одно правило.');
          return [...existing, { id: crypto.randomUUID(), pointId, date: day, createdAt: new Date().toISOString(), rows: selected }];
        };
      }, persist(planKey));
    }

    function snapshot(keys) {
      return new Map(keys.map(key => [key, localStorage.getItem(key)]));
    }

    function persist(key) {
      return (expected, next) => {
        for (const [source, value] of expected) {
          if (localStorage.getItem(source) !== value) throw Error('Данные меню изменились. Открой форму заново.');
        }
        const data = Object.fromEntries([planKey, changeKey, cardKey, pointKey].flatMap(source => {
          const raw = localStorage.getItem(source);
          return raw === null ? [] : [[source, JSON.parse(raw)]];
        }));
        window.panel03Backup.validate({ ...data, [key]: next });
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new Event('panel-03:work-changed'));
      };
    }

    function editChange(point, item) {
      const source = sources();
      const expected = snapshot([changeKey, planKey, cardKey, pointKey]);
      const key = scopeKey(item);
      edit('Основание для перепроверки', expected, source.changes, form => {
        form.append(node('p', '', point.name + ' · ' + item.label));
        const reason = select(form, 'Что изменилось', [['', 'Выбери причину'], ...Object.entries(causes)],
          'Отмечай существенные изменения для этой порции. При новой редакции техкарты перепроверка появится автоматически.');
        const note = field(form, 'Что применили на точке', 'change-note', '', 'Укажи партию, сырьё, прибор, настройку или работу из журнала и опиши существенное изменение.', 'textarea', true);
        return existing => {
          if (!reason.value || !note.value.trim()) throw Error('Укажи причину и опиши изменение.');
          const day = today();
          const current = pointStatus(point, day, sources()).items.find(row => scopeKey(row) === key && row.portion >= 0);
          if (!current) throw Error('Порция больше не доступна для этой точки. Сверь меню.');
          return [...existing, { id: crypto.randomUUID(), pointId: point.id, date: day, createdAt: new Date().toISOString(),
            cardId: current.cardId, portionKey: current.portionKey, version: current.activeVersion, cause: reason.value, note: note.value.trim() }];
        };
      }, persist(changeKey));
    }

    function pointStatus(point, day, source, prepared = prepare(day, source)) {
      const { common, plans, changes, attempts } = prepared;
      const local = plans.get(point.id);
      const effective = new Map((common?.rows || []).map(row => [scopeKey(row), row]));
      for (const row of local?.rows || []) {
        const key = scopeKey(row);
        if (row.mode === 'exclude') effective.delete(key);
        else effective.set(key, row);
      }
      const items = [...effective.values()].map(row => {
        const card = source.cards.find(item => item.id === row.cardId);
        const version = card && recipeOn(card, day);
        const portion = version?.portions.findIndex(item => portionKey(item.name) === row.portionKey) ?? -1;
        const old = card?.versions.find(item => item.number === row.version);
        const label = (version?.title || old?.title || 'Техкарта') + ' · ' +
          (version?.portions[portion]?.name || old?.portions.find(item => portionKey(item.name) === row.portionKey)?.name || row.portionKey);
        const identity = scopeKey(row);
        const change = changes.get(JSON.stringify([point.id, identity]));
        const latest = attempts.get(JSON.stringify([point.id, row.cardId, version?.number, portion]));
        const attempt = latest && (!change || latest.changeId === change.id) ? latest : undefined;
        const blocked = portion < 0 || !version?.portions[portion].criteria.length;
        const baseline = [row.since, version?.effective || '', change?.date || ''].sort().at(-1);
        let due = baseline;
        let reason = 'Первая проверка по программе';
        let ready = false;
        if (version && version.number !== row.version && (!change || version.effective >= change.date)) reason = 'Нужна проверка действующей редакции';
        else if (change) reason = causes[change.cause];
        if (blocked) reason = portion < 0 ? 'Нужно сверить связь с порцией' : 'У порции нет критериев проверки';
        else if (attempt && passed(attempt)) {
          due = addDays(attempt.date, row.interval || 1);
          reason = row.interval ? 'Проверка по графику' : 'Проверка при открытии';
          ready = day < due;
        } else if (attempt) {
          due = attempt.action?.closed ? day : attempt.action?.due || attempt.date;
          reason = 'Нужна повторная калибровка';
        } else if (row.interval === 0) {
          due = day;
        }
        return { ...row, portion, label, identity, activeVersion: version?.number, change, attempt, blocked, due, reason, ready };
      });
      return { point, configured: Boolean(common && local), items, ready: Boolean(common && local && items.length && items.every(item => item.ready)) };
    }

    function prepare(day, source) {
      const plans = latestBy(source.plans.filter(item => item.date <= day), item => item.pointId);
      const changes = latestBy(source.changes.filter(item => item.date <= day), item => JSON.stringify([item.pointId, scopeKey(item)]));
      const attempts = new Map();
      for (const attempt of source.attempts) {
        if (attempt.date > day) continue;
        const key = JSON.stringify([attempt.pointId, attempt.cardId, attempt.version, attempt.portion]);
        if (!attempts.has(key)) attempts.set(key, attempt);
      }
      return { common: plans.get(''), plans, changes, attempts };
    }

    function report(points) {
      const day = today();
      const source = sources();
      const prepared = prepare(day, source);
      return points.map(point => pointStatus(point, day, source, prepared));
    }

    function changeFor(pointId, cardId, name, day) {
      const history = read(changeKey, []);
      return latestBy(history.filter(item => item.date <= day && item.pointId === pointId && item.cardId === cardId && item.portionKey === portionKey(name)),
        () => '').get('');
    }

    function networkSection(reports) {
      const card = module('Меню и график калибровок');
      explain(card, 'Общее меню наследуют все точки. Каждая карточка точки задаёт локальные дополнения и исключения. Сменные проверки и калибровки подтверждаются отдельно.');
      card.append(button('Настроить общее меню сети', () => planEditor(null)));
      if (reports.length) {
        const items = reports.flatMap(item => item.items);
        const ready = items.filter(item => item.ready).length;
        const confirmed = reports.filter(item => item.configured).length;
        card.append(node('p', '', 'Актуальные проверки: ' + ready + ' из ' + items.length + ' известных порций по точкам.'),
          node('p', 'quiet', 'Состав меню подтверждён на ' + confirmed + ' из ' + reports.length + ' точек.'));
      }
      return card;
    }

    function recordId(row) {
      return 'menu:' + row.identity;
    }

    function pointSection(report, focus) {
      const card = module('Меню точки и калибровки');
      card.append(button('Настроить меню точки', () => planEditor(report.point)));
      explain(card, 'Числитель — порции с актуальной успешной проверкой. Знаменатель — все порции действующего меню точки с учётом исключений. Просроченная проверка, отклонение или потерянная связь оставляют порцию в знаменателе.');
      if (!report.configured) card.append(node('p', 'quiet', 'Подтверди общее меню и правила точки для расчёта готовности.'));
      if (!report.items.length) card.append(node('p', 'quiet', 'В применимом меню пока нет порций.'));
      else card.append(node('p', '', 'Подтверждено ' + report.items.filter(item => item.ready).length + ' из ' + report.items.length + ' порций.'));
      for (const item of report.items) {
        const row = node('details', 'module stack');
        row.dataset.barRecord = recordId(item);
        row.open = focus === recordId(item);
        row.append(node('summary', '', item.label + ' · ' + (item.ready ? 'Подтверждено' : item.reason)),
          node('p', 'quiet', item.interval === 0 ? 'При открытии' : 'Интервал: ' + item.interval + ' дн.'));
        if (!item.blocked) row.append(node('p', 'quiet', (item.ready ? 'Следующая проверка' : 'Срок проверки') + ' · ' + item.due));
        if (item.change) row.append(node('p', '', item.change.date + ' · ' + causes[item.change.cause] + ' · ' + item.change.note));
        if (item.attempt) row.append(button('Открыть результат · ' + item.attempt.date, () => openRecord(report.point.id, item.attempt.id)));
        if (!item.blocked) row.append(button('Записать проверку порции', () => startCalibration(report.point, item), true),
          button('Отметить изменение', () => editChange(report.point, item)));
        card.append(row);
      }
      return card;
    }

    function deadlines() {
      const { points } = read(pointKey, { points: [] });
      return report(points).filter(item => item.configured).flatMap(({ point, items }) => items
        .filter(item => !item.blocked && !(item.attempt?.action && !item.attempt.action.closed))
        .map(item => ({
          key: JSON.stringify(['menu-check', point.id, item.cardId, item.portionKey]),
          section: 'menu-check', point: point.name, owner: '', date: item.due,
          title: 'Калибровка · ' + item.label, detail: item.reason,
          open: () => openRecord(point.id, recordId(item))
        })));
    }

    return { planEditor, networkSection, pointSection, report, deadlines, changeFor, portionKey, changeKey };
  };
})();
