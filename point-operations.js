(() => {
  'use strict';

  const key = 'panel-03:point-operations';
  const networkKey = 'panel-03:network';
  const sources = { devices: 'panel-03:equipment', samples: 'panel-03:suppliers', calibrations: 'panel-03:bar-operations' };
  const topics = { product: 'Напитки', service: 'Сервис', supplies: 'Сырьё и наличие', equipment: 'Оборудование и вода' };
  const categories = { ...topics, other: 'Другое' };
  const kinds = { complaint: 'Жалоба', failure: 'Сбой', audit: 'Отклонение на визите' };
  const impacts = { observe: 'Работа продолжается', limited: 'Работа ограничена', stopped: 'Работа приостановлена' };
  const auditStates = { ok: 'Подтверждено', issue: 'Есть отклонение', skip: 'Не проверено' };
  const incidentStates = { open: 'Нужно исправить', verify: 'На перепроверке', closed: 'Закрыто' };
  const empty = () => ({ plans: [], visits: [], incidents: [] });
  const lastFix = incident => incident.fixes.at(-1);
  const status = incident => lastFix(incident)?.check?.passed ? 'closed' : lastFix(incident) && !lastFix(incident).check ? 'verify' : 'open';
  const dueFor = incident => status(incident) === 'verify' ? lastFix(incident).due : incident.due;
  const newest = records => records.toSorted((a, b) => b.date.localeCompare(a.date) ||
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

  function shiftDay(day, interval) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + interval);
    return date.toISOString().slice(0, 10);
  }

  window.panel03PointOperations = ({ el, heading, line, field, value, requireText, action, showEditor, dateKey, dateIsValid, formatDate, normalized, setActive }) => {
    const filter = { pointId: '', state: 'active' };
    let focusId = '';

    function get(name, fallback) {
      const item = localStorage.getItem(name);
      return item === null ? fallback : JSON.parse(item);
    }

    function read() {
      const ledger = get(key, empty());
      return { ledger, points: get(networkKey, { points: [] }).points };
    }

    function capture(keys) {
      return new Map(keys.map(name => [name, localStorage.getItem(name)]));
    }

    function save(expected, ledger) {
      for (const [name, raw] of expected) {
        if (localStorage.getItem(name) !== raw) throw Error('Журнал или исходные записи изменились. Открой форму заново.');
      }
      const related = [networkKey, ...Object.values(sources), 'panel-03:techcards', 'panel-03:economy'].flatMap(name => {
        const raw = localStorage.getItem(name);
        return raw === null ? [] : [[name, JSON.parse(raw)]];
      });
      window.panel03Backup?.validate({ ...Object.fromEntries(related), [key]: ledger });
      localStorage.setItem(key, JSON.stringify(ledger));
    }

    function changeIncident(expected, ledger, incident) {
      save(expected, { ...ledger, incidents: ledger.incidents.map(item => item.id === incident.id ? incident : item) });
      return incident.id;
    }

    function plannedVisit(point, ledger) {
      const plan = ledger.plans.find(item => item.id === point.id);
      const last = newest(ledger.visits.filter(item => item.pointId === point.id && item.kind === 'regular' && item.date <= dateKey()))[0];
      const next = last && plan ? shiftDay(last.date, plan.interval) : '';
      const due = plan && ((last?.id || '') === plan.baseVisitId ? plan.first : next || plan.first);
      const ready = Boolean(next && next >= dateKey() && last.checks.every(check => check.state === 'ok' ||
        (check.state === 'issue' && ledger.incidents.some(item => item.id === check.incidentId && status(item) === 'closed'))));
      return { plan, last, due, ready };
    }

    function editPlan(point, moveOnly = false) {
      const expected = capture([key, networkKey]);
      const { ledger } = read();
      const { plan, due, last } = plannedVisit(point, ledger);
      if (moveOnly && !plan) throw Error('График визитов недоступен.');
      showEditor(moveOnly ? 'Перенести визит · ' + point.name : 'График визитов · ' + point.name, body => {
        const owner = field('Ответственный за визиты', 'Кто проводит регулярные проверки на этой точке.', { value: plan?.owner });
        const interval = field('Интервал визитов, дней', 'Стартовый интервал — 7 дней. После регулярного визита следующий срок рассчитывается заново.', {
          type: 'number', value: plan?.interval ?? 7
        });
        interval.control.min = '1';
        interval.control.max = '90';
        interval.control.step = '1';
        const first = field('Ближайшая дата', 'Первый срок или перенос ближайшего визита. Готовность по-прежнему зависит от даты фактического визита.', {
          type: 'date', value: due || dateKey()
        });
        if (!moveOnly) body.append(owner.wrapper, interval.wrapper);
        body.append(first.wrapper);
        return () => {
          const day = value(first);
          const count = moveOnly ? plan.interval : interval.control.valueAsNumber;
          if (!dateIsValid(day) || !Number.isInteger(count) || count < 1 || count > 90) throw Error('Укажи корректную дату и целый интервал от 1 до 90 дней.');
          const row = { id: point.id, first: day, baseVisitId: last?.id || '', interval: count, owner: moveOnly ? plan.owner : requireText(owner) };
          save(expected, { ...ledger, plans: [...ledger.plans.filter(item => item.id !== point.id), row] });
          return point.id;
        };
      }, 'Сохранить визит', 'Обновляет график точки в календаре и рабочих сроках.');
    }

    function newIncident(row) {
      return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), fixes: [], ...row };
    }

    function addIncident(prefill = {}) {
      const expected = capture([key, networkKey, sources.devices, sources.samples]);
      const { ledger, points } = read();
      if (!points.length) throw Error('Добавь точку в карту сети.');
      const equipment = get(sources.devices, { devices: [] });
      const samples = get(sources.samples, { samples: [] }).samples.filter(item => item.kind === 'lot');
      showEditor(prefill.jobId ? 'Операционная приёмка после работ' : 'Жалоба или сбой', body => {
        const initial = points.find(point => point.id === prefill.pointId) || points.find(point => point.id === filter.pointId) || points[0];
        const point = field('Точка инцидента', 'Связывает запись с точкой и её управляющим.', {
          choices: Object.fromEntries(points.map(item => [item.id, item.name])), value: initial.id
        });
        if (prefill.jobId) point.control.disabled = true;
        const kind = field('Вид записи', 'Жалоба связана с обратной связью гостя, сбой — с нарушением рабочего процесса.', {
          choices: { complaint: kinds.complaint, failure: kinds.failure }, value: prefill.jobId ? 'failure' : 'complaint'
        });
        const category = field('Категория', 'Помогает находить повторы на той же точке.', { choices: categories, value: prefill.jobId ? 'equipment' : 'product' });
        if (prefill.jobId) category.control.disabled = true;
        const title = field('Короткое название случая', 'Например, наблюдаемый симптом или суть жалобы.', { value: prefill.title });
        const description = field('Факт и влияние', 'Опиши, что произошло, кто или что затронуты, и какие сведения уже проверены.', { multiline: true, value: prefill.description });
        const pattern = field('Признак повтора', 'Укажи общий короткий признак для похожих случаев. Если поле пустое, сопоставляется название записи.', { required: false });
        const impact = field('Режим работы', 'Укажи фактический режим работы после принятого решения.', { choices: impacts, value: prefill.jobId ? 'limited' : 'observe' });
        const approval = field('Кто согласовал ограничение', 'Запиши согласование шеф-бариста с руководством и область ограничения.', { multiline: true });
        const date = field('Дата случая', 'Фактическая дата жалобы, сбоя или начала приёмки.', { type: 'date', value: dateKey() });
        const handling = field('Кто ведёт случай', 'В отсутствие шеф-бариста срочный случай подхватывает только управляющий точки.', {
          choices: { chef: 'Обычный порядок', manager: 'Срочно · шеф отсутствует' }, value: 'chef'
        });
        const owner = field('Ответственный за решение', 'Управляющий подставляется из карточки точки при срочном замещении.', { value: prefill.owner || 'Шеф-бариста' });
        const due = field('Срок действия', 'Дата появится в рабочих сроках и календаре.', { type: 'date', value: dateKey() });
        const linked = el('div', '', 'quality-fields');
        let device;
        const batch = field('Партия из журнала', 'Свяжи проблему с зарегистрированной партией, если она известна.', {
          choices: { '': 'Не связывать', ...Object.fromEntries(samples.map(item => [item.id, item.lot || 'Партия без обозначения'])) }, required: false
        });
        function update() {
          const current = points.find(item => item.id === value(point));
          if (value(handling) === 'manager') owner.control.value = current?.manager || '';
          owner.control.readOnly = value(handling) === 'manager';
          setActive(approval.wrapper, value(impact) !== 'observe');
          const selectedDevice = device && value(device);
          linked.replaceChildren();
          device = null;
          if (value(category) === 'equipment') {
            const options = equipment.devices.filter(item => current?.deviceIds.includes(item.id) || normalized(item.point) === normalized(current?.name || ''));
            device = field('Оборудование из журнала', 'Связанная техника требует измеримой приёмки и проверки напитка перед закрытием.', {
              choices: { '': 'Не связывать', ...Object.fromEntries(options.map(item => [item.id, item.model + (item.serial ? ' · ' + item.serial : '')])) },
              value: options.some(item => item.id === selectedDevice) ? selectedDevice : prefill.deviceId || '', required: false
            });
            device.control.disabled = Boolean(prefill.jobId);
            linked.append(device.wrapper);
          }
          if (value(category) === 'supplies') linked.append(batch.wrapper);
        }
        for (const input of [point, category, impact, handling]) input.control.addEventListener('change', () => {
          if (input === handling && value(handling) === 'chef' && owner.control.readOnly) owner.control.value = 'Шеф-бариста';
          update();
        });
        body.append(point.wrapper, kind.wrapper, category.wrapper, title.wrapper, description.wrapper, pattern.wrapper,
          impact.wrapper, approval.wrapper, date.wrapper, handling.wrapper, owner.wrapper, due.wrapper, linked);
        update();
        return () => {
          const day = value(date);
          const deadline = value(due);
          const current = points.find(item => item.id === value(point));
          if (!current || !dateIsValid(day) || day > dateKey() || !dateIsValid(deadline) || deadline < day) {
            throw Error('Выбери точку и корректный срок от даты случая.');
          }
          const label = requireText(title);
          const deputy = value(handling) === 'manager';
          const responsible = deputy ? current.manager.trim() : requireText(owner);
          if (!responsible) throw Error('Заполни управляющего в карточке точки.');
          const mode = value(impact);
          const sampleId = value(category) === 'supplies' ? value(batch) : '';
          const row = newIncident({ pointId: current.id, kind: value(kind), category: value(category), title: label,
            description: requireText(description), pattern: normalized(value(pattern) || label), impact: mode,
            approval: mode === 'observe' ? '' : requireText(approval), date: day, due: deadline, owner: responsible, deputy,
            deviceId: device ? value(device) : '', jobId: prefill.jobId || '', sampleId });
          save(expected, { ...ledger, incidents: [...ledger.incidents, row] });
          focusId = row.id;
          return row.id;
        };
      }, 'Сохранить случай', 'Создаёт рабочий срок и ищет предыдущие случаи по точке, категории и признаку повтора.');
    }

    function planExtraVisit(id) {
      const expected = capture([key, networkKey]);
      const { ledger } = read();
      const item = ledger.incidents.find(row => row.id === id);
      if (!item || (status(item) === 'closed' && !item.visitPlan)) throw Error('Случай недоступен для визита.');
      showEditor('Внеплановый визит · ' + item.title, body => {
        const owner = field('Кто проведёт визит', 'Ответственный за аудит по этому случаю.', { value: item.visitPlan?.owner || item.owner });
        const due = field('Дата внепланового визита', 'Отдельная дата для календаря. Срок исправления случая сохраняется.', {
          type: 'date', value: item.visitPlan?.due || dateKey()
        });
        body.append(owner.wrapper, due.wrapper);
        return () => {
          const day = value(due);
          if (!dateIsValid(day) || day < item.date) throw Error('Укажи дату не раньше случая.');
          return changeIncident(expected, ledger, { ...item, visitPlan: { owner: requireText(owner), due: day } });
        };
      }, 'Сохранить визит', 'Добавляет отдельный календарный срок по этому случаю.');
    }

    function addVisit(point, incident) {
      const expected = capture([key, networkKey]);
      const { ledger } = read();
      const { plan } = plannedVisit(point, ledger);
      showEditor((incident ? 'Внеплановый визит' : 'Регулярный визит') + ' · ' + point.name, body => {
        if (incident) line(body, 'Повод:', incident.title);
        const date = field('Дата визита', 'Фактическая дата состоявшегося визита.', { type: 'date', value: dateKey() });
        const reviewer = field('Кто проверил точку', 'Кто наблюдал результаты в этой смене.', { value: incident?.visitPlan?.owner || plan?.owner });
        body.append(date.wrapper, reviewer.wrapper);
        const checks = Object.entries(topics).map(([category, title]) => {
          const section = el('div', '', 'quality-criterion quality-fields');
          const state = field('Результат · ' + title, 'Сверься с актуальными документами точки и укажи фактический результат.', {
            choices: { '': 'Выбери результат', ...auditStates }
          });
          const note = field('Наблюдение · ' + title, 'Запиши проверенный факт, отклонение или причину пропуска.', { multiline: true });
          section.append(state.wrapper, note.wrapper);
          body.append(section);
          return () => ({ category, state: requireText(state), note: requireText(note), incidentId: '' });
        });
        const due = field('Срок по новым отклонениям', 'Если выявлено отклонение, к этой дате нужно назначить исправление. Срок затем можно перенести.', { type: 'date', value: dateKey() });
        body.append(due.wrapper);
        return () => {
          const day = value(date);
          const deadline = value(due);
          if (!dateIsValid(day) || day > dateKey() || (incident && day < incident.date) || !dateIsValid(deadline) || deadline < day) {
            throw Error('Проверь дату визита, дату связанного случая и срок действий.');
          }
          const reviewerName = requireText(reviewer);
          const findings = checks.map(check => check());
          const generated = findings.filter(check => check.state === 'issue').map(check => {
            const related = incident?.category === check.category && status(incident) !== 'closed'
              ? ledger.incidents.find(item => item.id === incident.id && status(item) !== 'closed') : null;
            if (related) {
              check.incidentId = related.id;
              return null;
            }
            const row = newIncident({ pointId: point.id, kind: 'audit', category: check.category, title: topics[check.category],
              description: check.note, pattern: normalized(check.note), impact: 'observe', approval: '', date: day,
              due: deadline, owner: plan?.owner || reviewerName, deputy: false, deviceId: '', jobId: '', sampleId: '' });
            check.incidentId = row.id;
            return row;
          }).filter(Boolean);
          const visit = { id: crypto.randomUUID(), pointId: point.id, date: day, createdAt: new Date().toISOString(),
            kind: incident ? 'unscheduled' : 'regular', incidentId: incident?.id || '', reviewer: reviewerName, checks: findings };
          const cases = ledger.incidents.map(item => item.id === incident?.id && item.visitPlan ? { ...item, visitPlan: null } : item);
          save(expected, { ...ledger, visits: [...ledger.visits, visit], incidents: [...cases, ...generated] });
          focusId = visit.id;
          return visit.id;
        };
      }, 'Сохранить визит', 'Сохраняет факты. Новые отклонения создают связанные записи с рабочим сроком.');
    }

    function restrict(id) {
      const expected = capture([key, networkKey]);
      const { ledger } = read();
      const item = ledger.incidents.find(row => row.id === id);
      if (!item || status(item) === 'closed' || item.impact === 'stopped') throw Error('Случай уже изменился.');
      showEditor('Ограничение работы · ' + item.title, body => {
        const options = item.impact === 'observe' ? { limited: impacts.limited, stopped: impacts.stopped } : { stopped: impacts.stopped };
        const impact = field('Новый режим работы', 'Укажи согласованный фактический режим. Возобновление фиксируется по результату перепроверки.', {
          choices: options, value: Object.keys(options)[0]
        });
        const approval = field('Кто согласовал ограничение', 'Зафиксируй согласование с руководством и область ограничения.', { multiline: true });
        body.append(impact.wrapper, approval.wrapper);
        return () => {
          const mode = value(impact);
          if (!Object.hasOwn(options, mode)) throw Error('Укажи новый режим.');
          const previous = { impact: item.impact, approval: item.approval, changedOn: dateKey() };
          return changeIncident(expected, ledger, { ...item, impact: mode, approval: requireText(approval),
            priorImpacts: [...item.priorImpacts || [], previous] });
        };
      });
    }

    function editIncident(id, mode) {
      const expected = capture([key, networkKey, sources.calibrations, sources.devices]);
      const { ledger } = read();
      const item = ledger.incidents.find(row => row.id === id);
      if (!item || status(item) === 'closed') throw Error('Случай закрыт или недоступен.');
      const current = lastFix(item);
      const waiting = status(item) === 'verify';
      if ((mode === 'fix' && waiting) || (mode === 'verify' && !waiting)) throw Error('Этап случая изменился. Открой запись заново.');
      if (mode === 'move') {
        showEditor('Новый срок · ' + item.title, body => {
          const date = field('Новый срок', 'Обновит рабочий срок в календаре.', { type: 'date', value: dueFor(item) });
          body.append(date.wrapper);
          return () => {
            const due = value(date);
            if (!dateIsValid(due) || due < (waiting ? current.fixedOn : current?.check?.date || item.date)) throw Error('Укажи срок от даты последнего действия.');
            const updated = waiting ? { ...item, fixes: [...item.fixes.slice(0, -1), { ...current, due }] } : { ...item, due };
            return changeIncident(expected, ledger, updated);
          };
        });
        return;
      }
      if (mode === 'fix') {
        showEditor('Исправление · ' + item.title, body => {
          const date = field('Дата исправления', 'День, когда выполнили корректировку.', { type: 'date', value: dateKey() });
          const cause = field('Установленная или предполагаемая причина', 'Если причина ещё не подтверждена, отметь это в записи.', { multiline: true });
          const work = field('Что исправили', 'Опиши выполненное действие и кто выполнил его.', { multiline: true });
          const acceptance = field('Критерий приёмки и источник', 'Укажи, какой результат должен наблюдаться и на какой документ или стандарт опирается критерий.', { multiline: true });
          const ruleMode = field('Способ проверки', 'Привязанное оборудование требует числового критерия из документации или действующего стандарта.', {
            choices: item.deviceId ? { numeric: 'Числовой диапазон' } : { observable: 'Наблюдаемый результат', numeric: 'Числовой диапазон' },
            value: item.deviceId ? 'numeric' : 'observable'
          });
          const limits = el('div', '', 'quality-fields');
          const minimum = field('Минимум', 'Нижняя граница включительно.', { type: 'number' });
          const maximum = field('Максимум', 'Верхняя граница включительно.', { type: 'number' });
          const unit = field('Единица замера', 'Та же единица, что в критерии и фактическом замере.');
          limits.append(minimum.wrapper, maximum.wrapper, unit.wrapper);
          function update() { setActive(limits, value(ruleMode) === 'numeric'); }
          ruleMode.control.addEventListener('change', update);
          const due = field('Дата перепроверки', 'Когда нужно проверить результат и принять решение по режиму работы.', { type: 'date', value: dateKey() });
          body.append(date.wrapper, cause.wrapper, work.wrapper, acceptance.wrapper, ruleMode.wrapper, limits, due.wrapper);
          update();
          return () => {
            const fixedOn = value(date);
            const deadline = value(due);
            if (!dateIsValid(fixedOn) || fixedOn > dateKey() || fixedOn < (current?.check?.date || item.date) ||
                !dateIsValid(deadline) || deadline < fixedOn) throw Error('Сверь последовательность дат исправления и перепроверки.');
            const numeric = value(ruleMode) === 'numeric';
            const min = minimum.control.valueAsNumber;
            const max = maximum.control.valueAsNumber;
            if (numeric && (!Number.isFinite(min) || !Number.isFinite(max) || min > max)) throw Error('Укажи корректные границы приёмки.');
            const rule = numeric ? { min, max, unit: requireText(unit) } : null;
            const fix = { fixedOn, cause: requireText(cause), work: requireText(work), acceptance: requireText(acceptance), rule, due: deadline, check: null };
            return changeIncident(expected, ledger, { ...item, fixes: [...item.fixes, fix] });
          };
        }, 'Назначить перепроверку', 'Сохраняет исправление и критерий приёмки. Случай остаётся открытым до проверки.');
        return;
      }
      showEditor('Перепроверка · ' + item.title, body => {
        line(body, 'Критерий приёмки:', current.acceptance);
        const date = field('Фактическая дата перепроверки', 'Дата наблюдения или замера.', { type: 'date', value: dateKey() });
        const who = field('Кто проверил результат', 'Ответственный, подтвердивший фактический результат.');
        const proof = field('Фактический результат', 'Опиши, что измерил или наблюдал и на каких условиях.', { multiline: true });
        const actual = current.rule ? field('Замер · ' + current.rule.unit, 'Панель сравнит замер с диапазоном включительно.', { type: 'number' }) :
          field('Критерий выполнен', 'Подтверди, наблюдался ли указанный результат.', { choices: { '': 'Выбери результат', yes: 'Да', no: 'Нет' } });
        if (current.rule) line(body, 'Диапазон:', current.rule.min + '–' + current.rule.max + ' ' + current.rule.unit);
        const afterRepair = get(sources.calibrations, []).filter(row => row.type === 'calibration' && row.pointId === item.pointId &&
          row.deviceId === item.deviceId && row.date >= current.fixedOn && row.checks.length && row.checks.every(check => check.outcome === 'pass'));
        const calibration = item.deviceId && field('Проверка напитка после ремонта', 'Выбери успешную калибровку на связанной технике после исправления. Запись должна относиться к этой точке.', {
          choices: { '': 'Не выбрана', ...Object.fromEntries(afterRepair.map((row, i) => [row.id, formatDate(row.date) + ' · ' + row.author + ' · проверка ' + (i + 1)])) }, required: false
        });
        const approval = field('Согласование возобновления', 'Если работу ограничивали или приостанавливали, запиши решение шеф-бариста, согласованное с руководством.', { multiline: true, required: false });
        const due = field('Новый срок при отклонении', 'Если результат не прошёл проверку, этот срок вернётся в календарь.', { type: 'date', value: dateKey(), required: false });
        body.append(date.wrapper, who.wrapper, actual.wrapper, proof.wrapper);
        if (calibration) body.append(calibration.wrapper);
        if (item.impact !== 'observe') body.append(approval.wrapper);
        body.append(due.wrapper);
        return () => {
          const day = value(date);
          if (!dateIsValid(day) || day > dateKey() || day < current.fixedOn) throw Error('Укажи фактическую дату перепроверки после исправления.');
          const reading = current.rule ? actual.control.valueAsNumber : null;
          if (current.rule && !Number.isFinite(reading)) throw Error('Укажи фактический замер.');
          const passed = current.rule ? reading >= current.rule.min && reading <= current.rule.max : requireText(actual) === 'yes';
          const selected = calibration && value(calibration);
          const job = item.jobId && get(sources.devices, { jobs: [] }).jobs.find(row => row.id === item.jobId);
          if (passed && item.jobId && (job?.state !== 'done' || job.closed > day)) {
            throw Error('Заверши работу в журнале оборудования перед подтверждением приёмки.');
          }
          if (passed && item.deviceId && !afterRepair.some(row => row.id === selected && row.date <= day)) {
            throw Error('Для приёмки нужна успешная проверка напитка на этой технике после исправления.');
          }
          const newDue = value(due);
          if (!passed && (!dateIsValid(newDue) || newDue < day)) throw Error('Назначь срок нового исправления.');
          const check = { date: day, who: requireText(who), proof: requireText(proof), reading, passed,
            approval: passed && item.impact !== 'observe' ? requireText(approval) : '', calibrationId: passed && selected ? selected : '' };
          const updated = { ...item, due: passed ? item.due : newDue, fixes: [...item.fixes.slice(0, -1), { ...current, check }] };
          return changeIncident(expected, ledger, updated);
        };
      }, 'Сохранить результат', 'При выполнении критерия фиксирует закрытие. При отклонении сохраняет попытку и новый рабочий срок.');
    }

    function navigate(pointId, id = '') {
      filter.pointId = pointId;
      filter.state = 'all';
      focusId = id;
      location.hash = '#operations';
      setTimeout(() => {
        const container = document.getElementById('operations-content');
        if (!container) return;
        render(container);
        const target = [...container.querySelectorAll('[data-operation-id]')].find(item => item.dataset.operationId === id);
        if (target) {
          target.open = true;
          target.scrollIntoView?.({ block: 'start' });
          target.querySelector('summary')?.focus({ preventScroll: true });
        }
      }, 0);
    }

    function openEquipmentCase(job, device) {
      const { ledger, points } = read();
      const previous = ledger.incidents.find(item => item.jobId === job.id);
      if (previous) return navigate(previous.pointId, previous.id);
      const point = points.find(item => normalized(item.name) === normalized(device.point)) ||
        points.find(item => item.deviceIds.includes(device.id));
      if (!point) throw Error('Свяжи оборудование с точкой в карте сети.');
      addIncident({ pointId: point.id, deviceId: device.id, jobId: job.id, owner: job.owner,
        title: 'Приёмка · ' + device.model, description: job.description });
    }

    function record(title, caption, id) {
      const container = el('details', '', 'module quality-record');
      container.dataset.operationId = id;
      container.open = focusId === id;
      const summary = el('summary', title);
      summary.append(el('p', caption, 'quiet'));
      const body = el('div', '', 'quality-details');
      container.append(summary, body);
      return { container, body };
    }

    function incidentCard(item, point, ledger) {
      const state = status(item);
      const date = formatDate(item.date);
      const { container, body } = record(item.title, date + ' · ' + point.name + ' · ' + incidentStates[state], item.id);
      line(body, 'Вид и категория:', kinds[item.kind] + ' · ' + categories[item.category]);
      line(body, 'Факт и влияние:', item.description);
      line(body, state === 'closed' ? 'Режим при регистрации:' : 'Текущий режим:', impacts[item.impact]);
      line(body, 'Согласование:', item.approval);
      for (const prior of item.priorImpacts || []) line(body, 'Предыдущий режим до ' + formatDate(prior.changedOn),
        impacts[prior.impact] + (prior.approval ? ' · ' + prior.approval : ''));
      line(body, 'Ответственный:', item.owner + (item.deputy ? ' · управляющий подхватил срочный случай' : ''));
      if (state !== 'closed') line(body, 'Рабочий срок:', formatDate(dueFor(item)));
      if (item.deviceId || item.sampleId) {
        const device = item.deviceId && get(sources.devices, { devices: [] }).devices.find(row => row.id === item.deviceId);
        const sample = item.sampleId && get(sources.samples, { samples: [] }).samples.find(row => row.id === item.sampleId);
        const link = el('a', device ? 'Открыть журнал оборудования' : 'Открыть журнал партий', 'action');
        link.href = device ? '#equipment' : '#suppliers';
        line(body, 'Связанный источник:', device?.model || sample?.lot);
        body.append(link);
      }
      const matching = newest(ledger.incidents.filter(other => other.pointId === item.pointId && other.category === item.category && other.pattern === item.pattern));
      const prior = matching[matching.findIndex(other => other.id === item.id) + 1];
      if (prior) {
        line(body, 'Признак повтора:', item.pattern);
        body.append(action('Предыдущий случай · ' + formatDate(prior.date), 'Совпали точка, категория и признак. Открой запись, чтобы сверить причины.', () => navigate(point.id, prior.id)));
      }
      const relatedVisits = ledger.visits.filter(visit => visit.incidentId === item.id || visit.checks.some(check => check.incidentId === item.id));
      for (const visit of relatedVisits) {
        body.append(action('Связанный визит · ' + formatDate(visit.date), 'Открывает аудиторские наблюдения по случаю.', () => navigate(point.id, visit.id)));
      }
      for (const fix of item.fixes) {
        const entry = el('div', '', 'quality-criterion quality-fields');
        line(entry, 'Исправление · ' + formatDate(fix.fixedOn), fix.work);
        line(entry, 'Причина:', fix.cause);
        line(entry, 'Критерий приёмки:', fix.acceptance);
        if (fix.rule) line(entry, 'Диапазон:', fix.rule.min + '–' + fix.rule.max + ' ' + fix.rule.unit);
        if (fix.check) {
          line(entry, (fix.check.passed ? 'Подтверждено' : 'Отклонение') + ' · ' + formatDate(fix.check.date), fix.check.who + ' · ' + fix.check.proof);
          if (fix.check.reading !== null) line(entry, 'Замер:', fix.check.reading + ' ' + fix.rule.unit);
          line(entry, 'Согласование возобновления:', fix.check.approval);
          if (fix.check.calibrationId) {
            const proof = get(sources.calibrations, []).find(row => row.id === fix.check.calibrationId);
            if (proof) line(entry, 'Проверка напитка:', formatDate(proof.date) + ' · ' + proof.author + ' · ' + proof.adjustment);
          }
        }
        body.append(entry);
      }
      if (state !== 'closed' && item.impact !== 'stopped') body.append(
        action('Записать ограничение', 'Фиксирует согласованное ограничение или приостановку для действующего случая.', () => restrict(item.id)));
      if (state !== 'closed') body.append(
        action(state === 'verify' ? 'Записать перепроверку' : 'Записать исправление', 'Следующий этап работы по записи.', () => editIncident(item.id, state === 'verify' ? 'verify' : 'fix')),
        action('Перенести срок', 'Меняет срок текущего этапа в обзоре и календаре.', () => editIncident(item.id, 'move'))
      );
      if (item.visitPlan) line(body, 'Внеплановый визит:', formatDate(item.visitPlan.due) + ' · ' + item.visitPlan.owner);
      if (state !== 'closed' || item.visitPlan) body.append(
        action(item.visitPlan ? 'Перенести внеплановый визит' : 'Назначить внеплановый визит',
          'Добавляет или переносит отдельный рабочий срок визита.', () => planExtraVisit(item.id)),
        action('Записать внеплановый визит', 'Сохраняет результаты визита и закрывает его срок. Регулярный график рассчитывается отдельно.', () => addVisit(point, item))
      );
      return container;
    }

    function visitCard(visit, point, ledger) {
      const label = visit.kind === 'regular' ? 'Регулярный визит' : 'Внеплановый визит';
      const { container, body } = record(label + ' · ' + point.name, formatDate(visit.date) + ' · ' + visit.reviewer, visit.id);
      const incident = ledger.incidents.find(item => item.id === visit.incidentId);
      if (incident) body.append(action('Повод · ' + incident.title, 'Открывает случай, который стал поводом для внепланового визита.', () => navigate(point.id, incident.id)));
      for (const check of visit.checks) {
        line(body, topics[check.category] + ' · ' + auditStates[check.state], check.note);
        const affected = ledger.incidents.find(item => item.id === check.incidentId);
        if (affected) body.append(action('Отклонение · ' + incidentStates[status(affected)], 'Открывает действие и историю перепроверок.', () => navigate(point.id, affected.id)));
      }
      return container;
    }

    function render(container) {
      const { ledger, points } = read();
      container.replaceChildren();
      if (!points.length) {
        const link = el('a', 'Открыть карту сети', 'action');
        link.href = '#development';
        container.append(el('p', 'Добавь точки для визитов и журнала случаев.', 'quiet'), link);
        return;
      }
      const scope = field('Точка журнала', 'Выбери точку или открой записи по всей сети.', {
        choices: { '': 'Все точки', ...Object.fromEntries(points.map(point => [point.id, point.name])) }, value: filter.pointId, required: false
      });
      const state = field('Случаи в журнале', 'Закрытые случаи остаются в истории и доступны для поиска повторов.', {
        choices: { active: 'Открытые', closed: 'Закрытые', all: 'Все' }, value: filter.state
      });
      scope.control.addEventListener('change', () => { filter.pointId = value(scope); focusId = ''; render(container); });
      state.control.addEventListener('change', () => { filter.state = value(state); focusId = ''; render(container); });
      container.append(scope.wrapper, state.wrapper, action('Записать жалобу или сбой',
        'Связывает случай с точкой, владельцем действия и сроком.', () => addIncident(), 'action primary'));
      const current = points.filter(point => !filter.pointId || point.id === filter.pointId);
      for (const point of current) {
        const card = el('section', '', 'module stack');
        const visit = plannedVisit(point, ledger);
        card.append(heading(point.name, 'Регулярный визит проверяет напитки, сервис, сырьё и оборудование. Внеплановый визит записывается из случая.'));
        if (visit.plan) {
          line(card, 'Ближайший визит:', formatDate(visit.due) + ' · ' + visit.plan.owner);
          if (visit.last) line(card, 'Последний регулярный визит:', formatDate(visit.last.date));
        } else line(card, 'График:', 'Нужно настроить');
        card.append(action('Настроить график визитов', 'Стартовый интервал 7 дней. Дату и ответственного можно настроить для точки.', () => editPlan(point)),
          action('Записать регулярный визит', 'Открывает чек-лист фактического аудита точки.', () => addVisit(point)));
        const cases = newest(ledger.incidents.filter(item => item.pointId === point.id))
          .filter(item => filter.state === 'all' || (filter.state === 'closed') === (status(item) === 'closed'));
        const visits = newest(ledger.visits.filter(item => item.pointId === point.id));
        card.append(heading('Случаи', 'Исправление, перепроверка и подтверждённое закрытие сохраняются отдельными шагами.', 'h4'));
        if (!cases.length) card.append(el('p', 'Записей по фильтру нет.', 'quiet'));
        for (const item of cases) card.append(incidentCard(item, point, ledger));
        card.append(heading('История визитов', 'Проверенные факты и связанные отклонения.', 'h4'));
        if (!visits.length) card.append(el('p', 'Визитов пока нет.', 'quiet'));
        for (const visit of visits) card.append(visitCard(visit, point, ledger));
        container.append(card);
      }
    }

    function deadlines() {
      const { ledger, points } = read();
      const rows = [];
      for (const point of points) {
        const visit = plannedVisit(point, ledger);
        if (visit.plan) rows.push({
          key: JSON.stringify(['point-visit', point.id]), section: 'point-operations', point: point.name, owner: visit.plan.owner,
          title: 'Регулярный визит · ' + point.name, date: visit.due, detail: 'Провести аудит по чек-листу точки',
          open: () => navigate(point.id, visit.last?.id), schedule: () => editPlan(point, true)
        });
        for (const item of ledger.incidents.filter(record => record.pointId === point.id)) {
          if (status(item) !== 'closed') rows.push({
            key: JSON.stringify(['point-incident', item.id]), section: 'point-operations', point: point.name, owner: item.owner,
            title: (status(item) === 'verify' ? 'Перепроверка · ' : 'Отклонение · ') + item.title, date: dueFor(item), detail: item.description,
            open: () => navigate(point.id, item.id), schedule: () => editIncident(item.id, 'move')
          });
          if (item.visitPlan) rows.push({
            key: JSON.stringify(['point-extra-visit', item.id]), section: 'point-operations', point: point.name, owner: item.visitPlan.owner,
            title: 'Внеплановый визит · ' + item.title, date: item.visitPlan.due, detail: item.description,
            open: () => navigate(point.id, item.id), schedule: () => planExtraVisit(item.id)
          });
        }
      }
      return rows;
    }

    function progress() {
      const { ledger, points } = read();
      return points.map(point => {
        const active = ledger.incidents.filter(item => item.pointId === point.id && status(item) !== 'closed');
        const limited = active.filter(item => item.impact !== 'observe').length;
        const overdue = active.filter(item => dueFor(item) < dateKey()).length;
        const visit = plannedVisit(point, ledger);
        return { point, active: active.length, limited, overdue, ready: visit.ready && !limited && !overdue };
      });
    }

    function equipmentStatus(job) {
      const item = read().ledger.incidents.find(row => row.jobId === job.id);
      if (!item) return 'Приёмка ещё не записана';
      return status(item) === 'closed' && job.state === 'done' ? 'Приёмка подтверждена' :
        status(item) === 'closed' ? 'Работа снова открыта' : incidentStates[status(item)];
    }

    function restrictions() {
      const { ledger, points } = read();
      const byPoint = new Map(points.map(point => [point.id, point.name]));
      return ledger.incidents.filter(item => item.impact !== 'observe' && status(item) !== 'closed')
        .toSorted((a, b) => Number(b.impact === 'stopped') - Number(a.impact === 'stopped') ||
          dueFor(a).localeCompare(dueFor(b))).map(item => ({
          key: JSON.stringify(['point-incident', item.id]), section: 'point-operations', point: byPoint.get(item.pointId),
          title: item.title, priority: impacts[item.impact], owner: item.owner, date: dueFor(item),
          open: () => navigate(item.pointId, item.id)
        }));
    }

    window.panel03OperationsProgress = progress;
    return { key, render, deadlines, openEquipmentCase, equipmentStatus, restrictions };
  };
})();
