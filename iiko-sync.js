const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const IIKO_API_KEY = process.env.IIKO_API_KEY;
const IIKO_APP_ID = process.env.IIKO_APP_ID;
const IIKO_CLIENT_SECRET = process.env.IIKO_CLIENT_SECRET;
const IIKO_ORG_ID = process.env.IIKO_ORG_ID;
const BASE = 'https://api-ru.iiko.services';

async function sbUpsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function main() {
  const date = process.env.SYNC_DATE || new Date().toISOString().split('T')[0];
  console.log(`Syncing iiko data for date: ${date}`);

  // 1. Get token via v2
  const tokenRes = await fetch(`${BASE}/api/v2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: IIKO_API_KEY,
      appId: IIKO_APP_ID,
      clientSecret: IIKO_CLIENT_SECRET
    })
  });
  const tokenData = await tokenRes.json();
  console.log('Token response:', JSON.stringify(tokenData).slice(0, 200));
  const token = tokenData.token || tokenData.accessToken;
  if (!token) throw new Error('No token: ' + JSON.stringify(tokenData));
  console.log('✅ Token received');

  // 2. Get payment report
  const dateFrom = `${date} 00:00:00.000`;
  const dateTo = `${date} 23:59:59.000`;

  const reportRes = await fetch(`${BASE}/api/1/reports/olap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      reportType: 'SALES',
      buildSummary: true,
      groupByRowFields: ['PayTypes.PaymentType', 'Department'],
      aggregateFields: ['PayTypes.Sum'],
      filters: {
        'OpenDate.Typed': {
          filterType: 'DateRange',
          periodType: 'CUSTOM',
          from: dateFrom,
          to: dateTo
        }
      },
      organizationIds: [IIKO_ORG_ID]
    })
  });

  const reportData = await reportRes.json();
  console.log('Report:', JSON.stringify(reportData).slice(0, 500));

  const rows = reportData.data || reportData.rows || [];
  console.log(`Found ${rows.length} rows`);

  // 3. Parse by department and payment type
  const byDept = {};
  rows.forEach(row => {
    const payType = (row[0] || '').toLowerCase();
    const dept = (row[1] || 'unknown');
    const sum = parseFloat(row[2] || 0);
    if (!byDept[dept]) byDept[dept] = { cash:0, kaspiy:0, halyk:0, bck:0, wolt:0, yandex:0, glovo:0, miras:0 };
    if (payType.includes('нал') || payType.includes('cash')) byDept[dept].cash += sum;
    else if (payType.includes('каспи') || payType.includes('kaspi')) byDept[dept].kaspiy += sum;
    else if (payType.includes('халык') || payType.includes('halyk')) byDept[dept].halyk += sum;
    else if (payType.includes('бцк') || payType.includes('bck')) byDept[dept].bck += sum;
    else if (payType.includes('wolt') || payType.includes('волт')) byDept[dept].wolt += sum;
    else if (payType.includes('яндекс') || payType.includes('yandex')) byDept[dept].yandex += sum;
    else if (payType.includes('glovo') || payType.includes('глово')) byDept[dept].glovo += sum;
    else if (payType.includes('мирас') || payType.includes('miras')) byDept[dept].miras += sum;
  });

  console.log('Parsed:', JSON.stringify(byDept));

  // 4. Save to Supabase
  for (const [dept, amounts] of Object.entries(byDept)) {
    await sbUpsert('iiko_sync', {
      sync_date: date, dept_name: dept, ...amounts,
      synced_at: new Date().toISOString()
    });
    console.log(`✅ Saved: ${dept}`);
  }

  console.log('✅ Done');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
