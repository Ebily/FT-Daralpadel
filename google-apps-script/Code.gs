/**
 * FT — Financial Tracker Google Sheets API
 * Deploy this project as a Google Apps Script Web App.
 */


const SPREADSHEET_ID = '1e7S22MzhVP5n8d0JbOjy2V-ePc5_WHAtFuTg5FBnuA4';
const ACCESS_KEY = 'FT-2026-daralpadel-Hamid';
const EXPENSES_SHEET = 'FT_Expenses';
const SETTINGS_SHEET = 'FT_Settings';
const HEADERS = ['id','date','description','category','quantity','unitCost','supplier','payment','notes','updatedAt'];

function doGet(e) {
  try {
    checkKey_(e && e.parameter && e.parameter.key);
    const action = (e && e.parameter && e.parameter.action) || 'bootstrap';
    if (action !== 'bootstrap') throw new Error('Unsupported action');
    setupSheets_();
    return json_({ ok: true, expenses: readExpenses_(), settings: readSettings_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);
    setupSheets_();

    switch (body.action) {
      case 'upsert':
        upsertExpense_(body.expense);
        break;
      case 'bulkUpsert':
        (body.expenses || []).forEach(upsertExpense_);
        break;
      case 'delete':
        deleteExpense_(String(body.id || ''));
        break;
      case 'saveSettings':
        saveSettings_(body.settings || {});
        break;
      case 'clear':
        clearExpenses_();
        break;
      default:
        throw new Error('Unsupported action');
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function setupSheets_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('PASTE_') === 0) {
    throw new Error('Set SPREADSHEET_ID in Code.gs first.');
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(EXPENSES_SHEET);
  if (!sh) sh = ss.insertSheet(EXPENSES_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  let st = ss.getSheetByName(SETTINGS_SHEET);
  if (!st) st = ss.insertSheet(SETTINGS_SHEET);
  if (st.getLastRow() === 0) {
    st.getRange(1,1,3,2).setValues([
      ['key','value'],
      ['businessName','My Business'],
      ['currency','LYD']
    ]);
  }
}

function readExpenses_() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(EXPENSES_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2,1,last-1,HEADERS.length).getValues();
  return values.filter(r => r[0] !== '').map(r => ({
    id: String(r[0]),
    date: formatDate_(r[1]),
    description: String(r[2] || ''),
    category: String(r[3] || 'other'),
    quantity: Number(r[4] || 0),
    unitCost: Number(r[5] || 0),
    supplier: String(r[6] || ''),
    payment: String(r[7] || 'cash'),
    notes: String(r[8] || '')
  })).sort((a,b) => String(b.date).localeCompare(String(a.date)));
}

function upsertExpense_(expense) {
  if (!expense || !expense.id) throw new Error('Expense id is required');
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(EXPENSES_SHEET);
  const ids = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues().flat() : [];
  const idx = ids.indexOf(String(expense.id));
  const row = [
    String(expense.id), String(expense.date || ''), String(expense.description || ''),
    String(expense.category || 'other'), Number(expense.quantity || 0), Number(expense.unitCost || 0),
    String(expense.supplier || ''), String(expense.payment || 'cash'), String(expense.notes || ''), new Date()
  ];
  if (idx >= 0) sh.getRange(idx + 2,1,1,HEADERS.length).setValues([row]);
  else sh.appendRow(row);
}

function deleteExpense_(id) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(EXPENSES_SHEET);
  if (sh.getLastRow() < 2) return;
  const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues().flat();
  const idx = ids.indexOf(id);
  if (idx >= 0) sh.deleteRow(idx + 2);
}

function clearExpenses_() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(EXPENSES_SHEET);
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,HEADERS.length).clearContent();
}

function readSettings_() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETTINGS_SHEET);
  if (sh.getLastRow() < 2) return {};
  const rows = sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
  const out = {};
  rows.forEach(r => { if (r[0]) out[String(r[0])] = String(r[1] || ''); });
  return out;
}

function saveSettings_(settings) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETTINGS_SHEET);
  const values = [
    ['key','value'],
    ['businessName', String(settings.businessName || 'My Business')],
    ['currency', String(settings.currency || 'LYD')]
  ];
  sh.clearContents();
  sh.getRange(1,1,values.length,2).setValues(values);
}

function checkKey_(key) {
  if (!ACCESS_KEY || ACCESS_KEY.indexOf('CHANGE_') === 0) {
    throw new Error('Set ACCESS_KEY in Code.gs first.');
  }
  if (String(key || '') !== ACCESS_KEY) throw new Error('Unauthorized');
}

function formatDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value || '').slice(0,10);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
