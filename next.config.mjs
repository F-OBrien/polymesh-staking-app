/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  images: {
    loader: 'akamai',
    path: '/',
  },
};

export default nextConfig;
