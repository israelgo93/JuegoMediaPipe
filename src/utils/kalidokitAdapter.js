import { Face, Vector, Utils } from "kalidokit";

export class KalidokitAdapter {
    constructor() {
        this.previousResults = null;
        this.smoothingFactor = 0.7;
        this.calibrationScale = 1.0;
        this.sensitivityMultiplier = 2.5; // Aumentar sensibilidad general
        this.blendshapeThreshold = 0.01; // Umbral mínimo para activar blendshapes
        this.stabilizationFrames = 3;
        this.frameBuffer = [];
    }

    // Convertir landmarks de MediaPipe a formato Kalidokit y obtener rotaciones
    processLandmarks(landmarks, blendshapes = null) {
        if (!landmarks || landmarks.length === 0) return null;

        try {
            // Usar Kalidokit para calcular rotaciones faciales con configuración mejorada
            const faceRig = Face.solve(landmarks, {
                runtime: "mediapipe",
                video: null,
                smoothBlink: true,
                blinkSettings: [0.15, 0.85], // Más sensible al parpadeo
                stabilizeBlink: true,
                enableWink: true
            });

            // Aplicar escalado de calibración a las rotaciones
            const scaleRotation = (value) => value * this.calibrationScale * this.sensitivityMultiplier;

            // Estructura de datos procesada con mejor escalado
            const result = {
                // Rotaciones de cabeza (con escalado mejorado)
                head: {
                    x: scaleRotation(faceRig.head?.x || 0),
                    y: scaleRotation(faceRig.head?.y || 0),
                    z: scaleRotation(faceRig.head?.z || 0),
                    degrees: {
                        x: (faceRig.head?.degrees?.x || 0) * this.calibrationScale,
                        y: (faceRig.head?.degrees?.y || 0) * this.calibrationScale,
                        z: (faceRig.head?.degrees?.z || 0) * this.calibrationScale
                    }
                },

                // Rotaciones de ojos (mejoradas)
                eye: {
                    l: this.enhanceBlinkValue(faceRig.eye?.l || 0),
                    r: this.enhanceBlinkValue(faceRig.eye?.r || 0)
                },

                // Rotaciones de párpados (con más sensibilidad)
                brow: scaleRotation(faceRig.brow || 0),
                
                // Rotaciones de mandíbula/boca (mejoradas)
                mouth: {
                    x: scaleRotation(faceRig.mouth?.x || 0),
                    y: scaleRotation(faceRig.mouth?.y || 0),
                    shape: {
                        A: this.enhanceMouthShape(faceRig.mouth?.shape?.A || 0),
                        E: this.enhanceMouthShape(faceRig.mouth?.shape?.E || 0),
                        I: this.enhanceMouthShape(faceRig.mouth?.shape?.I || 0),
                        O: this.enhanceMouthShape(faceRig.mouth?.shape?.O || 0),
                        U: this.enhanceMouthShape(faceRig.mouth?.shape?.U || 0)
                    }
                },

                // Datos de pupila
                pupil: {
                    x: faceRig.pupil?.x || 0,
                    y: faceRig.pupil?.y || 0
                }
            };

            // Procesar blendshapes con mejor escalado
            if (blendshapes) {
                result.blendshapes = this.enhanceBlendshapes(blendshapes);
            }

            // Agregar al buffer para estabilización
            this.frameBuffer.push(result);
            if (this.frameBuffer.length > this.stabilizationFrames) {
                this.frameBuffer.shift();
            }

            // Aplicar estabilización y suavizado
            const stabilized = this.stabilizeResult(result);
            return this.applySmoothing(stabilized);

        } catch (error) {
            console.error("Error procesando landmarks con Kalidokit:", error);
            return null;
        }
    }

    // Mejorar valores de parpadeo
    enhanceBlinkValue(value) {
        if (Math.abs(value) < this.blendshapeThreshold) return 0;
        
        // Curva de respuesta más agresiva para parpadeo
        const sign = Math.sign(value);
        const abs = Math.abs(value);
        const enhanced = Math.pow(abs * this.sensitivityMultiplier, 1.2);
        
        return Math.max(0, Math.min(1, enhanced)) * sign;
    }

    // Mejorar formas de boca
    enhanceMouthShape(value) {
        if (Math.abs(value) < this.blendshapeThreshold) return 0;
        
        // Aplicar curva de potencia para mayor expresividad
        const sign = Math.sign(value);
        const abs = Math.abs(value);
        const enhanced = Math.pow(abs * this.sensitivityMultiplier, 1.1);
        
        return Math.max(0, Math.min(1, enhanced)) * sign;
    }

    // Mejorar blendshapes de MediaPipe
    enhanceBlendshapes(blendshapes) {
        const enhanced = {};
        
        Object.entries(blendshapes).forEach(([name, value]) => {
            // Aplicar umbral mínimo
            if (Math.abs(value) < this.blendshapeThreshold) {
                enhanced[name] = 0;
                return;
            }

            // Escalado específico por tipo de blendshape
            let multiplier = this.sensitivityMultiplier;
            let curve = 1.0;

            if (name.includes('Blink')) {
                multiplier *= 1.5; // Más sensible para parpadeo
                curve = 1.3;
            } else if (name.includes('mouth') || name.includes('jaw')) {
                multiplier *= 1.3; // Más sensible para boca
                curve = 1.1;
            } else if (name.includes('brow')) {
                multiplier *= 1.2; // Más sensible para cejas
                curve = 1.05;
            }

            // Aplicar mejora con curva
            const enhanced_value = Math.pow(value * multiplier, curve);
            enhanced[name] = Math.max(0, Math.min(1, enhanced_value));
        });

        return enhanced;
    }

    // Estabilizar resultado usando buffer de frames
    stabilizeResult(currentResult) {
        if (this.frameBuffer.length < 2) return currentResult;

        // Promediar valores con frames anteriores para estabilidad
        const stabilized = JSON.parse(JSON.stringify(currentResult));
        const frameCount = this.frameBuffer.length;
        
        // Estabilizar rotaciones de cabeza
        ['x', 'y', 'z'].forEach(axis => {
            let sum = 0;
            this.frameBuffer.forEach(frame => {
                sum += frame.head[axis] || 0;
            });
            stabilized.head[axis] = sum / frameCount;
        });

        // Estabilizar ojos
        ['l', 'r'].forEach(eye => {
            let sum = 0;
            this.frameBuffer.forEach(frame => {
                sum += frame.eye[eye] || 0;
            });
            stabilized.eye[eye] = sum / frameCount;
        });

        return stabilized;
    }

    // Suavizado exponencial para evitar jitter
    applySmoothing(newResult) {
        if (!this.previousResults) {
            this.previousResults = newResult;
            return newResult;
        }

        const smoothed = JSON.parse(JSON.stringify(newResult));
        const alpha = this.smoothingFactor;

        // Suavizar rotaciones de cabeza
        if (this.previousResults.head && newResult.head) {
            smoothed.head.x = this.lerp(this.previousResults.head.x, newResult.head.x, 1 - alpha);
            smoothed.head.y = this.lerp(this.previousResults.head.y, newResult.head.y, 1 - alpha);
            smoothed.head.z = this.lerp(this.previousResults.head.z, newResult.head.z, 1 - alpha);
        }

        // Suavizar ojos
        if (this.previousResults.eye && newResult.eye) {
            smoothed.eye.l = this.lerp(this.previousResults.eye.l, newResult.eye.l, 1 - alpha);
            smoothed.eye.r = this.lerp(this.previousResults.eye.r, newResult.eye.r, 1 - alpha);
        }

        // Suavizar boca
        if (this.previousResults.mouth && newResult.mouth) {
            smoothed.mouth.x = this.lerp(this.previousResults.mouth.x, newResult.mouth.x, 1 - alpha);
            smoothed.mouth.y = this.lerp(this.previousResults.mouth.y, newResult.mouth.y, 1 - alpha);
        }

        // Suavizar blendshapes
        if (this.previousResults.blendshapes && newResult.blendshapes) {
            Object.keys(newResult.blendshapes).forEach(key => {
                if (this.previousResults.blendshapes[key] !== undefined) {
                    smoothed.blendshapes[key] = this.lerp(
                        this.previousResults.blendshapes[key], 
                        newResult.blendshapes[key], 
                        1 - alpha
                    );
                }
            });
        }

        this.previousResults = smoothed;
        return smoothed;
    }

    // Función de interpolación lineal
    lerp(start, end, factor) {
        return start * (1 - factor) + end * factor;
    }

    // Convertir resultados a formato para Three.js/VRM
    toThreeJSFormat(kalidokitResult) {
        if (!kalidokitResult) return null;

        return {
            // Rotaciones en radianes para Three.js
            headRotation: {
                x: kalidokitResult.head?.x || 0,
                y: kalidokitResult.head?.y || 0,
                z: kalidokitResult.head?.z || 0
            },

            // Rotaciones de ojos
            eyeRotation: {
                left: kalidokitResult.eye?.l || 0,
                right: kalidokitResult.eye?.r || 0
            },

            // Posición de pupila
            pupilPosition: {
                x: kalidokitResult.pupil?.x || 0,
                y: kalidokitResult.pupil?.y || 0
            },

            // Expresiones de boca
            mouthShapes: kalidokitResult.mouth?.shape || {},

            // Blendshapes para VRM
            blendshapes: kalidokitResult.blendshapes || {}
        };
    }

    // Normalizar valores para rangos específicos
    normalizeForVRM(value, min = 0, max = 1) {
        return Math.max(min, Math.min(max, value));
    }

    // Configurar factor de suavizado
    setSmoothingFactor(factor) {
        this.smoothingFactor = Math.max(0, Math.min(1, factor));
    }

    // Resetear estado de suavizado
    reset() {
        this.previousResults = null;
    }
}