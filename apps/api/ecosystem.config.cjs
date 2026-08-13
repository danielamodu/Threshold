/**
 * PM2 process definition for the Threshold API on EC2.
 *
 * Phase 0 deploy skeleton. Assumes the repo is checked out at /opt/threshold
 * and that `npm run build:packages && npm run build --workspace @threshold/api`
 * has produced apps/api/dist.
 *
 * Secrets are NOT defined here. `.env` at the repo root is read at startup and
 * is never committed — keep it out of this file so the config stays shareable.
 */

module.exports = {
  apps: [
    {
      name: 'threshold-api',
      cwd: '/opt/threshold/apps/api',
      script: 'dist/index.js',
      interpreter: 'node',

      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '512M',
      kill_timeout: 10000,

      env: {
        NODE_ENV: 'production',
        PORT: 8080,
        HOST: '0.0.0.0',
      },

      out_file: '/var/log/threshold/api.out.log',
      error_file: '/var/log/threshold/api.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
