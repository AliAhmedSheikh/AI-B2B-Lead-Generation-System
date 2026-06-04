process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const KEY = 'sb_publishable_XE71X80EOHGma99UpBl9Pw_VZYhTvn3';
const BASE = 'https://pndsnffumgihndnofyzy.supabase.co';

// Check what columns contacts table has
const r = await fetch(`${BASE}/rest/v1/contacts?limit=1&select=*`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Accept': 'application/json' }
});
console.log('Status:', r.status);
const text = await r.text();
console.log('Response:', text.slice(0, 500));

// Try querying with score columns
const r2 = await fetch(`${BASE}/rest/v1/contacts?limit=1&select=id,ai_score,lead_category,confidence_score`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Accept': 'application/json' }
});
console.log('\nScore columns query status:', r2.status);
console.log('Score columns response:', await r2.text());
