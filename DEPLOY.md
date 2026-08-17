# Deploy — Phase 0 skeletons

Both targets are stubs. They exist so there is a real deploy path before Phase 1,
not because anything meaningful is being served yet.

---

## Frontend → Vercel

`apps/web/vercel.json` is committed. In the Vercel project settings:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Include files outside root directory | **enabled** (the workspace packages live above it) |
| Framework preset | Next.js |
| Node version | 22.x |

Install and build commands come from `vercel.json` — they step up to the repo root
so `@threshold/types` is built before `next build` runs.

```bash
npx vercel link
npx vercel --prod
```

No environment variables are needed by the web app in Phase 0. Do not add
`FORTYGUARD_API_KEY` to Vercel — the key belongs to the backend only, and
anything prefixed `NEXT_PUBLIC_` is shipped to the browser.

---

## Backend → EC2 + PM2

Assumes Amazon Linux 2023 or Ubuntu 22.04+, Node 22, and the repo at
`/opt/threshold`.

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
