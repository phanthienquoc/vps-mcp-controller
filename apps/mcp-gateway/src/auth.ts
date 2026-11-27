import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { RequestHandler } from "express";

export type OAuthConfig = {
  issuer: string;
  resource: string;
  requiredScopes: string[];
  jwks: ReturnType<typeof createRemoteJWKSet>;
};

export function tokenHasScopes(payload: JWTPayload, requiredScopes: string[]): boolean {
  const scopeClaim = typeof payload.scope === "string"
    ? payload.scope.split(/\s+/).filter(Boolean)
    : Array.isArray(payload.scp) && payload.scp.every((x) => typeof x === "string") ? payload.scp : [];
  return requiredScopes.every((scope) => scopeClaim.includes(scope));
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  return match?.[1] ?? null;
}

export function loadOAuthConfig(): OAuthConfig {
  const issuer = process.env.MCP_OAUTH_ISSUER ?? "https://mcp.mrcute.space";
  const resource = process.env.MCP_RESOURCE_URL ?? "https://mcp.mrcute.space/mcp";
  for (const [name, value] of [["MCP_OAUTH_ISSUER", issuer], ["MCP_RESOURCE_URL", resource]] as const) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error(`${name} must be an HTTPS URL without credentials or fragment`);
    }
  }
  const requiredScopes = ["mcp:tools"];
  const jwksUrl = new URL("/oauth/jwks.json", issuer);
  return {
    issuer,
    resource,
    requiredScopes,
    jwks: createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 }),
  };
}

export function protectedResourceMetadataUri(config: Pick<OAuthConfig, "resource">): string {
  const resource = new URL(config.resource);
  const resourcePath = resource.pathname === "/" ? "" : resource.pathname;
  return `${resource.origin}/.well-known/oauth-protected-resource${resourcePath}`;
}

export function createOAuthMiddleware(config: OAuthConfig): RequestHandler {
  const metadataUri = protectedResourceMetadataUri(config);
  const challenge = `Bearer resource_metadata="${metadataUri}", scope="${config.requiredScopes.join(" ")}"`;
  return async (req, res, next) => {
    const token = readBearerToken(req.header("authorization"));
    if (!token) {
      res.setHeader("WWW-Authenticate", challenge);
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const { payload } = await jwtVerify(token, config.jwks, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ["RS256"],
        maxTokenAge: "5m",
        clockTolerance: 5,
      });
      if (typeof payload.sub !== "string" || !payload.sub
          || typeof payload.iat !== "number" || typeof payload.exp !== "number"
          || payload.exp <= payload.iat || payload.exp - payload.iat > 300
          || !tokenHasScopes(payload, config.requiredScopes)) {
        throw new Error("Token claims rejected");
      }
      res.locals.oauth = { subject: payload.sub, scopes: config.requiredScopes };
      next();
    } catch {
      res.setHeader("WWW-Authenticate", `Bearer error="invalid_token", ${challenge.slice(7)}`);
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
