/**
 * Client-safe constants for visual performance modes
 * This file can be imported by both client and server components
 */

import type { VisualPerformanceMode } from '@/types'

export const VISUAL_PERFORMANCE_MODES = {
  'real-time': {
    width: 640,
    height: 360,
    fps: 15,
    preset: 'ultrafast' as const,
    quality: 'draft' as const,
    chunkDuration: 15,
    description: 'Fastest generation, lowest quality (15 FPS, 360p)'
  },
  'fast': {
    width: 854,
    height: 480,
    fps: 24,
    preset: 'ultrafast' as const,
    quality: 'draft' as const,
    chunkDuration: 20,
    description: 'Fast generation, medium quality (24 FPS, 480p)'
  },
  'balanced': {
    width: 1280,
    height: 720,
    fps: 24,
    preset: 'fast' as const,
    quality: 'medium' as const,
    chunkDuration: 20,
    description: 'Balanced speed and quality (24 FPS, 720p)'
  },
  'quality': {
    width: 1920,
    height: 1080,
    fps: 30,
    preset: 'medium' as const,
    quality: 'high' as const,
    chunkDuration: 30,
    description: 'High quality, slower generation (30 FPS, 1080p)'
  }
} as const;

export const DEFAULT_VISUAL_MODE: VisualPerformanceMode = 'fast';

/**
 * Performance comparison with the old method
 */
export function getPerformanceComparison(): {
  oldMethod: string;
  improvements: Record<VisualPerformanceMode, string>;
} {
  return {
    oldMethod: "Previous method: ~2-3x audio duration (very slow for long podcasts)",
    improvements: {
      'real-time': "🚀 Up to 6x faster - Near real-time generation",
      'fast': "⚡ Up to 4x faster - Good balance of speed and quality", 
      'balanced': "🎯 Up to 2.5x faster - Best overall experience",
      'quality': "✨ Similar speed but better quality and reliability"
    }
  };
}

/**
 * Usage examples and recommendations
 */
export const USAGE_RECOMMENDATIONS = {
  'real-time': {
    bestFor: ['Testing', 'Previews', 'Very long podcasts (60+ minutes)', 'Live processing'],
    avoid: ['Final production', 'Social media posts', 'Professional content']
  },
  'fast': {
    bestFor: ['Most podcasts', 'Quick turnaround', 'Social media content', 'Regular production'],
    avoid: ['Premium content requiring highest quality']
  },
  'balanced': {
    bestFor: ['Professional content', 'YouTube uploads', 'Marketing materials', 'High-quality previews'],
    avoid: ['Ultra-fast processing needs', 'Very long content (60+ minutes)']
  },
  'quality': {
    bestFor: ['Premium content', 'Professional presentations', 'Marketing videos', 'Short podcasts'],
    avoid: ['Long podcasts', 'Quick testing', 'Bulk processing']
  }
};
