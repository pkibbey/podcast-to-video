import { ProcessingJob, TranscriptionSegment } from '@/types'
import { readFile, writeFile } from 'fs/promises'
import { readFileSync } from 'fs'
import path from 'path'
import { analyzeAudio, transcribeAudio, generateSRT, convertToWav, extractWaveform, generateChillSoundtrackFromLocal, generateAbstractVisuals, generateSimpleVisuals, assembleVideo, combineAudioWithDucking, generateYouTubeMetadata, saveMetadataToFile } from '@/utils/audioProcessing'

const JOBS_PATH = path.join(process.cwd(), 'jobs.json');

function loadJobsSync(): Map<string, ProcessingJob> {
  try {
    const data = JSON.parse(readFileSync(JOBS_PATH, 'utf-8'))
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

export const jobs = loadJobsSync()

export async function saveJobs() {
  const obj: Record<string, ProcessingJob> = {}
  for (const [k, v] of jobs.entries()) obj[k] = v
  await writeFile(JOBS_PATH, JSON.stringify(obj, null, 2), 'utf-8')
}

export async function loadJobs() {
  try {
    const data = await readFile(JOBS_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    jobs.clear()
    for (const [k, v] of Object.entries(parsed)) jobs.set(k, v as ProcessingJob)
  } catch {}
}

export async function updateJobStep(jobId: string, stepIndex: number, status: 'processing' | 'completed' | 'failed') {
  const job = jobs.get(jobId)
  if (!job) return

  const step = job.steps[stepIndex]
  step.status = status
  step.progress = status === 'completed' ? 100 : status === 'processing' ? 50 : 0
  
  if (status === 'processing') {
    step.startedAt = new Date()
    // Clear any previous error when starting/retrying
    if (step.error) {
      delete step.error
    }
  } else if (status === 'completed') {
    step.completedAt = new Date()
    // Clear any error on successful completion
    if (step.error) {
      delete step.error
    }
  }
  
  // Update overall progress
  const completedSteps = job.steps.filter(step => step.status === 'completed').length
  job.progress = Math.round((completedSteps / job.steps.length) * 100)
  jobs.set(jobId, job)
  await saveJobs()
}

export async function processAudioFile(jobId: string) {
  const job = jobs.get(jobId)
  if (!job) return
  job.status = 'processing'
  jobs.set(jobId, job)
  await saveJobs()
  try {
    // Find the step that is 'processing', or the first incomplete step
    let startStep = job.steps.findIndex(s => s.status === 'processing')
    if (startStep === -1) {
      startStep = job.steps.findIndex(s => s.status !== 'completed')
    }
    for (let i = startStep; i < job.steps.length; i++) {
      const step = job.steps[i]
      if (step.status === 'completed') continue
      if (i === 0) { // Audio Analysis
        await updateJobStep(jobId, 0, 'processing')
        const audioAnalysis = await analyzeAudio(job.audioFile.path)
        job.audioFile.duration = audioAnalysis.duration
        const waveformData = await extractWaveform(job.audioFile.path)
        audioAnalysis.waveformData = waveformData
        job.audioAnalysis = audioAnalysis
        job.steps[0].details = {
          duration: audioAnalysis.duration,
          sampleRate: audioAnalysis.sampleRate,
          channels: audioAnalysis.channels,
          bitRate: audioAnalysis.bitRate,
          format: audioAnalysis.format,
        }
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 0, 'completed')
      } else if (i === 1) { // Transcription
        await updateJobStep(jobId, 1, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const wavPath = path.join(tempDir, `${jobId}-audio.wav`)
        await convertToWav(job.audioFile.path, wavPath)
        const transcript = await transcribeAudio(wavPath)
        
        // Store transcript in job for later use in metadata generation
        job.transcript = transcript
        
        job.steps[1].details = { segmentCount: transcript.segments.length, language: transcript.language, duration: transcript.duration }
        const srtPath = path.join(tempDir, `${jobId}-subtitles.srt`)
        await generateSRT(transcript, srtPath)
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 1, 'completed')
      } else if (i === 2) { // Music Generation (real)
        await updateJobStep(jobId, 2, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
        const musicPath = path.join(tempDir, `${jobId}-music.wav`)
        await generateChillSoundtrackFromLocal(Math.ceil(duration), musicPath)
        job.steps[2].details = { info: 'Ambient music generated from local files', musicPath }
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 2, 'completed')
      } else if (i === 3) { // Visual Generation
        await updateJobStep(jobId, 3, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
        const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
        const waveformData = job.audioAnalysis?.waveformData || []
        
        try {
          // Try advanced visual generation first
          await generateAbstractVisuals(job.audioFile.path, waveformData, visualsPath, duration)
          job.steps[3].details = { 
            info: 'Abstract visuals generated with waveform synchronization', 
            visualsPath,
            duration,
            resolution: '1920x1080'
          }
        } catch (error) {
          console.log('Advanced visual generation failed, using simple visuals:', error)
          // Fallback to simpler visual generation
          await generateSimpleVisuals(duration, visualsPath, waveformData)
          job.steps[3].details = { 
            info: 'Simple abstract visuals generated', 
            visualsPath,
            duration,
            resolution: '1920x1080'
          }
        }
        
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 3, 'completed')
      } else if (i === 4) { // Video Assembly
        await updateJobStep(jobId, 4, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
        
        // Check if required files exist
        const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
        const musicPath = path.join(tempDir, `${jobId}-music.wav`)
        const subtitlesPath = path.join(tempDir, `${jobId}-subtitles.srt`)
        const finalVideoPath = path.join(tempDir, `${jobId}-final.mp4`)
        const mixedAudioPath = path.join(tempDir, `${jobId}-mixed-audio.wav`)
        
        try {
          // First combine the original audio with background music using ducking
          console.log('Combining audio with background music...')
          await combineAudioWithDucking(job.audioFile.path, musicPath, mixedAudioPath, {
            musicVolume: 0.15,
            duckingThreshold: -25,
            duckingRatio: 3,
            attackTime: 0.2,
            releaseTime: 1.0
          })
          
          // Then assemble the final video with mixed audio, visuals, and subtitles
          console.log('Assembling final video...')
          await assembleVideo(mixedAudioPath, visualsPath, subtitlesPath, finalVideoPath, {
            width: 1920,
            height: 1080,
            fps: 30,
            bitrate: '5000k',
            preset: 'medium',
            crf: 20
          })
          
          job.steps[4].details = { 
            info: 'Video assembled with audio ducking and subtitles', 
            finalVideoPath,
            mixedAudioPath,
            duration,
            resolution: '1920x1080',
            bitrate: '5000k'
          }
          
          jobs.set(jobId, job)
          await saveJobs()
          await updateJobStep(jobId, 4, 'completed')
        } catch (error) {
          console.error('Video assembly failed:', error)
          // Fallback: simple assembly without ducking
          try {
            console.log('Trying simple video assembly without ducking...')
            await assembleVideo(job.audioFile.path, visualsPath, subtitlesPath, finalVideoPath, {
              width: 1920,
              height: 1080,
              fps: 30,
              bitrate: '4000k'
            })
            
            job.steps[4].details = { 
              info: 'Video assembled (simple mode, no audio ducking)', 
              finalVideoPath,
              duration,
              resolution: '1920x1080',
              bitrate: '4000k'
            }
            
            jobs.set(jobId, job)
            await saveJobs()
            await updateJobStep(jobId, 4, 'completed')
          } catch (fallbackError) {
            console.error('Simple video assembly also failed:', fallbackError)
            throw fallbackError
          }
        }
      } else if (i === 5) { // Metadata Generation
        await updateJobStep(jobId, 5, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
        
        try {
          // Load transcript if not already in job object
          await loadTranscriptIfNeeded(jobId, job)
          
          // Generate YouTube metadata from transcript
          if (job.transcript) {
            console.log('Generating YouTube metadata from transcript...')
            const metadata = await generateYouTubeMetadata(
              job.transcript,
              job.audioFile.name,
              duration,
              {
                maxTitleLength: 100,
                maxDescriptionLength: 5000,
                maxTags: 15
              }
            )
            
            // Add resolution and duration info
            const completeMetadata = {
              ...metadata,
              duration,
              resolution: {
                width: 1920,
                height: 1080
              }
            }
            
            // Store metadata in job
            job.metadata = completeMetadata
            
            // Save metadata to file
            const metadataPath = path.join(tempDir, `${jobId}-metadata.json`)
            await saveMetadataToFile(completeMetadata, metadataPath)
            
            job.steps[5].details = { 
              info: 'YouTube metadata generated with AI analysis',
              metadataPath,
              title: metadata.title,
              tags: metadata.tags.length,
              chapters: metadata.chapters.length,
              descriptionLength: metadata.description.length
            }
          } else {
            // Fallback metadata generation without transcript
            console.log('Generating basic metadata (no transcript available)...')
            const basicMetadata = {
              title: job.audioFile.name.replace(/\.[^/.]+$/, ''),
              description: `Podcast episode converted to video\n\nDuration: ${Math.floor(duration/60)}:${Math.floor(duration%60).toString().padStart(2,'0')}\n\nThis video was automatically generated from audio content.`,
              tags: ['podcast', 'audio', 'video', 'education'],
              chapters: [],
              thumbnail: 'auto-generated',
              duration,
              resolution: { width: 1920, height: 1080 }
            }
            
            job.metadata = basicMetadata
            
            const metadataPath = path.join(tempDir, `${jobId}-metadata.json`)
            await saveMetadataToFile(basicMetadata, metadataPath)
            
            job.steps[5].details = { 
              info: 'Basic metadata generated (no transcript available)',
              metadataPath,
              title: basicMetadata.title,
              tags: basicMetadata.tags.length,
              chapters: 0
            }
          }
          
          jobs.set(jobId, job)
          await saveJobs()
          await updateJobStep(jobId, 5, 'completed')
        } catch (error) {
          console.error('Metadata generation failed:', error)
          throw error
        }
      }
    }
    // Complete job
    job.status = 'completed'
    job.progress = 100
    job.completedAt = new Date()
    job.outputPath = `/api/download/${jobId}`
    jobs.set(jobId, job)
    await saveJobs()
  } catch (error: unknown) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : 'Unknown error'
    jobs.set(jobId, job)
    await saveJobs()
  }
}

export async function processSpecificStep(jobId: string, stepIndex: number) {
  const job = jobs.get(jobId)
  if (!job) return false

  if (stepIndex < 0 || stepIndex >= job.steps.length) return false
  
  const step = job.steps[stepIndex]
  if (step.status !== 'processing') return false

  try {
    if (stepIndex === 0) { // Audio Analysis
      const audioAnalysis = await analyzeAudio(job.audioFile.path)
      job.audioFile.duration = audioAnalysis.duration
      const waveformData = await extractWaveform(job.audioFile.path)
      audioAnalysis.waveformData = waveformData
      job.audioAnalysis = audioAnalysis
      job.steps[0].details = {
        duration: audioAnalysis.duration,
        sampleRate: audioAnalysis.sampleRate,
        channels: audioAnalysis.channels,
        bitRate: audioAnalysis.bitRate,
        format: audioAnalysis.format,
      }
      jobs.set(jobId, job)
      await saveJobs()
      await updateJobStep(jobId, 0, 'completed')
    } else if (stepIndex === 1) { // Transcription
      const tempDir = path.join(process.cwd(), 'temp')
      const wavPath = path.join(tempDir, `${jobId}-audio.wav`)
      await convertToWav(job.audioFile.path, wavPath)
      const transcript = await transcribeAudio(wavPath)
      
      // Store transcript in job for later use in metadata generation
      job.transcript = transcript
      
      job.steps[1].details = { segmentCount: transcript.segments.length, language: transcript.language, duration: transcript.duration }
      const srtPath = path.join(tempDir, `${jobId}-subtitles.srt`)
      await generateSRT(transcript, srtPath)
      jobs.set(jobId, job)
      await saveJobs()
      await updateJobStep(jobId, 1, 'completed')
    } else if (stepIndex === 2) { // Music Generation
      const tempDir = path.join(process.cwd(), 'temp')
      const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
      const musicPath = path.join(tempDir, `${jobId}-music.wav`)
      await generateChillSoundtrackFromLocal(Math.ceil(duration), musicPath)
      job.steps[2].details = { info: 'Ambient music generated from local files', musicPath }
      jobs.set(jobId, job)
      await saveJobs()
      await updateJobStep(jobId, 2, 'completed')
    } else if (stepIndex === 3) { // Visual Generation
      const tempDir = path.join(process.cwd(), 'temp')
      const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
      const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
      const waveformData = job.audioAnalysis?.waveformData || []
      
      try {
        // Try advanced visual generation first
        await generateAbstractVisuals(job.audioFile.path, waveformData, visualsPath, duration)
        job.steps[3].details = { 
          info: 'Abstract visuals generated with waveform synchronization', 
          visualsPath,
          duration,
          resolution: '1920x1080'
        }
      } catch (error) {
        console.log('Advanced visual generation failed, using simple visuals:', error)
        // Fallback to simpler visual generation
        await generateSimpleVisuals(duration, visualsPath, waveformData)
        job.steps[3].details = { 
          info: 'Simple abstract visuals generated', 
          visualsPath,
          duration,
          resolution: '1920x1080'
        }
      }
      
      jobs.set(jobId, job)
      await saveJobs()
      await updateJobStep(jobId, 3, 'completed')
    } else if (stepIndex === 4) { // Video Assembly
      const tempDir = path.join(process.cwd(), 'temp')
      const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
      
      // Check if required files exist
      const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
      const musicPath = path.join(tempDir, `${jobId}-music.wav`)
      const subtitlesPath = path.join(tempDir, `${jobId}-subtitles.srt`)
      const finalVideoPath = path.join(tempDir, `${jobId}-final.mp4`)
      const mixedAudioPath = path.join(tempDir, `${jobId}-mixed-audio.wav`)
      
      try {
        // First combine the original audio with background music using ducking
        console.log('Combining audio with background music...')
        await combineAudioWithDucking(job.audioFile.path, musicPath, mixedAudioPath, {
          musicVolume: 0.15,
          duckingThreshold: -25,
          duckingRatio: 3,
          attackTime: 0.2,
          releaseTime: 1.0
        })
        
        // Then assemble the final video with mixed audio, visuals, and subtitles
        console.log('Assembling final video...')
        await assembleVideo(mixedAudioPath, visualsPath, subtitlesPath, finalVideoPath, {
          width: 1920,
          height: 1080,
          fps: 30,
          bitrate: '5000k',
          preset: 'medium',
          crf: 20
        })
        
        job.steps[4].details = { 
          info: 'Video assembled with audio ducking and subtitles', 
          finalVideoPath,
          mixedAudioPath,
          duration,
          resolution: '1920x1080',
          bitrate: '5000k'
        }
        
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 4, 'completed')
      } catch (error) {
        console.error('Video assembly failed:', error)
        // Fallback: simple assembly without ducking
        try {
          console.log('Trying simple video assembly without ducking...')
          await assembleVideo(job.audioFile.path, visualsPath, subtitlesPath, finalVideoPath, {
            width: 1920,
            height: 1080,
            fps: 30,
            bitrate: '4000k'
          })
          
          job.steps[4].details = { 
            info: 'Video assembled (simple mode, no audio ducking)', 
            finalVideoPath,
            duration,
            resolution: '1920x1080',
            bitrate: '4000k'
          }
          
          jobs.set(jobId, job)
          await saveJobs()
          await updateJobStep(jobId, 4, 'completed')
        } catch (fallbackError) {
          console.error('Simple video assembly also failed:', fallbackError)
          throw fallbackError
        }
      }
    } else if (stepIndex === 5) { // Metadata Generation
      const tempDir = path.join(process.cwd(), 'temp')
      const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
      
      try {
        // Load transcript if not already in job object
        await loadTranscriptIfNeeded(jobId, job)
        
        // Generate YouTube metadata from transcript
        if (job.transcript) {
          console.log('Generating YouTube metadata from transcript...')
          const metadata = await generateYouTubeMetadata(
            job.transcript,
            job.audioFile.name,
            duration,
            {
              maxTitleLength: 100,
              maxDescriptionLength: 5000,
              maxTags: 15
            }
          )
          
          // Add resolution and duration info
          const completeMetadata = {
            ...metadata,
            duration,
            resolution: {
              width: 1920,
              height: 1080
            }
          }
          
          // Store metadata in job
          job.metadata = completeMetadata
          
          // Save metadata to file
          const metadataPath = path.join(tempDir, `${jobId}-metadata.json`)
          await saveMetadataToFile(completeMetadata, metadataPath)
          
          job.steps[5].details = { 
            info: 'YouTube metadata generated with AI analysis',
            metadataPath,
            title: metadata.title,
            tags: metadata.tags.length,
            chapters: metadata.chapters.length,
            descriptionLength: metadata.description.length
          }
        } else {
          // Fallback metadata generation without transcript
          console.log('Generating basic metadata (no transcript available)...')
          const basicMetadata = {
            title: job.audioFile.name.replace(/\.[^/.]+$/, ''),
            description: `Podcast episode converted to video\n\nDuration: ${Math.floor(duration/60)}:${Math.floor(duration%60).toString().padStart(2,'0')}\n\nThis video was automatically generated from audio content.`,
            tags: ['podcast', 'audio', 'video', 'education'],
            chapters: [],
            thumbnail: 'auto-generated',
            duration,
            resolution: { width: 1920, height: 1080 }
          }
          
          job.metadata = basicMetadata
          
          const metadataPath = path.join(tempDir, `${jobId}-metadata.json`)
          await saveMetadataToFile(basicMetadata, metadataPath)
          
          job.steps[5].details = { 
            info: 'Basic metadata generated (no transcript available)',
            metadataPath,
            title: basicMetadata.title,
            tags: basicMetadata.tags.length,
            chapters: 0
          }
        }
        
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 5, 'completed')
      } catch (error) {
        console.error('Metadata generation failed:', error)
        throw error
      }
    }

    // Check if all steps are completed
    const allCompleted = job.steps.every(s => s.status === 'completed')
    if (allCompleted) {
      job.status = 'completed'
      job.progress = 100
      job.completedAt = new Date()
      job.outputPath = `/api/download/${jobId}`
      jobs.set(jobId, job)
      await saveJobs()
    } else {
      // Set job status back to pending if not all steps are completed
      job.status = 'pending'
      jobs.set(jobId, job)
      await saveJobs()
    }

    return true
  } catch (error: unknown) {
    step.status = 'failed'
    step.error = error instanceof Error ? error.message : 'Unknown error'
    job.status = 'pending' // Allow retry of other steps
    jobs.set(jobId, job)
    await saveJobs()
    throw error
  }
}

/**
 * Load transcript from existing JSON file if not in job object
 */
async function loadTranscriptIfNeeded(jobId: string, job: ProcessingJob): Promise<void> {
  if (!job.transcript) {
    try {
      const tempDir = path.join(process.cwd(), 'temp')
      const jsonFile = path.join(tempDir, `${jobId}-audio.json`)
      const transcriptData = await readFile(jsonFile, 'utf-8')
      const parsed = JSON.parse(transcriptData)
      
      const segments: TranscriptionSegment[] = parsed.segments.map((segment: Record<string, unknown>) => ({
        text: String(segment.text || '').trim(),
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        confidence: segment.avg_logprob ? Math.exp(Number(segment.avg_logprob)) : 0.5
      }))
      
      job.transcript = {
        segments,
        language: parsed.language || 'en',
        duration: parsed.segments[parsed.segments.length - 1]?.end || 0
      }
      
      jobs.set(jobId, job)
      await saveJobs()
      console.log(`Loaded existing transcript for job ${jobId}`)
    } catch (error) {
      console.log(`No existing transcript found for job ${jobId}:`, error)
    }
  }
}

// On module load, resume any jobs in processing state
;(async () => {
  for (const [jobId, job] of jobs.entries()) {
    if (job.status === 'processing' || job.steps.some(s => s.status === 'processing')) {
      // Resume processing in background
      processAudioFile(jobId)
    }
  }
})()
