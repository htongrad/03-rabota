(() => {
  'use strict';

  const stateKey = 'panel-03:google';
  const api = 'https://www.googleapis.com/drive/v2/files';
  const upload = 'https://www.googleapis.com/upload/drive/v2/files';
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const folderName = '03 РАБОТА';
  const fileName = 'Работа — резервная копия.json';
  const tag = 'rabota03';
  const core = window.panelRecords;
  const calendar = window.panel03GoogleCalendar;
  const $ = selector => document.querySelector(selector);
  let token = '';
  let expires = 0;
  let tokenClient;
  let afterConnect;
  let calendarGranted = false;
  let calendarMessage = '';
  let calendarIssue = false;
  let calendarPoll = 0;
  let driveError = '';
  let authLoading;
  let busy = false;
  let connecting = false;
  let message = '';
  let syncError = '';
  let retryAfter = 0;
  let cachedLocal = '';
  let localHash = '';
  let dirtySince = 0;
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
  class UnusableBackup extends Error {}
  async function request(url, options = {}, allow404 = false, acceptedStatuses = []) {
    if (!ready()) throw Error('Доступ Google истёк. Нажми «Синхронизировать».');
    const response = await fetch(url, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }
    });
    if (response.status === 401) { token = ''; expires = 0; }
    if (response.status === 412 && url.startsWith('https://www.googleapis.com/calendar/')) {
      throw Error('Событие изменилось во время отправки. Повторю проверку календаря.');
    }
    if (acceptedStatuses.includes(response.status)) return response;
    if (response.status === 404 && allow404) return null;
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const problem = Error('Google ' + response.status + (error?.error?.message ? ' · ' + error.error.message : ''));
      problem.status = response.status;
      problem.reason = error?.error?.errors?.[0]?.reason;
      throw problem;
    }
    return response;
  }

  async function metadata(id, allow404 = false) {
    const response = await request(api + '/' + encode(id) + query({ fields: metaFields }), { cache: 'no-store' }, allow404);
    return response ? response.json() : null;
  }

  function isTagged(info) {
    return info.properties?.some(property => property.key === 'panelBackup' && property.value === tag);
  }

  function verifyFile(info, settings) {
    if (!info) throw new UnusableBackup('Копия недоступна на Google Диске.');
    if (info.labels?.trashed) throw new UnusableBackup('Копия находится в корзине Google Диска.');
    if (!info.parents?.some(parent => parent.id === settings.folder)) {
      throw new UnusableBackup('Копия находится вне выбранной папки «03 РАБОТА».');
    }
    const type = info.mimeType?.split(';', 1)[0].trim().toLowerCase();
    if (type && !['application/json', 'application/octet-stream', 'text/plain', 'text/json'].includes(type)) {
      throw new UnusableBackup('Для восстановления нужна сохранённая копия панели в формате JSON.');
    }
    if (!isTagged(info) && info.id !== settings.fileId && info.title?.trim() !== fileName) {
      throw new UnusableBackup('Принадлежность копии панели 03 не подтверждена.');
    }
  }

  function sameVersion(first, second) {
    if (first.version && second.version) return String(first.version) === String(second.version);
    return Boolean(first.etag && first.etag === second.etag);
  }

  async function findUsableBackup(settings) {
    const label = "properties has { key='panelBackup' and value='" + tag + "' and visibility='PRIVATE' }";
    const params = {
      q: "trashed = false and '" + settings.folder + "' in parents and (" + label + " or title = '" + fileName + "')",
      fields: 'nextPageToken,items(id)', maxResults: '100', orderBy: 'createdDate desc'
    };
    let skipped = false;
    do {
      const result = await (await request(api + query(params), { cache: 'no-store' })).json();
      for (const candidate of result.items || []) {
        try {
          const info = await metadata(candidate.id);
          verifyFile(info, settings);
          return { backup: await download(info, settings), skipped };
        } catch (error) {
          if (!(error instanceof UnusableBackup) && error.status !== 404 && error.status !== 410 &&
              !(error.status === 403 && error.reason === 'insufficientFilePermissions')) throw error;
          skipped = true;
        }
      }
      params.pageToken = result.nextPageToken;
    } while (params.pageToken);
    throw Error(skipped ? 'В выбранной папке не нашлось доступной исправной копии. Можно выбрать скачанный файл вручную.' :
      'В выбранной папке пока нет копии панели.');
  }

  async function download(info, settings) {
    const url = api + '/' + encode(info.id) + '?alt=media';
    // Compare file metadata around the content read. The download can have a different HTTP ETag.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(url, { cache: 'no-store' });
      const contents = await response.text();
      const after = await metadata(info.id);
      verifyFile(after, settings);
      if (sameVersion(info, after)) {
        try { return core.parseCopy(JSON.parse(contents)); }
        catch (error) { throw new UnusableBackup(error.message); }
      }
      info = after;
    }
    throw new UnusableBackup('Копия меняется во время скачивания.');
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
      const { clientId } = read();
      if (!clientId) return;
      const oauth = window.google.accounts.oauth2;
      tokenClient = oauth.initTokenClient({
        client_id: clientId,
        scope: ['openid', scope, ...calendar.scopes].join(' '),
        callback: result => {
          connecting = false;
          const action = afterConnect;
          afterConnect = null;
          if (result.error || !oauth.hasGrantedAllScopes(result, 'openid', scope)) {
            syncError = message = 'Разреши доступ к выбранным файлам Google Диска для резервирования.';
            paint();
            return;
          }
          token = result.access_token;
          expires = Date.now() + Number(result.expires_in) * 1000 - 30000;
          calendarGranted = oauth.hasGrantedAllScopes(result, ...calendar.scopes);
          run(async () => {
            try {
              const profile = await (await request('https://openidconnect.googleapis.com/v1/userinfo')).json();
              const current = read();
              if (current.clientId !== clientId) throw Error('Настройки Google изменились. Повтори подключение.');
              if (!profile.sub || (current.account && current.account !== profile.sub)) {
                throw Error('Выбери тот же аккаунт Google, который подключал ранее.');
              }
              update({ account: profile.sub });
            } catch (error) { token = ''; calendarGranted = false; throw error; }
            return perform(action);
          });
        },
        error_callback: () => {
          afterConnect = null;
          connecting = false;
          syncError = message = 'Окно Google закрыто или заблокировано.';
          paint();
        }
      });
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
    if (!folder) return false;
    if (folder.name?.trim() !== folderName || !/^[\w-]+$/.test(folder.id ?? '')) throw Error('Выбери папку с названием «' + folderName + '».');
    const info = await metadata(folder.id);
    if (info.mimeType !== 'application/vnd.google-apps.folder' || info.title?.trim() !== folderName || info.labels?.trashed) throw Error('Проверь название и доступ к папке.');
    await withSyncLock(() => {
      const current = read();
      if (['clientId', 'account', 'folder'].some(key => current[key] !== settings[key])) {
        throw Error('Настройки Google изменились. Повтори выбор папки.');
      }
      if (settings.folder !== folder.id) {
        update({ folder: folder.id, autoSync: false, fileId: undefined, etag: undefined, version: undefined,
          pending: undefined, paused: undefined, hash: undefined, lastSync: undefined, lastBackup: undefined, upload: undefined });
        driveError = '';
      }
    });
    return true;
  }

  async function isSavedSnapshot({ id, hash }, folder) {
    const file = await metadata(id, true);
    return file && !file.labels?.trashed && file.parents?.some(parent => parent.id === folder) && isTagged(file) &&
      file.properties?.some(property => property.key === 'snapshotHash' && property.value === hash);
  }

  async function uploadSnapshot(meta, contents) {
    const blob = new Blob([contents], { type: 'application/json' });
    if (blob.size > 5000000) {
      const session = await request(upload + query({ uploadType: 'resumable', fields: 'id' }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': blob.type, 'X-Upload-Content-Length': String(blob.size) },
        body: JSON.stringify(meta)
      }, false, [409]);
      if (session.status === 409) return session;
      const location = session.headers.get('Location');
      if (!location || new URL(location).origin !== new URL(upload).origin) throw Error('Google не вернул адрес загрузки копии.');
      return request(location, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob }, false, [409]);
    }
    const boundary = 'rabota03_' + crypto.randomUUID();
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + contents + '\r\n--' + boundary + '--';
    return request(upload + query({ uploadType: 'multipart', fields: 'id' }), {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    }, false, [409]);
  }

  async function syncDrive(backup, hash) {
    const settings = read();
    const { folder, lastBackup } = settings;
    if (lastBackup?.hash === hash && await isSavedSnapshot(lastBackup, folder)) {
      return 'Копия на Диске актуальна.';
    }
    let pending = settings.upload;
    if (pending?.hash !== hash) {
      const ids = await (await request(api + '/generateIds' + query({ maxResults: '1', space: 'drive' }))).json();
      if (!ids.ids?.[0]) throw Error('Google не выдал идентификатор для копии.');
      pending = { id: ids.ids[0], hash, createdAt: backup.createdAt };
      update({ upload: pending });
    }
    const { id, createdAt } = pending;
    const date = createdAt.slice(0, 19).replace('T', ' ').replaceAll(':', '-');
    const meta = { id, title: 'Работа — ' + date + ' UTC.json', parents: [{ id: folder }], mimeType: 'application/json',
      properties: [{ key: 'panelBackup', value: tag, visibility: 'PRIVATE' },
        { key: 'snapshotHash', value: hash, visibility: 'PRIVATE' }] };
    const response = await uploadSnapshot(meta, JSON.stringify({ ...backup, createdAt }));
    if (response.status === 409) {
      if (!await isSavedSnapshot(pending, folder)) {
        update({ upload: undefined });
        throw Error('Google не подтвердил копию. Повтори синхронизацию.');
      }
    } else if ((await response.json()).id !== id) {
      throw Error('Google не подтвердил идентификатор сохранённой копии.');
    }
    update({ lastBackup: { id, hash }, upload: undefined, lastSync: new Date().toISOString(),
      fileId: undefined, etag: undefined, version: undefined, hash: undefined, pending: undefined, paused: undefined });
    return 'Копия сохранена на Диске.';
  }

  async function syncUnlocked({ drive = true, sendCalendar = true } = {}) {
    const settings = read();
    if (!settings.folder || !/^[\w-]+$/.test(settings.folder)) throw Error('Выбери рабочую папку «03 РАБОТА».');
    const records = core.snapshot();
    if (!records) {
      update({autoSync:true});
      message = 'В панели пока нет записей для отправки.';
      return;
    }
    const backup = {format:'03-rabota-backup',version:2,createdAt:new Date().toISOString(),data:records};
    const signature = JSON.stringify(records);
    const hash = await digest(signature);
    update({ autoSync: true });
    let errorFound = false;
    if (drive) {
      driveError = '';
      try { message = await syncDrive(backup, hash); }
      catch (error) {
        errorFound = true;
        driveError = error.message || 'Не удалось сохранить копию.';
        message = 'Диск: ' + driveError;
      }
    }
    if (sendCalendar) {
      if (!calendarGranted) {
        calendarIssue = true;
        calendarMessage = 'Для отправки событий разреши доступ к календарю при синхронизации.';
      } else {
        try {
          calendarMessage = 'Обновляю календарь…';
          paint();
          const count = await calendar.mirror({request,settings:read(),update,digest,events:records.events});
          update({ calendarHash: hash });
          calendarPoll = Date.now();
          calendarIssue = false;
          calendarMessage = 'Календарь обновлён. Событий: ' + count + '.';
        } catch (error) {
          errorFound = true;
          calendarIssue = true;
          calendarMessage = error.message || 'Не удалось обновить календарь.';
        }
      }
    }
    return errorFound;
  }

  function withSyncLock(task) {
    return navigator.locks ? navigator.locks.request(stateKey, task) : task();
  }

  function sync(options) {
    return withSyncLock(() => syncUnlocked(options));
  }

  async function perform(action) {
    if (!action) return;
    if (action === 'folder') {
      message = await pickFolder() ? 'Папка сохранена.' : 'Выбор папки отменён.';
      return;
    }
    if (!read().folder && !await pickFolder()) {
      message = 'Выбор папки отменён.';
      return;
    }
    return action === 'restore' ? restoreRemote() : sync();
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    message = '';
    syncError = '';
    paint();
    try { retryAfter = await task() ? Date.now() + 30000 : 0; }
    catch (error) {
      syncError = message = error.message || 'Операция не завершена.';
      retryAfter = Date.now() + 30000;
    }
    finally { busy = false; paint(); }
  }

  async function restoreRemote() {
    const settings = read();
    if (!settings.folder || !/^[\w-]+$/.test(settings.folder)) throw Error('Выбери папку «03 РАБОТА».');
    const { backup, skipped } = await findUsableBackup(settings);
    $('#google-dialog').close();
    const notice = skipped ? 'Показана предыдущая исправная копия.' : '';
    core.offerCopy(backup, notice || 'Копия загружена. Подтверди добавление записей.');
    message = 'Копия загружена. Проверь её состав и подтверди восстановление.';
  }

  function paint() {
    let settings;
    try { settings = read(); } catch { return; }
    const configured = Boolean(settings.clientId);
    const enabled = Boolean(settings.folder);
    const localPending = Boolean(localHash && localHash !== settings.lastBackup?.hash);
    const waiting = busy || connecting || Boolean(authLoading);
    const summary = busy || connecting ? 'Идёт синхронизация…' :
      !configured ? 'Настрой подключение Google.' :
      navigator.onLine === false ? 'Панель ждёт интернет.' :
      syncError ? syncError :
      driveError ? 'Диск: ' + driveError :
      !enabled ? 'Рабочая папка ещё не выбрана.' :
      !ready() ? 'Для отправки нажми «Синхронизировать».' :
      localPending ? 'Есть изменения для копии.' :
      settings.lastSync ? 'Копия на Диске актуальна.' : 'Ожидает первой копии.';
    const calendarSummary = calendarMessage || (settings.calendarLastSync
      ? 'Календарь «03 РАБОТА» обновлён.' : 'Календарь ожидает первой отправки.');
    if ($('#google-overview-text')) $('#google-overview-text').textContent = !configured ? 'Подключение не настроено.' :
      busy || connecting || navigator.onLine === false || syncError || driveError || !enabled || !ready() || localPending ? summary :
      calendarIssue ? 'Календарь требует внимания.' :
      settings.lastSync ? 'Копия: ' + new Date(settings.lastSync).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }) :
      summary;
    $('#google-last-sync').textContent = settings.lastSync ? 'Последняя копия: ' + new Date(settings.lastSync).toLocaleString('ru-RU') : '';
    $('#google-calendar-status').textContent = calendarSummary;
    $('#google-calendar-last-sync').textContent = settings.calendarLastSync ? 'Последняя отправка событий: ' + new Date(settings.calendarLastSync).toLocaleString('ru-RU') : '';
    $('#google-status').textContent = busy || connecting ? summary : message || summary;
    const headerSync = $('#header-sync');
    const label = configured ? 'Синхронизировать' : 'Настроить синхронизацию';
    headerSync.setAttribute('aria-label', label);
    headerSync.title = label;
    headerSync.disabled = waiting;
    headerSync.setAttribute('aria-busy', String(waiting));
    $('#google-sync-now').hidden = !configured;
    $('#google-sync-now').disabled = waiting;
    $('#google-folder').hidden = !enabled;
    $('#google-folder').disabled = waiting || !configured;
    $('#google-restore').hidden = !configured;
    $('#google-restore').disabled = waiting;
    $('#google-disconnect').hidden = !ready();
    $('#google-disconnect').disabled = waiting;
    $('#google-folder-status').textContent = enabled ? 'Папка «03 РАБОТА» запомнена.' : 'При первом подключении выбери папку «03 РАБОТА».';
    for (const item of $('#google-config').querySelectorAll('input,button')) item.disabled = waiting;
  }

  window.refreshGoogleStatus = paint;

  function configValues() {
    const settings = read();
    $('#google-client-id').value = settings.clientId || '';
    $('#google-project-number').value = settings.projectNumber || '';
    $('#google-api-key').value = settings.apiKey || '';
  }

  function start(action) {
    if (busy || connecting || authLoading) return;
    const settings = read();
    if (!settings.clientId) { openGoogle(); return; }
    if (navigator.onLine === false) {
      message = 'Подключись к интернету и повтори синхронизацию.';
      paint();
      return;
    }
    if (ready() && (action !== 'sync' || calendarGranted)) { run(() => perform(action)); return; }
    if (!tokenClient) { warmUp(); return; }
    afterConnect = action;
    connecting = true;
    message = '';
    syncError = '';
    paint();
    try {
      tokenClient.requestAccessToken({ prompt: '', ...(settings.account ? { login_hint: settings.account } : {}) });
    } catch {
      afterConnect = null;
      connecting = false;
      syncError = message = 'Не удалось открыть окно Google.';
      paint();
    }
  }

  function warmUp() {
    if (tokenClient || authLoading || navigator.onLine === false || !read().clientId) return;
    prepare().then(paint).catch(error => { syncError = message = error.message; paint(); });
    paint();
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
      syncError = '';
      message = 'Настройки сохранены. Нажми «Синхронизировать».';
      warmUp();
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
    document.querySelector('.menu').open = false;
    configValues();
    if (!read().clientId) $('#google-settings').open = true;
    if (!$('#google-dialog').open) $('#google-dialog').showModal();
    paint();
  }

  $('#google-open').addEventListener('click', openGoogle);
  $('#google-close').addEventListener('click', () => $('#google-dialog').close());
  $('#header-sync').addEventListener('click', () => start('sync'));
  $('#google-folder').addEventListener('click', () => start('folder'));
  $('#google-sync-now').addEventListener('click', () => start('sync'));
  $('#google-restore').addEventListener('click', () => start('restore'));
  $('#google-disconnect').addEventListener('click', () => {
    token = ''; expires = 0; calendarGranted = false; calendarMessage = ''; calendarIssue = false;
    syncError = '';
    message = 'Доступ в этой вкладке отключён.';
    paint();
  });

  async function monitor() {
    if (monitoring || busy || connecting || document.hidden) return;
    monitoring = true;
    try {
      const records = core.snapshot();
      const signature = JSON.stringify(records);
      if (signature !== cachedLocal) {
        localHash = await digest(signature);
        cachedLocal = signature;
        dirtySince = Date.now();
      }
      const settings = read();
      paint();
      const automatic = settings.autoSync ?? Boolean(settings.fileId);
      if (navigator.onLine === false || !ready() || !settings.folder || !automatic || Date.now() < retryAfter) return;
      if (!records) return;
      if (Date.now() - dirtySince < 3000) return;
      const drive = localHash !== settings.lastBackup?.hash || Boolean(settings.upload);
      const sendCalendar = calendarGranted && (localHash !== settings.calendarHash || Date.now() - calendarPoll > 60000);
      if (drive || sendCalendar) await run(() => sync({ drive, sendCalendar }));
    } catch (error) { message = error.message; paint(); }
    finally { monitoring = false; }
  }

  window.addEventListener('online', () => { retryAfter = 0; dirtySince = Date.now() - 4000; warmUp(); monitor(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) monitor(); });
  window.addEventListener('offline', paint);
  window.addEventListener('storage', () => monitor());
  window.addEventListener('panel-03:records-changed', () => monitor());
  setInterval(monitor, 5000);
  try {
    configValues();
    warmUp();
    monitor();
    paint();
  } catch (error) { message = error.message; }
})();
