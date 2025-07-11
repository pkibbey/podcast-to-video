import ffmpeg from 'fluent-ffmpeg'
import { safeDeleteFile } from './audioProcessing'

// Configure FFmpeg path (same as audioProcessing.ts)
const FFMPEG_PATH = '/opt/homebrew/bin/ffmpeg'
const FFPROBE_PATH = '/opt/homebrew/bin/ffprobe'

ffmpeg.setFfmpegPath(FFMPEG_PATH)
ffmpeg.setFfprobePath(FFPROBE_PATH)

export interface VideoOptions {
  width?: number
  height?: number
  fps?: number
  bitrate?: string
  preset?: string
  crf?: number
}

export interface VisualStyle {
  type: 'mandelbrot' | 'particles' | 'waveform' | 'gradient'
  colors: string[]
  intensity: number
  speed: number
}

/**
 * Combine audio, visuals, and subtitles into final video
 */
export async function assembleVideo(
  audioPath: string,
  visualsPath: string,
  subtitlesPath: string,
  outputPath: string,
  options: VideoOptions = {}
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  const {
    width = 1920,
    height = 1080,
    fps = 30,
    bitrate = '4000k',
    preset = 'medium',
    crf = 23
  } = options

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioPath)
      .input(visualsPath)
      .input(subtitlesPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-pix_fmt', 'yuv420p',
        '-preset', preset,
        '-crf', crf.toString(),
        '-b:v', bitrate,
        '-c:s', 'mov_text' // For subtitle track
      ])
      .size(`${width}x${height}`)
      .fps(fps)
      .format('mp4')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * Generate waveform-based visuals with particle effects
 */
export async function generateWaveformVisuals(
  audioPath: string,
  waveformData: number[],
  outputPath: string,
  duration: number,
  style: VisualStyle,
  options: VideoOptions = {}
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  const {
    width = 1920,
    height = 1080,
    fps = 30
  } = options

  return new Promise((resolve, reject) => {
    let complexFilter: string[] = []

    switch (style.type) {
      case 'mandelbrot':
        complexFilter = [
          `mandelbrot=s=${width}x${height}:maxiter=100:rate=${fps}:outer=normalized_iteration_count[mandel]`,
          `[mandel]hue=h=t*${style.speed * 60}:s=${style.intensity}[colored]`,
          `[colored]gblur=sigma=${2 * style.intensity}[blurred]`
        ]
        break

      case 'particles':
        // Create multiple particle layers
        complexFilter = [
          `color=c=black:s=${width}x${height}:d=${duration}[bg]`,
          `[bg]geq=r='128+64*sin(2*PI*T/${3/style.speed}+X/50)*${style.intensity}':g='128+64*cos(2*PI*T/${4/style.speed}+Y/50)*${style.intensity}':b='128+64*sin(2*PI*T/${2/style.speed}+sqrt((X-W/2)^2+(Y-H/2)^2)/30)*${style.intensity}'[particles]`
        ]
        break

      case 'waveform':
        complexFilter = [
          `color=c=0x1a1a1a:s=${width}x${height}:d=${duration}[bg]`,
          `[bg]drawgraph=m1='${waveformData.join('|')}':fg1=0x${style.colors[0]?.replace('#', '') || 'FFFFFF'}:s=${width}x${height}:flags=2[waveform]`,
          `[waveform]hue=h=t*${style.speed * 30}:s=${style.intensity}[colored]`
        ]
        break

      case 'gradient':
        complexFilter = [
          `color=c=black:s=${width}x${height}:d=${duration}[bg]`,
          `[bg]geq=r='128+127*sin(2*PI*T/${5/style.speed})*${style.intensity}':g='128+127*cos(2*PI*T/${3/style.speed})*${style.intensity}':b='128+127*sin(2*PI*T/${4/style.speed})*${style.intensity}'[gradient]`
        ]
        break
    }

    const finalFilter = complexFilter[complexFilter.length - 1].split('[')[1].split(']')[0]

    ffmpeg()
      .input(`color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`)
      .inputFormat('lavfi')
      .complexFilter(complexFilter)
      .map(`[${finalFilter}]`)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '23'
      ])
      .format('mp4')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * Add subtitle overlay to video
 */
export async function addSubtitlesToVideo(
  videoPath: string,
  subtitlesPath: string,
  outputPath: string,
  options: {
    fontsize?: number
    fontcolor?: string
    fontfile?: string
    bordercolor?: string
    borderw?: number
  } = {}
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  const {
    fontsize = 24,
    fontcolor = 'white',
    bordercolor = 'black',
    borderw = 2
  } = options

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoFilters([
        `subtitles=${subtitlesPath}:force_style='FontSize=${fontsize},PrimaryColour=&H${fontcolor === 'white' ? 'FFFFFF' : '000000'}&,OutlineColour=&H${bordercolor === 'black' ? '000000' : 'FFFFFF'}&,BorderStyle=1,Outline=${borderw}'`
      ])
      .videoCodec('libx264')
      .audioCodec('copy')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

/**
 * Combine audio and video with ducking (lower music volume during speech)
 */
export async function combineAudioWithDucking(
  primaryAudioPath: string,
  backgroundMusicPath: string,
  outputPath: string,
  options: {
    musicVolume?: number
    duckingThreshold?: number
    duckingRatio?: number
    attackTime?: number
    releaseTime?: number
  } = {}
): Promise<string> {
  // Delete existing file if it exists
  await safeDeleteFile(outputPath)
  
  const {
    musicVolume = 0.3,
    duckingThreshold = -20,
    duckingRatio = 4,
    attackTime = 0.1,
    releaseTime = 0.5
  } = options

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(primaryAudioPath)
      .input(backgroundMusicPath)
      .complexFilter([
        `[1]volume=${musicVolume}[music]`,
        `[0][music]sidechaincompress=threshold=${duckingThreshold}dB:ratio=${duckingRatio}:attack=${attackTime}:release=${releaseTime}[ducked]`
      ])
      .map('[ducked]')
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}
