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
    // Create a complex filter for abstract visuals using FFmpeg's lavfi filters
    const complexFilter = [
      // Create base color gradient background
      `color=c=0x1a1a1a:s=${width}x${height}:d=${duration}[bg]`,
      
      // Create multiple particle systems with different behaviors
      `[bg]geq=r='128+64*sin(2*PI*T/3+X/50)':g='128+64*cos(2*PI*T/4+Y/50)':b='128+64*sin(2*PI*T/2+sqrt((X-W/2)^2+(Y-H/2)^2)/30)'[particles1]`,
      
      // Add waveform-responsive effects
      `[particles1]geq=r='r(X,Y)+32*${waveformData.map((v, i) => `(T>=${i*duration/waveformData.length})*${Math.floor(v*255)}`).join('+')}':g='g(X,Y)':b='b(X,Y)'[responsive]`,
      
      // Add flowing wave patterns
      `[responsive]geq=r='r(X,Y)+16*sin(2*PI*(X+T*100)/200)*cos(2*PI*(Y+T*50)/150)':g='g(X,Y)+16*cos(2*PI*(X+T*80)/180)*sin(2*PI*(Y+T*60)/120)':b='b(X,Y)+16*sin(2*PI*(X+T*120)/160)*cos(2*PI*(Y+T*90)/140)'[waves]`,
      
      // Add central waveform visualization
      `[waves]drawgraph=m1='${waveformData.join('|')}':fg1=0xFFFFFF:s=${width}x${height}:flags=2[final]`
    ]

    ffmpeg()
      .input(`color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`)
      .inputFormat('lavfi')
      .complexFilter(complexFilter)
      .map('[final]')
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '23'
      ])
      .format('mp4')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        console.error('Visual generation error:', err)
        reject(err)
      })
      .run()
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
    // Create a simpler but more reliable visual using basic FFmpeg filters
    const filters = [
      // Create animated gradient background
      `mandelbrot=s=${width}x${height}:maxiter=100:rate=${fps}:outer=normalized_iteration_count`,
      
      // Add color cycling
      'hue=h=t*60:s=sin(t)+1',
      
      // Add some blur for smoother effect
      'gblur=sigma=2',
      
      // Adjust opacity and blend
      'format=yuva420p,colorchannelmixer=aa=0.8'
    ]

    ffmpeg()
      .input(`mandelbrot=s=${width}x${height}:maxiter=100:rate=${fps}:outer=normalized_iteration_count`)
      .inputFormat('lavfi')
      .videoFilters(filters)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '23',
        `-t`, duration.toString()
      ])
      .format('mp4')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        console.error('Simple visual generation error:', err)
        reject(err)
      })
      .run()
  })
}
