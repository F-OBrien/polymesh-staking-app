/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  basePath: '/polymesh-staking-app',
  images: {
    loader: 'akamai',
    path: './',
  },
};

module.exports = nextConfig;
