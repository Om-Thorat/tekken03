// Tekken 3 Web Client & Wasm Bootloader
(function () {
  'use strict';

  // DOM Elements
  const canvas = document.getElementById('canvas');
  const bootOverlay = document.getElementById('bootOverlay');
  const btnStart = document.getElementById('btnStart');
  const btnCustomRom = document.getElementById('btnCustomRom');
  const fileInput = document.getElementById('fileInput');
  const progressBox = document.getElementById('progressBox');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const crtOverlay = document.getElementById('crtOverlay');
  const btnCrt = document.getElementById('btnCrt');
  const btnAspect = document.getElementById('btnAspect');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const volumeSlider = document.getElementById('volumeSlider');
  const viewportCard = document.getElementById('viewportCard');
  const gamepadStatus = document.getElementById('gamepadStatus');
  const wasmStatus = document.getElementById('wasmStatus');

  let wasmInstance = null;
  let isRunning = false;
  let isWide = true;

  function remoteLog(type, msg) {
    try {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `[${type}] ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`
      }).catch(() => {});
    } catch (e) {}
  }
  const origErr = console.error;
  console.error = function (...args) {
    origErr.apply(console, args);
    remoteLog('CONSOLE_ERROR', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };
  const origWarn = console.warn;
  console.warn = function (...args) {
    origWarn.apply(console, args);
    remoteLog('CONSOLE_WARN', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };
  window.addEventListener('error', (e) => {
    remoteLog('WINDOW_ERROR', e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    remoteLog('UNHANDLED_REJECTION', e.reason ? (e.reason.stack || e.reason.message || e.reason) : 'unknown');
  });
  if (canvas) {
    canvas.width = 1280;
    canvas.height = 720;
  }
  const displayCanvas = document.getElementById('displayCanvas');
  const dCtx = displayCanvas ? displayCanvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d', { alpha: false });
  let offImgData = null;
  let frameCount = 0;

  window.tekkenDrawFrame = function (heapU32, ptr, w, h) {
    if (!w || !h || !heapU32 || !displayCanvas || !dCtx) return;

    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w;
      offscreen.height = h;
      offImgData = offCtx.createImageData(w, h);
    }

    const dst32 = new Uint32Array(offImgData.data.buffer);
    const startIdx = ptr >> 2;

    for (let i = 0; i < dst32.length; i++) {
      const px = heapU32[startIdx + i];
      const b = px & 0xFF;
      const g = (px >> 8) & 0xFF;
      const r = (px >> 16) & 0xFF;
      dst32[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }

    offCtx.putImageData(offImgData, 0, 0);

    const dw = displayCanvas.width;
    const dh = displayCanvas.height;

    // Standard 4:3 PSX aspect ratio inside widescreen frame
    const targetW = Math.round((dh * 4) / 3);
    const targetX = Math.round((dw - targetW) / 2);

    dCtx.imageSmoothingEnabled = false;
    dCtx.drawImage(offscreen, 0, 0, w, h, targetX, 0, targetW, dh);

    if (bootOverlay && !bootOverlay.classList.contains('hidden')) {
      bootOverlay.classList.add('hidden');
    }

    frameCount++;
    if (frameCount === 1 || frameCount === 60 || frameCount % 300 === 0) {
      remoteLog('FRAME_RENDERED', `Rendered frame #${frameCount} (${w}x${h}) on displayCanvas`);
    }
  };

  remoteLog('PAGE_READY', 'Tekken Web client ready (displayCanvas set)');

  // Simple IndexedDB Cache for Disc Image (~600MB)
  const DB_NAME = 'Tekken3WebDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'rom_cache';

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function getCachedFile(key) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('IndexedDB not available:', e);
      return null;
    }
  }

  async function setCachedFile(key, buffer) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(buffer, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } catch (e) {
      console.warn('Failed to cache in IndexedDB:', e);
    }
  }

  // Streamed fetch with progress
  async function fetchWithProgress(url, statusLabel, cacheKey = null) {
    if (cacheKey) {
      const cached = await getCachedFile(cacheKey);
      if (cached) {
        progressText.textContent = `${statusLabel} (loaded from browser cache)`;
        progressPercent.textContent = '100%';
        progressBar.style.width = '100%';
        return cached;
      }
    }

    progressText.textContent = `Fetching ${statusLabel}...`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const contentLength = +response.headers.get('Content-Length') || 0;
    const reader = response.body.getReader();
    let received = 0;

    let fullBuffer = contentLength > 0 ? new Uint8Array(contentLength) : null;
    let chunks = fullBuffer ? null : [];
    let offset = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (fullBuffer) {
        fullBuffer.set(value, offset);
        offset += value.length;
        received = offset;
      } else {
        chunks.push(value);
        received += value.length;
      }

      if (contentLength > 0) {
        const pct = Math.round((received / contentLength) * 100);
        const mbReceived = (received / (1024 * 1024)).toFixed(1);
        const mbTotal = (contentLength / (1024 * 1024)).toFixed(1);
        progressPercent.textContent = `${pct}%`;
        progressText.textContent = `${statusLabel}: ${mbReceived} MB / ${mbTotal} MB`;
        progressBar.style.width = `${pct}%`;
      } else {
        const mbReceived = (received / (1024 * 1024)).toFixed(1);
        progressText.textContent = `${statusLabel}: ${mbReceived} MB`;
      }
    }

    if (!fullBuffer) {
      fullBuffer = new Uint8Array(received);
      let o = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, o);
        o += chunk.length;
      }
      chunks = null;
    }

    if (cacheKey) {
      setCachedFile(cacheKey, fullBuffer).catch(console.warn);
    }

    return fullBuffer;
  }

  // Load Wasm Script dynamically
  function loadWasmScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.body.appendChild(script);
    });
  }

  // Boot Engine
  async function bootTekken(customDiscBuffer = null) {
    if (isRunning) return;
    isRunning = true;

    btnStart.style.display = 'none';
    btnCustomRom.style.display = 'none';
    progressBox.classList.add('active');

    try {
      // 1. Fetch BIOS & Game Config
      let [biosData, tomlData, cueData, slusData] = await Promise.all([
        fetchWithProgress('/wasm/bios/openbios.bin', 'OpenBIOS Image'),
        fetchWithProgress('/wasm/game.toml', 'Game Profile'),
        fetchWithProgress('/wasm/disc/Tekken%203%20(USA).cue', 'Disc CUE Sheet'),
        fetchWithProgress('/wasm/disc/SLUS_004.02', 'Boot Executable (SLUS-00402)'),
      ]);

      // 2. Fetch or mount Track 1 (.bin)
      let track1Data = customDiscBuffer;
      if (!track1Data) {
        track1Data = await fetchWithProgress(
          '/wasm/disc/Tekken%203%20(USA)%20(Track%201).bin',
          'Tekken 3 Disc Track 1 (USA)',
          'tekken3_track1_bin'
        );
      }

      progressText.textContent = 'Initializing WebAssembly Runtime...';
      progressPercent.textContent = '99%';
      progressBar.style.width = '99%';

      // 3. Load Wasm Script
      if (typeof createTekkenModule === 'undefined') {
        await loadWasmScript('/wasm/Tekken_3_Recompiled.js');
      }

      // 4. Initialize Emscripten Module
      wasmStatus.textContent = 'Engine: Initializing Wasm & Workers...';
      wasmInstance = await createTekkenModule({
        canvas: canvas,
        mainScriptUrlOrBlob: '/wasm/Tekken_3_Recompiled.js',
        locateFile: (path) => '/wasm/' + path,
        arguments: ['--no-launcher', '--game', 'game.toml'],
        print: (text) => {
          remoteLog('WASM_STDOUT', text);
          console.log('[Wasm]', text);
          if (text.includes('[FPS]') || text.includes('[GPU]') || text.includes('Running')) {
            bootOverlay.classList.add('hidden');
          }
        },
        printErr: (text) => {
          remoteLog('WASM_STDERR', text);
          if (text.includes('[FPS]')) {
            const match = text.match(/\[FPS\]\s+game:\s+([\d.]+)\s+fps\s+\(([\d.]+)x\)/);
            if (match) {
              wasmStatus.textContent = `Engine: ${match[1]} FPS (${match[2]}x)`;
            }
            bootOverlay.classList.add('hidden');
          }
          console.warn('[Wasm]', text);
        },
        preRun: [
          (mod) => {
            // Virtual Filesystem Setup
            try {
              mod.FS.mkdir('/bios');
            } catch (e) { }
            mod.FS.createDataFile('/bios', 'openbios.bin', biosData, true, true);

            try {
              mod.FS.mkdir('/disc');
            } catch (e) { }
            mod.FS.createDataFile('/disc', 'SLUS_004.02', slusData, true, true);
            mod.FS.createDataFile('/disc', 'Tekken 3 (USA).cue', cueData, true, true);
            mod.FS.createDataFile(
              '/disc',
              'Tekken 3 (USA) (Track 1).bin',
              track1Data,
              true,
              true
            );

            mod.FS.createDataFile('/', 'game.toml', tomlData, true, true);
            console.log('[Tekken Web] Virtual files mounted successfully');

            // Free JavaScript memory references immediately so GC can reclaim the 600MB+ buffers
            biosData = null;
            tomlData = null;
            cueData = null;
            slusData = null;
            track1Data = null;
            customDiscBuffer = null;
          },
        ],
        onRuntimeInitialized: () => {
          console.log('[Tekken Web] Wasm runtime initialized');
          wasmStatus.textContent = 'Engine: Running (60 FPS)';
          const dot = document.querySelector('.status-dot');
          if (dot) dot.classList.add('active');
          bootOverlay.classList.add('hidden');
        },
      });

      canvas.focus();
    } catch (err) {
      console.error('[Tekken Web] Boot Error:', err);
      progressText.textContent = `Boot Error: ${err.message}`;
      progressPercent.textContent = 'ERR';
      btnStart.style.display = 'inline-flex';
      btnCustomRom.style.display = 'inline-flex';
      isRunning = false;
    }
  }

  // Event Listeners
  btnStart.addEventListener('click', () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!window.__tekkenAudioCtx) {
          window.__tekkenAudioCtx = new AudioCtx();
        }
        if (window.__tekkenAudioCtx.state === 'suspended') {
          window.__tekkenAudioCtx.resume();
        }
      }
    } catch (e) {}
    bootTekken();
  });

  btnCustomRom.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    progressBox.classList.add('active');
    progressText.textContent = `Reading custom ROM file (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`;
    reader.onload = () => {
      bootTekken(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });

  btnCrt.addEventListener('click', () => {
    crtOverlay.classList.toggle('enabled');
    btnCrt.classList.toggle('active');
  });

  btnAspect.addEventListener('click', () => {
    isWide = !isWide;
    if (isWide) {
      viewportCard.className = 'game-viewport-card viewport-aspect-16-9';
      btnAspect.textContent = 'Aspect: 16:9';
    } else {
      viewportCard.className = 'game-viewport-card viewport-aspect-4-3';
      btnAspect.textContent = 'Aspect: 4:3';
    }
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      viewportCard.requestFullscreen().catch(console.warn);
    } else {
      document.exitFullscreen().catch(console.warn);
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    // SDL audio master volume hook if supported
    const val = parseFloat(e.target.value);
    console.log('[Tekken Web] Volume set to:', val);
  });

  // Gamepad Detection Loop
  function pollGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let connected = false;
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        connected = true;
        gamepadStatus.textContent = `🎮 Pad 1: ${gp.id.split('(')[0].trim()}`;
        break;
      }
    }
    if (!connected) {
      gamepadStatus.textContent = '🎮 Keyboard Active';
    }
    requestAnimationFrame(pollGamepads);
  }
  requestAnimationFrame(pollGamepads);

})();
