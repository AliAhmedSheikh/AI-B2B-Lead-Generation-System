process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const KEY = 'sb_publishable_XE71X80EOHGma99UpBl9Pw_VZYhTvn3';
const BASE = 'https://pndsnffumgihndnofyzy.supabase.co';

// Try every possible endpoint to check table existence
const endpoints = [
  // 1. pg endpoint
  { url: `${BASE}/pg/query`, method: 'POST', body: JSON.stringify({ query: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_scores'" }), label: 'pg/query' },
  // 2. graphql
  { url: `${BASE}/graphql/v1`, method: 'POST', body: JSON.stringify({ query: '{ lead_scoresCollection(first:1) { edges { node { id } } } }' }), label: 'graphql' },
];

for (const ep of endpoints) {
  try {
    const r = await fetch(ep.url, {
      method: ep.method,
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: ep.body,
    });
    console.log(`\n${ep.label} status:`, r.status);
    console.log(ep.label, 'response:', (await r.text()).slice(0, 300));
  } catch(e) { console.log(ep.label, 'error:', e.message); }
}
