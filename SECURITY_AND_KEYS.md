# Security and API Key Notes

## Environment files

Do not commit real environment files or production secrets to the repository. This repo includes:

```text
frontend/.env.example
```

Use it as a template only. Each deployment should provide its own real environment values outside version control.

## MapTiler API key

Conductor Web uses a frontend-visible MapTiler key. In browser applications, this kind of key will be visible to users through the compiled JavaScript bundle and network requests. That is normal for client-side map apps, but the key must be restricted.

Recommended controls:

- Restrict the key to allowed production domains.
- Use separate keys for local development, staging, demos, and production.
- Rotate the key if it has been shared in a zip, committed to git, or sent to a third party.
- Monitor usage for abnormal traffic.
- Do not use a high-privilege account key in the frontend.

## Repository hygiene

Before pushing or sharing the repo, confirm that these are not included:

- `.env` or `.env.*` files containing real secrets.
- `.git` folders from exported zips.
- `node_modules/`.
- Python `venv/` folders.
- `__pycache__/` files.
- Customer data, real premises data, live network data, credentials, tokens, or API logs.

## Build/deployment recommendation

For commercial deployments, prefer environment variables managed by the host/platform rather than committed config files.
