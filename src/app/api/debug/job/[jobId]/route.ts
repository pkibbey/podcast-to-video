import { NextRequest, NextResponse } from 'next/server'
import { jobs } from '@/utils/jobs'

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

    // Return job data with debug info
    return NextResponse.json({
      job,
      timestamp: new Date().toISOString(),
      debug: {
        stepsStatus: job.steps.map((step, index) => ({
          index,
          name: step.name,
          status: step.status,
          progress: step.progress,
          error: step.error || null
        }))
      }
    })
  } catch (error) {
    console.error('Debug job error:', error)
    return NextResponse.json({ error: 'Failed to get job debug info' }, { status: 500 })
  }
}
