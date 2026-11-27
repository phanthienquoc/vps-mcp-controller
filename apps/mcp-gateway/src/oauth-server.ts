import { randomBytes, createHash, scryptSync, timingSafeEqual, createPublicKey } from "node:crypto";
import { isAllowedRedirectUri, verifyPkceS256 } from "./oauth-helpers.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { SignJWT, importPKCS8, exportJWK, type JWK } from "jose";

const ISSUER = process.env.MCP_OAUTH_ISSUER ?? "https://mcp.mrcute.space";
const RESOURCE = process.env.MCP_RESOURCE_URL ?? "https://mcp.mrcute.space/mcp";
const DB_PATH = process.env.MCP_AUTH_DB_PATH ?? "/var/lib/vps-mcp-auth/auth.sqlite";
const ACCESS_TTL = 300;
const CODE_TTL = 120;
const SESSION_TTL = 8 * 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const SCOPE = "mcp:tools";

mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(DB_PATH);
db.exec(\`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL,
    password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clients (
    client_id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL,
    token_auth_method TEXT NOT NULL DEFAULT 'none', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, resource TEXT NOT NULL,
    scope TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started INTEGER NOT NULL, locked_until INTEGER
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, client_id TEXT NOT NULL,
    user_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL, used_at INTEGER
  );
\`);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function cleanExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM auth_codes WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(now);
}

function ensureBootstrapUser(): void {
  const email = process.env.MCP_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.MCP_BOOTSTRAP_PASSWORD;
  if (!email || !password) throw new Error("MCP_BOOTSTRAP_EMAIL and MCP_BOOTSTRAP_PASSWORD are required");
  if (password.length < 14) throw new Error("MCP_BOOTSTRAP_PASSWORD must contain at least 14 characters");
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (exists) return;
  const salt = randomToken(16);
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  db.prepare("INSERT INTO users(id,email,salt,password_hash,created_at) VALUES(?,?,?,?,?)")
    .run(randomToken(18), email, salt, passwordHash, Math.floor(Date.now() / 1000));
}

const signingKeyPem = process.env.MCP_OAUTH_SIGNING_PRIVATE_KEY;
if (!signingKeyPem) throw new Error("MCP_OAUTH_SIGNING_PRIVATE_KEY is required");
const signingKey = await importPKCS8(signingKeyPem.replace(/\\n/g, "\n"), "RS256");
const publicJwk = await exportJWK(createPublicKey(signingKeyPem.replace(/\\n/g, "\n")) as never) as JWK;
publicJwk.use = "sig";
publicJwk.alg = "RS256";
publicJwk.kid = process.env.MCP_OAUTH_SIGNING_KID ?? "mcp-key-1";
const jwks = { keys: [publicJwk] };

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function page(title: string, body: string): string {
  return \`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\${htmlEscape(title)}</title><style>body{font:16px system-ui;background:#f4f5f7;margin:0;display:grid;min-height:100vh;place-items:center}.card{background:white;padding:28px;border-radius:14px;width:min(390px,calc(100% - 56px));box-shadow:0 8px 32px #0001}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:1px solid #ccd0d5;border-radius:8px;font:inherit}button{background:#111827;color:white;border:0;cursor:pointer}small{color:#666}</style><main class="card"><h2>\${htmlEscape(title)}</h2>\${body}</main></html>\`;
}
function sendError(res: Response, status: number, error: string, description?: string): void {
  res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}
function readClient(clientId: string): { redirect_uris: string[]; token_auth_method: string } | null {
  const row = db.prepare("SELECT redirect_uris,token_auth_method FROM clients WHERE client_id=?").get(clientId) as
    { redirect_uris: string; token_auth_method: string } | undefined;
  if (row) return { redirect_uris: JSON.parse(row.redirect_uris), token_auth_method: row.token_auth_method };
  return null;
}

async function resolveClient(clientId: string): Promise<{ redirect_uris: string[]; token_auth_method: string } | null> {
  const registered = readClient(clientId);
  if (registered) return registered;
  let u: URL;
  try { u = new URL(clientId); } catch { return null; }
  // Restrict CIMD fetches to OpenAI's documented client metadata origin to prevent SSRF.
  if (u.protocol !== "https:" || u.hostname !== "chatgpt.com" || u.username || u.password || u.port || u.hash) return null;
  const response = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) return null;
  const doc = await response.json() as { client_id?: string; redirect_uris?: unknown; token_endpoint_auth_methods_supported?: unknown };
  if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.every((v) => typeof v === "string" && isAllowedRedirectUri(v))) return null;
  const methods = doc.token_endpoint_auth_methods_supported;
  if (!Array.isArray(methods) || !methods.includes("none")) return null;
  return { redirect_uris: doc.redirect_uris as string[], token_auth_method: "none" };
}
function requestParams(req: Request): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") out.set(k, v);
  return out;
}
function sessionUser(req: Request): string | null {
  const cookie = req.header("cookie") ?? "";
  const raw = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith("mcp_session="))?.slice(12);
  if (!raw) return null;
  const row = db.prepare("SELECT user_id,expires_at FROM sessions WHERE token_hash=?").get(hash(decodeURIComponent(raw))) as
    { user_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row.user_id;
}

export async function createLocalOAuthRouter() {
  cleanExpired();
  ensureBootstrapUser();
  const router = Router();
  const authMetadata = {
    issuer: ISSUER,
    authorization_endpoint: \`\${ISSUER}/oauth/authorize\`,
    token_endpoint: \`\${ISSUER}/oauth/token\`,
    registration_endpoint: \`\${ISSUER}/oauth/register\`,
    revocation_endpoint: \`\${ISSUER}/oauth/revoke\`,
    jwks_uri: \`\${ISSUER}/oauth/jwks.json\`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: false,
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  };

  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(authMetadata));
  router.get("/oauth/jwks.json", (_req, res) => res.json(jwks));

  router.post("/oauth/register", async (req, res) => {
    const redirects = req.body?.redirect_uris;
    const grants = req.body?.grant_types ?? ["authorization_code", "refresh_token"];
    const methods = req.body?.token_endpoint_auth_method ? [req.body.token_endpoint_auth_method] : ["none"];
    if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10
        || !redirects.every((v: unknown) => typeof v === "string" && isAllowedRedirectUri(v))
        || !Array.isArray(grants) || !grants.includes("authorization_code")
        || !Array.isArray(methods) || !methods.includes("none")) {
      return sendError(res, 400, "invalid_client_metadata");
    }
    const clientId = randomToken(24);
    db.prepare("INSERT INTO clients(client_id,redirect_uris,token_auth_method,created_at) VALUES(?,?,?,?)")
      .run(clientId, JSON.stringify(redirects), "none", Math.floor(Date.now() / 1000));
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirects,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  router.get("/oauth/authorize", async (req, res) => {
    const p = requestParams(req);
    const clientId = p.get("client_id") ?? "";
    const redirectUri = p.get("redirect_uri") ?? "";
    const client = await resolveClient(clientId).catch(() => null);
    if (!client || !client.redirect_uris.includes(redirectUri)) return sendError(res, 400, "invalid_request", "Unknown client or redirect URI");
    if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256"
        || !p.get("code_challenge") || !/^[A-Za-z0-9_-]{43,128}$/.test(p.get("code_challenge")!)) {
      return sendError(res, 400, "invalid_request", "Authorization Code with PKCE S256 is required");
    }
    if (p.get("resource") !== RESOURCE) return sendError(res, 400, "invalid_target");
    const scopes = (p.get("scope") ?? "").split(/\\s+/).filter(Boolean);
    if (!scopes.includes(SCOPE) || scopes.some((s) => s !== SCOPE)) return sendError(res, 400, "invalid_scope");
    const state = randomToken(24);
    const serialized = Buffer.from(p.toString()).toString("base64url");
    const userId = sessionUser(req);
    if (!userId) {
      res.type("html").send(page("Sign in", \`<form method="post" action="/oauth/login"><input type="hidden" name="request" value="\${serialized}"><label>Email</label><input name="email" type="email" autocomplete="username" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button>Sign in</button><small>Authorized access to the VPS MCP service</small></form>\`));
      return;
    }
    res.type("html").send(page("Authorize access", \`<p>Allow this client to access VPS monitoring and approved operations?</p><p><small>Permission: \${SCOPE}</small></p><form method="post" action="/oauth/consent"><input type="hidden" name="request" value="\${serialized}"><button>Allow access</button></form>\`));
  });

  router.post("/oauth/login", async (req, res) => {
    const request = String(req.body?.request ?? "");
    let p: URLSearchParams;
    try { p = new URLSearchParams(Buffer.from(request, "base64url").toString("utf8")); } catch { return sendError(res, 400, "invalid_request"); }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const attemptKey = hash(`${req.ip ?? "unknown"}|${email}`);
    const now = Math.floor(Date.now() / 1000);
    const attempt = db.prepare("SELECT failures,window_started,locked_until FROM login_attempts WHERE attempt_key=?").get(attemptKey) as
      { failures: number; window_started: number; locked_until: number | null } | undefined;
    if (attempt?.locked_until && attempt.locked_until > now) {
      res.status(429).type("html").send(page("Please wait", "<p>Too many sign-in attempts. Try again later.</p>"));
      return;
    }
    const user = db.prepare("SELECT id,salt,password_hash FROM users WHERE email=? AND active=1").get(email) as
      { id: string; salt: string; password_hash: string } | undefined;
    const calculated = user ? scryptSync(password, user.salt, 64).toString("hex") : "0".repeat(128);
    if (!user || !safeEqual(calculated, user.password_hash)) {
      const windowStart = attempt && now - attempt.window_started < 900 ? attempt.window_started : now;
      const failures = attempt && windowStart === attempt.window_started ? attempt.failures + 1 : 1;
      const lockedUntil = failures >= 8 ? now + 900 : null;
      db.prepare("INSERT INTO login_attempts(attempt_key,failures,window_started,locked_until) VALUES(?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET failures=excluded.failures,window_started=excluded.window_started,locked_until=excluded.locked_until")
        .run(attemptKey, failures, windowStart, lockedUntil);
      res.status(401).type("html").send(page("Sign in failed", `<p>Invalid email or password.</p><a href="/oauth/authorize?${htmlEscape(p.toString())}">Try again</a>`));
      return;
    }
    db.prepare("DELETE FROM login_attempts WHERE attempt_key=?").run(attemptKey);
    const session = randomToken();
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(hash(session), user.id, Math.floor(Date.now() / 1000) + SESSION_TTL);
    res.setHeader("Set-Cookie", \`mcp_session=\${encodeURIComponent(session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=\${SESSION_TTL}\`);
    res.redirect(303, \`/oauth/authorize?\${p.toString()}\`);
  });

  router.post("/oauth/consent", async (req, res) => {
    const encoded = String(req.body?.request ?? "");
    let p: URLSearchParams;
    try { p = new URLSearchParams(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return sendError(res, 400, "invalid_request"); }
    const userId = sessionUser(req);
    if (!userId) return sendError(res, 401, "login_required");
    const clientId = p.get("client_id") ?? "";
    const client = await resolveClient(clientId).catch(() => null);
    const redirectUri = p.get("redirect_uri") ?? "";
    if (!client || !client.redirect_uris.includes(redirectUri)) return sendError(res, 400, "invalid_client");
    if (p.get("resource") !== RESOURCE || p.get("code_challenge_method") !== "S256") return sendError(res, 400, "invalid_request");
    const code = randomToken();
    db.prepare("INSERT INTO auth_codes(code_hash,client_id,user_id,redirect_uri,challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(hash(code), clientId, userId, redirectUri, p.get("code_challenge"), RESOURCE, SCOPE, Math.floor(Date.now() / 1000) + CODE_TTL);
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", p.get("state") ?? "");
    target.searchParams.set("iss", ISSUER);
    res.redirect(303, target.toString());
  });

  router.post("/oauth/token", async (req, res) => {
    const grant = String(req.body?.grant_type ?? "");
    const clientId = String(req.body?.client_id ?? "");
    const client = await resolveClient(clientId).catch(() => null);
    if (!client) return sendError(res, 401, "invalid_client");
    if (grant === "authorization_code") {
      const code = String(req.body?.code ?? "");
      const redirectUri = String(req.body?.redirect_uri ?? "");
      const verifier = String(req.body?.code_verifier ?? "");
      const row = db.prepare("SELECT * FROM auth_codes WHERE code_hash=?").get(hash(code)) as
        { client_id: string; user_id: string; redirect_uri: string; challenge: string; resource: string; scope: string; expires_at: number } | undefined;
      if (!row || row.expires_at < Math.floor(Date.now() / 1000) || row.client_id !== clientId
          || row.redirect_uri !== redirectUri || row.resource !== String(req.body?.resource ?? "")
          || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return sendError(res, 400, "invalid_grant");
      if (!verifyPkceS256(verifier, row.challenge)) return sendError(res, 400, "invalid_grant");
      db.prepare("DELETE FROM auth_codes WHERE code_hash=?").run(hash(code));
      const access = await new SignJWT({ scope: row.scope })
        .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid as string, typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(row.user_id).setAudience(row.resource)
        .setIssuedAt().setExpirationTime(ACCESS_TTL).setJti(randomToken(16)).sign(signingKey);
      const refresh = randomToken();
      db.prepare("INSERT INTO refresh_tokens(token_hash,family_id,client_id,user_id,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?)")
        .run(hash(refresh), randomToken(16), clientId, row.user_id, row.resource, row.scope, Math.floor(Date.now() / 1000) + REFRESH_TTL);
      res.setHeader("Cache-Control", "no-store");
      res.json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: row.scope });
      return;
    }
    if (grant === "refresh_token") {
      const token = String(req.body?.refresh_token ?? "");
      const row = db.prepare("SELECT * FROM refresh_tokens WHERE token_hash=?").get(hash(token)) as
        { family_id: string; client_id: string; user_id: string; resource: string; scope: string; expires_at: number; used_at: number | null } | undefined;
      if (!row || row.client_id !== clientId || row.expires_at < Math.floor(Date.now() / 1000) || row.used_at) {
        if (row?.family_id) db.prepare("DELETE FROM refresh_tokens WHERE family_id=?").run(row.family_id);
        return sendError(res, 400, "invalid_grant");
      }
      db.prepare("UPDATE refresh_tokens SET used_at=? WHERE token_hash=?").run(Math.floor(Date.now() / 1000), hash(token));
      const next = randomToken();
      db.prepare("INSERT INTO refresh_tokens(token_hash,family_id,client_id,user_id,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?)")
        .run(hash(next), row.family_id, clientId, row.user_id, row.resource, row.scope, Math.floor(Date.now() / 1000) + REFRESH_TTL);
      const access = await new SignJWT({ scope: row.scope })
        .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid as string, typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(row.user_id).setAudience(row.resource)
        .setIssuedAt().setExpirationTime(ACCESS_TTL).setJti(randomToken(16)).sign(signingKey);
      res.setHeader("Cache-Control", "no-store");
      res.json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: next, scope: row.scope });
      return;
    }
    sendError(res, 400, "unsupported_grant_type");
  });

  router.post("/oauth/revoke", (req, res) => {
    const token = String(req.body?.token ?? "");
    db.prepare("DELETE FROM refresh_tokens WHERE token_hash=?").run(hash(token));
    res.status(200).end();
  });

  router.post("/oauth/logout", (req, res) => {
    const cookie = req.header("cookie") ?? "";
    const raw = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith("mcp_session="))?.slice(12);
    if (raw) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(decodeURIComponent(raw)));
    res.setHeader("Set-Cookie", "mcp_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    res.status(204).end();
  });

  return router;
}
