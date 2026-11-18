(() => {
  'use strict';

  const key = 'panel-03:financial-review';
  const scopeNames = { week: 'Неделя', month: 'Месяц' };
  const metrics = {
    revenue: ['Выручка', 'Сумма выручки из кассовых строк после скидок и возвратов.'],
    food: ['Фудкост', 'Стоимость сырья ÷ выручка. Упаковка учитывается в прямой марже.'],
    margin: ['Прямая маржинальность', '(Выручка − сырьё − упаковка) ÷ выручка.']
  };
  const empty = () => ({ plans: [], reviews: [] });
  const latest = rows => rows.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id))[0];
  const sum = values => values.reduce((a, b) => a + b, 0);
  const safeSum = values => {
    const value = sum(values);
    return values.every(Number.isSafeInteger) && Number.isSafeInteger(value) ? value : null;
  };

  function fingerprint(source) {
    // FNV-1a 64 bit keeps source-change detection compact in the local journal.
    let hash = 14695981039346656037n;
    for (let i = 0; i < source.length; i++) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(source.charCodeAt(i))) * 1099511628211n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  function periodFor(kind, day, offset = 0) {
    const date = new Date(day + 'T12:00:00Z');
    if (kind === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 + 7 * offset);
    else {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + offset);
    }
    const start = date.toISOString().slice(0, 10);
    if (kind === 'week') date.setUTCDate(date.getUTCDate() + 6);
    else date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return { kind, from: start, to: date.toISOString().slice(0, 10) };
  }

  function metricsFor(revenue, food, packaging) {
    const direct = food === null || packaging === null ? null : safeSum([food, packaging]);
    return { revenue, food: food !== null && revenue > 0 ? food / revenue : null,
      margin: direct !== null && revenue > 0 ? (revenue - direct) / revenue : null };
  }

  window.panel03FinancialReview = ({
    readSales, readStock, readEconomy, readCatalog, saleRecipe, estimateIngredient, reconcileStock,
    priceFor, convertAmount, normalized, cents, money, percentFormat, dateKey, dateIsValid, formatDate,
    el, heading, line, field, value, requireText, action, showEditor
  }) => {
    const filter = { kind: 'week', date: '', pointId: '' };
    const dataKeys = [key, 'panel-03:economy', 'panel-03:sales', 'panel-03:stock', 'panel-03:techcards', 'panel-03:network'];

    function read() {
      const raw = localStorage.getItem(key);
      return { raw, data: raw ? JSON.parse(raw) : empty() };
    }

    function sources() {
      const network = localStorage.getItem('panel-03:network');
      return { ledger: read().data, points: network ? JSON.parse(network).points : [], economy: readEconomy(), cards: readCatalog().cards,
        sales: readSales().rows, stock: readStock().data };
    }

    function capture(keys) {
      return new Map(keys.map(name => [name, localStorage.getItem(name)]));
    }

    function save(expected, ledger) {
      for (const [name, raw] of expected) {
        if (localStorage.getItem(name) !== raw) throw Error('Исходные записи изменились. Открой форму заново.');
      }
      const network = localStorage.getItem('panel-03:network');
      window.panel03Backup?.validate({ [key]: ledger, ...(network ? { 'panel-03:network': JSON.parse(network) } : {}) });
      localStorage.setItem(key, JSON.stringify(ledger));
    }

    function currentPlan(ledger, period, pointId) {
      const plans = ledger.plans.filter(item => item.kind === period.kind && item.pointId === pointId && item.from <= period.from);
      const from = plans.map(item => item.from).sort().at(-1);
      return latest(plans.filter(item => item.from === from));
    }

    function pricedQuantity(supply, amount, unit, date, point) {
      if (amount === 0) return 0;
      const price = priceFor(supply, date, point);
      const converted = price && convertAmount(amount, unit, price.unit, price.density);
      if (converted === null || !Number.isFinite(converted)) return null;
      const cost = Math.sign(converted) * cents(Math.abs(converted) / price.amount * (price.cost / 100));
      return Number.isSafeInteger(cost) ? cost : null;
    }

    function calculate(source, period, point) {
      const { ledger, economy, cards, sales, stock } = source;
      const scope = normalized(point.name);
      const samePoint = row => normalized(row.point) === scope;
      const inPeriod = row => samePoint(row) && period.from <= row.date && row.date <= period.to;
      const saleRows = sales.filter(inPeriod);
      const writeOffs = stock.writeOffs.filter(inPeriod);
      const checks = stock.checks.filter(row => samePoint(row) && row.from === period.from && row.to === period.to);
      const supplyById = new Map(economy.data.supplies.map(item => [item.id, item]));
      const needed = new Set([...writeOffs.map(item => item.supply), ...checks.map(item => item.supply)]);
      const normGaps = new Set();
      const actualGaps = new Set();
      const lossGaps = new Set();
      const norm = { food: [], packaging: [], returns: [] };
      const actual = { food: [], packaging: [] };
      const detail = [];
      const losses = new Map();
      const priceEvidence = [];
      const identityRows = new Set();
      for (const row of saleRows) {
        const sale = saleRecipe(row, cards);
        const identity = JSON.stringify([row.date, sale.card?.id || row.cardId || normalized(row.drink), normalized(row.portion)]);
        if (identityRows.has(identity)) normGaps.add('Есть повторяющиеся строки продаж');
        identityRows.add(identity);
        if (row.returned == null) normGaps.add('Не указано количество приготовленных возвратов');
        const count = row.quantity + (row.returned ?? 0);
        if (count === 0 && row.returned != null) continue;
        const { card, version, portion } = sale;
        if (!portion?.ingredients.length) {
          normGaps.add('Нет техкарты или размера порции для части продаж');
          actualGaps.add('Состав использованного сырья по продажам неполный');
          continue;
        }
        const cost = [];
        for (const ingredient of portion.ingredients) {
          const estimate = estimateIngredient(economy, card.id, portion.name, ingredient, row.date, point.name);
          if (estimate.supply) needed.add(estimate.supply.id);
          priceEvidence.push([row.id, card.id, version.number, ingredient, estimate.supply?.id, estimate.supply?.kind, estimate.price]);
          if (!estimate.supply) actualGaps.add('Состав использованного сырья по продажам неполный');
          if (!estimate.supply?.kind || estimate.cost === null) {
            normGaps.add(!estimate.supply?.kind && estimate.supply ? 'У закупочных позиций не указан тип' : estimate.reason);
          } else norm[estimate.supply.kind === 'packaging' ? 'packaging' : 'food'].push(estimate.cost * count);
          cost.push(estimate.cost);
        }
        const portionCost = safeSum(cost);
        if (row.returned && portionCost === null) lossGaps.add('Не хватает данных о себестоимости приготовленных возвратов');
        if (row.returned && portionCost !== null) norm.returns.push(portionCost * row.returned);
      }
      for (const entry of writeOffs) {
        const supply = supplyById.get(entry.supply);
        const cost = supply ? pricedQuantity(supply, entry.amount, entry.unit, entry.date, point.name) : null;
        priceEvidence.push([entry.id, supply?.id, priceFor(supply || { prices: [] }, entry.date, point.name)]);
        if (cost === null) lossGaps.add('Не хватает закупочных данных для оценки части списаний');
        if (!losses.has(entry.reason)) losses.set(entry.reason, []);
        losses.get(entry.reason).push(cost);
      }
      for (const id of needed) {
        const supply = supplyById.get(id);
        const rows = checks.filter(item => item.supply === id);
        if (!supply || rows.length !== 1) {
          actualGaps.add((supply?.name || id) + (rows.length > 1 ? ' · несколько сверок за один период' : ' · нет сверки за весь период'));
          continue;
        }
        const row = rows[0];
        const result = reconcileStock(row, supply, economy.data, cards, saleRows, writeOffs);
        const cost = pricedQuantity(supply, Math.max(0, result.actual), row.unit, period.to, point.name);
        const variance = result.gaps.size ? null : pricedQuantity(supply, result.difference, row.unit, period.to, point.name);
        priceEvidence.push([row.id, supply.id, supply.kind, priceFor(supply, period.to, point.name)]);
        if (!supply.kind) actualGaps.add(supply.name + ' · укажи тип закупочной позиции');
        if (cost === null) actualGaps.add(supply.name + ' · нет цены или пересчёта единиц');
        for (const reason of result.gaps.keys()) actualGaps.add(supply.name + ' · ' + reason);
        if (cost !== null && supply.kind) actual[supply.kind === 'packaging' ? 'packaging' : 'food'].push(cost);
        detail.push({ name: supply.name, unit: row.unit, actual: result.actual, expected: result.expected, logged: result.logged,
          difference: result.gaps.size ? null : result.difference, cost, variance, note: row.note });
      }
      if (!needed.size) actualGaps.add('Нет сверок закупочных позиций за этот период');
      const salesVerifiedEmpty = !saleRows.length && checks.length && checks.every(item => item.coverage === 'complete');
      const revenue = normGaps.has('Есть повторяющиеся строки продаж') || (!saleRows.length && !salesVerifiedEmpty)
        ? null : safeSum(saleRows.map(item => item.revenue));
      const normCosts = [safeSum(norm.food), safeSum(norm.packaging)];
      const actualCosts = [safeSum(actual.food), safeSum(actual.packaging)];
      if (!saleRows.length && !salesVerifiedEmpty) normGaps.add('Нет кассовых строк или подтверждения отсутствия продаж');
      else if (revenue === null) normGaps.add('Выручка требует проверки');
      if (normCosts.includes(null)) normGaps.add('Сумма затрат выходит за пределы расчёта');
      if (actualCosts.includes(null)) actualGaps.add('Сумма фактического расхода выходит за пределы расчёта');
      const normative = metricsFor(revenue, ...(normGaps.size ? [null, null] : normCosts));
      const observed = metricsFor(revenue, ...(actualGaps.size ? [null, null] : actualCosts));
      const plan = currentPlan(ledger, period, point.id) || currentPlan(ledger, period, '');
      const stored = latest(ledger.reviews.filter(item => item.pointId === point.id && item.kind === period.kind && item.from === period.from));
      const evidence = fingerprint(JSON.stringify([plan?.id, saleRows, writeOffs, checks, priceEvidence]));
      const confirmed = stored?.evidence === evidence;
      const ready = Boolean(plan && confirmed && !normGaps.size && !actualGaps.size && !lossGaps.size && revenue !== null);
      return { point, plan, stored, confirmed, ready, normative, observed, normCosts, actualCosts, normGaps, actualGaps, lossGaps, detail,
        evidence, returns: safeSum(norm.returns), returnsUnknown: saleRows.some(row => row.returned == null) || lossGaps.has('Не хватает данных о себестоимости приготовленных возвратов'),
        losses: [...losses].map(([reason, costs]) => [reason, safeSum(costs)]), salesCount: saleRows.length };
    }

    function aggregate(reports) {
      const revenue = safeSum(reports.map(item => item.observed.revenue));
      const normCosts = [0, 1].map(index => safeSum(reports.map(item => item.normGaps.size ? null : item.normCosts[index])));
      const actualCosts = [0, 1].map(index => safeSum(reports.map(item => item.actualGaps.size ? null : item.actualCosts[index])));
      const plannedRevenue = safeSum(reports.map(item => item.plan?.revenue));
      const weighted = name => plannedRevenue > 0
        ? sum(reports.map(item => item.plan[name] * item.plan.revenue / plannedRevenue))
        : null;
      return { normative: metricsFor(revenue, ...normCosts), observed: metricsFor(revenue, ...actualCosts),
        plan: plannedRevenue === null ? null : { revenue: plannedRevenue, food: weighted('food'), margin: weighted('margin') } };
    }

    function editorPlan(period, point) {
      const expected = capture([key, 'panel-03:network']);
      const { data } = read();
      const previous = currentPlan(data, period, point?.id || '') || currentPlan(data, period, '');
      showEditor('Цели · ' + (point?.name || 'Шаблон сети'), body => {
        line(body, 'Период действия:', scopeNames[period.kind] + ' с ' + formatDate(period.from));
        const revenue = field('Целевая выручка одной точки, ₽', 'Сетевая сводка складывает цели всех точек. Индивидуальная цель заменяет базовую.', { type: 'number', value: previous ? previous.revenue / 100 : undefined });
        const food = field('Предел фудкоста, %', 'Сравнивается с фудкостом по фактическому расходу сырья.', { type: 'number', value: previous ? previous.food * 100 : undefined });
        const margin = field('Цель прямой маржинальности, %', 'Сравнивается с прямой маржой по фактическому расходу сырья и упаковки.', { type: 'number', value: previous ? previous.margin * 100 : undefined });
        for (const input of [revenue, food, margin]) input.control.step = 'any';
        body.append(revenue.wrapper, food.wrapper, margin.wrapper);
        return () => {
          const target = cents(revenue.control.valueAsNumber);
          const maxFood = food.control.valueAsNumber / 100;
          const minMargin = margin.control.valueAsNumber / 100;
          if (!Number.isSafeInteger(target) || target <= 0 || !(maxFood >= 0 && maxFood <= 1) || !(minMargin >= 0 && minMargin <= 1)) {
            throw Error('Укажи выручку выше нуля и целевые проценты от 0 до 100.');
          }
          const plan = { id: crypto.randomUUID(), pointId: point?.id || '', kind: period.kind, from: period.from,
            savedAt: new Date().toISOString(), revenue: target, food: maxFood, margin: minMargin };
          save(expected, { ...data, plans: [...data.plans, plan] });
          return plan.id;
        };
      }, 'Сохранить цели', 'Применяет цели к периоду и следующим периодам этого типа, пока не задана новая цель.');
    }

    function needsAction(report) {
      const { plan, observed, detail } = report;
      return observed.revenue < plan.revenue || (observed.food !== null && observed.food > plan.food) ||
        (observed.margin !== null && observed.margin < plan.margin) || detail.some(row => Math.abs(row.difference ?? 0) > 1e-9);
    }

    function editorReview(period, report) {
      const expected = capture(dataKeys);
      const source = sources();
      const point = source.points.find(item => item.id === report.point.id);
      if (!point || calculate(source, period, point).evidence !== report.evidence) {
        document.getElementById('economy-message').textContent = 'Исходные записи изменились. Обнови отчёт перед разбором.';
        return;
      }
      const data = source.ledger;
      const needs = needsAction(report);
      showEditor('Разбор периода · ' + report.point.name, body => {
        const reviewer = field('Кто сверил период', 'Подтверждает полноту кассовых строк и учтённых закупочных позиций.');
        const note = field('Вывод по периоду', 'Зафиксируй причину отклонения или итог проверки. Сверь продажи, сырьё, упаковку и движения.', { multiline: true });
        body.append(reviewer.wrapper, note.wrapper);
        const title = needs && field('Что сделать по отклонению', 'Сформулируй следующий шаг и ожидаемый результат.');
        const owner = needs && field('Ответственный за действие', 'Кто проверит исходные данные или выполнит корректировку.');
        const due = needs && field('Срок действия', 'Срок попадёт в обзор и календарь.', { type: 'date', value: dateKey() });
        if (needs) body.append(title.wrapper, owner.wrapper, due.wrapper);
        return () => {
          if (needs && (!dateIsValid(value(due)) || value(due) < dateKey())) throw Error('Укажи срок действия от сегодняшнего дня.');
          const entry = { id: crypto.randomUUID(), pointId: report.point.id, kind: period.kind, from: period.from, to: period.to,
            savedAt: new Date().toISOString(), date: dateKey(), reviewer: requireText(reviewer), note: requireText(note), evidence: report.evidence,
            observed: report.observed, normative: report.normative,
            follow: needs ? { title: requireText(title), owner: requireText(owner), due: value(due), result: '' } : null };
          save(expected, { ...data, reviews: [...data.reviews, entry] });
          return entry.id;
        };
      }, 'Подтвердить разбор', 'Подтверждает полноту исходных данных и записывает вывод. Изменение источников потребует новой сверки.');
    }

    function editAction(id, close) {
      const expected = capture([key, 'panel-03:network']);
      const { data } = read();
      const review = data.reviews.find(item => item.id === id);
      if (!review?.follow || review.follow.result) throw Error('Действие уже закрыто или недоступно.');
      showEditor(close ? 'Результат действия' : 'Рабочий срок', body => {
        line(body, 'Действие:', review.follow.title);
        const input = close ? field('Что подтвердило результат', 'Запиши проверенный результат корректировки.', { multiline: true })
          : field('Новая дата', 'Обновит срок в исходном разборе и календаре.', { type: 'date', value: review.follow.due });
        body.append(input.wrapper);
        return () => {
          const answer = requireText(input);
          if (!close && (!dateIsValid(answer) || answer < review.date)) throw Error('Укажи срок не раньше даты разбора.');
          const follow = { ...review.follow, [close ? 'result' : 'due']: answer };
          save(expected, { ...data, reviews: data.reviews.map(item => item.id === id ? { ...item, follow } : item) });
          return id;
        };
      }, close ? 'Сохранить результат' : 'Сохранить срок', 'Обновляет связанное действие в разборе периода.');
    }

    function display(name, number, difference = false) {
      if (number === null || number === undefined) return '—';
      if (name === 'revenue') return money(number);
      if (!difference) return percentFormat.format(number);
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(number * 100) + ' п. п.';
    }

    function metricCards(parent, report) {
      for (const [name, [label, method]] of Object.entries(metrics)) {
        const section = el('div', '', 'quality-criterion quality-fields');
        section.append(heading(label, method, 'h4'));
        if (name !== 'revenue') line(section, 'Норматив по продажам:', display(name, report.normative[name]));
        line(section, 'Факт по внесённым данным:', display(name, report.observed[name]));
        line(section, 'План:', display(name, report.plan?.[name]));
        if (report.observed[name] !== null && report.plan?.[name] != null) {
          line(section, 'Факт минус план:', display(name, report.observed[name] - report.plan[name], true));
        }
        parent.append(section);
      }
    }

    function sourceDetails(parent, report) {
      const item = el('details', '', 'quality-criterion');
      item.append(el('summary', 'Источники, расход и отклонения'));
      const body = el('div', '', 'quality-details');
      line(body, 'Кассовых строк:', String(report.salesCount));
      for (const [label, gaps] of [['Норматив:', report.normGaps], ['Факт:', report.actualGaps], ['Оценка потерь:', report.lossGaps]]) {
        for (const gap of gaps) line(body, label, gap);
      }
      line(body, 'Стоимость приготовленных возвратов:', report.returnsUnknown ? 'Данные неполные' : display('revenue', report.returns));
      const reasons = { tuning: 'Настройка', tasting: 'Дегустация', training: 'Обучение', spoilage: 'Порча', remake: 'Переделка', other: 'Другое' };
      for (const [reason, cost] of report.losses) line(body, 'Списания · ' + reasons[reason] + ':', display('revenue', cost));
      const qty = amount => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(amount);
      for (const row of report.detail) {
        body.append(el('h4', row.name));
        line(body, 'Факт / по рецепту / списания:', [row.actual, row.expected, row.logged].map(amount => qty(amount) + ' ' + row.unit).join(' / '));
        line(body, 'Необъяснённая разница:', row.difference === null ? '—' : qty(row.difference) + ' ' + row.unit);
        line(body, 'Оценка факта / разницы по цене на конец периода:', display('revenue', row.cost) + ' / ' + display('revenue', row.variance));
        line(body, 'Заметка из сверки:', row.note);
      }
      for (const [route, label] of [['#sales', 'Дневные продажи'], ['#stock', 'Списания и сверка']]) {
        const link = el('a', label, 'action');
        link.href = route;
        body.append(link);
      }
      item.append(body);
      parent.append(item);
    }

    function reportCard(report, period) {
      const card = el('section', '', 'module quality-fields');
      card.append(heading(report.point.name, 'План можно переопределить для точки. Факт требует сверок с точным периодом и полного набора исходных сведений.'));
      const status = report.ready ? 'Период подтверждён' : report.stored && !report.confirmed ? 'Источники изменились. Повтори разбор.' : 'Период требует проверки';
      card.append(el('p', status, 'quiet'));
      metricCards(card, report);
      sourceDetails(card, report);
      if (report.plan && !report.normGaps.size && !report.actualGaps.size && !report.lossGaps.size && period.to < dateKey() && !report.confirmed) {
        card.append(action('Подтвердить период', 'Фиксирует сверку исходных данных, вывод и при необходимости действие со сроком.', () => editorReview(period, report)));
      }
      return card;
    }

    function render(container) {
      container.replaceChildren();
      const source = sources();
      const today = dateKey();
      const period = filter.date ? periodFor(filter.kind, filter.date) : periodFor(filter.kind, today, -1);
      container.append(heading('План-факт и разбор периода', 'Выбери неделю или месяц. Норматив оценивается по техкартам и ценам на дату продажи. Факт оценивается по расходу и цене на конец периода.'));
      const kind = field('Вид периода', 'Неделя с понедельника по воскресенье или календарный месяц.', { choices: scopeNames, value: filter.kind });
      const date = field('Дата внутри периода', 'Любой день нужной недели или месяца.', { type: 'date', value: filter.date || period.from });
      const point = field('Область отчёта', 'Сеть или точка из карты направления.', {
        choices: { '': 'Вся сеть', ...Object.fromEntries(source.points.map(item => [item.id, item.name])) }, value: filter.pointId, required: false
      });
      kind.control.addEventListener('change', () => { filter.kind = value(kind); filter.date = ''; render(container); });
      date.control.addEventListener('change', () => { if (dateIsValid(value(date))) filter.date = value(date); render(container); });
      point.control.addEventListener('change', () => { filter.pointId = value(point); render(container); });
      container.append(kind.wrapper, date.wrapper, point.wrapper, el('p', formatDate(period.from) + ' — ' + formatDate(period.to)));
      const chosen = source.points.find(item => item.id === filter.pointId);
      container.append(action(chosen ? 'Настроить цель точки' : 'Настроить шаблон целей сети',
        'Задаёт цели на одну точку. Значения можно переопределить для отдельных точек.', () => editorPlan(period, chosen)));
      if (!source.points.length) {
        const link = el('a', 'Настроить карту сети', 'action');
        link.href = '#development';
        container.append(el('p', 'Добавь точки для сводки и сопоставления журналов.', 'quiet'), link);
        return;
      }
      const reports = (chosen ? [chosen] : source.points).map(item => calculate(source, period, item));
      if (!chosen) {
        const overview = el('section', '', 'module quality-fields');
        overview.append(heading('Сводка по сети', 'Выручка и затраты суммируются. Сетевые проценты считаются по общей выручке. Планы по процентам взвешены по целевой выручке точек.'));
        line(overview, 'Точек с подтверждённым периодом:', reports.filter(item => item.ready).length + ' из ' + reports.length);
        metricCards(overview, aggregate(reports));
        container.append(overview);
      }
      for (const report of reports) container.append(reportCard(report, period));
      const history = el('details', '', 'quality-criterion');
      history.append(el('summary', 'Записи разбора и действия'));
      const relevant = source.ledger.reviews.filter(item => item.kind === period.kind && item.from === period.from && (!chosen || item.pointId === chosen.id));
      for (const item of relevant.toReversed()) {
        const row = el('div', '', 'quality-details');
        row.dataset.economyReview = item.id;
        line(row, formatDate(item.date) + ' · ' + (source.points.find(point => point.id === item.pointId)?.name || item.pointId), item.reviewer + ' · ' + item.note);
        line(row, 'Подтверждённый факт:', Object.keys(metrics).map(name => metrics[name][0] + ' ' + display(name, item.observed[name])).join(' · '));
        if (item.follow) {
          line(row, 'Действие:', item.follow.title + ' · ' + item.follow.owner + ' · ' + formatDate(item.follow.due));
          if (item.follow.result) line(row, 'Подтверждённый результат:', item.follow.result);
          else row.append(action('Записать результат действия', 'Закрывает срок после фиксации результата.', () => editAction(item.id, true)));
        }
        history.append(row);
      }
      if (!relevant.length) history.append(el('p', 'Разборов пока нет.', 'quiet'));
      container.append(history);
    }

    function deadlines() {
      const source = sources();
      return source.ledger.reviews.filter(item => item.follow && !item.follow.result).map(item => {
        const point = source.points.find(row => row.id === item.pointId);
        return { key: JSON.stringify(['financial-review', item.id]), section: 'financial-review', point: point?.name || '', owner: item.follow.owner,
          date: item.follow.due, title: 'Экономика · ' + item.follow.title, detail: item.note,
          open: () => {
            filter.kind = item.kind;
            filter.date = item.from;
            filter.pointId = item.pointId;
            location.hash = '#economy';
            setTimeout(() => {
              const container = document.getElementById('economy-review');
              if (!container) return;
              render(container);
              const row = [...container.querySelectorAll('[data-economy-review]')].find(element => element.dataset.economyReview === item.id);
              if (row) {
                row.closest('details').open = true;
                row.scrollIntoView?.({ block: 'start' });
              }
            }, 0);
          },
          schedule: () => editAction(item.id, false) };
      });
    }

    function progress() {
      const source = sources();
      const period = periodFor('week', dateKey(), -1);
      const reviewed = new Set(source.ledger.reviews.filter(item => item.kind === period.kind && item.from === period.from).map(item => item.pointId));
      return source.points.map(point => ({ point, ready: reviewed.has(point.id) && calculate(source, period, point).ready }));
    }

    window.panel03FinancialTargets = (pointId, day) => {
      if (!dateIsValid(day)) return null;
      const ledger = read().data;
      const period = periodFor('week', day);
      return currentPlan(ledger, period, pointId) || currentPlan(ledger, period, '');
    };
    window.panel03FinancialProgress = progress;
    return { render, deadlines, key };
  };
})();
