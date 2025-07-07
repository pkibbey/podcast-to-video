#!/bin/bash

# Script to generate a sample ambient music file for testing
# Requires FFmpeg to be installed

MUSIC_DIR="$(dirname "$0")"
OUTPUT_FILE="$MUSIC_DIR/sample-ambient.wav"

echo "Generating sample ambient music file..."

ffmpeg -f lavfi -i "sine=frequency=220:duration=60" \
       -f lavfi -i "sine=frequency=330:duration=60" \
       -f lavfi -i "sine=frequency=440:duration=60" \
       -f lavfi -i "anoisesrc=colour=brown:sample_rate=44100:duration=60" \
       -filter_complex "[0]volume=0.1,aecho=0.8:0.88:60:0.4[sine1];
                        [1]volume=0.08,aecho=0.8:0.88:80:0.3[sine2];
                        [2]volume=0.06,aecho=0.8:0.88:100:0.2[sine3];
                        [3]volume=0.03,highpass=f=100,lowpass=f=2000[noise];
                        [sine1][sine2][sine3][noise]amix=inputs=4:weights=1 1 1 0.5[mixed];
                        [mixed]volume=0.4[final]" \
       -map "[final]" \
       -c:a pcm_s16le \
       -ar 44100 \
       -ac 2 \
       -y "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Sample ambient music generated: $OUTPUT_FILE"
    echo "Duration: 60 seconds"
    echo "You can now test the music generation step!"
else
    echo "❌ Failed to generate sample music"
    echo "Make sure FFmpeg is installed and available in PATH"
fi
