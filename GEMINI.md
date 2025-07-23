# Proyecto: Selector de Avatar con MediaPipe

Este documento describe el plan de desarrollo para una aplicación web que utiliza MediaPipe para el reconocimiento de gestos y la selección de avatares en tiempo real.
Responde siempre en español.

## 1. Objetivo del Proyecto

El objetivo es desarrollar una aplicación web interactiva que cumpla con los siguientes requisitos:

- **Captura de Video:** Utilizar la cámara web del usuario (`WebRTC`).
- **Detección de Puntos Clave:** Emplear `FaceLandmarker` y `HandLandmarker` de MediaPipe para detectar puntos clave faciales y de manos en tiempo real.
- **Visualización:** Dibujar los puntos clave detectados sobre un `<canvas>` superpuesto al video.
- **Reconocimiento de Gestos:** Identificar un gesto de "pinza" (unión del pulgar y el índice).
- **Interacción:** Permitir al usuario seleccionar un avatar de una lista utilizando el gesto de pinza sobre la imagen del avatar deseado.
- **Interfaz de Usuario:** Mostrar el avatar seleccionado de forma prominente.

## 2. Stack Tecnológico

- **Lenguajes:** HTML5, CSS3, JavaScript (ES Modules)
- **Librerías:**
  - `@mediapipe/tasks-vision`: Para las tareas de visión por computadora.
- **Entorno de Desarrollo:**
  - `Vite`: Servidor de desarrollo y empaquetador.
  - `npm`: Gestor de paquetes.

## 3. Plan de Implementación

### Fase 1: Configuración y Corrección del Proyecto (Actual)

1.  **Corregir `package.json`**:
    - Cambiar `type` de `commonjs` a `module`.
    - Corregir la versión de `vite` a una estable (`^5.2.0`).
    - Añadir un script `build`.
2.  **Instalar Dependencias**: Ejecutar `npm install`.
3.  **Cambiar a `LIVE_STREAM`**:
    - Modificar `src/main.js` para inicializar los `Landmarkers` en modo `LIVE_STREAM`.
    - Implementar un bucle de predicción con `requestAnimationFrame`.
    - Usar `detectAsync` para el procesamiento de video y manejar los resultados mediante callbacks.

### Fase 2: Dibujo de Puntos Clave y Gesto de Pinza

1.  **Importar `DrawingUtils`**: Añadir la utilidad de dibujo de MediaPipe para visualizar los puntos clave.
2.  **Dibujar en Canvas**: En los callbacks de resultados, limpiar el canvas y dibujar los `faceLandmarks` y `handLandmarks`.
3.  **Implementar Lógica de Pinza**:
    - Calcular la distancia euclidiana entre la punta del pulgar (landmark 4) y el índice (landmark 8).
    - Considerar el gesto como "activo" si la distancia es menor a un umbral definido.

### Fase 3: Selección de Avatar por Posición

1.  **Obtener Coordenadas del Gesto**: Cuando el gesto de pinza esté activo, registrar la posición (x, y) en el canvas.
2.  **Mapear Coordenadas a Elementos**:
    - Obtener las dimensiones y posiciones de las imágenes de los avatares en el DOM.
    - Convertir las coordenadas normalizadas de la mano (0.0 a 1.0) a las coordenadas del canvas.
    - Detectar si la pinza ocurre dentro del área de alguno de los avatares.
3.  **Actualizar Selección**:
    - Si se detecta una colisión, actualizar el `<img>` del avatar principal y resaltar el avatar seleccionado en la lista.

### Fase 4: Estilo y Finalización

1.  **Mejorar CSS**: Ajustar `src/style.css` para asegurar que la superposición del video/canvas sea correcta y la interfaz sea intuitiva y estéticamente agradable.
2.  **Limpieza de Código**: Refactorizar y asegurar que el código sea modular y legible.
3.  **Pruebas**: Probar la aplicación en diferentes navegadores para asegurar la compatibilidad.
