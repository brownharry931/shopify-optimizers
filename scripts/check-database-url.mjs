// Startup diagnostic for DATABASE_URL. Prints the URL's structure with the
// password removed so deploy logs show exactly what is malformed, then exits
// non-zero before Prisma's less specific P1013 error.
const raw = process.env.DATABASE_URL ?? "";
const problems = [];

if (!raw) problems.push("DATABASE_URL is empty or not set.");
if (raw !== raw.trim()) problems.push("DATABASE_URL has leading/trailing spaces or line breaks.");
if (/\s/.test(raw.trim())) problems.push("DATABASE_URL contains a space or line break inside it.");
if (/^["']|["']$/.test(raw.trim())) problems.push("DATABASE_URL is wrapped in quote marks; remove them.");
if (/[<>…]/.test(raw)) problems.push("DATABASE_URL still contains a placeholder such as <region> or ….");
if (/^DATABASE_URL\s*=/i.test(raw.trim())) problems.push('DATABASE_URL value starts with "DATABASE_URL="; paste only the URL.');

let summary = "unparseable";
try {
  const url = new URL(raw.trim().replace(/^["']|["']$/g, ""));
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    problems.push(`Protocol is "${url.protocol}" but must be postgresql:`);
  }
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) {
    problems.push(`Host ${JSON.stringify(url.hostname)} contains characters that are not allowed.`);
  }
  if (url.password && /[@#/?%:]/.test(decodeURIComponent(url.password)) && url.password === decodeURIComponent(url.password)) {
    problems.push("Password contains special characters that must be URL-encoded.");
  }
  summary = JSON.stringify({
    protocol: url.protocol,
    user: url.username || "(none)",
    password: url.password ? `set (${url.password.length} chars)` : "(none)",
    host: url.hostname,
    port: url.port || "(default 5432)",
    database: url.pathname.slice(1) || "(none)",
    query: url.search || "(none)",
  });
} catch {
  problems.push("DATABASE_URL is not a valid URL. Copy it again from Render → database → Connect.");
}

console.log(`[db-check] DATABASE_URL structure: ${summary}`);
if (problems.length) {
  for (const problem of problems) console.error(`[db-check] ${problem}`);
  process.exit(1);
}
console.log("[db-check] DATABASE_URL format looks valid.");
