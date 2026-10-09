/* 轻账：原生浏览器应用，账目金额统一以“分”保存。 */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const Core = window.LedgerCore;
const {localDateKey,dateFromKey,shiftDate,shiftMonth,monthKey,mondayOf,parseMoney,sumRecords} = Core;
const TODAY = localDateKey(new Date());
const moneyFormatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const palette = ['#647eea','#e57669','#4aad86','#e6ad56','#8b72d8','#45a9bb','#e28ab2','#93a750','#e18b4d','#7388a2','#cf6f9c','#5d9fd4'];
const iconChoices = ['🍜','🥬','🧻','🏠','🔑','🏦','💡','📶','🚇','🚌','🚕','🚗','🩺','💊','🏃','👕','💄','🎓','📚','💻','🎬','✈️','🍻','🎁','🐾','👨‍👩‍👧','🍼','🖇️','🧳','🛡️','🧾','💝','💰','🎉','🪙','↩️','🧺','⭐'];
const avatarPresets = [
  {id:'person',name:'简约',symbol:'♙',background:'#edf1ff',color:'#4868df'},
  {id:'leaf',name:'绿叶',symbol:'♧',background:'#e8f6ee',color:'#39956d'},
  {id:'sun',name:'晴日',symbol:'☼',background:'#fff4dc',color:'#bd811d'},
  {id:'moon',name:'月光',symbol:'☾',background:'#f0ebff',color:'#7458c3'},
  {id:'star',name:'星光',symbol:'✦',background:'#fff0e7',color:'#d97445'},
  {id:'flower',name:'花朵',symbol:'❀',background:'#fff0f5',color:'#c75f8a'},
  {id:'heart',name:'爱心',symbol:'♡',background:'#ffeded',color:'#d35b62'},
  {id:'music',name:'音乐',symbol:'♪',background:'#e8f3ff',color:'#4384c7'},
  {id:'wave',name:'海浪',symbol:'◉',background:'#e8f8f7',color:'#2f9594'},
  {id:'mountain',name:'山峰',symbol:'△',background:'#eef2f5',color:'#58677a'},
];
const expenseSeeds = [
  ['生活','餐饮','🍜'],['生活','食材','🥬'],['生活','日用品','🧻'],['生活','社交','🍻'],['生活','礼物','🎁'],['生活','家庭','👨‍👩‍👧'],['生活','育儿','🍼'],['生活','宠物','🐾'],['生活','公益','💝'],['生活','其他','🧺'],
  ['居住','住房','🏠'],['居住','房租','🔑'],['居住','房贷','🏦'],['居住','水电燃气','💡'],['居住','网络通信','📶'],
  ['交通','通勤','🚶'],['交通','公共交通','🚇'],['交通','打车','🚕'],['交通','汽车','🚗'],
  ['健康','医疗','🩺'],['健康','药品','💊'],['健康','健身','🏃'],['健康','美容','💄'],['健康','保险','🛡️'],
  ['学习','教育','🎓'],['学习','书籍','📚'],
  ['休闲','服饰','👕'],['休闲','数码','💻'],['休闲','娱乐','🎬'],['休闲','旅行','✈️'],
  ['工作','办公','🖇️'],['工作','差旅','🧳'],['财务','税费','🧾']
];
const incomeSeeds = [
  ['工作','工资','💰'],['工作','奖金','🎉'],['工作','兼职','🧑‍💻'],['工作','经营','🏪'],['工作','报销','🧾'],['生活','补贴','🪙'],['理财','投资收益','📈'],['理财','利息','🏦'],['生活','礼金','🎁'],['生活','退款','↩️'],['生活','其他','⭐']
];
const seedCategories = [
  ...expenseSeeds.map((c,i)=>({id:`seed_e_${String(i).padStart(2,'0')}`,type:'expense',group:c[0],name:c[1],icon:c[2],builtin:true})),
  ...incomeSeeds.map((c,i)=>({id:`seed_i_${String(i).padStart(2,'0')}`,type:'income',group:c[0],name:c[1],icon:c[2],builtin:true}))
];

function formatDate(key, opts={}) { const d=dateFromKey(key); return new Intl.DateTimeFormat('zh-CN',opts).format(d); }
function fmtMoney(cents) { return moneyFormatter.format((Number(cents)||0)/100); }
function compactMoney(cents) { const n=(Number(cents)||0)/100, abs=Math.abs(n); if(abs>=100000000) return `${n<0?'−':''}${(abs/100000000).toFixed(1)}亿`; if(abs>=10000) return `${n<0?'−':''}${(abs/10000).toFixed(abs>=100000?0:1)}万`; if(abs>=1000) return `${n<0?'−':''}${(abs/1000).toFixed(abs>=10000?0:1)}k`; return `${n<0?'−':''}${abs.toFixed(0)}`; }
function htmlSafe(value) { return String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dateIsValid(key) { if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false; return localDateKey(dateFromKey(key))===key; }

let dbPromise;
function openDatabase() {
  if(dbPromise) return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable')); return; }
    const request=indexedDB.open('qingzhang-local-v1',1);
    request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains('app')) request.result.createObjectStore('app',{keyPath:'id'}); };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Could not open local database'));
  });
  return dbPromise;
}
async function readPersistedState() {
  try { const db=await openDatabase(); const data=await new Promise((resolve,reject)=>{ const req=db.transaction('app','readonly').objectStore('app').get('state'); req.onsuccess=()=>resolve(req.result?.value||null); req.onerror=()=>reject(req.error); }); if(data) return data; }
  catch(e) { console.warn('IndexedDB unavailable; using localStorage fallback.',e); }
  try { const raw=localStorage.getItem('qingzhang-state-v1'); return raw?JSON.parse(raw):null; } catch { return null; }
}
async function persistLocalState(data) {
  try { const db=await openDatabase(); await new Promise((resolve,reject)=>{ const tx=db.transaction('app','readwrite'); tx.objectStore('app').put({id:'state',value:data}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Save aborted')); }); return 'indexeddb'; }
  catch(e) { console.warn('IndexedDB save failed; trying localStorage.',e); try { localStorage.setItem('qingzhang-state-v1',JSON.stringify(data)); return 'localstorage'; } catch { throw new Error('本机保存失败。请检查浏览器存储空间或隐私设置后重试。'); } }
}
async function clearLocalState() {
  try { const db=await openDatabase(); await new Promise((resolve,reject)=>{ const tx=db.transaction('app','readwrite'); tx.objectStore('app').delete('state'); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('清理本机缓存失败')); }); }
  catch(e) { console.warn('Could not clear local account cache.',e); }
  try { localStorage.removeItem('qingzhang-state-v1'); } catch {}
}
async function apiRequest(path,options={}) {
  let response;
  try { response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}); }
  catch { throw new Error('无法连接轻账账户服务。请确认 server.py 正在运行，再重试。'); }
  let payload={};try { payload=await response.json(); } catch {}
  if(!response.ok) {const error=new Error(payload.error||`账户服务返回 ${response.status}`);error.status=response.status;error.payload=payload;throw error;}
  return payload;
}
function emptyState() { return {version:1,categories:seedCategories.map(c=>({...c})),transactions:[],monthBudgets:{},dayBudgets:{}}; }
let state=emptyState();
let account=null;
let accountBase=null;
let page='calendar', calendarView='month', selectedDate=TODAY;
let statsPeriod='month', selectedYear=Number(TODAY.slice(0,4)), selectedMonth=monthKey(TODAY), selectedWeekDate=TODAY;
let trendCounts={year:10,month:8,week:14}, trendCustom={year:false,month:false,week:false}, seriesVisible={expense:true,income:true,net:true};
let selectedCategoryGroup='', selectedCategoryId='';
let activeModal=null, categoryReturnDraft=null, avatarEditorValue='preset:person';
const main=$('#mainView'), modalBackdrop=$('#modalBackdrop'), modalBody=$('#modalBody');

function normalizeState(saved) {
  if(!saved||typeof saved!=='object')return emptyState();
  return {
    ...emptyState(),...saved,
    categories:Array.isArray(saved.categories)&&saved.categories.length?saved.categories:seedCategories.map(c=>({...c})),
    transactions:Array.isArray(saved.transactions)?saved.transactions:[],
    monthBudgets:saved.monthBudgets&&typeof saved.monthBudgets==='object'?saved.monthBudgets:{},
    dayBudgets:saved.dayBudgets&&typeof saved.dayBudgets==='object'?saved.dayBudgets:{},
  };
}
function cloneState(data) { return JSON.parse(JSON.stringify(data)); }
function hasUserData(data) {
  return !!(data?.transactions?.length||Object.keys(data?.monthBudgets||{}).length||Object.keys(data?.dayBudgets||{}).length||data?.categories?.some(c=>!c.builtin));
}
function mergeAccountData(remote,local) {
  const categories=[...(remote.categories||[])], categoryIds=new Set(categories.map(c=>c.id));
  for(const category of local.categories||[])if(!categoryIds.has(category.id)){categories.push(category);categoryIds.add(category.id);}
  const transactions=new Map((remote.transactions||[]).map(t=>[t.id,t]));
  for(const transaction of local.transactions||[]){const previous=transactions.get(transaction.id);if(!previous||(transaction.updatedAt||0)>(previous.updatedAt||0))transactions.set(transaction.id,transaction);}
  return {version:1,categories,transactions:[...transactions.values()],monthBudgets:{...(local.monthBudgets||{}),...(remote.monthBudgets||{})},dayBudgets:{...(local.dayBudgets||{}),...(remote.dayBudgets||{})}};
}
function mergeConcurrentAccountData(base,local,remote) {
  const categories=[...(remote.categories||[])],categoryIds=new Set(categories.map(c=>c.id));
  for(const category of local.categories||[])if(!categoryIds.has(category.id)){categories.push(category);categoryIds.add(category.id);}
  const baseTransactions=new Map((base?.transactions||[]).map(t=>[t.id,t])),localTransactions=new Map((local.transactions||[]).map(t=>[t.id,t])),remoteTransactions=new Map((remote.transactions||[]).map(t=>[t.id,t]));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),transactions=[];
  const transactionIds=new Set([...baseTransactions.keys(),...localTransactions.keys(),...remoteTransactions.keys()]);
  for(const id of transactionIds){
    const before=baseTransactions.get(id),mine=localTransactions.get(id),theirs=remoteTransactions.get(id);
    if(!mine){if(!before&&theirs)transactions.push(theirs);continue;}
    if(!theirs){if(!before||!same(mine,before))transactions.push(mine);continue;}
    if(!before){transactions.push((mine.updatedAt||0)>(theirs.updatedAt||0)?mine:theirs);continue;}
    const mineChanged=!same(mine,before),theirsChanged=!same(theirs,before);
    if(!mineChanged)transactions.push(theirs);
    else if(!theirsChanged)transactions.push(mine);
    else transactions.push((mine.updatedAt||0)>=(theirs.updatedAt||0)?mine:theirs);
  }
  function mergeBudgets(baseMap,localMap,remoteMap){
    const merged={};const keys=new Set([...Object.keys(baseMap||{}),...Object.keys(localMap||{}),...Object.keys(remoteMap||{})]);
    for(const key of keys){const b=baseMap?.[key],l=localMap?.[key],r=remoteMap?.[key];const hasB=Object.prototype.hasOwnProperty.call(baseMap||{},key),hasL=Object.prototype.hasOwnProperty.call(localMap||{},key),hasR=Object.prototype.hasOwnProperty.call(remoteMap||{},key);
      const localChanged=hasL!==hasB||l!==b,remoteChanged=hasR!==hasB||r!==b;
      if(!localChanged&&hasR)merged[key]=r;else if(localChanged&&!remoteChanged&&hasL)merged[key]=l;else if(localChanged&&remoteChanged&&hasL)merged[key]=l;
    }
    return merged;
  }
  return {version:1,categories,transactions,monthBudgets:mergeBudgets(base?.monthBudgets,local.monthBudgets,remote.monthBudgets),dayBudgets:mergeBudgets(base?.dayBudgets,local.dayBudgets,remote.dayBudgets)};
}
async function saveAccountChanges() {
  const local=cloneState(state);
  for(let attempt=0;attempt<4;attempt++){
    const latest=await apiRequest('/api/data'),remote=normalizeState(latest.data);
    const merged=mergeConcurrentAccountData(accountBase?cloneState(accountBase):remote,local,remote);
    try {
      const result=await apiRequest('/api/data',{method:'PUT',body:JSON.stringify({data:merged,expectedRevision:latest.revision})});
      accountBase=cloneState(merged);state=merged;return;
    } catch(error) { if(error.status!==409||attempt===3)throw error; }
  }
  throw new Error('其他浏览器持续更新账本，请稍后再保存。');
}
function updateAccountButton() {
  const button=$('#accountButton'),label=$('#accountLabel');
  if(!button||!label)return;
  const avatar=$('.account-avatar',button),value=account?.avatar||'preset:person';
  if(avatar){
    avatar.innerHTML=avatarContent(value);
    const preset=avatarPreset(value);
    if(avatar.style){avatar.style.background=preset?.background||'#edf1ff';avatar.style.color=preset?.color||'#4868df';}
  }
  label.textContent=account?account.username:'登录';
  button.title=account?`已登录：${account.username} · 账本同步中`:'登录个人账户，在其他浏览器共享账本';
  button.classList.toggle('signed-in',!!account);
}

function avatarPreset(value) { return avatarPresets.find(p=>value===`preset:${p.id}`)||avatarPresets[0]; }
function isAvatarImage(value) { return typeof value==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value); }
function normalizeAvatar(value) { return isAvatarImage(value)||avatarPresets.some(p=>value===`preset:${p.id}`)?value:'preset:person'; }
function avatarContent(value) {
  const normalized=normalizeAvatar(value);
  return isAvatarImage(normalized)?`<img class="avatar-image" src="${htmlSafe(normalized)}" alt="">`:htmlSafe(avatarPreset(normalized).symbol);
}
function accountAvatarMarkup(value,size='') {
  const normalized=normalizeAvatar(value),preset=avatarPreset(normalized),background=isAvatarImage(normalized)?'#edf1ff':preset.background,color=isAvatarImage(normalized)?'#4868df':preset.color;
  return `<span class="account-avatar ${htmlSafe(size)}" style="background:${background};color:${color}" aria-hidden="true">${avatarContent(normalized)}</span>`;
}
function avatarChoicesMarkup(value) {
  const normalized=normalizeAvatar(value);
  return avatarPresets.map(p=>`<button type="button" class="avatar-choice ${normalized===`preset:${p.id}`?'active':''}" data-avatar-preset="${p.id}" aria-label="${p.name}" title="${p.name}">${accountAvatarMarkup(`preset:${p.id}`,'avatar-choice-icon')}<span>${p.name}</span></button>`).join('');
}

function currentDateLabel(key) { return formatDate(key,{year:'numeric',month:'long',day:'numeric',weekday:'long'}); }
function getCategory(id) { return state.categories.find(c=>c.id===id)||{id:'missing',type:'expense',group:'其他',name:'已移除分类',icon:'❔'}; }
function recordsOn(key) { return state.transactions.filter(t=>t.date===key).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)); }
function allOnDate(key) { return recordsOn(key); }
function dailyBudgetContext(key) {
  const mk=monthKey(key),monthBudget=state.monthBudgets[mk]||0;
  const hasOverride=Object.prototype.hasOwnProperty.call(state.dayBudgets,key);
  return {monthBudget,hasOverride,...Core.dailyBudgetForDate(monthBudget,key,state.transactions,state.dayBudgets[key],hasOverride)};
}
function dateLabelShort(key) { const d=dateFromKey(key); return `${d.getMonth()+1}月${d.getDate()}日`; }
function amountForCell(cents) { const n=cents/100; if(n>=10000) return `${(n/10000).toFixed(1)}万`; if(n>=1000) return `${(n/1000).toFixed(1)}千`; return n.toFixed(0); }
function toast(message,error=false) { const el=document.createElement('div'); el.className=`toast${error?' error':''}`; el.textContent=message; $('#toastRegion').append(el); setTimeout(()=>el.remove(),2700); }
async function commit(message) {
  try { if(account)await saveAccountChanges();else await persistLocalState(state); render(); if(message) toast(message); }
  catch(e) { render(); toast(e?.message||'保存失败，请检查账户服务或浏览器本机存储设置。',true); }
}

function calendarHeaderTitle() {
  const date=dateFromKey(selectedDate);
  if(calendarView==='month') return `${date.getFullYear()}年 ${String(date.getMonth()+1).padStart(2,'0')}月`;
  if(calendarView==='week') { const start=mondayOf(selectedDate), end=shiftDate(start,6); return `${formatDate(start,{year:'numeric',month:'short',day:'numeric'})} – ${formatDate(end,{year:'numeric',month:'short',day:'numeric'})}`; }
  return formatDate(selectedDate,{year:'numeric',month:'long',day:'numeric'});
}
function calendarSummary(key) { const rs=allOnDate(key); return {expense:sumRecords(rs,'expense'),income:sumRecords(rs,'income')}; }
function calendarCell(key,currentMonth,weekMode=false) {
  const d=dateFromKey(key), summary=calendarSummary(key), outside=currentMonth && monthKey(key)!==currentMonth;
  const classes=['calendar-cell',outside?'outside':'',key===TODAY?'today':'',key===selectedDate?'selected':'',weekMode?'week-cell':''].filter(Boolean).join(' ');
  return `<button class="${classes}" data-date="${key}" aria-label="${currentDateLabel(key)}，支出 ${fmtMoney(summary.expense)}，收入 ${fmtMoney(summary.income)}">
    <span class="day-number">${d.getDate()}</span>
    <span class="cell-totals">${summary.expense?`<span class="cell-dot cell-expense">−${amountForCell(summary.expense)}</span>`:''}${summary.income?`<span class="cell-dot cell-income">+${amountForCell(summary.income)}</span>`:''}</span>
  </button>`;
}
function calendarCanvas() {
  if(calendarView==='day') {
    const d=dateFromKey(selectedDate), s=calendarSummary(selectedDate);
    return `<div class="day-canvas"><div class="day-card"><div class="day-big">${d.getDate()}</div><div class="day-meta">${formatDate(selectedDate,{year:'numeric',month:'long',weekday:'long'})}</div><div class="day-flow"><span>收入<b style="color:var(--green)">${fmtMoney(s.income)}</b></span><span>支出<b style="color:var(--red)">${fmtMoney(s.expense)}</b></span></div></div></div>`;
  }
  let keys=[];
  if(calendarView==='month') {
    const d=dateFromKey(selectedDate), first=localDateKey(new Date(d.getFullYear(),d.getMonth(),1,12)), start=mondayOf(first);
    keys=Array.from({length:42},(_,i)=>shiftDate(start,i));
  } else { const start=mondayOf(selectedDate); keys=Array.from({length:7},(_,i)=>shiftDate(start,i)); }
  const titleMonth=calendarView==='month'?monthKey(selectedDate):'';
  return `<div class="calendar-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="month-grid ${calendarView==='week'?'week-grid':''}">${keys.map(k=>calendarCell(k,titleMonth,calendarView==='week')).join('')}</div>`;
}
function groupRecords(records,type) {
  return Core.groupRecords(records,type,state.categories);
}
function makePie(rows,size=110) {
  const valid=rows.filter(r=>r.amountCents>0); const total=valid.reduce((n,r)=>n+r.amountCents,0);
  if(!total) return `<div class="pie" style="width:${size}px;height:${size}px"></div>`;
  let cursor=0; const segments=valid.map((r,i)=>{ const end=cursor+(r.amountCents/total*100); const color=palette[i%palette.length]; const text=`${color} ${cursor.toFixed(3)}% ${end.toFixed(3)}%`; cursor=end; return text; });
  return `<div class="pie" role="img" aria-label="分类金额占比饼图" style="width:${size}px;height:${size}px;background:conic-gradient(${segments.join(',')})"></div>`;
}
function pieLegend(rows) {
  const valid=rows.filter(r=>r.amountCents>0), total=valid.reduce((n,r)=>n+r.amountCents,0);
  if(!total) return `<div class="empty-state">暂无支出记录</div>`;
  return `<div class="pie-legend">${valid.map((r,i)=>`<div class="legend-row"><span class="legend-dot" style="background:${palette[i%palette.length]}"></span><span class="legend-name">${htmlSafe(r.category.icon)} ${htmlSafe(r.category.name)}</span><span class="legend-value">${fmtMoney(r.amountCents)}</span></div>`).join('')}</div>`;
}
function monthBudgetCard() {
  const mk=monthKey(selectedDate), budget=state.monthBudgets[mk]||0;
  const monthRecords=state.transactions.filter(r=>r.date.startsWith(mk)&&(mk!==monthKey(TODAY)||r.date<=TODAY));
  const spent=sumRecords(monthRecords,'expense');
  const meter=Core.budgetMeter(spent,budget), pct=meter.pct, ring=meter.width, over=meter.over;
  const center=budget?`${Math.round(pct)}%`:'—';
  return `<section class="surface detail-card">
    <div class="card-heading"><div><h3>月度预算</h3><div class="subheading">${mk.replace('-','年')}月 · 当月累计支出</div></div><button class="small-button" data-action="edit-month-budget">编辑预算</button></div>
    <div class="budget-layout"><div class="donut" style="--p:${ring}%;--donut-color:${over?'var(--red)':'var(--blue)'}"><div class="donut-center"><strong class="${over?'over-budget':''}">${center}</strong><small>${over?'超预算':budget?'预算使用':'未设置'}</small></div></div>
      ${budget?`<div class="budget-info"><div class="amount-main ${over?'over-budget':''}">${fmtMoney(spent)} <span style="font-size:11px;color:#9aa3b1;font-weight:500">/ ${fmtMoney(budget)}</span></div><div class="muted-line ${over?'over-budget':''}">${over?`已超出 ${fmtMoney(spent-budget)}`:`剩余 ${fmtMoney(Math.max(0,budget-spent))}`}</div></div>`:`<div class="budget-empty">还没有设置本月预算。设置后，每日预算会按月余预算动态分配。</div>`}
    </div>
  </section>`;
}
function dailySummaryCard() {
  const records=recordsOn(selectedDate), expense=sumRecords(records,'expense'), income=sumRecords(records,'income');
  const {monthBudget,hasOverride,budgetCents:budget,defaultBudgetCents,daysRemaining,remainingMonthBudgetCents}=dailyBudgetContext(selectedDate);
  const budgetExists=monthBudget>0||hasOverride;
  const meter=Core.budgetMeter(expense,budget), zeroBudgetOver=budget===0&&budgetExists&&expense>0, over=meter.over||zeroBudgetOver;
  const width=budget>0?meter.width:(zeroBudgetOver?100:0);
  const budgetText=budgetExists?fmtMoney(budget):'未设置';
  const barText=budget>0?meter.label:!budgetExists?'暂无当日预算':zeroBudgetOver?`支出 ${fmtMoney(expense)}，已超过 ¥0.00 日预算`:hasOverride?'单日预算设为 ¥0.00':remainingMonthBudgetCents>0?'月余预算不足 ¥0.01/天':'本月预算余额已用完';
  const allocationHint=hasOverride?`单日预算已单独设置 · 动态日预算 ${fmtMoney(defaultBudgetCents)}`:monthBudget>0?`月余 ${fmtMoney(remainingMonthBudgetCents)} ÷ ${daysRemaining} 天（含当天）`:'';
  const barDetail=budgetExists?`${fmtMoney(expense)} / ${fmtMoney(budget)}`:'先设置月预算或单日预算';
  return `<section class="surface detail-card">
    <div class="card-heading"><div><h3>当日概览</h3><div class="subheading">${currentDateLabel(selectedDate)}${allocationHint?` · ${allocationHint}`:''}</div></div><button class="small-button" data-action="edit-day-budget">${hasOverride?'编辑日预算':'设置日预算'}</button></div>
    <div class="summary-metrics"><div class="metric income"><div class="metric-label">收入</div><div class="metric-value">${fmtMoney(income)}</div></div><div class="metric expense"><div class="metric-label">支出</div><div class="metric-value">${fmtMoney(expense)}</div></div><div class="metric"><div class="metric-label">当日预算${hasOverride?' · 单独设置':''}</div><div class="metric-value">${budgetText}</div></div></div>
    <div class="daily-budget-bar" aria-label="${budgetExists?barText:'暂无当日预算'}"><div class="daily-budget-fill ${over?'over':''}" style="width:${width}%"></div></div><div class="bar-caption"><span class="${over?'over-label':''}">${barText}</span><span>${barDetail}</span></div>
  </section>`;
}
function recordCard() {
  const records=recordsOn(selectedDate);
  const content=records.length?`<div class="records-list">${records.map(r=>{const c=getCategory(r.categoryId);return `<button class="record-row" data-action="edit-record" data-id="${htmlSafe(r.id)}"><span class="category-icon">${htmlSafe(c.icon)}</span><span class="record-text"><strong>${htmlSafe(c.name)} · ${htmlSafe(r.content)}</strong><small>${htmlSafe(c.group)}${r.note?` · ${htmlSafe(r.note)}`:''}</small></span><span class="record-amount ${r.type}">${r.type==='expense'?'−':'+'}${fmtMoney(r.amountCents)}</span></button>`;}).join('')}</div>`:`<div class="empty-state">这一天还没有记录。记下第一笔，收支就会出现在日历和统计中。</div>`;
  return `<section class="surface detail-card records-card"><div class="card-heading"><div><h3>当日记录</h3><div class="subheading">${records.length} 笔 · 点击记录即可编辑</div></div></div><div class="record-actions"><button data-action="add-expense">＋ 添加支出</button><button class="income-add" data-action="add-income">＋ 添加收入</button></div><div style="height:8px"></div>${content}</section>`;
}
function expensePieCard() {
  const rows=groupRecords(recordsOn(selectedDate),'expense'), total=rows.reduce((s,r)=>s+r.amountCents,0);
  return `<section class="surface detail-card pie-card"><div class="card-heading"><div><h3>支出构成</h3><div class="subheading">按当日分类占比</div></div>${total?`<span class="period-label">${fmtMoney(total)}</span>`:''}</div>${total?`<div class="pie-wrap">${makePie(rows,110)}${pieLegend(rows)}</div>`:`<div class="empty-state">当天还没有支出，添加后会显示分类占比。</div>`}</section>`;
}
function renderCalendar() {
  return `<div class="page-heading"><div><h1>日历</h1><p>按天查看收支，让每一笔都有迹可循。</p></div></div>
    <div class="calendar-layout"><section class="surface calendar-surface calendar-main"><div class="calendar-controls"><div class="date-controls"><div class="arrows"><button class="arrow-btn" data-action="calendar-prev" aria-label="上一个">‹</button><button class="arrow-btn" data-action="calendar-next" aria-label="下一个">›</button></div><h2>${calendarHeaderTitle()}</h2><input aria-label="选择日期" class="period-select" style="height:33px;min-width:136px;padding:0 8px" type="date" id="calendarDate" value="${selectedDate}"></div><div class="view-switch" aria-label="日历视图"><button class="${calendarView==='month'?'active':''}" data-view="month">月视图</button><button class="${calendarView==='week'?'active':''}" data-view="week">周视图</button><button class="${calendarView==='day'?'active':''}" data-view="day">日视图</button></div></div>${calendarCanvas()}</section>
      <aside class="detail-panel">${monthBudgetCard()}${dailySummaryCard()}${recordCard()}${expensePieCard()}</aside></div>`;
}

function getSelectedStatsPeriod() {
  if(statsPeriod==='year') return Core.periodForYear(selectedYear,TODAY);
  if(statsPeriod==='month') return Core.periodForMonth(selectedMonth,TODAY);
  return Core.periodForWeek(selectedWeekDate,TODAY);
}
function statsRecordFilter(start,end) { return Core.recordsInRange(state.transactions,start,end); }
function formatRangeDate(key,includeYear=true) { const d=dateFromKey(key); return includeYear?`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`:`${d.getMonth()+1}/${String(d.getDate()).padStart(2,'0')}`; }
function trendWindowControl() {
  const presets=statsPeriod==='year'?[5,10,20]:statsPeriod==='month'?[4,8,12]:[7,14,30], count=trendCounts[statsPeriod]||presets[1], isCustom=!!trendCustom[statsPeriod]||!presets.includes(count);
  return `<div class="range-control"><span>向前回看</span><select id="trendPreset" aria-label="趋势图回看范围">${presets.map(v=>`<option value="${v}" ${!isCustom&&count===v?'selected':''}>${v}${statsPeriod==='year'?'个月':statsPeriod==='month'?'周':'天'}</option>`).join('')}<option value="custom" ${isCustom?'selected':''}>自定义</option></select>${isCustom?`<input id="trendCustom" type="number" min="1" max="520" step="1" value="${count}" aria-label="自定义回看数量">`:''}</div>`;
}
function buildTrendPeriods(selected) {
  const rawCount=Number(trendCounts[statsPeriod]), count=Number.isFinite(rawCount)?Math.min(520,Math.max(1,Math.floor(rawCount))):(statsPeriod==='year'?10:statsPeriod==='month'?8:14);
  return Core.trendPeriods(statsPeriod,selected.end,count,TODAY);
}
function trendTotals(periods) {
  return periods.map(p=>{const rows=statsRecordFilter(p.start,p.end);const expense=sumRecords(rows,'expense'),income=sumRecords(rows,'income');return {...p,expense,income,net:income-expense};});
}
function trendSvg(rows) {
  const count=rows.length, width=Math.max(720,72*count+76), height=260, left=56,right=18,top=17,bottom=53, plotW=width-left-right,plotH=height-top-bottom;
  const series=[['expense','支出','#e16b61'],['income','收入','#258f6b'],['net','净收入','#6877dc']].filter(([id])=>seriesVisible[id]);
  const values=rows.flatMap(r=>series.map(([id])=>r[id]));
  let min=values.length?Math.min(0,...values):0,max=values.length?Math.max(0,...values):0;
  if(max===min){max+=100;min=Math.min(min,-100);} else {const pad=(max-min)*.12;max+=pad;min-=pad;}
  const y=v=>top+(max-v)/(max-min)*plotH, x=i=>left+(count<=1?plotW/2:i*plotW/(count-1));
  const grid=Array.from({length:5},(_,i)=>{const val=max-(max-min)*i/4, yy=y(val);return `<line class="chart-grid" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-label" text-anchor="end" x="${left-8}" y="${yy+3}">${compactMoney(val)}</text>`;}).join('');
  const zero=`<line class="chart-axis" x1="${left}" y1="${y(0)}" x2="${width-right}" y2="${y(0)}"/>`;
  const lines=series.map(([id,label,color])=>{
    const pts=rows.map((r,i)=>`${x(i)},${y(r[id])}`).join(' ');
    const circles=rows.map((r,i)=>`<circle class="chart-point" cx="${x(i)}" cy="${y(r[id])}" r="3.5" fill="${color}"><title>${htmlSafe(r.title)} · ${label} ${fmtMoney(r[id])}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${circles}`;
  }).join('');
  const labels=rows.map((r,i)=>`<text class="chart-label" text-anchor="middle" x="${x(i)}" y="${height-25}">${htmlSafe(r.label)}<title>${htmlSafe(r.title)}</title></text>`).join('');
  if(!rows.length) return '';
  return `<svg class="line-chart" role="img" aria-label="趋势折线图，包含支出、收入和净收入" viewBox="0 0 ${width} ${height}" style="width:${width}px;height:${height}px">${grid}${zero}${lines}${labels}</svg>`;
}
function rankCard(title,rows,total,isIncome) {
  const sorted=rows.filter(r=>r.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents), max=sorted[0]?.amountCents||0;
  const content=sorted.length?`<div class="rank-list">${sorted.map((r,i)=>{const pct=total?100*r.amountCents/total:0,width=max?100*r.amountCents/max:0;return `<div class="rank-row"><div class="rank-label"><span>${htmlSafe(r.category.icon)}</span><span>${htmlSafe(r.category.group)} · ${htmlSafe(r.category.name)}</span></div><div class="rank-track"><div class="rank-fill ${isIncome?'income-fill':''}" style="width:${width}%"></div></div><div class="rank-value">${fmtMoney(r.amountCents)} <span class="rank-percent">${pct.toFixed(1)}%</span></div></div>`;}).join('')}</div>`:`<div class="empty-state">本周期暂无${isIncome?'收入':'支出'}记录</div>`;
  return `<section class="surface rank-card"><h3>${title}</h3><p class="rank-sub">${fmtMoney(total)} · 占本周期${isIncome?'收入':'支出'}总额</p>${content}</section>`;
}
function compositionCard(expenseRows,incomeRows) {
  const blocks=[['收入构成',incomeRows,'income'],['支出构成',expenseRows,'expense']];
  return `<section class="surface composition-card"><h3>周期构成</h3><p class="rank-sub">只统计所选${statsPeriod==='year'?'年份':statsPeriod==='month'?'月份':'周'}，不随趋势范围变化</p><div class="composition-card-inner">${blocks.map(([title,rows,type])=>{const total=rows.reduce((s,r)=>s+r.amountCents,0);return `<div class="composition-block"><h4>${title} · ${fmtMoney(total)}</h4>${total?`<div class="pie-wrap">${makePie(rows,84)}${pieLegend(rows)}</div>`:`<div class="empty-state">暂无${type==='income'?'收入':'支出'}</div>`}</div>`;}).join('')}</div></section>`;
}
function statsSelector() {
  const period=getSelectedStatsPeriod();
  let select='';
  if(statsPeriod==='year') {
    const years=Array.from({length:12},(_,i)=>Number(TODAY.slice(0,4))-i); if(!years.includes(selectedYear)) years.push(selectedYear); years.sort((a,b)=>b-a);
    select=`<select id="yearSelect" class="period-select" aria-label="选择年份">${years.map(y=>`<option value="${y}" ${y===selectedYear?'selected':''}>${y} 年</option>`).join('')}</select>`;
  } else if(statsPeriod==='month') select=`<input id="statsMonth" class="period-select" type="month" max="${monthKey(TODAY)}" value="${selectedMonth}" aria-label="选择月份">`;
  else select=`<div class="week-select-wrap"><input id="statsWeek" class="period-select" style="min-width:142px" type="date" max="${TODAY}" value="${selectedWeekDate}" aria-label="选择周内日期"><span class="period-label">${formatRangeDate(mondayOf(selectedWeekDate))} – ${formatRangeDate(shiftDate(mondayOf(selectedWeekDate),6))}</span></div>`;
  return `<div class="period-switch"><button data-period="year" class="${statsPeriod==='year'?'active':''}">年</button><button data-period="month" class="${statsPeriod==='month'?'active':''}">月</button><button data-period="week" class="${statsPeriod==='week'?'active':''}">周</button></div>${select}<span class="period-label">${htmlSafe(period.label)}</span>`;
}
function renderStats() {
  const selected=getSelectedStatsPeriod(), selectedRows=statsRecordFilter(selected.start,selected.end);
  const expenseRows=groupRecords(selectedRows,'expense'),incomeRows=groupRecords(selectedRows,'income');
  const expenseTotal=sumRecords(selectedRows,'expense'),incomeTotal=sumRecords(selectedRows,'income');
  const trend=trendTotals(buildTrendPeriods(selected));
  const futureNote=selected.isCurrent?` · 截至 ${formatDate(selected.end,{month:'short',day:'numeric'})}（未来日期不计入）`:'';
  return `<div class="page-heading stats-heading"><div><h1>统计</h1><p>看清收入、支出与结余的变化。</p></div><div class="stats-controls">${statsSelector()}</div></div>
    <section class="surface trend-card"><div class="trend-head"><div><h2>收支趋势</h2><p>${statsPeriod==='year'?'按月':statsPeriod==='month'?'按周':'按日'}汇总 · ${trend.length} 个区间${futureNote}</p></div><div class="trend-tools">${trendWindowControl()}</div></div>
      <div class="series-toggles">${[['expense','支出','#e16b61'],['income','收入','#258f6b'],['net','净收入','#6877dc']].map(([id,label,color])=>`<label class="series-toggle"><input type="checkbox" data-series="${id}" ${seriesVisible[id]?'checked':''}><span class="series-key" style="background:${color}"></span>${label}</label>`).join('')}</div>
      ${trend.length?`<div class="chart-scroll">${trendSvg(trend)}</div>`:`<div class="empty-state">所选范围没有可显示的时间段。</div>`}</section>
    <div class="stats-bottom">${rankCard('支出分类排行',expenseRows,expenseTotal,false)}${rankCard('收入分类排行',incomeRows,incomeTotal,true)}${compositionCard(expenseRows,incomeRows)}</div>`;
}
function render() {
  $$('.nav-item').forEach(btn=>btn.classList.toggle('active',btn.dataset.page===page));
  updateAccountButton();
  main.innerHTML=page==='calendar'?renderCalendar():renderStats();
}

function showModal(title,eyebrow,html,kind) {
  activeModal=kind; $('#modalTitle').textContent=title; $('#modalEyebrow').textContent=eyebrow; modalBody.innerHTML=html; modalBackdrop.hidden=false;
  setTimeout(()=>$('input:not([type=hidden]),select,button',modalBody)?.focus(),20);
}
function closeModal() { modalBackdrop.hidden=true; activeModal=null; categoryReturnDraft=null; modalBody.innerHTML=''; }
function openBudgetModal(isDay) {
  if(isDay) {
    const context=dailyBudgetContext(selectedDate),has=context.hasOverride,value=has?state.dayBudgets[selectedDate]:context.budgetCents;
    const note=context.monthBudget>0?`仅影响 ${currentDateLabel(selectedDate)}。默认日预算按“月度预算减去当天之前的本月支出，再除以含当天在内的本月剩余 ${context.daysRemaining} 天”计算。${has?'当前已覆盖默认值。':''}`:`仅影响 ${currentDateLabel(selectedDate)}。设置后只覆盖当天预算，不会改变月预算或其他日期。`;
    showModal('设置当日预算','预算设置',`<form id="budgetForm" class="form-stack"><p class="modal-note">${note}</p><div class="field"><label for="budgetAmount">当日预算（人民币）</label><div class="amount-input-wrap"><span class="amount-prefix">¥</span><input id="budgetAmount" name="amount" inputmode="decimal" placeholder="0.00" value="${(value/100).toFixed(2)}" required></div></div><div class="form-error" id="formError"></div><div class="form-footer">${has?`<button type="button" class="secondary-btn" data-action="clear-day-budget">恢复动态日预算</button>`:'<span></span>'}<div class="form-footer-right"><button type="button" class="secondary-btn close-modal">取消</button><button class="primary-btn" type="submit">保存当日预算</button></div></div></form>`,'day-budget');
  } else {
    const key=monthKey(selectedDate), value=state.monthBudgets[key]||0;
    showModal(`${key.replace('-','年')}月预算`,'月度预算',`<form id="budgetForm" class="form-stack"><p class="modal-note">月度预算用于统计月累计支出占比。每日默认预算会从月度预算中扣除当天之前已发生的支出，再平均分配到本月剩余天数（含当天）。</p><div class="field"><label for="budgetAmount">月度预算（人民币）</label><div class="amount-input-wrap"><span class="amount-prefix">¥</span><input id="budgetAmount" name="amount" inputmode="decimal" placeholder="0.00" value="${(value/100).toFixed(2)}" required></div></div><div class="form-error" id="formError"></div><div class="form-footer"><span></span><div class="form-footer-right"><button type="button" class="secondary-btn close-modal">取消</button><button class="primary-btn" type="submit">保存月预算</button></div></div></form>`,'month-budget');
  }
}
function categoryGroups(type) { return [...new Set(state.categories.filter(c=>c.type===type).map(c=>c.group))]; }
function renderCategoryPicker(type) {
  const groups=categoryGroups(type); if(!groups.includes(selectedCategoryGroup)) selectedCategoryGroup=groups[0]||'';
  const cats=state.categories.filter(c=>c.type===type&&c.group===selectedCategoryGroup);
  if(!cats.some(c=>c.id===selectedCategoryId)) selectedCategoryId=cats[0]?.id||'';
  return `<div class="field"><div class="category-picker-head"><label>分类组 → 具体分类</label><button type="button" class="category-add-btn" data-action="new-category-from-transaction">＋ 新建分类</button></div><div class="category-groups">${groups.map(g=>`<button type="button" class="group-chip ${g===selectedCategoryGroup?'active':''}" data-category-group="${htmlSafe(g)}">${htmlSafe(g)}</button>`).join('')}</div>${cats.length?`<div class="category-pick-grid">${cats.map(c=>`<button type="button" class="category-option ${c.id===selectedCategoryId?'active':''}" data-category-id="${htmlSafe(c.id)}"><span>${htmlSafe(c.icon)}</span><span>${htmlSafe(c.name)}</span></button>`).join('')}</div>`:`<div class="empty-state">当前收支类型还没有分类，请新建一个。</div>`}</div>`;
}
function openTransactionModal(type='expense',record=null,draft=null) {
  categoryReturnDraft=null;
  const fixedType=draft?.type||record?.type||type;
  const preferredCategoryId=draft?.categoryId||record?.categoryId;
  const preferredCategory=preferredCategoryId?state.categories.find(c=>c.id===preferredCategoryId&&c.type===fixedType):null;
  const initial=preferredCategory||state.categories.find(c=>c.type===fixedType);
  selectedCategoryGroup=initial?.group||''; selectedCategoryId=initial?.id||'';
  const recordId=record?.id||draft?.recordId||'';
  const recordDate=draft?.date||record?.date||selectedDate;
  const recordContent=draft?.content??record?.content??'';
  const recordAmount=draft?.amount??(record?(record.amountCents/100).toFixed(2):'');
  const recordNote=draft?.note??record?.note??'';
  const form=`<form id="transactionForm" class="form-stack" data-record-id="${htmlSafe(recordId)}">
    <div class="form-row"><div class="field"><label for="transactionType">收支类型</label><select name="type" id="transactionType"><option value="expense" ${fixedType==='expense'?'selected':''}>支出</option><option value="income" ${fixedType==='income'?'selected':''}>收入</option></select></div><div class="field"><label for="transactionDate">日期</label><input type="date" id="transactionDate" name="date" value="${htmlSafe(recordDate)}" required></div></div>
    <div id="categoryPicker">${renderCategoryPicker(fixedType)}</div>
    <div class="field"><label for="transactionContent">具体内容</label><input id="transactionContent" name="content" maxlength="80" placeholder="例如：午餐、超市采购" value="${htmlSafe(recordContent)}" required></div>
    <div class="field"><label for="transactionAmount">金额</label><div class="amount-input-wrap"><span class="amount-prefix">¥</span><input id="transactionAmount" name="amount" inputmode="decimal" placeholder="0.00" value="${htmlSafe(recordAmount)}" required></div></div>
    <div class="field"><label for="transactionNote">备注（可选）</label><textarea id="transactionNote" name="note" rows="2" maxlength="160" placeholder="补充一点说明">${htmlSafe(recordNote)}</textarea></div>
    <div class="form-error" id="formError"></div>
    <div class="form-footer">${record?`<button type="button" class="danger-btn" data-action="delete-record" data-id="${htmlSafe(record.id)}">删除记录</button>`:'<span class="modal-note">保存后会同步更新日历、预算和统计。</span>'}<div class="form-footer-right"><button type="button" class="secondary-btn close-modal">取消</button><button type="submit" class="primary-btn">${record?'保存修改':'保存记录'}</button></div></div>
  </form>`;
  showModal(record?'编辑收支记录':fixedType==='expense'?'添加支出':'添加收入',record?'修改已保存的记录':'记一笔',form,'transaction');
}
function openCategoryModal(draft) {
  categoryReturnDraft=draft;
  const type=draft?.type||'expense', groups=categoryGroups(type);
  showModal('新建分类','添加收支时创建分类',`<form id="categoryForm" class="form-stack"><div class="form-row"><div class="field"><label for="newCategoryType">收支类型</label><select id="newCategoryType" name="type"><option value="expense" ${type==='expense'?'selected':''}>支出</option><option value="income" ${type==='income'?'selected':''}>收入</option></select></div><div class="field"><label for="newCategoryGroup">所属分类组</label><select id="newCategoryGroup" name="group">${groups.map(g=>`<option value="${htmlSafe(g)}">${htmlSafe(g)}</option>`).join('')}<option value="__new__">＋ 新建分类组</option></select></div></div><div class="field" id="newGroupField" hidden><label for="newGroupName">新分类组名称</label><input id="newGroupName" name="newGroup" maxlength="24" placeholder="例如：休闲"></div><div class="field"><label for="newCategoryName">分类名称</label><input id="newCategoryName" name="name" maxlength="24" placeholder="例如：咖啡" required></div><div class="field"><label>选择图标</label><div class="icon-pick-grid">${iconChoices.map((icon,i)=>`<button type="button" class="icon-option ${i===0?'active':''}" data-icon="${htmlSafe(icon)}" aria-label="${htmlSafe(icon)}">${htmlSafe(icon)}</button>`).join('')}</div><input type="hidden" name="icon" value="${iconChoices[0]}"></div><div class="form-error" id="formError"></div><div class="form-footer"><span class="modal-note">创建后立即用于记账和统计。</span><div class="form-footer-right"><button type="button" class="secondary-btn" data-action="back-to-transaction">返回记账</button><button class="primary-btn" type="submit">创建分类</button></div></div></form>`,'category');
}
function openAccountModal(mode='login') {
  if(account) {
    showModal('个人账户','账户与同步',`<div class="account-summary"><div class="account-avatar-column">${accountAvatarMarkup(account.avatar,'large')}<button type="button" class="small-button avatar-edit-button" data-action="edit-avatar">编辑头像</button></div><div><strong>${htmlSafe(account.username)}</strong><small>已登录 · 账户账本保存在轻账服务中</small></div></div><div class="account-info-box">同一台电脑上的其他浏览器访问同一个轻账地址并登录后，可以读取和更新这份账本。</div><div class="form-footer"><span></span><div class="form-footer-right"><button type="button" class="secondary-btn close-modal">关闭</button><button type="button" class="danger-btn" data-action="account-logout">退出登录</button></div></div>`,'account-info');
    return;
  }
  const registering=mode==='register';
  showModal(registering?'创建个人账户':'登录个人账户','账户与同步',`<div class="account-tabs"><button type="button" class="${!registering?'active':''}" data-auth-mode="login">登录</button><button type="button" class="${registering?'active':''}" data-auth-mode="register">创建账户</button></div><p class="modal-note account-explainer">账户数据保存在运行轻账服务的这台电脑。其他浏览器使用相同地址登录即可共享；首次创建账户会导入当前浏览器里的账目和分类。</p><form id="accountForm" class="form-stack" data-mode="${registering?'register':'login'}"><div class="field"><label for="accountUsername">账户名</label><input id="accountUsername" name="username" autocomplete="username" minlength="3" maxlength="64" placeholder="3–64 位中文、字母或数字" required></div><div class="field"><label for="accountPassword">密码</label><input id="accountPassword" name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" minlength="${registering?8:1}" maxlength="256" placeholder="${registering?'至少 8 个字符':'输入账户密码'}" required></div>${registering?`<div class="field"><label for="accountPasswordConfirm">确认密码</label><input id="accountPasswordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="再输入一次密码" required></div>`:''}<div class="form-error" id="formError"></div><div class="form-footer"><span class="modal-note">数据只发送到当前轻账服务。</span><div class="form-footer-right"><button type="button" class="secondary-btn close-modal">取消</button><button class="primary-btn" type="submit">${registering?'创建并导入':'登录并同步'}</button></div></div></form>`,'account');
}
function openAvatarEditor() {
  avatarEditorValue=normalizeAvatar(account?.avatar);
  showModal('编辑头像','个人账户',`<form id="avatarForm" class="form-stack"><div id="avatarPreview" class="avatar-editor-preview">${accountAvatarMarkup(avatarEditorValue,'large avatar-editor-large')}</div><div class="field"><label>默认头像</label><div class="avatar-choice-grid">${avatarChoicesMarkup(avatarEditorValue)}</div></div><div class="field"><label for="avatarFile">从本地上传图片</label><input class="avatar-file-input" id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"><small class="avatar-hint">支持 PNG、JPG、WebP，文件不超过 1 MB。</small></div><div class="form-error" id="avatarError"></div><div class="form-footer"><span class="modal-note">头像会保存到账户并同步到其他浏览器。</span><div class="form-footer-right"><button type="button" class="secondary-btn" data-action="cancel-avatar-edit">返回账户</button><button type="submit" class="primary-btn">保存头像</button></div></div></form>`,'avatar-editor');
}
function refreshAvatarPreview() {
  const preview=$('#avatarPreview',modalBody);
  if(preview)preview.innerHTML=accountAvatarMarkup(avatarEditorValue,'large avatar-editor-large');
  $$('[data-avatar-preset]',modalBody).forEach(button=>button.classList.toggle('active',avatarEditorValue===`preset:${button.dataset.avatarPreset}`));
}
async function submitAvatarForm(error) {
  if(error?.textContent)return;
  try {
    const result=await apiRequest('/api/profile',{method:'POST',body:JSON.stringify({avatar:normalizeAvatar(avatarEditorValue)})});
    account=result.user;closeModal();render();toast('头像已保存并同步到账户');openAccountModal();
  } catch(e) { error.textContent=e.message||'头像保存失败，请重试。'; }
}
async function logoutAccount() {
  try { await apiRequest('/api/logout',{method:'POST',body:'{}'}); }
  catch(e) { toast(`退出失败：${e.message}`,true); return; }
  account=null;accountBase=null;state=emptyState();await clearLocalState();closeModal();render();toast('已退出账户；本机缓存已清除，账户账本仍保存在轻账服务中。');
}
async function submitAccountForm(form,error) {
  const data=new FormData(form),mode=form.dataset.mode,username=String(data.get('username')||'').trim(),password=String(data.get('password')||'');
  if(!username||!password){error.textContent='请填写账户名和密码。';return;}
  let local=normalizeState(await readPersistedState()||state);
  if(hasUserData(state))local=mergeAccountData(local,state);
  try {
    if(mode==='register') {
      if(password.length<8||password!==String(data.get('passwordConfirm')||'')){error.textContent=password.length<8?'密码至少需要 8 个字符。':'两次输入的密码不一致。';return;}
      const result=await apiRequest('/api/register',{method:'POST',body:JSON.stringify({username,password,initialData:local})});
      account=result.user;
      const created=await apiRequest('/api/data');state=normalizeState(created.data);accountBase=cloneState(state);
    } else {
      const result=await apiRequest('/api/login',{method:'POST',body:JSON.stringify({username,password})});
      account=result.user;
      const latest=await apiRequest('/api/data'),cloud=normalizeState(latest.data);
      accountBase=cloneState(cloud);
      state=hasUserData(local)?mergeConcurrentAccountData(cloud,local,cloud):cloud;
      if(JSON.stringify(state)!==JSON.stringify(cloud))await saveAccountChanges();
    }
    await clearLocalState();closeModal();render();toast(mode==='register'?'账户已创建，当前浏览器账本已导入':'登录成功，账本已同步');
  } catch(e) { error.textContent=e.message||'账户操作失败，请重试。'; }
}

main.addEventListener('click',async e=>{
  const view=e.target.closest('[data-view]');if(view){calendarView=view.dataset.view;render();return;}
  const periodBtn=e.target.closest('[data-period]');if(periodBtn){statsPeriod=periodBtn.dataset.period;render();return;}
  const cell=e.target.closest('.calendar-cell');if(cell){selectedDate=cell.dataset.date;render();return;}
  const action=e.target.closest('[data-action]');if(!action)return;
  switch(action.dataset.action){
    case 'calendar-prev': selectedDate=calendarView==='month'?shiftMonth(selectedDate,-1):shiftDate(selectedDate,calendarView==='week'?-7:-1);render();break;
    case 'calendar-next': selectedDate=calendarView==='month'?shiftMonth(selectedDate,1):shiftDate(selectedDate,calendarView==='week'?7:1);render();break;
    case 'edit-month-budget':openBudgetModal(false);break;
    case 'edit-day-budget':openBudgetModal(true);break;
    case 'add-expense':openTransactionModal('expense');break;
    case 'add-income':openTransactionModal('income');break;
    case 'edit-record':{const r=state.transactions.find(x=>x.id===action.dataset.id);if(r)openTransactionModal(r.type,r);break;}
    case 'delete-record':{const id=action.dataset.id;if(window.confirm('确定删除这条记录吗？删除后会立即从统计和预算中扣除。')){state.transactions=state.transactions.filter(r=>r.id!==id);closeModal();await commit('记录已删除');}break;}
    case 'clear-day-budget':delete state.dayBudgets[selectedDate];closeModal();await commit('已恢复动态日预算');break;
  }
});
main.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='calendarDate'&&dateIsValid(t.value)){selectedDate=t.value;render();}
  else if(t.id==='yearSelect'){selectedYear=Number(t.value);render();}
  else if(t.id==='statsMonth'){if(t.value&&t.value<=monthKey(TODAY))selectedMonth=t.value;render();}
  else if(t.id==='statsWeek'){if(t.value&&t.value<=TODAY)selectedWeekDate=t.value;render();}
  else if(t.id==='trendPreset'){if(t.value!=='custom'){trendCustom[statsPeriod]=false;trendCounts[statsPeriod]=Number(t.value);render();}else{trendCustom[statsPeriod]=true;trendCounts[statsPeriod]=Number(trendCounts[statsPeriod])||1;render();const input=$('#trendCustom');input?.focus();input?.select();}}
  else if(t.id==='trendCustom'){const n=Number(t.value);if(t.value!==''&&Number.isInteger(n)&&n>0&&n<=520){trendCounts[statsPeriod]=n;render();}else{toast('请输入 1 到 520 之间的整数',true);t.value=String(trendCounts[statsPeriod]||1);}}
  else if(t.matches('[data-series]')){seriesVisible[t.dataset.series]=t.checked;render();}
});

$('#accountButton').addEventListener('click',()=>openAccountModal());
$('.bottom-nav').addEventListener('click',e=>{const nav=e.target.closest('.nav-item');if(nav){page=nav.dataset.page;render();}});
$('.close-modal').addEventListener('click',closeModal);
modalBackdrop.addEventListener('click',e=>{if(e.target===modalBackdrop||e.target.closest('.close-modal'))closeModal();});
modalBody.addEventListener('click',async e=>{
  const action=e.target.closest('[data-action]');
  if(action?.dataset.action==='edit-avatar'){openAvatarEditor();return;}
  if(action?.dataset.action==='cancel-avatar-edit'){openAccountModal();return;}
  const avatarChoice=e.target.closest('[data-avatar-preset]');
  if(avatarChoice){avatarEditorValue=`preset:${avatarChoice.dataset.avatarPreset}`;const file=$('#avatarFile',modalBody);if(file)file.value='';const error=$('#avatarError',modalBody);if(error)error.textContent='';refreshAvatarPreview();return;}
  if(action?.dataset.action==='new-category-from-transaction'){
    const form=$('#transactionForm',modalBody);
    if(form){
      const data=new FormData(form);
      openCategoryModal({type:data.get('type'),date:data.get('date'),content:data.get('content')||'',amount:data.get('amount')||'',note:data.get('note')||'',recordId:form.dataset.recordId||'',categoryId:selectedCategoryId});
    }
    return;
  }
  if(action?.dataset.action==='back-to-transaction'){
    const draft=categoryReturnDraft;
    if(draft){const record=draft.recordId?state.transactions.find(r=>r.id===draft.recordId):null;openTransactionModal(draft.type,record,draft);}
    else closeModal();
    return;
  }
  if(action?.dataset.action==='account-logout'){await logoutAccount();return;}
  if(action?.dataset.action==='clear-day-budget'){
    delete state.dayBudgets[selectedDate];closeModal();commit('已恢复动态日预算');return;
  }
  if(action?.dataset.action==='delete-record'){
    const id=action.dataset.id;
    if(window.confirm('确定删除这条记录吗？删除后会立即从统计和预算中扣除。')){
      state.transactions=state.transactions.filter(r=>r.id!==id);closeModal();commit('记录已删除');
    }
    return;
  }
  const authMode=e.target.closest('[data-auth-mode]');
  if(authMode){openAccountModal(authMode.dataset.authMode);return;}
  const group=e.target.closest('[data-category-group]');
  if(group){selectedCategoryGroup=group.dataset.categoryGroup;const type=$('#transactionType')?.value||'expense';const first=state.categories.find(c=>c.type===type&&c.group===selectedCategoryGroup);selectedCategoryId=first?.id||'';$('#categoryPicker').innerHTML=renderCategoryPicker(type);return;}
  const category=e.target.closest('[data-category-id]');
  if(category){selectedCategoryId=category.dataset.categoryId;$$('[data-category-id]',modalBody).forEach(el=>el.classList.toggle('active',el.dataset.categoryId===selectedCategoryId));return;}
  const icon=e.target.closest('[data-icon]');
  if(icon){$$('[data-icon]',modalBody).forEach(el=>el.classList.toggle('active',el===icon));$('input[name="icon"]',modalBody).value=icon.dataset.icon;}
});
modalBody.addEventListener('change',async e=>{
  if(e.target.id==='avatarFile'){
    const file=e.target.files?.[0],error=$('#avatarError',modalBody);
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){error.textContent='请选择 PNG、JPG 或 WebP 图片。';e.target.value='';return;}
    if(file.size>1_000_000){error.textContent='图片文件不能超过 1 MB。';e.target.value='';return;}
    try{
      const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片。'));reader.readAsDataURL(file);});
      if(!isAvatarImage(image)){error.textContent='图片格式无效，请重新选择。';return;}
      avatarEditorValue=image;error.textContent='';refreshAvatarPreview();
    }catch(err){error.textContent=err.message||'无法读取图片。';}
    return;
  }
  if(e.target.id==='transactionType'){const type=e.target.value;const groups=categoryGroups(type);selectedCategoryGroup=groups[0]||'';selectedCategoryId=state.categories.find(c=>c.type===type&&c.group===selectedCategoryGroup)?.id||'';$('#categoryPicker').innerHTML=renderCategoryPicker(type);}
  if(e.target.id==='newCategoryType'){const groups=categoryGroups(e.target.value);const sel=$('#newCategoryGroup');sel.innerHTML=groups.map(g=>`<option value="${htmlSafe(g)}">${htmlSafe(g)}</option>`).join('')+'<option value="__new__">＋ 新建分类组</option>';$('#newGroupField').hidden=true;}
  if(e.target.id==='newCategoryGroup')$('#newGroupField').hidden=e.target.value!=='__new__';
});
modalBody.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target,error=$('#formError',modalBody);if(error)error.textContent='';
  if(form.id==='avatarForm'){const avatarError=$('#avatarError',modalBody);await submitAvatarForm(avatarError);return;}
  if(form.id==='accountForm'){await submitAccountForm(form,error);return;}
  if(form.id==='transactionForm'){
    const data=new FormData(form),type=data.get('type'),date=data.get('date'),content=String(data.get('content')||'').trim(),amountCents=parseMoney(data.get('amount'));
    if(!state.categories.some(c=>c.id===selectedCategoryId&&c.type===type)){error.textContent='请先选择一个对应收支类型的分类。';return;}
    if(!dateIsValid(date)){error.textContent='请选择有效日期。';return;}
    if(!content){error.textContent='请填写具体内容。';return;}
    if(amountCents===null){error.textContent='金额须大于 0，最多填写两位小数。';return;}
    const id=form.dataset.recordId||`txn_${crypto.randomUUID()}`, existing=state.transactions.find(r=>r.id===id), now=Date.now();
    const record={id,type,date,amountCents,categoryId:selectedCategoryId,content,note:String(data.get('note')||'').trim(),createdAt:existing?.createdAt||now,updatedAt:now};
    if(existing)state.transactions=state.transactions.map(r=>r.id===id?record:r);else state.transactions.push(record);
    closeModal();await commit(existing?'记录已更新，预算和统计已同步':'记录已保存');return;
  }
  if(form.id==='budgetForm'){
    const amount=parseMoney(new FormData(form).get('amount'),true);if(amount===null){error.textContent='请输入有效金额，最多填写两位小数。';return;}
    const isMonthBudget=activeModal==='month-budget';
    if(isMonthBudget)state.monthBudgets[monthKey(selectedDate)]=amount;
    else state.dayBudgets[selectedDate]=amount;
    closeModal();await commit(isMonthBudget?'月预算已保存':'当日预算已保存');return;
  }
  if(form.id==='categoryForm'){
    const data=new FormData(form),type=data.get('type'),name=String(data.get('name')||'').trim(),group=String(data.get('group')||''),newGroup=String(data.get('newGroup')||'').trim(),finalGroup=group==='__new__'?newGroup:group,icon=String(data.get('icon')||'⭐');
    if(!name){error.textContent='请填写分类名称。';return;}
    if(!finalGroup){error.textContent='请填写或选择分类组。';return;}
    if(state.categories.some(c=>c.type===type&&c.group===finalGroup&&c.name===name)){error.textContent='这个分类已经存在，请换一个名称。';return;}
    const category={id:`cat_${crypto.randomUUID()}`,type,group:finalGroup,name,icon,builtin:false};
    state.categories.push(category);
    const returnDraft=categoryReturnDraft;
    const returnRecord=returnDraft?.recordId?state.transactions.find(r=>r.id===returnDraft.recordId):null;
    closeModal();await commit(`已创建“${name}”分类`);
    if(returnDraft)openTransactionModal(type,returnRecord,{...returnDraft,type,categoryId:category.id});
    return;
  }
});

modalBackdrop.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modalBackdrop.hidden)closeModal();});

(async function init(){
  const saved=await readPersistedState(),local=normalizeState(saved);
  state=local;
  try {
    const session=await apiRequest('/api/session');
    if(session.authenticated){
      account=session.user;
      const latest=await apiRequest('/api/data'),cloud=normalizeState(latest.data);
      accountBase=cloneState(cloud);
      state=hasUserData(local)?mergeConcurrentAccountData(cloud,local,cloud):cloud;
      if(JSON.stringify(state)!==JSON.stringify(cloud))await saveAccountChanges();
      await clearLocalState();
    }
  } catch(e) { console.warn('Account sync is unavailable; continuing with local data.',e); }
  render();
})();
