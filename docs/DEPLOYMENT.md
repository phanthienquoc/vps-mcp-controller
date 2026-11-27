# Production deployment runbook

This repository is **production-only**. There is no staging namespace, staging credential, static bearer-token setup, or staging deployment path.

## Current release gate

**Do not install the Root Agent or deploy the Gateway yet.** The gateway now implements the OAuth protected-resource side and refuses to start unless its configured authorization server publishes valid OAuth metadata with PKCE S256. Production deployment remains blocked until an external authorization server is selected, configured, tested and reviewed, and revocation behavior is addressed.

Do not create `vps-mcp-secrets`, do not generate a static bearer token, and do not dispatch the deploy workflow.

## VPS read-only preflight

After the repository change is merged, run only the following read-only preflight command on `tce-k3s-01`:

~~~bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
~~~

It inspects host architecture, trusted checkout ownership, k3s access, disk, DNS, GHCR reachability and TLS prerequisites. It does not install software, change permissions, create secrets, restart services or apply manifests.

## Authorization server setup required

Select an external OAuth 2.1 authorization server before configuring production. It must provide:

- RFC 8414 Authorization Server Metadata over HTTPS.
- Authorization Code grant for public clients and PKCE S256.
- Signed JWT access tokens with an HTTPS JWKS endpoint.
- A resource/audience claim exactly matching `https://mcp.mrcute.space/mcp`.
- A dedicated scope `mcp:tools`.
- Access tokens with a lifetime no longer than 15 minutes and signing-key rotation.
- A documented revocation or introspection capability; this gateway's current JWT verification is stateless and does not immediately revoke individual tokens.

Configure these non-secret runtime values after the provider is chosen:

- `MCP_OAUTH_ISSUER`: exact issuer value from provider metadata.
- `MCP_OAUTH_METADATA_URL`: provider's RFC 8414 metadata URL.
- `MCP_RESOURCE_URL`: `https://mcp.mrcute.space/mcp`.
- `MCP_OAUTH_REQUIRED_SCOPES`: `mcp:tools`.

Do not put provider client secrets, signing keys, passwords or tokens in Git, Kubernetes manifests or ChatGPT. If the provider needs a client secret for its own management API, keep it in that provider's secret manager; this gateway does not need a client secret to verify JWTs.

The provider must also be configured with the exact public callback/client registration requirements supplied by the MCP client. Do not guess or pre-register a ChatGPT redirect URI; obtain it from the actual ChatGPT OAuth registration flow or supported client metadata.

## Remaining production prerequisites

- Trusted root-owned checkout at `/opt/vps-mcp-controller`; deploy SSH user cannot write it.
- Dedicated non-root SSH deploy account; GitHub Actions is the only deployment path.
- Node.js 26 runtime isolated under the trusted checkout; no system-wide Node/npm requirement.
- k3s reachable, at least 2 GiB free on relevant filesystems, DNS `mcp.mrcute.space` pointing to the VPS.
- cert-manager ClusterIssuer `letsencrypt-prod` Ready; ingress TCP 80/443 reachable.
- GitHub Environment `tce-k3s-01` with `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT=22`; secrets `VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`, and read-only `GHCR_READ_TOKEN`.

Never send private keys, passwords, client secrets or tokens through ChatGPT.

## Authorization gate

Only after provider configuration, revocation design, automated tests, independent security review and ChatGPT MCP interoperability checks may the user authorize Root Agent installation and, separately, production deployment. A merged PR or successful CI is not deployment authorization.
