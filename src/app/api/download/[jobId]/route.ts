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

    // Serve the final assembled video file
    const tempDir = path.join(process.cwd(), 'temp')
    const finalVideoPath = path.join(tempDir, `${jobId}-final.mp4`)
    
    try {
      const videoBuffer = await readFile(finalVideoPath)
      const filename = `${job.audioFile.name.replace(/\.[^/.]+$/, '')}-podcast-video.mp4`
      
      return new NextResponse(videoBuffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': videoBuffer.length.toString(),
        },
      })
    } catch (error) {
      console.log('Final video not found, checking for fallback files:', error)
      
      // Fallback: try to serve just the visuals if final assembly failed
      const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
      try {
        const visualsBuffer = await readFile(visualsPath)
        const filename = `${job.audioFile.name.replace(/\.[^/.]+$/, '')}-visuals-only.mp4`
        
        return new NextResponse(visualsBuffer, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': visualsBuffer.length.toString(),
          },
        })
      } catch (visualsError) {
        console.error('No video files found:', visualsError)
        return NextResponse.json({ error: 'Generated video not found' }, { status: 404 })
      }
    }
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Failed to download video' }, { status: 500 })
  }
}
