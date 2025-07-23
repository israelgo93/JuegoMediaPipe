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
        url: "https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
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

// Inicializar filtros de manos
['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach(finger => {
    ['CMC', 'MCP', 'PIP', 'DIP'].forEach(joint => {
        const key = `${finger}${joint}`;
        handFilters.left[key] = {
            x: new EMAFilter(0.3),
            y: new EMAFilter(0.3),
            z: new EMAFilter(0.3)
        };
        handFilters.right[key] = {
            x: new EMAFilter(0.3),
            y: new EMAFilter(0.3),
            z: new EMAFilter(0.3)
        };
    });
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

// Cargar modelo VRM
async function loadVRM() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        
        // Instalar el plugin VRM
        loader.register((parser) => {
            return new VRMLoaderPlugin(parser);
        });
        
        loader.load(
            CONFIG.avatar.url,
            async (gltf) => {
                try {
                    // Obtener VRM desde el resultado del loader
                    vrm = gltf.userData.vrm;
                    
                    if (!vrm) {
                        throw new Error("No se pudo cargar el modelo VRM");
                    }
                    
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
                    }
                    
                    console.log("✅ Avatar VRM cargado:", vrm);
                    console.log("Expresiones disponibles:", Object.keys(vrm.expressionManager?.expressionMap || {}));
                    
                    // Debug: Mostrar TODOS los huesos disponibles
                    if (vrm.humanoid) {
                        console.log("🦴 Todos los huesos disponibles:");
                        const bones = vrm.humanoid.humanBones;
                        Object.keys(bones).forEach(boneName => {
                            console.log(`  ${boneName}: ${bones[boneName] ? '✅' : '❌'}`);
                        });
                    }
                    resolve(vrm);
                    
                } catch (error) {
                    console.error("❌ Error procesando VRM:", error);
                    reject(error);
                }
            },
            (progress) => {
                const percent = (progress.loaded / progress.total * 100).toFixed(1);
                showLoading(`Cargando avatar... ${percent}%`);
            },
            (error) => {
                console.error("❌ Error cargando VRM:", error);
                reject(error);
            }
        );
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
        handResults.landmarks.forEach((landmarks, index) => {
            const handedness = handResults.handednesses[index][0];
            // Mantener la lógica original - el problema era en otro lado
            const isLeft = handedness.categoryName === 'Left';
            
            // Usar Kalidokit Hand.solve
            const rawRiggedHand = Hand.solve(landmarks, isLeft ? "Left" : "Right");
            
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
                animateHand(riggedLeftHand, "Left");
            } else {
                riggedRightHand = filteredHand;
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
        vrm.expressionManager.setValue('aa', Math.max(0, Math.min(1, normalizedFace.mouth.shape.A)));
        vrm.expressionManager.setValue('ee', Math.max(0, Math.min(1, normalizedFace.mouth.shape.E)));
        vrm.expressionManager.setValue('ih', Math.max(0, Math.min(1, normalizedFace.mouth.shape.I)));
        vrm.expressionManager.setValue('oh', Math.max(0, Math.min(1, normalizedFace.mouth.shape.O)));
        vrm.expressionManager.setValue('ou', Math.max(0, Math.min(1, normalizedFace.mouth.shape.U)));
    }
    
    // Rotación de cabeza
    if (normalizedFace.head && vrm.humanoid) {
        const head = vrm.humanoid.getNormalizedBoneNode('head') || vrm.humanoid.getRawBoneNode('head');
        if (head) {
            head.rotation.x = -normalizedFace.head.x * CONFIG.animation.headRotationRange;
            head.rotation.y = -normalizedFace.head.y * CONFIG.animation.headRotationRange;
            head.rotation.z = normalizedFace.head.z * CONFIG.animation.headRotationRange;
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

// Animar manos con Kalidokit usando huesos VRM estándar
function animateHand(riggedHand, side) {
    if (!vrm.humanoid || !riggedHand) {
        console.log(`⚠️ No se puede animar mano ${side}: vrm.humanoid=${!!vrm.humanoid}, riggedHand=${!!riggedHand}`);
        return;
    }
    
    const handPrefix = side === "Left" ? "left" : "right";
    console.log(`🤲 Animando mano ${side}:`, Object.keys(riggedHand));
    
    // Mapeo usando nombres exactos del estándar VRM
    const standardBones = [
        `${handPrefix}Hand`,
        `${handPrefix}ThumbMetacarpal`,
        `${handPrefix}ThumbProximal`,
        `${handPrefix}ThumbDistal`,
        `${handPrefix}IndexProximal`, 
        `${handPrefix}IndexIntermediate`,
        `${handPrefix}IndexDistal`,
        `${handPrefix}MiddleProximal`,
        `${handPrefix}MiddleIntermediate`, 
        `${handPrefix}MiddleDistal`,
        `${handPrefix}RingProximal`,
        `${handPrefix}RingIntermediate`,
        `${handPrefix}RingDistal`,
        `${handPrefix}LittleProximal`,
        `${handPrefix}LittleIntermediate`,
        `${handPrefix}LittleDistal`
    ];
    
    // Probar cada hueso estándar
    standardBones.forEach(boneName => {
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName) || vrm.humanoid.getRawBoneNode(boneName);
        if (bone) {
            console.log(`✅ Hueso ${boneName} encontrado y disponible`);
            
            // Aplicar una rotación simple de prueba
            if (riggedHand.Wrist) {
                bone.rotation.x = riggedHand.Wrist.x || 0;
                bone.rotation.y = riggedHand.Wrist.y || 0; 
                bone.rotation.z = riggedHand.Wrist.z || 0;
            }
        } else {
            console.log(`❌ Hueso ${boneName} no encontrado`);
        }
    });
    
    // Mapeo directo desde Kalidokit a VRM
    const kalidokitToVRM = {
        'Wrist': `${handPrefix}Hand`,
        'RingProximal': `${handPrefix}RingProximal`,
        'RingIntermediate': `${handPrefix}RingIntermediate`, 
        'RingDistal': `${handPrefix}RingDistal`,
        'IndexProximal': `${handPrefix}IndexProximal`,
        'IndexIntermediate': `${handPrefix}IndexIntermediate`,
        'IndexDistal': `${handPrefix}IndexDistal`,
        'MiddleProximal': `${handPrefix}MiddleProximal`,
        'MiddleIntermediate': `${handPrefix}MiddleIntermediate`,
        'MiddleDistal': `${handPrefix}MiddleDistal`,
        'ThumbProximal': `${handPrefix}ThumbProximal`,
        'ThumbDistal': `${handPrefix}ThumbDistal`,
        'LittleProximal': `${handPrefix}LittleProximal`,
        'LittleIntermediate': `${handPrefix}LittleIntermediate`,
        'LittleDistal': `${handPrefix}LittleDistal`
    };
    
    // Aplicar rotaciones desde Kalidokit
    Object.entries(riggedHand).forEach(([kalidokitJoint, rotation]) => {
        if (!rotation || typeof rotation !== 'object') return;
        
        const vrmBoneName = kalidokitToVRM[kalidokitJoint];
        if (!vrmBoneName) return;
        
        const bone = vrm.humanoid.getNormalizedBoneNode(vrmBoneName) || vrm.humanoid.getRawBoneNode(vrmBoneName);
        if (bone && rotation) {
            console.log(`🔄 Aplicando rotación a ${vrmBoneName}:`, rotation);
            bone.rotation.x = THREE.MathUtils.clamp(rotation.x || 0, -1, 1);
            bone.rotation.y = THREE.MathUtils.clamp(rotation.y || 0, -1, 1);
            bone.rotation.z = THREE.MathUtils.clamp(rotation.z || 0, -1, 1);
        }
    });
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

// Limpieza al cerrar
window.addEventListener("beforeunload", () => {
    if (webcamRunning) {
        stopTracking();
    }
    
    if (renderer) {
        renderer.dispose();
    }
});

// Inicializar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", initializeApp);