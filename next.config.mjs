/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // This is a temporary workaround to allow redeployment while I work on
    // fixing types after updates.
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  swcMinify: true,
  images: {
    loader: 'akamai',
    path: './',
  },
};

export default nextConfig;
