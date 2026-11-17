(() => {
  'use strict';
  const base = 'https://www.googleapis.com/calendar/v3';
  const name = '03 РАБОТА';
  const tag = 'rabota03';
  const scopes = ['https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
  const query = values => '?' + new URLSearchParams(values);
  const encode = encodeURIComponent;
  const dayAfter = day => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const validDate = day => /^\d{4}-\d\d-\d\d$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;

  function instant(day, time, zone) {
    if (!validDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('В событии некорректная дата или время.');
    const target = Date.parse(day + 'T' + time + ':00Z');
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    function localStamp(value) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
      return Date.parse(parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + 'Z');
    }
    let value = target;
    for (let i = 0; i < 4; i++) {
      const difference = target - localStamp(value);
      if (!difference) return new Date(value).toISOString();
      value += difference;
    }
    throw Error('Время события не существует в часовом поясе календаря. Уточни время в панели.');
  }

  function build(events, work, zone) {
    const desired = new Map();
    function add(key, title, day, start, end, description, location = '') {
      if (!validDate(day) || !title) throw Error('Не удалось проверить дату или название события.');
      let times;
      if (!start) times = { start: { date: day }, end: { date: dayAfter(day) } };
      else {
        const startTime = instant(day, start, zone);
        const endTime = end ? instant(day, end, zone) : new Date(Date.parse(startTime) + 3600000).toISOString();
        if (Date.parse(endTime) <= Date.parse(startTime)) throw Error('Окончание события должно быть позже начала.');
        times = { start: { dateTime: startTime, timeZone: zone }, end: { dateTime: endTime, timeZone: zone } };
      }
      if (desired.has(key)) throw Error('У рабочих действий совпали идентификаторы. Отправка календаря остановлена.');
      desired.set(key, { summary: title, description, location, ...times });
    }
    for (const event of events) add(JSON.stringify(['event', event.id]), event.title, event.date, event.start, event.end,
      'Создано в панели «03 Работа». Изменяй событие в панели.');
    for (const row of work) {
      if (!row.date) continue;
      add(row.key, row.title, row.date, '', '', ['Рабочее действие из панели «03 Работа».', row.detail,
        row.owner ? 'Ответственный: ' + row.owner : '', 'Изменяй срок и результат в исходном журнале панели.'].filter(Boolean).join('\n'), row.point || '');
    }
    return desired;
  }

  function belongs(event, key) { return event.extendedProperties?.private?.panel === tag && event.extendedProperties.private.key === key; }
  function same(remote, body) {
    const stamp = value => value?.date || (value?.dateTime ? new Date(value.dateTime).toISOString() : '');
    return remote.status !== 'cancelled' && remote.summary === body.summary &&
      (remote.description || '') === body.description && (remote.location || '') === body.location &&
      stamp(remote.start) === stamp(body.start) && stamp(remote.end) === stamp(body.end) && !remote.recurrence?.length;
  }

  async function mirror({ request, settings, update, digest, events, work }) {
    async function list(url, params) {
      const rows = [];
      let pageToken;
      do {
        const data = await (await request(url + query({ ...params, ...(pageToken ? { pageToken } : {}) }))).json();
        rows.push(...(data.items || []));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return rows;
    }
    let calendar;
    if (settings.calendarId) calendar = await (await request(base + '/users/me/calendarList/' + encode(settings.calendarId))).json();
    else {
      const calendars = await list(base + '/users/me/calendarList', { minAccessRole: 'owner', showHidden: 'true', maxResults: '250', fields: 'nextPageToken,items(id,summary,accessRole,timeZone,primary,deleted)' });
      const found = calendars.filter(item => !item.primary && !item.deleted && item.accessRole === 'owner' && item.summary?.trim() === name);
      if (found.length !== 1) throw Error(found.length ? 'Найдено несколько календарей «03 РАБОТА». Оставь это название у одного рабочего календаря.' : 'Не найден твой календарь «03 РАБОТА». Проверь название и выбранный аккаунт.');
      calendar = found[0];
    }
    if (calendar.primary || calendar.deleted || calendar.summary?.trim() !== name || calendar.accessRole !== 'owner' || !calendar.id || !calendar.timeZone) throw Error('Проверь доступ и название календаря «03 РАБОТА».');
    const desired = build(events, work, calendar.timeZone);
    update({ calendarId: calendar.id, calendarZone: calendar.timeZone });
    const url = base + '/calendars/' + encode(calendar.id) + '/events';
    const remote = await list(url, { privateExtendedProperty: 'panel=' + tag, maxResults: '2500', showDeleted: 'false', fields: 'nextPageToken,items(id,etag,status,summary,description,location,start,end,recurrence,extendedProperties)' });
    const known = new Map((settings.calendarKnown || []).map(item => [item.id, item.key]));
    const active = new Map();
    for (const item of remote) {
      const key = item.extendedProperties?.private?.key;
      if (!belongs(item, key) || !key || item.status === 'cancelled') continue;
      if (active.has(key)) throw Error('В календаре несколько копий одного действия. Отправка остановлена для проверки.');
      active.set(key, item);
    }
    function remember(id, key) {
      known.set(id, key);
      update({ calendarKnown: Array.from(known, ([id, key]) => ({ id, key })) });
    }
    const confirmed = [];
    for (const [key, body] of desired) {
      let current = active.get(key);
      const id = current?.id || 'r03' + await digest(calendar.id + '\0' + key);
      const entry = { ...body, extendedProperties: { private: { panel: tag, key } } };
      if (!current) {
        remember(id, key);
        const response = await request(url + query({ sendUpdates: 'none' }), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...entry })
        }, false, [409]);
        if (response.status === 409) {
          current = await (await request(url + '/' + encode(id))).json();
          if (!belongs(current, key)) throw Error('Идентификатор события занят другой записью. Она оставлена без изменений.');
        } else current = await response.json();
      }
      if (!belongs(current, key)) throw Error('Google не подтвердил принадлежность события панели.');
      remember(current.id, key);
      if (!same(current, body)) {
        if (!current.etag) throw Error('Google не вернул версию события. Повтори отправку.');
        const times = Object.fromEntries(['start', 'end'].map(side => [side, body[side].date ? { dateTime: null, timeZone: null, ...body[side] } : { date: null, ...body[side] }]));
        await request(url + '/' + encode(current.id) + query({ sendUpdates: 'none' }), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': current.etag }, body: JSON.stringify({ ...entry, ...times, status: 'confirmed', recurrence: [] }) });
      }
      confirmed.push({ id: current.id, key });
    }
    for (const current of remote) {
      const key = known.get(current.id);
      if (!key || desired.has(key) || !belongs(current, key) || current.status === 'cancelled') continue;
      if (!current.etag) throw Error('Google не вернул версию удаляемого события. Повтори отправку.');
      await request(url + '/' + encode(current.id) + query({ sendUpdates: 'none' }), { method: 'DELETE', headers: { 'If-Match': current.etag } }, false, [404, 410]);
    }
    update({ calendarKnown: confirmed, calendarLastSync: new Date().toISOString() });
    return desired.size;
  }

  const core = { scopes, build, instant, mirror };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else window.panel03GoogleCalendar = core;
})();
