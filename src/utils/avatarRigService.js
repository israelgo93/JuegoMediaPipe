import { getFaceTracker } from '../tracking/faceTracker.js';
import { KalidokitAdapter } from './kalidokitAdapter.js';
import { VRMAvatarManager } from '../avatar/vrmAvatarManager.js';
import blendshapeMapping from './blendshapeMapping.json' assert { type: 'json' };

export class AvatarRigService {
    constructor() {
        this.faceTracker = null;
        this.kalidokitAdapter = null;
        this.avatarManager = null;
        this.isRunning = false;
        this.animationId = null;
        
        // Estado del sistema
        this.performance = {
            fps: 0,
            frameCount: 0,
            lastFpsUpdate: 0,
            processingTime: 0
        };

        // Configuración
        this.config = {
            targetFPS: 30,
            enableSmoothing: true,
            smoothingFactor: 0.7,
            enableBlendshapes: true,
            enableHeadRotation: true,
            enableEyeTracking: true
        };

        this.callbacks = {
            onFaceDetected: null,
            onAvatarUpdated: null,
            onPerformanceUpdate: null,
            onError: null
        };
    }

    // Getter para acceder al kalidokitAdapter
    get kalidokitAdapterInstance() {
        return this.kalidokitAdapter;
    }

    async initialize(avatarContainer) {
        try {
            console.log("Inicializando AvatarRigService...");

            // Inicializar Face Tracker
            this.faceTracker = getFaceTracker();
            await this.faceTracker.initialize();

            // Inicializar Kalidokit Adapter
            this.kalidokitAdapter = new KalidokitAdapter();
            if (this.config.enableSmoothing) {
                this.kalidokitAdapter.setSmoothingFactor(this.config.smoothingFactor);
            }

            // Inicializar Avatar Manager
            this.avatarManager = new VRMAvatarManager(avatarContainer);

            console.log("AvatarRigService inicializado correctamente");
            return true;

        } catch (error) {
            console.error("Error inicializando AvatarRigService:", error);
            this.handleError(error);
            return false;
        }
    }

    async loadAvatar(vrmUrl) {
        if (!this.avatarManager) {
            throw new Error("AvatarRigService no está inicializado");
        }

        try {
            const success = await this.avatarManager.loadVRM(vrmUrl);
            if (success) {
                console.log("Avatar VRM cargado exitosamente");
                return this.avatarManager.getVRMInfo();
            } else {
                throw new Error("Falló la carga del avatar VRM");
            }
        } catch (error) {
            console.error("Error cargando avatar:", error);
            this.handleError(error);
            throw error;
        }
    }

    startTracking(videoElement) {
        if (this.isRunning) {
            console.warn("El tracking ya está en funcionamiento");
            return;
        }

        if (!this.faceTracker || !this.kalidokitAdapter || !this.avatarManager) {
            throw new Error("AvatarRigService no está completamente inicializado");
        }

        this.isRunning = true;
        this.performance.lastFpsUpdate = performance.now();
        this.performance.frameCount = 0;

        const processFrame = () => {
            if (!this.isRunning) return;

            const frameStart = performance.now();

            try {
                // Procesar frame con MediaPipe
                const faceResults = this.faceTracker.processFrame(videoElement);
                
                if (faceResults.landmarks) {
                    // Notificar detección de rostro
                    if (this.callbacks.onFaceDetected) {
                        this.callbacks.onFaceDetected(faceResults);
                    }

                    // Procesar con Kalidokit
                    const kalidokitResults = this.kalidokitAdapter.processLandmarks(
                        faceResults.landmarks,
                        faceResults.blendshapes
                    );

                    if (kalidokitResults) {
                        // Convertir a formato Three.js/VRM
                        const vrmData = this.kalidokitAdapter.toThreeJSFormat(kalidokitResults);
                        
                        // Mapear blendshapes usando la tabla de mapeo
                        const mappedData = this.mapBlendshapesToVRM(vrmData);
                        
                        // Actualizar avatar
                        this.avatarManager.updateAvatar(mappedData);
                        
                        // Notificar actualización del avatar
                        if (this.callbacks.onAvatarUpdated) {
                            this.callbacks.onAvatarUpdated(mappedData);
                        }
                    }
                }

                // Calcular rendimiento
                this.updatePerformanceMetrics(frameStart);

            } catch (error) {
                console.error("Error procesando frame:", error);
                this.handleError(error);
            }

            // Continuar con el próximo frame
            this.animationId = requestAnimationFrame(processFrame);
        };

        processFrame();
        console.log("Tracking iniciado");
    }

    stopTracking() {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        console.log("Tracking detenido");
    }

    // Mapear blendshapes usando la tabla de mapeo JSON
    mapBlendshapesToVRM(vrmData) {
        if (!vrmData.blendshapes) return vrmData;

        const mappedBlendshapes = {};
        const mapping = blendshapeMapping.mediaPipeToVRM;

        Object.entries(vrmData.blendshapes).forEach(([mediaPipeName, value]) => {
            const vrmName = mapping[mediaPipeName];
            if (vrmName) {
                // Aplicar suavizado específico por tipo de expresión
                const smoothingKey = this.getSmoothinKeyForBlendshape(mediaPipeName);
                const smoothingFactor = blendshapeMapping.smoothingSettings[smoothingKey] || 0.7;
                
                mappedBlendshapes[vrmName] = this.normalizeBlendshapeValue(value, smoothingFactor);
            }
        });

        return {
            ...vrmData,
            blendshapes: mappedBlendshapes
        };
    }

    getSmoothinKeyForBlendshape(blendshapeName) {
        if (blendshapeName.includes('Blink')) return 'blinkSmoothing';
        if (blendshapeName.includes('mouth')) return 'mouthSmoothing';
        if (blendshapeName.includes('brow')) return 'browSmoothing';
        if (blendshapeName.includes('eye')) return 'eyeMovementSmoothing';
        return 'expressionSmoothing';
    }

    normalizeBlendshapeValue(value, smoothingFactor = 0.7) {
        // Normalizar valor entre 0 y 1
        const normalized = Math.max(0, Math.min(1, value));
        
        // Aplicar curva para hacer transiciones más naturales
        return Math.pow(normalized, smoothingFactor);
    }

    updatePerformanceMetrics(frameStart) {
        const now = performance.now();
        this.performance.processingTime = now - frameStart;
        this.performance.frameCount++;

        // Actualizar FPS cada segundo
        if (now - this.performance.lastFpsUpdate >= 1000) {
            this.performance.fps = this.performance.frameCount;
            this.performance.frameCount = 0;
            this.performance.lastFpsUpdate = now;

            if (this.callbacks.onPerformanceUpdate) {
                this.callbacks.onPerformanceUpdate(this.performance);
            }
        }
    }

    // Configuración del servicio
    setConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        if (this.kalidokitAdapter && newConfig.smoothingFactor !== undefined) {
            this.kalidokitAdapter.setSmoothingFactor(newConfig.smoothingFactor);
        }
    }

    getConfig() {
        return { ...this.config };
    }

    // Callbacks para eventos
    onFaceDetected(callback) {
        this.callbacks.onFaceDetected = callback;
    }

    onAvatarUpdated(callback) {
        this.callbacks.onAvatarUpdated = callback;
    }

    onPerformanceUpdate(callback) {
        this.callbacks.onPerformanceUpdate = callback;
    }

    onError(callback) {
        this.callbacks.onError = callback;
    }

    handleError(error) {
        if (this.callbacks.onError) {
            this.callbacks.onError(error);
        }
    }

    // Obtener estado actual
    getStatus() {
        return {
            isRunning: this.isRunning,
            isInitialized: !!(this.faceTracker && this.kalidokitAdapter && this.avatarManager),
            hasAvatar: !!(this.avatarManager && this.avatarManager.vrm),
            performance: { ...this.performance },
            config: { ...this.config }
        };
    }

    // Recalibrar pose neutral
    calibrateNeutralPose() {
        if (this.kalidokitAdapter) {
            this.kalidokitAdapter.reset();
            console.log("Pose neutral recalibrada");
        }
    }

    // Limpiar recursos
    dispose() {
        this.stopTracking();
        
        if (this.avatarManager) {
            this.avatarManager.dispose();
            this.avatarManager = null;
        }

        if (this.faceTracker) {
            this.faceTracker.destroy();
            this.faceTracker = null;
        }

        this.kalidokitAdapter = null;
        
        // Limpiar callbacks
        Object.keys(this.callbacks).forEach(key => {
            this.callbacks[key] = null;
        });

        console.log("AvatarRigService limpiado");
    }
}

// Singleton para uso global
let avatarRigInstance = null;

export const getAvatarRigService = () => {
    if (!avatarRigInstance) {
        avatarRigInstance = new AvatarRigService();
    }
    return avatarRigInstance;
};