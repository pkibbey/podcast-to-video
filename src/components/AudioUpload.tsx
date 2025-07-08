'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { ProcessingJob, ProcessingStep } from '@/types'
import { AudioAnalysis } from '@/utils/audioProcessing';
import { getPerformanceEstimates, getRecommendedMode } from '@/utils/performance'
import { VISUAL_PERFORMANCE_MODES, getPerformanceComparison, USAGE_RECOMMENDATIONS } from '@/constants/performance'
import type { VisualPerformanceMode } from '@/types'
import StepPreview from './StepPreview'

function AudioAnalysisDetails({ analysis }: { analysis: AudioAnalysis | undefined }) {
  if (!analysis) return null;
  // Heuristic: flag as suspicious if duration is 0, sampleRate < 4000, or channels < 1
  const suspicious = !analysis.duration || analysis.sampleRate < 4000 || analysis.channels < 1;
  return (
    <div className="mt-2 p-4 border rounded-lg bg-gray-50">
      <div className="font-semibold mb-2">Audio Analysis Details</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>Duration:</div><div>{analysis.duration.toFixed(2)}s</div>
        <div>Sample Rate:</div><div>{analysis.sampleRate} Hz</div>
        <div>Channels:</div><div>{analysis.channels}</div>
        <div>Bit Rate:</div><div>{analysis.bitRate} bps</div>
        <div>Format:</div><div>{analysis.format}</div>
      </div>
      {suspicious && (
        <div className="mt-2 text-yellow-700 bg-yellow-100 rounded p-2 text-xs">
          ⚠️ This result may be a false positive. Please check your audio file.
        </div>
      )}
    </div>
  )
}

function StepDetails({ step }: { step: ProcessingStep }) {
  if (!step.details) return null;
  if (step.name === 'Audio Analysis') {
    return <AudioAnalysisDetails analysis={step.details} />;
  }
  return (
    <div className="mt-2 p-4 border rounded-lg bg-gray-50 text-sm">
      <div className="font-semibold mb-2">{step.name} Details</div>
      <pre className="whitespace-pre-wrap">{JSON.stringify(step.details, null, 2)}</pre>
    </div>
  );
}

function StepExpand({ step }: { step: ProcessingStep }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="ml-2 text-blue-600 underline text-xs focus:outline-none"
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && <StepDetails step={step} />}
    </>
  )
}

export default function AudioUpload({ jobId: initialJobId }: { jobId?: string } = {}) {
  const [processingJob, setProcessingJob] = useState<ProcessingJob | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isLoadingJob, setIsLoadingJob] = useState(!!initialJobId)
  const [selectedVisualMode, setSelectedVisualMode] = useState<VisualPerformanceMode>('fast')
  const [showPerformanceDetails, setShowPerformanceDetails] = useState(false)
  
  // Store interval reference for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const pollProgress = useCallback(async (jobId: string) => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    
    console.log(`Starting progress polling for job: ${jobId}`)
    
    intervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/progress/${jobId}`)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const job = await response.json()
        setProcessingJob(job)
        
        // Stop polling if job is completed, failed, or if any step has failed
        const hasFailedStep = job.steps && job.steps.some((step: ProcessingStep) => step.status === 'failed')
        if (job.status === 'completed' || job.status === 'failed' || hasFailedStep) {
          console.log(`Stopping progress polling for job: ${jobId} (status: ${job.status})`)
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      } catch (error) {
        console.error('Progress polling error:', error)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        // Don't show alert for network errors, just stop polling
        console.warn('Progress polling stopped due to error')
      }
    }, 2000)
  }, [])

  // If jobId is provided, fetch job on mount
  useEffect(() => {
    if (initialJobId) {
      console.log(`Fetching job data for: ${initialJobId}`)
      setIsLoadingJob(true)
      fetch(`/api/progress/${initialJobId}`)
        .then(res => res.json())
        .then(job => {
          console.log(`Job data fetched for ${initialJobId}:`, job.status)
          setProcessingJob(job)
          setIsLoadingJob(false)
          if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'uploaded') {
            pollProgress(initialJobId)
          }
        })
        .catch((error) => {
          console.error(`Error fetching job ${initialJobId}:`, error)
          setProcessingJob(null)
          setIsLoadingJob(false)
        })
    }
  }, [initialJobId, pollProgress])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        console.log('Cleaning up progress polling interval')
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [])

  const startStep = async (stepIndex: number) => {
    if (!processingJob) return

    try {
      const response = await fetch(`/api/start-step/${processingJob.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stepIndex }),
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to start step')
        return
      }

      const result = await response.json()
      setProcessingJob(result.job)
      
      // Start polling for progress
      pollProgress(processingJob.id)
    } catch (error) {
      console.error('Step start error:', error)
      alert('Failed to start step. Please try again.')
    }
  }

  const startAllSteps = async () => {
    if (!processingJob) return

    try {
      const response = await fetch(`/api/restart-processing/${processingJob.id}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to start processing')
        return
      }

      const result = await response.json()
      setProcessingJob(result.job)
      
      // Start polling for progress
      pollProgress(processingJob.id)
    } catch (error) {
      console.error('Start all error:', error)
      alert('Failed to start processing. Please try again.')
    }
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setIsUploading(true)
    
    try {
      const formData = new FormData()
      formData.append('audio', file)
      formData.append('visualMode', selectedVisualMode)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()
      setProcessingJob(result.job)
      
      // Start polling for progress
      pollProgress(result.job.id)
    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']
    },
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB
    disabled: isUploading || processingJob?.status === 'processing'
  })

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Podcast to Video Converter
        </h1>
        <p className="text-gray-600">
          Upload your podcast audio file to generate a video with ambient visuals and subtitles
        </p>
        <p className="text-sm text-blue-600 mt-1">
          ⚡ Audio will be automatically trimmed to the first minute for faster processing
        </p>
      </div>

      {isLoadingJob && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-lg text-gray-700">Loading job...</p>
        </div>
      )}

      {!isLoadingJob && !processingJob && (
        <>
          {/* Performance Mode Selector */}
          <div className="mb-6 bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">⚡ Visual Generation Performance</h3>
            
            <div className="space-y-3 mb-4">
              {(Object.entries(VISUAL_PERFORMANCE_MODES) as [VisualPerformanceMode, typeof VISUAL_PERFORMANCE_MODES[VisualPerformanceMode]][]).map(([mode, config]) => (
                <label key={mode} className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="visualMode"
                    value={mode}
                    checked={selectedVisualMode === mode}
                    onChange={(e) => setSelectedVisualMode(e.target.value as VisualPerformanceMode)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 flex-1">
                      <span className="font-medium capitalize">{mode.replace('-', ' ')}</span>
                      {mode === 'fast' && <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Recommended</span>}
                      {mode === 'real-time' && <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Fastest</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{config.description}</p>
                  </div>
                </label>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowPerformanceDetails(!showPerformanceDetails)}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              {showPerformanceDetails ? 'Hide' : 'Show'} performance details
            </button>

            {showPerformanceDetails && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Performance Improvements</h4>
                <div className="text-sm space-y-1">
                  {Object.entries(getPerformanceComparison().improvements).map(([mode, improvement]) => (
                    <div key={mode} className="flex items-center space-x-2 flex-1">
                      <span className="capitalize font-medium w-20">{mode.replace('-', ' ')}:</span>
                      <span className="text-gray-600">{improvement}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {getPerformanceComparison().oldMethod}
                </p>
              </div>
            )}
          </div>

          {/* Upload Area */}
          <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="space-y-4">
            <div className="text-4xl">🎙️</div>
            {isUploading ? (
              <div>
                <p className="text-lg font-medium text-gray-700">Uploading...</p>
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse w-1/3"></div>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium text-gray-700">
                  {isDragActive ? 'Drop your audio file here' : 'Drag & drop an audio file here'}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  or click to select a file
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Supports MP3, WAV, M4A, AAC, OGG, FLAC (max 500MB) • First minute only
                </p>
              </div>
            )}
          </div>
        </div>  
        </>
      )}

      {!isLoadingJob && processingJob && processingJob.status && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h2 className="text-xl font-semibold text-gray-900">Processing</h2>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              processingJob.status === 'completed' ? 'bg-green-100 text-green-800' :
              processingJob.status === 'failed' ? 'bg-red-100 text-red-800' :
              processingJob.status === 'uploaded' ? 'bg-yellow-100 text-yellow-800' :
              'bg-blue-100 text-blue-800'
            }`}>
              {processingJob.status.charAt(0).toUpperCase() + processingJob.status.slice(1)}
            </span>
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Overall Progress</span>
              <span>{processingJob.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${processingJob.progress}%` }}
              ></div>
            </div>
          </div>

          {processingJob.status === 'uploaded' && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center space-x-2 flex-1">
                <div className="text-blue-600">ℹ️</div>
                <div>
                  <p className="text-blue-800 font-medium">Ready to process!</p>
                  <p className="text-blue-700 text-sm mt-1">
                    Your audio file has been uploaded and trimmed to the first minute. 
                    Click "Start Processing" below to generate your video.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Processing Steps</h3>
            {processingJob.status === 'uploaded' && (
              <button
                onClick={startAllSteps}
                className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-lg font-medium"
              >
                🚀 Start Processing
              </button>
            )}
            {processingJob.status !== 'completed' && processingJob.status !== 'uploaded' && processingJob.steps.some(step => step.status === 'pending') && (
              <button
                onClick={startAllSteps}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
              >
                Start All Remaining
              </button>
            )}
          </div>

          <div className="space-y-3">
            {processingJob.steps.map((step, index) => {
              const canStart = step.status === 'pending' && 
                (index === 0 || processingJob.steps[index - 1].status === 'completed')
              
              const stepDescriptions = [
                'Analyze audio properties and extract waveform data',
                'Convert speech to text with timestamps',
                'Generate ambient background music',
                'Create abstract visual animations',
                'Combine audio, visuals, and subtitles into video',
                'Generate YouTube-ready metadata and descriptions'
              ]
              
              return (
                <div key={index} className={`p-4 rounded-lg border transition-all ${
                  step.status === 'completed' ? 'bg-green-50 border-green-200' :
                  step.status === 'processing' ? 'bg-blue-50 border-blue-200' :
                  step.status === 'failed' ? 'bg-red-50 border-red-200' :
                  canStart ? 'bg-yellow-50 border-yellow-200' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 flex-1">
                      <div className={`w-4 h-4 rounded-full mt-0.5 ${
                        step.status === 'completed' ? 'bg-green-500' :
                        step.status === 'processing' ? 'bg-blue-500 animate-pulse' :
                        step.status === 'failed' ? 'bg-red-500' :
                        canStart ? 'bg-yellow-500' :
                        'bg-gray-300'
                      }`}></div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900">
                            {index + 1}. {step.name}
                          </span>
                          {step.status === 'processing' && (
                            <span className="text-xs text-blue-600 font-medium">Processing...</span>
                          )}
                          {step.status === 'completed' && (
                            <span className="text-xs text-green-600 font-medium">✓ Complete</span>
                          )}
                          {step.status === 'failed' && (
                            <span className="text-xs text-red-600 font-medium">✗ Failed</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mb-2">
                          {stepDescriptions[index]}
                        </p>
                        {step.status === 'failed' && step.error && (
                          <div className="mb-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
                            <div className="text-red-800 font-medium mb-1">❌ Step Failed</div>
                            <div className="text-red-700">{step.error}</div>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2 flex-1">
                            {canStart && (
                              <button
                                onClick={() => startStep(index)}
                                className="px-3 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                              >
                                Start Step
                              </button>
                            )}
                            {step.details && <StepExpand step={step} />}
                            <StepPreview step={step} stepIndex={index} />
                            {step.status === 'failed' && (
                              <button
                                onClick={() => startStep(index)}
                                className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                              >
                                Retry Step
                              </button>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 font-medium">{step.progress}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {processingJob.status === 'completed' && processingJob.outputPath && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg">
              <p className="text-green-800 font-medium mb-2">Video generated successfully!</p>
              <a
                href={processingJob.outputPath}
                download
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Download Video
              </a>
            </div>
          )}

          <AudioAnalysisDetails analysis={processingJob.audioAnalysis} />
        </div>
      )}
    </div>
  )
}
