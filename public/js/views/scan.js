import { h, showAlert } from '../ui.js';
import { api } from '../api.js';
import { getMessage } from '../messages.js';

export function render(container, params) {
  const classroomId = Number(params?.id);
  container.replaceChildren();

  let videoStream = null;
  let scanInterval = null;
  let lastScannedCode = '';
  let lastScannedTime = 0;
  let currentPosition = null;
  let isScanning = false;

  const headerContainer = h('div');
  const alertContainer = h('div', { 'aria-live': 'polite' });
  const scannerArea = h('div', { style: 'display: none;' });
  const resultArea = h('div', { style: 'display: none;' });
  const manualContainer = h('div');

  const startBtn = h('button', {
    class: 'btn btn-primary btn-full',
    style: 'margin: 16px 0;'
  }, 'Start scan');

  // Video and canvas elements for camera
  const videoEl = document.createElement('video');
  videoEl.setAttribute('playsinline', '');
  videoEl.setAttribute('autoplay', '');
  videoEl.muted = true;

  const canvasEl = document.createElement('canvas');
  const canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });

  const scannerBox = h('div', { class: 'scanner-container' },
    videoEl,
    h('div', { class: 'scanner-frame' })
  );

  const scanStatus = h('p', {
    style: 'text-align: center; font-size: 0.875rem; margin-top: 8px;'
  }, 'Position the QR code inside the frame');

  scannerArea.appendChild(scannerBox);
  scannerArea.appendChild(scanStatus);

  // Manual fallback input
  const manualInput = h('input', {
    type: 'text',
    placeholder: 'e.g. 3YBMBMJTZIO8:R101',
    style: 'text-transform: uppercase; margin-bottom: 8px;'
  });
  const manualSubmitBtn = h('button', { class: 'btn btn-outline btn-full' }, 'Submit code');

  manualContainer.appendChild(
    h('details', {},
      h('summary', {}, 'Camera not working? Enter code manually'),
      h('div', { style: 'padding-top: 12px;' },
        manualInput,
        manualSubmitBtn
      )
    )
  );

  const card = h('div', { class: 'card' },
    headerContainer,
    h('p', { style: 'font-size: 0.85rem; color: var(--text-muted);' }, '🔒 Your location is read only when you scan.'),
    alertContainer,
    startBtn,
    scannerArea,
    resultArea,
    manualContainer
  );

  container.appendChild(card);

  // Stop camera stream & decode loop
  function stopCamera() {
    isScanning = false;
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
    videoEl.srcObject = null;
    scannerArea.style.display = 'none';
  }

  // Handle visibility changes
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      stopCamera();
      if (!resultArea.hasChildNodes() || resultArea.style.display === 'none') {
        startBtn.style.display = 'block';
        startBtn.disabled = false;
        startBtn.textContent = 'Start scan';
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Load classroom name
  async function loadClassroomInfo() {
    try {
      const res = await api('/api/classrooms');
      const cls = res.classrooms?.find(c => c.id === classroomId);
      if (cls) {
        headerContainer.replaceChildren(
          h('h1', {}, cls.name),
          cls.code ? h('p', {}, `Class code: ${cls.code}`) : null
        );
      } else {
        headerContainer.replaceChildren(h('h1', {}, 'Scan attendance'));
      }
    } catch (e) {
      headerContainer.replaceChildren(h('h1', {}, 'Scan attendance'));
    }
  }
  loadClassroomInfo();

  // Fresh location helper
  async function getFreshLocation(geofenceRequired) {
    if (!geofenceRequired) return null;
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by this browser.');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
      );
    });
  }

  // Show scan result card
  function displayResult(success, code, data = {}) {
    stopCamera();
    startBtn.style.display = 'none';
    scannerArea.style.display = 'none';
    resultArea.style.display = 'block';
    resultArea.replaceChildren();

    if (success) {
      const isCheckIn = data.result === 'OK_CHECK_IN';
      const timeStr = data.at ? new Date(data.at).toLocaleTimeString() : new Date().toLocaleTimeString();

      const resultCard = h('div', { class: 'scan-result-card' },
        h('div', { class: 'result-icon', style: 'color: var(--success);' }, '✓'),
        h('div', { class: 'result-title' }, isCheckIn ? 'Checked in' : 'Checked out'),
        h('p', { style: 'font-weight: 600; margin-top: 4px;' }, data.classroomName || 'Classroom'),
        h('p', { style: 'font-size: 0.875rem; color: var(--text-muted);' }, timeStr),
        h('div', { style: 'margin-top: 20px;' },
          h('button', {
            class: 'btn btn-primary btn-full',
            onclick: () => { window.location.hash = '#/student'; }
          }, 'Back to classes')
        )
      );
      resultArea.appendChild(resultCard);
    } else {
      const friendlyMsg = getMessage(code, data.message || 'Scan failed.');
      const resultCard = h('div', { class: 'scan-result-card' },
        h('div', { class: 'result-icon', style: 'color: var(--error);' }, '✕'),
        h('div', { class: 'result-title' }, 'Scan rejected'),
        h('p', { style: 'margin-top: 8px;' }, friendlyMsg),
        h('div', { style: 'margin-top: 20px; display: flex; gap: 12px;' },
          h('button', {
            class: 'btn btn-primary btn-full',
            onclick: () => {
              resultArea.style.display = 'none';
              startBtn.style.display = 'block';
              startBtn.disabled = false;
              startBtn.textContent = 'Start scan';
            }
          }, 'Try again'),
          h('button', {
            class: 'btn btn-outline btn-full',
            onclick: () => { window.location.hash = '#/student'; }
          }, 'Classes')
        )
      );
      resultArea.appendChild(resultCard);
    }
  }

  // Submit scan payload to server
  async function submitPayload(rawPayload) {
    showAlert(alertContainer, '');
    let configInfo = { geofence: true };
    try {
      configInfo = await api('/api/config');
    } catch (e) {
      // fallback
    }

    let coords = null;
    if (configInfo.geofence) {
      try {
        coords = await getFreshLocation(true);
      } catch (locErr) {
        if (locErr.code === 1) { // PERMISSION_DENIED
          displayResult(false, 'ERR_LOCATION_REQUIRED', { message: 'Location permission was denied. Please allow location in your browser site settings and try again.' });
          return;
        }
        displayResult(false, 'ERR_LOCATION_REQUIRED', { message: 'Location unavailable. Move to an open area and try again.' });
        return;
      }
    }

    try {
      const body = {
        classroomId,
        payload: rawPayload.trim()
      };
      if (coords) {
        body.lat = coords.latitude;
        body.lng = coords.longitude;
        body.accuracy = coords.accuracy;
      }

      const res = await api('/api/scan/submit', {
        method: 'POST',
        body
      });

      displayResult(true, res.result, res);
    } catch (err) {
      displayResult(false, err.error || 'ERR_BAD_REQUEST', { message: err.message });
    }
  }

  // Start scan button action (User gesture for camera + location)
  startBtn.addEventListener('click', async () => {
    showAlert(alertContainer, '');
    resultArea.style.display = 'none';
    startBtn.disabled = true;
    startBtn.textContent = 'Opening camera...';

    // Check config
    let configInfo = { geofence: true };
    try {
      configInfo = await api('/api/config');
    } catch (e) {
      // ignore
    }

    // Step 1: Location request
    if (configInfo.geofence) {
      try {
        currentPosition = await getFreshLocation(true);
      } catch (err) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start scan';
        if (err.code === 1) {
          showAlert(alertContainer, 'Location access was denied. Please enable location permissions in browser site settings.');
        } else if (err.code === 3) {
          showAlert(alertContainer, 'Location request timed out. Please try again in an area with better reception.');
        } else {
          showAlert(alertContainer, 'Location is unavailable. Please check your GPS and try again.');
        }
        return;
      }
    }

    // Step 2: Open rear camera
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      videoEl.srcObject = videoStream;
      await videoEl.play();
    } catch (camErr) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start scan';
      showAlert(alertContainer, 'Camera could not be accessed. Please allow camera permissions or use the manual code option below.');
      return;
    }

    startBtn.style.display = 'none';
    scannerArea.style.display = 'block';
    isScanning = true;

    // Step 3: Decode loop (~120ms)
    scanInterval = setInterval(() => {
      if (!isScanning || videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA) return;

      const vWidth = videoEl.videoWidth;
      const vHeight = videoEl.videoHeight;
      if (!vWidth || !vHeight) return;

      // Scale down canvas to at most 640px
      const scale = Math.min(1, 640 / vWidth);
      canvasEl.width = Math.floor(vWidth * scale);
      canvasEl.height = Math.floor(vHeight * scale);

      canvasCtx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      const imgData = canvasCtx.getImageData(0, 0, canvasEl.width, canvasEl.height);

      if (window.jsQR) {
        const code = window.jsQR(imgData.data, canvasEl.width, canvasEl.height, {
          inversionAttempts: 'attemptBoth' // White on black support
        });

        if (code && code.data) {
          const val = code.data.trim();
          const validFormat = /^[0-9A-Z]{12}:[0-9A-Z]{1,16}$/.test(val);

          if (!validFormat) {
            scanStatus.textContent = "That isn't an attendance code";
            setTimeout(() => {
              if (isScanning) scanStatus.textContent = 'Position the QR code inside the frame';
            }, 1500);
            return;
          }

          // Debounce 3 seconds for same code
          const nowMs = Date.now();
          if (val === lastScannedCode && (nowMs - lastScannedTime) < 3000) {
            return;
          }

          lastScannedCode = val;
          lastScannedTime = nowMs;

          // Valid code found!
          scanStatus.textContent = 'Code detected, verifying...';
          submitPayload(val);
        }
      }
    }, 120);
  });

  // Manual code submission
  manualSubmitBtn.addEventListener('click', async () => {
    const val = manualInput.value.trim().toUpperCase();
    if (!/^[0-9A-Z]{12}:[0-9A-Z]{1,16}$/.test(val)) {
      showAlert(alertContainer, 'Code must be in the format: 12-chars:ROOM_ID (e.g. 3YBMBMJTZIO8:R101)');
      return;
    }
    manualSubmitBtn.disabled = true;
    manualSubmitBtn.textContent = 'Submitting...';
    await submitPayload(val);
    manualSubmitBtn.disabled = false;
    manualSubmitBtn.textContent = 'Submit code';
  });

  manualInput.addEventListener('input', () => {
    manualInput.value = manualInput.value.toUpperCase();
  });

  // Return cleanup function to stop camera and remove listeners
  return () => {
    stopCamera();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
