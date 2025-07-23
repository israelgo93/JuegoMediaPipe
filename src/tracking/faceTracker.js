import {
    FaceLandmarker,
    FilesetResolver,
    DrawingUtils
} from "@mediapipe/tasks-vision";
import { Face } from "kalidokit";

export class FaceTracker {
    constructor() {
        this.faceLandmarker = null;
        this.runningMode = "VIDEO";
        this.isInitialized = false;
        this.lastVideoTime = -1;
        
        // Buffer para suavizado EMA
        this.smoothingFactor = 0.7;
        this.previousResults = null;
        
        // Resultados de tracking
        this.results = {
            landmarks: null,
            blendshapes: null,
            matrices: null,
            timestamp: 0
        };
    }

    async initialize() {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );

            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                refineLandmarks: true
            });

            this.isInitialized = true;
            console.log("FaceTracker inicializado correctamente");
        } catch (error) {
            console.error("Error inicializando FaceTracker:", error);
            throw error;
        }
    }

    processFrame(video) {
        if (!this.isInitialized || !video || video.videoWidth === 0) {
            return this.results;
        }

        const videoTime = video.currentTime;
        if (videoTime === this.lastVideoTime) {
            return this.results;
        }
        this.lastVideoTime = videoTime;

        try {
            const detectionResult = this.faceLandmarker.detectForVideo(video, performance.now());
            
            if (detectionResult.faceLandmarks && detectionResult.faceLandmarks.length > 0) {
                // Extraer datos principales
                const landmarks = detectionResult.faceLandmarks[0];
                const blendshapes = detectionResult.faceBlendshapes ? 
                    this.processBlendshapes(detectionResult.faceBlendshapes[0]) : null;
                const matrices = detectionResult.facialTransformationMatrixes ? 
                    detectionResult.facialTransformationMatrixes[0] : null;

                // Aplicar suavizado EMA
                this.results = this.applySmoothening({
                    landmarks,
                    blendshapes,
                    matrices,
                    timestamp: performance.now()
                });
            }
        } catch (error) {
            console.error("Error procesando frame:", error);
        }

        return this.results;
    }

    processBlendshapes(blendshapes) {
        const processed = {};
        if (blendshapes.categories) {
            blendshapes.categories.forEach(category => {
                processed[category.categoryName] = category.score;
            });
        }
        return processed;
    }

    applySmoothening(newResults) {
        if (!this.previousResults) {
            this.previousResults = newResults;
            return newResults;
        }

        const smoothed = {
            landmarks: newResults.landmarks,
            blendshapes: {},
            matrices: newResults.matrices,
            timestamp: newResults.timestamp
        };

        // Suavizar blendshapes
        if (newResults.blendshapes && this.previousResults.blendshapes) {
            Object.keys(newResults.blendshapes).forEach(key => {
                const current = newResults.blendshapes[key];
                const previous = this.previousResults.blendshapes[key] || 0;
                smoothed.blendshapes[key] = previous * this.smoothingFactor + 
                                          current * (1 - this.smoothingFactor);
            });
        } else {
            smoothed.blendshapes = newResults.blendshapes;
        }

        this.previousResults = smoothed;
        return smoothed;
    }

    // Método para usar con Kalidokit
    solveFace(landmarks) {
        if (!landmarks || landmarks.length === 0) return null;
        
        try {
            // Convertir landmarks de MediaPipe a formato Kalidokit
            const faceResults = Face.solve(landmarks, {
                runtime: "mediapipe",
                video: null,
                smoothBlink: true,
                blinkSettings: [0.25, 0.75]
            });
            
            return faceResults;
        } catch (error) {
            console.error("Error en solveFace:", error);
            return null;
        }
    }

    // Limpieza de recursos
    destroy() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this.isInitialized = false;
    }
}

// Singleton para uso global
let faceTrackerInstance = null;

export const getFaceTracker = () => {
    if (!faceTrackerInstance) {
        faceTrackerInstance = new FaceTracker();
    }
    return faceTrackerInstance;
};