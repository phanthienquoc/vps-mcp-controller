# Operations and recovery

## Automatic

- Read host status, journal entries and pod inventory.
- Inspect allowlisted systemd units.
- Restart cron or vps-root-agent.
- Restart a deployment only in ops-prod or tce-prod and verify rollout status.

## Not enabled

- Restarting k3s or containerd systemd services.
- Changes to stock-prod or media-prod.
- Docker/container restarts or image pruning.
- Arbitrary manifest apply, resource deletion or filesystem writes.
- Database writes, destructive SQL, backup deletion.
- Firewall and SSH changes, credential rotation.

## Incident loop

1. Gather host and cluster status.
2. Read the relevant logs.
3. Classify root cause and select a typed operation.
4. Execute only if policy allows it.
5. Verify a service health/postcondition.
6. If verification fails, stop automatic retries and report recovery options.

## Audit

Gateway and agent emit JSON-line events to stdout. Gateway events are collected from Kubernetes logs; host-agent events from journalctl -u vps-root-agent. Durable tamper-evident retention and alerting are production follow-up requirements.
