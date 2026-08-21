# Deploy — Phase 6 (final)

**Live:** https://web-ivory-five-41.vercel.app (frontend) · http://44.201.16.48:8080 (backend)

---

## Frontend → Vercel

`vercel.json` lives at the **repo root**, not inside `apps/web`. That matters:
deploying `vercel` from inside `apps/web` only uploads that subdirectory —
Vercel never sees `packages/*` or the root `package-lock.json`, so any
`installCommand` that tries `cd ../.. && npm install` fails (`npm error
Tracker "idealTree" already exists` was the actual error hit here, a
downstream symptom of the missing files, not a real npm bug). Always deploy
from the repo root:

```bash
npx vercel link      # links to the existing project if not already linked
npx vercel --prod
```

Root `vercel.json`:

```json
{
  "framework": "nextjs",
  "installCommand": "npm install",
  "buildCommand": "npm run build:packages && npm run build --workspace @threshold/web",
  "outputDirectory": "apps/web/.next"
}
```

`npm run build:packages` builds `@threshold/pipeline`, which — via TypeScript
project references — transitively builds every package it depends on (all 8),
in the correct order, from a single command. No env vars are needed by the
web app: it runs the pipeline in-process with synthetic data (see
`apps/web/app/actions.ts`), and never touches `FORTYGUARD_API_KEY`. Do not add
that key to Vercel — anything not prefixed `NEXT_PUBLIC_` still shouldn't be
handed to a service that has no reason to hold it, and this one has none.

---

## Backend → EC2 + PM2

**Live instance:** `i-0d46d46792af33019`, us-east-1, t3.micro (free-tier
eligible — no other project reuses it), Ubuntu 22.04, public IP
`44.201.16.48`. Security group `threshold-sg` (`sg-0177ca60c586ccc65`) opens
22 (SSH), 80 (reserved, unused), and 8080 (the API) to `0.0.0.0/0`. Key pair
`threshold`, private key kept at `.deploy/threshold.pem` — gitignored, never
committed.

Assumes Ubuntu 22.04+, Node 22, and the repo at `/opt/threshold`.

### One-time host setup

```bash
sudo mkdir -p /opt/threshold /var/log/threshold
sudo chown -R "$USER" /opt/threshold /var/log/threshold
npm install -g pm2
```

### Deploy

```bash
cd /opt/threshold
git pull
npm ci
npm run build:packages
npm run build --workspace @threshold/api
pm2 startOrReload apps/api/ecosystem.config.cjs
pm2 save
```

### Boot persistence

```bash
pm2 startup
```

then run the command it prints.

### Configuration

Create `/opt/threshold/.env` from `.env.example` and fill it in. It is read at
startup by `apps/api/src/index.ts`. It is gitignored and must never be committed.

```bash
chmod 600 /opt/threshold/.env
```

### Security group

Expose only what is needed: `8080` from the load balancer or your own IP, `22`
for SSH. Do not open `8080` to the world once real routes exist.

### Health checks

```bash
curl localhost:8080/health   # liveness
curl localhost:8080/ready    # config presence — booleans only, never values
```

---

## Database → Neon

Migrations are files under `db/migrations`, applied by `db/migrate.mts`. Never
apply schema changes by hand in the Neon SQL editor — the migration file is the
record, and the runner's checksum ledger will flag any file edited after it was
applied.

Get the connection string from the Neon console → Connection Details, and keep
`?sslmode=require`.

```bash
# Set NEON_DATABASE_URL in .env, then:
npm run db:migrate:dry     # what would apply
npm run db:migrate         # apply
npm run db:test            # assertion suite, rolled back automatically
```

`db:test` wraps everything in a transaction and rolls back, because `audit_log`
cannot be deleted from — fixture rows committed to a real database are there for
good. Don't reach for `--commit`.

**Pooled vs direct.** Neon offers both; the host contains `-pooler` for the
pooled one. Pooled is the right default for the API server, and it applies these
migrations fine — verified against live Neon — because each migration runs as a
single transaction, which pgbouncer's transaction mode supports. Switch to the
direct string if a migration ever needs session state to outlive a statement:
advisory locks, `SET LOCAL`, or `CREATE DATABASE`.

### Verifying without a Neon project

Neon is plain Postgres, so any local Postgres is a faithful target for the
migration and its test suite:

```bash
npm run db:migrate -- --url "postgresql://postgres:postgres@localhost:5432/threshold_verify"
```

What local *won't* exercise: TLS, the pooled connection string, and Neon
branching. Re-run the suite against a real Neon branch once before the Phase 4
deploy.
