(() => {
  'use strict';

  const groups = {
    'panel-03:network': ['Развитие и точки', ['profiles', 'points']],
    'panel-03:precision-visits': ['Первичная диагностика', null],
    'panel-03:network-baselines': ['Исходные картины сети', null],
    'panel-03:bar-operations': ['Сменные проверки и калибровки', null],
    'panel-03:menu-plans': ['Меню и графики калибровок', null],
    'panel-03:menu-changes': ['Изменения для перепроверки меню', null],
    'panel-03:techcards': ['Техкарты', null],
    'panel-03:economy': ['Экономика', ['supplies', 'links']],
    'panel-03:financial-review': ['План-факт и разборы', ['plans', 'reviews']],
    'panel-03:point-operations': ['Визиты и случаи по точкам', ['plans', 'visits', 'incidents']],
    'panel-03:launches': ['Пилоты и запуск на точках', ['settings', 'projects']],
    'panel-03:management': ['План управленческих улучшений', null],
    'panel-03:sales': ['Дневные продажи', null],
    'panel-03:stock': ['Списания и сверки', ['writeOffs', 'checks']],
    'panel-03:training': ['Обучение', ['team', 'skills', 'attempts', 'programs', 'clearances']],
    'panel-03:training-plans': ['Планы проверок навыков', null],
    'panel-03:equipment': ['Оборудование и вода', ['devices', 'jobs', 'water']],
    'panel-03:suppliers': ['Сырьё и поставщики', ['suppliers', 'specs', 'samples']]
  };
  const transactionKey = 'panel-03:restore-transaction';
  const text = value => typeof value === 'string';
  const number = value => Number.isFinite(value);
  const boolean = value => typeof value === 'boolean';
  const nullable = check => value => value === null || check(value);
  const optional = check => value => value === undefined || check(value);
  const choices = (...options) => value => options.includes(value);
  const date = value => text(value) && /^\d{4}-\d\d-\d\d$/.test(value) &&
    !value.startsWith('0000') && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  const maybeDate = value => value === '' || date(value);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const array = check => value => Array.isArray(value) && value.every(check);
  const fields = schema => value => object(value) && Object.entries(schema).every(([key, check]) => check(value[key]));
  const identified = schema => fields({ id: value => text(value) && Boolean(value), ...schema });
  const numericRule = fields({ type: choices('numeric'), min: number, max: number, unit: text });
  const rule = value => (numericRule(value) && value.min <= value.max) ||
    fields({ type: choices('observable'), expected: text })(value);
  const importance = optional(choices('required', 'critical', 'advisory'));
  const criterion = fields({ name: text, rule, importance });
  const templateCriterion = value => criterion(value) || fields({ name: text, rule: fields({ type: choices('recipe') }) })(value);
  const ingredient = fields({ name: text, amount: nullable(number), unit: text });
  const portion = fields({ name: text, ingredients: array(ingredient), preparation: text, service: text, criteria: array(criterion) });
  const recipe = fields({ title: text, portions: array(portion) });
  const draftRule = value => rule(value) || fields({
    type: choices('numeric'), min: nullable(number), max: nullable(number), unit: text
  })(value);
  const draftRecipe = fields({ title: text, portions: array(fields({
    name: text, ingredients: array(ingredient), preparation: text, service: text,
    criteria: array(fields({ name: text, rule: draftRule }))
  })) });
  const qualityPlan = fields({ action: text, owner: text, due: date, method: text });
  const assessed = fields({ outcome: choices('pass', 'fail', 'skip'), detail: text, measured: nullable(number), plan: nullable(qualityPlan) });
  const quality = identified({
    location: text, drink: text, date,
    reference: optional(text),
    criteria: array(value => criterion(value) && fields({
      initial: assessed, repeats: array(item => assessed(item) && date(item.date))
    })(value))
  });
  const performance = value => criterion(value) && fields({ passed: boolean, measured: nullable(number), notes: text })(value);
  const price = fields({ cost: number, amount: value => number(value) && value > 0, unit: text, date, density: nullable(number),
    pointId: optional(value => text(value) && Boolean(value)), approval: optional(value => text(value) && Boolean(value.trim())),
    purchasingApproval: optional(value => text(value) && Boolean(value.trim())) });
  const waterPlan = fields({ action: text, owner: text, date });
  const waterAttempt = fields({ date, amount: number, passed: boolean, plan: nullable(waterPlan) });
  const sampleAttempt = attempt => identified({
    date, conditions: text, results: array(performance), quote: nullable(fields({ cost: number, amount: value => number(value) && value > 0, unit: text })),
    decision: choices('approved', 'conditional', 'repeat', 'rejected'), reason: text, follow: text, next: maybeDate,
    transition: maybeDate, impactNote: text, impact: array(fields({ title: text, delta: nullable(number) })),
    approval: optional(fields({ approver: value => text(value) && Boolean(value.trim()), until: date, conditions: value => text(value) && Boolean(value.trim()) }))
  })(attempt) && (attempt.decision === 'conditional'
    ? Boolean(attempt.approval) && attempt.approval.until >= attempt.date &&
      attempt.results.some(item => !item.passed && (item.importance || 'required') === 'required') &&
      !attempt.results.some(item => !item.passed && item.importance === 'critical')
    : attempt.approval === undefined);
  const networkPoint = identified({
    name: value => text(value) && Boolean(value.trim()), aliases: optional(array(value => text(value) && Boolean(value.trim()))), manager: text, menu: text,
    teamIds: array(text), deviceIds: array(text), equipmentNotes: text, reviewed: boolean
  });
  const hasText = value => text(value) && Boolean(value.trim());
  const visitTopics = ['drinks', 'bar', 'team', 'equipment', 'supply', 'economy'];
  const diagnosticAction = fields({
    title: hasText, owner: hasText, due: date, verification: hasText,
    closed: nullable(fields({ date, result: hasText }))
  });
  const diagnosticCheck = fields({
    topic: choices(...visitTopics), state: choices('', 'ok', 'issue', 'skipped'), note: text,
    action: nullable(diagnosticAction)
  });
  const diagnosticVisit = value => identified({
    pointId: hasText, date, checks: array(diagnosticCheck), confirmed: boolean
  })(value) &&
    value.checks.length === visitTopics.length &&
    new Set(value.checks.map(check => check.topic)).size === visitTopics.length &&
    value.checks.every(check =>
      (!check.action || (check.state === 'issue' && check.note.trim() && check.action.due >= value.date &&
        (!check.action.closed || (value.confirmed && check.action.closed.date >= value.date)))) &&
      (!value.confirmed || (check.state && check.note.trim() && (check.state !== 'issue' || check.action)))
    );
  const barAction = fields({ title: hasText, owner: hasText, due: date, closed: nullable(fields({ date, result: hasText })) });
  const shiftCore = {
    opening: ['Станция и чистота', 'Аллергены', 'Техника и вода', 'Сырьё и доступность меню'],
    closing: ['Станция и чистота', 'Техника и вода', 'Остатки и передача смены']
  };
  const barCheck = value => fields({
    name: hasText, rule: nullable(rule), outcome: choices('pass', 'fail', 'unchecked'), amount: nullable(number), note: text
  })(value) && (value.rule?.type === 'numeric' && value.amount !== null
    ? value.outcome === (value.amount >= value.rule.min && value.amount <= value.rule.max ? 'pass' : 'fail')
    : value.amount === null && hasText(value.note) && (value.rule?.type !== 'numeric' || value.outcome === 'unchecked'));
  const barOperation = value => identified({
    pointId: hasText, date, createdAt: item => text(item) && Number.isFinite(Date.parse(item)), author: hasText,
    checks: array(barCheck), action: nullable(barAction)
  })(value) && value.checks.length > 0 &&
    (value.checks.every(check => check.outcome === 'pass') ? value.action === null :
      value.action && value.action.due >= value.date && (!value.action.closed || value.action.closed.date >= value.date)) &&
    (value.type === 'shift'
      ? fields({ phase: choices('opening', 'closing'), template: choices(1) })(value) &&
        shiftCore[value.phase].every((name, index) => value.checks[index]?.name === name) &&
        value.checks.every(check => check.rule === null) &&
        new Set(value.checks.map(check => check.name.toLocaleLowerCase('ru'))).size === value.checks.length
      : fields({
        type: choices('calibration'), cardId: hasText, version: Number.isSafeInteger, portion: index => Number.isSafeInteger(index) && index >= 0,
        deviceId: text, batch: hasText, sampleId: text, attemptId: text, adjustment: hasText, changeId: optional(hasText)
      })(value) && Boolean(value.sampleId) === Boolean(value.attemptId) && value.checks.every(check => check.rule !== null));
  const portionNameKey = value => value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
  const menuScope = { cardId: hasText, portionKey: value => hasText(value) && value === portionNameKey(value),
    version: value => Number.isSafeInteger(value) && value > 0 };
  const menuRow = fields({ ...menuScope, mode: choices('include', 'exclude'),
    interval: value => Number.isInteger(value) && value >= 0 && value <= 365, since: date });
  const recordedAt = value => text(value) && Number.isFinite(Date.parse(value));
  const menuPlan = value => identified({ pointId: text, date, createdAt: recordedAt, rows: array(menuRow) })(value) &&
    value.rows.every(row => row.since <= value.date && (row.mode === 'include' || (Boolean(value.pointId) && row.interval === 0))) &&
    new Set(value.rows.map(row => JSON.stringify([row.cardId, row.portionKey]))).size === value.rows.length;
  const menuChange = identified({ ...menuScope, pointId: hasText, date, createdAt: recordedAt,
    cause: choices('supplies', 'equipment'), note: hasText });
  const role = choices('trainee', 'barista', 'mentor');
  const uniqueIds = value => array(hasText)(value) && value.length > 0 && new Set(value).size === value.length;
  const trainingProgram = identified({ role, skillIds: uniqueIds, date, createdAt: recordedAt });
  const clearance = identified({
    personId: hasText, programId: hasText, assignmentId: optional(hasText), point: hasText, approver: hasText,
    date, createdAt: recordedAt, attemptIds: uniqueIds
  });
  const periodType = choices('week', 'month');
  const percentage = value => number(value) && value >= 0 && value <= 1;
  const reportPeriod = { kind: periodType, from: date };
  const financialPlan = identified({ ...reportPeriod, pointId: text, savedAt: recordedAt,
    revenue: value => Number.isSafeInteger(value) && value > 0, food: percentage, margin: percentage });
  const financialNumbers = fields({ revenue: Number.isSafeInteger, food: nullable(number), margin: nullable(number) });
  const financialReview = item => identified({ ...reportPeriod, pointId: hasText, to: date, date, savedAt: recordedAt, reviewer: hasText,
    note: hasText, evidence: value => text(value) && /^[0-9a-f]{16}$/.test(value),
    observed: financialNumbers, normative: financialNumbers,
    follow: nullable(fields({ title: hasText, owner: hasText, due: date, result: text }))
  })(item) && item.from <= item.to && item.to < item.date && (!item.follow || item.follow.due >= item.date);
  const operationTopics = ['product', 'service', 'supplies', 'equipment'];
  const visitCheck = fields({ category: choices(...operationTopics), state: choices('ok', 'issue', 'skip'), note: hasText, incidentId: text });
  const operationsVisit = row => identified({
    pointId: hasText, date, createdAt: recordedAt, kind: choices('regular', 'unscheduled'), incidentId: text,
    reviewer: hasText, checks: array(visitCheck)
  })(row) && Boolean(row.incidentId) === (row.kind === 'unscheduled') && row.checks.length === operationTopics.length &&
    new Set(row.checks.map(item => item.category)).size === operationTopics.length &&
    row.checks.every(item => Boolean(item.incidentId) === (item.state === 'issue'));
  const visitPlan = identified({ first: date, baseVisitId: text, owner: hasText,
    interval: value => Number.isInteger(value) && value >= 1 && value <= 90 });
  const incidentRule = value => fields({ min: number, max: number, unit: hasText })(value) && value.min <= value.max;
  const incidentCheck = fields({ date, who: hasText, proof: hasText, reading: nullable(number), passed: boolean, approval: text, calibrationId: text });
  const incidentFollowUp = fields({ fixedOn: date, cause: hasText, work: hasText, acceptance: hasText, rule: nullable(incidentRule),
    due: date, check: nullable(incidentCheck) });
  const impact = choices('observe', 'limited', 'stopped');
  const incident = row => identified({
    pointId: hasText, kind: choices('complaint', 'failure', 'audit'), category: choices(...operationTopics, 'other'),
    title: hasText, description: hasText, pattern: hasText, impact, approval: text, date, due: date, createdAt: recordedAt, owner: hasText,
    deputy: boolean, deviceId: text, jobId: text, sampleId: text, fixes: array(incidentFollowUp),
    priorImpacts: optional(array(fields({ impact, approval: text, changedOn: date }))),
    visitPlan: optional(nullable(fields({ owner: hasText, due: date })))
  })(row) && (row.impact === 'observe' || hasText(row.approval)) && row.due >= row.date && (!row.visitPlan || row.visitPlan.due >= row.date) &&
    (!row.deviceId || row.category === 'equipment') && (!row.sampleId || row.category === 'supplies') && (!row.jobId || Boolean(row.deviceId)) &&
    row.fixes.every((item, index, list) => {
      const previous = list[index - 1];
      if (previous && (!previous.check || previous.check.passed || item.fixedOn < previous.check.date)) return false;
      if (item.fixedOn < row.date || item.due < item.fixedOn || (row.deviceId && !item.rule)) return false;
      const check = item.check;
      if (!check) return true;
      if (check.date < item.fixedOn) return false;
      if (item.rule) {
        if (check.reading === null || check.passed !== (check.reading >= item.rule.min && check.reading <= item.rule.max)) return false;
      } else if (check.reading !== null) return false;
      if (check.passed) return (row.impact === 'observe' || hasText(check.approval)) && (!row.deviceId || Boolean(check.calibrationId));
      return !check.calibrationId;
    });
  const pilotSetting = identified({ id: choices('pilot'), pointId: hasText });
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
  const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
  const pilotCriteria = fields({ quality: positiveInteger, food: percentage, margin: percentage, feedback: positiveInteger, negative: percentage });
  const launchApprovals = fields({ leader: hasText, finance: text, supply: text });
  const launchBasis = { cost: nonNegativeInteger, calibrationId: hasText, lots: array(fields({ sampleId: hasText, attemptId: hasText })) };
  const pilotStart = fields({ ...launchBasis, date, recordedAt, approvals: launchApprovals });
  const sourceIds = value => array(hasText)(value) && new Set(value).size === value.length;
  const pilotFacts = fields({ sales: sourceIds, sold: nonNegativeInteger, revenue: Number.isSafeInteger, quality: sourceIds,
    food: nullable(number), margin: nullable(number) });
  const pilotFeedback = item => fields({ total: nonNegativeInteger, negative: nonNegativeInteger, evidence: hasText })(item) && item.negative <= item.total;
  const pilotDecision = fields({ result: choices('launch', 'revise', 'stop'), by: hasText, date, note: hasText,
    observed: nullable(pilotFacts), feedback: nullable(pilotFeedback), approvals: nullable(launchApprovals) });
  const releaseReview = fields({ date, by: hasText, note: hasText, observed: pilotFacts, feedback: pilotFeedback, passed: boolean });
  const projectRelease = fields({ ...launchBasis, pointId: hasText, date, recordedAt, due: date, by: hasText, note: hasText,
    reviews: array(releaseReview), withdrawal: optional(fields({ date, approved: hasText, reason: hasText })) });
  const launchProject = item => identified({
    title: hasText, goal: hasText, owner: hasText, pointId: hasText, parentId: text, cardId: hasText, version: positiveInteger,
    portion: nonNegativeInteger, plannedFrom: date, plannedTo: date, retail: positiveInteger,
    flags: fields({ price: boolean, expense: boolean, supplier: boolean }), criteria: pilotCriteria,
    start: nullable(pilotStart), decision: nullable(pilotDecision), releases: array(projectRelease)
  })(item) && validateLaunchProject(item);
  function validateLaunchProject(project) {
    const { start, decision, releases, criteria, flags, plannedFrom, plannedTo } = project;
    const signed = item => item && (!(flags.price || flags.expense) || hasText(item.finance)) &&
      (!flags.supplier || hasText(item.supply));
    function passed(observed, feedback) {
      return observed && feedback && observed.quality.length >= criteria.quality && observed.food !== null &&
        observed.food <= criteria.food && observed.margin !== null && observed.margin >= criteria.margin &&
        feedback.total >= criteria.feedback && feedback.negative / feedback.total <= criteria.negative;
    }
    if (plannedFrom > plannedTo || (start && (start.date < plannedFrom || start.date > plannedTo || !signed(start.approvals)))) return false;
    if (decision) {
      if (start && (decision.date < start.date || !decision.observed || !decision.feedback)) return false;
      if (decision.result === 'launch' && (!start || decision.date < plannedTo || !signed(decision.approvals) ||
          !passed(decision.observed, decision.feedback))) return false;
    }
    if (!releases.length) return true;
    if (decision?.result !== 'launch' || releases[0].pointId !== project.pointId ||
        new Set(releases.map(item => item.pointId)).size !== releases.length) return false;
    const pilotCheck = releases[0].reviews.find(item => item.passed);
    return releases.every((item, index) =>
      item.date >= decision.date && item.due >= item.date && (index === 0 || (pilotCheck && item.date >= pilotCheck.date)) &&
      (!item.withdrawal || item.withdrawal.date >= (item.reviews.at(-1)?.date || item.date)) &&
      item.reviews.every((review, i) => review.date >= (item.reviews[i - 1]?.date || item.date) &&
        (!review.passed || (i === item.reviews.length - 1 && passed(review.observed, review.feedback)))));
  }
  const improvementMetric = choices('revenue', 'food', 'margin', 'losses', 'quality', 'cases');
  const comparisonPeriod = fields({ ...reportPeriod, to: date });
  const evidenceSignature = value => text(value) && /^[0-9a-f]{16}$/.test(value);
  const improvementEvidence = { value: number, detail: hasText, signature: evidenceSignature, basis: value => value === '' || evidenceSignature(value) };
  const effectReview = fields({ ...improvementEvidence, period: comparisonPeriod, reached: boolean, date, note: hasText });
  const improvement = item => identified({
    pointId: hasText, metric: improvementMetric, period: comparisonPeriod, baseline: fields(improvementEvidence), target: number,
    cause: hasText, task: hasText, owner: hasText, date, due: date, performed: nullable(fields({ date, result: hasText })), effect: nullable(effectReview)
  })(item) && verifyImprovement(item);
  function verifyImprovement(item) {
    const { period, baseline, target, metric, performed, effect } = item;
    const up = ['revenue', 'margin', 'quality'].includes(metric);
    const validValue = value => {
      if (metric === 'cases' || metric === 'losses') return nonNegativeInteger(value);
      if (metric === 'revenue') return Number.isSafeInteger(value);
      if (metric === 'quality') return percentage(value);
      return metric === 'food' ? value >= 0 : value <= 1;
    };
    const validPeriod = scope => {
      const start = new Date(scope.from + 'T12:00:00Z');
      if (scope.kind === 'week') {
        if (start.getUTCDay() !== 1) return false;
        start.setUTCDate(start.getUTCDate() + 6);
      } else {
        if (start.getUTCDate() !== 1) return false;
        start.setUTCMonth(start.getUTCMonth() + 1, 0);
      }
      return start.toISOString().slice(0, 10) === scope.to;
    };
    if (!validPeriod(period) || period.to >= item.date || item.due < item.date || !validValue(baseline.value) || !validValue(target) ||
        (metric === 'quality' ? !baseline.basis : Boolean(baseline.basis)) ||
        (up ? target <= baseline.value : target >= baseline.value)) return false;
    if (performed && (performed.date < item.date || item.due <= performed.date)) return false;
    if (!effect) return true;
    const next = effect.period;
    const duration = value => Date.parse(value.to) - Date.parse(value.from);
    return performed && validPeriod(next) && next.kind === period.kind && duration(next) === duration(period) &&
      next.from > performed.date && next.to < effect.date && validValue(effect.value) && baseline.basis === effect.basis &&
      effect.reached === (up ? effect.value >= target : effect.value <= target);
  }
  const schemas = {
    'panel-03:management': array(improvement),
    'panel-03:launches': fields({ settings: array(pilotSetting), projects: array(launchProject) }),
    'panel-03:point-operations': fields({ plans: array(visitPlan), incidents: array(incident), visits: array(operationsVisit) }),
    'panel-03:financial-review': fields({ plans: array(financialPlan), reviews: array(financialReview) }),
    'panel-03:menu-plans': array(menuPlan),
    'panel-03:menu-changes': array(menuChange),
    'panel-03:bar-operations': array(barOperation),
    'panel-03:precision-visits': array(diagnosticVisit),
    'panel-03:network-baselines': array(identified({
      date, profileId: hasText, visitIds: value => array(hasText)(value) && value.length > 0 && new Set(value).size === value.length,
      priority: hasText
    })),
    'panel-03:network': fields({
      profiles: array(identified({ purpose: text, scope: text, leadership: text, authority: text, basis: text, effective: date, savedAt: text })),
      points: array(networkPoint)
    }),
    'panel-03:techcards': array(identified({
      draft: nullable(draftRecipe),
      versions: array(value => recipe(value) && fields({ number, effective: date })(value))
    })),
    'panel-03:economy': fields({
      supplies: array(identified({ name: text, kind: optional(choices('ingredient', 'packaging')), prices: array(price) })),
      links: array(item => fields({ key: text, supply: hasText, changes: optional(array(fields({ from: date, supply: text }))) })(item) &&
        (item.changes || []).every((change, i, list) => i === 0 || change.from > list[i - 1].from))
    }),
    'panel-03:sales': array(identified({
      date, point: text, cardId: nullable(text), drink: text, portion: text,
      quantity: value => Number.isSafeInteger(value) && value >= 0,
      returned: nullable(value => Number.isSafeInteger(value) && value >= 0), revenue: Number.isSafeInteger
    })),
    'panel-03:stock': fields({
      writeOffs: array(identified({ point: text, supply: text, date, amount: number, unit: text, reason: choices('tuning', 'tasting', 'training', 'spoilage', 'remake', 'other'), note: text })),
      checks: array(identified({ point: text, supply: text, from: date, to: date, unit: text, coverage: choices('open', 'complete'), note: text,
        opening: number, closing: number, received: number, incoming: number, outgoing: number, returned: number }))
    }),
    'panel-03:training-plans': array(identified({ personId: hasText, skillId: hasText, requiredVersion: value => Number.isSafeInteger(value) && value > 0, owner: hasText, due: date })),
    'panel-03:training': fields({
      team: array(identified({
        name: text, point: text, role: optional(value => value === '' || role(value)), mentorId: optional(text), assignmentId: optional(hasText)
      })),
      programs: optional(array(trainingProgram)),
      clearances: optional(array(clearance)),
      skills: array(item => identified({ version: number, requiredVersion: optional(Number.isSafeInteger), changedOn: optional(date), name: text, task: text,
        criteria: array(templateCriterion) })(item) &&
        (item.requiredVersion === undefined || (item.requiredVersion > 0 && item.requiredVersion <= item.version))),
      attempts: array(identified({ personId: text, skillId: text, version: number, skill: text, task: text, date,
        point: text, reviewer: text, reviewerId: optional(hasText), independent: boolean, passed: boolean, results: array(performance), feedback: text, exercise: text, next: maybeDate }))
    }),
    'panel-03:equipment': fields({
      devices: array(identified({ point: text, kind: choices('machine', 'grinder', 'water'), model: text, serial: text, owner: text })),
      jobs: array(identified({ device: text, kind: choices('planned', 'issue'), state: choices('scheduled', 'progress', 'recheck', 'done'),
        date, due: date, owner: text, description: text, result: text, recheck: text, next: maybeDate, closed: maybeDate })),
      water: array(identified({ point: text, device: text, sample: text, indicator: text, method: text, rule: numericRule, attempts: array(waterAttempt) }))
    }),
    'panel-03:suppliers': fields({
      suppliers: array(identified({ name: text, contact: text, positions: array(text) })),
      specs: array(identified({ version: number, criteria: array(criterion) })),
      samples: array(identified({ supplier: text, supply: text, kind: choices('lot', 'sample', 'replacement'), lot: text,
        spec: identified({ version: number, criteria: array(criterion) }), attempts: array(sampleAttempt) }))
    })
  };

  function keyKind(key) {
    if (Object.hasOwn(groups, key)) return key;
    if (key.startsWith('panel-03:event:') && key.length > 15) return 'event';
    if (key.startsWith('panel-03:quality:') && key.length > 17) return 'quality';
    return null;
  }

  function title(key) {
    return groups[key]?.[0] || (keyKind(key) === 'event' ? 'События' : 'Проверки качества');
  }

  function collections(key, value) {
    if (keyKind(key) === 'event' || keyKind(key) === 'quality') return [[value]];
    return groups[key][1] ? groups[key][1].map(name => value[name] ?? []) : [value];
  }

  function recordId(key, item) { return key === 'panel-03:economy' && Object.hasOwn(item, 'key') ? item.key : item.id; }

  function validateEntry(key, value) {
    const kind = keyKind(key);
    if (!kind) throw Error('Копия содержит неизвестный раздел.');
    const check = kind === 'event' ? identified({ title: text, date, start: text, end: text }) :
      kind === 'quality' ? quality : schemas[key];
    let valid = false;
    try { valid = check(value); } catch { /* Invalid dates are rejected below. */ }
    if (!valid) throw Error('Повреждён раздел «' + title(key) + '».');
    if ((kind === 'event' || kind === 'quality') && key !== 'panel-03:' + kind + ':' + value.id) {
      throw Error('Нарушен идентификатор записи.');
    }
    for (const list of collections(key, value)) {
      const ids = list.map(item => recordId(key, item));
      if (ids.some(id => !text(id) || !id) || new Set(ids).size !== ids.length) throw Error('Повторяются идентификаторы в разделе «' + title(key) + '».');
    }
  }

  function validate(records) {
    if (!object(records)) throw Error('В копии отсутствует список данных.');
    for (const [key, value] of Object.entries(records)) validateEntry(key, value);
    validateLinks(records);
    return records;
  }

  function validateLinks(records) {
    const catalog = records['panel-03:techcards'] || [];
    const economy = records['panel-03:economy'] || { supplies: [], links: [] };
    const training = records['panel-03:training'] || { team: [], skills: [], attempts: [] };
    const equipment = records['panel-03:equipment'] || { devices: [], jobs: [], water: [] };
    const suppliers = records['panel-03:suppliers'] || { suppliers: [], specs: [], samples: [] };
    const stock = records['panel-03:stock'] || { checks: [], writeOffs: [] };
    const exists = (list, id) => list.some(item => item.id === id);
    const link = (list, id, description) => {
      if (!exists(list, id)) throw Error('Нарушена связь «' + description + '».');
    };
    const network = records['panel-03:network'];
    const pointNames = new Set();
    for (const point of network?.points || []) {
      for (const label of [point.name, ...(point.aliases || [])]) {
        const key = portionNameKey(label);
        if (pointNames.has(key)) throw Error('Название точки или её прежнее название повторяется в карте сети.');
        pointNames.add(key);
      }
    }
    for (const item of records['panel-03:management'] || []) link(network?.points || [], item.pointId, 'Улучшение и точка');
    const launches = records['panel-03:launches'];
    if (launches) {
      const pointList = network?.points || [];
      const calibrations = records['panel-03:bar-operations'] || [];
      const sales = records['panel-03:sales'] || [];
      for (const item of launches.settings) link(pointList, item.pointId, 'Точка пилота и сеть');
      for (const project of launches.projects) {
        link(pointList, project.pointId, 'Проект и пилотная точка');
        const recipe = catalog.find(card => card.id === project.cardId)?.versions.find(version => version.number === project.version);
        if (!recipe?.portions[project.portion]?.criteria.length) throw Error('Нарушена связь «Пилот и редакция техкарты».');
        if (project.parentId) link(launches.projects.filter(item => item.id !== project.id && item.decision?.result === 'revise'),
          project.parentId, 'Доработка и прошлый пилот');
        function matchingChecks(pointId) {
          return calibrations.filter(item => item.type === 'calibration' && item.pointId === pointId &&
            item.cardId === project.cardId && item.version === project.version && item.portion === project.portion &&
            item.checks.length && item.checks.every(check => check.outcome === 'pass'));
        }
        function checkBasis(item, pointId) {
          link(matchingChecks(pointId).filter(check => check.date <= item.date), item.calibrationId, 'Допуск к пилоту или вводу и калибровка');
          for (const row of item.lots) {
            const sample = suppliers.samples.find(entry => entry.kind === 'lot' && entry.id === row.sampleId);
            if (!sample?.attempts.some(attempt => attempt.id === row.attemptId && attempt.decision === 'approved' && attempt.date <= item.date)) {
              throw Error('Нарушена связь «Пилот и одобренная партия».');
            }
          }
        }
        function checkFacts(item, pointId, from, to, recordedAfter) {
          if (!item) return;
          const matching = matchingChecks(pointId).filter(check => check.date <= to &&
            (check.date > from || check.date === from && check.createdAt >= recordedAfter));
          for (const id of item.quality) link(matching, id, 'Результат запуска и калибровка');
          for (const id of item.sales) link(sales, id, 'Результат запуска и продажи');
        }
        if (project.start) {
          checkBasis(project.start, project.pointId);
          if (project.decision) checkFacts(project.decision.observed, project.pointId, project.start.date,
            [project.decision.date, project.plannedTo].sort()[0], project.start.recordedAt);
        }
        for (const rollout of project.releases) {
          link(pointList, rollout.pointId, 'Ввод и точка');
          checkBasis(rollout, rollout.pointId);
          for (const review of rollout.reviews) checkFacts(review.observed, rollout.pointId, rollout.date, review.date, rollout.recordedAt);
        }
      }
    }
    const operations = records['panel-03:point-operations'];
    if (operations) {
      const pointList = network?.points || [];
      const jobs = new Set();
      for (const item of operations.plans) {
        link(pointList, item.id, 'График визитов и точка');
        if (item.baseVisitId && !operations.visits.some(visit => visit.id === item.baseVisitId && visit.pointId === item.id && visit.kind === 'regular')) {
          throw Error('Нарушена связь «График и регулярный визит».');
        }
      }
      for (const visit of operations.visits) {
        link(pointList, visit.pointId, 'Визит и точка');
        const pointIncidents = operations.incidents.filter(item => item.pointId === visit.pointId);
        if (visit.incidentId) link(pointIncidents.filter(item => item.date <= visit.date), visit.incidentId, 'Внеплановый визит и случай');
        for (const check of visit.checks) if (check.incidentId) {
          link(pointIncidents.filter(item => item.category === check.category), check.incidentId, 'Отклонение визита и случай');
        }
      }
      const calibrations = records['panel-03:bar-operations'] || [];
      for (const item of operations.incidents) {
        link(pointList, item.pointId, 'Случай и точка');
        if (item.deviceId) link(equipment.devices, item.deviceId, 'Случай и оборудование');
        if (item.jobId) {
          link(equipment.jobs.filter(job => job.device === item.deviceId), item.jobId, 'Приёмка и обслуживание');
          if (jobs.has(item.jobId)) throw Error('Для работы сохранено несколько приёмок.');
          jobs.add(item.jobId);
        }
        if (item.sampleId) link(suppliers.samples.filter(sample => sample.kind === 'lot'), item.sampleId, 'Случай и партия');
        for (const { fixedOn, check } of item.fixes) if (check?.calibrationId) {
          const evidence = calibrations.find(row => row.id === check.calibrationId && row.type === 'calibration' &&
            row.pointId === item.pointId && row.deviceId === item.deviceId && row.date >= fixedOn && row.date <= check.date &&
            row.checks.length && row.checks.every(reading => reading.outcome === 'pass'));
          if (!evidence) throw Error('Нарушена связь «Приёмка и проверка напитка».');
        }
      }
    }
    const financial = records['panel-03:financial-review'];
    if (financial) for (const item of [...financial.plans, ...financial.reviews]) {
      if (item.pointId) link(network?.points || [], item.pointId, 'Разбор экономики и точка');
    }
    for (const supply of economy.supplies) for (const price of supply.prices) {
      if (price.pointId) link(network?.points || [], price.pointId, 'Закупочная цена и точка');
    }
    for (const visit of records['panel-03:precision-visits'] || []) {
      link(network?.points || [], visit.pointId, 'Диагностика и точка');
    }
    const fieldVisits = records['panel-03:precision-visits'] || [];
    for (const baseline of records['panel-03:network-baselines'] || []) {
      link(network?.profiles || [], baseline.profileId, 'Исходная картина и паспорт');
      const baselineVisits = baseline.visitIds.map(id => fieldVisits.find(visit => visit.id === id && visit.confirmed));
      if (baselineVisits.some(visit => !visit) || new Set(baselineVisits.map(visit => visit.pointId)).size !== baselineVisits.length) {
        throw Error('Нарушена связь «Исходная картина и визиты».');
      }
    }
    function verifyMenuPortion(item, day) {
      const card = catalog.find(entry => entry.id === item.cardId);
      const version = card?.versions.find(entry => entry.number === item.version && entry.effective <= day);
      if (!version?.portions.some(portion => portionNameKey(portion.name) === item.portionKey)) {
        throw Error('Нарушена связь «Меню и редакция техкарты».');
      }
    }
    for (const plan of records['panel-03:menu-plans'] || []) {
      if (plan.pointId) link(network?.points || [], plan.pointId, 'Меню и точка');
      for (const row of plan.rows) verifyMenuPortion(row, plan.date);
    }
    const menuChanges = records['panel-03:menu-changes'] || [];
    for (const item of menuChanges) {
      link(network?.points || [], item.pointId, 'Изменение и точка');
      verifyMenuPortion(item, item.date);
    }
    for (const record of records['panel-03:bar-operations'] || []) {
      link(network?.points || [], record.pointId, 'Проверка бара и точка');
      if (record.type !== 'calibration') continue;
      const card = catalog.find(item => item.id === record.cardId);
      const version = card?.versions.find(item => item.number === record.version && item.effective <= record.date);
      const criteria = version?.portions[record.portion]?.criteria;
      const sameRule = (a, b) => a.type === b.type && (a.type === 'numeric'
        ? a.min === b.min && a.max === b.max && a.unit === b.unit : a.expected === b.expected);
      if (!criteria || criteria.length !== record.checks.length ||
          record.checks.some(({ name, rule }, index) => name !== criteria[index].name || !sameRule(rule, criteria[index].rule))) {
        throw Error('Нарушена связь «Калибровка и редакция техкарты».');
      }
      if (record.changeId) {
        const change = menuChanges.find(item => item.id === record.changeId);
        if (!change || change.pointId !== record.pointId || change.cardId !== record.cardId ||
            change.portionKey !== portionNameKey(version.portions[record.portion].name) || change.date > record.date) {
          throw Error('Нарушена связь «Калибровка и изменение».');
        }
      }
      if (record.deviceId) link(equipment.devices, record.deviceId, 'Калибровка и оборудование');
      if (record.sampleId) {
        const sample = suppliers.samples.find(item => item.id === record.sampleId && item.kind === 'lot');
        const approved = sample?.attempts.some(item => item.id === record.attemptId && item.decision === 'approved' && item.date <= record.date);
        if (!approved) throw Error('Нарушена связь «Калибровка и приёмка партии».');
      }
    }
    for (const item of economy.links) {
      let parts;
      try { parts = JSON.parse(item.key); } catch { throw Error('Повреждена связь сырья с техкартой.'); }
      if (!Array.isArray(parts) || parts.length !== 4 || !parts.every(text)) throw Error('Повреждена связь сырья с техкартой.');
      link(catalog, parts[0], 'Сырьё и техкарта');
      link(economy.supplies, item.supply, 'Закупочная позиция');
      for (const change of item.changes || []) {
        if (change.supply) link(economy.supplies, change.supply, 'История привязки закупочной позиции');
      }
    }
    for (const item of records['panel-03:sales'] || []) if (item.cardId) link(catalog, item.cardId, 'Продажи и техкарта');
    for (const item of [...stock.checks, ...stock.writeOffs]) link(economy.supplies, item.supply, 'Расход сырья');
    for (const plan of records['panel-03:training-plans'] || []) {
      link(training.team, plan.personId, 'План проверки и бариста');
      link(training.skills, plan.skillId, 'План проверки и навык');
      if (plan.id !== JSON.stringify([plan.personId, plan.skillId])) throw Error('Нарушен идентификатор плана проверки.');
    }
    for (const item of training.attempts) {
      link(training.team, item.personId, 'Бариста и попытка');
      link(training.skills, item.skillId, 'Навык и попытка');
      if (item.reviewerId) link(training.team, item.reviewerId, 'Проверка и наставник');
    }
    for (const person of training.team) {
      if (person.mentorId === person.id) throw Error('Сотрудник не может назначить наставником себя.');
      if (person.mentorId) link(training.team, person.mentorId, 'Сотрудник и наставник');
    }
    const programs = training.programs || [];
    for (const program of programs) for (const id of program.skillIds) link(training.skills, id, 'Программа роли и навык');
    for (const item of training.clearances || []) {
      link(training.team, item.personId, 'Допуск и сотрудник');
      const program = programs.find(entry => entry.id === item.programId);
      const attempts = item.attemptIds.map(id => training.attempts.find(entry => entry.id === id));
      const valid = program && program.role !== 'trainee' && program.date <= item.date && attempts.length === program.skillIds.length &&
        attempts.every(attempt => attempt && attempt.personId === item.personId && attempt.date <= item.date &&
          attempt.passed && attempt.independent && attempt.results.length &&
          attempt.results.every(check => check.passed)) &&
        program.skillIds.every(id => attempts.some(attempt => attempt.skillId === id));
      if (!valid) throw Error('Нарушена связь «Допуск, программа и практические проверки».');
    }
    for (const item of equipment.jobs) link(equipment.devices, item.device, 'Обслуживание и паспорт');
    for (const item of equipment.water) {
      if (item.device) link(equipment.devices, item.device, 'Замер воды и паспорт');
      if (!item.attempts.length) throw Error('В журнале воды отсутствует замер.');
    }
    for (const item of suppliers.suppliers) for (const id of item.positions) link(economy.supplies, id, 'Поставщик и сырьё');
    for (const item of suppliers.specs) link(economy.supplies, item.id, 'Требования к сырью');
    for (const item of suppliers.samples) {
      link(economy.supplies, item.supply, 'Проба и сырьё');
      link(suppliers.suppliers, item.supplier, 'Проба и поставщик');
      if (!item.attempts.length) throw Error('В пробе отсутствует результат.');
    }
    for (const [key, item] of Object.entries(records)) if (keyKind(key) === 'quality' && item.techCard) link(catalog, item.techCard.id, 'Проверка и техкарта');
  }

  function rawSnapshot(storage) {
    const raw = {};
    for (const key of Object.keys(storage).sort()) if (keyKind(key)) {
      const value = storage.getItem(key);
      if (value !== null) raw[key] = value;
    }
    return raw;
  }

  function parseRecords(raw) {
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
      try { return [key, JSON.parse(value)]; }
      catch { throw Error('Не удалось прочитать раздел «' + title(key) + '».'); }
    }));
  }

  function snapshot(storage) {
    return validate(parseRecords(rawSnapshot(storage)));
  }

  function exportData(storage) {
    return { format: 'panel-03-backup', version: 1, createdAt: new Date().toISOString(), records: snapshot(storage) };
  }

  function parseBackup(source) {
    let data;
    try { data = JSON.parse(source); } catch { throw Error('Файл не является корректной копией JSON.'); }
    if (data?.format !== 'panel-03-backup' || data.version !== 1 || !text(data.createdAt) || !Number.isFinite(Date.parse(data.createdAt))) {
      throw Error('Неизвестный формат или версия копии панели 03.');
    }
    validate(data.records);
    return data;
  }

  function merge(current, incoming) {
    const records = structuredClone(current);
    let added = 0;
    let retained = 0;
    function join(key, oldRows, newRows) {
      const ids = new Set(oldRows.map(item => recordId(key, item)));
      const additions = newRows.filter(item => !ids.has(recordId(key, item)));
      added += additions.length;
      retained += newRows.length - additions.length;
      return [...oldRows, ...additions];
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.hasOwn(records, key)) {
        records[key] = structuredClone(value);
        added += collections(key, value).reduce((count, list) => count + list.length, 0);
      } else if (keyKind(key) === 'event' || keyKind(key) === 'quality') {
        retained++;
      } else if (groups[key][1]) {
        for (const name of groups[key][1]) {
          const previous = records[key][name];
          if (previous || value[name]) records[key][name] = join(key, previous || [], value[name] || []);
        }
      } else records[key] = join(key, records[key], value);
    }
    validate(records);
    return { records, added, retained };
  }

  function salvageEntry(key, value, replacement) {
    function readableRows(rows, sample, replacementRows = []) {
      if (!Array.isArray(rows)) return [];
      const kept = new Map();
      const damagedIds = new Set();
      for (const row of rows) {
        const id = object(row) ? recordId(key, row) : null;
        try {
          validateEntry(key, sample(row));
          if (!kept.has(id)) kept.set(id, row);
        } catch {
          if (text(id) && id) damagedIds.add(id);
        }
      }
      const incomingIds = new Set(replacementRows.map(row => recordId(key, row)));
      if ([...damagedIds].some(id => !kept.has(id) && !incomingIds.has(id))) {
        throw Error('В копии нет повреждённой локальной записи из раздела «' + title(key) + '». Выбери другую копию.');
      }
      return [...kept.values()];
    }
    const kind = keyKind(key);
    if (kind === 'event' || kind === 'quality') return undefined;
    const names = groups[key][1];
    if (!names) return readableRows(value, row => [row], replacement);
    if (!object(value)) return undefined;
    const empty = Object.fromEntries(names.map(name => [name, []]));
    return { ...value, ...Object.fromEntries(names.map(name => [name,
      readableRows(value[name], row => ({ ...empty, [name]: [row] }), replacement[name])])) };
  }

  function prepareRestore(raw, incoming) {
    const current = {};
    const repaired = [];
    for (const [key, contents] of Object.entries(raw)) {
      let value;
      try {
        value = JSON.parse(contents);
        validateEntry(key, value);
        current[key] = value;
      } catch {
        if (!Object.hasOwn(incoming, key)) {
          throw Error('В копии нет данных для восстановления раздела «' + title(key) + '». Выбери другую копию.');
        }
        repaired.push(key);
        const readable = salvageEntry(key, value, incoming[key]);
        if (readable !== undefined) current[key] = readable;
      }
    }
    let needsOriginal = repaired.length > 0;
    try { validate(current); }
    catch { needsOriginal = true; }
    return { raw, current, result: merge(current, incoming), repaired, needsOriginal };
  }

  function restoreRaw(storage, before) {
    for (const [key, value] of Object.entries(before)) if (value === null) storage.removeItem(key);
    for (const [key, value] of Object.entries(before)) {
      if (value !== null && storage.getItem(key) !== value) storage.setItem(key, value);
    }
    storage.removeItem(transactionKey);
  }

  function recover(storage) {
    const raw = storage.getItem(transactionKey);
    if (raw === null) return;
    const journal = JSON.parse(raw);
    if (Object.hasOwn(journal, 'before')) {
      const before = journal.before;
      if (!object(before) || !Object.entries(before).every(([key, value]) => keyKind(key) && (value === null || text(value)))) {
        throw Error('Не удалось прочитать журнал восстановления.');
      }
      restoreRaw(storage, before);
      return;
    }
    validate(journal.old);
    const before = Object.fromEntries(Object.keys(rawSnapshot(storage)).map(key => [key, null]));
    for (const [key, value] of Object.entries(journal.old)) before[key] = JSON.stringify(value);
    restoreRaw(storage, before);
  }

  function commitPrepared(storage, { raw, current, result, repaired }) {
    if (JSON.stringify(rawSnapshot(storage)) !== JSON.stringify(raw)) throw Error('Данные изменились после проверки. Выбери файл заново.');
    const edits = Object.entries(result.records).filter(([key, value]) =>
      repaired.includes(key) || JSON.stringify(current[key]) !== JSON.stringify(value));
    if (!edits.length) return result;
    const before = Object.fromEntries(edits.map(([key]) => [key, raw[key] ?? null]));
    try {
      storage.setItem(transactionKey, JSON.stringify({ before }));
    } catch { throw Error('Не хватило места для восстановления. Исходные данные сохранены.'); }
    try {
      for (const [key, value] of edits) storage.setItem(key, JSON.stringify(value));
      storage.removeItem(transactionKey);
    } catch {
      try { restoreRaw(storage, before); }
      catch { throw Error('Восстановление прервано. Перезапусти панель для возврата к исходным данным.'); }
      throw Error('Не хватило места или хранилище недоступно. Исходные данные восстановлены.');
    }
    return result;
  }

  function commit(storage, current, incoming) {
    const raw = rawSnapshot(storage);
    if (JSON.stringify(validate(parseRecords(raw))) !== JSON.stringify(current)) throw Error('Данные изменились после проверки. Выбери файл заново.');
    return commitPrepared(storage, { raw, current, result: merge(current, incoming), repaired: [] });
  }

  function approvedLot(attempt) {
    return attempt?.decision === 'approved' && attempt.results.length > 0 &&
      attempt.results.every(item => item.passed || item.importance === 'advisory');
  }

  const core = { approvedLot, validate, snapshot, exportData, parseBackup, merge, commit, recover, transactionKey, title, collections };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  try { recover(localStorage); }
  catch {
    document.body.replaceChildren(document.createTextNode('Не удалось завершить возврат данных после прерванного восстановления. Освободи место в хранилище устройства и снова открой панель.'));
    window.stop();
    return;
  }

  window.panel03Backup = core;
  const dialog = document.querySelector('#backup-dialog');
  const message = document.querySelector('#backup-message');
  const preview = document.querySelector('#backup-preview');
  const restore = document.querySelector('#backup-restore');
  const input = document.querySelector('#backup-file');
  const rawExport = document.querySelector('#backup-export-original');
  let plan = null;
  let generation = 0;
  let afterRestore = null;
  let downloadedRaw;
  let restoring = false;

  function status(messageText) { message.textContent = messageText; }
  function updateConfirmation() {
    restore.disabled = restoring || Boolean(plan?.needsOriginal && downloadedRaw !== JSON.stringify(plan.raw));
  }
  function reset() {
    afterRestore = null;
    plan = null;
    preview.replaceChildren();
    restore.hidden = true;
    updateConfirmation();
    status('');
  }
  function checkLocal() {
    try {
      snapshot(localStorage);
      rawExport.hidden = true;
    } catch (error) {
      rawExport.hidden = false;
      return error.message;
    }
    return '';
  }
  function showTip(button, tip) {
    button.addEventListener('click', () => {
      document.querySelector('#backup-help-text').textContent = tip;
      document.querySelector('#backup-help').showModal();
    });
  }

  document.querySelector('#app-menu').addEventListener('click', () => document.querySelector('#app-menu-dialog').showModal());
  document.querySelector('#app-menu-close').addEventListener('click', () => document.querySelector('#app-menu-dialog').close());
  document.querySelector('#start-import')?.addEventListener('click', () => document.querySelector('#backup-open').click());
  document.querySelector('#backup-open').addEventListener('click', () => {
    document.querySelector('#app-menu-dialog').close();
    generation++;
    reset();
    input.value = '';
    status(checkLocal());
    dialog.showModal();
  });
  document.querySelector('#backup-close').addEventListener('click', () => { generation++; dialog.close(); });
  dialog.addEventListener('cancel', event => {
    if (restoring) event.preventDefault();
    else generation++;
  });
  document.querySelector('#backup-help-close').addEventListener('click', () => document.querySelector('#backup-help').close());
  showTip(document.querySelector('#backup-export-help'), 'Скачивает все рабочие данные панели 03 одним файлом. Выбери место сохранения на телефоне.');
  showTip(document.querySelector('#backup-file-help'), 'Выбери ранее сохранённый файл копии панели 03. Панель покажет его состав и проверит связи до восстановления.');
  showTip(document.querySelector('#backup-restore-help'), 'Добавляет отсутствующие записи. Совпадающие записи сохраняют текущую версию, включая историю внутри них.');

  function downloadJSON(prefix, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = prefix + data.createdAt.replace(/[:.]/g, '-') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  document.querySelector('#backup-export').addEventListener('click', () => {
    try {
      downloadJSON('03-rabota-', exportData(localStorage));
      status('Файл подготовлен для скачивания. Проверь его в загрузках.');
    } catch (problem) { rawExport.hidden = false; status(problem.message); }
  });

  rawExport.addEventListener('click', () => {
    try {
      const raw = rawSnapshot(localStorage);
      downloadJSON('03-rabota-original-', {
        format: 'panel-03-original-storage', version: 1, createdAt: new Date().toISOString(), raw
      });
      downloadedRaw = JSON.stringify(raw);
      updateConfirmation();
      status('Исходный файл подготовлен. Проверь его в загрузках перед восстановлением.');
    } catch (problem) { status(problem.message); }
  });

  function previewCandidate(data, restored = null, notice = '') {
    checkLocal();
    const prepared = prepareRestore(rawSnapshot(localStorage), data.records);
    const { result, repaired, needsOriginal } = prepared;
    const paragraph = document.createElement('p');
    paragraph.textContent = (notice ? notice + ' ' : '') + 'Копия от ' +
      new Date(data.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК).';
    const list = document.createElement('ul');
    const counts = new Map();
    for (const [key, value] of Object.entries(data.records)) {
      counts.set(title(key), (counts.get(title(key)) || 0) + collections(key, value).reduce((sum, rows) => sum + rows.length, 0));
    }
    for (const [label, amount] of counts) {
      const row = document.createElement('li');
      row.textContent = label + ' — ' + amount;
      list.append(row);
    }
    const summary = document.createElement('p');
    summary.textContent = 'Будет добавлено записей: ' + result.added + '. Уже есть: ' + result.retained + '.';
    const elements = [paragraph, list, summary];
    if (needsOriginal) {
      const warning = document.createElement('p');
      const sections = [...new Set(repaired.map(title))].join(', ');
      warning.textContent = (sections ? 'Восстанавливаемые разделы — ' + sections + '. ' : 'Копия восстанавливает связи между записями. ') +
        'Читаемые записи сохранятся. Скачай исходные данные и проверь файл в загрузках.';
      elements.push(warning);
      rawExport.hidden = false;
    }
    preview.replaceChildren(...elements);
    plan = prepared;
    restore.hidden = false;
    updateConfirmation();
    status('Формат и связи проверены.');
    afterRestore = restored;
  }

  window.addEventListener('panel-03:backup-candidate', event => {
    try {
      generation++;
      reset();
      if (!dialog.open) dialog.showModal();
      const data = parseBackup(JSON.stringify(event.detail.backup));
      previewCandidate(data, event.detail.restored, event.detail.notice);
    } catch (problem) { status(problem.message); }
  });

  input.addEventListener('change', async () => {
    const chosen = ++generation;
    reset();
    const file = input.files[0];
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      if (chosen !== generation) return;
      previewCandidate(data);
    } catch (problem) { if (chosen === generation) status(problem.message); }
  });

  restore.addEventListener('click', async () => {
    if (!plan || restore.disabled) return;
    restoring = true;
    updateConfirmation();
    input.disabled = true;
    rawExport.disabled = true;
    document.querySelector('#backup-close').disabled = true;
    const prepared = plan;
    try {
      const run = () => commitPrepared(localStorage, prepared);
      const result = navigator.locks ? await navigator.locks.request('panel-03-restore', run) : run();
      status('Готово. Добавлено: ' + result.added + '. Уже было: ' + result.retained + '.');
      if (afterRestore) {
        try { afterRestore(); }
        catch { status('Данные восстановлены. Настройки отправки не сохранены: проверь подключение Google перед отправкой.'); }
      }
      afterRestore = null;
      plan = null;
      rawExport.hidden = true;
      restore.hidden = true;
      // Existing journal readers refresh through their standard storage handlers.
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      window.dispatchEvent(new Event('hashchange'));
    } catch (problem) { status(problem.message); }
    finally {
      restoring = false;
      updateConfirmation();
      input.disabled = false;
      rawExport.disabled = false;
      document.querySelector('#backup-close').disabled = false;
    }
  });
})();
