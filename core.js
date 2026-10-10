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
  function sumRecords(records,type) { return records.reduce((sum,r)=>sum+(r.type===type&&!r.voidedAt?r.amountCents:0),0); }
  function groupRecords(records,type,categories) {
    const byId=new Map(categories.map(c=>[c.id,c])),groups=new Map();
    records.filter(r=>r.type===type&&!r.voidedAt).forEach(r=>{const category=byId.get(r.categoryId)||{id:'missing',type,group:'其他',name:'已移除分类',icon:'❔'};const row=groups.get(category.id)||{category,amountCents:0};row.amountCents+=r.amountCents;groups.set(category.id,row);});
    return [...groups.values()].sort((a,b)=>b.amountCents-a.amountCents);
  }
  function recordsInRange(records,start,end) { return start>end?[]:records.filter(r=>!r.voidedAt&&r.date>=start&&r.date<=end); }
  function daysRemainingInMonth(key) {
    const [year,month,day]=key.split('-').map(Number);
    return Math.max(0,daysInMonth(year,month)-day+1);
  }
  function dailyBudget(monthBudgetCents,days,overrideCents,hasOverride,spentBeforeCents=0) {
    if(hasOverride)return overrideCents;
    if(!(monthBudgetCents>0&&days>0))return 0;
    const remainingCents=Math.max(0,monthBudgetCents-Math.max(0,spentBeforeCents||0));
    return Math.round(remainingCents/days);
  }
  function dailyBudgetForDate(monthBudgetCents,key,records,overrideCents,hasOverride) {
    const daysRemaining=daysRemainingInMonth(key),monthStart=`${monthKey(key)}-01`,dayBefore=shiftDate(key,-1);
    const spentBeforeCents=sumRecords(recordsInRange(records,monthStart,dayBefore),'expense');
    const remainingMonthBudgetCents=Math.max(0,monthBudgetCents-spentBeforeCents);
    const defaultBudgetCents=dailyBudget(monthBudgetCents,daysRemaining,undefined,false,spentBeforeCents);
    return {
      budgetCents:hasOverride?overrideCents:defaultBudgetCents,
      defaultBudgetCents,
      daysRemaining,
      spentBeforeCents,
      remainingMonthBudgetCents
    };
  }
  function budgetMeter(spentCents,budgetCents) {
    if(!(budgetCents>0))return {budgeted:false,pct:0,over:false,width:0,label:'暂无当日预算'};
    const pct=spentCents/budgetCents*100,over=spentCents>budgetCents;
    return {budgeted:true,pct,over,width:Math.min(100,pct),label:over?`超出 ${Math.round(pct-100)}%`:`已使用 ${Math.round(pct)}%`};
  }
  function advancePaymentDate(key,frequency,unit,anchorDay) {
    const n=Math.max(1,Math.floor(Number(frequency)||1));
    if(unit==='day')return shiftDate(key,n);
    if(unit==='week')return shiftDate(key,n*7);
    if(unit==='month'){
      const d=dateFromKey(key),day=anchorDay||d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);
      d.setDate(Math.min(day,daysInMonth(d.getFullYear(),d.getMonth()+1)));return localDateKey(d);
    }
    return key;
  }
  function debtScheduleState(debt,payments=[]) {
    const active=payments.filter(p=>p.debtId===debt.id&&!p.reversedAt);
    const paidCents=active.reduce((sum,p)=>sum+(Number(p.amountCents)||0),0);
    const remainingCents=Math.max(0,(Number(debt.totalCents)||0)-paidCents);
    const anchorDay=dateFromKey(debt.firstDueDate).getDate();
    const nextDueDate=debt.periodic
      ?Array.from({length:active.length}).reduce(date=>advancePaymentDate(date,debt.frequency,debt.unit,anchorDay),debt.firstDueDate)
      :debt.firstDueDate;
    const installment=Math.max(1,Number(debt.installmentCents)||remainingCents||1);
    const paymentCount=Math.max(1,Math.ceil(remainingCents/installment));
    const payoffDate=remainingCents<=0||!debt.periodic?null:
      Array.from({length:paymentCount-1}).reduce(date=>advancePaymentDate(date,debt.frequency,debt.unit,anchorDay),nextDueDate);
    return {remainingCents,nextDueDate,payoffDate,paidCount:active.length,activePayments:active};
  }
  function debtScheduledDates(debt,rangeStart,rangeEnd) {
    if(!(Number(debt?.remainingCents)>0)||!debt?.nextDueDate)return [];
    const installment=Math.max(1,Number(debt.installmentCents)||debt.remainingCents);
    const count=debt.periodic?Math.ceil(debt.remainingCents/installment):1;
    const anchorDay=dateFromKey(debt.firstDueDate||debt.nextDueDate).getDate();
    let index=0,date=debt.nextDueDate;
    if(rangeEnd&&date>rangeEnd)return [];
    if(rangeStart&&date<rangeStart&&debt.periodic){
      if(debt.unit==='day'||debt.unit==='week'){
        const interval=Math.max(1,Math.floor(Number(debt.frequency)||1))*(debt.unit==='week'?7:1);
        index=Math.floor(daysBetween(date,rangeStart)/interval);
        date=shiftDate(date,index*interval);
      }else if(debt.unit==='month'){
        const startDate=dateFromKey(rangeStart),dueDate=dateFromKey(date),months=(startDate.getFullYear()-dueDate.getFullYear())*12+startDate.getMonth()-dueDate.getMonth();
        index=Math.floor(Math.max(0,months)/Math.max(1,Math.floor(Number(debt.frequency)||1)));
        date=advancePaymentDate(date,index*debt.frequency,'month',anchorDay);
      }
      while(date<rangeStart&&index<count){index++;date=advancePaymentDate(date,debt.frequency,debt.unit,anchorDay);}
    }
    const dates=[];
    for(;index<count&&(!rangeEnd||date<=rangeEnd);index++){
      if(!rangeStart||date>=rangeStart)dates.push(date);
      if(debt.periodic)date=advancePaymentDate(date,debt.frequency,debt.unit,anchorDay);
    }
    return dates;
  }
  function daysBetween(start,end) { return Math.round((dateFromKey(end)-dateFromKey(start))/DAY_MS); }
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
  root.LedgerCore=Object.freeze({DAY_MS,localDateKey,dateFromKey,shiftDate,shiftMonth,daysInMonth,daysRemainingInMonth,monthKey,mondayOf,parseMoney,sumRecords,groupRecords,recordsInRange,dailyBudget,dailyBudgetForDate,budgetMeter,advancePaymentDate,debtScheduleState,debtScheduledDates,daysBetween,periodForYear,periodForMonth,periodForWeek,trendPeriods});
})(globalThis);
