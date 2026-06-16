const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_FINANCE = process.env.TG_CHAT_FINANCE;
const TG_THREAD_FINANCE = process.env.TG_THREAD_FINANCE;

function fmt(n) { return Math.round(n||0).toLocaleString('ru-RU'); }

async function sbGet(table, query='') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function main() {
  const rows = await sbGet('nakladnye', `select=*&pay_status=eq.debt&is_paid=eq.false`);

  if (!rows || !rows.length) {
    console.log('No debts found, sending clean report');
    const msg = '✅ ДОЛГОВ ПОСТАВЩИКАМ НЕТ\n\n#долги #поставщики #HangryDoner #вторник';
    const body = { chat_id: TG_CHAT_FINANCE, text: msg };
    if (TG_THREAD_FINANCE) body.message_thread_id = parseInt(TG_THREAD_FINANCE);
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    return;
  }

  const bySupplier = {};
  rows.forEach(r => {
    bySupplier[r.supplier] = (bySupplier[r.supplier]||0) + parseFloat(r.total_sum||0);
  });
  const sorted = Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]);
  const total = sorted.reduce((s,[,a])=>s+a,0);
  const lines = sorted.map(([s,a],i) => `${i+1}. ${s} — ${fmt(a)} ₸`).join('\n');
  const dateStr = new Date().toLocaleDateString('ru-RU');

  const msg = [
    '💰 ОТЧЁТ ПО ДОЛГАМ ПОСТАВЩИКАМ',
    '────────────────────',
    `📅 Дата: ${dateStr}`,
    `📊 Поставщиков с долгом: ${sorted.length}`,
    '────────────────────',
    lines,
    '────────────────────',
    `💸 ИТОГО ДОЛГ: ${fmt(total)} ₸`,
    '',
    '#долги #поставщики #HangryDoner #вторник'
  ].join('\n');

  const body = { chat_id: TG_CHAT_FINANCE, text: msg };
  if (TG_THREAD_FINANCE) body.message_thread_id = parseInt(TG_THREAD_FINANCE);

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log('Telegram sent:', data.ok);
}

main().catch(e => { console.error(e); process.exit(1); });
