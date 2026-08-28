// ── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// Split out of supabase.js so that auth.js and supabase.js can both read it
// without importing each other. supabase.js needs the access token from
// auth.js, and auth.js needs the project URL/key — a direct cycle would leave
// one of them reading an uninitialised binding at module-evaluation time.
//
// The anon key is public by design: it identifies the project, it is embedded
// in the built bundle, and it cannot be kept secret in a browser app. It is NOT
// an access control mechanism. Row-level policies are the boundary — see
// CLAUDE.md for the current state of those.

export const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";

export const BUCKET = "wardrobe-images";
