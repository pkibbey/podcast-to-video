import { ProcessingJob } from '@/types'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { analyzeAudio, transcribeAudio, generateSRT, convertToWav, extractWaveform } from '@/utils/audioProcessing'
import fs from 'fs'

const JOBS_PATH = path.join(process.cwd(), 'jobs.json');

function loadJobsSync(): Map<string, ProcessingJob> {
  try {
    const data = JSON.parse(require('fs').readFileSync(JOBS_PATH, 'utf-8'))
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

export const jobs = loadJobsSync()

export async function saveJobs() {
  const obj: Record<string, ProcessingJob> = {}
  for (const [k, v] of jobs.entries()) obj[k] = v
  await writeFile(JOBS_PATH, JSON.stringify(obj, null, 2), 'utf-8')
}

export async function loadJobs() {
  try {
    const data = await readFile(JOBS_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    jobs.clear()
    for (const [k, v] of Object.entries(parsed)) jobs.set(k, v as ProcessingJob)
  } catch {}
}

export async function updateJobStep(jobId: string, stepIndex: number, status: 'processing' | 'completed' | 'failed') {
  const job = jobs.get(jobId)
  if (!job) return

  job.steps[stepIndex].status = status
  job.steps[stepIndex].progress = status === 'completed' ? 100 : status === 'processing' ? 50 : 0
  if (status === 'processing') {
    job.steps[stepIndex].startedAt = new Date()
  } else if (status === 'completed') {
    job.steps[stepIndex].completedAt = new Date()
  }
  // Update overall progress
  const completedSteps = job.steps.filter(step => step.status === 'completed').length
  job.progress = Math.round((completedSteps / job.steps.length) * 100)
  jobs.set(jobId, job)
  await saveJobs()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function processAudioFile(jobId: string) {
  const job = jobs.get(jobId)
  if (!job) return
  job.status = 'processing'
  jobs.set(jobId, job)
  await saveJobs()
  try {
    // Find the step that is 'processing', or the first incomplete step
    let startStep = job.steps.findIndex(s => s.status === 'processing')
    if (startStep === -1) {
      startStep = job.steps.findIndex(s => s.status !== 'completed')
    }
    for (let i = startStep; i < job.steps.length; i++) {
      const step = job.steps[i]
      if (step.status === 'completed') continue
      if (i === 0) { // Audio Analysis
        await updateJobStep(jobId, 0, 'processing')
        const audioAnalysis = await analyzeAudio(job.audioFile.path)
        job.audioFile.duration = audioAnalysis.duration
        const waveformData = await extractWaveform(job.audioFile.path)
        audioAnalysis.waveformData = waveformData
        job.audioAnalysis = audioAnalysis
        job.steps[0].details = {
          duration: audioAnalysis.duration,
          sampleRate: audioAnalysis.sampleRate,
          channels: audioAnalysis.channels,
          bitRate: audioAnalysis.bitRate,
          format: audioAnalysis.format,
        }
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 0, 'completed')
      } else if (i === 1) { // Transcription
        await updateJobStep(jobId, 1, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const wavPath = path.join(tempDir, `${jobId}-audio.wav`)
        await convertToWav(job.audioFile.path, wavPath)
        const transcript = await transcribeAudio(wavPath)
        job.steps[1].details = { segmentCount: transcript.segments.length, language: transcript.language, duration: transcript.duration }
        const srtPath = path.join(tempDir, `${jobId}-subtitles.srt`)
        await generateSRT(transcript, srtPath)
        await updateJobStep(jobId, 1, 'completed')
      } else if (i === 2) { // Music Generation (stub)
        await updateJobStep(jobId, 2, 'processing')
        await sleep(1000)
        job.steps[2].details = { info: 'Ambient music generated (stub)' }
        await updateJobStep(jobId, 2, 'completed')
      } else if (i === 3) { // Visual Generation (stub)
        await updateJobStep(jobId, 3, 'processing')
        await sleep(1000)
        job.steps[3].details = { info: 'Abstract visuals generated (stub)' }
        await updateJobStep(jobId, 3, 'completed')
      } else if (i === 4) { // Video Assembly (stub)
        await updateJobStep(jobId, 4, 'processing')
        await sleep(1000)
        job.steps[4].details = { info: 'Video assembled (stub)' }
        await updateJobStep(jobId, 4, 'completed')
      } else if (i === 5) { // Metadata Generation (stub)
        await updateJobStep(jobId, 5, 'processing')
        await sleep(500)
        job.steps[5].details = { info: 'Metadata generated (stub)' }
        await updateJobStep(jobId, 5, 'completed')
      }
    }
    // Complete job
    job.status = 'completed'
    job.progress = 100
    job.completedAt = new Date()
    job.outputPath = `/api/download/${jobId}`
    jobs.set(jobId, job)
    await saveJobs()
  } catch (error: any) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : 'Unknown error'
    jobs.set(jobId, job)
    await saveJobs()
  }
}

// On module load, resume any jobs in processing state
;(async () => {
  for (const [jobId, job] of jobs.entries()) {
    if (job.status === 'processing' || job.steps.some(s => s.status === 'processing')) {
      // Resume processing in background
      processAudioFile(jobId)
    }
  }
})()
