const fetch = require('node-fetch');
const { google } = require('googleapis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT = process.env.TG_CHAT;
const TG_THREAD = process.env.TG_THREAD;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const STANDARD_HOURS = 14;

// Get last week Mon-Sun
function getLastWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff - 7);
  mon.setHours(0,0,0,0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { mon, sun };
}

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function fmtDateRu(d) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function calcHours(start, end) {
  if (!start || !end) return 0;
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  let s = sh*60+sm, e = eh*60+em;
  if (e < s) e += 24*60;
  return Math.min((e-s)/60, STANDARD_HOURS);
}

function fmt(n) {
  return Math.round(n||0).toLocaleString('ru-RU');
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

async function sendTelegram(text) {
  const body = { chat_id: TG_CHAT, text };
  if (TG_THREAD) body.message_thread_id = parseInt(TG_THREAD);
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function main() {
  const { mon, sun } = getLastWeek();
  const from = fmtDate(mon);
  const to = fmtDate(sun);

  console.log(`Processing week: ${from} - ${to}`);

  // Load data
  const employees = await sbGet('employees', 'is_active=eq.true&select=*');
  const facts = await sbGet('schedule_fact', `work_date=gte.${from}&work_date=lte.${to}&select=*`);
  const deductions = await sbGet('deductions', `work_week=eq.${from}&select=*`);

  const factMap = {};
  facts.forEach(f => { factMap[`${f.employee_id}_${f.work_date}`] = f; });

  // Week dates
  const dates = Array.from({length:7}, (_,i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });

  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const locations = ['Hangry Arbat', 'Hangry Imran'];

  // Build report data
  let tgLines = [];
  let grandTotal = 0;
  const sheetRows = [
    ['Сотрудник', 'Точка', 'Должность', ...DAYS.map((d,i) => `${d} ${fmtDateRu(dates[i]).slice(0,5)}`),
     'Дней', 'Часов', 'Начислено', 'Удержания', 'К выплате']
  ];

  for (const loc of locations) {
    tgLines.push(`\n🏪 ${loc}`);
    const emps = employees.filter(e => e.location === loc);

    for (const emp of emps) {
      const hourlyRate = emp.hourly_rate / STANDARD_HOURS;
      const dayData = dates.map(d => factMap[`${emp.id}_${fmtDate(d)}`]);
      const daysWorked = dayData.filter(f => f?.actual_start).length;
      const totalHrs = dayData.reduce((s,f) => s + calcHours(f?.actual_start, f?.actual_end), 0);
      const earned = totalHrs * hourlyRate;
      const empDeds = deductions.filter(d => d.employee_id === emp.id);
      const totalDed = empDeds.reduce((s,d) => s + d.amount, 0);
      const eligible = daysWorked >= 3;
      const net = eligible ? Math.max(0, earned - totalDed) : 0;
      grandTotal += net;

      // Telegram line
      const role = emp.role === 'manager' ? 'Менеджер' : 'Повар';
      tgLines.push(`👤 ${emp.name} (${role})`);
      tgLines.push(`   ${daysWorked} дн · ${totalHrs.toFixed(1)}ч · Начислено: ${fmt(earned)} ₸`);
      if (totalDed > 0) tgLines.push(`   ⚠️ Удержания: −${fmt(totalDed)} ₸`);
      if (!eligible) tgLines.push(`   ❌ Менее 3 дней — не начисляется`);
      else tgLines.push(`   💰 К выплате: ${fmt(net)} ₸`);

      // Sheet row
      const dayMarks = dayData.map(f => {
        if (!f?.actual_start) return '—';
        const hrs = calcHours(f.actual_start, f.actual_end);
        return `${f.actual_start.slice(0,5)}-${f.actual_end?.slice(0,5)||'?'} (${hrs.toFixed(1)}ч)`;
      });

      sheetRows.push([
        emp.name, loc, role,
        ...dayMarks,
        daysWorked,
        totalHrs.toFixed(1),
        fmt(earned) + ' ₸',
        fmt(totalDed) + ' ₸',
        eligible ? fmt(net) + ' ₸' : 'Не начисляется'
      ]);
    }
  }

  // Totals row
  sheetRows.push([]);
  sheetRows.push(['ИТОГО', '', '', '', '', '', '', '', '', '', '', fmt(grandTotal) + ' ₸']);

  // Send Telegram
  const tgMsg = [
    '📋 РАСЧЁТ ЗАРПЛАТЫ — АВТООТЧЁТ',
    `📅 Период: ${fmtDateRu(mon)} — ${fmtDateRu(sun)}`,
    '────────────────────',
    ...tgLines,
    '────────────────────',
    `💸 ИТОГО К ВЫПЛАТЕ: ${fmt(grandTotal)} ₸`,
    '',
    '#зарплата #HangryDoner #автоотчёт'
  ].join('\n');

  await sendTelegram(tgMsg);
  console.log('✅ Telegram sent');

  // Google Sheets
  if (SHEET_ID && process.env.GOOGLE_CREDENTIALS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetTitle = `Табель ${fmtDateRu(mon).slice(0,5)}-${fmtDateRu(sun).slice(0,5)}`;

    // Add new sheet
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: sheetTitle } }
          }]
        }
      });
    } catch(e) {
      console.log('Sheet may already exist:', e.message);
    }

    // Write data
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: sheetRows }
    });

    // Format header
    const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheet = sheetInfo.data.sheets.find(s => s.properties.title === sheetTitle);
    if (sheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 0.51, blue: 0.14 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            },
            {
              autoResizeDimensions: {
                dimensions: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 15 }
              }
            }
          ]
        }
      });
    }

    console.log(`✅ Google Sheets updated: ${sheetTitle}`);

    // Send sheet link to Telegram
    await sendTelegram(`📊 Табель также доступен в Google Sheets:\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}`);
  }

  console.log('✅ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
