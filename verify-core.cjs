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
assert.deepEqual(core.budgetMeter(15000, 10000), { budgeted: true, pct: 150, over: true, width: 100, label: '超出 50%' });
assert.equal(core.budgetMeter(8500, 10000).label, '已使用 85%');
assert.equal(core.budgetMeter(0, 0).label, '暂无当日预算');
assert.ok(Number.isFinite(core.budgetMeter(0, 0).pct));

const categories = [{ id: 'food', type: 'expense', group: '生活', name: '餐饮', icon: '🍜' }];
const editedRecords = [{ date: '2026-10-01', type: 'expense', categoryId: 'food', amountCents: 500 }];
assert.equal(core.groupRecords(editedRecords, 'expense', categories)[0].amountCents, 500);
editedRecords[0] = { ...editedRecords[0], amountCents: 700 };
assert.equal(core.sumRecords(editedRecords, 'expense'), 700);
assert.equal(core.groupRecords(editedRecords, 'expense', categories)[0].amountCents, 700);
assert.equal(core.recordsInRange(editedRecords, '2026-10-01', '2026-10-01').length, 1);
assert.equal(core.recordsInRange(editedRecords, '2026-10-02', '2026-10-01').length, 0);

console.log('核心验证通过：金额精度、跨年月份、跨月周、当前周期截断、日预算覆盖、超预算百分比、零分母和记录编辑后的汇总。');
