import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';

export class VRMAvatarManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrm = null;
        this.mixer = null;
        this.clock = new THREE.Clock();
        
        // Estado de animación
        this.isAnimating = false;
        this.animationId = null;
        
        // Configuración de renderizado
        this.renderSettings = {
            width: 512,
            height: 512,
            antialias: true
        };

        this.initializeThreeJS();
    }

    initializeThreeJS() {
        // Crear escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x212121);

        // Configurar cámara
        this.camera = new THREE.PerspectiveCamera(
            30, 
            this.renderSettings.width / this.renderSettings.height, 
            0.1, 
            20
        );
        this.camera.position.set(0, 1.5, 2.5);
        this.camera.lookAt(new THREE.Vector3(0, 1.25, 0));

        // Configurar renderizador
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: this.renderSettings.antialias,
            alpha: true
        });
        this.renderer.setSize(this.renderSettings.width, this.renderSettings.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Configurar tone mapping para VRM
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;

        // Agregar al contenedor
        if (this.container) {
            this.container.appendChild(this.renderer.domElement);
        }

        // Configurar iluminación
        this.setupLighting();
    }

    setupLighting() {
        // Luz ambiental
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Luz direccional principal
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(1, 2, 1);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.1;
        directionalLight.shadow.camera.far = 10;
        directionalLight.shadow.camera.left = -2;
        directionalLight.shadow.camera.right = 2;
        directionalLight.shadow.camera.top = 2;
        directionalLight.shadow.camera.bottom = -2;
        this.scene.add(directionalLight);

        // Luz de relleno
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-1, 1, -1);
        this.scene.add(fillLight);
    }

    async loadVRM(url) {
        try {
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));

            const gltf = await loader.loadAsync(url);
            this.vrm = gltf.userData.vrm;

            if (this.vrm) {
                // Configurar VRM
                this.vrm.scene.traverse((object) => {
                    if (object.isMesh) {
                        object.castShadow = true;
                        object.receiveShadow = true;
                        object.frustumCulled = false;
                    }
                });

                // Agregar a la escena
                this.scene.add(this.vrm.scene);

                // Configurar mixer para animaciones
                this.mixer = new THREE.AnimationMixer(this.vrm.scene);

                // Iniciar loop de renderizado
                this.startAnimation();

                console.log("VRM cargado exitosamente:", this.vrm);
                return true;
            } else {
                throw new Error("No se pudo extraer VRM del archivo GLTF");
            }
        } catch (error) {
            console.error("Error cargando VRM:", error);
            return false;
        }
    }

    // Aplicar datos de face tracking al avatar
    updateAvatar(faceData) {
        if (!this.vrm || !faceData) return;

        try {
            // Aplicar rotaciones de cabeza
            if (faceData.headRotation && this.vrm.humanoid) {
                const neck = this.vrm.humanoid.getNormalizedBoneNode('neck');
                const head = this.vrm.humanoid.getNormalizedBoneNode('head');
                
                if (head) {
                    head.rotation.x = faceData.headRotation.x;
                    head.rotation.y = faceData.headRotation.y;
                    head.rotation.z = faceData.headRotation.z;
                }
            }

            // Aplicar rotaciones de ojos
            if (faceData.eyeRotation && this.vrm.humanoid) {
                const leftEye = this.vrm.humanoid.getNormalizedBoneNode('leftEye');
                const rightEye = this.vrm.humanoid.getNormalizedBoneNode('rightEye');

                if (leftEye) {
                    leftEye.rotation.x = faceData.eyeRotation.left;
                }
                if (rightEye) {
                    rightEye.rotation.x = faceData.eyeRotation.right;
                }
            }

            // Aplicar blendshapes/expresiones faciales
            if (faceData.blendshapes && this.vrm.expressionManager) {
                Object.entries(faceData.blendshapes).forEach(([name, value]) => {
                    const mappedName = this.mapBlendshapeName(name);
                    if (mappedName) {
                        this.vrm.expressionManager.setValue(mappedName, value);
                    }
                });
            }

            // Actualizar VRM
            this.vrm.update(this.clock.getDelta());

        } catch (error) {
            console.error("Error actualizando avatar:", error);
        }
    }

    // Mapear nombres de blendshapes de MediaPipe a VRM
    mapBlendshapeName(mediapipeName) {
        const mappingTable = {
            // Ojos
            'eyeBlinkLeft': 'blink_l',
            'eyeBlinkRight': 'blink_r',
            'eyeWideLeft': 'surprise',
            'eyeWideRight': 'surprise',
            
            // Boca
            'mouthSmileLeft': 'happy',
            'mouthSmileRight': 'happy',
            'mouthFrownLeft': 'sad',
            'mouthFrownRight': 'sad',
            'jawOpen': 'aa',
            'mouthPucker': 'oh',
            
            // Cejas
            'browDownLeft': 'angry',
            'browDownRight': 'angry',
            'browInnerUp': 'surprised',
            
            // Mejillas
            'cheekPuff': 'puff',
            
            // Entrecerrar ojos
            'eyeSquintLeft': 'wink_l',
            'eyeSquintRight': 'wink_r'
        };

        return mappingTable[mediapipeName] || null;
    }

    startAnimation() {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        const animate = () => {
            if (!this.isAnimating) return;
            
            this.animationId = requestAnimationFrame(animate);
            
            const deltaTime = this.clock.getDelta();
            
            // Actualizar mixer si existe
            if (this.mixer) {
                this.mixer.update(deltaTime);
            }
            
            // Actualizar VRM si existe
            if (this.vrm) {
                this.vrm.update(deltaTime);
            }
            
            // Renderizar escena
            this.renderer.render(this.scene, this.camera);
        };
        
        animate();
    }

    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    // Cambiar resolución de renderizado
    setSize(width, height) {
        this.renderSettings.width = width;
        this.renderSettings.height = height;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    // Limpiar recursos
    dispose() {
        this.stopAnimation();
        
        if (this.vrm) {
            this.scene.remove(this.vrm.scene);
            this.vrm = null;
        }
        
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            if (this.container && this.renderer.domElement) {
                this.container.removeChild(this.renderer.domElement);
            }
        }
        
        // Limpiar geometrías, materiales y texturas
        this.scene?.traverse((object) => {
            if (object.geometry) {
                object.geometry.dispose();
            }
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
    }

    // Obtener información del VRM actual
    getVRMInfo() {
        if (!this.vrm || !this.vrm.meta) return null;
        
        return {
            title: this.vrm.meta.title || 'Unknown',
            author: this.vrm.meta.author || 'Unknown',
            version: this.vrm.meta.version || '1.0',
            expressionNames: this.vrm.expressionManager ? 
                Object.keys(this.vrm.expressionManager.expressionMap) : []
        };
    }
}