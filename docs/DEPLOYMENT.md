# Production deployment runbook

This repository is **production-only**. There is no staging namespace, staging credential, static bearer-token setup, or staging deployment path.

## Current release gate

**Do not install the Root Agent or deploy the Gateway yet.** The Gateway currently has a static bearer-token verifier and does not implement OAuth 2.1/PKCE or MCP authorization metadata. That verifier is not acceptable for public ChatGPT production access. Production deployment remains blocked until a standards-compliant OAuth implementation is merged, tested, and reviewed.

In particular, do not create `vps-mcp-secrets`, do not run any command that generates `mcp-bearer-token`, and do not dispatch the deploy workflow. Renaming a static token does not make it production-safe.

## VPS read-only preflight

After the repository change is merged, run only the following read-only preflight command on `tce-k3s-01`:

~~~bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
~~~

It inspects host architecture, trusted checkout ownership, k3s access, disk, DNS, GHCR reachability and TLS prerequisites. It does not install software, change permissions, create secrets, restart services or apply manifests.

If the trusted checkout does not yet exist, stop and report that fact. Do not clone or install anything until the bootstrap step has been separately reviewed and authorized.

## Production prerequisites (once OAuth gate is cleared)

- Trusted root-owned checkout at `/opt/vps-mcp-controller`; deploy SSH user cannot write it.
- Dedicated non-root SSH deploy account; GitHub Actions is the only deployment path. `VPS_USER` in the GitHub Environment must be the same pre-created account supplied as `VPS_DEPLOY_USER` during bootstrap.
- Node.js 26 runtime isolated under the trusted checkout; no system-wide Node/npm requirement.
- k3s reachable, at least 2 GiB free on relevant filesystems, DNS `mcp.mrcute.space` pointing to the VPS.
- cert-manager ClusterIssuer `letsencrypt-prod` Ready; ingress TCP 80/443 reachable.
- GitHub Environment `tce-k3s-01` with `VPS_HOST`, a dedicated non-root `VPS_USER`, and `VPS_SSH_PORT=22`; secrets `VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`, and read-only `GHCR_READ_TOKEN`.
- Environment variable `MCP_OAUTH_PRODUCTION_READY=true`, set only after OAuth 2.1/PKCE, authorization metadata, token lifecycle, and independent security review are complete.
- Before publishing any image, the workflow verifies the pinned SSH host key, non-root remote UID, port 22, and a read-only `vps-mcp-deploy --preflight` check. That root-owned helper verifies the `tce-k3s-01` node, Root Agent/socket, isolated Node 26 runtime, root-owned non-writable checkout/manifests, ClusterIssuer, disk, and GHCR reachability.
- OAuth issuer/client registration, persistent authorization-code/session storage, signing key rotation, JWKS, short-lived scoped audience-bound tokens and revocation, all provisioned through a reviewed secret-management process.

After OAuth review and separate authorization for privileged bootstrap, install the Root Agent and deploy entrypoint with the pre-created account:

~~~bash
sudo VPS_DEPLOY_USER=<dedicated-non-root-user> bash /opt/vps-mcp-controller/scripts/install-root-agent.sh
~~~

This installs the isolated Node 26 runtime, Root Agent service, root-owned deploy entrypoint, and a command-scoped sudoers rule. It does not deploy the Gateway. The GitHub workflow's remote preflight must pass before image publication.

Never send private keys, passwords, client secrets or tokens through ChatGPT.

## Authorization gate

Only after OAuth 2.1/PKCE and metadata endpoints are implemented and independently reviewed may `MCP_OAUTH_PRODUCTION_READY` be set to `true`. The deploy workflow checks this gate before SSH setup or image publication. It then validates the exact target cluster and trusted deployment paths before publishing an image. Root Agent installation and production deployment remain separate authorized steps. A merged PR or successful CI is not deployment authorization.
