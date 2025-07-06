import { NextRequest, NextResponse } from 'next/server'
import { jobs } from '@/utils/jobs'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const job = jobs.get(jobId)
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.status !== 'completed') {
      return NextResponse.json({ error: 'Job not completed' }, { status: 400 })
    }

    // In a real implementation, this would serve the actual video file
    // For now, we'll return a placeholder response
    const mockVideoPath = path.join(process.cwd(), 'public', 'placeholder-video.mp4')
    
    try {
      const videoBuffer = await readFile(mockVideoPath)
      
      return new NextResponse(videoBuffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${job.audioFile.name}-video.mp4"`,
        },
      })
    } catch (error) {
      // If placeholder doesn't exist, return a mock response
      console.log('Placeholder video not found, returning mock response:', error)
      return NextResponse.json({ 
        message: 'Video generation completed',
        jobId: jobId,
        originalFile: job.audioFile.name,
        note: 'In a real implementation, this would download the generated video file'
      })
    }
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Failed to download video' }, { status: 500 })
  }
}
