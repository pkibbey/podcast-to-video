import { ProcessingJob } from '@/types'

// Store jobs in memory for now (in production, use a database)
export const jobs = new Map<string, ProcessingJob>()
