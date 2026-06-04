/**
 * Restart Supabase PostgREST + reload schema via Management API
 * Usage: node scripts/restart-services.mjs <ACCESS_TOKEN>
 * Get token: https://supabase.com/dashboard/account/tokens
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TOKEN = process.argv[2];
const PROJECT = 'pndsnffumgihndnofyzy';

if (!TOKEN) {
  console.log('Usage: node scripts/restart-services.mjs <SUPABASE_ACCESS_TOKEN>');
  console.log('Get token: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

// Try restarting PostgREST service
const endpoints = [
  `https://api.supabase.com/v1/projects/${PROJECT}/services/postgrest/restart`,
  `https://api.supabase.com/v1/projects/${PROJECT}/restart`,
  `https://api.supabase.com/v1/projects/${PROJECT}/database/restart`,
];

for (const url of endpoints) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  console.log(`${url}: ${r.status} ${await r.text()}`);
}
