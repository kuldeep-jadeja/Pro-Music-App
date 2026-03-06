/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PWA is handled via a hand-written service worker in /public/sw.js
  // (avoids Turbopack ↔ webpack incompatibility with next-pwa)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'mosaic.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'image-cdn-ak.spotifycdn.com',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
  },
};

export default nextConfig;
