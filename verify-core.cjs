const assert = require('node:assert/strict');
require('./core.js');
const core = global.LedgerCore;

assert.equal(core.parseMoney('12.34'), 1234);
assert.equal(core.parseMoney('12.345'), null);
assert.equal(core.parseMoney('0', true), 0);
assert.equal(core.shiftMonth('2025-12-31', 1), '2026-01-31');

assert.equal(core.periodForYear(2026, '2026-10-09').end, '2026-10-09');
assert.equal(core.periodForMonth('2026-10', '2026-10-09').end, '2026-10-09');
assert.equal(core.periodForMonth('2026-09', '2026-10-09').end, '2026-09-30');
const crossMonthWeek = core.periodForWeek('2026-05-01', '2026-10-09');
assert.equal(crossMonthWeek.start, '2026-04-27');
assert.equal(crossMonthWeek.fullEnd, '2026-05-03');
const currentWeek = core.periodForWeek('2026-10-07', '2026-10-09');
assert.equal(currentWeek.end, '2026-10-09');
assert.equal(currentWeek.fullEnd, '2026-10-11');

const annualTrend = core.trendPeriods('year', '2026-01-09', 5, '2026-01-09');
assert.deepEqual(annualTrend.map(x => x.label), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
const monthlyTrend = core.trendPeriods('month', '2026-05-01', 2, '2026-10-09');
assert.deepEqual(monthlyTrend.map(x => [x.start, x.end]), [['2026-04-20', '2026-04-26'], ['2026-04-27', '2026-05-03']]);
const weeklyTrend = core.trendPeriods('week', '2026-10-09', 4, '2026-10-09');
assert.deepEqual(weeklyTrend.map(x => x.start), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);

assert.equal(core.dailyBudget(310000, 31, undefined, false), 10000);
assert.equal(core.dailyBudget(310000, 31, 8500, true), 8500);
assert.equal(core.dailyBudget(310000, 31, undefined, false), 10000, 'a day override must not change the monthly default');
assert.equal(core.daysRemainingInMonth('2026-10-09'), 23, 'the selected day is included in the remaining days');
assert.equal(core.daysRemainingInMonth('2024-02-28'), 2, 'leap February includes both remaining dates');
assert.equal(core.dailyBudget(310000, 23, undefined, false, 100000), 9130, 'default budget is remaining month budget divided by remaining days');
assert.equal(core.dailyBudget(310000, 23, undefined, false, 350000), 0, 'daily allocation never goes below zero');
assert.equal(core.dailyBudget(310000, 23, 8500, true, 100000), 8500, 'a manual day override takes precedence');
const dailyAllocation = core.dailyBudgetForDate(310000, '2026-10-09', [
  { date: '2026-10-08', type: 'expense', amountCents: 100000 },
  { date: '2026-10-09', type: 'expense', amountCents: 5000 },
  { date: '2026-10-05', type: 'income', amountCents: 20000 },
  { date: '2026-09-30', type: 'expense', amountCents: 90000 },
], undefined, false);
assert.deepEqual(dailyAllocation, { budgetCents: 9130, defaultBudgetCents: 9130, daysRemaining: 23, spentBeforeCents: 100000, remainingMonthBudgetCents: 210000 });
assert.equal(core.dailyBudgetForDate(310000, '2026-10-09', [
  { date: '2026-10-08', type: 'expense', amountCents: 150000 },
], undefined, false).budgetCents, 6957, 'editing a prior expense updates the next daily allocation');
assert.equal(core.dailyBudgetForDate(310000, '2026-10-09', [], 8500, true).budgetCents, 8500, 'manual override stays local to that date');
assert.equal(core.dailyBudgetForDate(1, '2026-10-09', [], undefined, false).budgetCents, 0, 'sub-cent daily allocations round to zero safely');
assert.equal(core.dailyBudgetForDate(310000, '2026-10-31', [{ date: '2026-10-30', type: 'expense', amountCents: 100000 }], undefined, false).budgetCents, 210000, 'the final day receives the entire remaining monthly budget');
assert.deepEqual(core.budgetMeter(15000, 10000), { budgeted: true, pct: 150, over: true, width: 100, label: '超出 50%' });
assert.equal(core.budgetMeter(8500, 10000).label, '已使用 85%');
assert.equal(core.budgetMeter(0, 0).label, '暂无当日预算');
assert.ok(Number.isFinite(core.budgetMeter(0, 0).pct));

assert.equal(core.advancePaymentDate('2026-01-31', 1, 'month'), '2026-02-28');
assert.equal(core.advancePaymentDate('2026-02-28', 1, 'month', 31), '2026-03-31', 'monthly due dates retain the original day after a short month');
assert.equal(core.advancePaymentDate('2026-01-31', 2, 'month'), '2026-03-31');
assert.equal(core.advancePaymentDate('2026-10-09', 2, 'week'), '2026-10-23');
const debtPlan = { id: 'home', totalCents: 10000, firstDueDate: '2026-01-31', periodic: true, frequency: 1, unit: 'month', installmentCents: 2500 };
const debtSchedule = core.debtScheduleState(debtPlan, [
  { id: 'p1', debtId: 'home', amountCents: 2500 },
  { id: 'p2', debtId: 'home', amountCents: 2500 },
  { id: 'p3', debtId: 'home', amountCents: 2500, reversedAt: 1 },
]);
assert.equal(debtSchedule.remainingCents, 5000);
assert.equal(debtSchedule.nextDueDate, '2026-03-31');
assert.equal(debtSchedule.payoffDate, '2026-04-30');
assert.deepEqual(core.debtScheduledDates({ ...debtPlan, remainingCents: debtSchedule.remainingCents, nextDueDate: debtSchedule.nextDueDate }), ['2026-03-31', '2026-04-30'], 'calendar dates include every remaining installment');
assert.deepEqual(core.debtScheduledDates({ ...debtPlan, remainingCents: 6000, nextDueDate: '2026-03-31' }), ['2026-03-31', '2026-04-30', '2026-05-31'], 'a partial final installment still gets a calendar date');
assert.deepEqual(core.debtScheduledDates({ ...debtPlan, remainingCents: 6000, nextDueDate: '2026-03-31' }, '2026-04-01', '2026-05-31'), ['2026-04-30', '2026-05-31'], 'calendar range lookup jumps directly to the visible monthly installments');
assert.equal(core.debtScheduleState({ ...debtPlan, periodic: false }, []).payoffDate, null, 'one-time debt has no recurring payoff forecast');
assert.deepEqual(core.debtScheduledDates({ ...debtPlan, periodic: false, remainingCents: 5000, nextDueDate: '2026-03-31' }), ['2026-03-31'], 'one-time debt marks only its next payment date');
assert.equal(core.daysBetween('2026-10-09', '2026-10-12'), 3);

const categories = [{ id: 'food', type: 'expense', group: '生活', name: '餐饮', icon: '🍜' }];
const editedRecords = [{ date: '2026-10-01', type: 'expense', categoryId: 'food', amountCents: 500 }];
assert.equal(core.groupRecords(editedRecords, 'expense', categories)[0].amountCents, 500);
editedRecords[0] = { ...editedRecords[0], amountCents: 700 };
assert.equal(core.sumRecords(editedRecords, 'expense'), 700);
assert.equal(core.groupRecords(editedRecords, 'expense', categories)[0].amountCents, 700);
assert.equal(core.recordsInRange(editedRecords, '2026-10-01', '2026-10-01').length, 1);
assert.equal(core.recordsInRange(editedRecords, '2026-10-02', '2026-10-01').length, 0);

console.log('核心验证通过：金额精度、跨年月份、跨月周、当前周期截断、日预算覆盖、超预算百分比、零分母和记录编辑后的汇总。');
