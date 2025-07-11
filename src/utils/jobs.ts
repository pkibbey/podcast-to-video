import { ProcessingJob, TranscriptionSegment, VisualPerformanceMode } from '@/types'
import { readFile, writeFile } from 'fs/promises'
import { readFileSync } from 'fs'
import path from 'path'
import { analyzeAudio, transcribeAudio, generateSRT, convertToWav, extractWaveform, generateChillSoundtrackFromLocal, generateAbstractVisuals, generateSimpleVisuals, generateFastVisuals, generateStreamingVisuals, generateYouTubeMetadata, saveMetadataToFile, optimizeMusicForPodcast, downloadFreeAmbientMusic, cleanupJobFiles } from '@/utils/audioProcessing'
import { assembleVideo, combineAudioWithDucking } from '@/utils/videoProcessing'
import { VISUAL_PERFORMANCE_MODES, DEFAULT_VISUAL_MODE } from '@/constants/performance'

const JOBS_PATH = path.join(process.cwd(), 'jobs.json');

// Limit processing to 1 minute for testing/faster processing
const MAX_PROCESSING_DURATION = 60; // seconds

// Add a processing lock to prevent concurrent step execution
const processingLocks = new Map<string, Promise<boolean>>();

// Track if auto-resume has already run to prevent infinite loops
let autoResumeHasRun = false;

// Export for debugging purposes
export function getProcessingLocks(): string[] {
  return Array.from(processingLocks.keys());
}

// Reset auto-resume flag (useful for debugging)
export function resetAutoResumeFlag() {
  autoResumeHasRun = false;
}

// Clear stuck processing states for a job
export async function clearStuckProcessingStates(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return false;
  
  // Clear any processing locks for this job
  for (let i = 0; i < job.steps.length; i++) {
    const lockKey = `${jobId}-${i}`;
    processingLocks.delete(lockKey);
  }
  
  // Reset any stuck processing steps to pending
  let hasStuckSteps = false;
  for (const step of job.steps) {
    if (step.status === 'processing') {
      step.status = 'pending';
      step.progress = 0;
      if (step.error) delete step.error;
      hasStuckSteps = true;
    }
  }
  
  if (hasStuckSteps) {
    job.status = 'pending';
    jobs.set(jobId, job);
    await saveJobs();
    console.log(`Cleared stuck processing states for job ${jobId}`);
  }
  
  return hasStuckSteps;
}

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
  
  // Check if job is already being processed
  if (job.status === 'processing') {
    // Check if any step is currently locked (actively being processed)
    const hasActiveLocks = job.steps.some((step, index) => {
      const lockKey = `${jobId}-${index}`;
      return processingLocks.has(lockKey);
    });
    
    if (hasActiveLocks) {
      console.log(`Job ${jobId} is already being processed - skipping duplicate processAudioFile call`);
      return;
    }
  }
  
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
        // Add preview data for waveform visualization
        job.steps[0].previewData = {
          type: 'waveform',
          content: waveformData.slice(0, 1000), // Limit size for preview
          duration: audioAnalysis.duration
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
        // Add preview data for transcript
        job.steps[1].previewData = {
          type: 'transcript',
          content: transcript,
          duration: transcript.duration
        }
        const srtPath = path.join(tempDir, `${jobId}-subtitles.srt`)
        await generateSRT(transcript, srtPath)
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 1, 'completed')
      } else if (i === 2) { // Music Generation (real)
        await updateJobStep(jobId, 2, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = Math.min(job.audioFile.duration || (job.audioAnalysis?.duration ?? 180), MAX_PROCESSING_DURATION)
        const musicPath = path.join(tempDir, `${jobId}-music.wav`)
        await generateChillSoundtrackFromLocal(Math.ceil(duration), musicPath)
        job.steps[2].details = { info: 'Ambient music generated from local files', musicPath }
        // Add preview data for audio
        job.steps[2].previewData = {
          type: 'audio',
          path: musicPath,
          duration: duration
        }
        jobs.set(jobId, job)
        await saveJobs()
        await updateJobStep(jobId, 2, 'completed')
      } else if (i === 3) { // Visual Generation
        // Use the centralized step processing with locking
        await processSpecificStep(jobId, 3, false)
      } else if (i === 4) { // Video Assembly
        await updateJobStep(jobId, 4, 'processing')
        const tempDir = path.join(process.cwd(), 'temp')
        const duration = Math.min(job.audioFile.duration || (job.audioAnalysis?.duration ?? 180), MAX_PROCESSING_DURATION)
        
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
          
          // Add preview data for final video
          job.steps[4].previewData = {
            type: 'video',
            path: finalVideoPath,
            duration: duration
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
            
            // Add preview data for final video
            job.steps[4].previewData = {
              type: 'video',
              path: finalVideoPath,
              duration: duration
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
        const duration = Math.min(job.audioFile.duration || (job.audioAnalysis?.duration ?? 180), MAX_PROCESSING_DURATION)
        
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
            
            // Add preview data for metadata
            job.steps[5].previewData = {
              type: 'metadata',
              content: completeMetadata
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
            
            // Add preview data for metadata
            job.steps[5].previewData = {
              type: 'metadata',
              content: basicMetadata
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

export async function processSpecificStep(jobId: string, stepIndex: number, forceReprocess: boolean = false) {
  const lockKey = `${jobId}-${stepIndex}`;
  
  // Check if this step is already being processed
  if (processingLocks.has(lockKey)) {
    console.log(`Step ${stepIndex} for job ${jobId} is already being processed - waiting for existing process`);
    // Wait for the existing process to complete
    try {
      return await processingLocks.get(lockKey)!;
    } catch (error) {
      console.log(`Existing process failed, will retry: ${error}`);
    }
  }
  
  // Create a new promise for this processing step
  const processingPromise = actuallyProcessStep(jobId, stepIndex, forceReprocess);
  processingLocks.set(lockKey, processingPromise);
  
  console.log(`Lock acquired for ${lockKey}. Current locks:`, Array.from(processingLocks.keys()));
  
  try {
    const result = await processingPromise;
    return result;
  } finally {
    // Always release the lock
    processingLocks.delete(lockKey);
    console.log(`Released lock for ${lockKey}. Remaining locks:`, Array.from(processingLocks.keys()));
  }
}

export async function restartSpecificStep(jobId: string, stepIndex: number) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (stepIndex < 0 || stepIndex >= job.steps.length) {
    throw new Error(`Invalid step index ${stepIndex} for job ${jobId}`);
  }

  const step = job.steps[stepIndex];
  
  // Reset the step to processing state
  step.status = 'processing';
  step.progress = 0;
  step.startedAt = new Date();
  step.completedAt = undefined;
  if (step.error) {
    delete step.error;
  }
  if (step.details) {
    delete step.details;
  }
  if (step.previewData) {
    delete step.previewData;
  }

  // Update job status to processing if it was completed or failed
  if (job.status === 'completed' || job.status === 'failed') {
    job.status = 'processing';
    if (job.error) {
      delete job.error;
    }
  }

  jobs.set(jobId, job);
  await saveJobs();

  console.log(`Restarting step ${stepIndex} (${step.name}) for job ${jobId}`);
  
  // Process the step with force reprocess flag
  return await processSpecificStep(jobId, stepIndex, true);
}

async function actuallyProcessStep(jobId: string, stepIndex: number, forceReprocess: boolean = false): Promise<boolean> {
  try {
    const job = jobs.get(jobId)
    if (!job) {
      console.log(`Job ${jobId} not found`);
      return false;
    }

    if (stepIndex < 0 || stepIndex >= job.steps.length) {
      console.log(`Invalid step index ${stepIndex} for job ${jobId}`);
      return false;
    }
    
    const step = job.steps[stepIndex]
    if (!forceReprocess && step.status !== 'processing') {
      console.log(`Step ${stepIndex} for job ${jobId} is not in processing state: ${step.status}`);
      return false;
    }

    console.log(`Starting step ${stepIndex} for job ${jobId}: ${step.name}${forceReprocess ? ' (reprocessing)' : ''}`);
    console.log('STEP: ', step)
    
    // If this is a reprocess, clean up all existing files for this job
    if (forceReprocess) {
      console.log(`🧹 Cleaning up existing files for reprocessing job ${jobId}...`)
      await cleanupJobFiles(jobId)
    }

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
      // Add preview data for waveform visualization
      job.steps[0].previewData = {
        type: 'waveform',
        content: waveformData.slice(0, 1000), // Limit size for preview
        duration: audioAnalysis.duration
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
      // Add preview data for transcript
      job.steps[1].previewData = {
        type: 'transcript',
        content: transcript,
        duration: transcript.duration
      }
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
      // Add preview data for audio
      job.steps[2].previewData = {
        type: 'audio',
        path: musicPath,
        duration: duration
      }
      jobs.set(jobId, job)
      await saveJobs()
      await updateJobStep(jobId, 2, 'completed')
    } else if (stepIndex === 3) { // Visual Generation
      const tempDir = path.join(process.cwd(), 'temp')
      const duration = job.audioFile.duration || (job.audioAnalysis?.duration ?? 180)
      const visualsPath = path.join(tempDir, `${jobId}-visuals.mp4`)
      const waveformData = job.audioAnalysis?.waveformData || []
      
      // Get performance mode from job options or use default
      const performanceMode: VisualPerformanceMode = (job as any).visualMode || DEFAULT_VISUAL_MODE;
      const modeConfig = VISUAL_PERFORMANCE_MODES[performanceMode];
      
      try {
        // Use optimized streaming visual generation for better performance
        console.log(`Starting optimized streaming visual generation for job ${jobId} (${performanceMode} mode)`);
        
        await generateStreamingVisuals(
          job.audioFile.path, 
          waveformData, 
          visualsPath, 
          duration,
          {
            chunkDuration: modeConfig.chunkDuration,
            width: modeConfig.width,
            height: modeConfig.height,
            fps: modeConfig.fps,
            onProgress: (progress) => {
              // Update step details with progress
              job.steps[3].details = { 
                info: `Generating visuals (${performanceMode})... ${Math.round(progress * 100)}%`,
                progress: Math.round(progress * 100),
                visualsPath,
                duration,
                resolution: `${modeConfig.width}x${modeConfig.height}`,
                mode: performanceMode
              };
              jobs.set(jobId, job);
              saveJobs().catch(console.error);
            }
          }
        );
        
        console.log(`Optimized streaming visual generation completed for job ${jobId}`);
        job.steps[3].details = { 
          info: `High-speed visuals generated (${performanceMode} mode)`, 
          visualsPath,
          duration,
          resolution: `${modeConfig.width}x${modeConfig.height}`,
          mode: performanceMode
        };
        // Add preview data for video
        job.steps[3].previewData = {
          type: 'video',
          path: visualsPath,
          duration: duration
        };
      } catch (error) {
        console.log(`Optimized visual generation failed for job ${jobId}, trying ultra-fast fallback:`, error)
        
        // Fallback to ultra-fast single-pass generation
        try {
          console.log(`Using ultra-fast fallback for job ${jobId}`);
          const fastMode = VISUAL_PERFORMANCE_MODES['real-time'];
          await generateFastVisuals(
            job.audioFile.path,
            waveformData,
            visualsPath,
            duration,
            {
              width: fastMode.width,
              height: fastMode.height,
              fps: fastMode.fps,
              preset: fastMode.preset,
              quality: fastMode.quality,
              useGPU: true
            }
          );
          
          console.log(`Ultra-fast visual generation completed for job ${jobId}`);
          job.steps[3].details = { 
            info: 'Ultra-fast draft visuals generated (fallback)', 
            visualsPath,
            duration,
            resolution: `${fastMode.width}x${fastMode.height}`,
            mode: 'real-time-fallback'
          };
          // Add preview data for video
          job.steps[3].previewData = {
            type: 'video',
            path: visualsPath,
            duration: duration
          };
        } catch (fallbackError) {
          console.log(`Ultra-fast visual generation also failed for job ${jobId}, using simple fallback:`, fallbackError)
          
          // Kill any remaining FFmpeg processes for this job before starting fallback
          try {
            const { exec } = require('child_process')
            console.log(`Killing any existing FFmpeg processes for job ${jobId}`);
            
            await new Promise<void>((resolve) => {
              exec(`pkill -f "ffmpeg.*${jobId}-visuals.mp4"`, (error: any) => {
                if (error && error.code !== 1) { // code 1 means no processes found, which is fine
                  console.log('pkill error (might be expected if no processes found):', error)
                }
                console.log('pkill completed')
                resolve()
              })
            })
            
            // Wait for processes to be killed
            await new Promise(resolve => setTimeout(resolve, 2000))
            
          } catch (killError) {
            console.log('Error during FFmpeg process cleanup:', killError)
          }
          
          // Final fallback to simple visuals
          console.log(`Starting simple visual generation fallback for job ${jobId}`);
          await generateSimpleVisuals(duration, visualsPath, waveformData, {
            width: 854,
            height: 480,
            fps: 15
          });
          console.log(`Simple visual generation completed successfully for job ${jobId}`);
          job.steps[3].details = { 
            info: 'Simple abstract visuals generated', 
            visualsPath,
            duration,
            resolution: '854x480'
          };
          // Add preview data for video
          job.steps[3].previewData = {
            type: 'video',
            path: visualsPath,
            duration: duration
          };
        }
      }
      
      // Add preview data for video (only if not already set by fallback paths)
      if (!job.steps[3].previewData) {
        job.steps[3].previewData = {
          type: 'video',
          path: visualsPath,
          duration: duration
        };
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
          width: 1920,       // Output at 1080p regardless of visual input resolution
          height: 1080,
          fps: 30,
          bitrate: '5000k',
          preset: 'fast',    // Faster preset for better performance
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
        
        // Add preview data for final video
        job.steps[4].previewData = {
          type: 'video',
          path: finalVideoPath,
          duration: duration
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
            bitrate: '4000k',
            preset: 'fast'  // Faster preset
          })
          
          job.steps[4].details = { 
            info: 'Video assembled (simple mode, no audio ducking)', 
            finalVideoPath,
            duration,
            resolution: '1920x1080',
            bitrate: '4000k'
          }
          
          // Add preview data for final video
          job.steps[4].previewData = {
            type: 'video',
            path: finalVideoPath,
            duration: duration
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
          
          // Add preview data for metadata
          job.steps[5].previewData = {
            type: 'metadata',
            content: completeMetadata
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
          
          // Add preview data for metadata
          job.steps[5].previewData = {
            type: 'metadata',
            content: basicMetadata
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
    // Get job and step again to ensure we have the latest state
    const currentJob = jobs.get(jobId)
    if (currentJob && stepIndex >= 0 && stepIndex < currentJob.steps.length) {
      const currentStep = currentJob.steps[stepIndex]
      currentStep.status = 'failed'
      currentStep.error = error instanceof Error ? error.message : 'Unknown error'
      currentJob.status = 'pending' // Allow retry of other steps
      jobs.set(jobId, currentJob)
      await saveJobs()
    }
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

export type { VisualPerformanceMode } from '@/types';

// On module load, resume any jobs in processing state (but only once)
;(async () => {
  // Prevent auto-resume from running multiple times
  if (autoResumeHasRun) {
    return;
  }
  autoResumeHasRun = true;

  // Wait a bit to ensure any existing processes can establish their locks
  await new Promise(resolve => setTimeout(resolve, 1000));

  for (const [jobId, job] of jobs.entries()) {
    // Only resume jobs that are explicitly marked as needing resumption
    // AND not already being processed (check for locks)
    if (job.status === 'processing' || job.steps.some(s => s.status === 'processing')) {
      // Check if this job is already being processed via locks
      const hasActiveStep = job.steps.some((step, index) => {
        const lockKey = `${jobId}-${index}`;
        return step.status === 'processing' && processingLocks.has(lockKey);
      });
      
      if (hasActiveStep) {
        console.log(`Skipping auto-resume for job ${jobId} - already being processed`);
        continue;
      }
      
      // Check if there are any FFmpeg processes running for this job
      try {
        const { exec } = require('child_process');
        await new Promise<boolean>((resolve) => {
          exec(`ps aux | grep "ffmpeg.*${jobId}" | grep -v grep`, (error: any, stdout: any) => {
            if (stdout && stdout.trim()) {
              console.log(`Skipping auto-resume for job ${jobId} - FFmpeg processes still running`);
              resolve(true); // processes found
            } else {
              resolve(false); // no processes found
            }
          });
        }).then((hasProcesses) => {
          if (hasProcesses) {
            return;
          }
          
          // Only resume if no active processes found
          console.log(`Auto-resuming job ${jobId} after server restart`);
          processAudioFile(jobId).catch(async (error: unknown) => {
            console.error('Auto-resume processing error:', error)
            const job = jobs.get(jobId)
            if (job) {
              job.status = 'failed'
              job.error = error instanceof Error ? error.message : 'Unknown error during auto-resume'
              jobs.set(jobId, job)
              await saveJobs()
            }
          })
        });
      } catch (processCheckError) {
        console.log(`Process check failed for job ${jobId}, skipping auto-resume:`, processCheckError);
      }
    }
  }
})()
