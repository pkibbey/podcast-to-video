import { NextResponse } from 'next/server'
import { getProcessingLocks } from '@/utils/jobs'

export async function GET() {
  try {
    const locks = getProcessingLocks()
    return NextResponse.json({ 
      locks,
      count: locks.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Debug locks error:', error)
    return NextResponse.json({ error: 'Failed to get locks' }, { status: 500 })
  }
}
