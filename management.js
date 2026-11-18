(() => {
  'use strict';

  const key = 'panel-03:management';
  const periodNames = { week: 'Неделя', month: 'Месяц' };
  const measures = {
    revenue: { label: 'Выручка', route: '#economy', type: 'money', trend: 'up' },
    food: { label: 'Фактический фудкост', route: '#economy', type: 'percent', trend: 'down' },
    margin: { label: 'Прямая маржинальность по факту', route: '#economy', type: 'percent', trend: 'up' },
    losses: { label: 'Стоимость зарегистрированных списаний', route: '#economy', type: 'money', trend: 'down' },
    quality: { label: 'Доля критериев в норме', route: '#quality', type: 'percent', trend: 'up' },
    cases: { label: 'Зарегистрированные случаи', route: '#operations', type: 'count', trend: 'down' }
  };

  function shiftDay(day, delta) {
    const value = new Date(day + 'T12:00:00Z');
    value.setUTCDate(value.getUTCDate() + delta);
    return value.toISOString().slice(0, 10);
  }

  const offsets = period => Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000);

  window.panel03Management = ({
    el, heading, line, field, value, requireText, action, showEditor, dateKey, dateIsValid, formatDate, normalized,
    money, cents, percentFormat, savedRecords, financialReview, pointOperations, openDeadline
  }) => {
    const filter = { kind: 'week', day: '' };
    const openPointIds = new Set();
    const openActionIds = new Set();
    let comparisonObserved = false;
    const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

    function get(name, fallback) {
      const raw = localStorage.getItem(name);
      return raw === null ? fallback : JSON.parse(raw);
    }

    function read() {
      const raw = localStorage.getItem(key);
      return { raw, data: raw === null ? [] : JSON.parse(raw) };
    }

    function points() {
      return get('panel-03:network', { points: [] }).points;
    }

    function save(snapshot, changed) {
      if (localStorage.getItem(key) !== snapshot.raw) throw Error('План улучшений изменился. Открой форму заново.');
      const rows = snapshot.data.some(item => item.id === changed.id)
        ? snapshot.data.map(item => item.id === changed.id ? changed : item) : [...snapshot.data, changed];
      const network = get('panel-03:network', { profiles: [], points: [] });
      window.panel03Backup?.validate({ [key]: rows, 'panel-03:network': network });
      localStorage.setItem(key, JSON.stringify(rows));
      return changed.id;
    }

    function selectedPeriod() {
      return financialReview.periodFor(filter.kind, filter.day || dateKey(), filter.day ? 0 : -1);
    }

    function periodLabel(period) {
      return formatDate(period.from) + ' — ' + formatDate(period.to);
    }

    function within(day, period) {
      return day >= period.from && day <= period.to;
    }

    function sample(value, detail, signature = '', basis = '') {
      return { value, detail, signature, basis };
    }

    function qualitySummary(point, records, period) {
      const observations = [];
      const criteria = new Set();
      let covered = 0;
      let passed = 0;
      for (const { record } of records) {
        if (normalized(record.location) !== normalized(point.name)) continue;
        for (const [index, criterion] of record.criteria.entries()) {
          const attempts = [{ ...criterion.initial, date: record.date }, ...criterion.repeats].filter(item => within(item.date, period));
          if (!attempts.length) continue;
          const observed = attempts.toSorted((a, b) => a.date.localeCompare(b.date)).findLast(item => item.outcome === 'pass' || item.outcome === 'fail');
          if (observed) {
            covered++;
            if (observed.outcome === 'pass') passed++;
          }
          observations.push([record.id, index, attempts.map(item => [item.date, item.outcome])]);
          const rule = criterion.rule.type === 'numeric' ?
            ['numeric', criterion.rule.min, criterion.rule.max, normalized(criterion.rule.unit)] :
            ['observable', normalized(criterion.rule.expected)];
          criteria.add(JSON.stringify([record.techCard?.id || normalized(record.drink), normalized(criterion.name), rule]));
        }
      }
      const total = observations.length;
      const signature = total ? financialReview.fingerprint(JSON.stringify(observations.toSorted((a, b) =>
        a[0].localeCompare(b[0]) || a[1] - b[1]))) : '';
      return sample(covered && covered === total ? passed / covered : null,
        total ? 'Измерено ' + covered + ' из ' + total + ' · в норме ' + passed : 'За период нет критериев с результатами', signature,
        total ? financialReview.fingerprint(JSON.stringify([...criteria].sort())) : '');
    }

    function comparison(period, selected = points()) {
      const economic = financialReview.comparison(period, selected);
      const checks = savedRecords();
      const operations = get('panel-03:point-operations', { incidents: [], visits: [] });
      const projects = get('panel-03:launches', { projects: [] }).projects;
      return selected.map(point => {
        const finance = economic.find(item => item.point.id === point.id);
        const prefix = !finance?.confirmed ? 'Нужен подтверждённый разбор периода' : !finance.ready ? 'Сверь полноту исходных данных и действующие цели' : '';
        const values = {};
        const totalLoss = finance?.losses.reduce((total, [, cost]) =>
          cost === null || total === null ? null : total + cost, 0);
        for (const name of ['revenue', 'food', 'margin', 'losses']) {
          const amount = name === 'losses' ? Number.isSafeInteger(totalLoss) ? totalLoss : null : finance?.observed[name];
          values[name] = sample(finance?.ready ? amount ?? null : null,
            prefix || (amount === null ? 'Для доли нужна положительная выручка' : 'Подтверждённый разбор периода'),
            finance?.ready && Number.isFinite(amount) ? finance.evidence : '');
        }
        values.quality = qualitySummary(point, checks, period);
        const cases = operations.incidents.filter(item => item.pointId === point.id && within(item.date, period));
        const visits = operations.visits.filter(item => item.pointId === point.id && within(item.date, period));
        const repeatGroups = new Map();
        for (const item of operations.incidents.filter(item => item.pointId === point.id && item.date <= period.to).toSorted((a, b) =>
          a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
          const group = JSON.stringify([item.category, item.pattern]);
          if (!repeatGroups.has(group)) repeatGroups.set(group, []);
          repeatGroups.get(group).push(item);
        }
        const repeats = [...repeatGroups.values()].flatMap(items => items.slice(1)).filter(item => within(item.date, period)).length;
        values.cases = sample(visits.length || cases.length ? cases.length : null,
          (cases.length || visits.length ? 'В журнале за период · повторов ' + repeats + ' · визитов ' + visits.length : 'За период нет записей в журнале') +
            (visits.length ? '' : ' · визиты за период не зафиксированы'),
          financialReview.fingerprint(JSON.stringify(cases.map(item => [item.id, item.date]).sort())));
        const reviews = projects.flatMap(item => item.releases).filter(item => item.pointId === point.id);
        return { point, values, finance, visits: visits.length, repeats,
          rollout: reviews.filter(item => within(item.date, period)).length,
          effects: reviews.filter(item => item.reviews.some(result => result.passed && within(result.date, period)) &&
            (!item.withdrawal || item.withdrawal.date > period.to)).length };
      });
    }

    function display(metric, amount, difference = false) {
      if (amount === null || amount === undefined) return '—';
      const type = measures[metric].type;
      if (type === 'money') return (difference && amount > 0 ? '+' : '') + money(amount);
      if (type === 'percent') return difference ? numberFormat.format(amount * 100) + ' п. п.' : percentFormat.format(amount);
      return difference ? numberFormat.format(amount) : String(amount);
    }

    function firstEffect(kind, day, baseline) {
      const period = financialReview.periodFor(kind, day, 1);
      if (kind === 'week' || offsets(period) === offsets(baseline)) return period;
      for (let i = 2; i <= 96; i++) {
        const next = financialReview.periodFor(kind, day, i);
        if (offsets(next) === offsets(baseline)) return next;
      }
      return period;
    }

    function currentPoint(id) {
      const point = points().find(item => item.id === id);
      if (!point) throw Error('Точка больше недоступна.');
      return point;
    }

    function targetValue(input, metric) {
      const raw = input.control.valueAsNumber;
      if (!Number.isFinite(raw) || Math.abs(raw) > 1e12) throw Error('Укажи числовую цель в допустимом диапазоне.');
      const type = measures[metric].type;
      if (type === 'money') return Math.sign(raw) * cents(Math.abs(raw));
      if (type === 'count' && (!Number.isSafeInteger(raw) || raw < 0)) throw Error('Укажи целое число случаев от нуля.');
      if (metric === 'quality' && (raw < 0 || raw > 100) || metric === 'food' && raw < 0 || metric === 'margin' && raw > 100) {
        throw Error('Проверь границы процентной цели.');
      }
      return type === 'percent' ? raw / 100 : raw;
    }

    function newAction(pointId, period, metric) {
      const snapshot = read();
      const point = currentPoint(pointId);
      const spec = measures[metric];
      const baseline = comparison(period, [point])[0].values[metric];
      if (period.to >= dateKey() || baseline.value === null) throw Error('Для действия нужен полный период с подтверждённым значением.');
      showEditor('Действие · ' + spec.label, body => {
        line(body, 'Точка и исходный период:', point.name + ' · ' + periodLabel(period));
        line(body, 'Исходный показатель:', display(metric, baseline.value) + ' · ' + baseline.detail);
        const cause = field('Причина или гипотеза', 'Что могло повлиять на исходный показатель. При необходимости укажи, как проверишь причину.', { multiline: true });
        const task = field('Что изменить', 'Конкретное действие, влияние которого можно будет оценить.', { multiline: true });
        const owner = field('Ответственный за действие', 'Кто проведёт изменение и предоставит результат.');
        const target = field('Целевое значение' + (spec.type === 'percent' ? ', %' : spec.type === 'money' ? ', ₽' : ''),
          (spec.trend === 'down' ? 'Цель — не выше этого значения.' : 'Цель — не ниже этого значения.') + ' Сравнение использует ту же формулу.', { type: 'number' });
        const due = field('Срок выполнения', 'Дата появится в рабочих сроках и календаре.', { type: 'date', value: dateKey() });
        body.append(cause.wrapper, task.wrapper, owner.wrapper, target.wrapper, due.wrapper);
        return () => {
          const current = comparison(period, [currentPoint(pointId)])[0].values[metric];
          if (current.signature !== baseline.signature || current.value !== baseline.value || current.basis !== baseline.basis) throw Error('Исходный показатель изменился. Открой сравнение заново.');
          const threshold = targetValue(target, metric);
          if (spec.trend === 'up' ? threshold <= baseline.value : threshold >= baseline.value) {
            throw Error('Выбери цель лучше исходного значения в указанном направлении.');
          }
          if (!dateIsValid(value(due)) || value(due) < dateKey()) throw Error('Укажи срок от сегодняшней даты.');
          return save(snapshot, { id: crypto.randomUUID(), pointId, metric, period, baseline, target: threshold,
            cause: requireText(cause), task: requireText(task), owner: requireText(owner), date: dateKey(), due: value(due), performed: null, effect: null });
        };
      }, 'Записать действие', 'Сохраняет исходный период, показатель, причину, цель и ответственного.');
    }

    function editAction(id, mode) {
      const snapshot = read();
      const item = snapshot.data.find(row => row.id === id);
      if (!item || item.effect) throw Error('Действие уже проверено или недоступно.');
      const title = mode === 'performed' ? 'Выполнение · ' : 'Рабочий срок · ';
      showEditor(title + measures[item.metric].label, body => {
        line(body, 'Действие:', item.task);
        if (mode === 'move') {
          const input = field('Новая дата', 'Обновит ближайший срок действия или оценки.', { type: 'date', value: item.due });
          body.append(input.wrapper);
          return () => {
            const earliest = item.performed ? shiftDay(firstEffect(item.period.kind, item.performed.date, item.period).to, 1) : item.date;
            if (!dateIsValid(value(input)) || value(input) < earliest) throw Error('Эта дата раньше доступного срока.');
            return save(snapshot, { ...item, due: value(input) });
          };
        }
        const date = field('Дата выполнения', 'Начиная со следующего полного периода можно проверять эффект.', { type: 'date', value: dateKey() });
        const result = field('Что выполнено', 'Укажи фактические действия и ситуации, которые могли повлиять на результат.', { multiline: true });
        body.append(date.wrapper, result.wrapper);
        return () => {
          const day = value(date);
          if (item.performed || !dateIsValid(day) || day < item.date || day > dateKey()) throw Error('Укажи фактическую дату после назначения действия.');
          const next = firstEffect(item.period.kind, day, item.period);
          return save(snapshot, { ...item, performed: { date: day, result: requireText(result) }, due: shiftDay(next.to, 1) });
        };
      }, mode === 'performed' ? 'Записать выполнение' : 'Сохранить срок', 'После выполнения рабочий срок относится к проверке эффекта.');
    }

    function checkEffect(id) {
      const snapshot = read();
      const item = snapshot.data.find(row => row.id === id);
      if (!item?.performed || item.effect) throw Error('Сначала запиши выполнение действия.');
      const point = currentPoint(item.pointId);
      const first = firstEffect(item.period.kind, item.performed.date, item.period);
      showEditor('Проверка эффекта · ' + measures[item.metric].label, body => {
        line(body, 'Исходный период:', periodLabel(item.period) + ' · ' + display(item.metric, item.baseline.value));
        line(body, 'Цель:', display(item.metric, item.target));
        const current = comparison(item.period, [point])[0].values[item.metric];
        if (current.signature !== item.baseline.signature || current.value !== item.baseline.value || current.basis !== item.baseline.basis) {
          line(body, 'Сведения за исходный период обновились:', 'Для проверки этого действия используется значение, зафиксированное при назначении.');
        }
        const input = field('Дата внутри периода эффекта', 'Выбери завершённый период такой же длины, целиком после даты выполнения.', { type: 'date', value: first.from });
        const summary = el('div', '', 'quality-fields');
        const note = field('Вывод по результату', 'Зафиксируй, что удалось проверить, какие ещё обстоятельства могли повлиять и что делать дальше.', { multiline: true });
        let result;
        function update() {
          summary.replaceChildren();
          result = null;
          if (!dateIsValid(value(input))) return;
          const period = financialReview.periodFor(item.period.kind, value(input));
          if (period.from <= item.performed.date || period.to >= dateKey() || offsets(period) !== offsets(item.period)) {
            line(summary, 'Сопоставимость:', 'Нужен завершённый период той же длины после выполнения. Первый подходящий — ' + periodLabel(first));
            return;
          }
          const data = comparison(period, [point])[0].values[item.metric];
          line(summary, 'Значение за период:', display(item.metric, data.value) + ' · ' + data.detail);
          if (data.value !== null && data.basis !== item.baseline.basis) {
            line(summary, 'Сопоставимость:', 'Состав проверяемых позиций или критериев изменился.');
            return;
          }
          if (data.value !== null) {
            const delta = data.value - item.baseline.value;
            const reached = measures[item.metric].trend === 'up' ? data.value >= item.target : data.value <= item.target;
            line(summary, 'Изменение:', display(item.metric, delta, true) + ' · ' + (reached ? 'Цель достигнута' : 'Цель не достигнута'));
            result = { period, value: data.value, detail: data.detail, signature: data.signature, basis: data.basis, reached };
          }
        }
        input.control.addEventListener('change', update);
        body.append(input.wrapper, summary, note.wrapper);
        update();
        return () => {
          update();
          if (!result) throw Error('Сначала подтверди сопоставимый результат в исходном разделе.');
          return save(snapshot, { ...item, effect: { ...result, date: dateKey(), note: requireText(note) } });
        };
      }, 'Записать эффект', 'Закрывает оценку исходного показателя и сохраняет факт достижения цели.');
    }

    function safe(run) {
      try { run(); }
      catch (problem) { document.getElementById('management-message').textContent = problem.message; }
    }

    function open(id) {
      location.hash = '#overview';
      setTimeout(() => {
        const panel = document.getElementById('management-actions');
        if (!panel) return;
        panel.open = true;
        const row = [...panel.querySelectorAll('[data-improvement-id]')].find(item => item.dataset.improvementId === id);
        if (row) {
          row.open = true;
          row.scrollIntoView?.({ block: 'start' });
          row.querySelector('summary')?.focus({ preventScroll: true });
        }
      }, 0);
    }

    function restrictionAndDeadlines(container, rows, warnings) {
      if (!container) return;
      container.replaceChildren(heading('Требует внимания', 'Сначала видны остановки и ограничения, затем просроченные и сегодняшние действия.'));
      let restrictions = [];
      let failed = false;
      try { restrictions = pointOperations?.restrictions() || []; }
      catch { failed = true; }
      const today = dateKey();
      const present = new Set(restrictions.map(item => item.key));
      const pending = rows.filter(row => !present.has(row.key) && dateIsValid(row.date) && row.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'));
      const overdue = pending.filter(item => item.date < today).length;
      if (failed || warnings.length) container.append(el('p', 'Часть журналов недоступна. Сверь источники в рабочих сроках.', 'error'));
      if (!restrictions.length && !pending.length && !failed && !warnings.length) {
        container.append(el('p', 'Открытых ограничений и сроков до конца сегодняшнего дня в журналах нет.', 'quiet'));
        return;
      }
      line(container, 'Ограничения / просрочки / сегодня:', restrictions.length + ' / ' + overdue + ' / ' + (pending.length - overdue));
      const list = el('div', '', 'stack');
      for (const row of [...restrictions.slice(0, 4), ...pending.slice(0, 4)]) {
        const item = el('div', '', 'quality-criterion quality-fields');
        line(item, row.priority || (row.date < today ? 'Просрочено' : 'Сегодня'),
          [row.title, row.point, row.date && formatDate(row.date), row.owner].filter(Boolean).join(' · '));
        item.append(action('Открыть источник', 'Открывает запись, по которой возникло ограничение или срок.', () => openDeadline(row)));
        list.append(item);
      }
      if (restrictions.length > 4) {
        const link = el('a', 'Все случаи работы точек', 'action');
        link.href = '#operations';
        list.append(link);
      }
      if (pending.length > 4) list.append(action('Ко всем рабочим срокам', 'Прокручивает «Обзор» к полному списку.', () => {
        document.getElementById('working-deadlines')?.scrollIntoView({ block: 'start' });
      }));
      container.append(list);
    }

    function sourceButton(metric, point, period) {
      const route = measures[metric].route;
      if (route === '#economy') return action('Источник · Экономика', 'Открывает экономику по этой точке и периоду.', () => financialReview.openPeriod(point.id, period));
      const link = el('a', route === '#quality' ? 'Источник · Качество' : 'Источник · Работа точек', 'action');
      link.href = route;
      return link;
    }

    function renderComparison(container) {
      container.replaceChildren();
      const selected = points();
      if (!selected.length) {
        container.append(el('p', 'Добавь точки в карте направления для сравнения.', 'quiet'));
        const link = el('a', 'Открыть карту сети', 'action');
        link.href = '#development';
        container.append(link);
        return;
      }
      const period = selectedPeriod();
      const kind = field('Период сравнения', 'Одна календарная неделя или месяц для всех точек.', { choices: periodNames, value: filter.kind });
      const day = field('Дата внутри периода', 'По умолчанию открыт последний завершённый период.', { type: 'date', value: filter.day || period.from });
      kind.control.addEventListener('change', () => { filter.kind = value(kind); filter.day = ''; safe(() => renderComparison(container)); });
      day.control.addEventListener('change', () => {
        if (dateIsValid(value(day))) filter.day = value(day);
        safe(() => renderComparison(container));
      });
      container.append(kind.wrapper, day.wrapper, el('p', periodLabel(period)));
      const closed = period.to < dateKey();
      if (!closed) container.append(el('p', 'Период ещё открыт. Оценка действия начинается после его завершения.', 'quiet'));

      const reports = comparison(period, selected);
      const comparable = el('div', '', 'quality-criterion quality-fields');
      for (const [metric, spec] of Object.entries(measures)) {
        const count = reports.filter(item => item.values[metric].value !== null).length;
        line(comparable, spec.label, count + ' из ' + selected.length + ' точек с расчётом');
      }
      const qualityScopes = new Set(reports.filter(item => item.values.quality.value !== null).map(item => item.values.quality.basis));
      if (qualityScopes.size > 1) line(comparable, 'Качество:', 'Точки проверяли разные наборы позиций или критериев. Доли относятся к своим наборам.');
      container.append(comparable);
      const teams = window.panel03TeamReadinessReport?.(selected) || [];
      const operations = window.panel03OperationsProgress?.() || [];
      for (const report of reports) {
        const card = el('details', '', 'module quality-record');
        card.open = openPointIds.has(report.point.id);
        card.addEventListener('toggle', () => {
          if (card.open) openPointIds.add(report.point.id);
          else openPointIds.delete(report.point.id);
        });
        const summary = el('summary', report.point.name);
        const body = el('div', '', 'quality-details');
        const team = teams.find(item => item.point.id === report.point.id);
        const ops = operations.find(item => item.point.id === report.point.id);
        if (team) line(body, 'Команда сейчас:', team.ready ? 'Подготовлена' : 'Требуется сверка навыков и допусков');
        if (ops) line(body, 'Ограничения сейчас:', ops.limited + ' · просрочено случаев ' + ops.overdue);
        line(body, 'Визиты, вводы и подтверждённые эффекты за период:', report.visits + ' / ' + report.rollout + ' / ' + report.effects);
        for (const [name, spec] of Object.entries(measures)) {
          const item = el('div', '', 'quality-criterion quality-fields');
          item.append(el('h4', spec.label));
          const evidence = report.values[name];
          line(item, 'Значение:', display(name, evidence.value));
          if (name === 'food' || name === 'margin') line(item, 'Норматив:', display(name, report.finance?.normative[name]));
          const plan = report.finance?.plan?.[name];
          if (plan != null) {
            line(item, 'План:', display(name, plan));
            if (evidence.value !== null) line(item, 'Факт минус план:', display(name, evidence.value - plan, true));
          }
          item.append(el('p', evidence.detail, 'quiet'), sourceButton(name, report.point, period));
          const room = ['cases', 'food', 'losses'].includes(name) ? evidence.value > 0 :
            ['quality', 'margin'].includes(name) ? evidence.value < 1 : true;
          if (closed && evidence.value !== null && room) item.append(action('Назначить действие', 'Фиксирует исходное значение и план улучшения по этому показателю.',
            () => safe(() => newAction(report.point.id, period, name))));
          body.append(item);
        }
        card.append(summary, body);
        container.append(card);
      }
    }

    function renderActions(container) {
      container.replaceChildren();
      const rows = read().data.toReversed();
      const selected = points();
      if (!rows.length) container.append(el('p', 'Назначенные действия появятся здесь. Чтобы начать, выбери показатель в сравнении точек.', 'quiet'));
      const expanded = new Set(openActionIds);
      for (const item of rows) {
        const card = el('details', '', 'module quality-record');
        card.dataset.improvementId = item.id;
        card.open = expanded.has(item.id);
        card.addEventListener('toggle', () => {
          if (card.open) openActionIds.add(item.id);
          else openActionIds.delete(item.id);
        });
        const point = selected.find(row => row.id === item.pointId);
        const stage = item.effect ? item.effect.reached ? 'Цель достигнута' : 'Цель не достигнута' :
          item.performed ? 'Проверить эффект' : 'В работе';
        const summary = el('summary', item.task);
        summary.append(el('p', [point?.name, measures[item.metric].label, stage].filter(Boolean).join(' · '), 'quiet'));
        const body = el('div', '', 'quality-details');
        line(body, 'Причина или гипотеза:', item.cause);
        line(body, 'Исходное значение:', display(item.metric, item.baseline.value) + ' · ' + periodLabel(item.period) + ' · ' + item.baseline.detail);
        line(body, 'Цель и ответственный:', display(item.metric, item.target) + ' · ' + item.owner);
        if (item.performed) line(body, 'Выполнено · ' + formatDate(item.performed.date), item.performed.result);
        if (item.effect) {
          line(body, 'Факт и изменение:', display(item.metric, item.effect.value) + ' · ' +
            display(item.metric, item.effect.value - item.baseline.value, true) + ' · ' + periodLabel(item.effect.period));
          line(body, 'Вывод:', item.effect.note);
        } else {
          line(body, 'Срок:', formatDate(item.due));
          body.append(action(item.performed ? 'Проверить эффект' : 'Отметить выполнение', 'Открывает текущий шаг действия.',
            () => safe(() => item.performed ? checkEffect(item.id) : editAction(item.id, 'performed'))),
          action('Перенести срок', 'Обновляет рабочий срок в календаре.', () => safe(() => editAction(item.id, 'move'))));
        }
        card.append(summary, body);
        container.append(card);
      }
    }

    function render() {
      const comparisonPanel = document.getElementById('management-comparison');
      const comparisonSlot = document.getElementById('management-comparison-content');
      const actionSlot = document.getElementById('management-actions-content');
      if (comparisonPanel && comparisonSlot) {
        if (!comparisonObserved) {
          comparisonObserved = true;
          comparisonPanel.addEventListener('toggle', () => {
            if (comparisonPanel.open) safe(() => renderComparison(comparisonSlot));
          });
        }
        if (comparisonPanel.open) safe(() => renderComparison(comparisonSlot));
      }
      if (actionSlot) safe(() => renderActions(actionSlot));
    }

    function deadlines() {
      const selected = points();
      return read().data.filter(item => !item.effect).map(item => ({
        key: JSON.stringify(['management', item.id]), section: 'management', point: selected.find(row => row.id === item.pointId)?.name || '',
        owner: item.owner, date: item.due, title: (item.performed ? 'Проверить эффект · ' : 'Улучшение · ') + item.task,
        detail: measures[item.metric].label + ' · цель ' + display(item.metric, item.target), open: () => open(item.id),
        schedule: () => editAction(item.id, 'move')
      }));
    }

    window.panel03ManagementProgress = () => {
      const rows = read().data;
      return { active: rows.filter(item => !item.effect).length, checked: rows.filter(item => item.effect).length };
    };
    return { render, deadlines, restrictionAndDeadlines };
  };
})();
