const fetch = require('node-fetch');
const { google } = require('googleapis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SHEET_ARBAT = process.env.GOOGLE_SHEET_ARBAT;
const SHEET_IMRAN = process.env.GOOGLE_SHEET_IMRAN;

function fmt3(n) { return parseFloat(n||0).toFixed(3); }
function fmtDate(d) {
  const date = new Date(d+'T12:00:00');
  return date.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
}

async function sbGet(table, query='') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sbPatch(table, query, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

async function writeActToSheets(auth, sheetId, report) {
  const sheets = google.sheets({ version: 'v4', auth });
  const dateStr = fmtDate(report.report_date);
  const sheetTitle = `Акт ${dateStr} ${report.location.includes('Arbat')?'Arbat':'Imran'}`;

  // Create new sheet tab
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] }
    });
  } catch(e) { console.log('Sheet may exist:', e.message); }

  const diff = parseFloat(report.diff||0);
  const diffEmoji = Math.abs(diff)<0.05 ? '✅' : diff>0.1 ? '🔴' : '🟡';

  const rows = [
    [`АКТ РАЗБОРКИ — ${report.location}`, '', dateStr],
    [],
    ['👤 Сотрудник', '', report.employee_name||'—'],
    ['🕐 Время закрытия', '', report.shift_time||'—'],
    [],
    ['⚖️ ВЕС', '', ''],
    ['🥩 Чистый сырой', '', fmt3(report.w_raw)+' кг'],
    ['🫙 Масло / жир', '', fmt3(report.w_oil)+' кг'],
    ['🗑️ Отход', '', fmt3(report.w_waste)+' кг'],
    ['🌙 Остаток (конец)', '', fmt3(report.w_remain)+' кг'],
    [],
    ['🌯 ПРОДАЖИ', 'Норма (г)', 'Кол-во'],
    ['🔴 XL', '120г', report.xl||0],
    ['🟡 STD', '80г', report.std||0],
    ['🟢 Mini', '40г', report.mini||0],
    ['🔵 Шаурма', '40г', report.shawarma||0],
    ['🟡 Комбо Донер', '80г', report.combo_doner||0],
    ['🔵 Комбо Шаурма', '40г', report.combo_shawarma||0],
    [],
    ['📊 ИТОГ', '', ''],
    ['🌯 Всего донеров', '', (report.total_count||0)+' шт'],
    ['📦 Мясо по чеку', '', fmt3(report.meat_sold)+' кг'],
    ['⚖️ Мясо факт', '', fmt3(report.meat_spent)+' кг'],
    [diffEmoji+' Разница', '', (diff>=0?'+':'')+fmt3(diff)+' кг'],
    [],
    ['📝 Комментарий', '', report.notes||'—'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });

  // Format header
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
                  backgroundColor: { red: 0.98, green: 0.49, blue: 0.13 },
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

  console.log(`✅ Act sheet created: ${sheetTitle}`);
}

async function main() {
  // Get unprocessed acts from last 15 minutes
  const since = new Date(Date.now() - 15*60*1000).toISOString();
  const acts = await sbGet('act_razborki',
    `created_at=gte.${since}&order=created_at.desc&select=*&limit=5&is_processed=eq.false`
  );

  if (!acts || !acts.length) {
    console.log('No new acts found');
    return;
  }

  console.log(`Found ${acts.length} new act(s)`);

  // Google Auth
  if (!process.env.GOOGLE_CREDENTIALS) {
    console.log('No Google credentials');
    return;
  }

  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  for (const act of acts) {
    const sheetId = act.location.includes('Arbat') ? SHEET_ARBAT : SHEET_IMRAN;
    if (sheetId) {
      await writeActToSheets(auth, sheetId, act);
      // Mark as processed
      await sbPatch('act_razborki', `id=eq.${act.id}`, { is_processed: true });
    }
  }

  console.log('✅ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
