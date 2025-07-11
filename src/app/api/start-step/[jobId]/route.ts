import { NextRequest, NextResponse } from 'next/server'
import { jobs, saveJobs, processSpecificStep, restartSpecificStep, getProcessingLocks } from '@/utils/jobs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { stepIndex, forceReprocess = false } = await request.json()
    
    console.log(`[API] POST /api/start-step/${jobId} - stepIndex: ${stepIndex}, forceReprocess: ${forceReprocess}`)
    
    const job = jobs.get(jobId)
    if (!job) {
      console.log(`[API] Job ${jobId} not found`)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (stepIndex < 0 || stepIndex >= job.steps.length) {
      console.log(`[API] Invalid step index ${stepIndex} for job ${jobId}`)
      return NextResponse.json({ error: 'Invalid step index' }, { status: 400 })
    }

    const step = job.steps[stepIndex]
    
    // If not forcing reprocess, check step status
    if (!forceReprocess) {
      if (step.status === 'completed') {
        console.log(`[API] Step ${stepIndex} already completed for job ${jobId}`)
        return NextResponse.json({ error: 'Step already completed' }, { status: 400 })
      }

      if (step.status === 'processing') {
        console.log(`[API] Step ${stepIndex} already processing for job ${jobId}`)
        return NextResponse.json({ error: 'Step already processing' }, { status: 400 })
      }
    }

    // Check if this step is currently locked (being processed by another request)
    const lockKey = `${jobId}-${stepIndex}`
    const activeLocks = getProcessingLocks()
    if (activeLocks.includes(lockKey)) {
      console.log(`[API] Step ${stepIndex} for job ${jobId} is locked (currently processing)`)
      return NextResponse.json({ error: 'Step already processing' }, { status: 400 })
    }

    // Check if previous steps are completed (except for step 0 or when force reprocessing)
    if (!forceReprocess && stepIndex > 0) {
      for (let i = 0; i < stepIndex; i++) {
        if (job.steps[i].status !== 'completed') {
          return NextResponse.json({ 
            error: `Previous step "${job.steps[i].name}" must be completed first` 
          }, { status: 400 })
        }
      }
    }

    if (forceReprocess) {
      // Use the restart function to reset and reprocess the step
      console.log(`[API] Force reprocessing step ${stepIndex} for job ${jobId}`)
      restartSpecificStep(jobId, stepIndex).catch(async (error: unknown) => {
        console.error('[API] Step reprocessing error:', error)
        const job = jobs.get(jobId)
        if (job) {
          const step = job.steps[stepIndex]
          step.status = 'failed'
          step.error = error instanceof Error ? error.message : 'Unknown error'
          job.status = 'pending' // Allow retry of other steps
          jobs.set(jobId, job)
          await saveJobs()
        }
      })
    } else {
      // Start processing this specific step normally
      console.log(`[API] Starting processing of step ${stepIndex} for job ${jobId}`)
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
      console.log(`[API] Calling processSpecificStep(${jobId}, ${stepIndex})`)
      processSpecificStep(jobId, stepIndex, false).catch(async (error: unknown) => {
        console.error('[API] Step processing error:', error)
        const job = jobs.get(jobId)
        if (job) {
          const step = job.steps[stepIndex]
          step.status = 'failed'
          step.error = error instanceof Error ? error.message : 'Unknown error'
          job.status = 'pending' // Allow retry of other steps
          jobs.set(jobId, job)
          await saveJobs()
        }
      })
    }

    return NextResponse.json({ 
      success: true, 
      job: jobs.get(jobId) 
    })

  } catch (error) {
    console.error('Step start error:', error)
    return NextResponse.json({ error: 'Failed to start step' }, { status: 500 })
  }
}
