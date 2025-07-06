import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { AudioFile, ProcessingJob } from '@/types'
import { jobs } from '@/utils/jobs'
import { analyzeAudio, transcribeAudio, generateSRT, convertToWav, extractWaveform } from '@/utils/audioProcessing'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    // Validate file size (500MB max)
    const maxSize = 500 * 1024 * 1024 // 500MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 })
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'uploads')
    try {
      await mkdir(uploadsDir, { recursive: true })
    } catch (_error) {
      // Directory might already exist
      console.log('Upload directory already exists')
    }

    // Save file
    const fileId = uuidv4()
    const fileName = `${fileId}-${file.name}`
    const filePath = path.join(uploadsDir, fileName)
    
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    await writeFile(filePath, buffer)

    // Create audio file object
    const audioFile: AudioFile = {
      id: fileId,
      name: file.name,
      path: filePath,
      duration: 0, // Will be determined during processing
      format: file.type,
      size: file.size,
      uploadedAt: new Date(),
    }

    // Create processing job
    const jobId = uuidv4()
    const processingJob: ProcessingJob = {
      id: jobId,
      audioFile,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      steps: [
        { name: 'Audio Analysis', status: 'pending', progress: 0 },
        { name: 'Transcription', status: 'pending', progress: 0 },
        { name: 'Music Generation', status: 'pending', progress: 0 },
        { name: 'Visual Generation', status: 'pending', progress: 0 },
        { name: 'Video Assembly', status: 'pending', progress: 0 },
        { name: 'Metadata Generation', status: 'pending', progress: 0 },
      ],
    }

    // Store job
    jobs.set(jobId, processingJob)

    // Start processing in background
    processAudioFile(jobId).catch(error => {
      console.error('Processing error:', error)
      const job = jobs.get(jobId)
      if (job) {
        job.status = 'failed'
        job.error = error.message
        jobs.set(jobId, job)
      }
    })

    return NextResponse.json({ 
      success: true, 
      job: processingJob 
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

async function processAudioFile(jobId: string) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  jobs.set(jobId, job)

  try {
    // Step 1: Audio Analysis
    await updateJobStep(jobId, 0, 'processing')
    console.log(`Starting audio analysis for job ${jobId}`)
    try {
      const audioAnalysis = await analyzeAudio(job.audioFile.path)
      job.audioFile.duration = audioAnalysis.duration
      const waveformData = await extractWaveform(job.audioFile.path)
      audioAnalysis.waveformData = waveformData
      // Store analysis in job for frontend access
      job.audioAnalysis = audioAnalysis
      jobs.set(jobId, job)
      console.log(`Audio analysis completed: ${audioAnalysis.duration}s, ${audioAnalysis.format}`)
      await updateJobStep(jobId, 0, 'completed')
    } catch (error) {
      console.error(`Audio analysis failed for job ${jobId}:`, error)
      await updateJobStep(jobId, 0, 'failed')
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Audio analysis failed'
      jobs.set(jobId, job)
      return
    }

    // Step 2: Transcription
    await updateJobStep(jobId, 1, 'processing')
    console.log(`Starting transcription for job ${jobId}`)
    try {
      const tempDir = path.join(process.cwd(), 'temp')
      const wavPath = path.join(tempDir, `${jobId}-audio.wav`)
      console.log(`[${jobId}] Converting audio to WAV for Whisper...`)
      await convertToWav(job.audioFile.path, wavPath)
      console.log(`[${jobId}] Starting Whisper transcription...`)
      const transcript = await transcribeAudio(wavPath, (msg: string) => console.log(`[${jobId}] Whisper:`, msg))
      console.log('transcript: ', transcript)
      const srtPath = path.join(tempDir, `${jobId}-subtitles.srt`)
      console.log('srtPath: ', srtPath)
      await generateSRT(transcript, srtPath)
      console.log(`[${jobId}] Transcription completed: ${transcript.segments.length} segments`)
      await updateJobStep(jobId, 1, 'completed')
    } catch (error) {
      console.error(`Transcription failed for job ${jobId}:`, error)
      await updateJobStep(jobId, 1, 'failed')
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Transcription failed'
      jobs.set(jobId, job)
      return
    }

    // Step 3: Music Generation (real or stub)
    await updateJobStep(jobId, 2, 'processing')
    console.log(`Starting music generation for job ${jobId}`)
    // TODO: Implement real ambient music generation or selection here
    // For now, just simulate with a short delay
    await sleep(1000)
    // Optionally, set job.musicPath = ...
    console.log(`Music generation completed`)
    await updateJobStep(jobId, 2, 'completed')

    // Step 4: Visual Generation (real or stub)
    await updateJobStep(jobId, 3, 'processing')
    console.log(`Starting visual generation for job ${jobId}`)
    // TODO: Implement real abstract visual generation here
    // For now, just simulate with a short delay
    await sleep(1000)
    // Optionally, set job.visualPath = ...
    console.log(`Visual generation completed`)
    await updateJobStep(jobId, 3, 'completed')

    // Step 5: Video Assembly (real or stub)
    await updateJobStep(jobId, 4, 'processing')
    console.log(`Starting video assembly for job ${jobId}`)
    // TODO: Implement real video assembly with FFmpeg here
    // For now, just simulate with a short delay
    await sleep(1000)
    // Optionally, set job.outputPath = ...
    console.log(`Video assembly completed`)
    await updateJobStep(jobId, 4, 'completed')

    // Step 6: Metadata Generation (real or stub)
    await updateJobStep(jobId, 5, 'processing')
    console.log(`Starting metadata generation for job ${jobId}`)
    // TODO: Implement real metadata generation using Ollama here
    // For now, just simulate with a short delay
    await sleep(500)
    // Optionally, set job.metadata = ...
    console.log(`Metadata generation completed`)
    await updateJobStep(jobId, 5, 'completed')

    // Complete job
    job.status = 'completed'
    job.progress = 100
    job.completedAt = new Date()
    job.outputPath = `/api/download/${jobId}`
    jobs.set(jobId, job)

    console.log(`Job ${jobId} completed successfully`)

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error)
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : 'Unknown error'
    jobs.set(jobId, job)
  }
}

async function updateJobStep(jobId: string, stepIndex: number, status: 'processing' | 'completed' | 'failed') {
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
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
