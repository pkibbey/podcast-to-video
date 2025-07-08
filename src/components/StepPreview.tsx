'use client'

import { ProcessingStep } from '@/types'
import { useState } from 'react'

interface StepPreviewProps {
  step: ProcessingStep;
  stepIndex: number;
}

function WaveformPreview({ waveformData }: { waveformData: number[] }) {
  if (!waveformData || waveformData.length === 0) return null;
  
  // Sample the waveform data for display (max 100 points)
  const sampleSize = Math.min(100, waveformData.length);
  const sampledData = [];
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.floor((i / sampleSize) * waveformData.length);
    sampledData.push(waveformData[index]);
  }
  
  const maxValue = Math.max(...sampledData);
  const normalizedData = sampledData.map(val => (val / maxValue) * 100);
  
  return (
    <div className="w-full h-16 bg-gray-900 rounded overflow-hidden flex items-end justify-center p-1">
      <div className="flex items-end space-x-0.5 h-full w-full">
        {normalizedData.map((height, index) => (
          <div
            key={index}
            className="bg-blue-400 min-w-[1px] flex-1"
            style={{ height: `${Math.max(2, height)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function TranscriptPreview({ transcript }: { transcript: any }) {
  if (!transcript || !transcript.segments) return null;
  
  // Show first few segments
  const previewSegments = transcript.segments.slice(0, 3);
  
  return (
    <div className="bg-gray-50 rounded p-2 text-xs">
      <div className="font-medium text-gray-700 mb-1">Transcript Preview:</div>
      {previewSegments.map((segment: any, index: number) => (
        <div key={index} className="text-gray-600 mb-1">
          <span className="text-blue-600 font-mono">
            {Math.floor(segment.start / 60)}:{(segment.start % 60).toFixed(0).padStart(2, '0')}
          </span>
          {' - '}
          {segment.text.length > 80 ? segment.text.substring(0, 80) + '...' : segment.text}
        </div>
      ))}
      {transcript.segments.length > 3 && (
        <div className="text-gray-500 italic">
          ...and {transcript.segments.length - 3} more segments
        </div>
      )}
    </div>
  );
}

function AudioPreview({ audioPath }: { audioPath: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="font-medium text-gray-700 mb-2 text-xs">Audio Preview:</div>
      <audio controls className="w-full h-8">
        <source src={`/api/preview-file?path=${encodeURIComponent(audioPath)}`} type="audio/wav" />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

function VideoPreview({ videoPath }: { videoPath: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="font-medium text-gray-700 mb-2 text-xs">Video Preview:</div>
      <video controls className="w-full max-h-32 rounded">
        <source src={`/api/preview-file?path=${encodeURIComponent(videoPath)}`} type="video/mp4" />
        Your browser does not support the video element.
      </video>
    </div>
  );
}

function MetadataPreview({ metadata }: { metadata: any }) {
  if (!metadata) return null;
  
  return (
    <div className="bg-gray-50 rounded p-2 text-xs text-gray-800">
      <div className="font-medium text-gray-700 mb-2">Generated Metadata:</div>
      <div className="space-y-1">
        <div>
          <span className="font-medium">Title:</span> {metadata.title}
        </div>
        <div>
          <span className="font-medium">Tags:</span> {metadata.tags?.join(', ')}
        </div>
        <div>
          <span className="font-medium">Description:</span> 
          <div className="text-gray-600 mt-1 max-h-16 overflow-y-auto">
            {metadata.description?.length > 200 
              ? metadata.description.substring(0, 200) + '...' 
              : metadata.description}
          </div>
        </div>
        {metadata.chapters && metadata.chapters.length > 0 && (
          <div>
            <span className="font-medium">Chapters:</span> {metadata.chapters.length} generated
          </div>
        )}
      </div>
    </div>
  );
}

export default function StepPreview({ step, stepIndex }: StepPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Don't show preview for pending or processing steps
  if (step.status !== 'completed' || !step.previewData) {
    return null;
  }
  
  const { previewData } = step;
  
  const renderPreviewContent = () => {
    switch (previewData.type) {
      case 'waveform':
        return previewData.content ? (
          <WaveformPreview waveformData={previewData.content as number[]} />
        ) : null;
        
      case 'transcript':
        return previewData.content ? (
          <TranscriptPreview transcript={previewData.content} />
        ) : null;
        
      case 'audio':
        return previewData.path ? (
          <AudioPreview audioPath={previewData.path} />
        ) : null;
        
      case 'video':
        return previewData.path ? (
          <VideoPreview videoPath={previewData.path} />
        ) : null;
        
      case 'metadata':
        return previewData.content ? (
          <MetadataPreview metadata={previewData.content} />
        ) : null;
        
      case 'text':
        return (
          <div className="bg-gray-50 rounded p-2 text-xs">
            <div className="text-gray-700">{previewData.content as string}</div>
          </div>
        );
        
      default:
        return null;
    }
  };
  
  const previewContent = renderPreviewContent();
  if (!previewContent) return null;
  
  return (
    <div className="mt-2 flex-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs text-blue-600 hover:text-blue-800 underline focus:outline-none"
      >
        {isExpanded ? 'Hide Preview' : 'Show Preview'} 📎
      </button>
      
      {isExpanded && (
        <div className="mt-2 border border-gray-200 rounded-lg p-2 bg-white">
          {previewContent}
        </div>
      )}
    </div>
  );
}
