# Music Assets

This directory contains ambient music files used for podcast background music generation.

## Getting Started

### Option 1: Use FFmpeg Generation (Default)
The app will automatically generate ambient music using FFmpeg's built-in synthesizers if no music files are found here. This creates soothing ambient sounds with layered sine waves and brown noise.

### Option 2: Add Your Own Music Files
You can add your own ambient/chill music files to this directory. Supported formats:
- `.mp3`
- `.wav` 
- `.aac`
- `.flac`
- `.ogg`

The system will randomly select one of these files and loop/trim it to match your podcast duration.

### Option 3: Download Royalty-Free Music
Here are some sources for royalty-free ambient music:

**Free Sources:**
- [Freesound.org](https://freesound.org) - Search for "ambient", "drone", "pad"
- [YouTube Audio Library](https://www.youtube.com/audiolibrary) - Filter by "Ambient" genre
- [Free Music Archive](https://freemusicarchive.org) - Search ambient/electronic

**Recommended Search Terms:**
- "ambient pad"
- "chill instrumental" 
- "drone music"
- "atmospheric background"
- "meditation music"

### Example Terminal Commands to Download
```bash
# Using youtube-dl for YouTube Audio Library (install with: pip install youtube-dl)
youtube-dl -x --audio-format wav "YOUTUBE_URL_HERE"

# Using wget for direct downloads
wget -O ambient-track-1.mp3 "DIRECT_DOWNLOAD_URL"
```

### Testing
Once you have music files in this directory, restart your development server and try the music generation step again.
