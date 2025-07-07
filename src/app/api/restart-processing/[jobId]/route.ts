import { NextRequest, NextResponse } from 'next/server'
import { jobs, saveJobs, processAudioFile } from '@/utils/jobs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    
    const job = jobs.get(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.status === 'completed') {
      return NextResponse.json({ error: 'Job already completed' }, { status: 400 })
    }

    if (job.status === 'processing') {
      return NextResponse.json({ error: 'Job already processing' }, { status: 400 })
    }

    // Start processing from where it left off
    job.status = 'processing'
    jobs.set(jobId, job)
    await saveJobs()

    // Start processing in background
    processAudioFile(jobId).catch(async (error: any) => {
      console.error('Processing error:', error)
      const job = jobs.get(jobId)
      if (job) {
        job.status = 'failed'
        job.error = error.message || 'Unknown error'
        jobs.set(jobId, job)
        await saveJobs()
      }
    })

    return NextResponse.json({ 
      success: true, 
      job: jobs.get(jobId) 
    })

  } catch (error) {
    console.error('Restart processing error:', error)
    return NextResponse.json({ error: 'Failed to restart processing' }, { status: 500 })
  }
}
