'use client'

import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { ProcessingJob } from '@/types'

function AudioAnalysisDetails({ analysis }: { analysis: any }) {
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

function StepDetails({ step }: { step: any }) {
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

function StepExpand({ step }: { step: any }) {
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

  // If jobId is provided, fetch job on mount
  useEffect(() => {
    if (initialJobId) {
      setIsLoadingJob(true)
      fetch(`/api/progress/${initialJobId}`)
        .then(res => res.json())
        .then(job => {
          setProcessingJob(job.error ? null : job)
          setIsLoadingJob(false)
          if (!job.error && job.status !== 'completed' && job.status !== 'failed') {
            pollProgress(initialJobId)
          }
        })
        .catch(() => {
          setProcessingJob(null)
          setIsLoadingJob(false)
        })
    }
  }, [initialJobId])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setIsUploading(true)
    
    try {
      const formData = new FormData()
      formData.append('audio', file)

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

  const pollProgress = async (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/progress/${jobId}`)
        const job = await response.json()
        if (job.error) {
          clearInterval(interval)
          setProcessingJob(null)
          alert(job.error)
          return
        }
        setProcessingJob(job)
        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(interval)
        }
      } catch (error) {
        console.error('Progress polling error:', error)
        clearInterval(interval)
        setProcessingJob(null)
        alert('Progress polling failed. Please try again.')
      }
    }, 2000)
  }

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
      </div>

      {isLoadingJob && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-lg text-gray-700">Loading job...</p>
        </div>
      )}

      {!isLoadingJob && !processingJob && (
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
                  Supports MP3, WAV, M4A, AAC, OGG, FLAC (max 500MB)
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!isLoadingJob && processingJob && processingJob.status && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Processing</h2>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              processingJob.status === 'completed' ? 'bg-green-100 text-green-800' :
              processingJob.status === 'failed' ? 'bg-red-100 text-red-800' :
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

          <div className="space-y-3">
            {processingJob.steps.map((step, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    step.status === 'completed' ? 'bg-green-500' :
                    step.status === 'processing' ? 'bg-blue-500 animate-pulse' :
                    step.status === 'failed' ? 'bg-red-500' :
                    'bg-gray-300'
                  }`}></div>
                  <span className="text-sm font-medium text-gray-700">
                    {step.name}
                    {step.details && <StepExpand step={step} />}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{step.progress}%</span>
              </div>
            ))}
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

          {processingJob.status === 'failed' && (
            <div className="mt-6 p-4 bg-red-50 rounded-lg">
              <p className="text-red-800 font-medium mb-2">Processing failed</p>
              <p className="text-red-600 text-sm">{processingJob.error}</p>
              <button
                onClick={() => setProcessingJob(null)}
                className="mt-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          <AudioAnalysisDetails analysis={processingJob.audioAnalysis} />
        </div>
      )}
    </div>
  )
}
