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

    // Serve the actual generated video file if it exists
    const videoFilePath = job.outputPath && job.outputPath.startsWith('/')
      ? path.join(process.cwd(), job.outputPath.replace('/api/download', 'temp'))
      : null
    if (videoFilePath) {
      try {
        const videoBuffer = await readFile(videoFilePath)
        return new NextResponse(videoBuffer, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${job.audioFile.name}-video.mp4"`,
          },
        })
      } catch (error) {
        console.log('Generated video not found, returning error:', error)
        return NextResponse.json({ error: 'Generated video not found' }, { status: 404 })
      }
    }
    return NextResponse.json({ error: 'No video output available' }, { status: 404 })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Failed to download video' }, { status: 500 })
  }
}
