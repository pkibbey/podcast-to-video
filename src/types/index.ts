import type { AudioAnalysis } from '@/utils/audioProcessing'

// Visual performance modes for video generation
export type VisualPerformanceMode = 'real-time' | 'fast' | 'balanced' | 'quality';

// Types for the podcast-to-video application
export interface AudioFile {
  id: string;
  name: string;
  path: string;
  duration: number;
  format: string;
  size: number;
  uploadedAt: Date;
}

export interface ProcessingJob {
  id: string;
  audioFile: AudioFile;
  status: 'uploaded' | 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  outputPath?: string;
  error?: string;
  steps: ProcessingStep[];
  audioAnalysis?: AudioAnalysis;
  transcript?: Transcript;
  metadata?: VideoMetadata;
  visualMode?: VisualPerformanceMode;
}

export interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  details?: any;
  previewData?: {
    type: 'waveform' | 'transcript' | 'audio' | 'video' | 'text' | 'metadata';
    content?: string | number[] | object;
    path?: string;
    thumbnail?: string;
    duration?: number;
  };
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Transcript {
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
}

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  chapters: Array<{ time: number; title: string }>;
  thumbnail: string;
  duration: number;
  resolution: {
    width: number;
    height: number;
  };
}

export interface VisualConfig {
  particleCount: number;
  colors: string[];
  animationSpeed: number;
  responseToAudio: boolean;
}

export interface AudioConfig {
  ambientMusicVolume: number;
  duckingIntensity: number;
  musicStyle: 'ambient' | 'lo-fi' | 'nature' | 'electronic';
}
