/**
 * Performance comparison and recommendations for podcast-to-video generation
 */

import { VISUAL_PERFORMANCE_MODES } from '@/constants/performance';
import type { VisualPerformanceMode } from '@/types';

export interface PerformanceEstimate {
  mode: VisualPerformanceMode;
  estimatedTime: string;
  quality: 'Low' | 'Medium' | 'High' | 'Ultra High';
  fileSize: string;
  description: string;
  recommended: boolean;
}

/**
 * Get performance estimates for different visual modes
 * Note: Audio is always trimmed to first minute (60 seconds)
 * @param durationMinutes - Original duration of the podcast in minutes (for reference)
 */
export function getPerformanceEstimates(durationMinutes: number): PerformanceEstimate[] {
  const estimates: PerformanceEstimate[] = [];
  
  // Since we always trim to 1 minute, use fixed processing time
  const actualDuration = 1; // Always 1 minute due to trimming
  
  // Rough estimates based on typical hardware performance
  // These are conservative estimates and actual performance may be better
  const baseProcessingRatio = {
    'real-time': 0.3,    // Process 30% faster than audio duration (2x faster than old method)
    'fast': 0.5,         // Process 50% of audio duration (4x faster than old method)  
    'balanced': 0.8,     // Process 80% of audio duration (2.5x faster than old method)
    'quality': 1.5       // Process 1.5x audio duration (similar to old method but better quality)
  };

  const qualityMap = {
    'real-time': 'Low' as const,
    'fast': 'Medium' as const,
    'balanced': 'High' as const,
    'quality': 'Ultra High' as const
  };

  const fileSizeMultiplier = {
    'real-time': 0.3,
    'fast': 0.5,
    'balanced': 0.8,
    'quality': 1.2
  };

  for (const [mode, config] of Object.entries(VISUAL_PERFORMANCE_MODES)) {
    const modeKey = mode as VisualPerformanceMode;
    const processingMinutes = actualDuration * baseProcessingRatio[modeKey];
    const estimatedMB = Math.round(actualDuration * 15 * fileSizeMultiplier[modeKey]); // ~15MB per minute baseline
    
    estimates.push({
      mode: modeKey,
      estimatedTime: formatTime(processingMinutes),
      quality: qualityMap[modeKey],
      fileSize: `~${estimatedMB}MB`,
      description: config.description,
      recommended: modeKey === 'fast' || modeKey === 'balanced'
    });
  }

  return estimates;
}

/**
 * Get the recommended mode based on use case
 * Note: Since audio is always trimmed to 1 minute, duration doesn't affect recommendation
 */
export function getRecommendedMode(durationMinutes: number, prioritizeSpeed = true): VisualPerformanceMode {
  // Since we're always processing 1 minute, recommend based on quality vs speed preference
  if (prioritizeSpeed) {
    return 'fast'; // Good balance of speed and quality for 1-minute videos
  } else {
    return 'balanced'; // Better quality while still being reasonably fast for 1-minute videos
  }
}

/**
 * Format time in minutes to human readable format
 */
function formatTime(minutes: number): string {
  if (minutes < 1) {
    return `${Math.round(minutes * 60)} seconds`;
  } else if (minutes < 60) {
    return `${Math.round(minutes)} minutes`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours}h ${remainingMinutes}m`;
  }
}
