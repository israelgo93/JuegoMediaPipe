# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Responde siempre en español.

## Project Overview

This is a **MediaPipe VRM Avatar Animation System** built with vanilla JavaScript and Vite. The app uses MediaPipe's computer vision capabilities to detect face and hand landmarks, enabling real-time animation of VRM avatars with facial expressions, head movement, and detailed hand gestures through webcam input.

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
- **FaceLandmarker**: Detects 468 facial keypoints with blendshapes for expression mapping
- **HandLandmarker**: Detects 21 hand landmarks per hand for full finger animation

Both models run in `VIDEO` mode with GPU acceleration for real-time processing.

### VRM Avatar Animation System

- **Facial Animation**: Maps MediaPipe blendshapes to VRM expressions (blink, mouth shapes, etc.)
- **Head Tracking**: Real-time head rotation using normalized pose data
- **Hand Animation**: Full finger articulation using Kalidokit pose conversion
- **Expression Mapping**: 18 available VRM expressions (aa, angry, blink, happy, sad, etc.)
- **Bone System**: 68 available bones including detailed finger bones for both hands

### Video Processing Pipeline

1. WebRTC camera stream captures video (`enableWebcam()`)
2. `predictWebcam()` loop processes frames using `requestAnimationFrame`
3. MediaPipe models detect landmarks asynchronously via callbacks
4. Kalidokit converts landmarks to VRM-compatible bone rotations
5. Real-time animation applied to VRM avatar with EMA smoothing
6. Canvas overlay renders tracking landmarks for debugging

## Project Structure

```
src/
├── main.js                    # Main application logic (950+ lines)
├── avatar/
│   └── vrmAvatarManager.js   # VRM avatar loading and management
├── tracking/
│   └── faceTracker.js        # MediaPipe face tracking wrapper
└── utils/
    ├── kalidokitAdapter.js   # Kalidokit integration utilities
    ├── landmarkMapping.js    # Coordinate transformation utilities
    └── controlUtils.js       # UI control helpers
index.html                    # Entry point with fullscreen layout
package.json                 # Project configuration and dependencies
```

## Development Notes

- Models are loaded from MediaPipe CDN (tasks-vision@0.10.14)
- VRM avatar from CDN (three-vrm dev branch sample model)
- Kalidokit v1.1.5 handles pose estimation and bone rotation conversion
- Video element uses `transform: scaleX(-1)` for mirror effect
- Canvas overlay positioned absolutely over video for landmark drawing
- Optimized bone caching system prevents repeated VRM bone lookups
- EMA filters provide smooth animation with configurable parameters
- No test framework configured (tests currently return error)

## Key Features Implemented

### ✅ Completed Features
- **Full VRM Avatar Animation**: Face, head, and hand tracking
- **Real-time Performance**: 30+ FPS with GPU acceleration
- **Advanced UI Controls**: Configurable sensitivity and smoothing
- **Expression Mapping**: 18 VRM expressions with intensity control
- **Hand Animation**: All 16 finger bones per hand animated
- **Calibration System**: Automatic and manual neutral pose calibration
- **Performance Monitoring**: FPS counter and latency tracking

### 🎛️ UI Controls Available
- **Settings Panel**: Toggle with ⚙️ Config button (top-left)
- **Face Sensitivity**: 0.1x to 2.0x multiplier
- **Hand Smoothing**: 0.0 to 0.5 smoothing factor
- **Hand Rotation**: 0.5x to 1.5x rotation multiplier  
- **Expression Intensity**: 0.3x to 1.5x expression strength

### 🏗️ Architecture Notes
- **Mixed Architecture**: Main.js (monolithic) + src/ modules (modular)
- **Next Migration**: Planned migration to full modular architecture
- **Caching System**: Bone cache and rotation smoothing for performance
- **Configuration**: Dynamic ANIMATION_CONFIG object for runtime adjustments

## Configuration

The app uses ES modules (`"type": "module"` in package.json) and Vite for development server and building. No additional configuration files present.