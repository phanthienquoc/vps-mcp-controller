import { randomBytes, createHash, scryptSync, timingSafeEqual, createPublicKey } from "node:crypto";
import { isAllowedRedirectUri, parseOAuthScopes, pkceS256 } from "./oauth-helpers.js";
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
const AUTHORIZATION_TTL = 10 * 60;
const SESSION_TTL = 8 * 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const SCOPE = "mcp:tools";

mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(DB_PATH);
db.exec(`
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
  CREATE TABLE IF NOT EXISTS authorization_transactions (
    transaction_hash TEXT PRIMARY KEY, request_query TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
`);

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
  db.prepare("DELETE FROM authorization_transactions WHERE expires_at <= ?").run(now);
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
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>body{font:16px system-ui;background:#f4f5f7;margin:0;display:grid;min-height:100vh;place-items:center}.card{background:white;padding:28px;border-radius:14px;width:min(390px,calc(100% - 56px));box-shadow:0 8px 32px #0001}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:1px solid #ccd0d5;border-radius:8px;font:inherit}button{background:#111827;color:white;border:0;cursor:pointer}small{color:#666}</style><main class="card"><h2>${htmlEscape(title)}</h2>${body}</main></html>`;
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

function createAuthorizationTransaction(p: URLSearchParams): string {
  const token = randomToken(32);
  const expiresAt = Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL;
  db.prepare("INSERT INTO authorization_transactions(transaction_hash,request_query,expires_at) VALUES(?,?,?)")
    .run(hash(token), p.toString(), expiresAt);
  return token;
}

function readAuthorizationTransaction(token: string): URLSearchParams | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare("SELECT request_query,expires_at FROM authorization_transactions WHERE transaction_hash=?")
    .get(hash(token)) as { request_query: string; expires_at: number } | undefined;
  if (!row || row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  return new URLSearchParams(row.request_query);
}

function consumeAuthorizationTransaction(token: string): URLSearchParams | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare("DELETE FROM authorization_transactions WHERE transaction_hash=? AND expires_at>? RETURNING request_query")
    .get(hash(token), now) as { request_query: string } | undefined;
  return row ? new URLSearchParams(row.request_query) : null;
}

function isSameOriginFormPost(req: Request): boolean {
  if (req.header("sec-fetch-site") === "cross-site") return false;
  const origin = req.header("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(ISSUER).origin;
  } catch {
    return false;
  }
}

function loginPage(transaction: string, message = ""): string {
  const notice = message ? "<p>" + htmlEscape(message) + "</p>" : "";
  return page("Sign in", notice +
    '<form method="post" action="/oauth/login">' +
    '<input type="hidden" name="transaction" value="' + htmlEscape(transaction) + '">' +
    '<label>Email</label><input name="email" type="email" autocomplete="username" required>' +
    '<label>Password</label><input name="password" type="password" autocomplete="current-password" required>' +
    '<button>Sign in</button><small>Authorized access to the VPS MCP service</small></form>');
}

async function validateAuthorizationRequest(p: URLSearchParams) {
  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const client = await resolveClient(clientId).catch(() => null);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false as const, status: 400, error: "invalid_request", description: "Unknown client or redirect URI" };
  }
  if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256"
      || !/^[A-Za-z0-9_-]{43}$/.test(p.get("code_challenge") ?? "")) {
    return { ok: false as const, status: 400, error: "invalid_request", description: "Authorization Code with PKCE S256 is required" };
  }
  if (p.get("resource") !== RESOURCE) {
    return { ok: false as const, status: 400, error: "invalid_target" };
  }
  const scopes = parseOAuthScopes(p.get("scope") ?? "");
  if (scopes.length !== 1 || scopes[0] !== SCOPE) {
    return { ok: false as const, status: 400, error: "invalid_scope" };
  }
  return { ok: true as const, clientId, redirectUri, client };
}

export async function createLocalOAuthRouter() {
  cleanExpired();
  ensureBootstrapUser();
  const router = Router();
  const authMetadata = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    jwks_uri: `${ISSUER}/oauth/jwks.json`,
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
    const validation = await validateAuthorizationRequest(p);
    if (!validation.ok) return sendError(res, validation.status, validation.error, validation.description);
    const transaction = createAuthorizationTransaction(p);
    const userId = sessionUser(req);
    if (!userId) {
      res.type("html").send(loginPage(transaction));
      return;
    }
    res.type("html").send(page("Authorize access",
      "<p>Allow this client to access VPS monitoring and approved operations?</p>" +
      "<p><small>Permission: " + SCOPE + "</small></p>" +
      '<form method="post" action="/oauth/consent"><input type="hidden" name="transaction" value="' +
      htmlEscape(transaction) + '"><button>Allow access</button></form>'));
  });

  router.post("/oauth/login", async (req, res) => {
    if (!isSameOriginFormPost(req)) return sendError(res, 403, "access_denied", "Cross-origin form submission rejected");
    const transaction = String(req.body?.transaction ?? "");
    const p = readAuthorizationTransaction(transaction);
    if (!p) return sendError(res, 400, "invalid_request", "Authorization transaction is missing or expired");
    const validation = await validateAuthorizationRequest(p);
    if (!validation.ok) return sendError(res, validation.status, validation.error, validation.description);

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const attemptKey = hash(`${req.ip ?? "unknown"}|${email}`);
    const now = Math.floor(Date.now() / 1000);
    const attempt = db.prepare("SELECT failures,window_started,locked_until FROM login_attempts WHERE attempt_key=?").get(attemptKey) as
      { failures: number; window_started: number; locked_until: number | null } | undefined;
    if (attempt?.locked_until && attempt.locked_until > now) {
      res.status(429).type("html").send(loginPage(transaction, "Too many sign-in attempts. Try again later."));
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
      res.status(401).type("html").send(loginPage(transaction, "Invalid email or password."));
      return;
    }
    const consumed = consumeAuthorizationTransaction(transaction);
    if (!consumed) return sendError(res, 400, "invalid_request", "Authorization transaction was already used or expired");
    db.prepare("DELETE FROM login_attempts WHERE attempt_key=?").run(attemptKey);
    const session = randomToken();
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(hash(session), user.id, Math.floor(Date.now() / 1000) + SESSION_TTL);
    res.setHeader("Set-Cookie", `mcp_session=${encodeURIComponent(session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`);
    res.redirect(303, `/oauth/authorize?${consumed.toString()}`);
  });

  router.post("/oauth/consent", async (req, res) => {
    if (!isSameOriginFormPost(req)) return sendError(res, 403, "access_denied", "Cross-origin form submission rejected");
    const transaction = String(req.body?.transaction ?? "");
    const p = readAuthorizationTransaction(transaction);
    if (!p) return sendError(res, 400, "invalid_request", "Authorization transaction is missing or expired");
    const userId = sessionUser(req);
    if (!userId) {
      res.status(401).type("html").send(loginPage(transaction, "Your session expired. Sign in again."));
      return;
    }
    const validation = await validateAuthorizationRequest(p);
    if (!validation.ok) return sendError(res, validation.status, validation.error, validation.description);
    const consumed = consumeAuthorizationTransaction(transaction);
    if (!consumed) return sendError(res, 400, "invalid_request", "Authorization transaction was already used or expired");

    const code = randomToken();
    db.prepare("INSERT INTO auth_codes(code_hash,client_id,user_id,redirect_uri,challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(hash(code), validation.clientId, userId, validation.redirectUri, consumed.get("code_challenge"), RESOURCE, SCOPE, Math.floor(Date.now() / 1000) + CODE_TTL);
    const target = new URL(validation.redirectUri);
    target.searchParams.set("code", code);
    if (consumed.has("state")) target.searchParams.set("state", consumed.get("state") ?? "");
    else target.searchParams.delete("state");
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
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return sendError(res, 400, "invalid_grant");
      const now = Math.floor(Date.now() / 1000);
      // Consume only when every binding, including PKCE, matches. A bad verifier
      // must not burn a valid code, while concurrent exchanges remain atomic.
      const row = db.prepare("DELETE FROM auth_codes WHERE code_hash=? AND client_id=? AND redirect_uri=? AND resource=? AND challenge=? AND expires_at>=? RETURNING client_id,user_id,redirect_uri,challenge,resource,scope,expires_at")
        .get(hash(code), clientId, redirectUri, String(req.body?.resource ?? ""), pkceS256(verifier), now) as
        { client_id: string; user_id: string; redirect_uri: string; challenge: string; resource: string; scope: string; expires_at: number } | undefined;
      if (!row) return sendError(res, 400, "invalid_grant");
      const access = await new SignJWT({ scope: row.scope })
        .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid as string, typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(row.user_id).setAudience(row.resource)
        .setIssuedAt().setExpirationTime(`${ACCESS_TTL}s`).setJti(randomToken(16)).sign(signingKey);
      const refresh = randomToken();
      db.prepare("INSERT INTO refresh_tokens(token_hash,family_id,client_id,user_id,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?)")
        .run(hash(refresh), randomToken(16), clientId, row.user_id, row.resource, row.scope, Math.floor(Date.now() / 1000) + REFRESH_TTL);
      res.setHeader("Cache-Control", "no-store");
      res.json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: row.scope });
      return;
    }
    if (grant === "refresh_token") {
      const token = String(req.body?.refresh_token ?? "");
      const tokenHash = hash(token);
      const now = Math.floor(Date.now() / 1000);
      const row = db.prepare("UPDATE refresh_tokens SET used_at=? WHERE token_hash=? AND client_id=? AND expires_at>=? AND used_at IS NULL RETURNING family_id,client_id,user_id,resource,scope,expires_at")
        .get(now, tokenHash, clientId, now) as
        { family_id: string; client_id: string; user_id: string; resource: string; scope: string; expires_at: number } | undefined;
      if (!row) {
        const reused = db.prepare("SELECT family_id,client_id FROM refresh_tokens WHERE token_hash=?").get(tokenHash) as
          { family_id: string; client_id: string } | undefined;
        if (reused?.family_id && reused.client_id === clientId) {
          db.prepare("DELETE FROM refresh_tokens WHERE family_id=?").run(reused.family_id);
        }
        return sendError(res, 400, "invalid_grant");
      }
      const next = randomToken();
      db.prepare("INSERT INTO refresh_tokens(token_hash,family_id,client_id,user_id,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?)")
        .run(hash(next), row.family_id, clientId, row.user_id, row.resource, row.scope, Math.floor(Date.now() / 1000) + REFRESH_TTL);
      const access = await new SignJWT({ scope: row.scope })
        .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid as string, typ: "at+jwt" })
        .setIssuer(ISSUER).setSubject(row.user_id).setAudience(row.resource)
        .setIssuedAt().setExpirationTime(`${ACCESS_TTL}s`).setJti(randomToken(16)).sign(signingKey);
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
