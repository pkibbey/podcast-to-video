import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { AudioFile, ProcessingJob } from '@/types'
import { jobs, saveJobs, processAudioFile } from '@/utils/jobs'
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
    await saveJobs()

    // Start processing in background
    processAudioFile(jobId).catch(async error => {
      console.error('Processing error:', error)
      const job = jobs.get(jobId)
      if (job) {
        job.status = 'failed'
        job.error = error.message
        jobs.set(jobId, job)
        await saveJobs()
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
