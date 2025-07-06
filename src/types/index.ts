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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  outputPath?: string;
  error?: string;
  steps: ProcessingStep[];
}

export interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
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
  thumbnail?: string;
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
