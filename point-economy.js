'use strict';
window.panel03Economy = (() => {
  const groups = {
    g:{family:'mass',shift:0,label:'г'}, kg:{family:'mass',shift:3,label:'кг'},
    ml:{family:'volume',shift:0,label:'мл'}, l:{family:'volume',shift:3,label:'л'},
    pcs:{family:'count',shift:0,label:'шт'},
  };
  const aliases = {
    г:'g', гр:'g', грамм:'g', грамма:'g', граммы:'g', граммов:'g', g:'g',
    кг:'kg', килограмм:'kg', килограмма:'kg', килограммы:'kg', килограммов:'kg', kg:'kg',
    мл:'ml', миллилитр:'ml', миллилитра:'ml', миллилитры:'ml', миллилитров:'ml', ml:'ml',
    л:'l', литр:'l', литра:'l', литры:'l', литров:'l', l:'l',
    шт:'pcs', штука:'pcs', штуки:'pcs', штук:'pcs', pc:'pcs', pcs:'pcs',
  };
  const normalized = value => value.normalize('NFC').trim().toLocaleLowerCase('ru').replace(/\s+/g,' ');
  const unit = value => groups[aliases[normalized(value).replace(/\.$/,'')]];
  const keyFor = (name,family) => normalized(name) + '|' + family;
  const present = value => typeof value === 'string' && Boolean(value.trim());
  const cash = value => Number.isSafeInteger(value) && value >= 0 && value <= 99999999999;
  const target = value => Number.isSafeInteger(value) && value > 0 && value <= 10000;
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  const power = value => 10n ** BigInt(value);

  function minorUnits(value) {
    if (!/^(?:\d{1,9}(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(value)) return null;
    const [whole,fraction = ''] = value.replace(',','.').split('.');
    return Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  }

  function validate(rows, points) {
    const ids = new Set(points.map(row=>row.id));
    return Array.isArray(rows) && rows.every(row => row && ids.has(row.id) &&
      Array.isArray(row.costs) && row.costs.every(price => price && present(price.id) && cash(price.cents) && typeof price.unit === 'string' && Object.hasOwn(groups,price.unit)) && unique(row.costs) &&
      Array.isArray(row.drinks) && row.drinks.every(drink => drink && present(drink.id) &&
        (drink.sale === undefined || (cash(drink.sale) && drink.sale > 0)) &&
        (drink.goal === undefined || target(drink.goal)) && Array.isArray(drink.links) &&
        drink.links.every(link => link && present(link.id) && present(link.itemId)) && unique(drink.links)) && unique(row.drinks)) &&
      unique(rows);
  }

  function calculate(recipe, items, state, settings) {
    const costs = new Map(state.costs.map(price=>[price.id,price]));
    const links = new Map(settings.links.map(link=>[link.id,link.itemId]));
    const inventory = new Map(items.map(item=>[item.id,item]));
    const ingredients = recipe.ingredients.map(row => {
      const [whole, fraction = ''] = row.amount.replace(',','.').split('.');
      return {...row, source:unit(row.unit), digits:BigInt(whole + fraction), places:fraction.length};
    });
    const precision = 3 + ingredients.reduce((max,row) => Math.max(max,row.places),0);
    const divisor = power(precision);
    let total = 0n;
    let missing = 0;
    const lines = ingredients.map(row => {
      const key = row.source && keyFor(row.name,row.source.family);
      const item = inventory.get(links.get(key));
      const stockUnit = item && groups[item.unit];
      const price = costs.get(item?.id);
      const cents = price?.cents;
      const state = !row.source ? 'Единица техкарты пока не поддерживается' :
        !item || stockUnit.family !== row.source.family ? 'Свяжи ингредиент с сырьём' :
        !price ? 'Укажи закупочную цену' :
        price.unit !== item.unit ? 'Обнови закупочную цену для новой единицы учёта' : '';
      const portion = state ? null :
        BigInt(cents) * row.digits * power(precision - row.places + row.source.shift - stockUnit.shift);
      if (portion === null) missing++;
      else total += portion;
      return {row,item,stockUnit,cents,portion,state};
    });
    return {lines,divisor,missing,total:missing ? null : total};
  }

  const round = (n,d) => (2n*n + d) / (2n*d);
  function basisPoints(calculation,sale) {
    return calculation.total === null || !sale ? null :
      round(calculation.total * 10000n,calculation.divisor * BigInt(sale));
  }

  function foodCost(records,pointId,recipeId,version) {
    const state = records.economy?.find(row=>row.id === pointId);
    const settings = state?.drinks.find(row=>row.id === recipeId);
    if (!settings?.sale) return null;
    const items = records.stock?.find(row=>row.id === pointId)?.items ?? [];
    return basisPoints(calculate(version,items,state,settings),settings.sale)?.toString() ?? null;
  }

  const minimum = ({total,divisor},goal) => {
    if (total === null || !target(goal)) return null;
    const denominator = divisor * BigInt(goal);
    return total ? (total*100n + denominator - 1n) / denominator : 1n;
  };

  const number = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  function decimals(minor) {
    const value = BigInt(minor);
    const absolute = value < 0n ? -value : value;
    const fraction = String(absolute % 100n).padStart(2,'0').replace(/0+$/,'');
    return (value < 0n ? '−' : '') + number.format(absolute / 100n) + (fraction ? ',' + fraction : '');
  }
  const formatRate = value => decimals(value) + ' %';
  const formatMoney = value => value === null ? '—' : decimals(value) + ' ₽';

  function create({records, hero, escape, options, getMain, effective, commit, redraw, exit, openStock}) {
    const date = new Intl.DateTimeFormat('ru',{dateStyle:'medium',timeZone:'Europe/Moscow'});
    const money = formatMoney;
    const asField = value => value === undefined ? '' : String(value / 100).replace('.',',');
    function percentages(calculation,sale) {
      const value = basisPoints(calculation,sale);
      return value === null ? '—' : formatRate(value);
    }
    const roundedCost = ({total,divisor}) => total === null ? null : round(total,divisor);
    const economy = () => records().economy ?? [];
    const point = () => records().points.find(row => row.id === pointId);
    const state = () => economy().find(row => row.id === pointId) ?? {id:pointId,costs:[],drinks:[]};
    const itemChoices = () => [...(records().stock?.find(row=>row.id === pointId)?.items ?? [])].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    const drinks = () => (records().recipes ?? []).filter(row=>effective(row,pointId)).sort((a,b)=>a.name.localeCompare(b.name,'ru') || a.volumeMl - b.volumeMl);
    const menuItem = () => drinks().find(row=>row.id === drinkId);
    const recipe = () => effective(menuItem(),pointId);
    const settings = (row = state()) => row.drinks.find(entry=>entry.id === drinkId) ?? {id:drinkId,links:[]};
    const title = row => row.name + ' ' + row.volumeMl + ' мл';
    const subtitle = () => point().name + ' · ' + title(menuItem());
    const current = () => calculate(recipe(),itemChoices(),state(),settings());
    const action = (name,label,{primary = false, data = ''} = {}) =>
      `<button type="button" class="action${primary ? ' primary' : ''}" data-economy-action="${name}" ${data}>${label}</button>`;
    const back = (name,label) => `<button type="button" class="back" data-economy-action="${name}">← ${label}</button>`;
    const submit = label => `<button type="submit" class="action primary">${label}</button>`;
    const warning = '<p class="notice audit-error" role="alert" hidden></p>';
    const row = (label,value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
    let screen, pointId, drinkId, pricesFrom;

    function open(id, drink) {
      pointId = id;
      drinkId = drink;
      screen = drink ? 'drink' : 'home';
    }

    function show(next,message) {
      screen = next;
      redraw(message);
    }

    function save(updated) {
      const all = economy();
      return commit(all.some(row=>row.id === updated.id) ? all.map(row=>row.id === updated.id ? updated : row) : [...all,updated]);
    }

    function saveSettings(changes) {
      const stateRow = state();
      const entry = {...settings(stateRow),...changes};
      const drinks = stateRow.drinks.some(row => row.id === entry.id) ?
        stateRow.drinks.map(row => row.id === entry.id ? entry : row) : [...stateRow.drinks,entry];
      return save({...stateRow,drinks});
    }

    function home() {
      const rows = drinks();
      return `${back('point','Карточка точки')}${hero('Экономика',point().name,true)}
        <div class="audit-layout">${action('prices','Закупочные цены')}
          <section class="section audit-layout"><h2>Напитки</h2>
            ${rows.length ? `<div class="audit-list">${rows.map(row => action('drink',escape(title(row)),
              {data:'data-drink-id="' + escape(row.id) + '"'})).join('')}</div>` :
              '<p>Для расчёта опубликуй техкарты точки во вкладке «Меню».</p>'}
          </section></div>`;
    }

    function drink() {
      const result = current();
      const saved = settings();
      return `${back('home','Экономика')}${hero('Экономика напитка',subtitle(),true)}
        <div class="audit-layout">
          <section class="section audit-layout"><h2>Действующая техкарта</h2>
            <p>Версия от ${escape(date.format(new Date(recipe().publishedAt)))}</p>
            <dl class="stock-result">
              ${row('Стоимость сырья',money(roundedCost(result)))}
              ${row('Цена продажи',money(saved.sale ?? null))}
              ${row('Расчётный фудкост',percentages(result,saved.sale))}
            </dl>
            ${result.missing ? '<p>Для расчёта заполни связи и закупочные цены сырья.</p>' : ''}
          </section>
          ${action('detail','Открыть расчёт сырья',{primary:true})}
          ${action('goal','Рассчитать цену под цель')}
          ${action('sale',saved.sale ? 'Изменить цену продажи' : 'Указать цену продажи')}
        </div>`;
    }

    function details() {
      const result = current();
      return `${back('drink-back','К напитку')}${hero('Расчёт сырья',subtitle(),true)}
        <div class="audit-layout">
          ${result.lines.map(line => `<section class="section audit-layout">
            <h2>${escape(line.row.name)} · ${escape(line.row.amount.replace('.',','))} ${escape(line.row.unit)}</h2>
            ${line.state ? `<p>${escape(line.state)}</p>` : `<p>${escape(line.item.name)} · ${escape(money(line.cents))} за ${escape(line.stockUnit.label)}</p>
              <strong>${escape(money(round(line.portion,result.divisor)))}</strong>`}
          </section>`).join('')}
          <section class="section"><dl class="stock-result">${row('Стоимость порции',money(roundedCost(result)))}</dl></section>
          ${action('links','Связать ингредиенты с сырьём')}
          ${action('prices','Изменить закупочные цены')}
        </div>`;
    }

    function linkFields() {
      const items = itemChoices();
      const linked = new Map(settings().links.map(link=>[link.id,link.itemId]));
      const groupsOfRows = new Map();
      for (const row of recipe().ingredients) {
        const source = unit(row.unit);
        const key = source && keyFor(row.name,source.family);
        if (source && !groupsOfRows.has(key)) groupsOfRows.set(key,{...row,source});
      }
      return `${back('detail','К расчёту сырья')}${hero('Связи с сырьём',subtitle(),true)}
        <form data-form="economy-links">
          ${[...groupsOfRows].map(([id,row]) => {
            const compatible = items.filter(item=>groups[item.unit].family === row.source.family);
            const suggested = compatible.find(item=>normalized(item.name) === normalized(row.name));
            const choices = {'':'Выбрать сырьё',...Object.fromEntries(compatible.map(item=>[item.id,item.name + ' · ' + groups[item.unit].label]))};
            return `<label>${escape(row.name)} · ${escape(row.unit)}
              <select data-link-id="${escape(id)}">${options(choices,linked.get(id) ?? suggested?.id ?? '')}</select></label>`;
          }).join('')}
          ${recipe().ingredients.some(row=>!unit(row.unit)) ?
            '<p class="empty">Для расчёта используй в техкарте г, кг, мл, л или шт.</p>' : ''}
          ${items.length ? '' : action('stock','Открыть сырьё точки')}
          ${groupsOfRows.size ? submit('Сохранить связи') : ''}
        </form>`;
    }

    function prices() {
      const saved = new Map(state().costs.map(price=>[price.id,price]));
      const items = itemChoices();
      return `${back('prices-back',pricesFrom === 'detail' ? 'К расчёту сырья' : 'Экономика')}${hero('Закупочные цены',point().name,true)}
        ${items.length ? `<form data-form="economy-prices">
          ${items.map(item => {
            const price = saved.get(item.id);
            return `<label>${escape(item.name)} · ₽ за ${escape(groups[item.unit].label)}
              <input name="cost" inputmode="decimal" maxlength="13" data-item-id="${escape(item.id)}"
                value="${escape(asField(price?.unit === item.unit ? price.cents : undefined))}"></label>`;
          }).join('')}
          ${warning}${submit('Сохранить закупочные цены')}
        </form>` : `<div class="audit-layout"><p class="empty">Добавь позиции во вкладке «Сырьё» этой точки.</p>${action('stock','Открыть сырьё точки')}</div>`}`;
    }

    function sale() {
      return `${back('drink-back','К напитку')}${hero('Цена продажи',subtitle(), true)}
        <form data-form="economy-sale"><label>Цена за порцию, ₽
          <input name="sale" inputmode="decimal" maxlength="13" value="${escape(asField(settings().sale))}" required></label>
          ${warning}${submit('Сохранить цену')}</form>`;
    }

    function goal() {
      const result = current();
      const saved = settings();
      const currentGoal = saved.goal ?? 1400;
      return `${back('drink-back','К напитку')}${hero('Цена под цель',subtitle(),true)}
        <form data-form="economy-goal">
          <label>Целевой фудкост, %<input name="goal" inputmode="decimal" maxlength="6" value="${escape(asField(currentGoal))}" required></label>
          <section class="section"><dl class="stock-result">
            ${row('Сырьё на порцию',money(roundedCost(result)))}
            ${row('Текущая цена',money(saved.sale ?? null))}
            <div><dt>Минимальная цена</dt><dd data-goal-price>${escape(goalPrice(result,currentGoal))}</dd></div>
          </dl></section>
          <p>Цена округляется вверх до целого рубля.</p>
          ${result.missing ? '<p>Заполни связи и закупочные цены, чтобы рассчитать минимум.</p>' : ''}
          ${warning}${submit('Сохранить цель')}
        </form>`;
    }

    function goalPrice(calculation,value) {
      const price = minimum(calculation,value);
      return price === null ? '—' : 'от ' + number.format(price) + ' ₽';
    }

    function draw() {
      if (screen === 'drink') return drink();
      if (screen === 'detail') return details();
      if (screen === 'links') return linkFields();
      if (screen === 'prices') return prices();
      if (screen === 'sale') return sale();
      if (screen === 'goal') return goal();
      return home();
    }

    function warn(form,message,field) {
      const alert = form.querySelector('[role=alert]');
      alert.textContent = message;
      alert.hidden = false;
      field?.focus();
    }

    function submitForm(form) {
      if (screen === 'prices') {
        const costs = [];
        const items = new Map(itemChoices().map(item=>[item.id,item]));
        for (const field of form.querySelectorAll('[name=cost]')) {
          const raw = field.value.trim();
          if (!raw) continue;
          const cents = minorUnits(raw);
          if (cents === null) return warn(form,'Укажи цену в рублях с точностью до копеек.',field);
          const item = items.get(field.dataset.itemId);
          costs.push({id:item.id,cents,unit:item.unit});
        }
        if (save({...state(),costs})) show(pricesFrom,'Закупочные цены сохранены.');
      } else if (screen === 'links') {
        const links = new Map(settings().links.map(link=>[link.id,link]));
        for (const select of form.querySelectorAll('[data-link-id]')) {
          const id = select.dataset.linkId;
          if (select.value) links.set(id,{id,itemId:select.value});
          else links.delete(id);
        }
        if (saveSettings({links:[...links.values()]})) show('detail','Связи сохранены.');
      } else if (screen === 'sale') {
        const field = form.elements.sale;
        const sale = minorUnits(field.value.trim());
        if (!sale) return warn(form,'Укажи цену больше нуля с точностью до копеек.',field);
        if (saveSettings({sale})) show('drink','Цена продажи сохранена.');
      } else if (screen === 'goal') {
        const field = form.elements.goal;
        const goal = minorUnits(field.value.trim());
        if (!target(goal)) return warn(form,'Укажи процент больше 0 и не выше 100.',field);
        if (saveSettings({goal})) show('drink','Целевой фудкост сохранён.');
      }
    }

    function click(button) {
      const data = button.dataset, name = data.economyAction;
      if (name === 'point') return exit(point());
      if (name === 'stock') return openStock(pointId);
      if (name === 'drink') {
        drinkId = data.drinkId;
        return show('drink');
      }
      if (name === 'drink-back') return show('drink');
      if (name === 'prices') {
        pricesFrom = screen;
        return show('prices');
      }
      if (name === 'prices-back') return show(pricesFrom);
      if (['detail','links','goal','sale','home'].includes(name)) return show(name);
    }

    function input(field) {
      if (field.name !== 'goal' || field.form?.dataset.form !== 'economy-goal') return;
      getMain().querySelector('[data-goal-price]').textContent = goalPrice(current(),minorUnits(field.value.trim()));
    }

    return {open,draw,submit:submitForm,click,input};
  }

  return {create,validate,foodCost,formatRate,formatMoney};
})();
