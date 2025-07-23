// Controles adicionales de sensibilidad y calibración
export function addSensitivityControls() {
    const settingsDiv = document.querySelector('.settings');
    if (!settingsDiv) return;
    
    // Control de sensibilidad de expresiones
    const sensitivityControl = document.createElement('label');
    sensitivityControl.innerHTML = `
        Sensibilidad Expresiones:
        <input type="range" id="expression-sensitivity" min="1" max="5" step="0.5" value="2.5">
        <span id="sensitivity-value">2.5</span>
    `;
    
    const sensitivitySlider = sensitivityControl.querySelector('#expression-sensitivity');
    const sensitivityValueSpan = sensitivityControl.querySelector('#sensitivity-value');
    
    sensitivitySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        sensitivityValueSpan.textContent = value.toFixed(1);
        
        // Actualizar sensibilidad en Kalidokit adapter
        const event = new CustomEvent('sensitivityChanged', { detail: { sensitivity: value } });
        document.dispatchEvent(event);
    });
    
    settingsDiv.appendChild(sensitivityControl);

    // Control de umbral de blendshapes
    const thresholdControl = document.createElement('label');
    thresholdControl.innerHTML = `
        Umbral Mínimo:
        <input type="range" id="blendshape-threshold" min="0.001" max="0.05" step="0.001" value="0.01">
        <span id="threshold-value">0.01</span>
    `;
    
    const thresholdSlider = thresholdControl.querySelector('#blendshape-threshold');
    const thresholdValueSpan = thresholdControl.querySelector('#threshold-value');
    
    thresholdSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        thresholdValueSpan.textContent = value.toFixed(3);
        
        // Actualizar umbral en Kalidokit adapter
        const event = new CustomEvent('thresholdChanged', { detail: { threshold: value } });
        document.dispatchEvent(event);
    });
    
    settingsDiv.appendChild(thresholdControl);

    // Botón de recalibración rápida
    const quickCalibButton = document.createElement('button');
    quickCalibButton.className = 'btn';
    quickCalibButton.textContent = 'Calibración Rápida';
    quickCalibButton.style.width = '100%';
    quickCalibButton.style.marginTop = '10px';
    
    quickCalibButton.addEventListener('click', () => {
        const event = new CustomEvent('quickCalibration');
        document.dispatchEvent(event);
    });
    
    settingsDiv.appendChild(quickCalibButton);

    // Toggle debug visual
    const debugToggle = document.createElement('label');
    debugToggle.innerHTML = `
        <input type="checkbox" id="debug-visual">
        Mostrar puntos de debug
    `;
    
    const debugCheckbox = debugToggle.querySelector('#debug-visual');
    debugCheckbox.addEventListener('change', (e) => {
        const event = new CustomEvent('debugModeChanged', { detail: { enabled: e.target.checked } });
        document.dispatchEvent(event);
    });
    
    settingsDiv.appendChild(debugToggle);
}