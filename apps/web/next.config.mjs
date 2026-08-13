/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship as TypeScript source during development.
  transpilePackages: ['@threshold/types'],
};

export default nextConfig;
