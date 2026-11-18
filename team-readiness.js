(() => {
  'use strict';

  const roles = { trainee: 'Стажёр', barista: 'Бариста', mentor: 'Наставник' };
  const essentials = {
    id: 'starter-station', version: 1, name: 'Подготовка станции',
    task: 'Самостоятельно подготовь станцию к смене по чек-листу точки. Назови действия при выявленном отклонении.',
    criteria: [{ name: 'Проверка станции', rule: { type: 'observable', expected: 'Сотрудник выполнил обязательные пункты чек-листа и объяснил, как зафиксировать отклонение и передать его ответственному.' } }]
  };
  const coaching = {
    id: 'starter-coaching', version: 1, name: 'Практическая проверка бариста',
    task: 'Проведи пробную практическую проверку. Зафиксируй критерии, наблюдения и следующий шаг.',
    criteria: [{ name: 'Объективная оценка', rule: { type: 'observable', expected: 'Наставник показал критерии до начала, наблюдал без подсказок, записал проверяемые факты и дал конкретную обратную связь.' } }]
  };
  const templates = {
    trainee: [essentials.id],
    barista: [essentials.id, 'espresso'],
    mentor: [essentials.id, 'espresso', coaching.id]
  };
  const minimumVersion = skill => skill.requiredVersion ?? skill.version;

  function plusDays(day, days) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function programFor(data, role) {
    return (data.programs || []).filter(item => item.role === role)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  }

  function statesFor(data, person, day) {
    const program = programFor(data, person.role);
    const history = data.attempts.filter(item => item.personId === person.id && item.date <= day).reverse()
      .sort((a, b) => b.date.localeCompare(a.date));
    const states = data.skills.map(skill => {
      const attempt = history.find(item => item.skillId === skill.id);
      const required = program?.skillIds.includes(skill.id) || false;
      const stale = Boolean(attempt && attempt.version < minimumVersion(skill));
      const due = required && stale && skill.changedOn ? plusDays(skill.changedOn, 7) : '';
      const ready = Boolean(attempt?.passed && attempt.independent && attempt.results.length && attempt.results.every(item => item.passed) && !stale);
      return { skill, attempt, required, due, stale, ready };
    });
    const required = states.filter(item => item.required);
    const complete = Boolean(program?.skillIds.length && required.length === program.skillIds.length && required.every(item => item.ready));
    const proofs = complete ? required.map(item => item.attempt.id).sort() : [];
    const mentor = data.team.find(item => item.id === person.mentorId && item.role === 'mentor');
    const decisions = (data.clearances || []).filter(item => item.personId === person.id && item.date <= day)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const last = decisions[0];
    const clearance = complete && person.role !== 'trainee' && last?.programId === program.id &&
      last.assignmentId === person.assignmentId && proofs.length === last.attemptIds.length && proofs.every(id => last.attemptIds.includes(id))
      ? last : null;
    return { person, program, mentor, states, history, required, complete, proofs, clearance, decisions };
  }

  function networkStatus(data, points, day) {
    const statuses = new Map(data.team.map(person => [person.id, statesFor(data, person, day)]));
    return points.map(point => {
      const roster = point.teamIds.map(id => statuses.get(id));
      const ready = roster.filter(item => item?.clearance ||
        (item?.person.role === 'trainee' && item.complete && statuses.get(item.mentor?.id)?.clearance));
      return { point, total: roster.length, confirmed: ready.length, ready: Boolean(roster.length && ready.length === roster.length && ready.some(item => item.clearance)) };
    });
  }

  window.panel03TeamReadiness = ({ readTraining, writeData, starterSkill, el, line, heading, field, value, requireText,
    dateKey, formatDate, showEditor, trainingAction }) => {
    function memberFields(body, snapshot, person) {
      const role = field('Роль в обучении', 'Определяет программу обязательных практических навыков.', {
        choices: { '': 'Роль не назначена', ...roles }, value: person?.role || '', required: false
      });
      const mentors = snapshot.data.team.filter(item => item.id !== person?.id && item.role === 'mentor');
      const mentor = field('Наставник', 'Кто ведёт практику и фиксирует результаты. Для прохождения программы стажёра назначь наставника.', {
        choices: { '': 'Наставник не назначен', ...Object.fromEntries(mentors.map(item => [item.id, item.name + ' · ' + item.point])) },
        value: mentors.some(item => item.id === person?.mentorId) ? person.mentorId : '', required: false
      });
      body.append(role.wrapper, mentor.wrapper);
      return () => {
        const selected = value(role);
        const assignmentId = person?.role === selected ? person.assignmentId : selected ? crypto.randomUUID() : undefined;
        return { role: selected, mentorId: value(mentor), ...(assignmentId ? { assignmentId } : {}) };
      };
    }

    function seed(snapshot) {
      const data = snapshot.data;
      const day = dateKey();
      const existing = new Set(data.skills.map(item => item.id));
      const skills = [...data.skills, ...[essentials, starterSkill, coaching].filter(item => !existing.has(item.id))];
      const additions = Object.entries(templates).filter(([role]) => !programFor(data, role))
        .map(([role, skillIds]) => ({ id: crypto.randomUUID(), role, skillIds, date: day, createdAt: new Date().toISOString() }));
      writeData(snapshot, { ...data, skills, programs: [...data.programs || [], ...additions] });
      window.dispatchEvent(new window.Event('panel-03:work-changed'));
    }

    function editProgram(snapshot, role) {
      const program = programFor(snapshot.data, role);
      showEditor('Программа · ' + roles[role], body => {
        body.append(heading('Обязательные навыки', 'Отметь навыки, которые сотрудник этой роли должен подтвердить. Изменение программы требует заново сверить допуск.', 'h3'));
        const checks = snapshot.data.skills.map(skill => {
          const label = el('label', '', 'check');
          const input = el('input');
          input.type = 'checkbox';
          input.value = skill.id;
          input.checked = Boolean(program?.skillIds.includes(skill.id));
          label.append(input, el('span', skill.name));
          body.append(label);
          return input;
        });
        return () => {
          const ids = checks.filter(input => input.checked).map(input => input.value).sort();
          if (!ids.length) throw Error('Выбери хотя бы один обязательный навык.');
          if (program && ids.length === program.skillIds.length && ids.every(id => program.skillIds.includes(id))) return program.id;
          const row = { id: crypto.randomUUID(), role, skillIds: ids, date: dateKey(), createdAt: new Date().toISOString() };
          writeData(snapshot, { ...snapshot.data, programs: [...snapshot.data.programs || [], row] });
          return row.id;
        };
      }, 'Сохранить программу', 'Сохраняет состав обязательных навыков. Предыдущая программа остаётся в записях допусков.');
    }

    function renderPrograms(container, snapshot, refresh) {
      container.replaceChildren(heading('Программы ролей', 'Стартовые программы можно применять и редактировать. Прошлые проверки сотрудников сохраняются.'));
      if (Object.keys(roles).some(role => !programFor(snapshot.data, role))) {
        container.append(trainingAction('Загрузить шаблоны ролей', 'Добавляет недостающие программы и три базовых навыка. Уже настроенные программы сохраняются.', () => {
          seed(snapshot);
          refresh();
        }));
      }
      for (const [role, name] of Object.entries(roles)) {
        const program = programFor(snapshot.data, role);
        const row = el('div', '', 'quality-criterion quality-fields');
        row.append(el('h4', name));
        if (program) {
          const skills = program.skillIds.map(id => snapshot.data.skills.find(skill => skill.id === id)?.name || 'Навык недоступен');
          row.append(el('p', skills.join(' · ')));
        } else row.append(el('p', 'Программа ещё не настроена.', 'quiet'));
        const members = snapshot.data.team.filter(item => item.role === role);
        if (members.length) line(row, 'Сотрудники:', String(members.length));
        row.append(trainingAction('Настроить программу · ' + name, 'Открывает обязательный набор навыков для этой роли.', () => editProgram(snapshot, role)));
        container.append(row);
      }
    }

    function openClearance(snapshot, state) {
      showEditor('Допуск к самостоятельной работе', body => {
        line(body, 'Сотрудник:', state.person.name + ' · ' + state.person.point);
        line(body, 'Программа:', roles[state.person.role]);
        for (const row of state.required) line(body, row.skill.name + ':', formatDate(row.attempt.date) + ' · ' + row.attempt.reviewer);
        const approver = field('Шеф-бариста', 'Укажи, кто подтвердил допуск после сверки доказательств.');
        body.append(approver.wrapper);
        return () => {
          const current = statesFor(snapshot.data, state.person, dateKey());
          if (!current.complete || current.person.role === 'trainee' || current.clearance) {
            throw Error('Сверь фактические проверки и программу перед допуском.');
          }
          const row = { id: crypto.randomUUID(), personId: state.person.id, programId: current.program.id, point: state.person.point,
            ...(state.person.assignmentId ? { assignmentId: state.person.assignmentId } : {}),
            approver: requireText(approver), date: dateKey(), createdAt: new Date().toISOString(), attemptIds: current.proofs };
          writeData(snapshot, { ...snapshot.data, clearances: [...snapshot.data.clearances || [], row] });
          return state.person.id;
        };
      }, 'Подтвердить допуск', 'Связывает решение шеф-бариста с программой, точкой и результатами практических проверок.');
    }

    function memberSummary(body, snapshot, state) {
      line(body, 'Роль:', roles[state.person.role] || 'Роль не назначена');
      if (state.person.role) {
        line(body, 'Наставник:', state.mentor?.name || 'Не назначен');
        const complete = state.required.filter(item => item.ready).length;
        line(body, 'Обязательные навыки:', state.program ? complete + ' из ' + state.program.skillIds.length : 'Программа не настроена');
        if (state.person.role === 'trainee') {
          line(body, 'Статус:', state.complete ? 'Программа стажёра выполнена' : 'Стажировка');
        } else {
          const summary = state.clearance ? 'Допуск подтверждён · ' + state.clearance.approver :
            state.complete ? 'Ожидает решения шеф-бариста' : 'Требуются актуальные проверки';
          line(body, 'Допуск:', summary);
          if (state.complete && !state.clearance) body.append(trainingAction('Подтвердить допуск', 'Открывает форму решения шеф-бариста с перечнем подтверждённых навыков.',
            () => openClearance(snapshot, state)));
        }
      }
      if (state.decisions.length) {
        const history = el('details', '', 'quality-criterion');
        history.append(el('summary', 'История допусков · ' + state.decisions.length));
        for (const item of state.decisions) {
          line(history, formatDate(item.date) + ' · ' + item.point, item.approver + ' · ' + item.attemptIds.length + ' проверок');
        }
        body.append(history);
      }
    }

    function reviewImpact(body, data, skill) {
      const affected = data.team.filter(person => programFor(data, person.role)?.skillIds.includes(skill.id));
      const pending = affected.filter(person => {
        const state = statesFor(data, person, dateKey()).states.find(item => item.skill.id === skill.id);
        return state && !state.ready;
      });
      line(body, 'Обязателен для:', affected.length ? affected.map(person => person.name + ' · ' + person.point).join(', ') : 'В программах ролей не используется');
      if (pending.length) line(body, 'Требуется проверка:', pending.map(person => person.name + ' · ' + person.point).join(', '));
    }

    window.panel03TeamReadinessReport = points => networkStatus(readTraining().data, points, dateKey());
    return { memberFields, renderPrograms, memberSummary, reviewImpact, statesFor };
  };
})();
