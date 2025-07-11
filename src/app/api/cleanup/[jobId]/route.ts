import { NextRequest, NextResponse } from 'next/server'
import { cleanupJobFiles } from '@/utils/audioProcessing'
import path from 'path'
import { access, stat } from 'fs/promises'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }
    
    console.log(`🧹 Manual cleanup requested for job ${jobId}`)
    const success = await cleanupJobFiles(jobId)
    
    if (success) {
      return NextResponse.json({
        message: `Successfully cleaned up files for job ${jobId}`,
        jobId,
        cleaned: true
      })
    } else {
      return NextResponse.json({
        message: `Some files could not be cleaned up for job ${jobId}`,
        jobId,
        cleaned: false
      }, { status: 207 }) // 207 Multi-Status - partial success
    }
    
  } catch (error) {
    console.error('Cleanup error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to cleanup job files',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }
    
    // Check what files exist for this job
    const tempDir = path.join(process.cwd(), 'temp')
    
    const potentialFiles = [
      `${jobId}-audio.wav`,
      `${jobId}-audio.json`, 
      `${jobId}-music.wav`,
      `${jobId}-visuals.mp4`,
      `${jobId}-subtitles.srt`,
      `${jobId}-mixed-audio.wav`,
      `${jobId}-final.mp4`,
      `${jobId}-metadata.json`
    ]
    
    const existingFiles = []
    for (const filename of potentialFiles) {
      const filepath = path.join(tempDir, filename)
      try {
        await access(filepath)
        const stats = await stat(filepath)
        existingFiles.push({
          name: filename,
          path: filepath,
          size: stats.size,
          modified: stats.mtime
        })
      } catch {
        // File doesn't exist, which is fine
      }
    }
    
    return NextResponse.json({
      jobId,
      files: existingFiles,
      totalFiles: existingFiles.length,
      totalSize: existingFiles.reduce((sum, file) => sum + file.size, 0)
    })
    
  } catch (error) {
    console.error('File check error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to check job files',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
