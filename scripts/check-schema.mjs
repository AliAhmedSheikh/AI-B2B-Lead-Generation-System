process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const KEY = 'sb_publishable_XE71X80EOHGma99UpBl9Pw_VZYhTvn3';
const BASE = 'https://pndsnffumgihndnofyzy.supabase.co';

// Check PostgREST schema
const r1 = await fetch(`${BASE}/rest/v1/`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
});
const schema = await r1.text();
console.log('PostgREST status:', r1.status);
console.log('contacts in schema:', schema.includes('contacts'));
console.log('lead_scores in schema:', schema.includes('lead_scores'));

// Try directly querying lead_scores table
const r2 = await fetch(`${BASE}/rest/v1/lead_scores?limit=1`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Accept': 'application/json' }
});
console.log('\nlead_scores query status:', r2.status);
console.log('lead_scores response:', await r2.text());

// Try directly querying contacts table
const r3 = await fetch(`${BASE}/rest/v1/contacts?limit=1`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Accept': 'application/json' }
});
console.log('\ncontacts query status:', r3.status);
console.log('contacts response:', await r3.text());
