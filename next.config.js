/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  basePath: '/polymesh-staking-app',
  images: {
    loader: 'akamai',
    path: '/polymesh-staking-app',
  },
};

module.exports = nextConfig;
