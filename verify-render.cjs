const assert = require('node:assert/strict');
require('./core.js');

class MockElement {
  constructor() { this.innerHTML = ''; this.textContent = ''; this.value = ''; this.values = {}; this.handlers = {}; this.dataset = {}; this.classList = { toggle() {} }; this.hidden = false; }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  focus() {}
  select() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  append() {}
  remove() {}
}
const elements = new Map();
const getElement = key => { if (!elements.has(key)) elements.set(key, new MockElement()); return elements.get(key); };
const nav = ['calendar', 'stats', 'accounts'].map(page => { const el = new MockElement(); el.dataset.page = page; return el; });
global.document = {
  querySelector: key => getElement(key),
  querySelectorAll: key => key === '.nav-item' ? nav : [],
  createElement: () => new MockElement(),
  addEventListener() {}
};
const cachedCoreVersion = { ...global.LedgerCore };
delete cachedCoreVersion.dailyBudgetForDate;
global.window = { LedgerCore: cachedCoreVersion, confirm: () => true };
let storedState = null;
let transactionDraftElement = null;
getElement('#modalBody').querySelector = selector => selector === '#transactionForm' && transactionDraftElement ? transactionDraftElement : getElement(selector);
global.localStorage = { getItem: () => storedState, setItem: (_key, value) => { storedState = value; }, removeItem: () => { storedState = null; } };
global.FormData = class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key] ?? null; } };
console.warn = () => {};
let remoteData = null, remoteAccount = null, remoteRevision = 0;
global.fetch = async (path, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : {};
  let status = 200, payload = {};
  if (path === '/api/session') payload = { authenticated: !!remoteAccount, user: remoteAccount };
  else if (path === '/api/register') { remoteAccount = { id: 1, username: body.username }; remoteData = body.initialData; remoteRevision = 1; status = 201; payload = { user: remoteAccount }; }
  else if (path === '/api/login') { remoteAccount = { id: 1, username: body.username }; payload = { user: remoteAccount }; }
  else if (path === '/api/data' && options.method === 'PUT') { if (body.expectedRevision !== remoteRevision) { status = 409; payload = { error: 'conflict' }; } else { remoteData = body.data; remoteRevision++; payload = { ok: true, revision: remoteRevision }; } }
  else if (path === '/api/data') payload = { data: remoteData, revision: remoteRevision };
  else if (path === '/api/profile') { remoteAccount = { ...remoteAccount, avatar: body.avatar }; payload = { user: remoteAccount }; }
  else if (path === '/api/logout') { remoteAccount = null; payload = { ok: true }; }
  else { status = 404; payload = { error: 'not found' }; }
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
global.crypto = require('node:crypto').webcrypto;
require('./app.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targetFor = selectors => ({ closest: selector => selectors[selector] || null });
(async () => {
  await sleep(30);
  const main = getElement('#mainView');
  const bottomNav = getElement('.bottom-nav');
  assert.match(main.innerHTML, /日历/);
  assert.match(main.innerHTML, /月度预算/);
  assert.match(main.innerHTML, /当日概览/);
  assert.match(main.innerHTML, /当日记录/);
  assert.match(main.innerHTML, /支出构成/);

  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[1] }) });
  assert.match(main.innerHTML, /收支趋势/);
  assert.match(main.innerHTML, /支出分类排行/);
  assert.match(main.innerHTML, /收入分类排行/);
  assert.match(main.innerHTML, /周期构成/);
  await main.handlers.click[0]({ target: targetFor({ '[data-period]': { dataset: { period: 'year' } } }) });
  assert.match(main.innerHTML, /id="yearSelect"/);
  assert.match(main.innerHTML, /向前回看/);
  await main.handlers.click[0]({ target: targetFor({ '[data-period]': { dataset: { period: 'week' } } }) });
  await main.handlers.change[0]({ target: { id: 'trendPreset', value: 'custom' } });
  assert.match(main.innerHTML, /<option value="custom" selected>自定义<\/option>/);
  assert.match(main.innerHTML, /id="trendCustom" type="number"[^>]*value="14"/);
  await main.handlers.change[0]({ target: { id: 'trendCustom', value: '27' } });
  assert.match(main.innerHTML, /27 个区间/);
  assert.match(main.innerHTML, /id="trendCustom" type="number"[^>]*value="27"/);

  const clickMainAction = async (action, extra = {}) => main.handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action, ...extra } } }) });
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[0] }) });
  await clickMainAction('edit-month-budget');
  let form = { id: 'budgetForm', values: { amount: '310.00' } };
  await getElement('#modalBody').handlers.submit[0]({ preventDefault() {}, target: form });
  assert.match(main.innerHTML, /¥310\.00/);
  const todayKey = new Date();
  const todayText = `${todayKey.getFullYear()}-${String(todayKey.getMonth()+1).padStart(2,'0')}-${String(todayKey.getDate()).padStart(2,'0')}`;
  const expectedTodayBudget = (global.LedgerCore.dailyBudgetForDate(31000, todayText, [], undefined, false).budgetCents / 100).toFixed(2);
  assert.ok(main.innerHTML.includes(`¥${expectedTodayBudget}`), 'the current day uses the remaining month balance');
  await clickMainAction('edit-month-budget');
  form = { id: 'budgetForm', values: { amount: '620.00' } };
  await getElement('#modalBody').handlers.submit[0]({ preventDefault() {}, target: form });
  const expectedUpdatedBudget = (global.LedgerCore.dailyBudgetForDate(62000, todayText, [], undefined, false).budgetCents / 100).toFixed(2);
  assert.ok(main.innerHTML.includes(`¥${expectedUpdatedBudget}`), 'changing the monthly budget immediately recalculates the daily default');
  await clickMainAction('edit-month-budget');
  form = { id: 'budgetForm', values: { amount: '310.00' } };
  await getElement('#modalBody').handlers.submit[0]({ preventDefault() {}, target: form });
  assert.ok(main.innerHTML.includes(`¥${expectedTodayBudget}`), 'restoring the monthly budget immediately restores its daily allocation');
  await clickMainAction('edit-day-budget');
  assert.ok(getElement('#modalBody').innerHTML.includes(`value="${expectedTodayBudget}"`), 'the edit form starts with the dynamic daily budget');
  assert.match(getElement('#modalBody').innerHTML, /含当天在内的本月剩余/);
  form = { id: 'budgetForm', values: { amount: '15.00' } };
  await getElement('#modalBody').handlers.submit[0]({ preventDefault() {}, target: form });
  assert.match(main.innerHTML, /¥15\.00/);
  const tomorrowText = global.LedgerCore.shiftDate(todayText, 1);
  await main.handlers.click[0]({ target: targetFor({ '.calendar-cell': { dataset: { date: tomorrowText } } }) });
  const expectedTomorrowBudget = (global.LedgerCore.dailyBudgetForDate(31000, tomorrowText, [], undefined, false).budgetCents / 100).toFixed(2);
  assert.ok(main.innerHTML.includes(`¥${expectedTomorrowBudget}`), 'the next day uses its own remaining-day allocation');
  await main.handlers.click[0]({ target: targetFor({ '.calendar-cell': { dataset: { date: todayText } } }) });
  assert.match(main.innerHTML, /¥15\.00/);
  await clickMainAction('edit-day-budget');
  assert.match(getElement('#modalBody').innerHTML, /恢复动态日预算/);
  await getElement('#modalBody').handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action: 'clear-day-budget' } } }) });
  assert.ok(main.innerHTML.includes(`¥${expectedTodayBudget}`), 'clearing the override restores the dynamic default');

  transactionDraftElement = { id: 'transactionForm', dataset: { recordId: '' }, values: { type: 'expense', date: todayText, content: '', amount: '', note: '' } };
  await clickMainAction('add-expense');
  const modalBody = getElement('#modalBody');
  await modalBody.handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action: 'new-category-from-transaction' } } }) });
  transactionDraftElement = null;
  const categoryForm = { id: 'categoryForm', values: { type: 'expense', group: '__new__', newGroup: '咖啡馆', name: '手冲咖啡', icon: '☕' } };
  await modalBody.handlers.submit[0]({ preventDefault() {}, target: categoryForm });
  let saved = JSON.parse(storedState);
  const customCategory = saved.categories.find(c => c.name === '手冲咖啡');
  assert.ok(customCategory);

  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[0] }) });
  await clickMainAction('add-expense');
  const modal = getElement('#modalBody');
  await modal.handlers.click[0]({ target: targetFor({ '[data-category-group]': { dataset: { categoryGroup: '咖啡馆' } } }) });
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const transactionForm = { id: 'transactionForm', dataset: { recordId: '' }, values: { type: 'expense', date: today, content: '验证用咖啡', amount: '12.50', note: '' } };
  await modal.handlers.submit[0]({ preventDefault() {}, target: transactionForm });
  assert.match(main.innerHTML, /验证用咖啡/);
  saved = JSON.parse(storedState);
  const record = saved.transactions[0];
  assert.equal(record.categoryId, customCategory.id);
  assert.equal(record.amountCents, 1250);

  await clickMainAction('edit-record', { id: record.id });
  transactionForm.dataset.recordId = record.id;
  transactionForm.values = { type: 'expense', date: today, content: '已编辑咖啡', amount: '17.75', note: '' };
  await modal.handlers.submit[0]({ preventDefault() {}, target: transactionForm });
  assert.match(main.innerHTML, /已编辑咖啡/);
  assert.match(main.innerHTML, /¥17\.75/);

  await clickMainAction('edit-record', { id: record.id });
  await modal.handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action: 'delete-record', id: record.id } } }) });
  await sleep(10);
  assert.doesNotMatch(main.innerHTML, /已编辑咖啡/);
  assert.equal(JSON.parse(storedState).transactions.length, 0);
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[1] }) });
  assert.match(main.innerHTML, /¥0\.00/);
  await getElement('#accountButton').handlers.click[0]({});
  const accountForm = { id: 'accountForm', dataset: { mode: 'register' }, values: { username: 'render.test', password: 'password 123', passwordConfirm: 'password 123' } };
  await modal.handlers.submit[0]({ preventDefault() {}, target: accountForm });
  assert.equal(getElement('#accountLabel').textContent, 'render.test');
  assert.equal(storedState, null);
  assert.equal(remoteData.monthBudgets[todayText.slice(0,7)], 31000);
  await getElement('#accountButton').handlers.click[0]({});
  assert.match(modal.innerHTML, /data-action="edit-avatar"/);
  await modal.handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action: 'edit-avatar' } } }) });
  assert.equal((modal.innerHTML.match(/data-avatar-preset=/g) || []).length, 10);
  await modal.handlers.click[0]({ target: targetFor({ '[data-avatar-preset]': { dataset: { avatarPreset: 'leaf' } } }) });
  const avatarForm = { id: 'avatarForm' };
  await modal.handlers.submit[0]({ preventDefault() {}, target: avatarForm });
  assert.equal(remoteAccount.avatar, 'preset:leaf');
  assert.match(modal.innerHTML, /data-action="edit-avatar"/);
  await clickMainAction('add-expense');
  const syncedForm = { id: 'transactionForm', dataset: { recordId: '' }, values: { type: 'expense', date: todayText, content: '账户同步记录', amount: '2.50', note: '' } };
  await modal.handlers.submit[0]({ preventDefault() {}, target: syncedForm });
  assert.equal(remoteData.transactions[0].content, '账户同步记录');
  assert.equal(storedState, null);
  const syncedRecord = remoteData.transactions[0];
  await clickMainAction('edit-record', { id: syncedRecord.id });
  syncedForm.dataset.recordId = syncedRecord.id;
  syncedForm.values = { type: 'expense', date: todayText, content: '账户同步修改', amount: '3.75', note: '' };
  await modal.handlers.submit[0]({ preventDefault() {}, target: syncedForm });
  assert.equal(remoteData.transactions[0].amountCents, 375);
  await clickMainAction('edit-record', { id: syncedRecord.id });
  await modal.handlers.click[0]({ target: targetFor({ '[data-action]': { dataset: { action: 'delete-record', id: syncedRecord.id } } }) });
  await sleep(10);
  assert.equal(remoteData.transactions.length, 0);
  remoteData.transactions.push({ id: 'other-browser-tx', type: 'expense', date: todayText, amountCents: 500, categoryId: 'seed_e_00', content: '另一浏览器新增', note: '', createdAt: Date.now(), updatedAt: Date.now() });
  remoteRevision++;
  await clickMainAction('add-expense');
  const concurrentForm = { id: 'transactionForm', dataset: { recordId: '' }, values: { type: 'expense', date: todayText, content: '当前浏览器新增', amount: '4.00', note: '' } };
  await modal.handlers.submit[0]({ preventDefault() {}, target: concurrentForm });
  assert.equal(remoteData.transactions.length, 2);
  assert.ok(remoteData.transactions.some(record => record.content === '另一浏览器新增'));
  assert.ok(remoteData.transactions.some(record => record.content === '当前浏览器新增'));
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[2] }) });
  assert.match(main.innerHTML, /总资产/);
  assert.match(main.innerHTML, /资产账户/);
  assert.match(main.innerHTML, /债务/);
  await clickMainAction('add-asset');
  const assetForm = { id: 'assetForm', dataset: { id: '' }, values: { kind: 'bank', category: '', name: '验证储蓄卡', detail: '尾号 1234', balance: '1000.00' } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: assetForm });
  const asset = remoteData.assets.find(item => item.name === '验证储蓄卡');
  assert.equal(asset.balanceCents, 100000);
  await clickMainAction('add-asset');
  const secondAssetForm = { id: 'assetForm', dataset: { id: '' }, values: { kind: 'cash', category: '', name: '验证零钱', detail: '', balance: '500.00' } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: secondAssetForm });
  const otherAsset = remoteData.assets.find(item => item.name === '验证零钱');
  await clickMainAction('edit-asset', { id: asset.id });
  assert.match(modal.innerHTML, /asset-balance-readonly/);
  assert.doesNotMatch(modal.innerHTML, /id="assetBalance" name="balance"/);
  await modal.handlers.click.at(-1)({ target: targetFor({ '[data-action]': { dataset: { action: 'edit-asset-balance', id: asset.id } } }) });
  assert.match(modal.innerHTML, /手动调整/);
  assert.match(modal.innerHTML, /向其他账户转出/);
  assert.match(modal.innerHTML, /从其他账户转入/);
  await modal.handlers.click.at(-1)({ target: targetFor({ '[data-balance-mode]': { dataset: { balanceMode: 'out' } } }) });
  const transferForm = { id: 'balanceForm', dataset: { id: asset.id }, values: { mode: 'out', otherAccountOut: otherAsset.id, outAmount: '1000.01' } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: transferForm });
  assert.match(getElement('#formError').textContent, /超过账户余额/);
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 100000, 'an over-balance transfer is rejected');
  transferForm.values.outAmount = '100.00';
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: transferForm });
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 90000);
  assert.equal(remoteData.assets.find(item => item.id === otherAsset.id).balanceCents, 60000);
  await clickMainAction('edit-asset', { id: asset.id });
  await modal.handlers.click.at(-1)({ target: targetFor({ '[data-action]': { dataset: { action: 'edit-asset-balance', id: asset.id } } }) });
  const manualBalanceForm = { id: 'balanceForm', dataset: { id: asset.id }, values: { mode: 'manual', newBalance: '950.00' } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: manualBalanceForm });
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 95000, 'manual adjustment changes only the displayed balance');
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[0] }) });
  await clickMainAction('add-expense');
  const linkedForm = { id: 'transactionForm', dataset: { recordId: '' }, values: { type: 'expense', date: todayText, content: '账户关联消费', amount: '1.00', note: '', accountId: asset.id } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: linkedForm });
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 94900, 'linked spending reduces the asset balance');
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[2] }) });
  await clickMainAction('add-debt');
  const debtForm = { id: 'debtForm', dataset: { id: '' }, values: { kind: 'mortgage', category: '', name: '验证房贷', detail: '', total: '100.00', periodic: 'yes', firstDueDate: todayText, dueDate: todayText, frequency: '1', unit: 'month', installment: '25.00' } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: debtForm });
  const debt = remoteData.debts.find(item => item.name === '验证房贷');
  assert.equal(debt.expectedPayoffDate, global.LedgerCore.shiftMonth(todayText, 3));
  await clickMainAction('repay-debt', { id: debt.id });
  const repaymentForm = { id: 'repaymentForm', dataset: { id: debt.id }, values: { accountId: asset.id } };
  await modal.handlers.submit.at(-1)({ preventDefault() {}, target: repaymentForm });
  assert.equal(remoteData.debts.find(item => item.id === debt.id).remainingCents, 7500);
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 92400, 'repayment expense also debits its linked cash account');
  assert.ok(remoteData.transactions.some(item => item.debtPaymentId && item.amountCents === 2500));
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[1] }) });
  assert.match(main.innerHTML, /债务还款/);
  assert.match(main.innerHTML, /¥25\.00/);
  await bottomNav.handlers.click[0]({ target: targetFor({ '.nav-item': nav[2] }) });
  await clickMainAction('debt-history');
  await modal.handlers.click.at(-1)({ target: targetFor({ '[data-action]': { dataset: { action: 'undo-repayment', id: remoteData.debtPayments[0].id } } }) });
  assert.equal(remoteData.debts.find(item => item.id === debt.id).remainingCents, 10000, 'undo restores the remaining debt');
  assert.ok(remoteData.debtPayments[0].reversedAt, 'undo is retained in repayment history');
  assert.equal(remoteData.assets.find(item => item.id === asset.id).balanceCents, 94900, 'undo restores the linked asset balance');
  assert.ok(remoteData.transactions.some(item => item.debtPaymentId && item.voidedAt), 'undone repayment is excluded from the ledger by a void marker');
  console.log('界面与交互验证通过：导航与预算、收支增删改、账户同步、头像编辑、余额手动调整、账户转账与余额不足拦截、资产关联扣款、债务周期、还款统计和撤回恢复。');
})().catch(error => { console.error(error); process.exitCode = 1; });
