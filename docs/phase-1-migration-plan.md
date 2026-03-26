# Phase 1 Migration Plan

## Goal
Move AnyLink from file-based storage to PostgreSQL with Prisma, then layer in Stripe billing and email delivery.

## Step 1: Prisma + PostgreSQL bootstrap
- Add `DATABASE_URL` to environment variables
- Run `npm install`
- Run `npx prisma generate`
- Run `npx prisma migrate dev --name init`

## Step 2: Replace JSON-backed auth
Replace these current file-backed modules first:
- users
- sessions
- auth tokens
- workspace settings

Priority routes:
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/profile`
- `POST /api/auth/change-password`
- forgot/reset/verify flows

## Step 3: Replace links + domains
Move these to Prisma next:
- links
- custom domains
- workspace default domain

Priority routes:
- `GET /api/links`
- `POST /api/links`
- `DELETE /api/links/:slug`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/domains/verify/:domain`

## Step 4: Replace forms + submissions
Move:
- pages
- page fields
- form submissions

Priority routes:
- `GET /api/pages`
- `POST /api/pages`
- `DELETE /api/pages/:id`
- `GET /forms/:slug`
- `POST /api/forms/:slug/submit`
- `GET /api/pages/:id/export`

## Step 5: Replace analytics
Move click tracking from embedded link JSON into:
- `click_events`
- aggregated link counters

Priority routes:
- redirect route `/:slug`
- `GET /api/analytics`
- `GET /api/analytics/export`

## Step 6: Billing and emails
After DB migration is stable:
- add Stripe customers + subscriptions
- add Stripe webhooks
- add email provider for verification/reset/billing

## Recommended implementation order in code
1. Create `lib/prisma.js`
2. Build `repositories/` for database access
3. Migrate auth handlers
4. Migrate links/settings handlers
5. Migrate pages/submissions handlers
6. Migrate analytics handlers
7. Remove JSON storage helpers only after parity is confirmed

## Important note
Do not remove `data/*.json` fallback until:
- Prisma schema is migrated
- login works
- links create and redirect work
- form submissions save correctly
- analytics click tracking works
