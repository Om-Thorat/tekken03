/**
 * Tekken 3 Web Edition - True Local Simulation Netplay (Dual-Instance Input Sync)
 * 
 * In-Game Versus Mode Flow:
 * - Single-player, title screens, and menus remain 100% untouched and clean.
 * - When a player enters VS MODE in Tekken 3, a prompt appears: "Host Online", "Join Online", or "Play Locally".
 * - Both players navigate to VS MODE in their respective engines.
 * - Once both peers are confirmed in VS Mode, input synchronization unlocks seamlessly.
 * - Anti-echo check (e.isTrusted) prevents any synthetic event ping-pong loops.
 */

(() => {
  'use strict';

  // Tekken 3 PSX Main RAM Actor & World Offsets
  const P1_ACTOR_OFFSET = 0x0a9228; // 0x800a9228 & 0x1fffff
  const P2_ACTOR_OFFSET = 0x0aaab4; // 0x800aaab4 & 0x1fffff
  const MATCH_TIMER_OFFSET = 0x11863c; // 0x8011863c & 0x1fffff

  // Tekken 3 PSX Main RAM Camera & 3D Projection Offsets
  const CAM_PITCH_OFFSET = 0x098564; // 0x80098564 & 0x1fffff: Camera pitch angle
  const CAM_YAW_OFFSET = 0x098568; // 0x80098568 & 0x1fffff: Camera yaw angle (0..65535)
  const CAM_DELTA_OFFSET = 0x09856c; // 0x8009856c & 0x1fffff: Camera rotational delta per frame
  const CAM_TIMER_OFFSET = 0x098570; // 0x80098570 & 0x1fffff: Camera frame timer
  const CAM_0_STRUCT_OFFSET = 0x0a0328; // 0x800a0328 & 0x1fffff: Camera 0 combat view struct
  const CAM_MODE_OFFSET = 0x0a04c6; // 0x800a04c6 & 0x1fffff: Camera battle event/mode
  const CAM_CTRL_TRACK_OFFSET = 0x0a8ca0; // 0x800a8ca0 & 0x1fffff: Camera tracking mode flag
  const CAM_CTRL_TARGET_OFFSET = 0x0a8cd4; // 0x800a8cd4 & 0x1fffff: Camera focal target
  const CAM_CTRL_ANGLE_OFFSET = 0x0a8cdc; // 0x800a8cdc & 0x1fffff: Camera angle controller
  const PSX_RNG_SEED_OFFSET = 0x0a39b8; // 0x800a39b8 & 0x1fffff: func_8007A318 rand() PRNG state seed

  function getWasmBuffer() {
    if (window.Module && window.Module.HEAPU8 && window.Module.HEAPU8.buffer) {
      return window.Module.HEAPU8.buffer;
    }
    if (window.Module && window.Module.wasmMemory && window.Module.wasmMemory.buffer) {
      return window.Module.wasmMemory.buffer;
    }
    if (window.wasmInstance && window.wasmInstance.HEAPU8 && window.wasmInstance.HEAPU8.buffer) {
      return window.wasmInstance.HEAPU8.buffer;
    }
    if (window.wasmInstance && window.wasmInstance.wasmMemory && window.wasmInstance.wasmMemory.buffer) {
      return window.wasmInstance.wasmMemory.buffer;
    }
    if (window.tekkenWasmBuffer) return window.tekkenWasmBuffer;
    return null;
  }

  // Global engine hook invoked on every 60Hz frame swap by C runtime (gpu_gl_renderer.c)
  window.tekkenOnEngineFrame = (screen, mode, ramPtr, camYaw) => {
    if (window.tekkenMultiplayer && typeof window.tekkenMultiplayer.onEngineFrame === 'function') {
      window.tekkenMultiplayer.onEngineFrame(screen, mode, ramPtr, camYaw);
    }
  };

  // Exact scan codes expected by PSXRecomp's default keybinds (keybinds.ini)
  const P1_HOST_KEYS = {
    UP:     { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
    DOWN:   { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 },
    LEFT:   { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
    RIGHT:  { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },
    LP:     { code: 'KeyZ', key: 'z', keyCode: 90 },       // Left Punch (Square)
    RP:     { code: 'KeyA', key: 'a', keyCode: 65 },       // Right Punch (Triangle)
    LK:     { code: 'KeyX', key: 'x', keyCode: 88 },       // Left Kick (Cross)
    RK:     { code: 'KeyS', key: 's', keyCode: 83 },       // Right Kick (Circle)
    L1:     { code: 'KeyQ', key: 'q', keyCode: 81 },
    L2:     { code: 'KeyE', key: 'e', keyCode: 69 },
    R1:     { code: 'KeyW', key: 'w', keyCode: 87 },
    R2:     { code: 'KeyR', key: 'r', keyCode: 82 },
    START:  { code: 'Enter', key: 'Enter', keyCode: 13 },
    SELECT: { code: 'ShiftRight', key: 'Shift', keyCode: 16, location: 2 }
  };

  const P2_HOST_KEYS = {
    UP:     { code: 'KeyI', key: 'i', keyCode: 73 },
    DOWN:   { code: 'KeyK', key: 'k', keyCode: 75 },
    LEFT:   { code: 'KeyJ', key: 'j', keyCode: 74 },
    RIGHT:  { code: 'KeyL', key: 'l', keyCode: 76 },
    LP:     { code: 'Numpad4', key: '4', keyCode: 100, location: 3 },
    RP:     { code: 'Numpad5', key: '5', keyCode: 101, location: 3 },
    LK:     { code: 'Numpad1', key: '1', keyCode: 97, location: 3 },
    RK:     { code: 'Numpad2', key: '2', keyCode: 98, location: 3 },
    L1:     { code: 'KeyU', key: 'u', keyCode: 85 },
    L2:     { code: 'Numpad7', key: '7', keyCode: 103, location: 3 },
    R1:     { code: 'KeyO', key: 'o', keyCode: 79 },
    R2:     { code: 'Numpad9', key: '9', keyCode: 105, location: 3 },
    START:  { code: 'NumpadEnter', key: 'Enter', keyCode: 13, location: 3 },
    SELECT: { code: 'Backspace', key: 'Backspace', keyCode: 8 }
  };

  // Keyboard mapping for P1's physical keys
  const P1_PHYSICAL_KEYS = {
    'ArrowUp': 'UP',
    'ArrowDown': 'DOWN',
    'ArrowLeft': 'LEFT',
    'ArrowRight': 'RIGHT',
    'KeyZ': 'LP',
    'KeyA': 'RP',
    'KeyX': 'LK',
    'KeyS': 'RK',
    'KeyQ': 'L1',
    'KeyE': 'L2',
    'KeyW': 'R1',
    'KeyR': 'R2',
    'Enter': 'START',
    'ShiftRight': 'SELECT',
    'ShiftLeft': 'SELECT',
    'Backspace': 'SELECT'
  };

  // Keyboard mapping for P2's physical keys (allows P2 to use standard Arrows + Z/A/X/S or IJKL + Numpad)
  const P2_PHYSICAL_KEYS = {
    // Standard fighting layout (matches P1 keys so Guest can use standard keyboard layout)
    'ArrowUp': 'UP',
    'ArrowDown': 'DOWN',
    'ArrowLeft': 'LEFT',
    'ArrowRight': 'RIGHT',
    'KeyZ': 'LP',
    'KeyA': 'RP',
    'KeyX': 'LK',
    'KeyS': 'RK',
    'KeyQ': 'L1',
    'KeyE': 'L2',
    'KeyW': 'R1',
    'KeyR': 'R2',
    'Enter': 'START',
    'ShiftRight': 'SELECT',
    'ShiftLeft': 'SELECT',
    'Backspace': 'SELECT',

    // Alternate P2 Numpad / IJKL bindings (in case Guest prefers native P2 layout)
    'KeyI': 'UP',
    'KeyK': 'DOWN',
    'KeyJ': 'LEFT',
    'KeyL': 'RIGHT',
    'Numpad4': 'LP',
    'Numpad5': 'RP',
    'Numpad1': 'LK',
    'Numpad2': 'RK',
    'KeyU': 'L1',
    'KeyO': 'R1',
    'Numpad7': 'L2',
    'Numpad9': 'R2',
    'NumpadEnter': 'START'
  };

  // Standard Gamepad button map
  const GAMEPAD_BUTTON_MAP = {
    0: 'LK',     // Cross / A
    1: 'RK',     // Circle / B
    2: 'LP',     // Square / X
    3: 'RP',     // Triangle / Y
    4: 'L1',     // LB / L1
    5: 'R1',     // RB / R1
    6: 'L2',     // LT / L2
    7: 'R2',     // RT / R2
    8: 'SELECT', // Select / Back
    9: 'START',  // Start / Options
    12: 'UP',    // D-Pad Up
    13: 'DOWN',  // D-Pad Down
    14: 'LEFT',  // D-Pad Left
    15: 'RIGHT'  // D-Pad Right
  };

  // Robust WebRTC ICE Servers (STUN for direct LAN/P2P + Official OpenRelay for Symmetric NAT)
  function getEffectiveIceConfig() {
    const defaultIceServers = [
      // Direct LAN / WAN STUN reflexive candidate discovery
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun.cloudflare.com:3478',
          'stun:global.stun.stunprotocol.org:3478',
          'stun:openrelay.metered.ca:80'
        ]
      },

      // Official Metered Open Relay Project (Verified credentials: openrelayproject)
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];

    let customServers = [];
    try {
      if (Array.isArray(window.TEKKEN_CUSTOM_ICE_SERVERS)) {
        customServers = window.TEKKEN_CUSTOM_ICE_SERVERS;
      } else if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('tekken_ice_servers');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) customServers = parsed;
        }
      }
    } catch (e) {
      console.warn('[Netplay] Could not load custom ICE servers:', e);
    }

    return {
      iceServers: [...customServers, ...defaultIceServers],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 10,
      sdpSemantics: 'unified-plan'
    };
  }

  const ICE_CONFIG = getEffectiveIceConfig();

  async function logActiveIcePair(pc, role) {
    try {
      if (!pc || typeof pc.getStats !== 'function') return;
      const stats = await pc.getStats();
      let activePair = null;

      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          activePair = stats.get(report.selectedCandidatePairId);
        }
      });

      if (!activePair) {
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && (report.selected || report.nominated || report.state === 'succeeded')) {
            activePair = report;
          }
        });
      }

      if (activePair) {
        const local = stats.get(activePair.localCandidateId);
        const remote = stats.get(activePair.remoteCandidateId);
        const rtt = activePair.currentRoundTripTime !== undefined
          ? Math.round(activePair.currentRoundTripTime * 1000) + 'ms'
          : 'n/a';
        const linkType = (local?.candidateType === 'relay' || remote?.candidateType === 'relay')
          ? 'RELAY (TURN Fallback)'
          : (local?.candidateType === 'srflx' || remote?.candidateType === 'srflx')
            ? 'DIRECT WAN (STUN Reflexive)'
            : 'DIRECT LAN (Host)';

        console.log(`%c[Netplay ICE ${role}] Active Link: ${linkType} (RTT: ${rtt})`, 'color: #00ffff; font-weight: bold;');
        console.log(`[Netplay ICE ${role}] Local: [${local?.candidateType || '?'}] ${local?.protocol?.toUpperCase() || '?'} ${local?.ip || local?.address || '?'}:${local?.port || '?'} <===> Remote: [${remote?.candidateType || '?'}] ${remote?.protocol?.toUpperCase() || '?'} ${remote?.ip || remote?.address || '?'}:${remote?.port || '?'}`);
      }
    } catch (e) {
      // Diagnostic only
    }
  }

  function attachIceDiagnostics(conn, role) {
    if (!conn) return;

    const checkPc = () => {
      const pc = conn.peerConnection;
      if (!pc || pc.__iceDiagAttached) return;
      pc.__iceDiagAttached = true;

      pc.addEventListener('iceconnectionstatechange', () => {
        const state = pc.iceConnectionState;
        console.log(`[Netplay ICE ${role}] iceConnectionState: ${state}`);
        if (state === 'connected' || state === 'completed') {
          logActiveIcePair(pc, role);
        } else if (state === 'failed') {
          console.warn(`[Netplay ICE ${role}] ICE connection failed. Attempting ICE restart...`);
          if (typeof pc.restartIce === 'function') {
            try {
              pc.restartIce();
            } catch (e) {}
          }
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        console.log(`[Netplay ICE ${role}] connectionState: ${pc.connectionState}`);
      });

      pc.addEventListener('icecandidateerror', (evt) => {
        // Error 701: STUN binding failure; Error 401: Normal WebRTC TURN authentication challenge handshake
        if (evt && evt.url && evt.errorCode !== 701 && evt.errorCode !== 401) {
          console.warn(`[Netplay ICE ${role}] Relay notice on ${evt.url}: ${evt.errorText} (${evt.errorCode})`);
        }
      });
    };

    checkPc();
    setTimeout(checkPc, 100);
    setTimeout(checkPc, 500);
  }

  function injectDOMKey(action, keyDef) {
    if (!keyDef) return;
    const c1 = document.getElementById('canvas');
    const c2 = document.getElementById('displayCanvas');
    const evt = new KeyboardEvent(action, {
      code: keyDef.code,
      key: keyDef.key,
      keyCode: keyDef.keyCode,
      which: keyDef.keyCode,
      location: keyDef.location !== undefined ? keyDef.location : (keyDef.code.startsWith('Numpad') ? 3 : (keyDef.code.endsWith('Right') ? 2 : 0)),
      bubbles: true,
      cancelable: true
    });
    evt.__netplayInjected = true;
    if (c1) c1.dispatchEvent(evt);
    if (c2 && c2 !== c1) c2.dispatchEvent(evt);
    window.dispatchEvent(evt);
  }

  class TekkenMultiplayer {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.role = null; // 'host' | 'guest'
      this.roomId = null;
      this.ping = 0;
      this.pingInterval = null;
      this.gamepadPollInterval = null;
      this.prevGamepadState = {};
      this.connected = false;
      this.joinRetryTimer = null;
      this.joinRetryAttempts = 0;
      this.connWatchdog = null;

      // In-game Versus flow states
      this.vsPromptShown = false;
      this.versusActive = false;
      this.localInVsMode = false;
      this.peerInVsMode = false;
      this.screen = 0;
      this.mode = 0;

      // Deterministic Lockstep Synchronization & Clock Pacing
      this.inputDelay = 2; // Symmetric 2-frame delay buffer (~33ms at 60Hz)
      this.fightFrame = 0;
      this.peerFightFrame = 0;
      this.localStageReady = false;
      this.peerStageReady = false;
      this.fightActive = false;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      this.ramPtr = 0;
      this.camYaw = 0;
      this.lastHostCamYaw = undefined;
      this.lastHostCamPitch = undefined;

      // Continuous 60Hz Frame Input Sync & Live State Tracking
      this.heldButtons = new Set();
      this.remoteHeldButtons = new Set();
      this.guestFightAck = false;
      this.lastReadyPing = 0;
      this.syncCount = 0;
      this.cleanedUp = false;

      this.initDom();
      this.initHashListener();
    }

    initDom() {
      // Top HUD Elements
      this.multiplayerHud = document.getElementById('multiplayerHud');
      this.hudRole = document.getElementById('hudRole');
      this.hudModeStatus = document.getElementById('hudModeStatus');
      this.hudPing = document.getElementById('hudPing');
      this.hudRoom = document.getElementById('hudRoom');
      this.hudSync = document.getElementById('hudSync');
      this.btnDisconnect = document.getElementById('btnDisconnect');

      // Floating Room Notice Banner
      this.roomNotice = document.getElementById('roomNotice');
      this.roomNoticeText = document.getElementById('roomNoticeText');
      this.btnCancelNotice = document.getElementById('btnCancelNotice');

      // In-Game Versus Mode Prompt Elements
      this.vsModePrompt = document.getElementById('vsModePrompt');
      this.btnPromptClose = document.getElementById('btnPromptClose');
      this.btnPromptHost = document.getElementById('btnPromptHost');
      this.btnPromptJoin = document.getElementById('btnPromptJoin');
      this.btnPromptLocal = document.getElementById('btnPromptLocal');
      this.promptMainActions = document.getElementById('promptMainActions');

      this.promptHostBox = document.getElementById('promptHostBox');
      this.promptRoomCode = document.getElementById('promptRoomCode');
      this.btnPromptCopyLink = document.getElementById('btnPromptCopyLink');
      this.promptHostStatus = document.getElementById('promptHostStatus');
      this.btnPromptCancelHost = document.getElementById('btnPromptCancelHost');

      this.promptJoinBox = document.getElementById('promptJoinBox');
      this.promptJoinInput = document.getElementById('promptJoinInput');
      this.btnPromptConnect = document.getElementById('btnPromptConnect');
      this.promptJoinStatus = document.getElementById('promptJoinStatus');
      this.btnPromptCancelJoin = document.getElementById('btnPromptCancelJoin');

      if (this.btnDisconnect) this.btnDisconnect.addEventListener('click', () => this.disconnect());
      if (this.btnCancelNotice) this.btnCancelNotice.addEventListener('click', () => this.disconnect());

      // Bind In-Game Versus Mode Prompt actions
      if (this.btnPromptClose) this.btnPromptClose.addEventListener('click', () => this.hideVsPrompt());
      if (this.btnPromptLocal) this.btnPromptLocal.addEventListener('click', () => {
        this.cleanupNetwork();
        this.hideVsPrompt();
      });

      if (this.btnPromptHost) this.btnPromptHost.addEventListener('click', () => this.promptStartHost());
      if (this.btnPromptCancelHost) this.btnPromptCancelHost.addEventListener('click', () => {
        this.cleanupNetwork();
        this.promptResetViews();
      });
      if (this.btnPromptCopyLink) this.btnPromptCopyLink.addEventListener('click', () => this.copyRoomLink());

      if (this.btnPromptJoin) this.btnPromptJoin.addEventListener('click', () => this.promptStartJoin());
      if (this.btnPromptCancelJoin) this.btnPromptCancelJoin.addEventListener('click', () => {
        this.cleanupNetwork();
        this.promptResetViews();
      });
      if (this.btnPromptConnect) this.btnPromptConnect.addEventListener('click', () => {
        const val = this.promptJoinInput ? this.promptJoinInput.value.trim() : '';
        if (val) this.joinRoom(val);
      });

      // Prevent typing in room code inputs from triggering game keys behind modal
      const stopInputBubble = (e) => e.stopPropagation();
      ['keydown', 'keyup', 'keypress'].forEach(evtType => {
        if (this.promptJoinInput) this.promptJoinInput.addEventListener(evtType, stopInputBubble);
      });

      if (this.promptJoinInput) {
        this.promptJoinInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const val = this.promptJoinInput.value.trim();
            if (val) this.joinRoom(val);
          }
        });
      }

      // Suppress game keys while in-game VS prompt is active
      window.addEventListener('keydown', (e) => {
        if (this.vsModePrompt && (this.vsModePrompt.hasAttribute('open') || this.vsModePrompt.classList.contains('active'))) {
          if (e.key === 'Escape') {
            this.hideVsPrompt();
            return;
          }
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        }
      }, true);

      // Global keyboard listeners for input synchronization (Capture Phase to intercept before SDL)
      window.addEventListener('keydown', (e) => this.handleLocalKeyEvent(e), true);
      window.addEventListener('keyup', (e) => this.handleLocalKeyEvent(e), true);
      window.addEventListener('blur', () => this.releaseAllInjectedKeys());
    }

    initHashListener() {
      const hash = window.location.hash;
      if (hash && hash.includes('room=')) {
        const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          const roomCode = match[1].toUpperCase();
          if (this.promptJoinInput) {
            this.promptJoinInput.value = roomCode;
          }
          this.showRoomNotice(`LINKED TO ROOM ${roomCode}: Please start game & select "VS MODE" to fight!`);
          this.joinRoom(roomCode);
        }
      }
    }

    /* =========================================================================
       ENGINE FRAME HOOK (SCREEN & MODE STATE MACHINE)
       ========================================================================= */

    onEngineFrame(screen, mode, ramPtr, camYaw) {
      const s = screen & 0xffff;
      const m = mode & 0xff;
      this.screen = s;
      this.mode = m;
      if (ramPtr !== undefined && ramPtr !== null) this.ramPtr = ramPtr;
      if (camYaw !== undefined && camYaw !== null) this.camYaw = camYaw;

      // In Tekken 3:
      // Mode 1 (0x800afa88 == 1) is VS MODE.
      // Screen 4 is Main Menu, Screen 0 is Boot/Intro.
      // Screen 9 = Character Select, 10 = Team Select, 11 = Loading stage, 8 = In-Fight.
      const isVsMode = (m === 1 && s !== 4 && s !== 0);

      if (isVsMode) {
        this.localInVsMode = true;

        if (this.connected && this.conn && this.conn.open) {
          // Inform peer that local engine is sitting in VS Mode
          if (!this.sentInVsPacket) {
            this.sentInVsPacket = true;
            this.conn.send({ type: 'in_vs_mode' });
          }

          if (this.peerInVsMode) {
            // BOTH PLAYERS ARE IN VS MODE
            if (!this.versusActive) {
              this.versusActive = true;
              this.hideVsPrompt();
              this.hideRoomNotice();
              console.log('[Netplay] Both players in VS Mode! Netplay session engaged.');
            }

            if (s === 9 || s === 10) {
              // Character Select: reset combat states if returning from battle/rematch
              if (this.fightActive || this.localStageReady || this.peerStageReady) {
                this.resetFightState();
              }
              this.updateHudStatus('SELECT FIGHTER', true);
            } else if (s === 11) {
              // Stage Loading: hold inputs and reset local ready flag.
              // CRITICAL: NEVER reset this.peerStageReady here! If peer is already ready, keep it!
              if (this.fightActive || this.localStageReady) {
                this.fightActive = false;
                this.localStageReady = false;
                this.fightFrame = 0;
                this.peerFightFrame = 0;
                this.localInputQueue = [];
                this.remoteInputQueue = [];
                if (this.heldButtons) this.heldButtons.clear();
                if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
                this.releaseAllInjectedKeys();
                this.updateSyncBadge(false);
              }
              this.updateHudStatus('LOADING STAGE...', true);
            } else if (s === 8) {
              // Battle Screen: Stage Ready Barrier
              this.localStageReady = true;

              if (!this.fightActive) {
                // Heartbeat ready signal every 150ms until fight starts
                const now = Date.now();
                if (!this.lastReadyPing || (now - this.lastReadyPing > 150)) {
                  this.lastReadyPing = now;
                  this.conn.send({ type: 'stage_ready', screen: 8, role: this.role });
                }

                if (!this.peerStageReady) {
                  this.updateHudStatus('WAITING FOR PEER TO LOAD...', true);
                  return; // Hold neutral until peer finishes loading
                }

                if (this.role === 'host') {
                  let initCam = this.camYaw || 0;
                  let initPitch = 0;
                  let initRngSeed = 0x12345678;
                  const buf = getWasmBuffer();
                  if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
                    try {
                      const dv = new DataView(buf, this.ramPtr, 0x200000);
                      const ramYaw = dv.getInt32(CAM_YAW_OFFSET, true);
                      if (ramYaw !== 0) initCam = ramYaw;
                      initPitch = dv.getInt32(CAM_PITCH_OFFSET, true);
                      initRngSeed = dv.getUint32(PSX_RNG_SEED_OFFSET, true);
                    } catch (e) {}
                  }
                  this.conn.send({ type: 'start_fight', startFrame: 0, cam: initCam, pitch: initPitch, rngSeed: initRngSeed });
                  this.startFight();
                  return;
                } else {
                  this.updateHudStatus('READY... AWAITING HOST', true);
                  return;
                }
              }

              // Fight active: step logical frame and apply queued inputs every single frame
              this.fightFrame++;
              this.processInputQueues();

              // Continuous 60Hz per-frame held input state and camera sync transmission
              if (this.heldButtons) {
                let hostCamYaw = this.camYaw || 0;
                let hostCamPitch = 0;
                if (this.role === 'host') {
                  const buf = getWasmBuffer();
                  if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
                    try {
                      const dv = new DataView(buf, this.ramPtr, 0x200000);
                      const ramYaw = dv.getInt32(CAM_YAW_OFFSET, true);
                      if (ramYaw !== 0) hostCamYaw = ramYaw;
                      hostCamPitch = dv.getInt32(CAM_PITCH_OFFSET, true);
                    } catch (e) {}
                  }
                }
                const inputPacket = {
                  type: 'frame_input',
                  f: this.fightFrame,
                  player: (this.role === 'host' ? 1 : 2),
                  btns: Array.from(this.heldButtons)
                };
                if (this.role === 'host') {
                  inputPacket.cam = hostCamYaw;
                  inputPacket.pitch = hostCamPitch;
                }
                this.conn.send(inputPacket);
              }

              // Guest: clamp local PSX RAM camera to Host authoritative yaw on every engine frame
              if (this.role === 'guest' && this.lastHostCamYaw !== undefined) {
                const buf = getWasmBuffer();
                if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
                  try {
                    const dv = new DataView(buf, this.ramPtr, 0x200000);
                    dv.setInt32(CAM_YAW_OFFSET, this.lastHostCamYaw, true);
                    dv.setInt32(CAM_DELTA_OFFSET, 0, true);
                    if (this.lastHostCamPitch !== undefined) {
                      dv.setInt32(CAM_PITCH_OFFSET, this.lastHostCamPitch, true);
                    }
                  } catch (e) {}
                }
              }

              // Host repeats start_fight heartbeat every 15 frames until Guest ACKs
              if (this.role === 'host' && !this.guestFightAck && (this.fightFrame <= 10 || this.fightFrame % 15 === 0)) {
                let initCam = this.camYaw || 0;
                let initPitch = 0;
                let initRngSeed = 0x12345678;
                const buf = getWasmBuffer();
                if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
                  try {
                    const dv = new DataView(buf, this.ramPtr, 0x200000);
                    const ramYaw = dv.getInt32(CAM_YAW_OFFSET, true);
                    if (ramYaw !== 0) initCam = ramYaw;
                    initPitch = dv.getInt32(CAM_PITCH_OFFSET, true);
                    initRngSeed = dv.getUint32(PSX_RNG_SEED_OFFSET, true);
                  } catch (e) {}
                }
                this.conn.send({ type: 'start_fight', startFrame: 0, cam: initCam, pitch: initPitch, rngSeed: initRngSeed });
              }

              // Periodic clock tick heartbeat every 15 frames (~250ms)
              if (this.fightFrame % 15 === 0) {
                this.conn.send({ type: 'clock_tick', f: this.fightFrame });
              }

              // Authoritative Host Combat State Sync:
              // Runs on frame 1 (instant round entry anchor), frame 5, frame 10 (early round lock),
              // and every 15 frames (~250ms) during the entire match.
              if (this.role === 'host' && (this.fightFrame === 1 || this.fightFrame === 5 || this.fightFrame === 10 || this.fightFrame % 15 === 0) && this.fightFrame > 0) {
                this.sendCombatSync();
              }

              // If local engine lagged behind peer by > 3 frames, step extra catch-up cycle
              if (this.peerFightFrame > 0 && (this.fightFrame - this.peerFightFrame < -3)) {
                this.fightFrame++;
                this.processInputQueues();
              }
            } else if (s === 13) {
              // Match Results / Rematch / Continue
              if (this.fightActive) {
                this.resetFightState();
                this.updateHudStatus('MATCH FINISHED', true);
              }
            }
          } else {
            // Waiting for peer to enter VS Mode
            this.updatePromptStatus('WAITING FOR PEER TO ENTER VS MODE...');
            this.showRoomNotice('PEER CONNECTED // SELECT "VS MODE" IN MENU');
          }
        } else {
          // Local player entered VS Mode, but not yet connected to any online room
          if (!this.vsPromptShown) {
            this.vsPromptShown = true;
            this.showVsPrompt();
          }
        }
      } else {
        // Outside of VS Mode (e.g. Main Menu screen 4, Arcade mode 0, Options screen 6)
        if (this.localInVsMode && this.connected && this.conn && this.conn.open) {
          this.conn.send({ type: 'left_vs_mode' });
        }
        if (this.localInVsMode) {
          this.releaseAllInjectedKeys();
        }
        this.localInVsMode = false;
        this.versusActive = false;
        this.sentInVsPacket = false;
        this.resetFightState();

        // When returning to main menu (screen 4), reset prompt flag so next VS entry triggers prompt
        if (s === 4) {
          this.vsPromptShown = false;
        }
      }
    }

    startFight() {
      this.fightActive = true;
      this.fightFrame = 0;
      this.peerFightFrame = 0;
      this.syncCount = 0;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      if (this.heldButtons) this.heldButtons.clear();
      if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
      this.releaseAllInjectedKeys();
      this.updateHudStatus('ROUND 1 - FIGHT!', true);
      this.updateSyncBadge(true, true);
      console.log(`[Netplay] Synchronized fight started! Role: ${this.role}, Delay: ${this.inputDelay} frames`);
    }

    resetFightState() {
      this.fightActive = false;
      this.localStageReady = false;
      this.peerStageReady = false;
      this.guestFightAck = false;
      this.lastReadyPing = 0;
      this.fightFrame = 0;
      this.peerFightFrame = 0;
      this.syncCount = 0;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      if (this.heldButtons) this.heldButtons.clear();
      if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
      this.releaseAllInjectedKeys();
      this.lastHostCamYaw = undefined;
      this.lastHostCamPitch = undefined;
      this.updateSyncBadge(false);
    }

    updateSyncBadge(active = true, flash = false) {
      if (!this.hudSync) return;
      if (!active) {
        this.hudSync.style.display = 'none';
        return;
      }
      this.hudSync.style.display = 'inline-flex';
      const countText = this.syncCount > 0 ? ` #${this.syncCount}` : '';
      this.hudSync.textContent = `● SYNC: 60Hz${countText}`;
      if (flash) {
        this.hudSync.classList.add('flash');
        setTimeout(() => {
          if (this.hudSync) this.hudSync.classList.remove('flash');
        }, 300);
      }
    }

    processInputQueues() {
      // 1. Process local input queue
      if (this.localInputQueue.length > 0) {
        const readyLocal = [];
        const remainingLocal = [];
        for (let i = 0; i < this.localInputQueue.length; i++) {
          const item = this.localInputQueue[i];
          if (item.targetFrame <= this.fightFrame) {
            readyLocal.push(item);
          } else {
            remainingLocal.push(item);
          }
        }
        this.localInputQueue = remainingLocal;
        for (let i = 0; i < readyLocal.length; i++) {
          const item = readyLocal[i];
          const keys = (item.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
          if (keys[item.btn]) injectDOMKey(item.action, keys[item.btn]);
        }
      }

      // 2. Process remote input queue
      if (this.remoteInputQueue.length > 0) {
        const readyRemote = [];
        const remainingRemote = [];
        for (let i = 0; i < this.remoteInputQueue.length; i++) {
          const item = this.remoteInputQueue[i];
          if (item.targetFrame <= this.fightFrame) {
            readyRemote.push(item);
          } else {
            remainingRemote.push(item);
          }
        }
        this.remoteInputQueue = remainingRemote;
        for (let i = 0; i < readyRemote.length; i++) {
          const item = readyRemote[i];
          const keys = (item.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
          if (keys[item.btn]) injectDOMKey(item.action, keys[item.btn]);
        }
      }
    }

    sendCombatSync() {
      if (!this.connected || !this.conn || !this.conn.open) return;
      const buf = getWasmBuffer();
      if (!buf || this.ramPtr === undefined || this.ramPtr === null || this.ramPtr < 0) return;

      try {
        const dv = new DataView(buf, this.ramPtr, 0x200000);
        // P1 state: [x, y, z, facing, side, yaw, relYaw, camAngle, hp]
        const p1 = [
          dv.getInt32(P1_ACTOR_OFFSET + 0x00, true),
          dv.getInt32(P1_ACTOR_OFFSET + 0x04, true),
          dv.getInt32(P1_ACTOR_OFFSET + 0x08, true),
          dv.getUint16(P1_ACTOR_OFFSET + 0x0e, true),
          dv.getUint16(P1_ACTOR_OFFSET + 0x12, true),
          dv.getUint16(P1_ACTOR_OFFSET + 0x2c, true),
          dv.getInt16(P1_ACTOR_OFFSET + 0x2e, true),
          dv.getInt16(P1_ACTOR_OFFSET + 0x30, true),
          dv.getInt32(P1_ACTOR_OFFSET + 0x3f4, true)
        ];

        // P2 state: [x, y, z, facing, side, yaw, relYaw, camAngle, hp]
        const p2 = [
          dv.getInt32(P2_ACTOR_OFFSET + 0x00, true),
          dv.getInt32(P2_ACTOR_OFFSET + 0x04, true),
          dv.getInt32(P2_ACTOR_OFFSET + 0x08, true),
          dv.getUint16(P2_ACTOR_OFFSET + 0x0e, true),
          dv.getUint16(P2_ACTOR_OFFSET + 0x12, true),
          dv.getUint16(P2_ACTOR_OFFSET + 0x2c, true),
          dv.getInt16(P2_ACTOR_OFFSET + 0x2e, true),
          dv.getInt16(P2_ACTOR_OFFSET + 0x30, true),
          dv.getInt32(P2_ACTOR_OFFSET + 0x3f4, true)
        ];

        const timer = dv.getUint32(MATCH_TIMER_OFFSET, true);
        const rngSeed = dv.getUint32(PSX_RNG_SEED_OFFSET, true);
        const camYawVal = (this.camYaw !== undefined && this.camYaw !== null && this.camYaw !== 0)
          ? this.camYaw
          : dv.getInt32(CAM_YAW_OFFSET, true);
        const cam = {
          yaw: camYawVal,
          pitch: dv.getInt32(CAM_PITCH_OFFSET, true),
          delta: dv.getInt32(CAM_DELTA_OFFSET, true),
          timer: dv.getInt32(CAM_TIMER_OFFSET, true),
          ctrlAngle: dv.getInt16(CAM_CTRL_ANGLE_OFFSET, true),
          ctrlTarget: dv.getInt16(CAM_CTRL_TARGET_OFFSET, true),
          ctrlTrack: dv.getInt32(CAM_CTRL_TRACK_OFFSET, true),
          mode: dv.getUint16(CAM_MODE_OFFSET, true),
          c36: dv.getInt32(CAM_0_STRUCT_OFFSET + 36, true),
          c40: dv.getInt32(CAM_0_STRUCT_OFFSET + 40, true),
          c44: dv.getInt32(CAM_0_STRUCT_OFFSET + 44, true)
        };

        this.conn.send({
          type: 'combat_sync',
          f: this.fightFrame,
          p1,
          p2,
          timer,
          cam,
          rngSeed
        });

        this.syncCount = (this.syncCount || 0) + 1;
        this.updateSyncBadge(true, true);
        if (this.syncCount % 12 === 0 || this.fightFrame === 1) {
          console.log(`[Netplay Sync] Frame ${this.fightFrame}: Sent state sync #${this.syncCount} (P1 HP: ${p1[8]}, P2 HP: ${p2[8]}, Cam Yaw: ${cam.yaw}, RNG: 0x${rngSeed.toString(16)})`);
        }
      } catch (err) {
        console.warn('[Netplay] Error reading combat sync from RAM:', err);
      }
    }

    applyCombatSync(data) {
      if (this.role !== 'guest') return;
      if (this.screen !== 8) return;
      if (!data || !Array.isArray(data.p1) || !Array.isArray(data.p2)) return;

      // Fail-safe: if Guest was awaiting host and receives combat_sync, immediately engage fight
      if (!this.fightActive) {
        console.log('[Netplay Guest] Incoming combat_sync unlocked fightActive barrier!');
        this.startFight();
        if (data.f !== undefined && data.f > 0) {
          this.fightFrame = data.f;
        }
        if (this.conn && this.conn.open) {
          this.conn.send({ type: 'fight_ack' });
        }
      }

      const buf = getWasmBuffer();
      if (!buf || this.ramPtr === undefined || this.ramPtr === null || this.ramPtr < 0) return;

      try {
        const dv = new DataView(buf, this.ramPtr, 0x200000);

        // Synchronize P1 state
        dv.setInt32(P1_ACTOR_OFFSET + 0x00, data.p1[0], true);
        dv.setInt32(P1_ACTOR_OFFSET + 0x04, data.p1[1], true);
        dv.setInt32(P1_ACTOR_OFFSET + 0x08, data.p1[2], true);
        dv.setUint16(P1_ACTOR_OFFSET + 0x0e, data.p1[3], true);
        dv.setUint16(P1_ACTOR_OFFSET + 0x12, data.p1[4], true);
        dv.setUint16(P1_ACTOR_OFFSET + 0x2c, data.p1[5], true);
        dv.setInt16(P1_ACTOR_OFFSET + 0x2e, data.p1[6], true);
        dv.setInt16(P1_ACTOR_OFFSET + 0x30, data.p1[7], true);
        dv.setInt32(P1_ACTOR_OFFSET + 0x3f4, data.p1[8], true);

        // Synchronize P2 state
        dv.setInt32(P2_ACTOR_OFFSET + 0x00, data.p2[0], true);
        dv.setInt32(P2_ACTOR_OFFSET + 0x04, data.p2[1], true);
        dv.setInt32(P2_ACTOR_OFFSET + 0x08, data.p2[2], true);
        dv.setUint16(P2_ACTOR_OFFSET + 0x0e, data.p2[3], true);
        dv.setUint16(P2_ACTOR_OFFSET + 0x12, data.p2[4], true);
        dv.setUint16(P2_ACTOR_OFFSET + 0x2c, data.p2[5], true);
        dv.setInt16(P2_ACTOR_OFFSET + 0x2e, data.p2[6], true);
        dv.setInt16(P2_ACTOR_OFFSET + 0x30, data.p2[7], true);
        dv.setInt32(P2_ACTOR_OFFSET + 0x3f4, data.p2[8], true);

        // Synchronize countdown timer
        if (data.timer !== undefined) {
          dv.setUint32(MATCH_TIMER_OFFSET, data.timer, true);
        }

        // Synchronize 3D combat camera (yaw, pitch, tracking, target, timer)
        if (data.cam !== undefined && data.cam !== null) {
          if (typeof data.cam === 'object') {
            if (data.cam.yaw !== undefined) {
              dv.setInt32(CAM_YAW_OFFSET, data.cam.yaw, true);
              this.lastHostCamYaw = data.cam.yaw;
            }
            if (data.cam.pitch !== undefined) {
              dv.setInt32(CAM_PITCH_OFFSET, data.cam.pitch, true);
              this.lastHostCamPitch = data.cam.pitch;
            }
            // Lock rotational delta to 0 on Guest so Guest camera cannot rotate away from Host
            dv.setInt32(CAM_DELTA_OFFSET, 0, true);
            if (data.cam.timer !== undefined) dv.setInt32(CAM_TIMER_OFFSET, data.cam.timer, true);
            if (data.cam.ctrlAngle !== undefined) dv.setInt16(CAM_CTRL_ANGLE_OFFSET, data.cam.ctrlAngle, true);
            if (data.cam.ctrlTarget !== undefined) dv.setInt16(CAM_CTRL_TARGET_OFFSET, data.cam.ctrlTarget, true);
            if (data.cam.ctrlTrack !== undefined) dv.setInt32(CAM_CTRL_TRACK_OFFSET, data.cam.ctrlTrack, true);
            if (data.cam.mode !== undefined) dv.setUint16(CAM_MODE_OFFSET, data.cam.mode, true);
            if (data.cam.c36 !== undefined) dv.setInt32(CAM_0_STRUCT_OFFSET + 36, data.cam.c36, true);
            if (data.cam.c40 !== undefined) dv.setInt32(CAM_0_STRUCT_OFFSET + 40, data.cam.c40, true);
            if (data.cam.c44 !== undefined) dv.setInt32(CAM_0_STRUCT_OFFSET + 44, data.cam.c44, true);
          } else if (typeof data.cam === 'number') {
            dv.setInt32(CAM_YAW_OFFSET, data.cam, true);
            dv.setInt32(CAM_DELTA_OFFSET, 0, true);
            this.lastHostCamYaw = data.cam;
          }
        }

        // Synchronize round-start / combat PRNG state seed
        if (data.rngSeed !== undefined) {
          dv.setUint32(PSX_RNG_SEED_OFFSET, data.rngSeed, true);
        }

        // Align peer fight frame
        if (data.f !== undefined) {
          this.peerFightFrame = data.f;
          if (Math.abs(this.fightFrame - data.f) > 3) {
            this.fightFrame = data.f;
          }
        }

        this.syncCount = (this.syncCount || 0) + 1;
        this.updateSyncBadge(true, true);
        if (this.syncCount % 12 === 0 || (data.f && data.f <= 10)) {
          console.log(`[Netplay Sync] Frame ${this.fightFrame}: Applied state sync #${this.syncCount} (P1 HP: ${data.p1[8]}, P2 HP: ${data.p2[8]}, Cam: ${data.cam && data.cam.yaw !== undefined ? data.cam.yaw : data.cam})`);
        }
      } catch (err) {
        console.warn('[Netplay] Error applying combat sync to RAM:', err);
      }
    }

    /* =========================================================================
       VERSUS PROMPT & NOTICE UI
       ========================================================================= */

    showVsPrompt() {
      if (this.vsModePrompt) {
        this.promptResetViews();
        this.vsModePrompt.classList.add('active');
        if (typeof this.vsModePrompt.showModal === 'function') {
          try {
            if (!this.vsModePrompt.open) {
              this.vsModePrompt.showModal();
            }
          } catch (e) {}
        }
      }
    }

    hideVsPrompt() {
      if (this.vsModePrompt) {
        this.vsModePrompt.classList.remove('active');
        if (typeof this.vsModePrompt.close === 'function') {
          try {
            if (this.vsModePrompt.open) {
              this.vsModePrompt.close();
            }
          } catch (e) {}
        }
      }
    }

    promptResetViews() {
      if (this.promptMainActions) this.promptMainActions.style.display = 'flex';
      if (this.promptHostBox) this.promptHostBox.style.display = 'none';
      if (this.promptJoinBox) this.promptJoinBox.style.display = 'none';
    }

    promptStartHost() {
      if (this.promptMainActions) this.promptMainActions.style.display = 'none';
      if (this.promptHostBox) this.promptHostBox.style.display = 'flex';
      this.createRoom(true);
    }

    promptStartJoin() {
      if (this.promptMainActions) this.promptMainActions.style.display = 'none';
      if (this.promptJoinBox) this.promptJoinBox.style.display = 'flex';
      if (this.promptJoinInput) this.promptJoinInput.focus();
    }

    updatePromptStatus(msg) {
      if (this.promptHostStatus) this.promptHostStatus.textContent = msg;
      if (this.promptJoinStatus) this.promptJoinStatus.textContent = msg;
    }

    showRoomNotice(text) {
      if (this.roomNotice) {
        this.roomNotice.style.display = 'flex';
        if (this.roomNoticeText) this.roomNoticeText.textContent = text;
      }
    }

    hideRoomNotice() {
      if (this.roomNotice) {
        this.roomNotice.style.display = 'none';
      }
    }

    /* =========================================================================
       NETWORKING & PEER CONNECTION
       ========================================================================= */

    generateCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = 'TK3-';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }

    normalizePeerId(code) {
      return 'tekken3-netplay-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    getPeerOptions() {
      const isLocal = (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.') ||
        window.location.hostname.startsWith('10.') ||
        window.location.port === '3000'
      );

      const baseOpts = {
        debug: 1,
        config: getEffectiveIceConfig(),
        pingInterval: 5000
      };

      if (isLocal) {
        return {
          ...baseOpts,
          host: window.location.hostname,
          port: parseInt(window.location.port || (window.location.protocol === 'https:' ? 443 : 80), 10),
          path: '/peerjs',
          secure: window.location.protocol === 'https:'
        };
      }

      // Allow custom signaling server via window.TEKKEN_SIGNALING_SERVER, localStorage('tekken_signaling_server'), or ?server=...
      let customServer = null;
      try {
        if (typeof window.TEKKEN_SIGNALING_SERVER === 'object' && window.TEKKEN_SIGNALING_SERVER.host) {
          customServer = window.TEKKEN_SIGNALING_SERVER;
        } else if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem('tekken_signaling_server');
          if (stored) {
            customServer = JSON.parse(stored);
          }
        }
        if (!customServer && typeof window.location !== 'undefined' && window.location.search) {
          const params = new URLSearchParams(window.location.search);
          const sParam = params.get('server');
          if (sParam) {
            customServer = {
              host: sParam,
              port: 443,
              secure: true,
              path: '/'
            };
          }
        }
      } catch (e) {}

      if (customServer && customServer.host) {
        return {
          ...baseOpts,
          host: customServer.host,
          port: customServer.port || 443,
          path: customServer.path || '/',
          secure: customServer.secure !== undefined ? customServer.secure : true
        };
      }

      return baseOpts;
    }

    createRoom(fromPrompt = false) {
      this.cleanupNetwork();
      if (typeof window.ensureAudioKeepAlive === 'function') window.ensureAudioKeepAlive();

      const code = this.generateCode();
      const peerId = this.normalizePeerId(code);
      this.role = 'host';
      this.roomId = code;
      this.cleanedUp = false;

      this.updatePromptStatus('CONNECTING TO SIGNALING LOBBY...');

      const opts = this.getPeerOptions();
      this.peer = new Peer(peerId, opts);

      this.peer.on('open', (id) => {
        console.log(`[Netplay Host] Lobby registered with ID: ${id}`);
        const waitingMsg = 'WAITING FOR CHALLENGER...';
        this.updatePromptStatus(waitingMsg);
        if (this.promptRoomCode) this.promptRoomCode.textContent = code;
        this.showRoomNotice(`ROOM ${code} READY // INVITE A FRIEND`);
      });

      this.peer.on('disconnected', () => {
        if (!this.cleanedUp && this.peer && !this.peer.destroyed) {
          console.warn('[Netplay Host] Signaling socket disconnected, auto-reconnecting...');
          this.peer.reconnect();
        }
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Host Error]', err);
        if (err.type === 'unavailable-id') {
          setTimeout(() => this.createRoom(fromPrompt), 400);
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
          this.updatePromptStatus(`SIGNALING NOTICE: ${err.message || err.type}. Reconnecting...`);
          setTimeout(() => {
            if (!this.connected && !this.cleanedUp) {
              if (this.peer && !this.peer.destroyed) this.peer.reconnect();
            }
          }, 1500);
        } else {
          this.updatePromptStatus(`LOBBY NOTICE: ${err.type || err.message}`);
        }
      });

      this.peer.on('connection', (conn) => {
        console.log('[Netplay Host] Incoming peer connection received!');
        if (this.conn) {
          try { this.conn.close(); } catch (e) {}
        }
        this.conn = conn;
        attachIceDiagnostics(this.conn, 'HOST');
        this.setupHostConnection();
      });
    }

    setupHostConnection() {
      if (!this.conn) return;
      attachIceDiagnostics(this.conn, 'HOST');

      this.conn.on('open', () => {
        console.log('[Netplay Host] Player 2 linked!');
        this.connected = true;
        this.guestFightAck = false;
        if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
        this.updateHud('HOST (P1)', this.roomId);
        this.updatePromptStatus('CHALLENGER LINKED // ENTERING BATTLE...');

        this.startPingLoop();
        this.startGamepadLoop();

        // Inform guest of host's VS Mode state
        if (this.localInVsMode) {
          this.conn.send({ type: 'in_vs_mode' });
        }
      });

      this.conn.on('error', (err) => {
        console.warn('[Netplay Host Conn Error]', err);
        this.updatePromptStatus(`CONNECTION NOTICE: ${err.message || err.type || 'P2 link dropped'}`);
      });

      this.conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'ping') {
          this.conn.send({ type: 'pong', t: data.t });
        } else if (data.type === 'clock_tick') {
          if (data.f !== undefined) {
            this.peerFightFrame = data.f;
          }
        } else if (data.type === 'combat_sync') {
          // Host is authoritative; no-op
        } else if (data.type === 'in_vs_mode') {
          this.peerInVsMode = true;
          if (this.localInVsMode) {
            this.versusActive = true;
            this.hideVsPrompt();
            this.hideRoomNotice();
            this.updateHudStatus('SELECT FIGHTER', true);
          }
        } else if (data.type === 'left_vs_mode') {
          this.peerInVsMode = false;
          this.versusActive = false;
          this.sentInVsPacket = false;
          this.resetFightState();
          this.updateHudStatus('PEER EXITED TO MENU', false);
          this.showRoomNotice('Player 2 left Versus Mode back to Main Menu.');
        } else if (data.type === 'stage_ready') {
          this.peerStageReady = true;
          if (this.localStageReady && !this.fightActive) {
            this.conn.send({ type: 'start_fight', startFrame: 0 });
            this.startFight();
          }
        } else if (data.type === 'fight_ack') {
          this.guestFightAck = true;
        } else if (data.type === 'frame_input') {
          if (this.fightActive && Array.isArray(data.btns)) {
            const remoteKeys = P2_HOST_KEYS;
            const incoming = new Set(data.btns);

            // Release any button no longer held
            for (const b of this.remoteHeldButtons) {
              if (!incoming.has(b)) {
                this.remoteHeldButtons.delete(b);
                if (remoteKeys[b]) injectDOMKey('keyup', remoteKeys[b]);
              }
            }
            // Press any new button
            for (const b of incoming) {
              if (!this.remoteHeldButtons.has(b)) {
                this.remoteHeldButtons.add(b);
                if (remoteKeys[b]) injectDOMKey('keydown', remoteKeys[b]);
              }
            }
          }
        } else if (data.type === 'fight_input') {
          if (data.btn && (data.player === 1 || data.player === 2)) {
            if (this.fightActive) {
              this.remoteInputQueue.push({
                targetFrame: data.targetFrame !== undefined ? data.targetFrame : (this.fightFrame + 1),
                player: data.player,
                action: data.action,
                btn: data.btn
              });
            } else {
              const keys = (data.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
              if (keys[data.btn]) injectDOMKey(data.action, keys[data.btn]);
            }
          }
        } else if (data.type === 'input' || data.type === 'menu_input') {
          if (this.versusActive && data.btn) {
            const keys = (data.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
            if (keys[data.btn]) injectDOMKey(data.action, keys[data.btn]);
          }
        }
      });

      this.conn.on('close', () => {
        console.log('[Netplay Host] Player 2 disconnected');
        this.connected = false;
        this.versusActive = false;
        this.peerInVsMode = false;
        this.updateHud('HOST (P1)', this.roomId);
        this.updateHudStatus('DISCONNECTED', false);
        this.showRoomNotice('PLAYER 2 DISCONNECTED');
      });
    }

    joinRoom(rawCode) {
      this.cleanupNetwork();
      if (typeof window.ensureAudioKeepAlive === 'function') window.ensureAudioKeepAlive();

      let code = rawCode.trim();
      if (code.includes('room=')) {
        const m = code.match(/room=([a-zA-Z0-9_-]+)/);
        if (m) code = m[1];
      }

      const hostPeerId = this.normalizePeerId(code);
      this.role = 'guest';
      this.roomId = code.toUpperCase();
      this.joinRetryAttempts = 0;
      this.cleanedUp = false;

      if (this.promptJoinInput) {
        this.promptJoinInput.value = this.roomId;
      }

      this.updatePromptStatus('CONNECTING TO SIGNALING LOBBY...');

      const opts = this.getPeerOptions();
      const guestPeerId = 'tekken3-guest-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
      this.peer = new Peer(guestPeerId, opts);

      this.peer.on('open', (id) => {
        console.log(`[Netplay Guest] Registered in lobby with ID: ${id}`);
        this.attemptGuestConnect(hostPeerId);
      });

      this.peer.on('disconnected', () => {
        if (!this.cleanedUp && this.peer && !this.peer.destroyed) {
          console.warn('[Netplay Guest] Signaling socket disconnected, auto-reconnecting...');
          this.peer.reconnect();
        }
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Guest Peer Error]', err);
        if (err.type === 'peer-unavailable') {
          this.retryGuestConnect(hostPeerId);
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
          this.updatePromptStatus(`SIGNALING NOTICE: ${err.message || err.type}. Reconnecting...`);
          setTimeout(() => {
            if (!this.connected && !this.cleanedUp) {
              if (this.peer && !this.peer.destroyed) this.peer.reconnect();
            }
          }, 1500);
        } else {
          this.updatePromptStatus(`FAILED TO CONNECT: ${err.type || err.message}`);
        }
      });
    }

    attemptGuestConnect(hostPeerId) {
      if (!this.peer || this.peer.destroyed || this.connected) return;
      this.updatePromptStatus(`LINKING WITH HOST (${this.roomId})...`);

      if (this.connWatchdog) clearTimeout(this.connWatchdog);
      this.connWatchdog = setTimeout(() => {
        if (!this.connected) {
          console.warn('[Netplay Guest] Connection attempt timed out waiting for link, retrying...');
          this.retryGuestConnect(hostPeerId);
        }
      }, 8000);

      try {
        if (this.conn) {
          try { this.conn.close(); } catch (e) {}
        }
        this.conn = this.peer.connect(hostPeerId, {
          reliable: true, // In-order, lossless SCTP delivery prevents dropped or swapped keyups
          config: getEffectiveIceConfig()
        });
        attachIceDiagnostics(this.conn, 'GUEST');
        this.setupGuestConnection(hostPeerId);
      } catch (err) {
        console.warn('[Netplay connect error]', err);
        this.retryGuestConnect(hostPeerId);
      }
    }

    retryGuestConnect(hostPeerId) {
      if (this.connected) return;
      if (this.connWatchdog) {
        clearTimeout(this.connWatchdog);
        this.connWatchdog = null;
      }
      if (this.joinRetryAttempts < 8) {
        this.joinRetryAttempts++;
        this.updatePromptStatus(`WAITING FOR HOST ROOM TO BE READY... (${this.joinRetryAttempts}/8)`);
        if (this.joinRetryTimer) clearTimeout(this.joinRetryTimer);
        this.joinRetryTimer = setTimeout(() => {
          this.attemptGuestConnect(hostPeerId);
        }, 1500);
      } else {
        this.updatePromptStatus(`HOST ROOM NOT FOUND (${this.roomId}). VERIFY CODE AND TRY AGAIN.`);
      }
    }

    setupGuestConnection(hostPeerId) {
      if (!this.conn) return;
      attachIceDiagnostics(this.conn, 'GUEST');

      this.conn.on('open', () => {
        console.log('[Netplay Guest] Connected to Host!');
        if (this.connWatchdog) {
          clearTimeout(this.connWatchdog);
          this.connWatchdog = null;
        }
        if (this.joinRetryTimer) {
          clearTimeout(this.joinRetryTimer);
          this.joinRetryTimer = null;
        }
        this.connected = true;
        if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
        this.updateHud('CHALLENGER (P2)', this.roomId);
        this.updatePromptStatus('CONNECTED TO HOST // ENTERING BATTLE...');

        // Close prompt modal if open
        if (this.promptModal && this.promptModal.open) {
          setTimeout(() => {
            if (this.promptModal && this.promptModal.open) this.promptModal.close();
          }, 800);
        }

        this.startPingLoop();
        this.startGamepadLoop();

        // Inform host if guest is already in VS Mode
        if (this.localInVsMode) {
          this.conn.send({ type: 'in_vs_mode' });
        } else {
          this.showRoomNotice(`LINKED TO ROOM ${this.roomId} // SELECT "VS MODE" IN GAME`);
        }
      });

      this.conn.on('error', (err) => {
        console.warn('[Netplay Guest Conn Error]', err);
        if (!this.connected && this.joinRetryAttempts < 8) {
          this.retryGuestConnect(hostPeerId);
        } else {
          this.updatePromptStatus(`CONNECTION NOTICE: ${err.message || err.type || 'Host link dropped'}`);
        }
      });

      this.conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'pong') {
          const now = Date.now();
          this.ping = Math.round(now - data.t);
          if (this.hudPing) {
            this.hudPing.textContent = `${this.ping} ms`;
            this.hudPing.className = `hud-ping ${this.ping < 50 ? 'good' : this.ping < 100 ? 'medium' : 'high'}`;
          }
        } else if (data.type === 'clock_tick') {
          if (data.f !== undefined) {
            this.peerFightFrame = data.f;
          }
        } else if (data.type === 'combat_sync') {
          this.applyCombatSync(data);
        } else if (data.type === 'in_vs_mode') {
          this.peerInVsMode = true;
          if (this.localInVsMode) {
            this.versusActive = true;
            this.hideVsPrompt();
            this.hideRoomNotice();
            this.updateHudStatus('SELECT FIGHTER', true);
          }
        } else if (data.type === 'left_vs_mode') {
          this.peerInVsMode = false;
          this.versusActive = false;
          this.sentInVsPacket = false;
          this.resetFightState();
          this.updateHudStatus('PEER EXITED TO MENU', false);
          this.showRoomNotice('Host left Versus Mode back to Main Menu.');
        } else if (data.type === 'stage_ready') {
          this.peerStageReady = true;
          // Guest waits for Host to send 'start_fight'
        } else if (data.type === 'start_fight') {
          this.peerStageReady = true;
          this.localStageReady = true;
          this.conn.send({ type: 'fight_ack' });
          if (data.cam !== undefined || data.rngSeed !== undefined) {
            if (data.cam !== undefined) {
              this.lastHostCamYaw = (typeof data.cam === 'object') ? data.cam.yaw : data.cam;
              if (data.pitch !== undefined) this.lastHostCamPitch = data.pitch;
              else if (typeof data.cam === 'object' && data.cam.pitch !== undefined) this.lastHostCamPitch = data.cam.pitch;
            }
            const buf = getWasmBuffer();
            if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
              try {
                const dv = new DataView(buf, this.ramPtr, 0x200000);
                if (this.lastHostCamYaw !== undefined) {
                  dv.setInt32(CAM_YAW_OFFSET, this.lastHostCamYaw, true);
                  dv.setInt32(CAM_DELTA_OFFSET, 0, true);
                }
                if (this.lastHostCamPitch !== undefined) dv.setInt32(CAM_PITCH_OFFSET, this.lastHostCamPitch, true);
                if (data.rngSeed !== undefined) {
                  dv.setUint32(PSX_RNG_SEED_OFFSET, data.rngSeed, true);
                  console.log(`[Netplay Guest] Synchronized round-start PRNG seed: 0x${data.rngSeed.toString(16)}`);
                }
              } catch (e) {}
            }
          }
          if (!this.fightActive) {
            this.startFight();
          }
        } else if (data.type === 'frame_input') {
          if (this.role === 'guest' && this.screen === 8 && !this.fightActive) {
            this.startFight();
            if (data.f !== undefined && data.f > 0) this.fightFrame = data.f;
            if (this.conn && this.conn.open) this.conn.send({ type: 'fight_ack' });
          }
          if (data.cam !== undefined) {
            this.lastHostCamYaw = data.cam;
            if (data.pitch !== undefined) this.lastHostCamPitch = data.pitch;
            const buf = getWasmBuffer();
            if (buf && this.ramPtr !== undefined && this.ramPtr !== null && this.ramPtr >= 0) {
              try {
                const dv = new DataView(buf, this.ramPtr, 0x200000);
                dv.setInt32(CAM_YAW_OFFSET, data.cam, true);
                dv.setInt32(CAM_DELTA_OFFSET, 0, true);
                if (data.pitch !== undefined) dv.setInt32(CAM_PITCH_OFFSET, data.pitch, true);
              } catch (e) {}
            }
          }
          if (this.fightActive && Array.isArray(data.btns)) {
            const remoteKeys = P1_HOST_KEYS;
            const incoming = new Set(data.btns);

            // Release any button no longer held
            for (const b of this.remoteHeldButtons) {
              if (!incoming.has(b)) {
                this.remoteHeldButtons.delete(b);
                if (remoteKeys[b]) injectDOMKey('keyup', remoteKeys[b]);
              }
            }
            // Press any new button
            for (const b of incoming) {
              if (!this.remoteHeldButtons.has(b)) {
                this.remoteHeldButtons.add(b);
                if (remoteKeys[b]) injectDOMKey('keydown', remoteKeys[b]);
              }
            }
          }
        } else if (data.type === 'fight_input') {
          if (data.btn && (data.player === 1 || data.player === 2)) {
            if (this.fightActive) {
              this.remoteInputQueue.push({
                targetFrame: data.targetFrame !== undefined ? data.targetFrame : (this.fightFrame + 1),
                player: data.player,
                action: data.action,
                btn: data.btn
              });
            } else {
              const keys = (data.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
              if (keys[data.btn]) injectDOMKey(data.action, keys[data.btn]);
            }
          }
        } else if (data.type === 'input' || data.type === 'menu_input') {
          if (this.versusActive && data.btn) {
            const keys = (data.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
            if (keys[data.btn]) injectDOMKey(data.action, keys[data.btn]);
          }
        }
      });

      this.conn.on('close', () => {
        if (this.connected) {
          console.log('[Netplay Guest] Host disconnected');
          this.disconnect();
          alert('Match ended: Player 1 disconnected.');
        } else {
          console.log('[Netplay Guest] Link closed during handshake, retrying...');
          this.retryGuestConnect(hostPeerId);
        }
      });
    }

    /* =========================================================================
       INPUT SYNCHRONIZATION (DUAL LOCAL SIMULATION)
       ========================================================================= */

    handleLocalKeyEvent(e) {
      // 1. DISCARD ALL SYNTHETIC/INJECTED EVENTS (ELIMINATES ECHO LOOPS 100%)
      if (!e.isTrusted || e.__netplayInjected) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // 2. If not connected to any peer, single-player keyboard works 100% normally
      if (!this.connected || !this.conn || !this.conn.open) return;

      // 3. If NOT in Versus Mode, single-player keyboard works 100% normally for both players!
      // This allows both Host and Guest to freely navigate their own menus to select "VS MODE".
      if (!this.versusActive || !this.localInVsMode) return;

      // 4. DROP OS KEY REPEAT FLOODING (Netplay only transmits key down/up transitions)
      if (e.repeat) {
        if (this.role === 'guest') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        return;
      }

      // 5. In Stage Loading (screen 11), mute all inputs
      if (this.screen === 11) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // 6. GUEST (PLAYER 2) INPUT ROUTING IN VERSUS MODE:
      if (this.role === 'guest') {
        // UNCONDITIONALLY intercept physical keys so they NEVER leak into Player 1!
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const btn = P2_PHYSICAL_KEYS[e.code];
        if (!btn || !P2_HOST_KEYS[btn]) return;

        if (e.type === 'keydown') this.heldButtons.add(btn);
        else if (e.type === 'keyup') this.heldButtons.delete(btn);

        if (this.screen === 8 && this.fightActive) {
          // Synchronized battle: queue locally and send with target frame
          const targetFrame = this.fightFrame + this.inputDelay;
          this.localInputQueue.push({
            targetFrame: targetFrame,
            player: 2,
            action: e.type,
            btn: btn
          });
          this.conn.send({
            type: 'fight_input',
            targetFrame: targetFrame,
            player: 2,
            action: e.type,
            btn: btn
          });
        } else {
          // Instant pass-through for character select & menus
          injectDOMKey(e.type, P2_HOST_KEYS[btn]);
          this.conn.send({
            type: 'input',
            player: 2,
            action: e.type,
            btn: btn
          });
        }
        return;
      }

      // 6. HOST (PLAYER 1) INPUT ROUTING:
      if (this.role === 'host') {
        const btn = P1_PHYSICAL_KEYS[e.code];
        if (!btn || !P1_HOST_KEYS[btn]) return;

        if (e.type === 'keydown') this.heldButtons.add(btn);
        else if (e.type === 'keyup') this.heldButtons.delete(btn);

        if (this.screen === 8 && this.fightActive) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const targetFrame = this.fightFrame + this.inputDelay;
          this.localInputQueue.push({
            targetFrame: targetFrame,
            player: 1,
            action: e.type,
            btn: btn
          });
          this.conn.send({
            type: 'fight_input',
            targetFrame: targetFrame,
            player: 1,
            action: e.type,
            btn: btn
          });
        } else {
          // Menus, character select: Host keys naturally drive P1 locally,
          // and transmit to Guest so Guest simulation also executes P1!
          this.conn.send({
            type: 'input',
            player: 1,
            action: e.type,
            btn: btn
          });
        }
      }
    }

    startGamepadLoop() {
      if (this.gamepadPollInterval) clearInterval(this.gamepadPollInterval);

      this.gamepadPollInterval = setInterval(() => {
        if (!this.connected || !this.conn || !this.conn.open) return;
        if (!this.versusActive) return; // Only poll once in Versus Mode

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        if (!gamepads || !gamepads[0]) return;
        const gp = gamepads[0];

        // Button polling
        for (let bIndex = 0; bIndex < gp.buttons.length; bIndex++) {
          const pressed = gp.buttons[bIndex].pressed;
          const wasPressed = !!this.prevGamepadState[`b_${bIndex}`];

          if (pressed !== wasPressed) {
            this.prevGamepadState[`b_${bIndex}`] = pressed;
            const virtualBtn = GAMEPAD_BUTTON_MAP[bIndex];
            if (virtualBtn) {
              const action = pressed ? 'keydown' : 'keyup';
              this.handleGamepadButton(virtualBtn, action);
            }
          }
        }

        // D-Pad / Left Stick Analog
        const axX = gp.axes[0] || 0;
        const axY = gp.axes[1] || 0;
        const DEADZONE = 0.4;

        this.checkGamepadAxis('axis_up', axY < -DEADZONE, 'UP');
        this.checkGamepadAxis('axis_down', axY > DEADZONE, 'DOWN');
        this.checkGamepadAxis('axis_left', axX < -DEADZONE, 'LEFT');
        this.checkGamepadAxis('axis_right', axX > DEADZONE, 'RIGHT');

      }, 1000 / 60); // 60Hz input sync loop
    }

    checkGamepadAxis(key, active, virtualBtn) {
      const wasActive = !!this.prevGamepadState[key];
      if (active !== wasActive) {
        this.prevGamepadState[key] = active;
        const action = active ? 'keydown' : 'keyup';
        this.handleGamepadButton(virtualBtn, action);
      }
    }

    handleGamepadButton(btn, action) {
      if (!this.connected || !this.conn || !this.conn.open) return;
      if (!this.versusActive) return;

      if (this.screen === 11) return; // Drop during stage loading

      if (this.screen === 8 && this.fightActive) {
        if (this.role === 'host') {
          const targetFrame = this.fightFrame + this.inputDelay;
          this.localInputQueue.push({
            targetFrame: targetFrame,
            player: 1,
            action: action,
            btn: btn
          });
          this.conn.send({
            type: 'fight_input',
            targetFrame: targetFrame,
            player: 1,
            action: action,
            btn: btn
          });
        } else if (this.role === 'guest') {
          const targetFrame = this.fightFrame + this.inputDelay;
          this.localInputQueue.push({
            targetFrame: targetFrame,
            player: 2,
            action: action,
            btn: btn
          });
          this.conn.send({
            type: 'fight_input',
            targetFrame: targetFrame,
            player: 2,
            action: action,
            btn: btn
          });
        }
      } else {
        if (this.role === 'host') {
          if (P1_HOST_KEYS[btn]) injectDOMKey(action, P1_HOST_KEYS[btn]);
          this.conn.send({ type: 'input', player: 1, action: action, btn: btn });
        } else if (this.role === 'guest') {
          if (P2_HOST_KEYS[btn]) injectDOMKey(action, P2_HOST_KEYS[btn]);
          this.conn.send({ type: 'input', player: 2, action: action, btn: btn });
        }
      }
    }

    startPingLoop() {
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.conn && this.conn.open) {
          this.conn.send({ type: 'ping', t: Date.now() });
        }
      }, 1000);
    }

    copyRoomLink() {
      const url = `${window.location.origin}${window.location.pathname}#room=${this.roomId}`;
      const flashBtn = (btn) => {
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = 'LINK COPIED!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          flashBtn(this.btnPromptCopyLink);
        }).catch(() => {
          prompt('Copy room link:', url);
        });
      } else {
        prompt('Copy room link:', url);
      }
    }

    updateHud(roleText, roomCode) {
      if (this.multiplayerHud) {
        this.multiplayerHud.classList.add('active');
        if (this.hudRole) this.hudRole.textContent = roleText;
        if (this.hudRoom) this.hudRoom.textContent = `ROOM: ${roomCode}`;
      }
    }

    updateHudStatus(statusText, isActive = false) {
      if (this.hudModeStatus) {
        this.hudModeStatus.textContent = statusText;
        if (isActive) {
          this.hudModeStatus.classList.add('active');
        } else {
          this.hudModeStatus.classList.remove('active');
        }
      }
    }

    releaseAllInjectedKeys() {
      // Clear any stuck keystates in the PSX engine
      Object.values(P1_HOST_KEYS).forEach(k => injectDOMKey('keyup', k));
      Object.values(P2_HOST_KEYS).forEach(k => injectDOMKey('keyup', k));
    }

    cleanupNetwork() {
      if (this.pingInterval) clearInterval(this.pingInterval);
      if (this.gamepadPollInterval) clearInterval(this.gamepadPollInterval);

      if (this.joinRetryTimer) {
        clearTimeout(this.joinRetryTimer);
        this.joinRetryTimer = null;
      }
      this.joinRetryAttempts = 0;

      if (this.connWatchdog) {
        clearTimeout(this.connWatchdog);
        this.connWatchdog = null;
      }

      this.releaseAllInjectedKeys();

      if (this.conn) {
        try { this.conn.close(); } catch (e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }

      this.cleanedUp = true;
      this.role = null;
      this.connected = false;
      this.versusActive = false;
      this.peerInVsMode = false;
      this.sentInVsPacket = false;
      this.fightActive = false;
      this.localStageReady = false;
      this.peerStageReady = false;
      this.guestFightAck = false;
      this.lastReadyPing = 0;
      this.fightFrame = 0;
      this.peerFightFrame = 0;
      this.syncCount = 0;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      if (this.heldButtons) this.heldButtons.clear();
      if (this.remoteHeldButtons) this.remoteHeldButtons.clear();
      this.prevGamepadState = {};
      this.updateSyncBadge(false);
    }

    disconnect() {
      this.cleanupNetwork();

      if (this.multiplayerHud) {
        this.multiplayerHud.classList.remove('active');
      }

      this.hideVsPrompt();
      this.hideRoomNotice();

      if (this.promptHostStatus) this.promptHostStatus.textContent = 'Standby';
      if (this.promptJoinStatus) this.promptJoinStatus.textContent = 'Standby';
    }
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.tekkenMultiplayer = new TekkenMultiplayer();
    });
  } else {
    window.tekkenMultiplayer = new TekkenMultiplayer();
  }

})();
