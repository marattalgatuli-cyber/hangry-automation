const fetch = require('node-fetch');

const IIKO_API_KEY = process.env.IIKO_API_KEY;
const IIKO_APP_ID = process.env.IIKO_APP_ID;
const IIKO_CLIENT_SECRET = process.env.IIKO_CLIENT_SECRET;
const IIKO_ORG_ID = process.env.IIKO_ORG_ID;
const BASE = 'https://api-ru.iiko.services';

async function getToken() {
  const res = await fetch(`${BASE}/api/v2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: IIKO_API_KEY, appId: IIKO_APP_ID, clientSecret: IIKO_CLIENT_SECRET })
  });
  const data = await res.json();
  if (!data.token) throw new Error('No token: ' + JSON.stringify(data));
  return data.token;
}

async function main() {
  const date = process.env.SYNC_DATE || new Date().toISOString().split('T')[0];
  const token = await getToken();
  console.log('✅ Token received');

  const endpoints = [
    ['organizations', { organizationIds: [IIKO_ORG_ID] }],
    ['terminal_groups', { organizationIds: [IIKO_ORG_ID] }],
    ['payment_types', { organizationIds: [IIKO_ORG_ID] }],
    ['reports/olap', {
      reportType: 'SALES',
      buildSummary: true,
      groupByRowFields: ['PayTypes.PaymentType'],
      aggregateFields: ['PayTypes.Sum'],
      filters: { 'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from: `${date} 00:00:00.000`, to: `${date} 23:59:59.000` } },
      organizationIds: [IIKO_ORG_ID]
    }],
  ];

  for (const [ep, body] of endpoints) {
    const res = await fetch(`${BASE}/api/1/${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const preview = JSON.stringify(data).slice(0, 200);
    console.log(`\n[${ep}]: ${preview}`);
  }
  console.log('\n✅ Done');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
