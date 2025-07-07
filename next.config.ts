import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Handle audio/video files
    config.module.rules.push({
      test: /\.(mp3|wav|m4a|aac|ogg|flac)$/,
      use: {
        loader: 'file-loader',
        options: {
          publicPath: '/_next/static/media/',
          outputPath: 'static/media/',
        },
      },
    })

    // Handle binary files for FFmpeg
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    }

    return config
  },
  // Turbopack configuration - handles audio files as static assets natively
  turbopack: {
    resolveExtensions: [
      '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
      '.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'
    ],
  },
  // Allow large file uploads
  serverRuntimeConfig: {
    maxFileSize: 500 * 1024 * 1024, // 500MB
  },
  publicRuntimeConfig: {
    maxFileSize: 500 * 1024 * 1024, // 500MB
  },
};

export default nextConfig;
