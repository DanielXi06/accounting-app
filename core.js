/* 轻账的纯计算逻辑：同一套日期和金额口径供界面与验证共同使用。 */
(function (root) {
  const DAY_MS = 86400000;
  function localDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function dateFromKey(key) { const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d,12,0,0,0); }
  function shiftDate(key,days) { const d=dateFromKey(key);d.setDate(d.getDate()+days);return localDateKey(d); }
  function shiftMonth(key,delta) { const d=dateFromKey(key),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+delta);d.setDate(Math.min(day,daysInMonth(d.getFullYear(),d.getMonth()+1)));return localDateKey(d); }
  function daysInMonth(year,month) { return new Date(year,month,0).getDate(); }
  function monthKey(key) { return key.slice(0,7); }
  function mondayOf(key) { const d=dateFromKey(key);d.setDate(d.getDate()-(d.getDay()+6)%7);return localDateKey(d); }
  function parseMoney(value,allowZero=false) {
    const s=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;
    const [whole,decimal='']=s.split('.'),cents=Number(whole)*100+Number(decimal.padEnd(2,'0'));
    if(!Number.isSafeInteger(cents)||(allowZero?cents<0:cents<=0))return null;return cents;
  }
  function sumRecords(records,type) { return records.reduce((sum,r)=>sum+(r.type===type?r.amountCents:0),0); }
  function groupRecords(records,type,categories) {
    const byId=new Map(categories.map(c=>[c.id,c])),groups=new Map();
    records.filter(r=>r.type===type).forEach(r=>{const category=byId.get(r.categoryId)||{id:'missing',type,group:'其他',name:'已移除分类',icon:'❔'};const row=groups.get(category.id)||{category,amountCents:0};row.amountCents+=r.amountCents;groups.set(category.id,row);});
    return [...groups.values()].sort((a,b)=>b.amountCents-a.amountCents);
  }
  function recordsInRange(records,start,end) { return start>end?[]:records.filter(r=>r.date>=start&&r.date<=end); }
  function dailyBudget(monthBudgetCents,days,overrideCents,hasOverride) { return hasOverride?overrideCents:(monthBudgetCents>0&&days>0?Math.round(monthBudgetCents/days):0); }
  function budgetMeter(spentCents,budgetCents) {
    if(!(budgetCents>0))return {budgeted:false,pct:0,over:false,width:0,label:'暂无当日预算'};
    const pct=spentCents/budgetCents*100,over=spentCents>budgetCents;
    return {budgeted:true,pct,over,width:Math.min(100,pct),label:over?`超出 ${Math.round(pct-100)}%`:`已使用 ${Math.round(pct)}%`};
  }
  function periodForYear(year,today) {
    const y=Number(year),start=`${y}-01-01`,fullEnd=`${y}-12-31`,isCurrent=y===Number(today.slice(0,4));
    return {start,end:isCurrent?today:fullEnd,fullEnd,isCurrent,label:`${y} 年`};
  }
  function periodForMonth(key,today) {
    const [y,m]=key.split('-').map(Number),start=`${key}-01`,fullEnd=`${key}-${String(daysInMonth(y,m)).padStart(2,'0')}`,isCurrent=key===monthKey(today);
    return {start,end:isCurrent?today:fullEnd,fullEnd,isCurrent,label:`${y} 年 ${m} 月`};
  }
  function periodForWeek(date,today) {
    const start=mondayOf(date),fullEnd=shiftDate(start,6),isCurrent=mondayOf(today)===start;
    return {start,end:isCurrent?today:fullEnd,fullEnd,isCurrent,label:`${start.replaceAll('-','/')} – ${fullEnd.replaceAll('-','/')}`};
  }
  function rangeDate(key,includeYear=true) { const d=dateFromKey(key);return includeYear?`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`:`${d.getMonth()+1}/${String(d.getDate()).padStart(2,'0')}`; }
  function trendPeriods(kind,anchor,count,today) {
    const n=Math.min(520,Math.max(1,Math.floor(Number(count)||1)));
    if(kind==='year') {
      const d=dateFromKey(anchor),year=d.getFullYear(),month=d.getMonth();
      return Array.from({length:n},(_,i)=>{const m=new Date(year,month-(n-1-i),1,12),y=m.getFullYear(),mo=m.getMonth()+1,start=localDateKey(new Date(y,mo-1,1,12)),monthEnd=localDateKey(new Date(y,mo,0,12));return {start,end:monthEnd>today?today:monthEnd,label:`${y}-${String(mo).padStart(2,'0')}`,title:`${y}年${mo}月`};});
    }
    if(kind==='month') {
      const anchorWeek=mondayOf(anchor);
      return Array.from({length:n},(_,i)=>{const start=shiftDate(anchorWeek,(i-(n-1))*7),sunday=shiftDate(start,6),end=sunday>today?today:sunday;return {start,end,label:`${rangeDate(start,false)}–${rangeDate(sunday,false)}`,title:`${rangeDate(start)} – ${rangeDate(sunday)}`};});
    }
    return Array.from({length:n},(_,i)=>{const key=shiftDate(anchor,i-(n-1));return {start:key,end:key,label:rangeDate(key,false),title:rangeDate(key)};});
  }
  root.LedgerCore=Object.freeze({DAY_MS,localDateKey,dateFromKey,shiftDate,shiftMonth,daysInMonth,monthKey,mondayOf,parseMoney,sumRecords,groupRecords,recordsInRange,dailyBudget,budgetMeter,periodForYear,periodForMonth,periodForWeek,trendPeriods});
})(globalThis);
