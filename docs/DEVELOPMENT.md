# Development

## Requirements

Node.js 26 Active LTS, npm, and Linux for Root Agent integration testing.

## Install and validate

```bash
npm install
npm run check
npm run build
```

## Add a tool

1. Add a strict operation to packages/contracts.
2. Add a fixed-executable adapter in apps/root-agent.
3. Add a typed MCP tool to apps/mcp-gateway.
4. Update autonomous.yaml and SECURITY.md.
5. Add tests for valid/invalid input, denied operation, timeout, output limit and postcondition.
6. Update STATUS.md with evidence.

All ongoing work belongs on a dedicated feat/* branch, never master. Squash merge after verification.
