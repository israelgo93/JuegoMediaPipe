# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Responde siempre en español.

## Project Overview

This is a **MediaPipe Avatar Selector** web application built with vanilla JavaScript and Vite. The app uses MediaPipe's computer vision capabilities to detect hand gestures (specifically a pinch gesture between thumb and index finger) to allow users to select avatar images in real-time through their webcam.

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Install dependencies
npm install
```

## Architecture

### Core Components

- **main.js**: Central application logic containing MediaPipe initialization, video processing, and gesture detection
- **index.html**: Simple HTML structure with video element, canvas overlay, and avatar selector
- **style.css**: Dark-themed styling with responsive layout for video container and avatar selection grid

### Key MediaPipe Integration

The application uses two main MediaPipe models:
- **FaceLandmarker**: Detects 468 facial keypoints for face tracking visualization
- **HandLandmarker**: Detects 21 hand landmarks per hand for pinch gesture recognition

Both models run in `LIVE_STREAM` mode with GPU acceleration for real-time processing.

### Gesture Recognition Logic

- Pinch detection occurs in `checkPinchGesture()` at **src/main.js:145**
- Uses euclidean distance between thumb tip (landmark 4) and index finger tip (landmark 8)
- Pinch threshold set to 0.04 for gesture activation
- Coordinate mapping translates normalized hand coordinates to screen positions for avatar selection

### Video Processing Pipeline

1. WebRTC camera stream captures video (`enableWebcam()`)
2. `predictWebcam()` loop processes frames using `requestAnimationFrame`
3. MediaPipe models detect landmarks asynchronously via callbacks
4. Drawing utilities render face and hand landmarks on canvas overlay
5. Pinch gesture detection checks for avatar intersection and triggers selection

## Project Structure

```
src/
├── main.js          # Main application logic and MediaPipe integration
├── style.css        # UI styling with dark theme
└── assets/          # Avatar images (avatar1.png, avatar2.png, avatar3.png)
index.html          # Entry point HTML
package.json        # Project configuration and dependencies
```

## Development Notes

- Models are loaded from MediaPipe CDN (tasks-vision@0.10.14)
- Video element uses `transform: scaleX(-1)` for mirror effect
- Canvas overlay positioned absolutely over video for landmark drawing
- Avatar selection uses DOM coordinate mapping between normalized landmarks and element positions
- No test framework configured (tests currently return error)

## Configuration

The app uses ES modules (`"type": "module"` in package.json) and Vite for development server and building. No additional configuration files present.