import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { writeFile, readFile, unlink, access } from 'fs/promises'
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
 * Generate a chill ambient soundtrack by trying multiple sources in order:
 * 1. Free music from Freesound API
 * 2. Local music files
 * 3. Synthetic generation as fallback
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @param musicDir Directory containing chill music tracks
 * @returns outputPath
 */
export async function generateChillSoundtrackFromLocal(duration: number, outputPath: string, musicDir: string = path.join(process.cwd(), 'assets', 'music')): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  console.log(`🎵 Generating ${duration}s of ambient music...`)
  
  try {
    // First priority: Try to get free music from Freesound
    console.log('🌐 Attempting to download free ambient music from Freesound...')
    const styles: Array<'ambient' | 'chill' | 'drone' | 'pad'> = ['ambient', 'chill', 'drone', 'pad']
    const randomStyle = styles[Math.floor(Math.random() * styles.length)]
    
    try {
      const tempPath = outputPath.replace('.wav', '-freesound-temp.wav')
      await downloadFreeAmbientMusic(duration, tempPath, randomStyle)
      
      // Optimize for podcast mixing
      await optimizeMusicForPodcast(tempPath, '', outputPath)
      
      // Clean up temp file
      try {
        await (await import('fs/promises')).unlink(tempPath)
      } catch (e) {
        console.log('Note: Could not clean up temp file:', tempPath)
      }
      
      console.log('✅ Successfully used Freesound music!')
      return outputPath
      
    } catch (freesoundError) {
      console.log('⚠️ Freesound download failed, trying local files...', freesoundError instanceof Error ? freesoundError.message : String(freesoundError))
      
      // Second priority: Try local music files
      try {
        const files = await (await import('fs/promises')).readdir(musicDir)
        const musicFiles = files.filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.aac') || f.endsWith('.flac') || f.endsWith('.ogg'))
        
        if (musicFiles.length > 0) {
          console.log(`🎵 Found ${musicFiles.length} local music files, using local source...`)
          
          // Pick a random file
          const musicFile = musicFiles[Math.floor(Math.random() * musicFiles.length)]
          const inputPath = path.join(musicDir, musicFile)
          console.log(`Using local music file: ${musicFile}`)
          
          // Use FFmpeg to loop and trim the music to the desired duration, then optimize
          return new Promise((resolve, reject) => {
            const tempPath = outputPath.replace('.wav', '-local-temp.wav')
            
            ffmpeg()
              .input(inputPath)
              .inputOptions(['-stream_loop', '-1']) // infinite loop
              .audioCodec('pcm_s16le')
              .audioChannels(2)
              .audioFrequency(44100)
              .format('wav')
              .duration(duration)
              .output(tempPath)
              .on('end', async () => {
                try {
                  console.log('✅ Local music file processed, optimizing for podcast...')
                  // Optimize for podcast mixing
                  await optimizeMusicForPodcast(tempPath, '', outputPath)
                  
                  // Clean up temp file
                  try {
                    await (await import('fs/promises')).unlink(tempPath)
                  } catch (e) {
                    console.log('Note: Could not clean up temp file:', tempPath)
                  }
                  
                  console.log('✅ Successfully used local music!')
                  resolve(outputPath)
                } catch (error) {
                  reject(error)
                }
              })
              .on('error', reject)
              .run()
          })
        } else {
          throw new Error('No local music files found')
        }
      } catch (localError) {
        console.log('⚠️ Local music processing failed, falling back to synthetic generation...', localError instanceof Error ? localError.message : String(localError))
        
        // Final fallback: Generate synthetic ambient music
        console.log('🎹 Generating synthetic ambient music...')
        const tempPath = outputPath.replace('.wav', '-synthetic-temp.wav')
        await generateEnhancedAmbientMusic(duration, tempPath, randomStyle === 'chill' ? 'warm' : randomStyle === 'pad' ? 'ethereal' : 'minimal')
        await optimizeMusicForPodcast(tempPath, '', outputPath)
        
        // Clean up temp file
        try {
          await (await import('fs/promises')).unlink(tempPath)
        } catch (e) {
          console.log('Note: Could not clean up temp file:', tempPath)
        }
        
        console.log('✅ Successfully generated synthetic music!')
        return outputPath
      }
    }
  } catch (error) {
    console.error('❌ All music generation methods failed:', error)
    throw new Error(`Unable to generate background music: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Generate ambient music using FFmpeg's built-in synthesizers (no external dependencies)
 * Creates pleasant, harmonic ambient music suitable for podcast backgrounds
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @returns outputPath
 */
export async function generateAmbientWithFFmpeg(duration: number, outputPath: string): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  return new Promise((resolve, reject) => {
    console.log(`Generating ${duration}s of ambient music with FFmpeg...`)
    
    // Create a simple but effective ambient track with audible volume levels
    // Using C major chord (C, E, G) with octaves for pleasant harmony
    ffmpeg()
      // Low C (130.81 Hz)
      .input(`sine=frequency=130.81:duration=${duration}`)
      .inputFormat('lavfi')
      // E (164.81 Hz) - major third
      .input(`sine=frequency=164.81:duration=${duration}`)
      .inputFormat('lavfi')
      // G (196 Hz) - perfect fifth
      .input(`sine=frequency=196:duration=${duration}`)
      .inputFormat('lavfi')
      // High C (261.63 Hz) - octave
      .input(`sine=frequency=261.63:duration=${duration}`)
      .inputFormat('lavfi')
      .complexFilter([
        // Simple volume control with reverb for each layer
        '[0]volume=0.8,aecho=0.5:0.7:500:0.2[bass]',
        '[1]volume=0.6,aecho=0.5:0.7:700:0.3[third]',
        '[2]volume=0.5,aecho=0.5:0.7:900:0.3[fifth]',
        '[3]volume=0.4,aecho=0.5:0.7:1100:0.3[octave]',
        // Mix with simple amix and final volume boost
        '[bass][third][fifth][octave]amix=inputs=4:duration=first[mixed]',
        '[mixed]volume=2.0[out]'
      ])
      .map('[out]')
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('wav')
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Ambient music generation completed')
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error('FFmpeg ambient generation error:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Generate enhanced ambient music with multiple style variations
 * @param duration Duration in seconds
 * @param outputPath Path to save the generated soundtrack (WAV)
 * @param style Style of ambient music ('warm', 'ethereal', 'minimal', 'cosmic')
 * @returns outputPath
 */
export async function generateEnhancedAmbientMusic(
  duration: number, 
  outputPath: string, 
  style: 'warm' | 'ethereal' | 'minimal' | 'cosmic' = 'warm'
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  return new Promise((resolve, reject) => {
    console.log(`Generating ${duration}s of ${style} ambient music...`)
    
    let filterComplex: string[]
    
    switch (style) {
      case 'warm':
        // Warm, enveloping sound with rich harmonics
        filterComplex = [
          '[0]volume=1.0,aecho=0.5:0.7:800:0.3[bass]',
          '[1]volume=0.8,aecho=0.5:0.7:1000:0.3[mid]',
          '[2]volume=0.6,aecho=0.5:0.7:1200:0.3[high]',
          '[3]volume=0.5,aecho=0.5:0.7:600:0.2[texture]',
          '[4]volume=0.3[sparkle]',
          '[5]volume=0.1,highpass=f=200,lowpass=f=2000[noise]',
          '[bass][mid][high][texture][sparkle][noise]amix=inputs=6:duration=first[mixed]',
          '[mixed]volume=1.5[out]'
        ]
        break
        
      case 'ethereal':
        // Light, floating, dreamlike quality
        filterComplex = [
          '[0]volume=0.8,aecho=0.6:0.8:1200:0.4[foundation]',
          '[1]volume=0.7,aecho=0.6:0.8:1400:0.4[floating]',
          '[2]volume=0.6,aecho=0.6:0.8:1600:0.5[ethereal]',
          '[3]volume=0.5,aecho=0.6:0.8:1800:0.5[shimmer]',
          '[4]volume=0.4,aecho=0.6:0.8:2000:0.6[crystal]',
          '[5]volume=0.08,highpass=f=400,lowpass=f=4000[air]',
          '[foundation][floating][ethereal][shimmer][crystal][air]amix=inputs=6:duration=first[mixed]',
          '[mixed]volume=1.3[out]'
        ]
        break
        
      case 'minimal':
        // Clean, spacious, minimal approach
        filterComplex = [
          '[0]volume=1.2,aecho=0.4:0.6:600:0.2[bass]',
          '[1]volume=0.9,aecho=0.4:0.6:800:0.2[fifth]',
          '[2]volume=0.6,aecho=0.4:0.6:1000:0.3[high]',
          '[3]volume=0.4[mod]',
          '[4]volume=0.2[subtle]',
          '[5]volume=0.05,highpass=f=300,lowpass=f=1500[texture]',
          '[bass][fifth][high][mod][subtle][texture]amix=inputs=6:duration=first[mixed]',
          '[mixed]volume=1.4[out]'
        ]
        break
        
      case 'cosmic':
        // Expansive, space-like atmosphere
        filterComplex = [
          '[0]volume=1.0,aecho=0.7:0.8:1500:0.5[space]',
          '[1]volume=0.8,aecho=0.7:0.8:1800:0.5[cosmic]',
          '[2]volume=0.7,aecho=0.7:0.8:2100:0.6[stellar]',
          '[3]volume=0.6,aecho=0.7:0.8:1200:0.4[nebula]',
          '[4]volume=0.4,aecho=0.7:0.8:2400:0.7[stars]',
          '[5]volume=0.1,highpass=f=150,lowpass=f=3000[wind]',
          '[space][cosmic][stellar][nebula][stars][wind]amix=inputs=6:duration=first[mixed]',
          '[mixed]volume=1.2[out]'
        ]
        break
    }

    // Base frequencies for each style (all based on harmonic ratios)
    const frequencies = {
      warm: [98.00, 146.83, 195.99, 261.63, 329.63],      // G2, D3, G3, C4, E4
      ethereal: [110.00, 164.81, 220.00, 329.63, 440.00], // A2, E3, A3, E4, A4  
      minimal: [87.31, 130.81, 196.00, 261.63, 392.00],   // F2, C3, G3, C4, G4
      cosmic: [65.41, 98.00, 130.81, 174.61, 261.63]      // C2, G2, C3, F3, C4
    }

    const freqs = frequencies[style]

    ffmpeg()
      .input(`sine=frequency=${freqs[0]}:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=${freqs[1]}:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=${freqs[2]}:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=${freqs[3]}:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`sine=frequency=${freqs[4]}:duration=${duration}`)
      .inputFormat('lavfi')
      .input(`anoisesrc=colour=pink:sample_rate=44100:duration=${duration}`)
      .inputFormat('lavfi')
      .complexFilter(filterComplex)
      .map('[out]')
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('wav')
      .output(outputPath)
      .on('end', () => {
        console.log(`✅ ${style} ambient music generation completed`)
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error(`FFmpeg ${style} ambient generation error:`, err)
        reject(err)
      })
      .run()
  })
}

/**
 * Optimize ambient music for podcast mixing by analyzing the vocal content
 * and adjusting frequency response to avoid conflicts
 * @param musicPath Path to the generated ambient music
 * @param vocalAudioPath Path to the podcast audio (for analysis)
 * @param outputPath Path to save the optimized music
 * @returns outputPath
 */
export async function optimizeMusicForPodcast(
  musicPath: string, 
  vocalAudioPath: string, 
  outputPath: string
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  return new Promise((resolve, reject) => {
    console.log('Optimizing ambient music for podcast mixing...')
    
    ffmpeg()
      .input(musicPath)
      // Apply gentle EQ to reduce frequency conflicts with speech
      // Speech is typically 85Hz-8kHz, with intelligibility in 500Hz-4kHz
      .audioFilters([
        // High-pass to remove sub-bass that competes with voice fundamentals
        'highpass=f=100',
        // Gentle notch around speech clarity range (1.5-3kHz)
        'equalizer=f=2000:width_type=h:width=2:g=-2',
        // Slight reduction in upper mids where sibilance occurs
        'equalizer=f=4500:width_type=h:width=1.5:g=-1',
        // Keep volume level intact - just preserve the existing level
        'volume=1.0'
      ])
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('wav')
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Music optimization for podcast mixing completed')
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error('Music optimization error:', err)
        reject(err)
      })
      .run()
  })
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  const metadataJson = JSON.stringify(metadata, null, 2)
  await writeFile(outputPath, metadataJson, 'utf-8')
  return outputPath
}

/**
 * Trim audio to first minute (60 seconds)
 */
export async function trimAudioToFirstMinute(inputPath: string, outputPath: string): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
export async function convertAudioToWav(inputPath: string, outputPath: string): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
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
 * Download audio file from URL
 */
export async function downloadAudioFile(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download audio file: ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  await writeFile(outputPath, buffer)
  return outputPath
}

/**
 * Search and download free ambient music from Freesound API
 * @param duration Duration in seconds (used for filtering)
 * @param outputPath Path to save the downloaded music
 * @param style Optional style preference ('ambient', 'chill', 'drone', 'pad')
 * @returns outputPath
 */
export async function downloadFreeAmbientMusic(
  duration: number,
  outputPath: string,
  style: 'ambient' | 'chill' | 'drone' | 'pad' = 'ambient'
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  console.log(`🎵 Searching for free ${style} music (${duration}s duration)...`)
  
  try {
    // Check for Freesound API key in environment
    const apiKey = process.env.FREESOUND_API_KEY
    if (!apiKey) {
      console.log('⚠️ No FREESOUND_API_KEY found in environment, trying fallback sources...')
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    // Check basic network connectivity first
    console.log('🌐 Checking network connectivity...')
    const hasConnectivity = await checkNetworkConnectivity()
    if (!hasConnectivity) {
      console.log('❌ No internet connectivity detected, using fallback sources...')
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    console.log('✅ Network connectivity confirmed')
    
    // Search Freesound for appropriate ambient music with better search terms
    const searchTerms = {
      ambient: 'ambient atmospheric',
      chill: 'chill lofi',
      drone: 'drone pad',
      pad: 'pad atmospheric'
    }
    
    const query = searchTerms[style]
    const minDuration = Math.max(10, Math.min(duration * 0.3, 60)) // 10s minimum, up to 60s
    const maxDuration = Math.max(duration * 3, 180) // At least 3x duration or 3 minutes
    
    // Improved Freesound API search with proper authentication and better filters
    const searchParams = new URLSearchParams({
      query: query,
      filter: `duration:[${minDuration} TO ${maxDuration}] AND (tag:loop OR tag:ambient OR tag:background OR tag:instrumental) AND (license:"Creative Commons 0" OR license:"Attribution")`,
      fields: 'id,name,duration,previews,license,tags,username',
      page_size: '50',
      sort: 'downloads_desc',
      token: apiKey // Add API key as URL parameter
    })
    
    const searchUrl = `https://freesound.org/apiv2/search/text/?${searchParams.toString()}`
    
    console.log(`🔍 Freesound search: ${query} (${minDuration}-${maxDuration}s)`)
    
    // Add retry logic with timeout handling
    let response: Response | undefined
    let retryCount = 0
    const maxRetries = 3
    
    while (retryCount < maxRetries) {
      try {
        console.log(`📡 Attempting Freesound API call (attempt ${retryCount + 1}/${maxRetries})...`)
        
        // Create AbortController for timeout handling
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000) // 20 second timeout
        
        response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'PodcastToVideo/1.0 (Educational Use)'
          },
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        
        if (response.ok) {
          console.log(`✅ Freesound API responded successfully`)
          break
        } else {
          console.log(`⚠️ Freesound API returned ${response.status}: ${response.statusText}`)
          throw new Error(`API returned ${response.status}`)
        }
        
      } catch (error: any) {
        retryCount++
        console.log(`❌ Freesound API attempt ${retryCount} failed:`, error.message)
        
        if (retryCount >= maxRetries) {
          console.log(`❌ All ${maxRetries} attempts failed, trying fallback sources...`)
          return await tryFallbackMusicSources(duration, outputPath, style)
        }
        
        // Wait before retrying (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000) // Max 5 seconds
        console.log(`⏳ Waiting ${waitTime}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
    
    // Check if we have a valid response
    if (!response || !response.ok) {
      console.log(`❌ No valid response from Freesound after ${maxRetries} attempts`)
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    const data = await response.json()
    console.log(`📊 Found ${data.count || 0} tracks, showing ${data.results?.length || 0}`)
    
    if (!data.results || data.results.length === 0) {
      console.log('❌ No tracks found on Freesound, trying fallback sources...')
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    // Filter results to prefer Creative Commons tracks and tracks with previews
    const suitableTracks = data.results.filter((track: any) => {
      const hasPreview = track.previews && (track.previews['preview-hq-mp3'] || track.previews['preview-lq-mp3'])
      const isCreativeCommons = track.license && track.license.includes('Creative Commons')
      const hasGoodTags = track.tags && (
        track.tags.includes('loop') || 
        track.tags.includes('ambient') || 
        track.tags.includes('background') ||
        track.tags.includes('instrumental')
      )
      
      return hasPreview && (isCreativeCommons || hasGoodTags)
    })
    
    if (suitableTracks.length === 0) {
      console.log('❌ No suitable tracks with previews found, trying fallback...')
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    // Pick a random track from the suitable ones
    const randomIndex = Math.floor(Math.random() * Math.min(suitableTracks.length, 10))
    const selectedTrack = suitableTracks[randomIndex]
    
    console.log(`✅ Selected: "${selectedTrack.name}" (${selectedTrack.duration}s)`)
    console.log(`📄 License: ${selectedTrack.license || 'Unknown'}`)
    
    // Try to download the preview
    const previewUrl = selectedTrack.previews['preview-hq-mp3'] || selectedTrack.previews['preview-lq-mp3']
    
    if (!previewUrl) {
      console.log('❌ No preview URL available, trying next track...')
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    console.log('⬇️ Downloading audio preview...')
    
    // Download the audio file with retry logic and timeout handling
    let audioResponse: Response | undefined
    let downloadRetryCount = 0
    const maxDownloadRetries = 2
    
    while (downloadRetryCount < maxDownloadRetries) {
      try {
        console.log(`📥 Downloading preview (attempt ${downloadRetryCount + 1}/${maxDownloadRetries})...`)
        
        // Create AbortController for download timeout
        const downloadController = new AbortController()
        const downloadTimeoutId = setTimeout(() => downloadController.abort(), 30000) // 30 second timeout for download
        
        audioResponse = await fetch(previewUrl, {
          headers: {
            'User-Agent': 'PodcastToVideo/1.0 (Educational Use)'
          },
          signal: downloadController.signal
        })
        
        clearTimeout(downloadTimeoutId)
        
        if (audioResponse.ok) {
          console.log(`✅ Preview download successful`)
          break
        } else {
          throw new Error(`Download failed: ${audioResponse.status}`)
        }
        
      } catch (error: any) {
        downloadRetryCount++
        console.log(`❌ Download attempt ${downloadRetryCount} failed:`, error.message)
        
        if (downloadRetryCount >= maxDownloadRetries) {
          console.log(`❌ All download attempts failed, trying fallback...`)
          return await tryFallbackMusicSources(duration, outputPath, style)
        }
        
        // Wait before retrying download
        const downloadWaitTime = 2000 * downloadRetryCount // 2s, 4s
        console.log(`⏳ Waiting ${downloadWaitTime}ms before download retry...`)
        await new Promise(resolve => setTimeout(resolve, downloadWaitTime))
      }
    }
    
    if (!audioResponse || !audioResponse.ok) {
      console.log(`❌ No valid audio response after ${maxDownloadRetries} attempts`)
      return await tryFallbackMusicSources(duration, outputPath, style)
    }
    
    // Save to temporary file first
    const tempMp3Path = outputPath.replace('.wav', '-freesound-temp.mp3')
    const arrayBuffer = await audioResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    await writeFile(tempMp3Path, buffer)
    console.log(`💾 Downloaded: ${path.basename(tempMp3Path)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`)
    
    // Convert to WAV and loop/trim to correct duration using FFmpeg
    return new Promise((resolve, reject) => {
      const trackDuration = selectedTrack.duration
      
      if (trackDuration >= duration) {
        // Track is long enough, just trim it
        console.log('✂️ Trimming track to desired duration...')
        ffmpeg()
          .input(tempMp3Path)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(44100)
          .format('wav')
          .duration(duration)
          .output(outputPath)
          .on('end', async () => {
            try {
              await (await import('fs/promises')).unlink(tempMp3Path)
            } catch (e) {
              console.log('Note: Could not clean up temp file:', tempMp3Path)
            }
            console.log('✅ Freesound music processed successfully!')
            resolve(outputPath)
          })
          .on('error', (err) => {
            console.error('❌ FFmpeg processing failed:', err.message)
            reject(err)
          })
          .run()
      } else {
        // Track is shorter, loop it to reach desired duration
        const loopCount = Math.ceil(duration / trackDuration)
        console.log(`🔄 Looping track ${loopCount} times to reach ${duration}s...`)
        
        ffmpeg()
          .input(tempMp3Path)
          .inputOptions(['-stream_loop', (loopCount - 1).toString()])
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(44100)
          .format('wav')
          .duration(duration)
          .output(outputPath)
          .on('end', async () => {
            try {
              await (await import('fs/promises')).unlink(tempMp3Path)
            } catch (e) {
              console.log('Note: Could not clean up temp file:', tempMp3Path)
            }
            console.log('✅ Freesound music processed successfully!')
            resolve(outputPath)
          })
          .on('error', (err) => {
            console.error('❌ FFmpeg processing failed:', err.message)
            reject(err)
          })
          .run()
      }
    })
    
  } catch (error) {
    console.error('❌ Error in Freesound download process:', error)
    console.log('🔄 Falling back to alternative music sources...')
    return await tryFallbackMusicSources(duration, outputPath, style)
  }
}

/**
 * Try fallback music sources when Freesound fails
 */
async function tryFallbackMusicSources(
  duration: number,
  outputPath: string,
  style: 'ambient' | 'chill' | 'drone' | 'pad'
): Promise<string> {
  console.log('🎼 Trying fallback music sources...')
  
  try {
    // First try: Check for local music files
    const musicDir = path.join(process.cwd(), 'assets', 'music')
    try {
      const files = (await import('fs/promises')).readdir(musicDir)
      const musicFiles = (await files).filter(f => 
        f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.aac') || 
        f.endsWith('.flac') || f.endsWith('.ogg')
      )
      
      if (musicFiles.length > 0) {
        console.log(`🎵 Found ${musicFiles.length} local music files, using local source...`)
        // Use the existing local music processing
        const musicFile = musicFiles[Math.floor(Math.random() * musicFiles.length)]
        const inputPath = path.join(musicDir, musicFile)
        
        return new Promise((resolve, reject) => {
          const tempPath = outputPath.replace('.wav', '-local-temp.wav')
          
          ffmpeg()
            .input(inputPath)
            .inputOptions(['-stream_loop', '-1']) // infinite loop
            .audioCodec('pcm_s16le')
            .audioChannels(2)
            .audioFrequency(44100)
            .format('wav')
            .duration(duration)
            .output(tempPath)
            .on('end', async () => {
              try {
                await optimizeMusicForPodcast(tempPath, '', outputPath)
                await (await import('fs/promises')).unlink(tempPath)
                console.log('✅ Local music processed successfully!')
                resolve(outputPath)
              } catch (error) {
                reject(error)
              }
            })
            .on('error', reject)
            .run()
        })
      }
    } catch (error) {
      console.log('📁 No local music directory or files found')
    }
    
    // Final fallback: Generate synthetic ambient music
    console.log('🎹 Generating synthetic ambient music...')
    const tempPath = outputPath.replace('.wav', '-synthetic-temp.wav')
    await generateEnhancedAmbientMusic(duration, tempPath, style === 'chill' ? 'warm' : style === 'pad' ? 'ethereal' : 'minimal')
    await optimizeMusicForPodcast(tempPath, '', outputPath)
    
    try {
      await (await import('fs/promises')).unlink(tempPath)
    } catch (e) {
      console.log('Note: Could not clean up temp file:', tempPath)
    }
    
    console.log('✅ Synthetic ambient music generated successfully!')
    return outputPath
    
  } catch (error) {
    console.error('❌ All fallback music sources failed:', error)
    throw new Error('Unable to generate any background music')
  }
}

/**
 * Safely delete a file if it exists
 * @param filePath Path to the file to delete
 * @returns Promise<boolean> - true if file was deleted or didn't exist, false if there was an error
 */
export async function safeDeleteFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    await unlink(filePath)
    console.log(`✅ Deleted existing file: ${path.basename(filePath)}`)
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, which is fine
      return true
    }
    console.warn(`⚠️ Could not delete file ${filePath}:`, error.message)
    return false
  }
}

/**
 * Delete multiple files safely
 * @param filePaths Array of file paths to delete
 * @returns Promise<boolean> - true if all files were deleted successfully
 */
export async function safeDeleteFiles(filePaths: string[]): Promise<boolean> {
  const results = await Promise.all(filePaths.map(safeDeleteFile))
  return results.every(result => result === true)
}

/**
 * Delete all generated files for a specific job ID
 * @param jobId The job ID to clean up files for
 * @param tempDir The temporary directory path (defaults to ./temp)
 * @returns Promise<boolean> - true if cleanup was successful
 */
export async function cleanupJobFiles(jobId: string, tempDir: string = path.join(process.cwd(), 'temp')): Promise<boolean> {
  const filesToDelete = [
    path.join(tempDir, `${jobId}-audio.wav`),
    path.join(tempDir, `${jobId}-audio.json`),
    path.join(tempDir, `${jobId}-music.wav`),
    path.join(tempDir, `${jobId}-visuals.mp4`),
    path.join(tempDir, `${jobId}-subtitles.srt`),
    path.join(tempDir, `${jobId}-mixed-audio.wav`),
    path.join(tempDir, `${jobId}-final.mp4`),
    path.join(tempDir, `${jobId}-metadata.json`)
  ]
  
  console.log(`🧹 Cleaning up existing files for job ${jobId}...`)
  const success = await safeDeleteFiles(filesToDelete)
  
  if (success) {
    console.log(`✅ Cleanup completed for job ${jobId}`)
  } else {
    console.warn(`⚠️ Some files could not be deleted for job ${jobId}`)
  }
  
  return success
}

/**
 * Check basic internet connectivity
 */
async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    // Try to reach a reliable endpoint with a short timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'HEAD',
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    return response.ok
  } catch (error) {
    return false
  }
}
