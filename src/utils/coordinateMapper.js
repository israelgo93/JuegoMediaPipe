export class CoordinateMapper {
    constructor() {
        this.videoElement = null;
        this.canvasElement = null;
        this.faceBounds = null;
        this.calibrationData = {
            faceCenter: { x: 0.5, y: 0.5 },
            faceScale: 1.0,
            lastCalibration: 0
        };
        this.isCalibrated = false;
        this.calibrationFrames = [];
        this.maxCalibrationFrames = 30; // 1 segundo a 30fps
    }

    initialize(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.updateDimensions();
    }

    updateDimensions() {
        if (!this.videoElement || !this.canvasElement) return;

        // Obtener dimensiones reales del video y canvas
        const videoRect = this.videoElement.getBoundingClientRect();
        const canvasRect = this.canvasElement.getBoundingClientRect();
        
        this.videoDimensions = {
            width: this.videoElement.videoWidth || videoRect.width,
            height: this.videoElement.videoHeight || videoRect.height,
            displayWidth: videoRect.width,
            displayHeight: videoRect.height
        };

        this.canvasDimensions = {
            width: this.canvasElement.width,
            height: this.canvasElement.height,
            displayWidth: canvasRect.width,
            displayHeight: canvasRect.height
        };

        console.log('Dimensiones actualizadas:', {
            video: this.videoDimensions,
            canvas: this.canvasDimensions
        });
    }

    // Mapear coordenadas normalizadas de MediaPipe a píxeles del canvas
    normalizedToCanvas(normalizedPoint) {
        if (!this.canvasElement) return { x: 0, y: 0 };

        // MediaPipe usa coordenadas normalizadas (0-1)
        // Necesitamos mapear al tamaño real del canvas
        const x = normalizedPoint.x * this.canvasDimensions.width;
        const y = normalizedPoint.y * this.canvasDimensions.height;

        return { x, y };
    }

    // Mapear coordenadas de canvas a coordenadas de pantalla
    canvasToScreen(canvasPoint) {
        if (!this.canvasElement) return { x: 0, y: 0 };

        const rect = this.canvasElement.getBoundingClientRect();
        const scaleX = rect.width / this.canvasDimensions.width;
        const scaleY = rect.height / this.canvasDimensions.height;

        return {
            x: canvasPoint.x * scaleX + rect.left,
            y: canvasPoint.y * scaleY + rect.top
        };
    }

    // Calibrar usando landmarks faciales
    calibrateFromLandmarks(faceLandmarks) {
        if (!faceLandmarks || faceLandmarks.length === 0) return false;

        // Agregar frame actual a calibración
        this.calibrationFrames.push({
            landmarks: [...faceLandmarks],
            timestamp: performance.now()
        });

        // Mantener solo los frames más recientes
        if (this.calibrationFrames.length > this.maxCalibrationFrames) {
            this.calibrationFrames.shift();
        }

        // Calcular calibración si tenemos suficientes frames
        if (this.calibrationFrames.length >= 10) {
            return this.computeCalibration();
        }

        return false;
    }

    computeCalibration() {
        if (this.calibrationFrames.length === 0) return false;

        // Calcular bounds promedio de la cara
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        let centerX = 0, centerY = 0;

        // Puntos clave del contorno facial (índices de MediaPipe)
        const faceContourIndices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

        this.calibrationFrames.forEach(frame => {
            faceContourIndices.forEach(idx => {
                if (frame.landmarks[idx]) {
                    const point = frame.landmarks[idx];
                    minX = Math.min(minX, point.x);
                    maxX = Math.max(maxX, point.x);
                    minY = Math.min(minY, point.y);
                    maxY = Math.max(maxY, point.y);
                    centerX += point.x;
                    centerY += point.y;
                }
            });
        });

        // Calcular centro promedio
        const totalPoints = this.calibrationFrames.length * faceContourIndices.length;
        centerX /= totalPoints;
        centerY /= totalPoints;

        // Calcular escala (tamaño de cara)
        const faceWidth = maxX - minX;
        const faceHeight = maxY - minY;
        const faceScale = Math.max(faceWidth, faceHeight);

        // Actualizar datos de calibración
        this.calibrationData = {
            faceCenter: { x: centerX, y: centerY },
            faceScale: faceScale,
            faceBounds: { minX, maxX, minY, maxY },
            lastCalibration: performance.now()
        };

        this.isCalibrated = true;
        
        console.log('Calibración completada:', this.calibrationData);
        return true;
    }

    // Normalizar landmarks usando calibración
    normalizeLandmarks(landmarks) {
        if (!this.isCalibrated || !landmarks) return landmarks;

        const { faceCenter, faceScale } = this.calibrationData;
        
        return landmarks.map(point => ({
            x: (point.x - faceCenter.x) / faceScale + 0.5,
            y: (point.y - faceCenter.y) / faceScale + 0.5,
            z: point.z || 0
        }));
    }

    // Obtener factor de escala para blendshapes
    getBlendshapeScale() {
        if (!this.isCalibrated) return 1.0;
        
        // Ajustar sensibilidad basada en el tamaño de cara detectado
        const baseScale = 1.0 / this.calibrationData.faceScale;
        return Math.max(0.5, Math.min(2.0, baseScale));
    }

    // Reset calibración
    resetCalibration() {
        this.calibrationFrames = [];
        this.isCalibrated = false;
        this.calibrationData = {
            faceCenter: { x: 0.5, y: 0.5 },
            faceScale: 1.0,
            lastCalibration: 0
        };
    }

    // Obtener información de calibración
    getCalibrationInfo() {
        return {
            isCalibrated: this.isCalibrated,
            framesCollected: this.calibrationFrames.length,
            needsFrames: Math.max(0, 10 - this.calibrationFrames.length),
            faceCenter: this.calibrationData.faceCenter,
            faceScale: this.calibrationData.faceScale,
            lastCalibration: this.calibrationData.lastCalibration
        };
    }

    // Validar si la cara está en posición adecuada
    isFacePositionGood(landmarks) {
        if (!landmarks || landmarks.length === 0) return false;

        // Verificar que la cara no esté muy cerca de los bordes
        const noseTip = landmarks[1]; // Punta de la nariz
        if (!noseTip) return false;

        const margin = 0.1;
        return (
            noseTip.x > margin && noseTip.x < (1 - margin) &&
            noseTip.y > margin && noseTip.y < (1 - margin)
        );
    }

    // Obtener puntos de referencia para debugging
    getDebugPoints(landmarks) {
        if (!landmarks) return [];

        const debugPoints = [];
        
        // Puntos clave para mostrar
        const keyPoints = [
            { idx: 1, name: 'Nariz', color: '#ff0000' },
            { idx: 33, name: 'Ojo Izq', color: '#00ff00' },
            { idx: 362, name: 'Ojo Der', color: '#00ff00' },
            { idx: 61, name: 'Boca Izq', color: '#0000ff' },
            { idx: 291, name: 'Boca Der', color: '#0000ff' },
            { idx: 10, name: 'Frente', color: '#ffff00' },
            { idx: 152, name: 'Barbilla', color: '#ff00ff' }
        ];

        keyPoints.forEach(point => {
            if (landmarks[point.idx]) {
                const canvasCoord = this.normalizedToCanvas(landmarks[point.idx]);
                debugPoints.push({
                    ...point,
                    x: canvasCoord.x,
                    y: canvasCoord.y,
                    normalized: landmarks[point.idx]
                });
            }
        });

        return debugPoints;
    }
}