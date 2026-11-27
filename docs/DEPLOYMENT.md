# Production deployment runbook

This repository is **production-only**. There is no staging namespace, static bearer-token setup, or staging deployment path.

## Selected self-hosted authorization server: existing Keycloak

Reuse the existing Keycloak installation on `tce-k3s-01`; do not introduce another identity product or another database. Keycloak already provides OpenID Connect authorization-code flow, discovery metadata, JWKS and PKCE S256 support. Official docs: https://www.keycloak.org/securing-apps/oidc-layers and https://www.keycloak.org/docs/latest/server_admin/.

**Important existing blocker:** previous cluster diagnostics showed Keycloak database connection-pool checkout timeouts. Recover the existing Keycloak/Postgres connectivity before creating the MCP realm/client. Do not deploy a second Keycloak or switch its database as part of this change.

## Keycloak configuration

Create a dedicated realm, for example `mcp`, and a dedicated public OIDC client for ChatGPT MCP access:

- Realm issuer: `https://<KEYCLOAK_HOST>/realms/mcp`.
- Discovery URL: `https://<KEYCLOAK_HOST>/realms/mcp/.well-known/openid-configuration`.
- Client authentication: **Off** (public client).
- Standard flow: **On**.
- Direct access grants: **Off**.
- PKCE Code Challenge Method: **S256 required**.
- Valid redirect URIs: add only the exact callback URI supplied by ChatGPT during MCP connection setup; do not use wildcard redirects.
- Web origins: keep narrowly scoped; do not use `*`.
- Access token lifespan: **5 minutes**.
- Create a dedicated client scope/role named `mcp:tools` and assign it only to the intended user/client.
- Add an Audience mapper so the access token contains `aud: https://mcp.mrcute.space/mcp` exactly. Do not rely on the default `account` audience.
- Ensure the access token contains the `mcp:tools` scope claim. Keep unrelated realm/client roles out of this client.

Use Keycloak's public OIDC discovery document as the gateway metadata URL. The gateway verifies exact issuer, HTTPS authorization/token/JWKS endpoints, code flow, PKCE S256 and signed JWT claims.

## Gateway runtime values

- `MCP_OAUTH_ISSUER=https://<KEYCLOAK_HOST>/realms/mcp`
- `MCP_OAUTH_METADATA_URL=https://<KEYCLOAK_HOST>/realms/mcp/.well-known/openid-configuration`
- `MCP_RESOURCE_URL=https://mcp.mrcute.space/mcp`
- `MCP_OAUTH_REQUIRED_SCOPES=mcp:tools`

Replace `<KEYCLOAK_HOST>` with the real public HTTPS Keycloak hostname already configured in the cluster. Do not guess it. No Keycloak admin password, client secret or signing key belongs in Git, Kubernetes manifests or ChatGPT. The MCP client is public; the gateway validates access tokens using the realm's public JWKS.

## Revocation and session handling

Gateway JWT verification is stateless. Disabling a Keycloak user/session or revoking a refresh token does not invalidate an already-issued access JWT immediately; it remains usable until expiry. Keep access tokens at five minutes. For urgent revocation, also rotate the realm signing key or add an online token introspection check in a separately reviewed change. Do not claim immediate revocation from logout alone.

## Current release gate

Do not install the Root Agent or deploy the Gateway yet. First recover Keycloak's existing database connectivity, configure the dedicated realm/client, and verify discovery metadata and a real test token's issuer, audience, scope, signature and five-minute expiry. Automated provider-backed tests, independent security review and ChatGPT MCP interoperability checks remain mandatory.

Do not recreate `vps-mcp-secrets`, do not generate static bearer tokens, and do not dispatch the deploy workflow.

## VPS read-only preflight

After the repository change is merged, run only:

~~~bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
~~~

## Remaining production prerequisites

- Trusted root-owned checkout at `/opt/vps-mcp-controller`; deploy SSH user cannot write it.
- Dedicated non-root SSH deploy account; GitHub Actions is the only deployment path.
- Node.js 26 runtime isolated under the trusted checkout.
- k3s reachable, at least 2 GiB free, DNS `mcp.mrcute.space` correct, cert-manager issuer Ready and ingress TCP 80/443 reachable.
- GitHub Environment `tce-k3s-01` with `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT=22`; secrets `VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`, and read-only `GHCR_READ_TOKEN`.

Never send private keys, passwords, admin credentials or tokens through ChatGPT.

## Authorization gate

Only after Keycloak recovery, provider-backed tests, security review and ChatGPT MCP interoperability checks may the user authorize Root Agent installation and, separately, production deployment. A merged PR or successful CI is not deployment authorization.
