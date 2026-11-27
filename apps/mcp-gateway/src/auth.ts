import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { RequestHandler } from "express";

type AuthorizationServerMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  response_types_supported?: unknown;
  grant_types_supported?: unknown;
  code_challenge_methods_supported?: unknown;
};

export type OAuthConfig = {
  issuer: string;
  metadataUrl: string;
  resource: string;
  requiredScopes: string[];
  metadata: AuthorizationServerMetadata;
  jwks: ReturnType<typeof createRemoteJWKSet>;
};

function requiredHttpsUrl(name: string, value: string | undefined): URL {
  if (!value) throw new Error(`Missing required OAuth configuration: ${name}`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials or fragment`);
  }
  return url;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function tokenHasScopes(payload: JWTPayload, requiredScopes: string[]): boolean {
  const scopeClaim = typeof payload.scope === "string"
    ? payload.scope.split(/\\s+/).filter(Boolean)
    : isStringArray(payload.scp) ? payload.scp : [];
  return requiredScopes.every((scope) => scopeClaim.includes(scope));
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  return match?.[1] ?? null;
}

export async function loadOAuthConfig(): Promise<OAuthConfig> {
  const issuerUrl = requiredHttpsUrl("MCP_OAUTH_ISSUER", process.env.MCP_OAUTH_ISSUER);
  const metadataUrl = requiredHttpsUrl("MCP_OAUTH_METADATA_URL", process.env.MCP_OAUTH_METADATA_URL);
  const resourceUrl = requiredHttpsUrl(
    "MCP_RESOURCE_URL",
    process.env.MCP_RESOURCE_URL ?? "https://mcp.mrcute.space/mcp",
  );
  const issuer = issuerUrl.toString().replace(/\\/$/, "");
  const resource = resourceUrl.toString();
  const requiredScopes = (process.env.MCP_OAUTH_REQUIRED_SCOPES ?? "mcp:tools")
    .split(/\\s+/).filter(Boolean);
  if (requiredScopes.length === 0 || requiredScopes.some((scope) => !/^[A-Za-z0-9:._-]{1,80}$/.test(scope))) {
    throw new Error("MCP_OAUTH_REQUIRED_SCOPES contains an invalid scope");
  }

  const response = await fetch(metadataUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`OAuth metadata endpoint returned HTTP ${response.status}`);
  const metadata = await response.json() as AuthorizationServerMetadata;
  if (metadata.issuer !== issuer) throw new Error("OAuth metadata issuer does not exactly match MCP_OAUTH_ISSUER");
  if (typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") {
    throw new Error("OAuth metadata must publish authorization_endpoint and token_endpoint");
  }
  if (typeof metadata.jwks_uri !== "string") throw new Error("OAuth metadata must publish jwks_uri");
  if (!isStringArray(metadata.code_challenge_methods_supported)
      || !metadata.code_challenge_methods_supported.includes("S256")) {
    throw new Error("OAuth authorization server must advertise PKCE S256");
  }
  if (!isStringArray(metadata.response_types_supported)
      || !metadata.response_types_supported.includes("code")) {
    throw new Error("OAuth authorization server must support authorization code flow");
  }
  if (isStringArray(metadata.grant_types_supported)
      && !metadata.grant_types_supported.includes("authorization_code")) {
    throw new Error("OAuth authorization server does not support authorization_code grant");
  }
  const jwksUrl = requiredHttpsUrl("OAuth jwks_uri", metadata.jwks_uri);
  requiredHttpsUrl("OAuth authorization_endpoint", metadata.authorization_endpoint);
  requiredHttpsUrl("OAuth token_endpoint", metadata.token_endpoint);

  return {
    issuer,
    metadataUrl: metadataUrl.toString(),
    resource,
    requiredScopes,
    metadata,
    jwks: createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 }),
  };
}

export function createOAuthMiddleware(config: OAuthConfig): RequestHandler {
  return async (req, res, next) => {
    const token = readBearerToken(req.header("authorization"));
    if (!token) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${config.resource.replace(/\\/mcp$/, "")}/.well-known/oauth-protected-resource", scope="${config.requiredScopes.join(" ")}"`,
      );
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const { payload, protectedHeader } = await jwtVerify(token, config.jwks, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ["RS256", "PS256", "ES256", "EdDSA"],
        maxTokenAge: "15m",
        clockTolerance: 5,
      });
      if (protectedHeader.alg === "none" || !payload.sub || !payload.iat || !payload.exp
          || payload.exp <= payload.iat || payload.exp - payload.iat > 900
          || !tokenHasScopes(payload, config.requiredScopes)) {
        throw new Error("Token claims rejected");
      }
      res.locals.oauth = { subject: payload.sub, scopes: config.requiredScopes };
      next();
    } catch {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer error="invalid_token", resource_metadata="${config.resource.replace(/\\/mcp$/, "")}/.well-known/oauth-protected-resource", scope="${config.requiredScopes.join(" ")}"`,
      );
      res.status(401).json({ error: "invalid_token" });
    }
  };
}

export function protectedResourceMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: config.requiredScopes,
  };
}
