'use strict';
window.panel03Points = (() => {
  const scopeFor = record => record.pointIds ?? (record.pointId ? [record.pointId] : null);
  const scopeFields = selection => selection && selection.length > 1
    ? {pointIds:selection} : {pointId:selection?.[0] ?? ''};

  function validScope(record, points) {
    const ids = new Set(points.map(point => point.id));
    if (record.pointIds === undefined) return record.pointId === '' || ids.has(record.pointId);
    const selected = record.pointIds;
    return record.pointId === undefined && Array.isArray(selected) && selected.length > 0 &&
      new Set(selected).size === selected.length && selected.every(id => ids.has(id));
  }

  function scopeName(selection, points) {
    if (selection === null) return 'Вся сеть';
    return selection.map(id => points.find(point => point.id === id)?.name ?? 'Точка').join(', ');
  }

  function picker(points, selection, {name, label, escape, allLabel = 'Вся сеть', allDetail = '', hint = ''}) {
    return `<fieldset class="point-picker" data-point-picker="${name}">
      <legend>${escape(label)}</legend>
      <div class="point-picker-heading">
        <label class="check"><input type="checkbox" data-point-all${selection === null ? ' checked' : ''}${points.length ? '' : ' disabled'}> <span>${escape(allLabel)}${allDetail ? `<small>${escape(allDetail)}</small>` : ''}</span></label>
        ${hint}
      </div>
      ${points.length ? `<div class="point-picker-list">${points.map(point =>
        `<label class="check"><input type="checkbox" data-point-option value="${escape(point.id)}"${selection === null || selection.includes(point.id) ? ' checked' : ''}> <span>${escape(point.name)}${point.detail ? `<small>${escape(point.detail)}</small>` : ''}</span></label>`
      ).join('')}</div>` : '<p class="point-picker-empty">Точки можно добавить во вкладке «Точки».</p>'}
    </fieldset>`;
  }

  const master = field => field.querySelector('[data-point-all]');
  const options = field => [...field.querySelectorAll('[data-point-option]')];
  function read(field) {
    return master(field).checked ? null : options(field).filter(input => input.checked).map(input => input.value);
  }

  function updateMaster(field) {
    const selected = read(field);
    master(field).indeterminate = Boolean(selected?.length);
  }

  function change(control) {
    const field = control.closest('[data-point-picker]');
    if (!field || !control.matches('[data-point-all],[data-point-option]')) return undefined;
    if (control === master(field)) options(field).forEach(input => { input.checked = control.checked; });
    else master(field).checked = false;
    updateMaster(field);
    return read(field);
  }

  function refresh(root) {
    root.querySelectorAll('[data-point-picker]').forEach(updateMaster);
  }

  return {scopeFor, scopeFields, validScope, scopeName, picker, read, change, refresh};
})();
