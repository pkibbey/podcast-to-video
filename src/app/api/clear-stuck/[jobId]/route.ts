import { clearStuckProcessingStates, resetAutoResumeFlag } from '@/utils/jobs'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params
    const cleared = await clearStuckProcessingStates(jobId)
    
    return NextResponse.json({ 
      success: true, 
      cleared,
      message: cleared ? 'Stuck processing states cleared' : 'No stuck states found'
    })
  } catch (error: unknown) {
    console.error('Error clearing stuck states:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}

// Reset auto-resume flag
export async function DELETE() {
  try {
    resetAutoResumeFlag()
    return NextResponse.json({ 
      success: true, 
      message: 'Auto-resume flag reset' 
    })
  } catch (error: unknown) {
    console.error('Error resetting auto-resume flag:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
