# Production deployment runbook

Production-only. No Keycloak, no external identity provider and no static bearer-token mode.

## Self-hosted OAuth 2.1

The MCP Gateway hosts both the protected resource and a minimal authorization server at \`https://mcp.mrcute.space\`.

- OAuth authorization server metadata: \`/.well-known/oauth-authorization-server\`
- Protected resource metadata: \`/.well-known/oauth-protected-resource\`
- Authorization endpoint: \`/oauth/authorize\`
- Token endpoint: \`/oauth/token\`
- DCR endpoint: \`/oauth/register\`
- JWKS endpoint: \`/oauth/jwks.json\`
- Revocation endpoint: \`/oauth/revoke\`

Authorization Code + PKCE S256 is required. ChatGPT's DCR flow is supported; CIMD is deliberately not advertised in this first version. Public clients use token endpoint auth method \`none\`. The resource parameter must equal \`https://mcp.mrcute.space/mcp\` and is copied into JWT audience.

## Required Kubernetes Secret

Create the Secret \`mcp-oauth-secrets\` in namespace \`ops-prod\` through the approved secret-provisioning path (never commit it):

- \`MCP_BOOTSTRAP_EMAIL\`: initial admin login email.
- \`MCP_BOOTSTRAP_PASSWORD\`: strong initial password, at least 14 characters.
- \`MCP_OAUTH_SIGNING_PRIVATE_KEY\`: PEM-encoded RSA private key (PKCS#8, RSA 2048-bit minimum; 3072-bit recommended).
- \`MCP_OAUTH_SIGNING_KID\`: stable key identifier, e.g. \`mcp-rsa-2026-01\`.

The app hashes the bootstrap password with scrypt and stores the account in SQLite on persistent storage. The bootstrap user is created only if the email does not already exist; changing the environment password does not overwrite an existing account. Signing key rotation must retain the previous public key during the maximum token lifetime and is a separate reviewed operation.

## Persistent data

The deployment mounts a persistent volume claim \`mcp-auth-data\` at \`/var/lib/vps-mcp-auth\`. SQLite stores users, registered OAuth clients, sessions, authorization codes and refresh-token families. Do not run more than one gateway replica against this SQLite database. The deployment strategy is Recreate.

## Important implementation limitations / security gates

- Login uses a single bootstrap administrator account. User creation, password reset/change UI, multi-user administration and MFA are not implemented.
- Login attempts are throttled by IP/email in SQLite. Place the service behind the existing trusted HTTPS ingress and preserve a trustworthy client IP policy; do not blindly trust user-supplied forwarded headers.
- DCR accepts HTTPS redirect URIs only and stores exact URI matches. The initial ChatGPT integration must be verified against the actual callback URI.
- CIMD and \`private_key_jwt\` are not advertised or supported; the authorization server advertises DCR and public-client \`none\`.
- Access JWTs last five minutes. Revoking refresh tokens does not immediately invalidate already-issued access tokens; they expire within five minutes.
- Refresh tokens rotate on every use; reuse of a consumed token revokes its family.
- Signing private key and bootstrap password are runtime secrets only; never put them in Git, ConfigMaps, command history or chat.

## Before deployment

The PR must pass Node 26 typecheck/build/tests, an OAuth protocol/security review and an end-to-end ChatGPT MCP authorization test. Confirm persistent volume availability and provision the Kubernetes Secret out of band. Do not install the Root Agent or deploy until separately authorized.

## Existing VPS preflight

\`\`\`bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
\`\`\`

This command is read-only. No production workload changes are authorized by merging this PR.
