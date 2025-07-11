import { NextRequest, NextResponse } from 'next/server'
import { cleanupJobFiles } from '@/utils/audioProcessing'
import { jobs } from '@/utils/jobs'
import path from 'path'
import { readdir, stat, unlink } from 'fs/promises'

interface FileInfo {
  name: string
  size: number
  sizeMB: number
  modified: Date
  ageHours: number
}

export async function DELETE(_request: NextRequest) {
  try {
    const url = new URL(_request.url)
    const cleanupType = url.searchParams.get('type') || 'all'
    const olderThanDays = parseInt(url.searchParams.get('olderThan') || '7')
    
    const tempDir = path.join(process.cwd(), 'temp')
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)
    
    let deletedFiles = 0
    let totalFiles = 0
    let totalSize = 0
    const errors: string[] = []
    
    console.log(`🧹 Starting cleanup of ${cleanupType} files older than ${olderThanDays} days...`)
    
    if (cleanupType === 'all' || cleanupType === 'orphaned') {
      // Find orphaned files (files that don't belong to any current job)
      try {
        const files = await readdir(tempDir)
        const activeJobIds = Array.from(jobs.keys())
        
        for (const file of files) {
          const filePath = path.join(tempDir, file)
          const fileStat = await stat(filePath)
          
          // Skip directories
          if (fileStat.isDirectory()) continue
          
          totalFiles++
          totalSize += fileStat.size
          
          // Check if file is older than cutoff date
          if (fileStat.mtime < cutoffDate) {
            // Check if this file belongs to any active job
            const belongsToActiveJob = activeJobIds.some(jobId => file.startsWith(jobId))
            
            if (!belongsToActiveJob || cleanupType === 'all') {
              try {
                await unlink(filePath)
                deletedFiles++
                console.log(`🗑️ Deleted: ${file}`)
              } catch (error) {
                const errorMsg = `Failed to delete ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`
                errors.push(errorMsg)
                console.error(errorMsg)
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to list temp directory: ${error instanceof Error ? error.message : 'Unknown error'}`
        errors.push(errorMsg)
        console.error(errorMsg)
      }
    }
    
    if (cleanupType === 'all' || cleanupType === 'completed') {
      // Clean up files for completed jobs
      const completedJobs = Array.from(jobs.entries())
        .filter(([_, job]) => job.status === 'completed')
        .map(([jobId]) => jobId)
      
      for (const jobId of completedJobs) {
        try {
          const success = await cleanupJobFiles(jobId, tempDir)
          if (success) {
            console.log(`✅ Cleaned up completed job: ${jobId}`)
          }
        } catch (error) {
          const errorMsg = `Failed to cleanup job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
          errors.push(errorMsg)
          console.error(errorMsg)
        }
      }
    }
    
    const response = {
      message: `Cleanup completed`,
      type: cleanupType,
      olderThanDays,
      totalFiles,
      deletedFiles,
      totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
      errors: errors.length > 0 ? errors : undefined
    }
    
    console.log(`✅ Cleanup summary:`, response)
    
    return NextResponse.json(response)
    
  } catch (error) {
    console.error('Global cleanup error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to perform cleanup',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET(_request: NextRequest) {
  try {
    const tempDir = path.join(process.cwd(), 'temp')
    
    // Get info about temp directory
    const files = await readdir(tempDir)
    let totalFiles = 0
    let totalSize = 0
    const filesByJob: Record<string, FileInfo[]> = {}
    const orphanedFiles: FileInfo[] = []
    
    const activeJobIds = Array.from(jobs.keys())
    
    for (const file of files) {
      const filePath = path.join(tempDir, file)
      const fileStat = await stat(filePath)
      
      // Skip directories
      if (fileStat.isDirectory()) continue
      
      totalFiles++
      totalSize += fileStat.size
      
      const fileInfo: FileInfo = {
        name: file,
        size: fileStat.size,
        sizeMB: Math.round(fileStat.size / (1024 * 1024) * 100) / 100,
        modified: fileStat.mtime,
        ageHours: Math.round((Date.now() - fileStat.mtime.getTime()) / (1000 * 60 * 60))
      }
      
      // Try to determine which job this file belongs to
      const jobId = activeJobIds.find(id => file.startsWith(id))
      
      if (jobId) {
        if (!filesByJob[jobId]) {
          filesByJob[jobId] = []
        }
        filesByJob[jobId].push(fileInfo)
      } else {
        orphanedFiles.push(fileInfo)
      }
    }
    
    return NextResponse.json({
      tempDirectory: tempDir,
      totalFiles,
      totalSize,
      totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
      activeJobs: Object.keys(filesByJob).length,
      orphanedFilesCount: orphanedFiles.length,
      filesByJob,
      orphanedFiles,
      summary: {
        activeJobFiles: totalFiles - orphanedFiles.length,
        orphanedFiles: orphanedFiles.length,
        oldestFileHours: files.length > 0 ? Math.min(...Object.values(filesByJob).flat().concat(orphanedFiles).map(f => f.ageHours)) : 0,
        newestFileHours: files.length > 0 ? Math.max(...Object.values(filesByJob).flat().concat(orphanedFiles).map(f => f.ageHours)) : 0
      }
    })
    
  } catch (error) {
    console.error('Cleanup info error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to get cleanup info',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
