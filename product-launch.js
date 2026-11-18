(() => {
  'use strict';

  const key = 'panel-03:launches';
  const dataKeys = [key, 'panel-03:network', 'panel-03:techcards', 'panel-03:bar-operations', 'panel-03:menu-plans',
    'panel-03:menu-changes', 'panel-03:training', 'panel-03:training-plans', 'panel-03:economy',
    'panel-03:financial-review', 'panel-03:sales', 'panel-03:suppliers', 'panel-03:point-operations', 'panel-03:equipment'];
  const decisionNames = { launch: 'Запуск', revise: 'Доработка', stop: 'Остановка' };
  const empty = () => ({ settings: [], projects: [] });
  const sum = values => values.reduce((a, b) => a + b, 0);

  function plusDays(day, days) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  window.panel03ProductLaunch = ({
    el, heading, line, field, value, requireText, action, showEditor, setActive, dateKey, dateIsValid, formatDate, normalized,
    readCatalog, historicalVersion, readSuppliers, readEconomy, readSales, estimateIngredient, costForSale, cents, money, percentFormat
  }) => {
    let focus = '';

    function get(name, fallback) {
      const raw = localStorage.getItem(name);
      return raw === null ? fallback : JSON.parse(raw);
    }

    function read() {
      return get(key, empty());
    }

    function points() {
      return get('panel-03:network', { points: [] }).points;
    }

    function context() {
      return { points: points(), cards: readCatalog().cards, economy: readEconomy(), suppliers: readSuppliers().data,
        checks: get('panel-03:bar-operations', []), sales: readSales().rows };
    }

    function capture() {
      return new Map(dataKeys.map(name => [name, localStorage.getItem(name)]));
    }

    function save(expected, ledger, id) {
      for (const [name, raw] of expected) if (localStorage.getItem(name) !== raw) {
        throw Error('Исходные сведения изменились. Открой форму и сверь данные заново.');
      }
      if (window.panel03Backup) {
        window.panel03Backup.validate({ ...window.panel03Backup.snapshot(localStorage), [key]: ledger });
      }
      localStorage.setItem(key, JSON.stringify(ledger));
      focus = id;
      return id;
    }

    function editProject(id, title, draw, submit, tip) {
      const expected = capture();
      const ledger = read();
      const project = ledger.projects.find(item => item.id === id);
      if (!project) throw Error('Карточка изменения недоступна.');
      const source = context();
      showEditor(title, body => {
        const collect = draw(body, project, source);
        return () => {
          const next = collect();
          return save(expected, { ...ledger, projects: ledger.projects.map(item => item.id === id ? next : item) }, id);
        };
      }, submit, tip);
    }

    function number(input, min, max, whole = false) {
      const result = input.control.valueAsNumber;
      if (!Number.isFinite(result) || result < min || result > max || (whole && !Number.isSafeInteger(result))) {
        throw Error('Проверь числовое поле «' + input.wrapper.querySelector('label').textContent + '».');
      }
      return result;
    }

    function flag(label, help, selected = false) {
      return field(label, help, { choices: { no: 'Нет', yes: 'Да' }, value: selected ? 'yes' : 'no' });
    }

    function portionFor(project, source, day) {
      const card = source.cards.find(item => item.id === project.cardId);
      const current = card && historicalVersion(card, day);
      const version = card?.versions.find(item => item.number === project.version);
      return { card, current, version, portion: version?.portions[project.portion] };
    }

    function labelFor(project, source) {
      const { version, portion } = portionFor(project, source, dateKey());
      return version?.title + ' · ' + portion?.name + ' · версия ' + project.version;
    }

    function qualityEvidence(project, point, source, from, to, recordedAfter = '') {
      const { portion } = portionFor(project, source, to);
      const changes = get('panel-03:menu-changes', []).filter(row => row.pointId === point.id && row.cardId === project.cardId &&
        row.portionKey === normalized(portion?.name || '') && row.date <= to);
      const change = changes.toSorted((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
      const attempts = source.checks.filter(row => row.type === 'calibration' && row.pointId === point.id && row.cardId === project.cardId &&
        row.version === project.version && row.portion === project.portion && row.date >= from && row.date <= to &&
        (row.date > from || row.createdAt >= recordedAfter) &&
        (!change || row.changeId === change.id) && (!row.deviceId || point.deviceIds.includes(row.deviceId)))
        .toSorted((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      const passed = row => row?.checks.length && row.checks.every(check => check.outcome === 'pass');
      return passed(attempts[0]) ? attempts.filter(passed) : [];
    }

    function prerequisites(project, point, source, day) {
      const { card, current, version, portion } = portionFor(project, source, day);
      const team = window.panel03TeamReadinessReport?.([point])[0];
      const operations = window.panel03OperationsProgress?.().find(row => row.point.id === point.id);
      const bar = window.panel03BarReadinessFor?.(point);
      const checks = qualityEvidence(project, point, source, version?.effective || day, day);
      const active = Boolean(version && current?.number === version.number && portion?.criteria.length);
      const costs = active ? portion.ingredients.map(item => estimateIngredient(source.economy, card.id, portion.name, item, day, point.name)) : [];
      const supplies = [...new Set(costs.map(item => item.supply).filter(item => item?.kind === 'ingredient').map(item => item.id))];
      const cost = costs.length && costs.every(item => item.cost !== null && item.supply?.kind) ?
        sum(costs.map(item => item.cost)) : null;
      const gaps = [];
      if (!active) gaps.push('Нужна действующая версия техкарты с критериями');
      if (!checks.length) gaps.push('Нет успешной калибровки этой порции на точке');
      if (!team?.ready) gaps.push('Не подтверждены навыки и допуски команды');
      if (!bar?.ready) gaps.push('Не подтверждены актуальные сменные проверки точки');
      if (!operations || operations.limited || operations.overdue) gaps.push('Проверь ограничения и просроченные случаи точки');
      if (cost === null || !Number.isSafeInteger(cost)) gaps.push('Не подтверждены связи с сырьём, типы или закупочные цены');
      return { gaps, supplies, cost, calibrationId: checks.toSorted((a, b) => b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt))[0]?.id || '' };
    }

    function lotsFor(source, supplyId, day) {
      return source.suppliers.samples.flatMap(sample => {
        if (sample.supply !== supplyId || sample.kind !== 'lot') return [];
        const attempt = sample.attempts.findLast(item => item.date <= day);
        return attempt?.decision === 'approved' ? [{ sample, attempt }] : [];
      });
    }

    function lotsStillApproved(snapshot, source, day) {
      return snapshot.lots.every(row => {
        const sample = source.suppliers.samples.find(item => item.id === row.sampleId);
        return sample && lotsFor(source, sample.supply, day).some(item => item.sample.id === row.sampleId);
      });
    }

    function showBasis(body, basis, source) {
      line(body, 'Себестоимость на момент подтверждения:', money(basis.cost));
      const check = source.checks.find(item => item.id === basis.calibrationId);
      if (check) line(body, 'Исходная калибровка:', formatDate(check.date) + ' · ' + check.author);
      for (const row of basis.lots) {
        const sample = source.suppliers.samples.find(item => item.id === row.sampleId);
        const item = source.economy.data.supplies.find(supply => supply.id === sample?.supply);
        if (sample && item) line(body, 'Принятая партия · ' + item.name, sample.lot || 'Партия из журнала');
      }
    }

    function readinessFields(body, basis, project, source, day) {
      for (const gap of basis.gaps) line(body, 'Требуется:', gap);
      if (basis.cost !== null) line(body, 'Нормативная себестоимость / плановая цена:', money(basis.cost) + ' / ' + money(project.retail));
      const lots = basis.supplies.map(id => {
        const supply = source.economy.data.supplies.find(item => item.id === id);
        const candidates = lotsFor(source, id, day);
        const item = field('Партия · ' + supply.name, 'Выбери одобренную партию, наличие которой подтвердили на точке.', {
          choices: { '': 'Укажи одобренную партию', ...Object.fromEntries(candidates.map(({ sample, attempt }) =>
            [sample.id, (sample.lot || 'Партия') + ' · ' + formatDate(attempt.date)])) }
        });
        if (!candidates.length) line(body, 'Требуется:', 'Принять партию для позиции «' + supply.name + '»');
        body.append(item.wrapper);
        return { item, candidates };
      });
      return () => {
        if (basis.gaps.length) throw Error('Сначала подтверди недостающие сведения в связанных разделах.');
        return { cost: basis.cost, calibrationId: basis.calibrationId, lots: lots.map(({ item, candidates }) => {
          const selected = candidates.find(entry => entry.sample.id === value(item));
          if (!selected) throw Error('Подтверди принятые партии на этой точке.');
          return { sampleId: selected.sample.id, attemptId: selected.attempt.id };
        }) };
      };
    }

    function setPilotPoint() {
      const expected = capture();
      const source = points();
      const ledger = read();
      showEditor('Предпочтительная точка пилота', body => {
        const selected = field('Точка первого пилота', 'Подставляется в новую карточку. Один пилот проводится на одной точке.', {
          choices: { '': 'Выбери точку', ...Object.fromEntries(source.map(point => [point.id, point.name])) },
          value: ledger.settings.find(item => item.id === 'pilot')?.pointId || ''
        });
        body.append(selected.wrapper);
        return () => {
          const pointId = requireText(selected);
          if (!source.some(item => item.id === pointId)) throw Error('Выбери точку из карты сети.');
          return save(expected, { ...ledger, settings: [{ id: 'pilot', pointId }] }, 'pilot');
        };
      }, 'Сохранить точку', 'Сохраняет предпочтение для новых карточек.');
    }

    function editDraft(previous, copy = false) {
      const expected = capture();
      const ledger = read();
      const source = context();
      const day = dateKey();
      const cards = source.cards.filter(card => historicalVersion(card, day));
      if (!source.points.length || !cards.length) throw Error('Добавь точку и действующую техкарту для пилота.');
      if (previous?.start && !copy) throw Error('Критерии запущенного пилота зафиксированы.');
      showEditor(copy ? 'Доработка · новая карточка' : previous ? 'План пилота' : 'Новое изменение', body => {
        const title = field('Название изменения', 'Короткое название идеи, нового напитка или изменения процесса.', { value: previous?.title });
        const goal = field('Задача и ожидаемый эффект', 'Что проверяешь и для кого. Опиши, что должно улучшиться.', { multiline: true, value: previous?.goal });
        const owner = field('Ответственный за пилот', 'Кто готовит пилот, собирает результаты и предлагает решение.', { value: previous?.owner || 'Шеф-бариста' });
        const pointId = previous?.pointId || ledger.settings.find(item => item.id === 'pilot')?.pointId || '';
        const point = field('Пилотная точка', 'Пилот проводят на одной точке. Ввод на других оформляется после проверки эффекта первого запуска.', {
          choices: { '': 'Выбери точку', ...Object.fromEntries(source.points.map(item => [item.id, item.name])) }, value: pointId
        });
        const recipe = field('Действующая техкарта', 'Закрепляет версию рецепта на момент подготовки пилота. Новая версия потребует сверки плана.', {
          choices: Object.fromEntries(cards.map(card => [card.id, historicalVersion(card, day).title])),
          value: cards.some(card => card.id === previous?.cardId) ? previous.cardId : cards[0].id
        });
        const portionSlot = el('div', '', 'quality-fields');
        let portion;
        function choosePortion() {
          const card = cards.find(item => item.id === value(recipe));
          const version = historicalVersion(card, day);
          const old = previous?.cardId === card.id && card.versions.find(item => item.number === previous.version)?.portions[previous.portion];
          const index = old ? version.portions.findIndex(item => normalized(item.name) === normalized(old.name)) : 0;
          portion = field('Контрольная порция', 'Проверки, продажи, расчёт и ввод будут относиться к этой порции.', {
            choices: Object.fromEntries(version.portions.map((item, i) => [String(i), item.name])), value: String(Math.max(0, index))
          });
          portionSlot.replaceChildren(portion.wrapper);
        }
        recipe.control.addEventListener('change', choosePortion);
        choosePortion();
        const start = field('Плановая дата пилота', 'Когда начнут собирать данные на выбранной точке.', { type: 'date', value: !copy && previous?.plannedFrom || day });
        const end = field('Конец пилота', 'Последний день наблюдений включительно.', { type: 'date', value: !copy && previous?.plannedTo || plusDays(day, 6) });
        const price = field('Плановая цена порции, ₽', 'Для сравнения с нормативной себестоимостью. Изменение цены согласует руководитель.', { type: 'number', value: previous ? previous.retail / 100 : undefined });
        const priceChange = flag('Меняется цена', 'Согласование руководителя обязательно при изменении цены.', previous?.flags.price);
        const expenseChange = flag('Меняются расходы', 'Согласование руководителя обязательно при изменении расходов.', previous?.flags.expense);
        const supplierChange = flag('Меняется поставщик', 'При смене поставщика нужны решения руководителя и менеджера по закупкам.', previous?.flags.supplier);
        const goals = window.panel03FinancialTargets?.(value(point), value(start));
        const quality = field('Минимум успешных калибровок', 'Считаются фактические записи за период по выбранной точке, порции и версии.', { type: 'number', value: previous?.criteria.quality ?? 1 });
        const food = field('Предел фудкоста пилота, %', 'Первоначальное значение подставляется из утверждённых целей экономики при их наличии.',
          { type: 'number', value: previous ? previous.criteria.food * 100 : goals?.food === undefined ? undefined : goals.food * 100 });
        const margin = field('Минимум прямой маржинальности, %', 'Первоначальное значение подставляется из целей экономики. Учитываются сырьё и упаковка.',
          { type: 'number', value: previous ? previous.criteria.margin * 100 : goals?.margin === undefined ? undefined : goals.margin * 100 });
        const feedback = field('Минимум отзывов гостей', 'Количество собранных отзывов для итогового разбора.', { type: 'number', value: previous?.criteria.feedback ?? 1 });
        const negative = field('Максимум отрицательных отзывов, %', 'Доля отрицательных отзывов от всех собранных.', { type: 'number', value: previous ? previous.criteria.negative * 100 : undefined });
        const useGoals = action('Взять цели из экономики', 'Подставляет цели действующей недели для выбранной точки.', () => {
          const plan = window.panel03FinancialTargets?.(value(point), value(start));
          if (!plan) return;
          food.control.value = String(plan.food * 100);
          margin.control.value = String(plan.margin * 100);
        });
        body.append(title.wrapper, goal.wrapper, owner.wrapper, point.wrapper, recipe.wrapper, portionSlot, start.wrapper, end.wrapper,
          price.wrapper, priceChange.wrapper, expenseChange.wrapper, supplierChange.wrapper,
          quality.wrapper, food.wrapper, margin.wrapper, useGoals, feedback.wrapper, negative.wrapper);
        return () => {
          const plannedFrom = value(start);
          const plannedTo = value(end);
          const selected = source.points.find(item => item.id === value(point));
          if (!selected || !dateIsValid(plannedFrom) || !dateIsValid(plannedTo) || plannedTo < plannedFrom || plannedTo < dateKey()) {
            throw Error('Укажи одну точку и корректные даты пилота.');
          }
          const card = cards.find(item => item.id === value(recipe));
          const version = historicalVersion(card, dateKey());
          const portionIndex = Number(value(portion));
          if (!version.portions[portionIndex]?.criteria.length) throw Error('Для контрольной порции нужны критерии в техкарте.');
          const retail = cents(number(price, 0.01, 1e10));
          const stored = { id: previous && !copy ? previous.id : crypto.randomUUID(), parentId: copy ? previous.id : previous?.parentId || '',
            title: requireText(title), goal: requireText(goal), owner: requireText(owner), pointId: selected.id, cardId: card.id,
            version: version.number, portion: portionIndex, plannedFrom, plannedTo, retail,
            flags: { price: value(priceChange) === 'yes', expense: value(expenseChange) === 'yes', supplier: value(supplierChange) === 'yes' },
            criteria: { quality: number(quality, 1, 10000, true), food: number(food, 0, 100) / 100, margin: number(margin, 0, 100) / 100,
              feedback: number(feedback, 1, 100000, true), negative: number(negative, 0, 100) / 100 },
            start: null, decision: null, releases: [] };
          return save(expected, { ...ledger, projects: [...ledger.projects.filter(item => item.id !== stored.id), stored] }, stored.id);
        };
      }, 'Сохранить план пилота', 'Сохраняет точку, версию, условия и измеримые критерии.');
    }

    function approvals(body, project, label) {
      const leader = field(label, 'Укажи решение ответственного руководителя и где оно зафиксировано.', { multiline: true });
      const moneyApproval = (project.flags.price || project.flags.expense) &&
        field('Согласование цены и расходов', 'Укажи решение руководителя по изменяемым ценам и расходам.', { multiline: true });
      const supply = project.flags.supplier &&
        field('Согласование смены поставщика', 'Укажи согласование руководителя и менеджера по закупкам.', { multiline: true });
      body.append(leader.wrapper);
      if (moneyApproval) body.append(moneyApproval.wrapper);
      if (supply) body.append(supply.wrapper);
      return () => ({ leader: requireText(leader), finance: moneyApproval ? requireText(moneyApproval) : '', supply: supply ? requireText(supply) : '' });
    }

    function startPilot(id) {
      editProject(id, 'Подтвердить старт пилота', (body, project, source) => {
        if (project.start || project.decision) throw Error('Пилот уже изменился.');
        const day = dateKey();
        const point = source.points.find(item => item.id === project.pointId);
        const basis = prerequisites(project, point, source, day);
        line(body, 'Точка и стандарт:', point.name + ' · ' + labelFor(project, source));
        const readiness = readinessFields(body, basis, project, source, day);
        const signed = approvals(body, project, 'Кто согласовал пилот');
        return () => {
          if (day < project.plannedFrom || day > project.plannedTo) throw Error('Дата старта должна попасть в плановый период.');
          return { ...project, start: { date: day, recordedAt: new Date().toISOString(), ...readiness(), approvals: signed() } };
        };
      }, 'Записать старт пилота', 'Фиксирует реальные дату, критерии и подтверждённые исходные данные одной точки.');
    }

    function facts(project, point, source, from, to, recordedAfter) {
      const { portion } = portionFor(project, source, to);
      const sales = source.sales.filter(item => item.cardId === project.cardId && normalized(item.portion) === normalized(portion?.name || '') &&
        normalized(item.point) === normalized(point.name) && item.date >= from && item.date <= to);
      const estimate = sales.map(row => costForSale(row, source.cards, source.economy));
      const revenue = sum(sales.map(row => row.revenue));
      const sold = sum(sales.map(row => row.quantity));
      const distinct = new Set(sales.map(row => row.date)).size === sales.length;
      const food = sum(estimate.map(item => item.foodCost ?? 0));
      const cost = sum(estimate.map(item => item.cost ?? 0));
      const calculated = distinct && sold > 0 && revenue > 0 && [revenue, sold, food, cost].every(Number.isSafeInteger) &&
        estimate.every(item => !item.partial && item.foodCost != null && item.cost !== null && item.version?.number === project.version);
      const quality = qualityEvidence(project, point, source, from, to, recordedAfter).map(item => item.id).sort();
      return { sales: sales.map(item => item.id).sort(), sold, revenue, quality,
        food: calculated ? food / revenue : null, margin: calculated ? (revenue - cost) / revenue : null };
    }

    function showFacts(body, observed, criteria) {
      line(body, 'Калибровки:', observed.quality.length + ' из ' + criteria.quality + ' необходимых');
      line(body, 'Учтено продаж:', observed.sold + ' порций · ' + money(observed.revenue));
      line(body, 'Фудкост / прямая маржинальность:', observed.food === null ? 'Нужны полные дневные продажи и затраты' :
        percentFormat.format(observed.food) + ' / ' + percentFormat.format(observed.margin));
    }

    function feedbackFields(body) {
      const count = field('Собрано отзывов', 'Общее число отзывов по этому изменению за выбранный период.', { type: 'number' });
      const negative = field('Отрицательные отзывы', 'Число отрицательных отзывов из общего количества.', { type: 'number' });
      const evidence = field('Источники и вывод по отзывам', 'Опиши, как собраны отзывы, что повторялось и где сверить результаты.', { multiline: true });
      body.append(count.wrapper, negative.wrapper, evidence.wrapper);
      return () => {
        const total = number(count, 0, 1000000, true);
        return { total, negative: number(negative, 0, total, true), evidence: requireText(evidence) };
      };
    }

    function passes(observed, feedback, target) {
      return observed.quality.length >= target.quality && observed.food !== null && observed.food <= target.food &&
        observed.margin !== null && observed.margin >= target.margin && feedback.total >= target.feedback &&
        feedback.negative / feedback.total <= target.negative;
    }

    function decide(id) {
      editProject(id, 'Решение по изменению', (body, project, source) => {
        if (project.decision) throw Error('Решение по этому пилоту уже записано.');
        const day = dateKey();
        const point = source.points.find(item => item.id === project.pointId);
        const end = day < project.plannedTo ? day : project.plannedTo;
        const observed = project.start && facts(project, point, source, project.start.date, end, project.start.recordedAt);
        if (observed) showFacts(body, observed, project.criteria);
        const choice = field('Решение шеф-бариста', 'Запуск доступен после полного пилота, выполненных критериев и зафиксированного согласования.',
          { choices: { revise: decisionNames.revise, stop: decisionNames.stop, ...(project.start ? { launch: decisionNames.launch } : {}) }, value: 'revise' });
        const by = field('Кто подготовил решение', 'Шеф-бариста, который сверил пилот и предлагает следующий шаг.', { value: project.owner });
        const note = field('Обоснование решения', 'Укажи результат, отклонения и следующий шаг.', { multiline: true });
        body.append(choice.wrapper, by.wrapper, note.wrapper);
        const reportFeedback = project.start && feedbackFields(body);
        const block = el('div', '', 'quality-fields');
        const signed = approvals(block, project, 'Согласование запуска');
        body.append(block);
        function update() { setActive(block, value(choice) === 'launch'); }
        choice.control.addEventListener('change', update);
        update();
        return () => {
          const result = value(choice);
          const launching = result === 'launch';
          const feedback = reportFeedback ? reportFeedback() : null;
          if (launching) {
            const basis = prerequisites(project, point, source, day);
            if (!observed || day < project.plannedTo || basis.gaps.length || !lotsStillApproved(project.start, source, end) ||
                !passes(observed, feedback, project.criteria)) {
              throw Error('Дождись конца пилота и подтверди критерии, допуски и актуальность стандарта.');
            }
          }
          return { ...project, decision: { result, date: day, by: requireText(by), note: requireText(note),
            observed: observed || null, feedback, approvals: launching ? signed() : null } };
        };
      }, 'Сохранить решение', 'Сохраняет решение и исходные факты пилота. Ввод оформляется отдельной записью точки.');
    }

    function menuIncludes(project, point, source) {
      const scope = window.panel03MenuForPoint?.(point);
      const { portion } = portionFor(project, source, dateKey());
      return scope?.configured && scope.items.some(item => item.cardId === project.cardId &&
        item.activeVersion === project.version && item.portionKey === normalized(portion?.name || ''));
    }

    function release(id) {
      editProject(id, 'Фактический ввод на точке', (body, project, source) => {
        if (project.decision?.result !== 'launch') throw Error('Сначала зафиксируй решение о запуске.');
        const pilotVerified = currentPilot(project)?.reviews.at(-1)?.passed;
        const candidates = source.points.filter(point => (point.id === project.pointId || pilotVerified) &&
          !project.releases.some(item => item.pointId === point.id));
        if (!candidates.length) throw Error('Сначала проверь эффект первого ввода. Для остальных точек может требоваться отдельное подтверждение.');
        const day = dateKey();
        const point = field('Точка ввода', 'Сначала оформляется пилотная точка, затем можно добавить другие.', {
          choices: Object.fromEntries(candidates.map(item => [item.id, item.name])), value: candidates[0].id
        });
        const due = field('Проверить эффект до', 'Стартовый срок — через 7 дней после фактического ввода.', { type: 'date', value: plusDays(day, 7) });
        const by = field('Кто подтвердил ввод', 'Ответственный за передачу стандарта в смену и доступность позиции на точке.');
        const note = field('Подтверждение работы точки', 'Укажи, что включено в меню, как передан стандарт и где проверены наличие и условия работы.', { multiline: true });
        const specific = el('div', '', 'quality-fields');
        let readiness;
        function update() {
          const selected = candidates.find(item => item.id === value(point));
          specific.replaceChildren();
          const basis = prerequisites(project, selected, source, day);
          if (!menuIncludes(project, selected, source)) basis.gaps.push('Подтверди порцию и действующую версию в меню точки');
          readiness = readinessFields(specific, basis, project, source, day);
        }
        point.control.addEventListener('change', update);
        body.append(point.wrapper, due.wrapper, by.wrapper, note.wrapper, specific);
        update();
        return () => {
          if (!candidates.some(item => item.id === value(point)) || !dateIsValid(value(due)) || value(due) < day) throw Error('Укажи точку и дату проверки после ввода.');
          const entry = { pointId: value(point), date: day, recordedAt: new Date().toISOString(), due: value(due), by: requireText(by), note: requireText(note),
            ...readiness(), reviews: [] };
          return { ...project, releases: [...project.releases, entry] };
        };
      }, 'Записать фактический ввод', 'Сохраняет подтверждение по выбранной точке и добавляет срок оценки эффекта.');
    }

    function reviewEffect(id, pointId) {
      editProject(id, 'Проверка эффекта после ввода', (body, project, source) => {
        const entry = project.releases.find(item => item.pointId === pointId);
        if (!entry || entry.withdrawal || entry.reviews.at(-1)?.passed) throw Error('Эффект уже подтверждён или ввод недоступен.');
        const point = source.points.find(item => item.id === entry.pointId);
        const day = dateKey();
        const observed = facts(project, point, source, entry.date, day, entry.recordedAt);
        showFacts(body, observed, project.criteria);
        const basis = prerequisites(project, point, source, day);
        if (!menuIncludes(project, point, source)) basis.gaps.push('Проверь действующее меню точки');
        for (const gap of basis.gaps) line(body, 'Требуется:', gap);
        const by = field('Кто проверил эффект', 'Кто сверил записи и результаты после ввода.');
        const note = field('Вывод и следующий шаг', 'Зафиксируй эффект и действие, если условия не подтвердились.', { multiline: true });
        const next = field('Срок повторной оценки', 'Станет рабочим сроком, если эффект ещё не подтвердился.', { type: 'date', value: plusDays(day, 7), required: false });
        body.append(by.wrapper, note.wrapper, next.wrapper);
        const readFeedback = feedbackFields(body);
        return () => {
          const feedback = readFeedback();
          const passed = basis.gaps.length === 0 && passes(observed, feedback, project.criteria);
          if (!passed && (!dateIsValid(value(next)) || value(next) < day)) throw Error('Укажи срок следующей оценки.');
          const review = { date: day, by: requireText(by), note: requireText(note), observed, feedback, passed };
          return { ...project, releases: project.releases.map(item => item === entry ?
            { ...entry, due: passed ? entry.due : value(next), reviews: [...entry.reviews, review] } : item) };
        };
      }, 'Сохранить проверку эффекта', 'Успешный результат пилотной точки открывает ввод на других точках.');
    }

    function withdraw(id, pointId) {
      editProject(id, 'Приостановить ввод на точке', (body, project) => {
        const entry = project.releases.find(item => item.pointId === pointId);
        if (!entry || entry.withdrawal) throw Error('Ввод уже приостановлен или недоступен.');
        const date = dateKey();
        const approved = field('Согласование остановки', 'Укажи принятое решение и кто его согласовал.', { multiline: true });
        const reason = field('Причина и изменение в меню', 'Опиши, что остановили, как команда применяет предыдущий стандарт и что нужно проверить перед новым вводом.', { multiline: true });
        body.append(approved.wrapper, reason.wrapper);
        return () => ({ ...project, releases: project.releases.map(item => item === entry ?
          { ...entry, withdrawal: { date, approved: requireText(approved), reason: requireText(reason) } } : item) });
      }, 'Записать приостановку', 'Сохраняет историю ввода и результаты. Действующее меню сверяется отдельно.');
    }

    function safely(run) {
      try { run(); }
      catch (problem) { document.getElementById('launch-message').textContent = problem.message; }
    }

    function open(id) {
      focus = id;
      location.hash = '#launches';
      setTimeout(() => {
        const container = document.getElementById('launch-content');
        if (!container) return;
        render(container);
        const row = [...container.querySelectorAll('[data-launch-id]')].find(item => item.dataset.launchId === id);
        row?.scrollIntoView?.({ block: 'start' });
        row?.querySelector('summary')?.focus({ preventScroll: true });
      }, 0);
    }

    function moveReview(id, pointId) {
      editProject(id, 'Перенести оценку эффекта', (body, project) => {
        const entry = project.releases.find(item => item.pointId === pointId);
        if (!entry || entry.withdrawal || entry.reviews.at(-1)?.passed) throw Error('Рабочий срок уже закрыт.');
        const date = field('Новая дата оценки', 'Меняет срок в карточке запуска и календаре.', { type: 'date', value: entry.due });
        body.append(date.wrapper);
        return () => {
          const due = value(date);
          const earliest = entry.reviews.at(-1)?.date || entry.date;
          if (!dateIsValid(due) || due < earliest) throw Error('Укажи дату не раньше последней записи по точке.');
          return { ...project, releases: project.releases.map(item => item === entry ? { ...item, due } : item) };
        };
      });
    }

    function currentPilot(project) {
      return project.releases.find(item => item.pointId === project.pointId && !item.withdrawal);
    }

    function status(project) {
      const pilot = currentPilot(project);
      if (project.releases.some(item => item.pointId === project.pointId && item.withdrawal)) return 'Ввод приостановлен';
      if (pilot?.reviews.at(-1)?.passed) return 'Эффект пилотной точки подтверждён';
      if (project.releases.length) return 'Проверка после ввода';
      if (project.decision) return decisionNames[project.decision.result];
      return project.start ? 'Пилот идёт' : 'Подготовка';
    }

    function cardView(project, source, ledger) {
      const day = dateKey();
      const point = source.points.find(item => item.id === project.pointId);
      const card = el('details', '', 'module quality-record');
      card.dataset.launchId = project.id;
      card.open = focus === project.id;
      const summary = el('summary', project.title);
      summary.append(el('p', point.name + ' · ' + status(project), 'quiet'));
      const body = el('div', '', 'quality-details');
      line(body, 'Задача:', project.goal);
      line(body, 'Техкарта:', labelFor(project, source));
      line(body, 'Ответственный:', project.owner);
      line(body, 'Пилот:', formatDate(project.plannedFrom) + ' — ' + formatDate(project.plannedTo));
      line(body, 'Критерии:', project.criteria.quality + ' калибр. · фудкост до ' + percentFormat.format(project.criteria.food) +
        ' · прямая маржа от ' + percentFormat.format(project.criteria.margin) + ' · отзывов от ' + project.criteria.feedback +
        ' · отрицательных до ' + percentFormat.format(project.criteria.negative));
      const references = el('div', '', 'quality-actions');
      for (const [route, label] of [['#techcards', 'Техкарты'], ['#development', 'Точка и калибровки'], ['#training', 'Команда'],
        ['#suppliers', 'Партии'], ['#operations', 'Работа точки'], ['#economy', 'Экономика'], ['#sales', 'Дневные продажи']]) {
        const link = el('a', label, 'action');
        link.href = route;
        references.append(link);
      }
      body.append(references);
      const parent = ledger.projects.find(item => item.id === project.parentId);
      if (parent) body.append(action('Предыдущий пилот', 'Открывает решение и факты, которые послужили основанием для доработки.', () => open(parent.id)));
      if (!project.start && !project.decision) {
        const basis = prerequisites(project, point, source, day);
        for (const gap of basis.gaps) line(body, 'Перед стартом:', gap);
        body.append(action('Изменить план', 'Открывает план и критерии до старта.', () => safely(() => editDraft(project))),
          action('Подтвердить старт пилота', 'Сверяет данные точки и фиксирует подготовленные партии.', () => safely(() => startPilot(project.id))));
      }
      if (project.start) {
        line(body, 'Старт подтверждён:', formatDate(project.start.date) + ' · ' + project.start.approvals.leader);
        showBasis(body, project.start, source);
      }
      if (!project.decision) {
        body.append(action('Записать решение', 'Сохраняет запуск, доработку или остановку по фактам пилота.', () => safely(() => decide(project.id))));
      } else {
        const decision = project.decision;
        line(body, 'Решение · ' + decisionNames[decision.result], formatDate(decision.date) + ' · ' + decision.by + ' · ' + decision.note);
        if (decision.approvals) {
          line(body, 'Согласование запуска:', decision.approvals.leader);
          line(body, 'Цены и расходы:', decision.approvals.finance);
          line(body, 'Смена поставщика:', decision.approvals.supply);
        }
        if (decision.observed) showFacts(body, decision.observed, project.criteria);
        if (decision.feedback) line(body, 'Отзывы:', decision.feedback.negative + ' отрицательных из ' + decision.feedback.total + ' · ' + decision.feedback.evidence);
        if (decision.result === 'revise' && !ledger.projects.some(item => item.parentId === project.id)) {
          body.append(action('Создать доработанный пилот', 'Копирует план для новой проверки и сохраняет ссылку на прежние результаты.', () => safely(() => editDraft(project, true))));
        }
        const pilot = currentPilot(project);
        const scopeAvailable = source.points.some(item => !project.releases.some(row => row.pointId === item.id) &&
          (item.id === project.pointId || pilot?.reviews.at(-1)?.passed));
        if (decision.result === 'launch' && scopeAvailable) body.append(action('Зафиксировать ввод на точке',
          'Проверяет меню, партию, команду, технику и оформляет срок проверки эффекта.', () => safely(() => release(project.id))));
      }
      for (const entry of project.releases) {
        const rollout = el('section', '', 'quality-criterion quality-fields');
        rollout.append(el('h4', 'Ввод · ' + source.points.find(item => item.id === entry.pointId).name));
        line(rollout, 'Дата и подтверждение:', formatDate(entry.date) + ' · ' + entry.by + ' · ' + entry.note);
        showBasis(rollout, entry, source);
        if (entry.withdrawal) line(rollout, 'Приостановлено · ' + formatDate(entry.withdrawal.date), entry.withdrawal.approved + ' · ' + entry.withdrawal.reason);
        for (const review of entry.reviews) {
          line(rollout, (review.passed ? 'Эффект подтверждён' : 'Нужна повторная проверка') + ' · ' + formatDate(review.date), review.by + ' · ' + review.note);
          showFacts(rollout, review.observed, project.criteria);
          line(rollout, 'Отзывы:', review.feedback.negative + ' отрицательных из ' + review.feedback.total + ' · ' + review.feedback.evidence);
        }
        if (!entry.withdrawal && !entry.reviews.at(-1)?.passed) {
          line(rollout, 'Проверить эффект до:', formatDate(entry.due));
          rollout.append(action('Записать эффект', 'Сверяет критерии на фактических сведениях после ввода.', () => safely(() => reviewEffect(project.id, entry.pointId))));
        }
        if (!entry.withdrawal) rollout.append(action('Записать остановку на точке', 'Фиксирует согласованное решение и сохраняет всю историю.', () => safely(() => withdraw(project.id, entry.pointId))));
        body.append(rollout);
      }
      card.append(summary, body);
      return card;
    }

    function render(container) {
      const ledger = read();
      const source = context();
      container.replaceChildren();
      document.getElementById('launch-message').textContent = '';
      const pilot = source.points.find(item => item.id === ledger.settings.find(setting => setting.id === 'pilot')?.pointId);
      container.append(heading('Пилоты и ввод', 'План, старт, решение, ввод на точке и оценка эффекта сохраняются отдельно.'));
      if (pilot) line(container, 'Предпочтительная точка пилота:', pilot.name);
      if (!source.points.length) {
        const link = el('a', 'Открыть карту сети', 'action');
        link.href = '#development';
        container.append(el('p', 'Добавь точку, чтобы настроить пилот.', 'quiet'), link);
        return;
      }
      container.append(action('Настроить точку первого пилота', 'Выбранная точка подставляется в новые карточки.', () => safely(setPilotPoint)),
        action('Новое изменение', 'Создаёт план пилота на одной точке с действующей техкартой.', () => safely(() => editDraft()), 'action primary'));
      for (const project of ledger.projects.toReversed()) container.append(cardView(project, source, ledger));
    }

    function deadlines() {
      const today = dateKey();
      const { projects } = read();
      const allPoints = points();
      const rows = [];
      for (const project of projects) {
        const point = allPoints.find(item => item.id === project.pointId);
        if (!point) throw Error('Не найдена точка пилота.');
        if (!project.decision) rows.push({
          key: JSON.stringify(['pilot', project.id]), section: 'launches', point: point.name, owner: project.owner,
          title: (project.start ? 'Итог пилота · ' : 'Старт пилота · ') + project.title,
          date: project.start ? project.plannedTo : project.plannedFrom, detail: project.goal,
          open: () => open(project.id), ...(project.start ? {} : { schedule: () => editDraft(project) })
        });
        if (project.decision?.result === 'launch' && !project.releases.length) rows.push({
          key: JSON.stringify(['launch-first', project.id]), section: 'launches', point: point.name, owner: project.owner,
          title: 'Подтвердить ввод · ' + project.title, date: project.decision.date, detail: 'Ввод на пилотной точке после решения',
          open: () => open(project.id)
        });
        for (const entry of project.releases) if (!entry.withdrawal && !entry.reviews.at(-1)?.passed) rows.push({
          key: JSON.stringify(['launch-effect', project.id, entry.pointId]), section: 'launches',
          point: allPoints.find(item => item.id === entry.pointId)?.name || '', owner: entry.by,
          title: 'Проверить эффект · ' + project.title, date: entry.due || today, detail: entry.note,
          open: () => open(project.id), schedule: () => moveReview(project.id, entry.pointId)
        });
      }
      return rows;
    }

    window.panel03LaunchProgress = () => {
      const { projects } = read();
      return { active: projects.filter(item => !item.decision || item.decision.result === 'launch' &&
        (!item.releases.length || item.releases.some(row => !row.withdrawal && !row.reviews.at(-1)?.passed))).length,
        verified: projects.filter(item => currentPilot(item)?.reviews.at(-1)?.passed).length };
    };
    return { render, deadlines, key };
  };
})();
