# Podcast to Video 🎬🎙️

**Transform your audio podcasts into engaging video content effortlessly.**

## About

The `podcast-to-video` project is a tool designed to automatically generate basic video content from your existing podcast audio files.  It leverages readily available tools and libraries to create a simple, visually appealing video with waveform visualizations, static images (optional), and your podcast's title/episode information. This is perfect for quickly creating social media clips, YouTube shorts, or other short-form video content to promote your podcast.  The goal is to provide a fast, easy way for podcasters to repurpose their audio content without requiring extensive video editing skills.

## Key Features ✨

*   **Automatic Waveform Generation:** Dynamically creates a waveform visualization synced to your podcast audio.
*   **Image Integration (Optional):**  Allows you to specify a static image to be displayed alongside the waveform.
*   **Title & Episode Information:**  Automatically includes your podcast title and episode details as text overlays.
*   **Customizable Output:**  Supports various output formats (e.g., MP4, MOV) and resolutions.
*   **Cross-Platform Compatibility:** Designed to run on macOS, Linux, and Windows environments.

## Getting Started 🚀

**Prerequisites:**

*   **Node.js (v16 or higher):**  Ensure you have Node.js installed on your system. You can download it from [https://nodejs.org/](https://nodejs.org/).
*   **npm (Node Package Manager):** npm is included with Node.js installation.
*   **FFmpeg:**  A powerful multimedia framework required for video processing. Installation instructions vary by operating system:
    *   **macOS (using Homebrew):** `brew install ffmpeg`
    *   **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install ffmpeg`
    *   **Windows:** Download a pre-built FFmpeg binary from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html) and add the `bin` directory to your system's PATH environment variable.

**Installation:**

1.  Clone the repository:
    ```bash
    git clone https://github.com/pkibbey/podcast-to-video.git
    cd podcast-to-video
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Usage 🛠️

The primary command is `podcast-to-video`.  Here's how to use it:

**Basic Usage:**

```bash
npx podcast-to-video --audio "path/to/your/podcast.mp3" --output "output_video.mp4"
```

This will generate a video named `output_video.mp4` using the audio file `path/to/your/podcast.mp3`.  The video will include a waveform visualization and the podcast title (extracted from the filename).

**Advanced Usage:**

```bash
npx podcast-to-video --audio "path/to/your/podcast.mp3" --output "episode_video.mp4" --title "My Awesome Podcast Episode" --image "path/to/episode_image.jpg" --resolution 1920x1080
```

This command provides more control:

*   `--audio`: Specifies the path to your podcast audio file.
*   `--output`:  Specifies the desired output video filename.
*   `--title`: Sets a custom title for the video overlay.
*   `--image`:  Provides an optional path to a static image to be displayed alongside the waveform.
*   `--resolution`: Sets the output video resolution (e.g., 1920x1080, 1280x720).

**Example with a Podcast Title:**

If your audio file is named "The-Awesome-Podcast-Episode-123.mp3", the tool will automatically extract "The Awesome Podcast" as the podcast title and "Episode 123" as the episode title.

## Contributing 🙌

We welcome contributions to `podcast-to-video`!  Here's how you can help:

1.  **Report Issues:** If you encounter a bug or have a feature request, please open an issue on GitHub.
2.  **Submit Pull Requests:**  If you'd like to fix a bug or add a new feature, submit a pull request.  Please ensure your code adheres to the project's coding style and includes appropriate tests.
3.  **Documentation:** Help improve the documentation by adding examples or clarifying existing content.

Before submitting a pull request, please:

*   Fork the repository.
*   Create a new branch for your changes.
*   Ensure your code passes linting and testing.

## License 📜

This project is licensed under the [MIT License](LICENSE).  See the `LICENSE` file for details.

## Support & Issues ℹ️

*   **GitHub Issues:** [https://github.com/pkibbey/podcast-to-video/issues](https://github.com/pkibbey/podcast-to-video/issues)
*   **Project Homepage:** [https://github.com/pkibbey/podcast-to-video](https://github.com/pkibbey/podcast-to-video)

[Build Status Placeholder]
[License Badge Placeholder]
[Version Badge Placeholder]