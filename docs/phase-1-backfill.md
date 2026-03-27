# Phase 1 Backfill

This step copies legacy JSON data from `data/*.json` into PostgreSQL so the app can move toward pure DB mode.

## What it imports
- users
- workspace settings
- custom domains
- sessions
- links
- click analytics
- pages/forms
- form submissions

## Run locally
```powershell
npm run db:backfill
```

## Run on Railway
If your app service already has `DATABASE_URL=${{Postgres.DATABASE_URL}}`, open the Railway deploy environment and run:
```bash
npm run db:backfill
```

## Notes
- The script is safe for repeated use in most cases because it uses upserts where possible.
- Existing click events and form submissions are skipped when the same IDs already exist.
- Missing files such as `data/pages.json` are treated as empty.
- After backfill succeeds, we can remove JSON fallback route-by-route.

## Cutover
After you confirm data is present in PostgreSQL and the app is working, set `DB_ONLY_MODE=true` in Railway to stop using JSON fallback for migrated areas.
