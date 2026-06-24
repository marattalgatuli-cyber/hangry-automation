const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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

  const token = await getToken();
  console.log('✅ Token received');

  // Get orders by date
  const ordersRes = await fetch(`${BASE}/api/1/orders/by_delivery_date_and_source_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      organizationIds: [IIKO_ORG_ID],
      dateFrom: `${date} 00:00:00.000`,
      dateTo: `${date} 23:59:59.000`
    })
  });
  const ordersData = await ordersRes.json();
  console.log('Orders:', JSON.stringify(ordersData).slice(0, 400));

  // Try hall orders
  const hallRes = await fetch(`${BASE}/api/1/orders/by_table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      organizationId: IIKO_ORG_ID,
      tableIds: []
    })
  });
  const hallData = await hallRes.json();
  console.log('Hall orders:', JSON.stringify(hallData).slice(0, 400));

  // Try stop lists (just to check access)
  const stopRes = await fetch(`${BASE}/api/1/stop_lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ organizationIds: [IIKO_ORG_ID] })
  });
  const stopData = await stopRes.json();
  console.log('StopList access:', stopData.errorDescription || '✅ OK');

  console.log('✅ Done');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
