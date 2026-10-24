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
  const btnFps = document.getElementById('btnFps');
  const fpsBadge = document.getElementById('fpsBadge');
  const fpsVal = document.getElementById('fpsVal');
  const volumeSlider = document.getElementById('volumeSlider');
  const viewportCard = document.getElementById('viewportCard');
  const gamepadStatus = document.getElementById('gamepadStatus');
  const wasmStatus = document.getElementById('wasmStatus');

  let wasmInstance = null;
  let isRunning = false;
  let isWide = true;
  let showFps = true;

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
  let gl = null;
  let glProgram = null;
  let glTex = null;
  let glTexW = 0;
  let glTexH = 0;
  let dCtx = null;
  let offscreen = null;
  let offCtx = null;
  let offImgData = null;
  let frameCount = 0;
  let lastFpsTime = performance.now();
  let fpsFrames = 0;

  function initWebGL() {
    if (!displayCanvas) return false;
    try {
      const glOptions = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        desynchronized: true
      };
      gl = displayCanvas.getContext('webgl2', glOptions) || displayCanvas.getContext('webgl', glOptions);
      if (!gl) return false;

      const vsSource = `
        attribute vec2 aPos;
        attribute vec2 aUv;
        varying vec2 vUv;
        void main() {
          vUv = aUv;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }
      `;
      const fsSource = `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        void main() {
          vec4 c = texture2D(uTex, vUv);
          gl_FragColor = vec4(c.b, c.g, c.r, 1.0);
        }
      `;

      function createShader(glCtx, type, src) {
        const s = glCtx.createShader(type);
        glCtx.shaderSource(s, src);
        glCtx.compileShader(s);
        if (!glCtx.getShaderParameter(s, glCtx.COMPILE_STATUS)) {
          console.warn('[WebGL] Shader compile error:', glCtx.getShaderInfoLog(s));
          glCtx.deleteShader(s);
          return null;
        }
        return s;
      }

      const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
      const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) { gl = null; return false; }

      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vs);
      gl.attachShader(glProgram, fs);
      gl.linkProgram(glProgram);
      if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
        console.warn('[WebGL] Program link error:', gl.getShaderInfoLog(glProgram));
        gl = null;
        return false;
      }

      gl.useProgram(glProgram);
      const uTexLoc = gl.getUniformLocation(glProgram, 'uTex');
      gl.uniform1i(uTexLoc, 0);

      const vaoBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vaoBuffer);
      const quadData = new Float32Array([
        -1,  1,  0, 0,
        -1, -1,  0, 1,
         1,  1,  1, 0,
         1,  1,  1, 0,
        -1, -1,  0, 1,
         1, -1,  1, 1
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);

      const aPosLoc = gl.getAttribLocation(glProgram, 'aPos');
      const aUvLoc = gl.getAttribLocation(glProgram, 'aUv');
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aUvLoc);
      gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 16, 8);

      glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      glTexW = 0;
      glTexH = 0;
      remoteLog('WEBGL_INIT', 'Hardware-accelerated WebGL renderer initialized successfully');
      return true;
    } catch (err) {
      console.warn('[WebGL] Initialization failed, using 2D fallback:', err);
      gl = null;
      return false;
    }
  }

  if (!initWebGL() && displayCanvas) {
    dCtx = displayCanvas.getContext('2d', { alpha: false, desynchronized: true });
    offscreen = document.createElement('canvas');
    offCtx = offscreen.getContext('2d', { alpha: false });
    remoteLog('CANVAS2D_FALLBACK', 'Initialized 2D Canvas fallback');
  }

  if (displayCanvas) {
    displayCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      gl = null;
      remoteLog('WEBGL_LOST', 'WebGL context lost, falling back to 2D canvas');
      if (!dCtx) {
        dCtx = displayCanvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!offscreen) {
          offscreen = document.createElement('canvas');
          offCtx = offscreen.getContext('2d', { alpha: false });
        }
      }
    }, false);
    displayCanvas.addEventListener('webglcontextrestored', () => {
      initWebGL();
    }, false);
  }

  window.tekkenDrawFrame = function (heapU32, ptr, w, h) {
    if (!w || !h || !heapU32 || !displayCanvas) return;

    if (gl) {
      // GPU DIRECT PATH: Zero CPU loop, zero GC, BGR->RGB swizzle in hardware shader (<0.15ms)
      const u8 = new Uint8Array(heapU32.buffer, ptr, w * h * 4);

      gl.bindTexture(gl.TEXTURE_2D, glTex);
      if (glTexW !== w || glTexH !== h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);
        glTexW = w;
        glTexH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, u8);
      }

      const dw = displayCanvas.width;
      const dh = displayCanvas.height;
      const isWideSource = (w / h) > 1.5;
      let targetW = dw;
      let targetX = 0;

      if (!isWide || !isWideSource) {
        targetW = Math.round((dh * 4) / 3);
        targetX = Math.round((dw - targetW) / 2);
      }

      gl.viewport(0, 0, dw, dh);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.viewport(targetX, 0, targetW, dh);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else if (dCtx) {
      // Software 2D fallback path
      if (offscreen.width !== w || offscreen.height !== h) {
        offscreen.width = w;
        offscreen.height = h;
        offImgData = offCtx.createImageData(w, h);
      }

      const dst32 = new Uint32Array(offImgData.data.buffer);
      const startIdx = ptr >> 2;
      for (let i = 0; i < dst32.length; i++) {
        const px = heapU32[startIdx + i];
        dst32[i] = 0xFF000000 | ((px & 0xFF) << 16) | (px & 0xFF00) | ((px >> 16) & 0xFF);
      }
      offCtx.putImageData(offImgData, 0, 0);

      const dw = displayCanvas.width;
      const dh = displayCanvas.height;
      const isWideSource = (w / h) > 1.5;
      let targetW = dw;
      let targetX = 0;
      if (!isWide || !isWideSource) {
        targetW = Math.round((dh * 4) / 3);
        targetX = Math.round((dw - targetW) / 2);
      }

      dCtx.fillStyle = '#000000';
      dCtx.fillRect(0, 0, dw, dh);
      dCtx.imageSmoothingEnabled = false;
      dCtx.drawImage(offscreen, 0, 0, w, h, targetX, 0, targetW, dh);
    }

    if (bootOverlay && !bootOverlay.classList.contains('hidden')) {
      bootOverlay.classList.add('hidden');
    }

    frameCount++;
    fpsFrames++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
      const currentFps = (fpsFrames * 1000) / (now - lastFpsTime);
      const formatted = currentFps.toFixed(1);

      if (fpsVal) {
        fpsVal.textContent = formatted;
      }
      if (fpsBadge) {
        let qualityClass = 'fps-good';
        if (currentFps < 45) {
          qualityClass = 'fps-low';
        } else if (currentFps < 57) {
          qualityClass = 'fps-mid';
        }
        fpsBadge.className = `fps-badge ${qualityClass}${showFps ? ' active' : ''}`;
      }

      fpsFrames = 0;
      lastFpsTime = now;
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
      // 1. Fetch BIOS, Configs, Keybinds, Memory Cards & Mods
      let [biosData, tomlData, settingsData, keybindsData, cueData, slusData, card1Data, card2Data, modsManifests] = await Promise.all([
        fetchWithProgress('/wasm/bios/openbios.bin', 'OpenBIOS Image'),
        fetchWithProgress('/wasm/game.toml', 'Game Profile'),
        fetch('/wasm/settings.toml').then(r => r.text()).catch(() => ''),
        fetch('/wasm/keybinds.ini').then(r => r.text()).catch(() => ''),
        fetchWithProgress('/wasm/disc/Tekken%203%20(USA).cue', 'Disc CUE Sheet'),
        fetchWithProgress('/wasm/disc/SLUS_004.02', 'Boot Executable (SLUS-00402)'),
        fetchWithProgress('/wasm/saves/card1.mcd', 'Memory Card 1'),
        fetchWithProgress('/wasm/saves/card2.mcd', 'Memory Card 2'),
        fetch('/wasm/mods_manifests.json').then(r => r.json()).catch(() => null),
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
            if (settingsData) {
              mod.FS.createDataFile('/', 'settings.toml', settingsData, true, true);
            }
            if (keybindsData) {
              mod.FS.createDataFile('/', 'keybinds.ini', keybindsData, true, true);
            }

            // Mount Memory Cards
            try { mod.FS.mkdir('/saves'); } catch (e) { }
            if (card1Data) mod.FS.createDataFile('/saves', 'card1.mcd', card1Data, true, true);
            if (card2Data) mod.FS.createDataFile('/saves', 'card2.mcd', card2Data, true, true);

            // Mount Mods Manifests (unlocks roster, modes, and true widescreen)
            function ensureDir(p) {
              const parts = p.split('/').filter(Boolean);
              let cur = '';
              for (const part of parts) {
                cur += '/' + part;
                try { mod.FS.mkdir(cur); } catch (e) { }
              }
            }
            if (modsManifests) {
              for (const [relPath, content] of Object.entries(modsManifests)) {
                const fullPath = '/mods/' + relPath;
                const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
                const filename = fullPath.substring(fullPath.lastIndexOf('/') + 1);
                ensureDir(dir);
                mod.FS.createDataFile(dir, filename, content, true, true);
              }
            }

            console.log('[Tekken Web] Virtual files mounted successfully (BIOS, Disc, Settings, Keybinds, Saves, Mods)');

            // Free JavaScript memory references immediately so GC can reclaim the 600MB+ buffers
            biosData = null;
            tomlData = null;
            settingsData = null;
            keybindsData = null;
            cueData = null;
            slusData = null;
            track1Data = null;
            card1Data = null;
            card2Data = null;
            modsManifests = null;
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
      if (btnCustomRom) btnCustomRom.style.display = 'inline-flex';
      isRunning = false;
    }
  }

  // Collapsible Left Drawer Logic
  const drawerToggle = document.getElementById('drawerToggle');
  const drawerClose = document.getElementById('drawerClose');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const sidebarDrawer = document.getElementById('sidebarDrawer');

  function openDrawer() {
    if (sidebarDrawer) sidebarDrawer.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('open');
    if (drawerToggle) drawerToggle.classList.add('active');
  }

  function closeDrawer() {
    if (sidebarDrawer) sidebarDrawer.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('open');
    if (drawerToggle) drawerToggle.classList.remove('active');
    // Refocus canvas so fight controls immediately respond
    if (displayCanvas) displayCanvas.focus();
    else if (canvas) canvas.focus();
  }

  if (drawerToggle) {
    drawerToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebarDrawer && sidebarDrawer.classList.contains('open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (drawerClose) {
    drawerClose.addEventListener('click', closeDrawer);
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', closeDrawer);
  }

  // Key shortcuts: Escape to close drawer, Tab to toggle drawer
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebarDrawer && sidebarDrawer.classList.contains('open')) {
        closeDrawer();
        e.preventDefault();
      }
    } else if (e.key === 'Tab') {
      if (sidebarDrawer) {
        if (sidebarDrawer.classList.contains('open')) {
          closeDrawer();
        } else {
          openDrawer();
        }
        e.preventDefault();
      }
    }
  });

  // Event Listeners
  btnStart.addEventListener('click', () => {
    closeDrawer();
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

  if (btnCustomRom) {
    btnCustomRom.addEventListener('click', () => {
      fileInput.click();
    });
  }

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

  if (btnFps) {
    btnFps.addEventListener('click', () => {
      showFps = !showFps;
      btnFps.textContent = showFps ? 'FPS: On' : 'FPS: Off';
      btnFps.classList.toggle('active', showFps);
      if (fpsBadge) {
        fpsBadge.classList.toggle('active', showFps);
      }
    });
  }

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
