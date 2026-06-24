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

async function getToken() {
  const res = await fetch(`${BASE}/api/v2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: IIKO_API_KEY,
      appId: IIKO_APP_ID,
      clientSecret: IIKO_CLIENT_SECRET
    })
  });
  const data = await res.json();
  const token = data.token || data.accessToken;
  if (!token) throw new Error('No token: ' + JSON.stringify(data));
  return token;
}

async function main() {
  const date = process.env.SYNC_DATE || new Date().toISOString().split('T')[0];
  console.log(`Syncing iiko data for date: ${date}`);

  const token = await getToken();
  console.log('✅ Token received');

  // Try cash shifts endpoint
  const shiftsRes = await fetch(`${BASE}/api/1/cashshifts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      organizationIds: [IIKO_ORG_ID],
      statuses: ['CLOSED'],
      openDateFrom: `${date} 00:00:00.000`,
      openDateTo: `${date} 23:59:59.000`
    })
  });

  const shiftsData = await shiftsRes.json();
  console.log('Shifts response:', JSON.stringify(shiftsData).slice(0, 800));

  // Try orders endpoint
  const ordersRes = await fetch(`${BASE}/api/1/deliveries/by_delivery_date_and_status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      organizationIds: [IIKO_ORG_ID],
      deliveryDateFrom: `${date} 00:00:00.000`,
      deliveryDateTo: `${date} 23:59:59.000`
    })
  });
  const ordersData = await ordersRes.json();
  console.log('Orders response:', JSON.stringify(ordersData).slice(0, 300));

  console.log('✅ Done - check logs above to see available data');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
