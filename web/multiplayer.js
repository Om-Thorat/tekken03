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

  // Global engine hook invoked on every 60Hz frame swap by C runtime (gpu_gl_renderer.c)
  window.tekkenOnEngineFrame = (screen, mode) => {
    if (window.tekkenMultiplayer && typeof window.tekkenMultiplayer.onEngineFrame === 'function') {
      window.tekkenMultiplayer.onEngineFrame(screen, mode);
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

      // In-game Versus flow states
      this.vsPromptShown = false;
      this.versusActive = false;
      this.localInVsMode = false;
      this.peerInVsMode = false;
      this.screen = 0;
      this.mode = 0;

      // Deterministic Lockstep Synchronization (Option 1)
      this.inputDelay = 2; // Symmetric 2-frame delay buffer (~33ms at 60Hz)
      this.fightFrame = 0;
      this.localStageReady = false;
      this.peerStageReady = false;
      this.fightActive = false;
      this.localInputQueue = [];
      this.remoteInputQueue = [];

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
          this.showRoomNotice(`LINKED TO ROOM ${roomCode}: Please start game & select "VS MODE" to fight!`);
          this.joinRoom(roomCode);
        }
      }
    }

    /* =========================================================================
       ENGINE FRAME HOOK (SCREEN & MODE STATE MACHINE)
       ========================================================================= */

    onEngineFrame(screen, mode) {
      const s = screen & 0xffff;
      const m = mode & 0xff;
      this.screen = s;
      this.mode = m;

      // In Tekken 3:
      // Screen 4 is Main Menu, Screen 0 is Boot/Intro.
      // Screen 9 = Character Select, 10 = Team Select, 11 = Loading stage, 8 = In-Fight.
      const isVsMode = (s !== 4 && s !== 0);

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
                this.fightActive = false;
                this.localStageReady = false;
                this.peerStageReady = false;
                this.fightFrame = 0;
                this.localInputQueue = [];
                this.remoteInputQueue = [];
                this.releaseAllInjectedKeys();
              }
              this.updateHudStatus('SELECT FIGHTER', true);
            } else if (s === 11) {
              // Stage Loading: hold inputs and reset ready flags so both engines sync before battle
              if (this.fightActive || this.localStageReady || this.peerStageReady) {
                this.fightActive = false;
                this.localStageReady = false;
                this.peerStageReady = false;
                this.fightFrame = 0;
                this.localInputQueue = [];
                this.remoteInputQueue = [];
                this.releaseAllInjectedKeys();
              }
              this.updateHudStatus('LOADING STAGE...', true);
            } else if (s === 8) {
              // Battle Screen: Stage Ready Barrier & Deterministic Frame Lockstep
              if (!this.localStageReady) {
                this.localStageReady = true;
                this.conn.send({ type: 'stage_ready', screen: 8 });
              }

              if (!this.peerStageReady) {
                this.updateHudStatus('WAITING FOR PEER TO LOAD...', true);
                return; // Hold neutral until peer finishes loading
              }

              if (!this.fightActive) {
                if (this.role === 'host') {
                  this.conn.send({ type: 'start_fight', startFrame: 0 });
                  this.startFight();
                } else {
                  this.updateHudStatus('READY... AWAITING HOST', true);
                  return;
                }
              } else {
                // Fight active: step logical frame and apply queued inputs
                this.fightFrame++;
                this.processInputQueues();

                // Periodic frame sync heartbeat from host every 60 frames (~1 sec)
                if (this.role === 'host' && (this.fightFrame % 60 === 0)) {
                  this.conn.send({ type: 'frame_sync', hostFrame: this.fightFrame });
                }
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
        this.fightActive = false;
        this.localStageReady = false;
        this.peerStageReady = false;
        this.fightFrame = 0;
        this.localInputQueue = [];
        this.remoteInputQueue = [];

        // When returning to main menu (screen 4), reset prompt flag so next VS entry triggers prompt
        if (s === 4) {
          this.vsPromptShown = false;
        }
      }
    }

    startFight() {
      this.fightActive = true;
      this.fightFrame = 0;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      this.releaseAllInjectedKeys();
      this.updateHudStatus('ROUND 1 - FIGHT!', true);
      console.log(`[Netplay] Synchronized fight started! Role: ${this.role}, Delay: ${this.inputDelay} frames`);
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

    createRoom(fromPrompt = false) {
      this.cleanupNetwork();

      const code = this.generateCode();
      const peerId = this.normalizePeerId(code);
      this.role = 'host';
      this.roomId = code;

      this.updatePromptStatus('CONNECTING TO LOBBY...');

      this.peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', () => {
        const waitingMsg = 'WAITING FOR CHALLENGER...';
        this.updatePromptStatus(waitingMsg);
        if (this.promptRoomCode) this.promptRoomCode.textContent = code;
        this.showRoomNotice(`ROOM ${code} READY // INVITE A FRIEND`);
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Host Error]', err);
        if (err.type === 'unavailable-id') {
          setTimeout(() => this.createRoom(fromPrompt), 500);
        } else {
          this.updatePromptStatus(`ERROR: ${err.type || err.message}`);
        }
      });

      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.setupHostConnection();
      });
    }

    setupHostConnection() {
      this.conn.on('open', () => {
        console.log('[Netplay Host] Player 2 linked!');
        this.connected = true;
        this.updateHud('HOST (P1)', this.roomId);
        this.updatePromptStatus('CHALLENGER LINKED // ENTERING BATTLE...');

        this.startPingLoop();
        this.startGamepadLoop();

        // Inform guest of host's VS Mode state
        if (this.localInVsMode) {
          this.conn.send({ type: 'in_vs_mode' });
        }
      });

      this.conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'ping') {
          this.conn.send({ type: 'pong', t: data.t });
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
          this.fightActive = false;
          this.localStageReady = false;
          this.peerStageReady = false;
          this.releaseAllInjectedKeys();
          this.updateHudStatus('PEER EXITED TO MENU', false);
          this.showRoomNotice('Player 2 left Versus Mode back to Main Menu.');
        } else if (data.type === 'stage_ready') {
          this.peerStageReady = true;
          if (this.localStageReady && !this.fightActive) {
            this.conn.send({ type: 'start_fight', startFrame: 0 });
            this.startFight();
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
          if (data.btn) {
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

      let code = rawCode.trim();
      if (code.includes('room=')) {
        const m = code.match(/room=([a-zA-Z0-9_-]+)/);
        if (m) code = m[1];
      }

      const hostPeerId = this.normalizePeerId(code);
      this.role = 'guest';
      this.roomId = code.toUpperCase();

      this.updatePromptStatus('CONNECTING TO HOST...');

      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', () => {
        this.updatePromptStatus('LINKING WITH HOST...');
        this.conn = this.peer.connect(hostPeerId, {
          reliable: true // In-order, lossless SCTP delivery prevents dropped or swapped keyups
        });
        this.setupGuestConnection();
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Guest Error]', err);
        this.updatePromptStatus(`FAILED TO CONNECT: ${err.type || err.message}`);
      });
    }

    setupGuestConnection() {
      this.conn.on('open', () => {
        console.log('[Netplay Guest] Connected to Host!');
        this.connected = true;
        this.updateHud('CHALLENGER (P2)', this.roomId);
        this.updatePromptStatus('CONNECTED TO HOST // ENTERING BATTLE...');

        this.startPingLoop();
        this.startGamepadLoop();

        // Inform host if guest is already in VS Mode
        if (this.localInVsMode) {
          this.conn.send({ type: 'in_vs_mode' });
        } else {
          this.showRoomNotice(`LINKED TO ROOM ${this.roomId} // SELECT "VS MODE" IN GAME`);
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
          this.fightActive = false;
          this.localStageReady = false;
          this.peerStageReady = false;
          this.releaseAllInjectedKeys();
          this.updateHudStatus('PEER EXITED TO MENU', false);
          this.showRoomNotice('Host left Versus Mode back to Main Menu.');
        } else if (data.type === 'stage_ready') {
          this.peerStageReady = true;
          // Guest waits for Host to send 'start_fight'
        } else if (data.type === 'start_fight') {
          this.startFight();
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
          if (data.btn) {
            const keys = (data.player === 1) ? P1_HOST_KEYS : P2_HOST_KEYS;
            if (keys[data.btn]) injectDOMKey(data.action, keys[data.btn]);
          }
        } else if (data.type === 'frame_sync') {
          if (data.hostFrame !== undefined && this.fightActive) {
            const diff = this.fightFrame - data.hostFrame;
            if (Math.abs(diff) > 3) {
              console.warn(`[Netplay Sync] Frame skew detected: Guest=${this.fightFrame}, Host=${data.hostFrame}. Aligning to host.`);
              this.fightFrame = data.hostFrame;
            }
          }
        }
      });

      this.conn.on('close', () => {
        console.log('[Netplay Guest] Host disconnected');
        this.disconnect();
        alert('Match ended: Player 1 disconnected.');
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

      // 3. DROP OS KEY REPEAT FLOODING (Netplay only transmits key down/up transitions)
      if (e.repeat) {
        if (this.role === 'guest' && (this.screen !== 4 && this.screen !== 0)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        return;
      }

      // 4. In Stage Loading (screen 11), mute all inputs
      if (this.screen === 11) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // 5. GUEST (PLAYER 2) INPUT ROUTING:
      if (this.role === 'guest') {
        // While at Main Menu / Boot (screen 4 or 0), let Guest navigate menu to select VS Mode
        if (this.screen === 4 || this.screen === 0) {
          return;
        }

        // EVERYWHERE ELSE (Character Select 9, Battle 8, etc.):
        // UNCONDITIONALLY intercept physical keys so they NEVER leak into Player 1!
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const btn = P2_PHYSICAL_KEYS[e.code];
        if (!btn || !P2_HOST_KEYS[btn]) return;

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

      this.releaseAllInjectedKeys();

      if (this.conn) {
        try { this.conn.close(); } catch (e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }

      this.role = null;
      this.connected = false;
      this.versusActive = false;
      this.peerInVsMode = false;
      this.sentInVsPacket = false;
      this.fightActive = false;
      this.localStageReady = false;
      this.peerStageReady = false;
      this.fightFrame = 0;
      this.localInputQueue = [];
      this.remoteInputQueue = [];
      this.prevGamepadState = {};
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
