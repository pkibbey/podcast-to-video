import { NextRequest, NextResponse } from 'next/server'
import { jobs, saveJobs, processSpecificStep } from '@/utils/jobs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { stepIndex } = await request.json()
    
    const job = jobs.get(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (stepIndex < 0 || stepIndex >= job.steps.length) {
      return NextResponse.json({ error: 'Invalid step index' }, { status: 400 })
    }

    const step = job.steps[stepIndex]
    if (step.status === 'completed') {
      return NextResponse.json({ error: 'Step already completed' }, { status: 400 })
    }

    if (step.status === 'processing') {
      return NextResponse.json({ error: 'Step already processing' }, { status: 400 })
    }

    // Check if previous steps are completed (except for step 0)
    if (stepIndex > 0) {
      for (let i = 0; i < stepIndex; i++) {
        if (job.steps[i].status !== 'completed') {
          return NextResponse.json({ 
            error: `Previous step "${job.steps[i].name}" must be completed first` 
          }, { status: 400 })
        }
      }
    }

    // Start processing this specific step
    job.status = 'processing'
    step.status = 'processing'
    step.startedAt = new Date()
    // Clear any previous error when retrying
    if (step.error) {
      delete step.error
    }
    jobs.set(jobId, job)
    await saveJobs()

    // Process the step in background
    processSpecificStep(jobId, stepIndex).catch(async (error: any) => {
      console.error('Step processing error:', error)
      const job = jobs.get(jobId)
      if (job) {
        const step = job.steps[stepIndex]
        step.status = 'failed'
        step.error = error.message || 'Unknown error'
        job.status = 'pending' // Allow retry of other steps
        jobs.set(jobId, job)
        await saveJobs()
      }
    })

    return NextResponse.json({ 
      success: true, 
      job: jobs.get(jobId) 
    })

  } catch (error) {
    console.error('Step start error:', error)
    return NextResponse.json({ error: 'Failed to start step' }, { status: 500 })
  }
}
