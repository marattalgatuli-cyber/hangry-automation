const fetch = require('node-fetch');
const { google } = require('googleapis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_KASSA = process.env.TG_CHAT_KASSA;   // Arbat
const TG_THREAD_KASSA = process.env.TG_THREAD_KASSA; // Arbat thread
const TG_CHAT_IMRAN = process.env.TG_CHAT_IMRAN;    // Imran
const TG_THREAD_IMRAN = process.env.TG_THREAD_IMRAN; // Imran thread
const SHEET_ARBAT = process.env.GOOGLE_SHEET_ARBAT;
const SHEET_IMRAN = process.env.GOOGLE_SHEET_IMRAN;

function fmt(n) {
  return Math.round(n||0).toLocaleString('ru-RU');
}

function fmtDate(d) {
  const date = new Date(d+'T12:00:00');
  return date.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
}

async function sbGet(table, query='') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.json();
}

async function sendTelegram(text, loc) {
  const isArbat = loc && loc.includes('Arbat');
  const chatId = isArbat ? TG_CHAT_KASSA : TG_CHAT_IMRAN;
  const threadId = isArbat ? TG_THREAD_KASSA : TG_THREAD_IMRAN;
  if (!chatId) { console.log('No chat ID for', loc); return {ok:false}; }
  const body = { chat_id: chatId, text };
  if (threadId) body.message_thread_id = parseInt(threadId);
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function writeToSheets(auth, sheetId, report) {
  const sheets = google.sheets({ version: 'v4', auth });
  const date = new Date(report.report_date+'T12:00:00');
  const dateStr = date.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
  const sheetTitle = `Касса ${dateStr}`;

  // Create new sheet
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }]
      }
    });
  } catch(e) { console.log('Sheet exists:', e.message); }

  // Parse expenses
  let expenses = [];
  try { expenses = JSON.parse(report.expenses||'[]'); } catch(e) {}

  // Parse kupyury
  let kupyury = {};
  try { kupyury = JSON.parse(report.kupyury||'{}'); } catch(e) {}
  const NOMS = [20000,10000,5000,2000,1000,500,200,100,50,20];

  // Build rows
  const rows = [
    [`ОТЧЁТ КАССЫ — ${report.location}`, '', dateStr],
    [],
    ['ВЫРУЧКА ПО КАНАЛАМ', '', ''],
    ['💵 Наличные', '', fmt(report.cash||0)+' ₸'],
    ['🏦 Каспий Банк', '', fmt(report.kaspiy||0)+' ₸'],
    ['🏦 Халык Банк', '', fmt(report.halyk||0)+' ₸'],
    ['🏦 БЦК Банк', '', fmt(report.bck||0)+' ₸'],
    ['🚴 Wolt', '', fmt(report.wolt||0)+' ₸'],
    ['🚕 Яндекс', '', fmt(report.yandex||0)+' ₸'],
    ['🛵 Glovo', '', fmt(report.glovo||0)+' ₸'],
    ['💳 Мирас безнал', '', fmt(report.miras||0)+' ₸'],
    ['ИТОГО ВЫРУЧКА', '', fmt(report.total_revenue||0)+' ₸'],
    [],
    ['РАСХОДЫ', '', ''],
    ...expenses.map(e => [e.name||'Расход', '', fmt(e.amount||0)+' ₸']),
    ['ИТОГО РАСХОДЫ', '', fmt(report.total_expenses||0)+' ₸'],
    [],
    ['ПЕРЕСЧЁТ КУПЮР', 'Кол-во', 'Сумма'],
    ...NOMS.map(nom => [
      fmt(nom)+' ₸',
      kupyury[nom]||0,
      fmt((kupyury[nom]||0)*nom)+' ₸'
    ]),
    ['ИТОГО КАССА', '', fmt(report.cash_total||0)+' ₸'],
    [],
    ['Остаток начало дня', '', fmt(report.start_balance||0)+' ₸'],
    ['Прочие приходы', '', fmt(report.other_income||0)+' ₸'],
    ['ОСТАТОК КОНЕЦ ДНЯ', '', fmt(report.end_balance||0)+' ₸'],
    ['РАЗНИЦА', '', (report.diff>=0?'+':'')+fmt(report.diff||0)+' ₸'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });

  // Format header row
  const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheet = sheetInfo.data.sheets.find(s => s.properties.title === sheetTitle);
  if (sheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 1, green: 0.51, blue: 0.14 },
                  textFormat: { bold: true, foregroundColor: { red:1, green:1, blue:1 }, fontSize: 12 }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 3 }
            }
          }
        ]
      }
    });
  }

  console.log(`✅ Sheet created: ${sheetTitle}`);
  return sheetTitle;
}

async function main() {
  // Get last unprocessed report (last 10 minutes)
  const since = new Date(Date.now() - 10*60*1000).toISOString();
  const reports = await sbGet('kassa_reports', 
    `created_at=gte.${since}&order=created_at.desc&select=*&limit=5&is_processed=eq.false`
  );

  if (!reports || !reports.length) {
    console.log('No new reports found');
    return;
  }

  console.log(`Found ${reports.length} new report(s)`);

  // Google Auth
  let auth = null;
  if (process.env.GOOGLE_CREDENTIALS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  for (const report of reports) {
    const loc = report.location;
    const dateStr = fmtDate(report.report_date);
    const expenses = (() => { try { return JSON.parse(report.expenses||'[]'); } catch(e){ return []; } })();
    const totalExp = report.total_expenses || 0;
    const expLines = expenses.map(e => `   • ${e.name}: ${fmt(e.amount)} ₸`).join('\n');
    const diff = report.diff || 0;

    // Telegram message
    const msg = [
      `💵 ОТЧЁТ КАССЫ — ${loc.toUpperCase()}`,
      `📅 ${dateStr}`,
      '────────────────────',
      '📊 ВЫРУЧКА:',
      report.cash    ? `   💵 Наличные: ${fmt(report.cash)} ₸` : '',
      report.kaspiy  ? `   🏦 Каспий: ${fmt(report.kaspiy)} ₸` : '',
      report.halyk   ? `   🏦 Халык: ${fmt(report.halyk)} ₸` : '',
      report.bck     ? `   🏦 БЦК: ${fmt(report.bck)} ₸` : '',
      report.wolt    ? `   🚴 Wolt: ${fmt(report.wolt)} ₸` : '',
      report.yandex  ? `   🚕 Яндекс: ${fmt(report.yandex)} ₸` : '',
      report.glovo   ? `   🛵 Glovo: ${fmt(report.glovo)} ₸` : '',
      report.miras   ? `   💳 Мирас: ${fmt(report.miras)} ₸` : '',
      `💰 Итого выручка: ${fmt(report.total_revenue)} ₸`,
      totalExp ? `\n📤 РАСХОДЫ:\n${expLines}\n   Итого: ${fmt(totalExp)} ₸` : '',
      '────────────────────',
      `🧮 Итого касса: ${fmt(report.cash_total)} ₸`,
      `🏁 Остаток конец дня: ${fmt(report.end_balance)} ₸`,
      `${Math.abs(diff)<10?'✅':'⚠️'} Разница: ${diff>=0?'+':''}${fmt(diff)} ₸`,
      '',
      `#касса #${loc.replace(/\s/g,'')} #HangryDoner`
    ].filter(l=>l!=='').join('\n');

    // Send Telegram
    if (TG_TOKEN) {
      const tgRes = await sendTelegram(msg, loc);
      console.log(`✅ Telegram sent for ${loc}:`, tgRes.ok);
    }

    // Mark as processed to avoid duplicate sends
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/kassa_reports?id=eq.${report.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ is_processed: true })
      });
    } catch(e) { console.log('Mark processed error:', e.message); }

    // Write to Google Sheets
    if (auth) {
      const sheetId = loc.includes('Arbat') ? SHEET_ARBAT : SHEET_IMRAN;
      if (sheetId) {
        const sheetTitle = await writeToSheets(auth, sheetId, report);
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
        if (TG_TOKEN) await sendTelegram(`📊 Таблица обновлена:\n${sheetUrl}`, loc);
      }
    }
  }

  console.log('✅ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
