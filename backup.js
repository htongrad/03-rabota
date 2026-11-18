(() => {
  'use strict';

  const groups = {
    'panel-03:network': ['Развитие и точки', ['profiles', 'points']],
    'panel-03:techcards': ['Техкарты', null],
    'panel-03:economy': ['Экономика', ['supplies', 'links']],
    'panel-03:sales': ['Дневные продажи', null],
    'panel-03:stock': ['Списания и сверки', ['writeOffs', 'checks']],
    'panel-03:training': ['Обучение', ['team', 'skills', 'attempts']],
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
  const criterion = fields({ name: text, rule });
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
  const price = fields({ cost: number, amount: value => number(value) && value > 0, unit: text, date, density: nullable(number) });
  const waterPlan = fields({ action: text, owner: text, date });
  const waterAttempt = fields({ date, amount: number, passed: boolean, plan: nullable(waterPlan) });
  const sampleAttempt = identified({
    date, conditions: text, results: array(performance), quote: nullable(fields({ cost: number, amount: value => number(value) && value > 0, unit: text })),
    decision: choices('approved', 'repeat', 'rejected'), reason: text, follow: text, next: maybeDate,
    transition: maybeDate, impactNote: text, impact: array(fields({ title: text, delta: nullable(number) }))
  });
  const networkPoint = identified({
    name: value => text(value) && Boolean(value.trim()), manager: text, menu: text,
    teamIds: array(text), deviceIds: array(text), equipmentNotes: text, reviewed: boolean
  });
  const schemas = {
    'panel-03:network': fields({
      profiles: array(identified({ purpose: text, scope: text, leadership: text, authority: text, basis: text, effective: date, savedAt: text })),
      points: array(networkPoint)
    }),
    'panel-03:techcards': array(identified({
      draft: nullable(draftRecipe),
      versions: array(value => recipe(value) && fields({ number, effective: date })(value))
    })),
    'panel-03:economy': fields({
      supplies: array(identified({ name: text, prices: array(price) })),
      links: array(fields({ key: text, supply: text }))
    }),
    'panel-03:sales': array(identified({
      date, point: text, cardId: nullable(text), drink: text, portion: text,
      quantity: value => Number.isSafeInteger(value) && value >= 0,
      returned: nullable(value => Number.isSafeInteger(value) && value >= 0), revenue: Number.isSafeInteger
    })),
    'panel-03:stock': fields({
      writeOffs: array(identified({ point: text, supply: text, date, amount: number, unit: text, reason: choices('tuning', 'tasting', 'training', 'spoilage', 'other'), note: text })),
      checks: array(identified({ point: text, supply: text, from: date, to: date, unit: text, coverage: choices('open', 'complete'), note: text,
        opening: number, closing: number, received: number, incoming: number, outgoing: number, returned: number }))
    }),
    'panel-03:training': fields({
      team: array(identified({ name: text, point: text })),
      skills: array(identified({ version: number, name: text, task: text, criteria: array(templateCriterion) })),
      attempts: array(identified({ personId: text, skillId: text, version: number, skill: text, task: text, date,
        point: text, reviewer: text, independent: boolean, passed: boolean, results: array(performance), feedback: text, exercise: text, next: maybeDate }))
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
    return groups[key][1] ? groups[key][1].map(name => value[name]) : [value];
  }

  function recordId(key, item) { return key === 'panel-03:economy' && Object.hasOwn(item, 'key') ? item.key : item.id; }

  function validate(records) {
    if (!object(records)) throw Error('В копии отсутствует список данных.');
    for (const [key, value] of Object.entries(records)) {
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
    for (const item of economy.links) {
      let parts;
      try { parts = JSON.parse(item.key); } catch { throw Error('Повреждена связь сырья с техкартой.'); }
      if (!Array.isArray(parts) || parts.length !== 4 || !parts.every(text)) throw Error('Повреждена связь сырья с техкартой.');
      link(catalog, parts[0], 'Сырьё и техкарта');
      link(economy.supplies, item.supply, 'Закупочная позиция');
    }
    for (const item of records['panel-03:sales'] || []) if (item.cardId) link(catalog, item.cardId, 'Продажи и техкарта');
    for (const item of [...stock.checks, ...stock.writeOffs]) link(economy.supplies, item.supply, 'Расход сырья');
    for (const item of training.attempts) {
      link(training.team, item.personId, 'Бариста и попытка');
      link(training.skills, item.skillId, 'Навык и попытка');
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

  function snapshot(storage) {
    const records = {};
    for (const key of Object.keys(storage).sort()) if (keyKind(key)) {
      try { records[key] = JSON.parse(storage.getItem(key)); }
      catch { throw Error('Не удалось прочитать раздел «' + title(key) + '».'); }
    }
    return validate(records);
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
        for (const name of groups[key][1]) records[key][name] = join(key, records[key][name], value[name]);
      } else records[key] = join(key, records[key], value);
    }
    validate(records);
    return { records, added, retained };
  }

  function restoreOld(storage, old) {
    for (const key of Object.keys(storage)) if (keyKind(key) && !Object.hasOwn(old, key)) storage.removeItem(key);
    for (const [key, value] of Object.entries(old)) storage.setItem(key, JSON.stringify(value));
    storage.removeItem(transactionKey);
  }

  function recover(storage) {
    const raw = storage.getItem(transactionKey);
    if (raw === null) return;
    const journal = JSON.parse(raw);
    validate(journal.old);
    restoreOld(storage, journal.old);
  }

  function commit(storage, current, incoming) {
    if (JSON.stringify(snapshot(storage)) !== JSON.stringify(current)) throw Error('Данные изменились после проверки. Выбери файл заново.');
    const result = merge(current, incoming);
    if (!result.added) return result;
    storage.setItem(transactionKey, JSON.stringify({ old: current }));
    try {
      for (const [key, value] of Object.entries(result.records)) {
        if (JSON.stringify(current[key]) !== JSON.stringify(value)) storage.setItem(key, JSON.stringify(value));
      }
      storage.removeItem(transactionKey);
    } catch {
      try { restoreOld(storage, current); }
      catch { throw Error('Восстановление прервано. Перезапусти панель для возврата к исходным данным.'); }
      throw Error('Не хватило места или хранилище недоступно. Исходные данные восстановлены.');
    }
    return result;
  }

  const core = { validate, snapshot, exportData, parseBackup, merge, commit, recover, transactionKey, title, collections };
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
  let pending = null;
  let current = null;
  let generation = 0;
  let afterRestore = null;

  function status(messageText) { message.textContent = messageText; }
  function reset() { afterRestore = null; pending = null; current = null; preview.replaceChildren(); restore.hidden = true; status(''); }
  function showTip(button, tip) {
    button.addEventListener('click', () => {
      document.querySelector('#backup-help-text').textContent = tip;
      document.querySelector('#backup-help').showModal();
    });
  }

  document.querySelector('#app-menu').addEventListener('click', () => document.querySelector('#app-menu-dialog').showModal());
  document.querySelector('#app-menu-close').addEventListener('click', () => document.querySelector('#app-menu-dialog').close());
  document.querySelector('#backup-open').addEventListener('click', () => {
    document.querySelector('#app-menu-dialog').close();
    generation++;
    reset();
    input.value = '';
    dialog.showModal();
  });
  document.querySelector('#backup-close').addEventListener('click', () => { generation++; dialog.close(); });
  dialog.addEventListener('cancel', event => {
    if (restore.disabled) event.preventDefault();
    else generation++;
  });
  document.querySelector('#backup-help-close').addEventListener('click', () => document.querySelector('#backup-help').close());
  showTip(document.querySelector('#backup-export-help'), 'Скачивает все рабочие данные панели 03 одним файлом. Выбери место сохранения на телефоне.');
  showTip(document.querySelector('#backup-file-help'), 'Выбери ранее сохранённый файл копии панели 03. Панель покажет его состав и проверит связи до восстановления.');
  showTip(document.querySelector('#backup-restore-help'), 'Добавляет отсутствующие записи. Совпадающие записи сохраняют текущую версию, включая историю внутри них.');

  document.querySelector('#backup-export').addEventListener('click', () => {
    try {
      const data = exportData(localStorage);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '03-rabota-' + data.createdAt.replace(/[:.]/g, '-') + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status('Файл подготовлен для скачивания. Проверь его в загрузках.');
    } catch (problem) { status(problem.message); }
  });

  function previewCandidate(data, restored = null) {
      const before = snapshot(localStorage);
      const result = merge(before, data.records);
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Копия от ' + new Date(data.createdAt).toLocaleString('ru-RU') + '.';
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
      summary.textContent = 'Будет добавлено: ' + result.added + '. Уже есть: ' + result.retained + '.';
      preview.replaceChildren(paragraph, list, summary);
      pending = data;
      current = before;
      restore.hidden = false;
      status('Формат и связи проверены.');
      afterRestore = restored;
  }

  window.addEventListener('panel-03:backup-candidate', event => {
    try {
      generation++;
      reset();
      const data = parseBackup(JSON.stringify(event.detail.backup));
      previewCandidate(data, event.detail.restored);
      if (!dialog.open) dialog.showModal();
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
    if (!pending) return;
    restore.disabled = true;
    input.disabled = true;
    document.querySelector('#backup-close').disabled = true;
    const baseline = current;
    const incoming = pending.records;
    try {
      const run = () => commit(localStorage, baseline, incoming);
      const result = navigator.locks ? await navigator.locks.request('panel-03-restore', run) : run();
      status('Готово. Добавлено: ' + result.added + '. Уже было: ' + result.retained + '.');
      if (afterRestore) {
        try { afterRestore(); }
        catch { status('Данные восстановлены. Настройки отправки не сохранены: проверь подключение Google перед отправкой.'); }
      }
      afterRestore = null;
      pending = null;
      current = null;
      restore.hidden = true;
      // Existing journal readers refresh through their standard storage handlers.
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      window.dispatchEvent(new Event('hashchange'));
    } catch (problem) { status(problem.message); }
    finally { restore.disabled = false; input.disabled = false; document.querySelector('#backup-close').disabled = false; }
  });
})();
