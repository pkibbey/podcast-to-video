# Podcast to Video

Transform podcast audio into visually engaging videos. This application automatically converts podcast episodes into 4K videos complete with generated ambient music, abstract animations, and synchronized subtitles—perfect for sharing content on platforms like YouTube.

<!-- [Live Demo](https://...) -->

## Features

- **Audio Upload & Processing**: Upload podcast files with automatic format validation and analysis
- **Speech-to-Text Transcription**: Automatic transcription with precise timing using local Whisper models
- **Ambient Music Generation**: Generate contextually appropriate background music or select from presets
- **Abstract Visual Generation**: Canvas-based procedural animation generation for engaging visuals
- **4K Video Output**: High-quality video rendering optimized for social media platforms
- **SRT Subtitle Generation**: Automatically generated subtitle files synchronized with speech
- **YouTube Metadata**: Auto-generated descriptions and metadata for easy publishing
- **Progress Tracking**: Real-time progress updates during long-running processing tasks

## Getting Started

### Prerequisites

- **Node.js** 18+ (required for Next.js 15)
- **npm** or **yarn** (npm recommended)
- **FFmpeg** (for audio/video processing)
- **Ollama** (optional, for local AI content generation)

### Installation & Development

1. Clone the repository:
   ```bash
   git clone https://github.com/pkibbey/podcast-to-video.git
   cd podcast-to-video
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Add your configuration details (API keys, FFmpeg paths, etc.)

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

### Core Components

- **`AudioUpload.tsx`** – File upload interface with drag-and-drop support
- **`StepPreview.tsx`** – Visual preview of processing stages with output samples

### API Routes

The `/api` directory contains the processing pipeline:

- **`upload/`** – Audio file ingestion and validation
- **`start-step/`** – Trigger individual processing stages (transcription, music, visuals, video)
- **`progress/`** – Real-time job status updates
- **`download/`** – Retrieve completed videos
- **`metadata/`** – Generate and retrieve YouTube-ready descriptions
- **`cleanup/`, `restart-processing/`** – Job management utilities

### Utilities

- **`audioProcessing.ts`** – Audio analysis and waveform extraction
- **`videoProcessing.ts`** – Video assembly and FFmpeg orchestration
- **`jobs.ts`** – Job queue and state management
- **`performance.ts`** – Monitoring and optimization tools

## Tech Stack

- **Frontend Framework**: [Next.js 15](https://nextjs.org/) – React-based framework with API routes
- **Language**: [TypeScript](https://www.typescriptlang.org/) – Type-safe development
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) – Utility-first CSS framework
- **Audio/Video Processing**: [FFmpeg](https://ffmpeg.org/) – Multimedia framework
- **Sound Synthesis**: [Tone.js 15](https://tonejs.org/) – Web Audio API abstractions
- **Visuals**: [p5.js 2](https://p5js.org/) – Creative coding library for animations
- **File Upload**: [Multer 2](https://github.com/expressjs/multer) – Middleware for file handling
- **UI Components**: [React Dropzone 14](https://react-dropzone.js.org/) – Drag-and-drop interface
- **AI Transcription**: [OpenAI Whisper](https://openai.com/research/whisper) – Speech-to-text (local)
- **Content Generation**: [Ollama](https://ollama.ai/) – Local LLM for metadata generation
