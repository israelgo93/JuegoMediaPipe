import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { FaceLandmarker, HandLandmarker, DrawingUtils, FilesetResolver } from '@mediapipe/tasks-vision';
import { Face, Hand, Vector, Utils } from 'kalidokit';

// Elementos del DOM
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const vrmContainer = document.getElementById("vrm-container");
const loadingIndicator = document.getElementById("loading-indicator");
const calibrationHelper = document.getElementById("calibration-helper");
const calibrationProgress = document.getElementById("calibration-progress");

// Botones de control
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const calibrateBtn = document.getElementById("calibrate-btn");

// Estadísticas de rendimiento
const fpsCounter = document.getElementById("fps-counter");
const latencyCounter = document.getElementById("latency-counter");
const trackingStatus = document.getElementById("tracking-status");

// Estado de la aplicación
let faceLandmarker = null;
let handLandmarker = null;
let drawingUtils = null;
let lastVideoTime = -1;
let runningMode = "IMAGE";
let webcamRunning = false;

// Three.js y VRM
let scene, camera, renderer, vrm;
let clock = new THREE.Clock();

// Kalidokit y animación - usamos las funciones directamente
let riggedFace = null;
let riggedLeftHand = null;
let riggedRightHand = null;

// Calibración
let calibrationFrames = 0;
let neutralPose = null;
let isCalibrated = false;

// Configuración optimizada
const CONFIG = {
    video: {
        width: 640,
        height: 480,
        facingMode: "user"
    },
    avatar: {
        // URL principal del modelo VRM
        url: "https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
        // URL de respaldo en caso de fallo
        fallbackUrl: "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
        position: [0, -0.5, 0],
        scale: 1.2
    },
    animation: {
        smoothingFactor: 0.7,
        threshold: 0.01,
        eyeRotationRange: Math.PI / 12,
        headRotationRange: Math.PI / 4
    }
};

// Suavizado EMA (Exponential Moving Average)
class EMAFilter {
    constructor(alpha = 0.3) {
        this.alpha = alpha;
        this.previousValue = null;
    }
    
    filter(value) {
        if (this.previousValue === null) {
            this.previousValue = value;
            return value;
        }
        
        const result = this.alpha * value + (1 - this.alpha) * this.previousValue;
        this.previousValue = result;
        return result;
    }
    
    reset() {
        this.previousValue = null;
    }
}

// Filtros para suavizar las animaciones
const faceFilters = {
    eye: {
        l: new EMAFilter(0.4),
        r: new EMAFilter(0.4)
    },
    head: {
        x: new EMAFilter(0.3),
        y: new EMAFilter(0.3),
        z: new EMAFilter(0.3)
    },
    mouth: {
        A: new EMAFilter(0.5),
        E: new EMAFilter(0.5),
        I: new EMAFilter(0.5),
        O: new EMAFilter(0.5),
        U: new EMAFilter(0.5)
    },
    pupil: {
        x: new EMAFilter(0.6),
        y: new EMAFilter(0.6)
    }
};

const handFilters = {
    left: {},
    right: {}
};

// Inicializar filtros de manos con nombres exactos de Kalidokit (con prefijos)
const leftHandJoints = [
    'LeftWrist', 
    'LeftThumbProximal', 'LeftThumbIntermediate', 'LeftThumbDistal',
    'LeftIndexProximal', 'LeftIndexIntermediate', 'LeftIndexDistal',
    'LeftMiddleProximal', 'LeftMiddleIntermediate', 'LeftMiddleDistal',
    'LeftRingProximal', 'LeftRingIntermediate', 'LeftRingDistal',
    'LeftLittleProximal', 'LeftLittleIntermediate', 'LeftLittleDistal'
];

const rightHandJoints = [
    'RightWrist',
    'RightThumbProximal', 'RightThumbIntermediate', 'RightThumbDistal',
    'RightIndexProximal', 'RightIndexIntermediate', 'RightIndexDistal',
    'RightMiddleProximal', 'RightMiddleIntermediate', 'RightMiddleDistal',
    'RightRingProximal', 'RightRingIntermediate', 'RightRingDistal',
    'RightLittleProximal', 'RightLittleIntermediate', 'RightLittleDistal'
];

leftHandJoints.forEach(joint => {
    handFilters.left[joint] = {
        x: new EMAFilter(0.3),
        y: new EMAFilter(0.3),
        z: new EMAFilter(0.3)
    };
});

rightHandJoints.forEach(joint => {
    handFilters.right[joint] = {
        x: new EMAFilter(0.3),
        y: new EMAFilter(0.3),
        z: new EMAFilter(0.3)
    };
});

// Inicializar aplicación
async function initializeApp() {
    try {
        console.log("Inicializando MediaPipe Avatar VRM Fullscreen...");
        
        showLoading("Inicializando MediaPipe...");
        
        // Configurar MediaPipe
        await initializeMediaPipe();
        
        // Configurar Three.js
        await initializeThreeJS();
        
        // Cargar avatar VRM
        await loadVRM();
        
        // Configurar webcam
        await setupWebcam();
        
        // Configurar controles
        setupControls();
        
        hideLoading();
        updateTrackingStatus("Listo para iniciar");
        
        console.log("✅ Aplicación inicializada correctamente");
        
    } catch (error) {
        console.error("❌ Error inicializando aplicación:", error);
        hideLoading();
        alert("Error inicializando la aplicación: " + error.message);
    }
}

// Inicializar MediaPipe
async function initializeMediaPipe() {
    // Configurar FilesetResolver
    const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    
    // Inicializar Face Landmarker
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: runningMode,
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true
    });
    
    // Inicializar Hand Landmarker
    handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: runningMode,
        numHands: 2
    });
    
    // Configurar drawing utils
    drawingUtils = new DrawingUtils(canvasCtx);
}

// Inicializar Three.js
async function initializeThreeJS() {
    // Crear escena
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    
    // Crear cámara
    camera = new THREE.PerspectiveCamera(
        50, 
        vrmContainer.clientWidth / vrmContainer.clientHeight, 
        0.1, 
        1000
    );
    camera.position.set(0, 1.0, 2.0);
    camera.lookAt(0, 0.5, 0);
    
    // Crear renderer
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha: true
    });
    renderer.setSize(vrmContainer.clientWidth, vrmContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    vrmContainer.appendChild(renderer.domElement);
    
    // Configurar iluminación
    const ambientLight = new THREE.AmbientLight(0x404040, 1.2);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 2, 3);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0x8090ff, 0.5);
    fillLight.position.set(-1, 0.5, -1);
    scene.add(fillLight);
    
    // Manejo de redimensionamiento
    window.addEventListener('resize', onWindowResize);
}

// Cargar modelo VRM con respaldo
async function loadVRM() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        
        // Instalar el plugin VRM
        loader.register((parser) => {
            return new VRMLoaderPlugin(parser);
        });
        
        // Función para intentar cargar desde una URL
        const attemptLoad = (url, isRetry = false) => {
            console.log(`🔄 ${isRetry ? 'Reintentando' : 'Cargando'} modelo VRM desde: ${url}`);
            
            loader.load(
                url,
            async (gltf) => {
                try {
                    console.log("📦 GLTF cargado exitosamente:", gltf);
                    
                    // Obtener VRM desde el resultado del loader
                    vrm = gltf.userData.vrm;
                    
                    if (!vrm) {
                        console.error("❌ No se encontró VRM en gltf.userData.vrm");
                        console.log("📋 Contenido de gltf.userData:", gltf.userData);
                        throw new Error("No se pudo cargar el modelo VRM - modelo no válido");
                    }
                    
                    console.log("✅ VRM extraído correctamente:", vrm);
                    
                    // Configurar posición y escala
                    vrm.scene.position.set(...CONFIG.avatar.position);
                    vrm.scene.scale.setScalar(CONFIG.avatar.scale);
                    
                    // Agregar a la escena
                    scene.add(vrm.scene);
                    
                    // Configurar expresiones por defecto
                    if (vrm.expressionManager) {
                        // Resetear todas las expresiones
                        const expressions = vrm.expressionManager.expressionMap;
                        Object.keys(expressions).forEach(name => {
                            vrm.expressionManager.setValue(name, 0);
                        });
                        console.log("🎭 Expresiones disponibles:", Object.keys(expressions));
                    } else {
                        console.warn("⚠️ No hay ExpressionManager disponible en este VRM");
                    }
                    
                    // Limpiar caches para el nuevo avatar
                    boneCache.clear();
                    previousRotations.clear();
                    handBonesValidated = false; // Resetear validación para nuevo avatar
                    
                    // Debug: Mostrar TODOS los huesos disponibles (opcional, comentar para producción)
                    if (vrm.humanoid) {
                        console.log("🦴 Sistema humanoid disponible");
                        const bones = vrm.humanoid.humanBones;
                        const availableBones = Object.keys(bones).filter(name => bones[name]);
                        console.log(`📊 ${availableBones.length} huesos disponibles de ${Object.keys(bones).length} posibles`);
                        
                        // Mostrar solo algunos huesos importantes
                        const importantBones = ['head', 'neck', 'leftHand', 'rightHand', 'leftEye', 'rightEye'];
                        importantBones.forEach(boneName => {
                            console.log(`  ${boneName}: ${bones[boneName] ? '✅' : '❌'}`);
                        });
                    } else {
                        console.warn("⚠️ No hay sistema humanoid disponible en este VRM");
                    }
                    
                    console.log("✅ Avatar VRM cargado y configurado exitosamente");
                    resolve(vrm);
                    
                } catch (error) {
                    console.error("❌ Error procesando VRM:", error);
                    reject(error);
                }
            },
            (progress) => {
                const percent = (progress.loaded / progress.total * 100).toFixed(1);
                showLoading(`Cargando avatar... ${percent}%`);
                console.log(`📈 Progreso de carga: ${percent}%`);
            },
            (error) => {
                console.error(`❌ Error cargando VRM desde URL: ${url}`);
                console.error("📋 Detalles del error:", error);
                
                // Información adicional para debugging
                if (error.status) {
                    console.error(`🌐 Código de estado HTTP: ${error.status}`);
                }
                if (error.message) {
                    console.error(`💬 Mensaje de error: ${error.message}`);
                }
                
                // Si no es un reintento y hay URL de respaldo, intentar con ella
                if (!isRetry && CONFIG.avatar.fallbackUrl) {
                    console.log("🔄 Intentando cargar desde URL de respaldo...");
                    attemptLoad(CONFIG.avatar.fallbackUrl, true);
                } else {
                    reject(new Error(`Error cargando modelo VRM: ${error.message || 'Error desconocido'}`));
                }
            }
        );
        };
        
        // Comenzar con la URL principal
        attemptLoad(CONFIG.avatar.url);
    });
}

// Configurar webcam
async function setupWebcam() {
    try {
        const constraints = {
            video: {
                width: CONFIG.video.width,
                height: CONFIG.video.height,
                facingMode: CONFIG.video.facingMode
            }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        // Configurar canvas
        canvasElement.width = CONFIG.video.width;
        canvasElement.height = CONFIG.video.height;
        
        // Esperar a que el video esté listo
        return new Promise((resolve) => {
            video.addEventListener("loadeddata", () => {
                resolve();
            });
        });
        
    } catch (error) {
        console.error("❌ Error configurando webcam:", error);
        throw new Error("No se pudo acceder a la cámara");
    }
}

// Configurar controles
function setupControls() {
    startBtn.addEventListener("click", startTracking);
    stopBtn.addEventListener("click", stopTracking);
    calibrateBtn.addEventListener("click", calibrateNeutralPose);
}

// Iniciar tracking
async function startTracking() {
    if (!faceLandmarker || !handLandmarker) {
        alert("MediaPipe no está inicializado");
        return;
    }
    
    try {
        if (runningMode === "IMAGE") {
            runningMode = "VIDEO";
            await faceLandmarker.setOptions({ runningMode: "VIDEO" });
            await handLandmarker.setOptions({ runningMode: "VIDEO" });
        }
        
        webcamRunning = true;
        
        // Actualizar UI
        startBtn.disabled = true;
        stopBtn.disabled = false;
        calibrateBtn.disabled = false;
        updateTrackingStatus("Tracking activo");
        
        // Iniciar loop de detección
        predictWebcam();
        
        // Iniciar loop de renderizado
        animate();
        
        console.log("✅ Tracking iniciado");
        
    } catch (error) {
        console.error("❌ Error iniciando tracking:", error);
        alert("Error iniciando tracking: " + error.message);
    }
}

// Detener tracking
function stopTracking() {
    webcamRunning = false;
    
    // Actualizar UI
    startBtn.disabled = false;
    stopBtn.disabled = true;
    calibrateBtn.disabled = true;
    updateTrackingStatus("Detenido");
    
    // Limpiar canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    console.log("⏹️ Tracking detenido");
}

// Loop principal de detección
async function predictWebcam() {
    if (!webcamRunning) return;
    
    const startTimeMs = performance.now();
    
    // Solo procesar si hay un nuevo frame
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        
        // Procesar face landmarks
        const faceResults = await faceLandmarker.detectForVideo(video, startTimeMs);
        
        // Procesar hand landmarks
        const handResults = await handLandmarker.detectForVideo(video, startTimeMs);
        
        // Procesar resultados
        processResults(faceResults, handResults);
        
        // Dibujar landmarks
        drawLandmarks(faceResults, handResults);
    }
    
    // Continuar loop
    requestAnimationFrame(predictWebcam);
}

// Procesar resultados de MediaPipe
function processResults(faceResults, handResults) {
    if (!vrm) return;
    
    // Procesar cara con Kalidokit
    if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
        const landmarks = faceResults.faceLandmarks[0];
        
        // Usar Kalidokit Face.solve para procesar landmarks
        const rawRiggedFace = Face.solve(landmarks, {
            runtime: "mediapipe",
            video: video,
            smoothBlink: false, // Lo haremos manualmente con filtros
            blinkSettings: [0.25, 0.75]
        });
        
        // Aplicar filtros de suavizado
        riggedFace = {
            eye: {
                l: faceFilters.eye.l.filter(rawRiggedFace.eye.l),
                r: faceFilters.eye.r.filter(rawRiggedFace.eye.r)
            },
            head: {
                x: faceFilters.head.x.filter(rawRiggedFace.head.x),
                y: faceFilters.head.y.filter(rawRiggedFace.head.y),
                z: faceFilters.head.z.filter(rawRiggedFace.head.z)
            },
            mouth: {
                shape: {
                    A: faceFilters.mouth.A.filter(rawRiggedFace.mouth.shape.A),
                    E: faceFilters.mouth.E.filter(rawRiggedFace.mouth.shape.E),
                    I: faceFilters.mouth.I.filter(rawRiggedFace.mouth.shape.I),
                    O: faceFilters.mouth.O.filter(rawRiggedFace.mouth.shape.O),
                    U: faceFilters.mouth.U.filter(rawRiggedFace.mouth.shape.U)
                }
            },
            pupil: {
                x: faceFilters.pupil.x.filter(rawRiggedFace.pupil.x),
                y: faceFilters.pupil.y.filter(rawRiggedFace.pupil.y)
            },
            brow: rawRiggedFace.brow || { l: 0, r: 0 }
        };
        
        // Aplicar animación facial
        if (riggedFace && vrm.expressionManager) {
            animateFace(riggedFace, faceResults.blendshapes?.[0]);
        }
        
        // Calibración automática
        if (!isCalibrated && calibrationFrames < 30) {
            calibrationFrames++;
            showCalibrationHelper(`Calibrando... ${Math.round((calibrationFrames/30)*100)}%`);
            
            if (calibrationFrames === 30) {
                neutralPose = JSON.parse(JSON.stringify(riggedFace)); // Deep copy
                isCalibrated = true;
                hideCalibrationHelper();
                console.log("✅ Calibración automática completada");
            }
        }
    }
    
    // Procesar manos con Kalidokit
    if (handResults.landmarks && handResults.landmarks.length > 0) {
        console.log(`👋 Procesando ${handResults.landmarks.length} mano(s) detectada(s)`);
        
        handResults.landmarks.forEach((landmarks, index) => {
            const handedness = handResults.handednesses[index][0];
            // Mantener la lógica original - el problema era en otro lado
            const isLeft = handedness.categoryName === 'Left';
            
            console.log(`🔍 Procesando mano ${isLeft ? 'izquierda' : 'derecha'} (${landmarks.length} landmarks)`);
            
            // Usar Kalidokit Hand.solve
            const rawRiggedHand = Hand.solve(landmarks, isLeft ? "Left" : "Right");
            console.log(`⚙️ Kalidokit generó:`, Object.keys(rawRiggedHand).length, 'articulaciones para', isLeft ? 'Left' : 'Right');
            console.log(`📊 Datos Kalidokit ejemplo (primer joint):`, Object.entries(rawRiggedHand)[0]);
            
            // Aplicar filtros de suavizado
            const side = isLeft ? 'left' : 'right';
            const filteredHand = {};
            
            Object.keys(rawRiggedHand).forEach(key => {
                if (handFilters[side][key]) {
                    filteredHand[key] = {
                        x: handFilters[side][key].x.filter(rawRiggedHand[key].x || 0),
                        y: handFilters[side][key].y.filter(rawRiggedHand[key].y || 0),
                        z: handFilters[side][key].z.filter(rawRiggedHand[key].z || 0)
                    };
                } else {
                    filteredHand[key] = rawRiggedHand[key];
                }
            });
            
            if (isLeft) {
                riggedLeftHand = filteredHand;
                console.log(`📤 Llamando animateHand para mano izquierda con ${Object.keys(filteredHand).length} articulaciones`);
                animateHand(riggedLeftHand, "Left");
            } else {
                riggedRightHand = filteredHand;
                console.log(`📤 Llamando animateHand para mano derecha con ${Object.keys(filteredHand).length} articulaciones`);
                animateHand(riggedRightHand, "Right");
            }
        });
    }
}

// Animar expresiones faciales
function animateFace(riggedFace, blendshapes) {
    if (!vrm.expressionManager) return;
    
    // Aplicar suavizado si hay pose neutral
    let normalizedFace = riggedFace;
    if (neutralPose && isCalibrated) {
        normalizedFace = {
            eye: {
                l: Math.max(0, (riggedFace.eye.l - neutralPose.eye.l) * 3),
                r: Math.max(0, (riggedFace.eye.r - neutralPose.eye.r) * 3)
            },
            mouth: {
                shape: {
                    A: Math.max(0, (riggedFace.mouth.shape.A - neutralPose.mouth.shape.A) * 4),
                    E: Math.max(0, (riggedFace.mouth.shape.E - neutralPose.mouth.shape.E) * 4),
                    I: Math.max(0, (riggedFace.mouth.shape.I - neutralPose.mouth.shape.I) * 4),
                    O: Math.max(0, (riggedFace.mouth.shape.O - neutralPose.mouth.shape.O) * 4),
                    U: Math.max(0, (riggedFace.mouth.shape.U - neutralPose.mouth.shape.U) * 4)
                }
            },
            head: riggedFace.head,
            pupil: riggedFace.pupil
        };
    }
    
    // Aplicar expresiones con mapeo mejorado
    if (normalizedFace.eye) {
        vrm.expressionManager.setValue('blinkLeft', Math.max(0, Math.min(1, normalizedFace.eye.l)));
        vrm.expressionManager.setValue('blinkRight', Math.max(0, Math.min(1, normalizedFace.eye.r)));
    }
    
    if (normalizedFace.mouth?.shape) {
        vrm.expressionManager.setValue('aa', Math.max(0, Math.min(1, normalizedFace.mouth.shape.A * ANIMATION_CONFIG.expressionIntensity)));
        vrm.expressionManager.setValue('ee', Math.max(0, Math.min(1, normalizedFace.mouth.shape.E * ANIMATION_CONFIG.expressionIntensity)));
        vrm.expressionManager.setValue('ih', Math.max(0, Math.min(1, normalizedFace.mouth.shape.I * ANIMATION_CONFIG.expressionIntensity)));
        vrm.expressionManager.setValue('oh', Math.max(0, Math.min(1, normalizedFace.mouth.shape.O * ANIMATION_CONFIG.expressionIntensity)));
        vrm.expressionManager.setValue('ou', Math.max(0, Math.min(1, normalizedFace.mouth.shape.U * ANIMATION_CONFIG.expressionIntensity)));
    }
    
    // Rotación de cabeza
    if (normalizedFace.head && vrm.humanoid) {
        const head = vrm.humanoid.getNormalizedBoneNode('head') || vrm.humanoid.getRawBoneNode('head');
        if (head) {
            head.rotation.x = -normalizedFace.head.x * CONFIG.animation.headRotationRange * ANIMATION_CONFIG.faceSensitivity;
            head.rotation.y = -normalizedFace.head.y * CONFIG.animation.headRotationRange * ANIMATION_CONFIG.faceSensitivity;
            head.rotation.z = normalizedFace.head.z * CONFIG.animation.headRotationRange * ANIMATION_CONFIG.faceSensitivity;
        }
        
        const neck = vrm.humanoid.getNormalizedBoneNode('neck') || vrm.humanoid.getRawBoneNode('neck');
        if (neck) {
            neck.rotation.x = -normalizedFace.head.x * 0.3;
            neck.rotation.y = -normalizedFace.head.y * 0.3;
            neck.rotation.z = normalizedFace.head.z * 0.2;
        }
    }
    
    // Movimiento de ojos
    if (normalizedFace.pupil && vrm.humanoid) {
        const leftEye = vrm.humanoid.getNormalizedBoneNode('leftEye') || vrm.humanoid.getRawBoneNode('leftEye');
        const rightEye = vrm.humanoid.getNormalizedBoneNode('rightEye') || vrm.humanoid.getRawBoneNode('rightEye');
        
        if (leftEye && rightEye) {
            // Limitar el rango de movimiento para evitar ojos blancos
            const eyeX = THREE.MathUtils.clamp(-normalizedFace.pupil.x * CONFIG.animation.eyeRotationRange, -Math.PI/8, Math.PI/8);
            const eyeY = THREE.MathUtils.clamp(-normalizedFace.pupil.y * CONFIG.animation.eyeRotationRange, -Math.PI/10, Math.PI/10);
            
            leftEye.rotation.x = eyeY;
            leftEye.rotation.y = eyeX;
            
            rightEye.rotation.x = eyeY;
            rightEye.rotation.y = eyeX;
        }
    }
}

// Mapeo correcto de Kalidokit (con prefijos Left/Right) a huesos VRM
const HAND_BONE_MAPPING = {
    Left: {
        'LeftWrist': 'leftHand',
        'LeftThumbProximal': 'leftThumbProximal',
        'LeftThumbIntermediate': 'leftThumbMetacarpal',
        'LeftThumbDistal': 'leftThumbDistal',
        'LeftIndexProximal': 'leftIndexProximal',
        'LeftIndexIntermediate': 'leftIndexIntermediate',
        'LeftIndexDistal': 'leftIndexDistal',
        'LeftMiddleProximal': 'leftMiddleProximal',
        'LeftMiddleIntermediate': 'leftMiddleIntermediate',
        'LeftMiddleDistal': 'leftMiddleDistal',
        'LeftRingProximal': 'leftRingProximal',
        'LeftRingIntermediate': 'leftRingIntermediate',
        'LeftRingDistal': 'leftRingDistal',
        'LeftLittleProximal': 'leftLittleProximal',
        'LeftLittleIntermediate': 'leftLittleIntermediate',
        'LeftLittleDistal': 'leftLittleDistal'
    },
    Right: {
        'RightWrist': 'rightHand',
        'RightThumbProximal': 'rightThumbProximal',
        'RightThumbIntermediate': 'rightThumbMetacarpal',
        'RightThumbDistal': 'rightThumbDistal',
        'RightIndexProximal': 'rightIndexProximal',
        'RightIndexIntermediate': 'rightIndexIntermediate',
        'RightIndexDistal': 'rightIndexDistal',
        'RightMiddleProximal': 'rightMiddleProximal',
        'RightMiddleIntermediate': 'rightMiddleIntermediate',
        'RightMiddleDistal': 'rightMiddleDistal',
        'RightRingProximal': 'rightRingProximal',
        'RightRingIntermediate': 'rightRingIntermediate',
        'RightRingDistal': 'rightRingDistal',
        'RightLittleProximal': 'rightLittleProximal',  
        'RightLittleIntermediate': 'rightLittleIntermediate',
        'RightLittleDistal': 'rightLittleDistal'
    }
};

// Cache de huesos para evitar búsquedas repetidas
const boneCache = new Map();

// Cache de rotaciones previas para suavizado
const previousRotations = new Map();

// Configuración dinámica de animación
let ANIMATION_CONFIG = {
    handSmoothingFactor: 0.15,
    faceSensitivity: 1.0,
    handRotationMultiplier: 1.0,
    expressionIntensity: 1.0
};

// Estado de validación de huesos para evitar verificaciones repetidas
let handBonesValidated = false;

// Función para validar huesos de manos una sola vez al inicio
function validateHandBones() {
    if (handBonesValidated || !vrm?.humanoid) return;
    
    const validBones = [];
    const invalidBones = [];
    
    // Validar huesos de ambas manos
    ['Left', 'Right'].forEach(side => {
        const mapping = HAND_BONE_MAPPING[side];
        Object.values(mapping).forEach(vrmBoneName => {
            const bone = vrm.humanoid.getNormalizedBoneNode(vrmBoneName) || 
                        vrm.humanoid.getRawBoneNode(vrmBoneName);
            if (bone) {
                validBones.push(vrmBoneName);
                boneCache.set(vrmBoneName, bone); // Pre-cargar cache
            } else {
                invalidBones.push(vrmBoneName);
            }
        });
    });
    
    console.log(`🦴 Huesos de manos validados: ${validBones.length} válidos, ${invalidBones.length} faltantes`);
    if (invalidBones.length > 0) {
        console.warn('❌ Huesos faltantes:', invalidBones);
    }
    
    handBonesValidated = true;
}

// Función optimizada para animar manos con Kalidokit
function animateHand(riggedHand, side) {
    console.log(`🤲 Animando mano ${side}:`, Object.keys(riggedHand).length, 'articulaciones');
    
    // Validación rápida sin logging excesivo
    if (!vrm?.humanoid || !riggedHand) {
        console.warn(`❌ Validación falló - VRM: ${!!vrm?.humanoid}, riggedHand: ${!!riggedHand}`);
        return;
    }
    
    // Validar huesos una sola vez al inicio
    if (!handBonesValidated) {
        validateHandBones();
    }
    
    const mapping = HAND_BONE_MAPPING[side];
    if (!mapping) {
        console.warn(`❌ No hay mapeo disponible para lado: ${side}`);
        return;
    }
    
    console.log(`🎯 Procesando ${Object.keys(riggedHand).length} articulaciones para ${side}`);
    
    let articulacionesProcesadas = 0;
    let rotacionesAplicadas = 0;
    
    // Procesar solo las articulaciones disponibles en riggedHand
    for (const [kalidokitJoint, rotation] of Object.entries(riggedHand)) {
        articulacionesProcesadas++;
        // Validar que la rotación sea válida
        if (!rotation || typeof rotation !== 'object' || 
            typeof rotation.x !== 'number' || 
            typeof rotation.y !== 'number' || 
            typeof rotation.z !== 'number') {
            console.warn(`⚠️ Articulación ${kalidokitJoint} tiene datos inválidos:`, rotation);
            continue;
        }
        
        const vrmBoneName = mapping[kalidokitJoint];
        if (!vrmBoneName) {
            console.warn(`⚠️ No hay mapeo VRM para articulación Kalidokit: ${kalidokitJoint}`);
            continue;
        }
        
        // Usar cache para evitar búsquedas repetidas de huesos
        let bone = boneCache.get(vrmBoneName);
        if (!bone) {
            bone = vrm.humanoid.getNormalizedBoneNode(vrmBoneName) || 
                   vrm.humanoid.getRawBoneNode(vrmBoneName);
            if (bone) {
                boneCache.set(vrmBoneName, bone);
                console.log(`✅ Hueso encontrado y cacheado: ${vrmBoneName}`);
            } else {
                console.warn(`❌ Hueso no encontrado en VRM: ${vrmBoneName}`);
            }
        }
        
        if (!bone) continue;
        
        // Aplicar suavizado de rotaciones para animaciones más fluidas
        const rotationKey = `${side}_${vrmBoneName}`;
        const prevRotation = previousRotations.get(rotationKey);
        
        let finalRotation = {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z
        };
        
        if (prevRotation && ANIMATION_CONFIG.handSmoothingFactor > 0) {
            // Interpolación lineal para suavizado
            finalRotation.x = THREE.MathUtils.lerp(prevRotation.x, rotation.x, 1 - ANIMATION_CONFIG.handSmoothingFactor);
            finalRotation.y = THREE.MathUtils.lerp(prevRotation.y, rotation.y, 1 - ANIMATION_CONFIG.handSmoothingFactor);
            finalRotation.z = THREE.MathUtils.lerp(prevRotation.z, rotation.z, 1 - ANIMATION_CONFIG.handSmoothingFactor);
        }
        
        // Aplicar rotaciones finales con multiplicador (valores en radianes de Kalidokit)
        bone.rotation.x = finalRotation.x * ANIMATION_CONFIG.handRotationMultiplier;
        bone.rotation.y = finalRotation.y * ANIMATION_CONFIG.handRotationMultiplier;
        bone.rotation.z = finalRotation.z * ANIMATION_CONFIG.handRotationMultiplier;
        
        rotacionesAplicadas++;
        
        // Guardar rotación actual para el próximo frame
        previousRotations.set(rotationKey, finalRotation);
        
        // Forzar actualización de la matriz del hueso
        bone.updateMatrixWorld(true);
    }
    
    console.log(`✅ ${side}: ${articulacionesProcesadas} articulaciones procesadas, ${rotacionesAplicadas} rotaciones aplicadas`);
}

// Dibujar landmarks en canvas
function drawLandmarks(faceResults, handResults) {
    // Limpiar canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Dibujar face landmarks
    if (faceResults.faceLandmarks) {
        for (const landmarks of faceResults.faceLandmarks) {
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
                color: "#C0C0C070", 
                lineWidth: 1
            });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { 
                color: "#FF3030",
                lineWidth: 2
            });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { 
                color: "#30FF30",
                lineWidth: 2
            });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { 
                color: "#E0E0E0",
                lineWidth: 2
            });
        }
    }
    
    // Dibujar hand landmarks con corrección de espejo
    if (handResults.landmarks) {
        handResults.landmarks.forEach((landmarks, index) => {
            // Invertir las coordenadas X para corregir el efecto espejo
            const flippedLandmarks = landmarks.map(landmark => ({
                x: 1.0 - landmark.x, // Invertir X
                y: landmark.y,       // Mantener Y
                z: landmark.z        // Mantener Z
            }));
            
            drawingUtils.drawConnectors(flippedLandmarks, HandLandmarker.HAND_CONNECTIONS, {
                color: "#00FF00",
                lineWidth: 2
            });
            drawingUtils.drawLandmarks(flippedLandmarks, { 
                color: "#FF0000", 
                lineWidth: 1 
            });
        });
    }
}

// Loop de animación de Three.js
function animate() {
    if (!webcamRunning) return;
    
    const deltaTime = clock.getDelta();
    
    // Actualizar VRM
    if (vrm) {
        vrm.update(deltaTime);
    }
    
    // Renderizar escena
    renderer.render(scene, camera);
    
    // Actualizar estadísticas de rendimiento
    updatePerformanceStats();
    
    // Continuar loop
    requestAnimationFrame(animate);
}

// Calibrar pose neutral
function calibrateNeutralPose() {
    calibrationFrames = 0;
    neutralPose = null;
    isCalibrated = false;
    
    // Resetear filtros para calibración limpia
    Object.values(faceFilters.eye).forEach(filter => filter.reset());
    Object.values(faceFilters.head).forEach(filter => filter.reset());
    Object.values(faceFilters.mouth).forEach(filter => filter.reset());
    Object.values(faceFilters.pupil).forEach(filter => filter.reset());
    
    showCalibrationHelper("Mantén una expresión neutral...");
    
    console.log("🎯 Iniciando calibración manual");
}

// Actualizar estadísticas de rendimiento
function updatePerformanceStats() {
    // FPS aproximado basado en requestAnimationFrame
    const now = performance.now();
    if (!updatePerformanceStats.lastTime) {
        updatePerformanceStats.lastTime = now;
        updatePerformanceStats.frameCount = 0;
    }
    
    updatePerformanceStats.frameCount++;
    
    if (now - updatePerformanceStats.lastTime >= 1000) {
        const fps = Math.round((updatePerformanceStats.frameCount * 1000) / (now - updatePerformanceStats.lastTime));
        fpsCounter.textContent = `FPS: ${fps}`;
        
        updatePerformanceStats.lastTime = now;
        updatePerformanceStats.frameCount = 0;
    }
}

// Manejo de redimensionamiento de ventana
function onWindowResize() {
    if (!camera || !renderer) return;
    
    camera.aspect = vrmContainer.clientWidth / vrmContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(vrmContainer.clientWidth, vrmContainer.clientHeight);
}

// Utilidades de UI
function showLoading(message = "Cargando...") {
    loadingIndicator.textContent = message;
    loadingIndicator.style.display = "block";
}

function hideLoading() {
    loadingIndicator.style.display = "none";
}

function showCalibrationHelper(message) {
    if (calibrationProgress) {
        calibrationProgress.textContent = message;
    }
    if (calibrationHelper) {
        calibrationHelper.style.display = "block";
    }
}

function hideCalibrationHelper() {
    if (calibrationHelper) {
        calibrationHelper.style.display = "none";
    }
}

function updateTrackingStatus(status) {
    trackingStatus.textContent = `Estado: ${status}`;
}

// Configuración de la interfaz de settings
function initializeSettingsControls() {
    const toggleBtn = document.getElementById('toggle-settings');
    const settingsOverlay = document.getElementById('settings-overlay');
    
    // Toggle del panel de configuración
    if (toggleBtn && settingsOverlay) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = settingsOverlay.style.display !== 'none';
            settingsOverlay.style.display = isVisible ? 'none' : 'block';
        });
    }
    
    // Control de sensibilidad facial
    const faceSensitivitySlider = document.getElementById('face-sensitivity');
    const faceSensitivityValue = document.getElementById('face-sensitivity-value');
    if (faceSensitivitySlider && faceSensitivityValue) {
        faceSensitivitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ANIMATION_CONFIG.faceSensitivity = value;
            faceSensitivityValue.textContent = value.toFixed(1);
        });
    }
    
    // Control de suavizado de manos
    const handSmoothingSlider = document.getElementById('hand-smoothing');
    const handSmoothingValue = document.getElementById('hand-smoothing-value');
    if (handSmoothingSlider && handSmoothingValue) {
        handSmoothingSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ANIMATION_CONFIG.handSmoothingFactor = value;
            handSmoothingValue.textContent = value.toFixed(2);
        });
    }
    
    // Control de multiplicador de rotación de manos
    const handRotationSlider = document.getElementById('hand-rotation');
    const handRotationValue = document.getElementById('hand-rotation-value');
    if (handRotationSlider && handRotationValue) {
        handRotationSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ANIMATION_CONFIG.handRotationMultiplier = value;
            handRotationValue.textContent = value.toFixed(1);
        });
    }
    
    // Control de intensidad de expresiones
    const expressionIntensitySlider = document.getElementById('expression-intensity');
    const expressionIntensityValue = document.getElementById('expression-intensity-value');
    if (expressionIntensitySlider && expressionIntensityValue) {
        expressionIntensitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ANIMATION_CONFIG.expressionIntensity = value;
            expressionIntensityValue.textContent = value.toFixed(1);
        });
    }
}

// Limpieza al cerrar
window.addEventListener("beforeunload", () => {
    if (webcamRunning) {
        stopTracking();
    }
    
    if (renderer) {
        renderer.dispose();
    }
});

// Inicializar controles de configuración cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    initializeSettingsControls();
});

// Inicializar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", initializeApp);