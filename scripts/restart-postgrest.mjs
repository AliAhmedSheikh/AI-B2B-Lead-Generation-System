/**
 * Restart PostgREST via Supabase Management API
 * Usage: node scripts/restart-postgrest.mjs <SUPABASE_ACCESS_TOKEN>
 * Get token from: https://supabase.com/dashboard/account/tokens
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ACCESS_TOKEN = process.argv[2];
const PROJECT_REF = 'pndsnffumgihndnofyzy';

if (!ACCESS_TOKEN) {
  console.log('Usage: node scripts/restart-postgrest.mjs <SUPABASE_ACCESS_TOKEN>');
  console.log('\nGet your access token from:');
  console.log('https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

console.log('Restarting PostgREST service...');
const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/services/postgrest/restart`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  }
);
console.log('Status:', res.status);
console.log('Response:', await res.text());
