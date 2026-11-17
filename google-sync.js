(() => {
  'use strict';

  const stateKey = 'panel-03:google';
  const api = 'https://www.googleapis.com/drive/v2/files';
  const upload = 'https://www.googleapis.com/upload/drive/v2/files';
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const folderName = '03 РАБОТА';
  const fileName = 'Работа — резервная копия.json';
  const tag = 'rabota03';
  const core = window.panel03Backup;
  const calendar = window.panel03GoogleCalendar;
  const $ = selector => document.querySelector(selector);
  let token = '';
  let expires = 0;
  let tokenClient;
  let calendarTokenClient;
  let calendarGranted = false;
  let calendarMessage = '';
  let calendarPoll = 0;
  let calendarRetryAfter = 0;
  let authLoading;
  let busy = false;
  let connecting = false;
  let message = '';
  let retryAfter = 0;
  let cachedLocal = '';
  let localHash = '';
  let dirtySince = 0;
  let remotePoll = 0;
  let monitoring = false;

  function read() {
    const value = JSON.parse(localStorage.getItem(stateKey));
    if (value && (typeof value !== 'object' || Array.isArray(value))) throw Error('Настройки Google повреждены.');
    return value || {};
  }
  function update(changes) {
    const next = { ...read(), ...changes };
    localStorage.setItem(stateKey, JSON.stringify(next));
    return next;
  }
  function ready() { return Boolean(token && Date.now() < expires); }
  const metaFields = 'id,etag,version,title,mimeType,parents(id),labels(trashed),properties';
  const encode = encodeURIComponent;
  const query = data => '?' + new URLSearchParams(data);
  function conflict() {
    update({ paused: true });
    throw Error('Копия на Диске обновлена другим браузером. Сначала восстанови её.');
  }

  async function request(url, options = {}, allow404 = false, acceptedStatuses = []) {
    if (!ready()) throw Error('Доступ Google истёк. Нажми «Подключить Google».');
    const response = await fetch(url, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }
    });
    if (response.status === 401) { token = ''; expires = 0; }
    if (response.status === 412) {
      if (url.startsWith('https://www.googleapis.com/calendar/')) throw Error('Событие изменилось во время отправки. Повторю проверку календаря.');
      conflict();
    }
    if (acceptedStatuses.includes(response.status)) return response;
    if (response.status === 404 && allow404) return null;
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw Error('Google ' + response.status + (error?.error?.message ? ' · ' + error.error.message : ''));
    }
    return response;
  }

  async function metadata(id, allow404 = false) {
    const response = await request(api + '/' + encode(id) + query({ fields: metaFields }), {}, allow404);
    return response ? response.json() : null;
  }

  function verifyFile(info, settings) {
    if (info.labels?.trashed || info.mimeType !== 'application/json' ||
        !info.parents?.some(parent => parent.id === settings.folder) ||
        !info.properties?.some(property => property.key === 'panelBackup' && property.value === tag)) {
      throw Error('Копия перемещена, удалена или имеет другой формат. Проверь выбранную папку.');
    }
  }

  async function findFile(settings) {
    if (settings.fileId) {
      const info = await metadata(settings.fileId);
      verifyFile(info, settings);
      return info;
    }
    const list = [];
    let pageToken = '';
    do {
      const params = {
        q: "trashed = false and '" + settings.folder + "' in parents and properties has { key='panelBackup' and value='" + tag + "' and visibility='PRIVATE' }",
        fields: 'nextPageToken,items(' + metaFields + ')', maxResults: '100',
        ...(pageToken ? { pageToken } : {})
      };
      const result = await (await request(api + query(params))).json();
      list.push(...(result.items || []));
      pageToken = result.nextPageToken;
    } while (pageToken);
    if (list.length > 1) throw Error('В папке несколько копий панели 03. Уточни файлы на Диске перед отправкой.');
    if (list[0]) verifyFile(list[0], settings);
    return list[0] || null;
  }

  async function download(info) {
    const response = await request(api + '/' + encode(info.id) + '?alt=media', { headers: { 'If-Match': info.etag } });
    const backup = core.parseBackup(await response.text());
    const after = await metadata(info.id);
    if (after.etag !== info.etag) conflict();
    return backup;
  }

  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function script(url) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = url;
      element.onload = resolve;
      element.onerror = () => { element.remove(); reject(Error('Не удалось загрузить Google. Проверь интернет.')); };
      document.head.append(element);
    });
  }

  async function prepare() {
    if (authLoading) return authLoading;
    authLoading = (async () => {
      if (!window.google?.accounts?.oauth2) await script('https://accounts.google.com/gsi/client');
      const settings = read();
      function makeClient(withCalendar) {
        return window.google.accounts.oauth2.initTokenClient({
          client_id: settings.clientId,
          scope: ['openid', scope, ...(withCalendar ? calendar.scopes : [])].join(' '),
          callback: result => {
            connecting = false;
            if (result.error || !window.google.accounts.oauth2.hasGrantedAllScopes(result, 'openid', scope)) {
              message = 'Разреши доступ к выбранным файлам Google Диска для резервирования.';
              if (withCalendar) calendarMessage = 'Подключение календаря не завершено. Можно повторить.';
              paint();
              return;
            }
            token = result.access_token;
            expires = Date.now() + Number(result.expires_in) * 1000 - 30000;
            calendarGranted = window.google.accounts.oauth2.hasGrantedAllScopes(result, ...calendar.scopes);
            if (withCalendar && !calendarGranted) calendarMessage = 'Для зеркала разреши доступ к списку календарей и событиям своих календарей.';
            run(async () => {
              try {
                const profile = await (await request('https://openidconnect.googleapis.com/v1/userinfo')).json();
                const current = read();
                if (!profile.sub || (current.account && current.account !== profile.sub)) throw Error('Выбери тот же аккаунт Google, который подключал ранее.');
                update({ account: profile.sub, ...(withCalendar && calendarGranted ? { calendarEnabled: true } : {}) });
              } catch (error) { token = ''; calendarGranted = false; throw error; }
              calendarRetryAfter = 0;
              await sync();
            });
          },
          error_callback: () => { connecting = false; message = 'Окно Google закрыто или заблокировано.'; paint(); }
        });
      }
      tokenClient = makeClient(false);
      calendarTokenClient = makeClient(true);
    })().finally(() => { authLoading = null; });
    return authLoading;
  }

  async function pickFolder() {
    if (!window.google?.picker) {
      if (!window.gapi) await script('https://apis.google.com/js/api.js');
      await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject, timeout: 15000, ontimeout: () => reject(Error('Выбор папки недоступен.')) }));
    }
    const settings = read();
    const folder = await new Promise((resolve, reject) => {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
      new window.google.picker.PickerBuilder().addView(view).setOAuthToken(token)
        .setAppId(settings.projectNumber).setDeveloperKey(settings.apiKey).setOrigin(location.origin)
        .setTitle('Выбери папку «' + folderName + '»').setCallback(result => {
          if (result.action === window.google.picker.Action.PICKED) resolve(result.docs?.[0]);
          if (result.action === window.google.picker.Action.CANCEL) resolve(null);
          if (result.action === window.google.picker.Action.ERROR) reject(Error('Не удалось открыть папку.'));
        }).build().setVisible(true);
    });
    if (!folder) { message = 'Выбор папки отменён.'; return; }
    if (folder.name?.trim() !== folderName || !/^[\w-]+$/.test(folder.id)) throw Error('Выбери папку с названием «' + folderName + '».');
    const info = await metadata(folder.id);
    if (info.mimeType !== 'application/vnd.google-apps.folder' || info.title?.trim() !== folderName || info.labels?.trashed) throw Error('Проверь название и доступ к папке.');
    if (settings.folder !== folder.id) {
      update({ folder: folder.id, fileId: null, etag: null, pending: null, paused: false, hash: null, lastSync: null });
    }
    await sync();
  }

  async function syncDriveUnlocked() {
    const settings = read();
    if (!settings.folder) { message = 'Google подключён. Выбери папку «03 РАБОТА».'; return; }
    if (settings.paused) { message = 'Отправка приостановлена. Восстанови актуальную копию с Диска.'; return; }

    if (settings.pending) {
      const info = await metadata(settings.pending.id, true);
      if (info) {
        verifyFile(info, settings);
        const remote = await download(info);
        const remoteHash = await digest(JSON.stringify(remote.records));
        if (remote.sync?.commit !== settings.pending.commit || remoteHash !== settings.pending.hash) conflict();
        update({ fileId: info.id, etag: info.etag, hash: remoteHash, pending: null, lastSync: new Date().toISOString() });
      } else if (settings.fileId) throw Error('Сохранённая копия недоступна. Проверь доступ к файлу.');
      // A lost response must retry the same preallocated id, never create a second file.
    }

    const current = read();
    const existing = await findFile(current);
    if (existing && (!current.fileId || existing.id !== current.fileId || existing.etag !== current.etag)) conflict();
    const backup = core.exportData(localStorage);
    const hash = await digest(JSON.stringify(backup.records));
    if (existing && hash === current.hash) { message = 'Копия актуальна.'; remotePoll = Date.now(); return; }

    const commit = crypto.randomUUID();
    const id = existing?.id || current.pending?.id || (await (await request(api + '/generateIds' + query({ maxResults: '1', space: 'drive' }))).json()).ids?.[0];
    if (!id) throw Error('Google не выдал идентификатор для копии.');
    backup.sync = { commit };
    update({ pending: { id, commit, hash } });
    let response;
    if (existing) {
      if (!existing.etag) throw Error('Google не вернул версию файла. Отправка остановлена.');
      response = await request(upload + '/' + encode(id) + query({ uploadType: 'media', fields: metaFields }), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': existing.etag }, body: JSON.stringify(backup)
      });
    } else {
      const boundary = 'rabota03_' + crypto.randomUUID();
      const meta = { id, title: fileName, parents: [{ id: current.folder }], mimeType: 'application/json',
        properties: [{ key: 'panelBackup', value: tag, visibility: 'PRIVATE' }] };
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(backup) + '\r\n--' + boundary + '--';
      response = await request(upload + query({ uploadType: 'multipart', fields: metaFields }), {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
      });
    }
    const saved = await response.json();
    if (!saved.id || !saved.etag) throw Error('Google не подтвердил версию копии. Повторная отправка сначала проверит результат.');
    update({ fileId: saved.id, etag: saved.etag, pending: null, hash, lastSync: new Date().toISOString() });
    remotePoll = Date.now();
    message = 'Копия успешно обновлена.';
  }

  async function syncUnlocked() {
    await syncDriveUnlocked();
    const settings = read();
    if (!settings.calendarEnabled || !calendarGranted || !ready()) return;
    if (!settings.folder || !settings.fileId || settings.paused) {
      calendarMessage = 'Сначала настрой копию на Диске и восстанови её, если панель предлагает это.';
      return;
    }
    if (Date.now() < calendarRetryAfter) return;
    try {
      calendarMessage = 'Проверяю события календаря…';
      paint();
      const records = core.snapshot(localStorage);
      const hash = await digest(JSON.stringify(records));
      if (!window.panel03CalendarWork) throw Error('Рабочие журналы ещё не готовы. Обнови панель.');
      const count = await calendar.mirror({ request, settings, update, digest,
        events: Object.entries(records).filter(([key]) => key.startsWith('panel-03:event:')).map(([, value]) => value),
        work: window.panel03CalendarWork() });
      update({ calendarHash: hash });
      calendarPoll = Date.now();
      calendarRetryAfter = 0;
      calendarMessage = 'Зеркало обновлено. Событий и рабочих действий: ' + count + '.';
    } catch (error) {
      calendarMessage = error.message || 'Не удалось обновить календарь.';
      calendarRetryAfter = Date.now() + 30000;
    }
  }

  async function sync() {
    const send = () => syncUnlocked();
    if (navigator.locks) return navigator.locks.request(stateKey, send);
    return send();
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    message = 'Проверяю копию на Google Диске…';
    paint();
    try { await task(); retryAfter = 0; }
    catch (error) { message = error.message || 'Операция не завершена.'; retryAfter = Date.now() + 30000; }
    finally { busy = false; paint(); }
  }

  async function restoreRemote() {
    const settings = read();
    if (!settings.folder) throw Error('Выбери папку «03 РАБОТА».');
    const info = await findFile(settings);
    if (!info) throw Error('В выбранной папке пока нет копии панели.');
    const backup = await download(info);
    update({ paused: true });
    const previewMeta = { id: info.id, etag: info.etag };
    $('#google-dialog').close();
    window.dispatchEvent(new CustomEvent('panel-03:backup-candidate', { detail: {
      backup,
      restored: () => {
        update({ fileId: previewMeta.id, etag: previewMeta.etag, hash: null, paused: false, pending: null });
        message = 'Копия восстановлена. Обновлю её после проверки изменений.';
        dirtySince = Date.now() - 4000;
        paint();
      }
    } }));
    message = 'Проверь состав копии и нажми «Восстановить».';
  }

  function paint() {
    let settings;
    try { settings = read(); } catch { return; }
    const enabled = Boolean(settings.folder);
    const localPending = Boolean(localHash && localHash !== settings.hash);
    const summary = busy ? 'Отправка копии…' :
      settings.paused ? 'Копия на Диске требует восстановления.' :
      !enabled ? 'Резервная копия Google ещё не настроена.' :
      !ready() ? 'Для отправки изменений подключи Google.' :
      localPending ? 'Есть изменения для отправки.' : 'Копия на Диске актуальна.';
    const calendarSummary = !settings.calendarEnabled ? 'Google Календарь ещё не подключён.' :
      settings.paused ? 'Календарь ожидает восстановления копии с Диска.' :
      !ready() || !calendarGranted ? 'Подключи Google для отправки событий.' :
      localHash && localHash !== settings.calendarHash ? 'Есть изменения для календаря.' :
      settings.calendarLastSync ? 'Календарь «03 РАБОТА» обновлён.' : 'Ожидает первой отправки событий.';
    $('#google-calendar-overview').textContent = calendarRetryAfter > Date.now() ? 'Календарь: ' + calendarMessage : calendarSummary;
    $('#google-calendar-status').textContent = settings.paused ? calendarSummary : calendarMessage || calendarSummary;
    $('#google-calendar-last-sync').textContent = settings.calendarLastSync ? 'Последняя отправка событий: ' + new Date(settings.calendarLastSync).toLocaleString('ru-RU') : '';
    $('#google-calendar-zone').textContent = settings.calendarZone ? 'Часовой пояс: ' + settings.calendarZone + '. Событие без окончания занимает один час.' : 'Будет использован часовой пояс календаря «03 РАБОТА».';
    $('#google-calendar-connect').hidden = Boolean(settings.calendarEnabled && ready() && calendarGranted);
    $('#google-calendar-connect').disabled = busy || connecting || !settings.clientId || !calendarTokenClient;
    $('#google-calendar-send').disabled = busy || connecting || !ready() || !calendarGranted || !settings.calendarEnabled || !settings.fileId || settings.paused;
    $('#google-overview-text').textContent = summary;
    $('#google-last-sync').textContent = settings.lastSync ? 'Последняя отправка: ' + new Date(settings.lastSync).toLocaleString('ru-RU') : '';
    $('#google-status').textContent = message || summary;
    $('#google-connect').hidden = ready();
    $('#google-overview-connect').hidden = ready() || !settings.clientId;
    $('#google-folder').disabled = busy || !ready();
    $('#google-sync-now').disabled = busy || !ready() || !enabled || settings.paused;
    $('#google-restore').disabled = busy || !ready() || !enabled;
    $('#google-connect').disabled = connecting || busy || !settings.clientId || !tokenClient;
    $('#google-overview-connect').disabled = $('#google-connect').disabled;
    $('#google-disconnect').disabled = busy || connecting;
    $('#google-folder-status').textContent = enabled ? 'Папка «03 РАБОТА» запомнена.' : 'После подключения выбери папку «03 РАБОТА».';
    for (const item of $('#google-config').querySelectorAll('input,button')) item.disabled = busy || connecting;
  }

  function configValues() {
    const settings = read();
    $('#google-client-id').value = settings.clientId || '';
    $('#google-project-number').value = settings.projectNumber || '';
    $('#google-api-key').value = settings.apiKey || '';
  }

  function connect() {
    if (!tokenClient || busy || connecting) return;
    connecting = true;
    message = '';
    paint();
    (read().calendarEnabled ? calendarTokenClient : tokenClient).requestAccessToken({ prompt: '' });
  }

  $('#google-config').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const clientId = $('#google-client-id').value.replace(/^https?:\/\//i, '').trim();
      const projectNumber = $('#google-project-number').value.replace(/\s/g, '');
      const apiKey = $('#google-api-key').value.trim();
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw Error('Вставь Client ID, заканчивающийся на .apps.googleusercontent.com.');
      if (!/^\d+$/.test(projectNumber)) throw Error('Укажи числовой номер проекта Google Cloud.');
      if (!/^[\w-]+$/.test(apiKey)) throw Error('Укажи API key для Google Picker.');
      const old = read();
      if ((old.folder || old.account) && old.clientId && (old.clientId !== clientId || old.projectNumber !== projectNumber)) {
        throw Error('Для сохранения доступа к существующей копии используй прежний Client ID и номер проекта.');
      }
      update({ clientId, projectNumber, apiKey });
      tokenClient = null;
      calendarTokenClient = null;
      prepare().then(() => { message = 'Настройки сохранены. Нажми «Подключить Google».'; paint(); }).catch(error => { message = error.message; paint(); });
    } catch (error) { message = error.message; }
    paint();
  });

  $('#google-use-personal').addEventListener('click', () => {
    try {
      const old = JSON.parse(localStorage.getItem('lichnoe:google:v1'));
      if (!old?.clientId || !old.projectNumber || !old.apiKey) throw Error('Открой «Личное» в этом же Chrome или скопируй настройки вручную.');
      $('#google-client-id').value = old.clientId;
      $('#google-project-number').value = old.projectNumber;
      $('#google-api-key').value = old.apiKey;
      message = 'Поля заполнены из «Личного». Нажми «Сохранить настройки».';
    } catch (error) { message = error.message; }
    paint();
  });

  function openGoogle() {
    $('#app-menu-dialog').close();
    configValues();
    if (!$('#google-dialog').open) $('#google-dialog').showModal();
    paint();
  }

  for (const button of document.querySelectorAll('[data-google-help]')) {
    button.addEventListener('click', () => {
      $('#backup-help-text').textContent = button.dataset.googleHelp;
      $('#backup-help').showModal();
    });
  }

  $('#google-calendar-connect').addEventListener('click', () => {
    if (!calendarTokenClient || busy || connecting) return;
    connecting = true;
    calendarMessage = 'Подтверди доступ к календарю в окне Google.';
    paint();
    calendarTokenClient.requestAccessToken({ prompt: '' });
  });
  $('#google-calendar-send').addEventListener('click', () => { calendarRetryAfter = 0; run(sync); });

  $('#google-open').addEventListener('click', openGoogle);
  $('#google-overview-open').addEventListener('click', openGoogle);
  $('#google-close').addEventListener('click', () => $('#google-dialog').close());
  $('#google-connect').addEventListener('click', connect);
  $('#google-overview-connect').addEventListener('click', connect);
  $('#google-folder').addEventListener('click', () => run(pickFolder));
  $('#google-sync-now').addEventListener('click', () => run(sync));
  $('#google-restore').addEventListener('click', () => run(restoreRemote));
  $('#google-disconnect').addEventListener('click', () => {
    token = ''; expires = 0; calendarGranted = false; calendarMessage = '';
    message = 'Доступ в этой вкладке отключён. Рабочие данные сохранены в браузере.';
    paint();
  });

  async function monitor() {
    if (monitoring || busy || connecting || document.hidden) return;
    monitoring = true;
    try {
      const signature = JSON.stringify(core.snapshot(localStorage));
      if (signature !== cachedLocal) {
        localHash = await digest(signature);
        cachedLocal = signature;
        dirtySince = Date.now();
      }
      const settings = read();
      paint();
      if (navigator.onLine === false || !ready() || !settings.folder || settings.paused || Date.now() < retryAfter) return;
      if ((localHash !== settings.hash && Date.now() - dirtySince >= 3000) || settings.pending || Date.now() - remotePoll > 60000 ||
          (settings.calendarEnabled && calendarGranted && Date.now() >= calendarRetryAfter &&
            ((localHash !== settings.calendarHash && Date.now() - dirtySince >= 3000) || Date.now() - calendarPoll > 60000))) {
        await run(sync);
      }
    } catch (error) { message = error.message; paint(); }
    finally { monitoring = false; }
  }

  window.addEventListener('online', () => { retryAfter = 0; calendarRetryAfter = 0; dirtySince = Date.now() - 4000; monitor(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) monitor(); });
  window.addEventListener('storage', () => monitor());
  window.addEventListener('panel-03:work-changed', () => monitor());
  setInterval(monitor, 5000);
  try {
    configValues();
    if (read().clientId) prepare().then(paint).catch(error => { message = error.message; paint(); });
    monitor();
    paint();
  } catch (error) { message = error.message; }
})();
