import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { AudioFile, ProcessingJob } from '@/types'
import { jobs, saveJobs, processAudioFile } from '@/utils/jobs'
import { analyzeAudio, transcribeAudio, generateSRT, convertToWav, extractWaveform, trimAudioToFirstMinute } from '@/utils/audioProcessing'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File
    const visualMode = formData.get('visualMode') as string || 'fast'
    
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
    const tempDir = path.join(process.cwd(), 'temp')
    
    try {
      await mkdir(uploadsDir, { recursive: true })
      await mkdir(tempDir, { recursive: true })
    } catch (_error) {
      // Directories might already exist
      console.log('Upload and temp directories already exist')
    }

    // Save file
    const fileId = uuidv4()
    const fileName = `${fileId}-${file.name}`
    const filePath = path.join(uploadsDir, fileName)
    
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    await writeFile(filePath, buffer)

    // Trim audio to first minute
    const trimmedFileName = `${fileId}-trimmed-${file.name}`
    const trimmedFilePath = path.join(uploadsDir, trimmedFileName)
    
    try {
      await trimAudioToFirstMinute(filePath, trimmedFilePath)
      console.log(`Audio trimmed to first minute: ${trimmedFilePath}`)
      
      // Clean up original file since we only need the trimmed version
      await unlink(filePath)
      console.log(`Original file cleaned up: ${filePath}`)
    } catch (error) {
      console.error('Failed to trim audio:', error)
      return NextResponse.json({ error: 'Failed to process audio file' }, { status: 500 })
    }

    // Create audio file object (using trimmed file)
    const audioFile: AudioFile = {
      id: fileId,
      name: file.name,
      path: trimmedFilePath, // Use trimmed file path
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
      status: 'uploaded', // Changed from 'pending' to indicate file is uploaded but processing not started
      progress: 0,
      startedAt: new Date(),
      visualMode: visualMode as any, // Type assertion for now
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

    // Don't start processing automatically - user must click a button to start

    return NextResponse.json({ 
      success: true, 
      job: processingJob 
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
