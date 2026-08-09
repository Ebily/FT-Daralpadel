/**
 * FT — Financial Tracker JSON API
 * Deploy as a Google Apps Script Web App.
 * Execute as: Me
 * Who has access: Anyone
 *
 * This is a plain JSON REST endpoint (doGet/doPost + ContentService).
 * The frontend (GitHub Pages) calls it with ordinary fetch() — no iframe,
 * no postMessage, no google.script.run. See README-ARCHITECTURE.md for why.
 */

const SPREADSHEET_ID = '1e7S22MzhVP5n8d0JbOjy2V-ePc5_WHAtFuTg5FBnuA4';
const ACCESS_KEY = 'FT-2026-daralpadel-Hamid';
const EXPENSES_SHEET = 'FT_Expenses';
const SETTINGS_SHEET = 'FT_Settings';
const HEADERS = ['id','date','description','category','quantity','unitCost','supplier','payment','notes','updatedAt'];

// GET /exec?action=bootstrap&key=... — mainly useful for a quick health check
// straight from a browser address bar or curl. The frontend itself only uses POST.
function doGet(e) {
  const params = (e && e.parameter) || {};
  return jsonOutput_(handleAction_(params));
}

// POST /exec — body is a JSON string, but the request is sent with
// Content-Type: text/plain from the client. That keeps it a CORS "simple
// request" so the browser skips an OPTIONS preflight, which Apps Script
// web apps cannot answer. We parse the JSON ourselves on this side.
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'Invalid JSON body' });
  }
  return jsonOutput_(handleAction_(body));
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Every request — read or write — funnels through here. Always returns a
// plain object; never throws, so doGet/doPost can always hand back valid JSON
// instead of Apps Script's default HTML error page (which would break
// res.json() on the client).
function handleAction_(body) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    body = body || {};
    checkKey_(body.key);
    setupSheets_();

    switch (body.action) {
      case 'bootstrap':
        return { ok: true, expenses: readExpenses_(), settings: readSettings_() };
      case 'upsert':
        upsertExpense_(parseExpense_(body.expense));
        return { ok: true };
      case 'bulkUpsert':
        (body.expenses || []).forEach(x => upsertExpense_(parseExpense_(x)));
        return { ok: true };
      case 'delete':
        deleteExpense_(String(body.id || ''));
        return { ok: true };
      case 'saveSettings':
        saveSettings_(body.settings || {});
        return { ok: true };
      case 'clear':
        clearExpenses_();
        return { ok: true };
      default:
        throw new Error('Unsupported action: ' + body.action);
    }
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// doGet delivers action params as strings (query string), doPost delivers a
// real object (parsed JSON). Normalize so upsert/bulkUpsert work from either.
function parseExpense_(x) {
  if (x && typeof x === 'string') { try { return JSON.parse(x); } catch (_) { return {}; } }
  return x || {};
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
