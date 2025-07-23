# MediaPipe Avatar VRM - Fullscreen Edition

Una aplicación web avanzada que combina **MediaPipe**, **Kalidokit** y **Three.js** para crear un avatar VRM animado en tiempo real que imita expresiones faciales y gestos de manos con experiencia fullscreen optimizada.

## 🚀 Características

- **Detección facial en tiempo real** usando MediaPipe Face Landmarker
- **Seguimiento de expresiones faciales** con 52 blendshapes
- **Avatares VRM animados** con soporte para expresiones y rotaciones
- **Conversión inteligente** de landmarks MediaPipe a rotaciones VRM usando Kalidokit
- **Suavizado de movimientos** para animaciones naturales
- **Interfaz moderna** con controles en tiempo real
- **Soporte para avatares personalizados** (.vrm)
- **Métricas de rendimiento** (FPS, latencia)
- **Panel de debugging** para desarrolladores

## 🛠 Tecnologías Utilizadas

- **MediaPipe Tasks Vision**: Detección y análisis facial
- **Kalidokit**: Conversión de landmarks a datos de rigging
- **Three.js**: Renderizado 3D
- **@pixiv/three-vrm**: Soporte para modelos VRM
- **Vite**: Bundler y servidor de desarrollo
- **Vanilla JavaScript**: Sin frameworks, máximo rendimiento

## 📁 Estructura del Proyecto

```
src/
├── tracking/
│   └── faceTracker.js          # Gestor de MediaPipe Face Landmarker
├── avatar/
│   └── vrmAvatarManager.js     # Gestor de avatares VRM y Three.js
├── utils/
│   ├── kalidokitAdapter.js     # Adaptador para Kalidokit
│   ├── avatarRigService.js     # Servicio principal de coordinación
│   └── blendshapeMapping.json  # Mapeo MediaPipe → VRM
├── assets/                     # Recursos estáticos
├── main.js                     # Aplicación principal
└── style.css                  # Estilos de la interfaz
```

## 🚦 Instalación y Uso

### Prerequisitos

- Node.js (v16 o superior)
- Navegador moderno con soporte para WebRTC y WebGL
- Cámara web funcional

### Instalación

1. **Clonar el repositorio**:
   ```bash
   git clone <url-del-repositorio>
   cd JuegoMediaPipe
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

3. **Iniciar el servidor de desarrollo**:
   ```bash
   npm run dev
   ```

4. **Abrir en el navegador**:
   - Ir a `http://localhost:5173`
   - Permitir acceso a la cámara cuando se solicite

### Build para Producción

```bash
npm run build
```

Los archivos de producción se generarán en la carpeta `dist/`.

## 🎮 Cómo Usar

1. **Inicializar**: La aplicación se carga automáticamente con un avatar por defecto
2. **Seleccionar avatar**: Elige entre los avatares disponibles o carga tu propio archivo .vrm
3. **Iniciar tracking**: Haz clic en "Iniciar Tracking" para comenzar la detección facial
4. **Ajustar configuración**: Usa los controles para modificar suavizado, expresiones, etc.
5. **Recalibrar**: Usa el botón "Recalibrar" para resetear la pose neutral
6. **Debug**: Doble clic en el header para mostrar información de debugging

## 🎛 Controles de Configuración

- **Suavizado**: Controla la suavidad de las transiciones (0.0 = sin suavizado, 1.0 = máximo suavizado)
- **Expresiones faciales**: Habilita/deshabilita el mapeo de blendshapes
- **Rotación de cabeza**: Controla si el avatar sigue los movimientos de cabeza
- **Recalibrar**: Establece la pose actual como neutral

## 🔧 Configuración Avanzada

### Mapeo de Blendshapes

El archivo `src/utils/blendshapeMapping.json` contiene el mapeo entre los blendshapes de MediaPipe y las expresiones VRM. Puedes modificarlo para ajustar la correspondencia:

```json
{
  "mediaPipeToVRM": {
    "eyeBlinkLeft": "blink_l",
    "eyeBlinkRight": "blink_r",
    "mouthSmileLeft": "happy",
    // ... más mapeos
  }
}
```

### Configuración de Video

En `src/main.js`, puedes ajustar la configuración de video:

```javascript
const CONFIG = {
    video: {
        width: 640,
        height: 480,
        facingMode: "user"
    }
};
```

### Configuración de Rendimiento

Para optimizar el rendimiento, ajusta estos parámetros en el servicio:

```javascript
avatarRigService.setConfig({
    targetFPS: 30,
    enableSmoothing: true,
    smoothingFactor: 0.7
});
```

## 📊 Métricas de Rendimiento

La aplicación muestra en tiempo real:
- **FPS**: Frames por segundo de procesamiento
- **Latencia**: Tiempo de procesamiento por frame en milisegundos
- **Landmarks detectados**: Cantidad de puntos faciales identificados
- **Blendshapes activos**: Expresiones faciales siendo procesadas

## 🎨 Personalizar Avatares

### Usar Avatares VRM Existentes

La aplicación incluye avatares de ejemplo, pero puedes usar cualquier modelo VRM:

1. **VRM Hub**: [https://hub.vroid.com](https://hub.vroid.com)
2. **VRoid Studio**: Crear avatares personalizados
3. **Booth**: Marketplace de avatares VRM

### Crear Avatares Compatibles

Para máxima compatibilidad, asegúrate de que tu avatar VRM incluya:
- Blendshapes estándar (blink, happy, sad, etc.)
- Huesos humanoides correctamente rigged
- Expresiones faciales configuradas

### Mapeo de Expresiones

Si tu avatar usa nombres de expresiones diferentes, modifica el mapeo en `blendshapeMapping.json`:

```json
{
  "mediaPipeToVRM": {
    "mouthSmileLeft": "tu_nombre_de_expresion_feliz"
  }
}
```

## 🔧 Desarrollo y API

### Servicios Principales

#### `AvatarRigService`

Servicio principal que coordina tracking facial y animación del avatar:

```javascript
import { getAvatarRigService } from './utils/avatarRigService.js';

const service = getAvatarRigService();
await service.initialize(containerElement);
await service.loadAvatar(vrmUrl);
service.startTracking(videoElement);
```

#### `FaceTracker`

Gestiona MediaPipe Face Landmarker:

```javascript
import { getFaceTracker } from './tracking/faceTracker.js';

const tracker = getFaceTracker();
await tracker.initialize();
const results = tracker.processFrame(videoElement);
```

#### `VRMAvatarManager`

Maneja la carga y animación de avatares VRM:

```javascript
import { VRMAvatarManager } from './avatar/vrmAvatarManager.js';

const manager = new VRMAvatarManager(container);
await manager.loadVRM(url);
manager.updateAvatar(faceData);
```

### Callbacks y Eventos

```javascript
avatarRigService.onFaceDetected((results) => {
    // Procesar detección facial
});

avatarRigService.onAvatarUpdated((data) => {
    // Avatar actualizado
});

avatarRigService.onPerformanceUpdate((metrics) => {
    // Métricas de rendimiento
});
```

## 🐛 Solución de Problemas

### Problemas Comunes

1. **Error de cámara**: Verificar permisos del navegador
2. **Avatar no carga**: Verificar formato VRM y URL válida
3. **Bajo FPS**: Reducir resolución de video o deshabilitar suavizado
4. **Expresiones no responden**: Verificar mapeo de blendshapes

### Debug

Activa el panel de debug haciendo doble clic en el header para ver:
- Estado del tracking facial
- Valores de blendshapes en tiempo real
- Información del avatar cargado
- Métricas de rendimiento detalladas

### Optimización

Para mejorar el rendimiento:
- Usar resolución de video más baja (480p)
- Reducir factor de suavizado
- Deshabilitar expresiones no necesarias
- Usar avatares VRM optimizados

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia ISC. Ver el archivo `LICENSE` para más detalles.

## 🙏 Agradecimientos

- **MediaPipe Team** por las herramientas de computer vision
- **Kalidokit** por la conversión de landmarks
- **VRM Consortium** por el estándar de avatares 3D
- **Three.js** por el motor de renderizado 3D

## 📞 Soporte

Para reportar bugs o solicitar características:
- Abrir un issue en GitHub
- Proporcionar información detallada del problema
- Incluir información del navegador y sistema operativo

---

**¡Disfruta creando avatares animados con expresiones faciales en tiempo real!** 🎭