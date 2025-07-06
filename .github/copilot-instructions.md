# Copilot Instructions for Podcast-to-Video App

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is a Next.js TypeScript application that converts podcast audio files into videos with generated ambient music, abstract visuals, and subtitles.

## Key Technologies
- **Frontend**: Next.js 15 with App Router, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes for file processing
- **Audio Processing**: FFmpeg, Web Audio API
- **Transcription**: OpenAI Whisper (local)
- **Video Generation**: Canvas API, FFmpeg for 4K output
- **AI Integration**: Ollama for content generation

## Architecture Guidelines
- Use App Router pattern for all routes
- Implement backend processing pipelines as API routes
- Handle file uploads with proper validation and error handling
- Use TypeScript strictly throughout the project
- Implement proper error boundaries and loading states
- Focus on performance for large audio file processing

## Code Style
- Use functional components with hooks
- Implement proper TypeScript interfaces for all data structures
- Use Tailwind CSS for styling
- Follow Next.js best practices for API routes
- Implement proper error handling for async operations

## File Processing Pipeline
1. Audio upload and format validation
2. Audio analysis and waveform extraction
3. Speech-to-text transcription with timing
4. Ambient music generation/selection
5. Abstract visual generation
6. Video assembly with FFmpeg
7. SRT subtitle generation
8. YouTube metadata generation

## Performance Considerations
- Handle large audio files (30-60 minutes)
- Process 4K video output efficiently
- Implement progress tracking for long operations
- Use background processing for heavy tasks
