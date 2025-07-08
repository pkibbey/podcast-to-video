import { NextRequest, NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import path from 'path'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('path')
    
    if (!filePath) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 })
    }
    
    // Security: Only allow files from temp directory
    const tempDir = path.join(process.cwd(), 'temp')
    const absolutePath = path.resolve(filePath)
    const tempDirAbsolute = path.resolve(tempDir)
    
    if (!absolutePath.startsWith(tempDirAbsolute)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    
    // Check if file exists
    try {
      await access(absolutePath)
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    
    // Read and serve the file
    const fileBuffer = await readFile(absolutePath)
    const ext = path.extname(filePath).toLowerCase()
    
    // Determine content type
    let contentType = 'application/octet-stream'
    if (ext === '.wav' || ext === '.mp3') {
      contentType = `audio/${ext.slice(1)}`
    } else if (ext === '.mp4') {
      contentType = 'video/mp4'
    } else if (ext === '.srt') {
      contentType = 'text/plain'
    } else if (ext === '.json') {
      contentType = 'application/json'
    }
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('Preview file error:', error)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
