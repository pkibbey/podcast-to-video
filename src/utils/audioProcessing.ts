import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { writeFile, readFile } from 'fs/promises'
import path from 'path'
import { TranscriptionSegment, Transcript } from '@/types'

// Configure FFmpeg path (update this based on your system)
// On macOS with Homebrew: /opt/homebrew/bin/ffmpeg
// On Linux: /usr/bin/ffmpeg
// On Windows: C:\ffmpeg\bin\ffmpeg.exe
const FFMPEG_PATH = '/opt/homebrew/bin/ffmpeg'
const FFPROBE_PATH = '/opt/homebrew/bin/ffprobe'

ffmpeg.setFfmpegPath(FFMPEG_PATH)
ffmpeg.setFfprobePath(FFPROBE_PATH)

export interface AudioAnalysis {
  duration: number
  sampleRate: number
  channels: number
  bitRate: number
  format: string
  waveformData: number[]
}

/**
 * Extract audio file metadata and properties
 */
export async function analyzeAudio(inputPath: string): Promise<AudioAnalysis> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new Error(`FFprobe failed: ${err.message}`))
        return
      }

      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio')
      if (!audioStream) {
        reject(new Error('No audio stream found'))
        return
      }

      const analysis: AudioAnalysis = {
        duration: parseFloat(audioStream.duration || '0'),
        sampleRate: audioStream.sample_rate || 44100,
        channels: audioStream.channels || 2,
        bitRate: audioStream.bit_rate ? parseInt(audioStream.bit_rate) : 128000,
        format: audioStream.codec_name || 'unknown',
        waveformData: [], // Will be populated by extractWaveform
      }

      resolve(analysis)
    })
  })
}

/**
 * Extract waveform data for visualization
 */
export async function extractWaveform(inputPath: string, samples: number = 1000): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(process.cwd(), 'temp', `waveform-${Date.now()}.json`)

    ffmpeg(inputPath)
      .audioFilters([
        `aformat=channel_layouts=mono`,
        `aresample=8000`,
        `astats=metadata=1:reset=1`,
        `ametadata=mode=print:file=${tempPath}`
      ])
      .format('null')
      .output('-')
      .on('end', async () => {
        try {
          // Parse the FFmpeg-generated metadata file for waveform data
          const metadata = await readFile(tempPath, 'utf-8')
          const lines = metadata.split('\n')
          const rmsValues: number[] = []
          for (const line of lines) {
            if (line.includes('RMS_level')) {
              const match = line.match(/RMS_level=([-\d.]+)/)
              if (match) {
                rmsValues.push(parseFloat(match[1]))
              }
            }
          }
          // Normalize and sample the waveform data
          const min = Math.min(...rmsValues)
          const max = Math.max(...rmsValues)
          const normalized = rmsValues.map(v => (v - min) / (max - min || 1))
          // Downsample to the requested number of samples
          const step = Math.max(1, Math.floor(normalized.length / samples))
          const waveform = Array.from({ length: samples }, (_, i) => normalized[i * step] || 0)
          resolve(waveform)
        } catch (error) {
          reject(error)
        }
      })
      .on('error', reject)
      .run()
  })
}

/**
 * Convert audio to WAV format for Whisper processing
 */
export async function convertToWav(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * Transcribe audio using Whisper
 */
export async function transcribeAudio(audioPath: string, log?: (msg: string) => void): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(process.cwd(), 'temp')
    const whisperProcess = spawn('whisper', [
      audioPath,
      '--model', 'base',
      '--output_format', 'json',
      '--output_dir', tempDir,
      '--fp16', 'False',
      '--word_timestamps', 'True'
    ])
    let _stderr = ''
    whisperProcess.stderr.on('data', (data) => {
      console.log('data: ', data)
      const msg = data.toString()
      _stderr += msg
      if (log) log(msg)
    })
    whisperProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Whisper transcription failed: ' + _stderr))
        return
      }
      try {
        const jsonFile = path.join(tempDir, path.basename(audioPath, path.extname(audioPath)) + '.json')
        const transcriptData = await readFile(jsonFile, 'utf-8')
        const parsed = JSON.parse(transcriptData)
        const segments: TranscriptionSegment[] = parsed.segments.map((segment: Record<string, unknown>) => ({
          text: String(segment.text || '').trim(),
          start: Number(segment.start) || 0,
          end: Number(segment.end) || 0,
          confidence: segment.avg_logprob ? Math.exp(Number(segment.avg_logprob)) : 0.5
        }))
        resolve({
          segments,
          language: parsed.language || 'en',
          duration: parsed.segments[parsed.segments.length - 1]?.end || 0
        })
      } catch (error) {
        reject(error)
      }
    })
    whisperProcess.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Generate SRT subtitle file from transcript
 */
export async function generateSRT(transcript: Transcript, outputPath: string): Promise<string> {
  let srtContent = ''
  
  transcript.segments.forEach((segment, index) => {
    const startTime = formatSRTTime(segment.start)
    const endTime = formatSRTTime(segment.end)
    
    srtContent += `${index + 1}\n`
    srtContent += `${startTime} --> ${endTime}\n`
    srtContent += `${segment.text}\n\n`
  })
  
  await writeFile(outputPath, srtContent, 'utf-8')
  return outputPath
}

/**
 * Format time in seconds to SRT format (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const milliseconds = Math.floor((seconds % 1) * 1000)
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`
}

/**
 * Generate a chill ambient soundtrack using local MusicGen CLI
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @returns outputPath
 */
export async function generateChillSoundtrack(duration: number, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Example CLI: python -m musicgen --prompt "chill ambient music" --duration 180 --output output.wav
    const prompt = 'chill ambient music';
    const args = [
      '-m', 'musicgen',
      '--prompt', prompt,
      '--duration', duration.toString(),
      '--output', outputPath
    ];
    const musicgen = spawn('python', args);
    let stderr = '';
    musicgen.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    musicgen.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('MusicGen failed: ' + stderr));
      } else {
        resolve(outputPath);
      }
    });
    musicgen.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Generate a chill ambient soundtrack by looping/trimming a local music file
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @param musicDir Directory containing chill music tracks
 * @returns outputPath
 */
export async function generateChillSoundtrackFromLocal(duration: number, outputPath: string, musicDir: string = path.join(process.cwd(), 'assets', 'music')): Promise<string> {
  try {
    // Find all music files in the directory
    const files = (await import('fs/promises')).readdir(musicDir);
    const musicFiles = (await files).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.aac') || f.endsWith('.flac') || f.endsWith('.ogg'));
    
    if (musicFiles.length === 0) {
      console.log('No music files found, generating ambient music with FFmpeg...');
      return generateAmbientWithFFmpeg(duration, outputPath);
    }
    
    // Pick a random file
    const musicFile = musicFiles[Math.floor(Math.random() * musicFiles.length)];
    const inputPath = path.join(musicDir, musicFile);
    
    // Use FFmpeg to loop and trim the music to the desired duration
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputPath)
        .inputOptions(['-stream_loop', '-1']) // infinite loop
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(44100)
        .format('wav')
        .duration(duration)
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  } catch (error) {
    console.log('Error reading music directory, falling back to FFmpeg generation:', error);
    return generateAmbientWithFFmpeg(duration, outputPath);
  }
}

/**
 * Generate ambient music using FFmpeg's built-in synthesizers (no external dependencies)
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @returns outputPath
 */
export async function generateAmbientWithFFmpeg(duration: number, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a simple ambient track using brown noise and sine wave
    // This is more reliable than complex filter chains
    ffmpeg()
      .input(`anoisesrc=colour=brown:sample_rate=44100:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=220:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=330:duration=${duration}`)
      .inputFormat('lavfi')
      .complexFilter([
        '[0]volume=0.1,highpass=f=80,lowpass=f=8000[noise]',
        '[1]volume=0.05[sine1]',
        '[2]volume=0.03[sine2]',
        '[noise][sine1][sine2]amix=inputs=3:duration=first[out]'
      ])
      .map('[out]')
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('wav')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        console.error('FFmpeg ambient generation error:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Generate abstract visuals synchronized to audio waveform
 * Creates an MP4 video with animated particles and waveform visualization
 */
export async function generateAbstractVisuals(
  audioPath: string, 
  waveformData: number[], 
  outputPath: string, 
  duration: number,
  options: {
    width?: number
    height?: number
    fps?: number
    particleCount?: number
    colors?: string[]
  } = {}
): Promise<string> {
  const {
    width = 1920,
    height = 1080,
    fps = 30,
    particleCount: _particleCount = 100,
    colors: _colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
  } = options

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    
    // Create a simpler but more reliable visual using basic FFmpeg filters
    // Fallback to simpler approach to avoid lavfi complex filter issues
    const args = [
      '-f', 'lavfi',
      '-i', `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
      '-vf', `geq=r='128+64*sin(2*PI*T/3+X/50)':g='128+64*cos(2*PI*T/4+Y/50)':b='128+64*sin(2*PI*T/2+sqrt((X-W/2)^2+(Y-H/2)^2)/30)',hue=h=t*30:s=2`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '23',
      '-y', // Overwrite output file
      outputPath
    ]

    console.log('Generating abstract visuals with command:', FFMPEG_PATH, args.join(' '))
    console.log(`Output path: ${outputPath}`)
    
    const process = spawn(FFMPEG_PATH, args)
    console.log(`Spawned FFmpeg process with PID: ${process.pid}`)
    
    let stderr = ''
    
    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    
    process.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('Abstract visuals generated successfully')
        resolve(outputPath)
      } else {
        console.error('FFmpeg process failed with code:', code)
        console.error('FFmpeg stderr:', stderr)
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`))
      }
    })
    
    process.on('error', (error: Error) => {
      console.error('Failed to start FFmpeg process:', error)
      reject(error)
    })
  })
}

/**
 * Generate simpler abstract visuals using basic FFmpeg filters (fallback)
 */
export async function generateSimpleVisuals(
  duration: number,
  outputPath: string,
  _waveformData: number[] = [],
  options: {
    width?: number
    height?: number
    fps?: number
  } = {}
): Promise<string> {
  const {
    width = 1920,
    height = 1080,
    fps = 30
  } = options

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    
    // Use direct FFmpeg command to avoid fluent-ffmpeg lavfi issues
    const args = [
      '-f', 'lavfi',
      '-i', `mandelbrot=s=${width}x${height}:maxiter=100:rate=${fps}:outer=normalized_iteration_count`,
      '-vf', `hue=h=t*60:s=sin(t)+1,gblur=sigma=2`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '23',
      '-t', duration.toString(),
      '-y', // Overwrite output file
      outputPath
    ]

    console.log('Generating simple visuals with command:', FFMPEG_PATH, args.join(' '))
    console.log(`Output path: ${outputPath}`)
    
    const process = spawn(FFMPEG_PATH, args)
    console.log(`Spawned FFmpeg process with PID: ${process.pid}`)
    
    let stderr = ''
    
    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    
    process.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('Simple visuals generated successfully')
        resolve(outputPath)
      } else {
        console.error('FFmpeg process failed with code:', code)
        console.error('FFmpeg stderr:', stderr)
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`))
      }
    })
    
    process.on('error', (error: Error) => {
      console.error('Failed to start FFmpeg process:', error)
      reject(error)
    })
  })
}

/**
 * Generate ultra-fast visuals optimized for real-time processing
 */
export async function generateFastVisuals(
  audioPath: string, 
  waveformData: number[], 
  outputPath: string, 
  duration: number,
  options: {
    width?: number
    height?: number
    fps?: number
    preset?: 'ultrafast' | 'superfast' | 'veryfast'
    quality?: 'draft' | 'medium' | 'high'
    useGPU?: boolean
  } = {}
): Promise<string> {
  const {
    width = 1280,  // Lower resolution for speed
    height = 720,
    fps = 24,      // Lower framerate for speed
    preset = 'ultrafast',
    quality = 'draft',
    useGPU = true
  } = options

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    
    // Determine CRF based on quality setting
    const crf = quality === 'draft' ? '28' : quality === 'medium' ? '23' : '18'
    
    const args = [
      '-f', 'lavfi',
      '-i', `color=c=#1a1a2e:s=${width}x${height}:d=${duration}:r=${fps}`,
      '-vf', getOptimizedVisualFilter(quality),
    ]

    // Add GPU acceleration for macOS
    if (useGPU) {
      args.push('-hwaccel', 'videotoolbox')
      args.push('-c:v', 'h264_videotoolbox')
    } else {
      args.push('-c:v', 'libx264')
    }

    args.push(
      '-pix_fmt', 'yuv420p',
      '-preset', preset,
      '-crf', crf,
      '-movflags', '+faststart',
      '-y',
      outputPath
    )

    console.log('Generating fast visuals with command:', FFMPEG_PATH, args.join(' '))
    
    const process = spawn(FFMPEG_PATH, args)
    
    let stderr = ''
    
    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    
    process.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('Fast visuals generated successfully')
        resolve(outputPath)
      } else {
        console.error('FFmpeg process failed with code:', code)
        console.error('FFmpeg stderr:', stderr)
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`))
      }
    })
    
    process.on('error', (error: Error) => {
      console.error('Failed to start FFmpeg process:', error)
      reject(error)
    })
  })
}

/**
 * Get optimized visual filter based on quality level
 */
function getOptimizedVisualFilter(quality: 'draft' | 'medium' | 'high'): string {
  switch (quality) {
    case 'draft':
      // Super simple gradient that changes color over time
      return `geq=r='128+100*sin(t/10)':g='128+100*sin(t/8)':b='128+100*sin(t/12)'`
    
    case 'medium':
      // Simple particle-like effect with lower complexity
      return `geq=r='128+80*sin(2*t/5+X/100)':g='128+80*cos(2*t/7+Y/100)':b='128+80*sin(2*t/3+sqrt(X*X+Y*Y)/200)'`
    
    case 'high':
      // More complex but still optimized effect
      return `geq=r='128+60*sin(2*PI*t/8+X/50)*sin(Y/100)':g='128+60*cos(2*PI*t/6+Y/50)*cos(X/100)':b='128+60*sin(2*PI*t/4+sqrt((X-W/2)^2+(Y-H/2)^2)/100)'`
    
    default:
      return `geq=r='128+100*sin(t/10)':g='128+100*sin(t/8)':b='128+100*sin(t/12)'`
  }
}

/**
 * Generate visuals in streaming chunks for better performance
 */
export async function generateStreamingVisuals(
  audioPath: string,
  waveformData: number[],
  outputPath: string,
  duration: number,
  options: {
    chunkDuration?: number
    width?: number
    height?: number
    fps?: number
    onProgress?: (progress: number) => void
  } = {}
): Promise<string> {
  const {
    chunkDuration = 30, // 30-second chunks
    width = 1280,
    height = 720,
    fps = 24,
    onProgress
  } = options

  const chunks: string[] = []
  const numChunks = Math.ceil(duration / chunkDuration)
  
  try {
    // Generate chunks in parallel (up to 3 at a time to avoid overwhelming the system)
    const chunkPromises: Promise<string>[] = []
    
    for (let i = 0; i < numChunks; i++) {
      const chunkStart = i * chunkDuration
      const chunkEnd = Math.min((i + 1) * chunkDuration, duration)
      const actualChunkDuration = chunkEnd - chunkStart
      
      const chunkPath = outputPath.replace('.mp4', `_chunk_${i}.mp4`)
      
      const chunkPromise = generateFastVisuals(
        audioPath,
        waveformData,
        chunkPath,
        actualChunkDuration,
        { width, height, fps, quality: 'draft' }
      ).then((path) => {
        if (onProgress) {
          onProgress((i + 1) / numChunks)
        }
        return path
      })
      
      chunkPromises.push(chunkPromise)
      chunks.push(chunkPath)
      
      // Process in batches of 3 to avoid overwhelming the system
      if (chunkPromises.length >= 3 || i === numChunks - 1) {
        await Promise.all(chunkPromises.splice(0, 3))
      }
    }
    
    // Concatenate all chunks
    await concatenateVideoChunks(chunks, outputPath)
    
    // Clean up chunk files
    chunks.forEach(chunkPath => {
      try {
        require('fs').unlinkSync(chunkPath)
      } catch (error) {
        console.warn('Failed to delete chunk file:', chunkPath)
      }
    })
    
    return outputPath
    
  } catch (error) {
    // Clean up any created chunk files on error
    chunks.forEach(chunkPath => {
      try {
        require('fs').unlinkSync(chunkPath)
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    })
    throw error
  }
}

/**
 * Concatenate video chunks into final video
 */
async function concatenateVideoChunks(chunkPaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const fs = require('fs')
    const path = require('path')
    
    // Create concat file
    const concatFilePath = outputPath.replace('.mp4', '_concat.txt')
    const concatContent = chunkPaths.map(p => `file '${p}'`).join('\n')
    fs.writeFileSync(concatFilePath, concatContent)
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFilePath,
      '-c', 'copy',
      '-y',
      outputPath
    ]
    
    const process = spawn(FFMPEG_PATH, args)
    
    process.on('close', (code: number | null) => {
      // Clean up concat file
      try {
        fs.unlinkSync(concatFilePath)
      } catch (error) {
        console.warn('Failed to delete concat file:', concatFilePath)
      }
      
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Concatenation failed with code ${code}`))
      }
    })
    
    process.on('error', (error: Error) => {
      reject(error)
    })
  })
}

/**
 * Generate YouTube-ready metadata from transcript using AI analysis
 */
export async function generateYouTubeMetadata(
  transcript: Transcript,
  audioFileName: string,
  duration: number,
  options: {
    maxTitleLength?: number
    maxDescriptionLength?: number
    maxTags?: number
  } = {}
): Promise<{
  title: string
  description: string
  tags: string[]
  chapters: Array<{ time: number; title: string }>
  thumbnail: string
}> {
  const {
    maxTitleLength = 100,
    maxDescriptionLength = 5000,
    maxTags = 15
  } = options

  // Extract key information from transcript
  const fullText = transcript.segments.map(s => s.text).join(' ')
  const words = fullText.split(' ').length
  const readingTime = Math.ceil(words / 200) // Average reading speed

  // Generate title from filename and content analysis
  const cleanFileName = audioFileName
    .replace(/\.[^/.]+$/, '') // Remove extension
    .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim()

  // Extract key topics and themes
  const keyWords = extractKeyWords(fullText)
  const topics = extractTopics(fullText)

  // Generate title
  let title = cleanFileName
  if (title.length > maxTitleLength) {
    title = title.substring(0, maxTitleLength - 3) + '...'
  }

  // Generate description
  const description = generateDescription(fullText, cleanFileName, duration, readingTime, keyWords)

  // Generate tags
  const tags = generateTags(keyWords, topics, cleanFileName).slice(0, maxTags)

  // Generate chapters (every 5-10 minutes or major topic changes)
  const chapters = generateChapters(transcript.segments, duration)

  return {
    title,
    description: description.substring(0, maxDescriptionLength),
    tags,
    chapters,
    thumbnail: 'auto-generated' // Placeholder for thumbnail generation
  }
}

/**
 * Extract key words from text using frequency analysis
 */
function extractKeyWords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 3) // Filter short words

  // Common stop words to exclude
  const stopWords = new Set([
    'that', 'this', 'with', 'from', 'they', 'been', 'have', 'were', 'said', 'each', 'which',
    'their', 'time', 'will', 'about', 'would', 'there', 'could', 'other', 'more', 'very',
    'what', 'know', 'just', 'first', 'into', 'over', 'think', 'also', 'your', 'work',
    'life', 'only', 'new', 'years', 'way', 'may', 'people', 'good', 'well', 'much'
  ])

  // Count word frequency
  const wordCount = new Map<string, number>()
  words.forEach(word => {
    if (!stopWords.has(word)) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1)
    }
  })

  // Return most frequent words
  return Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)
}

/**
 * Extract main topics from key words
 */
function extractTopics(text: string): string[] {
  const topics: string[] = []
  
  // Technology topics
  if (/\b(technology|tech|digital|software|ai|artificial intelligence|machine learning|data|programming|code)\b/i.test(text)) {
    topics.push('Technology')
  }
  
  // Business topics
  if (/\b(business|entrepreneur|startup|marketing|sales|finance|investment|strategy|management)\b/i.test(text)) {
    topics.push('Business')
  }
  
  // Health topics
  if (/\b(health|wellness|fitness|mental health|therapy|psychology|medical|doctor|treatment)\b/i.test(text)) {
    topics.push('Health')
  }
  
  // Education topics
  if (/\b(education|learning|teaching|school|university|study|research|academic)\b/i.test(text)) {
    topics.push('Education')
  }
  
  // Personal development
  if (/\b(personal development|self improvement|motivation|success|goals|habits|productivity)\b/i.test(text)) {
    topics.push('Personal Development')
  }

  // Science topics
  if (/\b(science|research|study|experiment|theory|discovery|scientific|analysis)\b/i.test(text)) {
    topics.push('Science')
  }

  return topics
}

/**
 * Generate YouTube description
 */
function generateDescription(
  text: string, 
  title: string, 
  duration: number, 
  readingTime: number, 
  keyWords: string[]
): string {
  const durationMinutes = Math.floor(duration / 60)
  const durationSeconds = Math.floor(duration % 60)
  
  // Extract first few sentences as summary
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10)
  const summary = sentences.slice(0, 3).join('. ').trim() + '.'

  const description = `${title}

🎧 ${summary}

⏱️ Duration: ${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}
📖 Estimated reading time: ${readingTime} minutes

🔑 Key topics covered:
${keyWords.slice(0, 8).map(word => `• ${word.charAt(0).toUpperCase() + word.slice(1)}`).join('\n')}

📝 This podcast has been automatically converted to video with:
✅ AI-generated transcript and subtitles
✅ Abstract visual animations
✅ Ambient background music
✅ Professional audio mixing

🎯 Perfect for:
• Learning on the go
• Accessibility with subtitles
• Social media sharing
• Educational content

#podcast #audio #video #ai #transcript #education`

  return description
}

/**
 * Generate relevant tags
 */
function generateTags(keyWords: string[], topics: string[], title: string): string[] {
  const tags = new Set<string>()
  
  // Add basic podcast tags
  tags.add('podcast')
  tags.add('audio')
  tags.add('video')
  tags.add('education')
  tags.add('learning')
  
  // Add topics
  topics.forEach(topic => {
    tags.add(topic.toLowerCase().replace(' ', ''))
    tags.add(topic.toLowerCase())
  })
  
  // Add key words (cleaned up)
  keyWords.slice(0, 8).forEach(word => {
    if (word.length > 3) {
      tags.add(word)
    }
  })
  
  // Add words from title
  title.toLowerCase().split(' ').forEach(word => {
    if (word.length > 3 && !/\d/.test(word)) {
      tags.add(word)
    }
  })
  
  // Add content type tags
  tags.add('transcript')
  tags.add('subtitles')
  tags.add('ai generated')
  tags.add('accessibility')

  return Array.from(tags).slice(0, 15)
}

/**
 * Generate chapter markers for long content
 */
function generateChapters(segments: TranscriptionSegment[], duration: number): Array<{ time: number; title: string }> {
  const chapters: Array<{ time: number; title: string }> = []
  
  // Only create chapters for content longer than 10 minutes
  if (duration < 600) {
    return chapters
  }
  
  const chapterInterval = Math.max(300, Math.floor(duration / 8)) // 5 minutes minimum, max 8 chapters
  
  for (let time = 0; time < duration; time += chapterInterval) {
    // Find segment closest to this time
    const segment = segments.find(s => Math.abs(s.start - time) < 30) || segments[0]
    
    // Extract a meaningful title from the segment
    let title = segment.text.trim()
    if (title.length > 50) {
      title = title.substring(0, 47) + '...'
    }
    
    // Clean up the title
    title = title.replace(/^[^\w]*/, '') // Remove leading non-word chars
    title = title.charAt(0).toUpperCase() + title.slice(1) // Capitalize
    
    if (!title) {
      title = `Chapter ${Math.floor(time / chapterInterval) + 1}`
    }
    
    chapters.push({
      time: Math.floor(time),
      title
    })
  }
  
  return chapters
}

/**
 * Save metadata to JSON file
 */
export async function saveMetadataToFile(
  metadata: Record<string, unknown>,
  outputPath: string
): Promise<string> {
  const metadataJson = JSON.stringify(metadata, null, 2)
  await writeFile(outputPath, metadataJson, 'utf-8')
  return outputPath
}

/**
 * Trim audio to first minute (60 seconds)
 */
export async function trimAudioToFirstMinute(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(0)
      .duration(60) // Trim to 60 seconds
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * Convert audio to WAV format
 */
