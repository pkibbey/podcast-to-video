import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { AudioFile, ProcessingJob } from '@/types'
import { jobs } from '@/utils/jobs'

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
    await sleep(2000) // Simulate processing time
    await updateJobStep(jobId, 0, 'completed')

    // Step 2: Transcription
    await updateJobStep(jobId, 1, 'processing')
    await sleep(3000) // Simulate processing time
    await updateJobStep(jobId, 1, 'completed')

    // Step 3: Music Generation
    await updateJobStep(jobId, 2, 'processing')
    await sleep(2000) // Simulate processing time
    await updateJobStep(jobId, 2, 'completed')

    // Step 4: Visual Generation
    await updateJobStep(jobId, 3, 'processing')
    await sleep(4000) // Simulate processing time
    await updateJobStep(jobId, 3, 'completed')

    // Step 5: Video Assembly
    await updateJobStep(jobId, 4, 'processing')
    await sleep(5000) // Simulate processing time
    await updateJobStep(jobId, 4, 'completed')

    // Step 6: Metadata Generation
    await updateJobStep(jobId, 5, 'processing')
    await sleep(1000) // Simulate processing time
    await updateJobStep(jobId, 5, 'completed')

    // Complete job
    job.status = 'completed'
    job.progress = 100
    job.completedAt = new Date()
    job.outputPath = `/api/download/${jobId}`
    jobs.set(jobId, job)

  } catch (error) {
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
