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

    // Serve the metadata JSON file
    const tempDir = path.join(process.cwd(), 'temp')
    const metadataPath = path.join(tempDir, `${jobId}-metadata.json`)
    
    try {
      const metadataBuffer = await readFile(metadataPath)
      const filename = `${job.audioFile.name.replace(/\.[^/.]+$/, '')}-metadata.json`
      
      return new NextResponse(metadataBuffer, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': metadataBuffer.length.toString(),
        },
      })
    } catch (error) {
      console.error('Metadata file not found:', error)
      
      // Fallback: return metadata from job object
      if (job.metadata) {
        const metadataJson = JSON.stringify(job.metadata, null, 2)
        const filename = `${job.audioFile.name.replace(/\.[^/.]+$/, '')}-metadata.json`
        
        return new NextResponse(metadataJson, {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': metadataJson.length.toString(),
          },
        })
      }
      
      return NextResponse.json({ error: 'Metadata not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('Metadata download error:', error)
    return NextResponse.json({ error: 'Failed to download metadata' }, { status: 500 })
  }
}
