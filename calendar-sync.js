(() => {
  'use strict';
  const base = 'https://www.googleapis.com/calendar/v3';
  const name = '03 РАБОТА';
  const tag = 'rabota03';
  const eventZone = 'Europe/Moscow';
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
    throw Error('Время события не существует в указанном часовом поясе. Уточни время в панели.');
  }

  const plus = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days*86400000).toISOString().slice(0,10);
  const compact = date => date.replaceAll('-','');
  const freq = {daily:'DAILY',weekdays:'WEEKLY;BYDAY=MO,TU,WE,TH,FR',weekly:'WEEKLY',monthly:'MONTHLY',yearly:'YEARLY'};
  function payload(event, zone) {
    return {summary:event.title,start:event.allDay ? {date:event.date} : {dateTime:instant(event.date,event.start,zone),timeZone:zone},
      end:event.allDay ? {date:plus(event.date,1)} : {dateTime:instant(event.date,event.end,zone),timeZone:zone}};
  }
  function workPayload(event, entry, slot, zone, workLink) {
    const item = payload(entry, zone);
    const work = event.workLog?.[slot] ?? entry.work ?? event.work;
    if (work?.status === 'done') item.summary = 'Готово · ' + item.summary;
    if (work?.status === 'waiting') item.summary = 'Ожидает · ' + item.summary;
    if (workLink) item.description = `<a href="${workLink(event.id, slot)}">Открыть дело в панели 03</a>`;
    if (event.legacyTaskId) item.transparency = entry.allDay ? 'transparent' : 'opaque';
    return item;
  }
  function calendarRows(events, zone, workLink) {
    const rows = new Map();
    for (const event of events) {
      if (!event.date) continue;
      const recurring = event.repeat !== 'none';
      let start = event.date;
      if (event.repeat === 'weekdays') {
        while ([0,6].includes(new Date(start+'T00:00:00Z').getUTCDay())) start = plus(start,1);
      }
      if (!window.panelRecords.occurs(event,start)) continue;
      const item = workPayload(event, {...event,date:start}, recurring ? null : start, zone, workLink);
      if (recurring) {
        let rule = 'RRULE:FREQ=' + freq[event.repeat];
        const stop = event.stopBefore ? plus(event.stopBefore,-1) : '';
        const until = event.ending === 'date' ? event.until : '';
        const limit = [stop,until].filter(Boolean).sort()[0];
        if (event.ending === 'count') {
          const beforeLimit = limit ? window.panelRecords.countThrough(event,limit) : event.count;
          rule += ';COUNT=' + Math.min(beforeLimit,event.count);
        } else if (limit) {
          rule += ';COUNT=' + window.panelRecords.countThrough(event,limit);
        }
        const handled = Object.entries(event.workLog ?? {}).filter(([, work]) => work.status !== 'open').map(([slot]) => slot);
        const slots = [...new Set([...Object.keys(event.exceptions), ...handled])]
          .filter(slot => window.panelRecords.occurs(event,slot)).sort();
        item.recurrence = [rule];
        if (slots.length) {
          item.recurrence.push(event.allDay ? 'EXDATE;VALUE=DATE:'+slots.map(compact).join(',')
            : 'EXDATE;TZID='+zone+':'+slots.map(slot => compact(slot)+'T'+event.start.replace(':','')+'00').join(','));
        }
        for (const slot of slots) {
          const changed = Object.hasOwn(event.exceptions, slot) ? event.exceptions[slot] : {...event, date:slot};
          if (changed) rows.set(JSON.stringify(['event',event.id,slot]), workPayload(event, changed, slot, zone, workLink));
        }
      }
      const key = event.legacyTaskId ? ['task',event.legacyTaskId] : ['event',event.id];
      rows.set(JSON.stringify(key),item);
    }
    return rows;
  }
  const isTaskKey = key => key.startsWith('["task",');
  function belongs(event, key) { return event.extendedProperties?.private?.panel === tag && event.extendedProperties.private.key === key; }
  function same(remote, body) {
    const stamp = value => value?.date || (value?.dateTime ? new Date(value.dateTime).toISOString() : '');
    return remote.status !== 'cancelled' && remote.summary === body.summary &&
      (remote.description || '') === (body.description || '') && (remote.location || '') === (body.location || '') &&
      (!body.transparency || remote.transparency === body.transparency) &&
      stamp(remote.start) === stamp(body.start) && stamp(remote.end) === stamp(body.end) && JSON.stringify(remote.recurrence || []) === JSON.stringify(body.recurrence || []);
  }

  async function mirror({ request, settings, update, digest, events, workLink }) {
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
    if (calendar.primary || calendar.deleted || calendar.summary?.trim() !== name || calendar.accessRole !== 'owner' || !calendar.id) throw Error('Проверь доступ и название календаря «03 РАБОТА».');
    const desired = calendarRows(events, eventZone, workLink);
    update({ calendarId: calendar.id, calendarZone: eventZone });
    const url = base + '/calendars/' + encode(calendar.id) + '/events';
    const remote = await list(url, { privateExtendedProperty: 'panel=' + tag, maxResults: '2500', showDeleted: 'false', fields: 'nextPageToken,items(id,etag,status,summary,description,location,transparency,start,end,recurrence,extendedProperties)' });
    // Older builds may still sync ordinary events in another tab.
    const known = new Map([...(settings.calendarKnown || []), ...(settings.calendarTaskKnown || [])].map(item => [item.id, item.key]));
    function savedKeys(items) {
      return {
        calendarKnown:items.filter(item => !isTaskKey(item.key)),
        calendarTaskKnown:items.filter(item => isTaskKey(item.key)),
      };
    }
    const active = new Map();
    for (const item of remote) {
      const key = item.extendedProperties?.private?.key;
      if (!belongs(item, key) || !key || item.status === 'cancelled') continue;
      if (active.has(key)) throw Error('В календаре несколько копий одного действия. Отправка остановлена для проверки.');
      active.set(key, item);
    }
    function remember(id, key) {
      known.set(id, key);
      update(savedKeys(Array.from(known, ([id, key]) => ({ id, key }))));
    }
    async function createRecord(key, entry) {
      for (let attempt = 0; attempt < 16; attempt++) {
        // Deleted deadlines can leave an ID reserved in Google's trash.
        const suffix = attempt ? '\0' + attempt : '';
        const id = 'r03' + await digest(calendar.id + '\0' + key + suffix);
        remember(id, key);
        const response = await request(url + query({ sendUpdates: 'none' }), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...entry })
        }, false, [409]);
        if (response.status !== 409) return response.json();
        const existing = await request(url + '/' + encode(id), {}, false, [410]);
        if (existing.status === 410) continue;
        const record = await existing.json();
        if (record.status === 'cancelled') continue;
        if (!belongs(record, key)) throw Error('Идентификатор события занят другой записью. Она оставлена без изменений.');
        return record;
      }
      throw Error('Google пока удерживает идентификаторы удалённых записей. Повтори синхронизацию.');
    }
    const confirmed = [];
    for (const [key, body] of desired) {
      const entry = { ...body, extendedProperties: { private: { panel: tag, key } } };
      const current = active.get(key) ?? await createRecord(key, entry);
      if (!belongs(current, key)) throw Error('Google не подтвердил принадлежность события панели.');
      remember(current.id, key);
      if (!same(current, body)) {
        if (!current.etag) throw Error('Google не вернул версию события. Повтори отправку.');
        const times = Object.fromEntries(['start', 'end'].map(side => [side, body[side].date ? { dateTime: null, timeZone: null, ...body[side] } : { date: null, ...body[side] }]));
        await request(url + '/' + encode(current.id) + query({ sendUpdates: 'none' }), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': current.etag }, body: JSON.stringify({ ...entry, ...times, status: 'confirmed', recurrence: body.recurrence || [] }) });
      }
      confirmed.push({ id: current.id, key });
    }
    for (const current of remote) {
      const key = known.get(current.id);
      // Retire prototype deadlines from sync without deleting them in Google Calendar.
      if (!key || key.startsWith('["event","chef:') || desired.has(key) || !belongs(current, key) || current.status === 'cancelled') continue;
      if (!current.etag) throw Error('Google не вернул версию удаляемого события. Повтори отправку.');
      await request(url + '/' + encode(current.id) + query({ sendUpdates: 'none' }), { method: 'DELETE', headers: { 'If-Match': current.etag } }, false, [404, 410]);
    }
    update({ ...savedKeys(confirmed), calendarLastSync: new Date().toISOString() });
    return desired.size;
  }

  const core = { scopes, mirror };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else window.panel03GoogleCalendar = core;
})();
