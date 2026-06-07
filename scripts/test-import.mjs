// Test that the email finder correctly picks up "Email Address" column
const row = {
  "Decision Maker Name": "Sarah Chen",
  "Decision Maker Title": "CTO",
  "Industry": "Cloud Technology",
  "Email Address": "sarah.chen@cloudvault.com",
  "Country": "United States"
};

const EMAIL_KEYS = [
  "email", "e-mail", "mail", "email_address", "emailaddress",
  "email address", "work_email", "work email", "business_email",
  "business email", "corporate_email", "contact_email", "primary_email",
  "person_email", "user_email", "email1", "email_1", "email 1",
  "electronic_mail", "e_mail", "emailid", "email_id",
  "email id", "email-address", "email (work)", "work e-mail",
];

function pick(row, keys) {
  const lower = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function findEmail(row) {
  const byName = pick(row, EMAIL_KEYS);
  if (byName) return { found: byName, method: "named alias" };
  for (const v of Object.values(row)) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s && s.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return { found: s, method: "auto-detect" };
    }
  }
  return { found: null, method: "not found" };
}

const result = findEmail(row);
console.log("Email found:", result.found, `(via ${result.method})`);
console.log("Name:", pick(row, ["decision maker name", "full name", "name"]));
console.log("Title (raw):", row["Decision Maker Title"]);
console.log("Industry (raw):", row["Industry"]);
console.log("Country (raw):", row["Country"]);
console.log(result.found ? "✓ PASS" : "✗ FAIL");
