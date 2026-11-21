(() => {
  'use strict';

  const moscow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const today = (instant = new Date()) => {
    const parts = Object.fromEntries(moscow.formatToParts(instant).map(({ type, value }) => [type, value]));
    return parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day;
  };
  const fromKey = value => new Date(value + 'T12:00:00Z');
  const key = date => Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  const valid = value => /^\d{4}-\d\d-\d\d$/.test(value) && key(fromKey(value)) === value;

  window.panel03Date = { today, fromKey, key, valid };
})();
