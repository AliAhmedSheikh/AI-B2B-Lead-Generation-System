process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const KEY = 'sb_publishable_XE71X80EOHGma99UpBl9Pw_VZYhTvn3';
const BASE = 'https://pndsnffumgihndnofyzy.supabase.co';

// Try to UPDATE a dummy contact to test if columns exist
// First get a contact id
const r1 = await fetch(`${BASE}/rest/v1/contacts?select=id&limit=1`, {
  headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Accept': 'application/json' }
});
const contacts = await r1.json();
console.log('Contacts found:', contacts.length);

if (contacts.length > 0) {
  const id = contacts[0].id;
  // Try UPDATE with score columns
  const r2 = await fetch(`${BASE}/rest/v1/contacts?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': KEY,
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ ai_score: 99.9 })
  });
  console.log('UPDATE with ai_score status:', r2.status);
  console.log('UPDATE response:', await r2.text());
}
