import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship as TypeScript source during development.
  transpilePackages: ['@threshold/types'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
