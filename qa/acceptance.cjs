const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash, webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const core = require('../backup.js');
const calendar = require('../calendar-sync.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fixture = {
  'panel-03:network': {
    profiles: [],
    points: ['base', 'pilot', 'other'].map(id => ({
      id, name: 'Тестовая точка ' + id, manager: '', menu: '', teamIds: [], deviceIds: [], equipmentNotes: '', reviewed: false
    }))
  },
  'panel-03:launches': { settings: [{ id: 'pilot', pointId: 'pilot' }], projects: [] }
};
const configuration = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') :
  JSON.stringify({ format: 'panel-03-backup', version: 1, createdAt: '2026-11-18T09:00:00.000Z', records: fixture });
const backup = core.parseBackup(configuration);
const pilotPoint = backup.records['panel-03:launches'].settings[0].pointId;
const point = backup.records['panel-03:network'].points.find(item=>item.id===pilotPoint);
assert.ok(point, 'В настройках должна быть указана существующая пилотная точка.');
let clock = '2026-11-18T11:00:00.000Z';
class TestDate extends Date {
  constructor(...args){ super(...(args.length?args:[clock])); }
  static now() { return Date.parse(clock); }
}
const d = () => clock.slice(0,10);
const moment = offset => new Date(Date.parse(clock)+offset).toISOString();
const tick = () => new Promise(resolve=>setImmediate(resolve));

function createApp() {
  const map={};
  const localStorage = new Proxy({},{
    ownKeys:()=>Object.keys(map),
    getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),
    get(_,key) {
      if(key==='getItem') return name=>map[name]??null;
      if(key==='setItem') return (name,value)=>{map[name]=String(value);};
      if(key==='removeItem') return name=>delete map[name];
    }
  });
  const { document, window } = parseHTML(html);
  const $ = (selector,root=document) => root.querySelector(selector);
  const location={hash:'#overview',origin:'http://localhost',pathname:'/'};
  window.scrollTo=()=>{};
  const create=document.createElement.bind(document);
  function dialog(node){
    Object.defineProperty(node,'open',{get(){return this.hasAttribute('open');}});
    node.showModal=()=>node.setAttribute('open','');
    node.close=()=>{node.removeAttribute('open');node.dispatchEvent(new window.Event('close'));};
  }
  document.createElement = name => {
    const node=create(name);
    if(name==='dialog')dialog(node);
    if(name==='select')Object.defineProperty(node,'value',{
      get(){return this.querySelector('option[selected]')?.value??this.options[0]?.value??'';},
      set(text){for(const option of this.options)option.toggleAttribute('selected',option.value===text);}
    });
    if(name==='input')Object.defineProperty(node,'valueAsNumber',{get(){return this.value?.trim()?Number(this.value):NaN;}});
    return node;
  };
  for(const node of document.querySelectorAll('dialog'))dialog(node);
  for(const link of document.querySelectorAll('a[href]'))Object.defineProperty(link,'hash',{get(){return this.getAttribute('href');}});
  const eventForm=$('#event-form');
  const fields=Object.fromEntries(Array.from(eventForm.querySelectorAll('[name]'),node=>[node.name,node]));
  Object.defineProperty(eventForm,'elements',{value:fields});
  eventForm.reset=()=>{for(const item of Object.values(fields))item.value='';};
  class StorageEvent extends window.Event{constructor(type,opts){super(type);this.key=opts.key;}}
  const globals={module:undefined,document,window,location,localStorage,crypto:{randomUUID,subtle:webcrypto.subtle},navigator:{},StorageEvent,Event:window.Event,Date:TestDate,
    setInterval:()=>0,setTimeout:setImmediate,fetch:()=>{throw Error('This local scenario must not make network requests');}};
  for(const script of document.querySelectorAll('script')){
    const source=script.getAttribute('src');
    const input = source ? fs.readFileSync(path.join(root, source.replace(/^\.\//,'').split('?')[0]), 'utf8') : script.textContent;
    new Function(...Object.keys(globals),input)(...Object.values(globals));
  }
  const fire=(item,type)=>{
    assert.ok(item,'Missing '+type+' target');
    return item.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));
  };
  const click=(label,root=document)=>{
    const item=[...root.querySelectorAll('button')].find(node=>node.textContent===label);
    assert.ok(item,label);
    fire(item,'click');
  };
  const fill=(label,text,root=$('#quality-editor-body'))=>{
    const field=[...root.querySelectorAll('label')].find(item=>item.textContent===label)?.parentElement.parentElement.querySelector('input,select,textarea');
    assert.ok(field,label);field.value=text;fire(field,'input');fire(field,'change');
  };
  const submit=(open=false)=>{
    fire($('#quality-form'),'submit');
    assert.equal($('#quality-editor').open,open,$('#quality-error').textContent);
  };
  const route=(hash)=>{location.hash='#'+hash;fire(window,'hashchange');};
  const work=(prefix)=>window.panel03CalendarWork().filter(row=>!prefix||JSON.parse(row.key)[0]===prefix);
  const set=(key,value)=>localStorage.setItem('panel-03:'+key,JSON.stringify(value));
  const get=(key)=>JSON.parse(localStorage.getItem('panel-03:'+key));
  const changed=()=>fire(window,'panel-03:work-changed');
  let files=[];
  Object.defineProperty($('#backup-file'),'files',{get:()=>files});
  async function restore(json) {
    fire($('#app-menu'),'click');
    fire($('#backup-open'),'click');
    files=[{text:async()=>json}];
    fire($('#backup-file'),'change');
    await tick();
    assert.equal($('#backup-restore').hidden,false,$('#backup-message').textContent);
    fire($('#backup-restore'),'click');
    await tick();
    assert.match($('#backup-message').textContent,/Готово/);
    fire($('#backup-close'),'click');
    return core.snapshot(localStorage);
  }
  return { $, window, route, work,set,get,click,fill,submit,fire,changed,restore,localStorage };
}

const rule={type:'numeric',min:30,max:35,unit:'г'};
const recipe={id:'drink',draft:null,versions:[{number:1,effective:'2026-11-01',title:'Пилотный напиток',portions:[{
  name:'Стандарт',ingredients:[{name:'Зерно',amount:10,unit:'г'}],preparation:'Метод',service:'Подача',
  criteria:[{name:'Выход',rule,method:'Весы'}]
}]}]};
const person={id:'qabarista',name:'Тестовый бариста',point:point.name,role:'barista',assignmentId:'assignment'};
const standards=['product','service','supplies','equipment'];
const readyChecks = {
  opening:['Станция и чистота','Аллергены','Техника и вода','Сырьё и доступность меню'],
  closing:['Станция и чистота','Техника и вода','Остатки и передача смены']
};
function seed(app) {
  app.set('training',{team:[person],programs:[{id:'prog',role:'barista',date:'2026-11-15',createdAt:'2026-11-15T10:00:00Z',skillIds:['skill']}],
    skills:[{id:'skill',version:1,name:'Выход',task:'Измерить',criteria:[{name:'Выход',rule}]}],
    attempts:[{id:'attempt',personId:person.id,skillId:'skill',version:1,skill:'Выход',task:'Измерить',date:'2026-11-16',
      point:point.name,reviewer:'Тестовый наставник',independent:true,passed:true,results:[{name:'Выход',rule,passed:true,measured:32,notes:''}],
      feedback:'',exercise:'',next:''}],
    clearances:[{id:'ready',personId:person.id,programId:'prog',assignmentId:'assignment',point:point.name,approver:'Тестовый шеф',
      date:'2026-11-17',createdAt:'2026-11-17T10:00:00Z',attemptIds:['attempt']}]});
  app.set('techcards',[recipe]);
  app.set('economy',{supplies:[{id:'beans',kind:'ingredient',name:'Зерно',prices:[{cost:200000,amount:1,unit:'кг',date:'2026-11-01',density:null}]}],
    links:[{key:JSON.stringify(['drink','стандарт','зерно','г']),supply:'beans'}]});
  app.set('suppliers',{suppliers:[{id:'supplier',name:'Тестовый поставщик',contact:'',positions:['beans']}],specs:[],samples:[{
    id:'lot',supplier:'supplier',supply:'beans',kind:'lot',lot:'Партия 1',spec:{id:'beans',version:1,criteria:[]},
    attempts:[{id:'accepted',date:'2026-11-16',conditions:'Проверка',results:[],quote:null,decision:'approved',reason:'',follow:'',next:'',transition:'',impactNote:'',impact:[]}]
  }]});
  app.set('point-operations',{plans:[{id:pilotPoint,first:'2026-11-17',baseVisitId:'',owner:'Тестовый шеф',interval:7}],
    visits:[{id:'visit',pointId:pilotPoint,date:'2026-11-17',createdAt:'2026-11-17T12:00:00Z',kind:'regular',incidentId:'',
      reviewer:'Тестовый шеф',checks:standards.map(category=>({category,state:'ok',note:'Проверено',incidentId:''}))}],incidents:[]});
  app.set('financial-review',{plans:[{id:'financial-goal',pointId:'',kind:'week',from:'2026-11-16',savedAt:'2026-11-16T10:00:00Z',
    revenue:100000,food:.25,margin:.65}],reviews:[]});
  app.set('menu-plans',[{id:'menu-network',pointId:'',date:'2026-11-17',createdAt:'2026-11-17T10:00:00Z',
    rows:[{cardId:'drink',portionKey:'стандарт',version:1,mode:'include',interval:7,since:'2026-11-17'}]},
    {id:'menu-point',pointId:pilotPoint,date:'2026-11-17',createdAt:'2026-11-17T12:00:00Z',rows:[]}]);
  app.set('bar-operations',[]);
  calibration(app,'setup','2026-11-17T12:30:00Z');
  shift(app,'closing','2026-11-17T18:00:00Z');
  shift(app,'opening','2026-11-18T08:00:00Z');
}
function append(key,app,item) { app.set(key,[...(app.get(key)||[]),item]);app.changed(); }
function calibration(app,id,createdAt) {
  append('bar-operations',app,{id,pointId:pilotPoint,date:createdAt.slice(0,10),createdAt,author:'Проверяющий',type:'calibration',cardId:'drink',version:1,portion:0,
    deviceId:'',batch:'Тестовая партия',sampleId:'lot',attemptId:'accepted',adjustment:'Тестовая настройка',
    checks:[{name:'Выход',outcome:'pass',amount:32,rule,note:''}],action:null});
}
function shift(app,phase,createdAt) {
  append('bar-operations',app,{id:phase+'-'+createdAt,pointId:pilotPoint,date:createdAt.slice(0,10),createdAt,author:'Проверяющий',type:'shift',phase,template:1,
    checks:readyChecks[phase].map(name=>({name,rule:null,outcome:'pass',amount:null,note:'Проверено'})),action:null});
}
function sale(app,id) {
  append('sales',app,{id,date:d(),point:point.name,cardId:'drink',drink:'Пилотный напиток',portion:'Стандарт',quantity:5,revenue:100000,returned:0});
}
function quality(app,id,date,passed) {
  app.set('quality:'+id,{id,date,location:point.name,drink:'Пилотный напиток',criteria:[{name:'Выход',rule,
    initial:{outcome:passed?'pass':'fail',detail:'Тестовое наблюдение',measured:passed?32:38,plan:null},repeats:[]}]});
}
function mirrorDouble() {
  const remote=new Map();
  const settings={};
  const calendarInfo={id:'test-calendar',summary:'03 РАБОТА',accessRole:'owner',timeZone:'Europe/Moscow'};
  const operations=[];
  const reply=(data,status=200)=>({status,ok:status<300,json:async()=>structuredClone(data)});
  let revision=0;
  const request=async(url,options={})=>{
    const path=new URL(url).pathname;
    const id=decodeURIComponent(path.split('/').at(-1));
    if(path.endsWith('/calendarList'))return reply({items:[calendarInfo]});
    if(path.includes('/calendarList/'))return reply(calendarInfo);
    if(!options.method)return id==='events'?reply({items:[...remote.values()]}):reply(remote.get(id));
    operations.push(options.method);
    const data=options.body?JSON.parse(options.body):null;
    if(options.method==='POST'){remote.set(data.id,{...data,status:'confirmed',etag:'v'+ ++revision});return reply(remote.get(data.id));}
    assert.equal(options.headers['If-Match'],remote.get(id).etag);
    if(options.method==='DELETE'){remote.delete(id);return reply({},204);}
    remote.set(id,{...remote.get(id),...data,etag:'v'+ ++revision});
    return reply(remote.get(id));
  };
  const sync=work=>calendar.mirror({request,settings,update:patch=>Object.assign(settings,patch),
    digest:async value=>createHash('sha256').update(value).digest('hex'),events:[],work});
  return{sync,remote,operations};
}

async function run(){
  const app=createApp();
  app.route('instruction');
  const handbook=app.$('[data-page="instruction"]').textContent;
  assert.match(handbook,/Фудкост — доля стоимости сырья в выручке/);
  assert.match(handbook,/Приёмка ремонта/);
  app.route('overview');
  const { $, route, click, fill, submit, fire, work, get }=app;
  const initial=await app.restore(configuration);
  assert.deepEqual(initial,backup.records);
  seed(app);
  route('development');
  fire([...$('#development-content').querySelectorAll('.dev-point')].find(item=>item.querySelector('span').textContent===point.name),'click');
  click('Заполнить карточку',$('#development-content'));
  const editor=$('dialog[open] .dev-editor');
  assert.ok(editor);
  editor.querySelector('[name="manager"]').value='Тестовый управляющий';
  editor.querySelector('[name="menu"]').value='Группа напитков';
  editor.querySelector('[name="equipmentNotes"]').value='Тестовые весы';
  for(const option of editor.querySelectorAll('input[type="checkbox"]')) {
    if(/Тестовый бариста|Сведения по точке/.test(option.closest('label')?.textContent||''))option.checked=true;
  }
  fire(editor,'submit');
  assert.ok(get('network').points.find(item=>item.id===pilotPoint).teamIds.includes(person.id),editor.textContent);
  assert.equal(app.window.panel03TeamReadinessReport([get('network').points.find(item=>item.id===pilotPoint)])[0].ready,true);

  route('launches');
  const launches=$('#launch-content');
  assert.ok(launches.textContent.includes('Предпочтительная точка пилота: ' + point.name));
  click('Новое изменение',launches);
  fill('Название изменения','Тест нового стандарта');
  fill('Задача и ожидаемый эффект','Проверить полный маршрут');
  fill('Конец пилота',d());
  fill('Плановая цена порции, ₽','200');
  fill('Максимум отрицательных отзывов, %','50');
  submit();
  const project=()=>get('launches').projects[0];
  const launchCard=()=>$('#launch-content [data-launch-id]');
  assert.equal(project().pointId,pilotPoint);
  assert.equal(project().criteria.food,.25,'Goal comes from actual financial module');
  click('Подтвердить старт пилота',launchCard());
  fill('Партия · Зерно','lot');
  fill('Кто согласовал пилот','Тестовый руководитель');
  submit();
  assert.equal(project().start.calibrationId,'setup');
  const mirror=mirrorDouble();
  assert.equal(work('pilot').length,1);
  const pilotKey=work('pilot')[0].key;
  await mirror.sync(work());
  const remoteHas=key=>[...mirror.remote.values()].some(item=>item.extendedProperties.private.key===key);
  assert.ok(remoteHas(pilotKey));
  const count=mirror.operations.length;
  await mirror.sync(work());
  assert.equal(mirror.operations.length,count);

  clock='2026-11-18T12:00:00.000Z';
  calibration(app,'trial',moment(-3000));
  sale(app,'trial-sale');
  const feedback=()=>{
    fill('Собрано отзывов','2');
    fill('Отрицательные отзывы','0');
    fill('Источники и вывод по отзывам','Два тестовых отзыва');
  };
  click('Записать решение',launchCard());
  fill('Решение шеф-бариста','launch');
  fill('Обоснование решения','Порог подтверждён тестовыми источниками');
  fill('Согласование запуска','Тестовый руководитель согласовал ввод');
  feedback();
  submit();
  assert.equal(project().decision.result,'launch');
  assert.equal(project().decision.observed.quality[0],'trial');
  assert.equal(project().decision.observed.food,.1);
  assert.equal(project().releases.length,0);
  clock='2026-11-19T10:00:00.000Z';
  shift(app,'closing','2026-11-18T18:00:00.000Z');
  shift(app,'opening','2026-11-19T07:00:00.000Z');
  click('Зафиксировать ввод на точке',launchCard());
  fill('Подтверждение работы точки','Подтверждено по тестовому меню');
  fill('Кто подтвердил ввод','Тестовый управляющий');
  fill('Партия · Зерно','lot');
  submit();
  assert.equal(project().releases[0].pointId,pilotPoint);
  const effectKey=work('launch-effect')[0].key;
  await mirror.sync(work());
  assert.ok(!remoteHas(pilotKey));
  assert.ok(remoteHas(effectKey));
  clock='2026-11-19T14:00:00.000Z';
  calibration(app,'after-rollout',moment(-3000));
  sale(app,'rollout-sale');
  click('Записать эффект',launchCard());
  fill('Кто проверил эффект','Тестовый проверяющий');
  fill('Вывод и следующий шаг','Процесс воспроизведён');
  feedback();
  submit();
  assert.equal(project().releases[0].reviews[0].passed,true);
  await mirror.sync(work());
  assert.ok(!remoteHas(effectKey));

  quality(app,'base','2026-11-12',false);
  route('overview');
  $('#management-comparison').open=true;
  fire($('#management-comparison'),'toggle');
  const comparison=$('#management-comparison-content');
  const row=[...comparison.querySelectorAll('details.quality-record')].find(item=>item.querySelector('summary').textContent===point.name);
  const indicator=[...row.querySelectorAll('.quality-criterion')].find(item=>item.querySelector('h4')?.textContent==='Доля критериев в норме');
  click('Назначить действие',indicator);
  fill('Причина или гипотеза','Неустойчивая настройка');
  fill('Что изменить','Повторить настройку');
  fill('Ответственный за действие','Тестовый шеф');
  fill('Целевое значение, %','100');
  submit();
  const actionRow=()=>$('#management-actions-content [data-improvement-id]');
  const managementKey=work('management')[0].key;
  await mirror.sync(work());
  assert.ok(remoteHas(managementKey));
  click('Отметить выполнение',actionRow());
  fill('Что выполнено','Настройку уточнили');
  submit();
  assert.equal(work('management')[0].key,managementKey);
  clock='2026-11-30T10:00:00.000Z';
  quality(app,'measured-effect','2026-11-24',true);
  app.changed();
  click('Проверить эффект',actionRow());
  fill('Вывод по результату','Сопоставимые критерии подтверждены');
  submit();
  assert.equal(get('management')[0].effect.reached,true);
  await mirror.sync(work());
  assert.ok(!remoteHas(managementKey));

  const snapshot=core.exportData(app.localStorage);
  const clean=createApp();
  assert.deepEqual(await clean.restore(JSON.stringify(snapshot)),snapshot.records);
  assert.equal(clean.window.panel03LaunchProgress().verified,1);
  assert.equal(clean.window.panel03ManagementProgress().checked,1);
  assert.deepEqual(clean.work().map(item=>item.key).sort(),work().map(item=>item.key).sort());
  route('overview');
  await app.restore(configuration);
  assert.equal(app.get('launches').projects[0].id,project().id);
  assert.equal(app.get('network').points.find(item=>item.id===pilotPoint).manager,'Тестовый управляющий');
  console.log('PASS acceptance: actual settings, synthetic point setup → approved pilot → rollout → verified effect → management action; restore, repeat import and calendar mirroring.');
}
run().catch(problem=>{console.error(problem);process.exitCode=1;});
