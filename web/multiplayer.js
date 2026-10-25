/**
 * Tekken 3 Web Edition - True Local Simulation Netplay (Dual-Instance Input Sync)
 * 
 * In this mode, BOTH players run the full game engine locally on their own machines:
 * - 100% native resolution, sharp WebGL rendering, 60 FPS, zero video blur.
 * - Native stereo audio generated locally on both ends.
 * - Extremely lightweight WebRTC DataChannel exchanges only controller input packets.
 * - P1 inputs are mirrored on P2's local engine; P2 inputs are mirrored on P1's local engine.
 */

(() => {
  'use strict';

  // Exact scan codes expected by PSXRecomp's default keybinds
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
    SELECT: { code: 'ShiftRight', key: 'Shift', keyCode: 16 }
  };

  const P2_HOST_KEYS = {
    UP:     { code: 'KeyI', key: 'i', keyCode: 73 },
    DOWN:   { code: 'KeyK', key: 'k', keyCode: 75 },
    LEFT:   { code: 'KeyJ', key: 'j', keyCode: 74 },
    RIGHT:  { code: 'KeyL', key: 'l', keyCode: 76 },
    LP:     { code: 'Numpad4', key: '4', keyCode: 100 },
    RP:     { code: 'Numpad5', key: '5', keyCode: 101 },
    LK:     { code: 'Numpad1', key: '1', keyCode: 97 },
    RK:     { code: 'Numpad2', key: '2', keyCode: 98 },
    L1:     { code: 'KeyU', key: 'u', keyCode: 85 },
    L2:     { code: 'Numpad7', key: '7', keyCode: 103 },
    R1:     { code: 'KeyO', key: 'o', keyCode: 79 },
    R2:     { code: 'Numpad9', key: '9', keyCode: 105 },
    START:  { code: 'NumpadEnter', key: 'Enter', keyCode: 13 },
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
    'ShiftRight': 'SELECT'
  };

  // Keyboard mapping for P2's physical keys (allows P2 to use standard WASD / Arrows + attack keys)
  const P2_PHYSICAL_KEYS = {
    // Movement: WASD or Arrows
    'KeyW': 'UP',
    'ArrowUp': 'UP',
    'KeyS': 'DOWN',
    'ArrowDown': 'DOWN',
    'KeyA': 'LEFT',
    'ArrowLeft': 'LEFT',
    'KeyD': 'RIGHT',
    'ArrowRight': 'RIGHT',

    // Direct P2 Numpad / IJKL bindings
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
    'NumpadEnter': 'START',

    // Fighting layout for P2 on normal keyboards (J/K/M/, or Z/X/A/S)
    'KeyZ': 'LP',
    'KeyA': 'RP',
    'KeyX': 'LK',
    'KeyS': 'RK',
    'KeyQ': 'L1',
    'KeyE': 'L2',
    'Backspace': 'SELECT'
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
    const target = document.getElementById('displayCanvas') || document.getElementById('canvas') || window;
    const evt = new KeyboardEvent(action, {
      code: keyDef.code,
      key: keyDef.key,
      keyCode: keyDef.keyCode,
      which: keyDef.keyCode,
      bubbles: true,
      cancelable: true
    });
    target.dispatchEvent(evt);
    if (target !== window) {
      window.dispatchEvent(evt);
    }
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

      this.initDom();
      this.initHashListener();
    }

    initDom() {
      this.onlineModal = document.getElementById('onlineModal');
      this.btnOnlineRoom = document.getElementById('btnOnlineRoom');
      this.btnOnlineHero = document.getElementById('btnOnlineHero');
      this.modalClose = document.getElementById('modalClose');

      this.tabHost = document.getElementById('tabHost');
      this.tabJoin = document.getElementById('tabJoin');
      this.panelHost = document.getElementById('panelHost');
      this.panelJoin = document.getElementById('panelJoin');

      this.btnCreateRoom = document.getElementById('btnCreateRoom');
      this.hostStatus = document.getElementById('hostStatus');
      this.hostRoomBox = document.getElementById('hostRoomBox');
      this.hostRoomCode = document.getElementById('hostRoomCode');
      this.btnCopyLink = document.getElementById('btnCopyLink');
      this.hostStartBtn = document.getElementById('hostStartBtn');

      this.joinRoomInput = document.getElementById('joinRoomInput');
      this.btnJoinRoom = document.getElementById('btnJoinRoom');
      this.joinStatus = document.getElementById('joinStatus');

      this.multiplayerHud = document.getElementById('multiplayerHud');
      this.hudRole = document.getElementById('hudRole');
      this.hudPing = document.getElementById('hudPing');
      this.hudRoom = document.getElementById('hudRoom');
      this.btnDisconnect = document.getElementById('btnDisconnect');

      // Bind UI actions
      if (this.btnOnlineRoom) this.btnOnlineRoom.addEventListener('click', () => this.openModal());
      if (this.btnOnlineHero) this.btnOnlineHero.addEventListener('click', () => this.openModal());
      if (this.modalClose) this.modalClose.addEventListener('click', () => this.closeModal());

      if (this.tabHost && this.tabJoin) {
        this.tabHost.addEventListener('click', () => this.switchTab('host'));
        this.tabJoin.addEventListener('click', () => this.switchTab('join'));
      }

      if (this.btnCreateRoom) this.btnCreateRoom.addEventListener('click', () => this.createRoom());
      if (this.btnCopyLink) this.btnCopyLink.addEventListener('click', () => this.copyRoomLink());
      if (this.hostStartBtn) this.hostStartBtn.addEventListener('click', () => this.startSynchronizedMatch());

      if (this.btnJoinRoom) this.btnJoinRoom.addEventListener('click', () => {
        const val = this.joinRoomInput.value.trim();
        if (val) this.joinRoom(val);
      });

      if (this.joinRoomInput) {
        this.joinRoomInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const val = this.joinRoomInput.value.trim();
            if (val) this.joinRoom(val);
          }
        });
      }

      if (this.btnDisconnect) this.btnDisconnect.addEventListener('click', () => this.disconnect());

      // Global keyboard listeners for input synchronization
      window.addEventListener('keydown', (e) => this.handleLocalKeyEvent(e));
      window.addEventListener('keyup', (e) => this.handleLocalKeyEvent(e));
    }

    initHashListener() {
      const hash = window.location.hash;
      if (hash && hash.includes('room=')) {
        const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          setTimeout(() => {
            this.openModal();
            this.switchTab('join');
            this.joinRoomInput.value = match[1];
            this.joinRoom(match[1]);
          }, 300);
        }
      }
    }

    openModal() {
      if (this.onlineModal) {
        this.onlineModal.classList.add('active');
        if (typeof this.onlineModal.showModal === 'function') {
          try { this.onlineModal.showModal(); } catch (e) {}
        }
      }
    }

    closeModal() {
      if (this.onlineModal) {
        this.onlineModal.classList.remove('active');
        if (typeof this.onlineModal.close === 'function') {
          try { this.onlineModal.close(); } catch (e) {}
        }
      }
    }

    switchTab(tab) {
      if (tab === 'host') {
        this.tabHost.classList.add('active');
        this.tabJoin.classList.remove('active');
        this.panelHost.classList.add('active');
        this.panelJoin.classList.remove('active');
      } else {
        this.tabJoin.classList.add('active');
        this.tabHost.classList.remove('active');
        this.panelJoin.classList.add('active');
        this.panelHost.classList.remove('active');
      }
    }

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

    /* =========================================================================
       HOST FLOW (PLAYER 1)
       ========================================================================= */

    createRoom() {
      if (this.peer) this.peer.destroy();
      this.disconnect();

      const code = this.generateCode();
      const peerId = this.normalizePeerId(code);
      this.role = 'host';
      this.roomId = code;

      this.hostStatus.textContent = '🟡 Connecting to Netplay lobby...';
      this.btnCreateRoom.disabled = true;

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
        this.hostStatus.textContent = '🟡 Waiting for Player 2 to join...';
        this.hostRoomBox.style.display = 'block';
        this.hostRoomCode.textContent = code;
        this.btnCreateRoom.disabled = false;
        this.btnCreateRoom.textContent = 'Regenerate Room';
        this.hostStartBtn.style.display = 'none';
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Host Error]', err);
        if (err.type === 'unavailable-id') {
          setTimeout(() => this.createRoom(), 500);
        } else {
          this.hostStatus.textContent = `❌ Error: ${err.type || err.message}`;
          this.btnCreateRoom.disabled = false;
        }
      });

      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.setupHostConnection();
      });
    }

    setupHostConnection() {
      this.conn.on('open', () => {
        console.log('[Netplay Host] Player 2 connected!');
        this.connected = true;
        this.hostStatus.innerHTML = '<span style="color:#00e5ff">🟢 Player 2 Connected! Ready for battle.</span>';
        this.hostStartBtn.style.display = 'inline-flex';
        this.updateHud('HOST (P1)', this.roomId);

        this.startPingLoop();
        this.startGamepadLoop();

        // If Host already has the game running, inform guest to launch immediately
        if (window.__isTekkenRunning) {
          this.conn.send({ type: 'start_game' });
        }
      });

      this.conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'ping') {
          this.conn.send({ type: 'pong', t: data.t });
        } else if (data.type === 'input') {
          // P2 input received from remote -> inject into Host's local game on P2 port
          if (data.player === 2 && P2_HOST_KEYS[data.btn]) {
            injectDOMKey(data.action, P2_HOST_KEYS[data.btn]);
          }
        }
      });

      this.conn.on('close', () => {
        console.log('[Netplay Host] Player 2 disconnected');
        this.connected = false;
        this.hostStatus.textContent = '🟡 Player 2 left. Waiting for challenger...';
        this.updateHud('HOST (P1)', this.roomId);
        this.hostStartBtn.style.display = 'none';
      });
    }

    startSynchronizedMatch() {
      if (this.conn && this.conn.open) {
        this.conn.send({ type: 'start_game' });
      }
      this.closeModal();
      if (typeof window.bootTekken === 'function') {
        window.bootTekken();
      }
    }

    /* =========================================================================
       GUEST FLOW (PLAYER 2)
       ========================================================================= */

    joinRoom(rawCode) {
      if (this.peer) this.peer.destroy();
      this.disconnect();

      let code = rawCode.trim();
      if (code.includes('room=')) {
        const m = code.match(/room=([a-zA-Z0-9_-]+)/);
        if (m) code = m[1];
      }

      const hostPeerId = this.normalizePeerId(code);
      this.role = 'guest';
      this.roomId = code.toUpperCase();

      this.joinStatus.textContent = '🟡 Connecting to Host...';
      this.btnJoinRoom.disabled = true;

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
        this.joinStatus.textContent = '🟡 Linking with Host room...';
        this.conn = this.peer.connect(hostPeerId, {
          reliable: false // UDP-style low latency for 60Hz fighting game inputs
        });

        this.setupGuestConnection();
      });

      this.peer.on('error', (err) => {
        console.warn('[Netplay Guest Error]', err);
        this.joinStatus.textContent = `❌ Failed to connect: ${err.type || err.message}`;
        this.btnJoinRoom.disabled = false;
      });
    }

    setupGuestConnection() {
      this.conn.on('open', () => {
        console.log('[Netplay Guest] Connected to Host!');
        this.connected = true;
        this.btnJoinRoom.disabled = false;
        this.joinStatus.innerHTML = '<span style="color:#00e5ff">🟢 Connected to Player 1! Starting local engine...</span>';
        this.updateHud('CHALLENGER (P2)', this.roomId);

        this.startPingLoop();
        this.startGamepadLoop();

        // Boot local engine so Guest runs the exact same game at native 60 FPS
        setTimeout(() => {
          this.closeModal();
          if (typeof window.bootTekken === 'function') {
            window.bootTekken();
          }
        }, 500);
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
        } else if (data.type === 'start_game') {
          this.closeModal();
          if (typeof window.bootTekken === 'function') {
            window.bootTekken();
          }
        } else if (data.type === 'input') {
          // P1 input received from Host -> inject into Guest's local game on P1 port
          if (data.player === 1 && P1_HOST_KEYS[data.btn]) {
            injectDOMKey(data.action, P1_HOST_KEYS[data.btn]);
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
      if (!this.connected || !this.conn || !this.conn.open) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (this.role === 'host') {
        // Player 1 on Host:
        // When P1 presses their physical key, let it naturally trigger P1 locally,
        // and send the event to P2 over the network!
        const btn = P1_PHYSICAL_KEYS[e.code];
        if (btn) {
          this.conn.send({
            type: 'input',
            player: 1,
            action: e.type,
            btn: btn
          });
        }
      } else if (this.role === 'guest') {
        // Player 2 on Guest:
        // P2 uses comfortable physical keys (WASD, Arrows, Z/X/A/S, etc.)
        const btn = P2_PHYSICAL_KEYS[e.code];
        if (btn) {
          e.preventDefault();
          e.stopPropagation();

          // 1. Inject locally into P2's controller port on Guest's engine
          injectDOMKey(e.type, P2_HOST_KEYS[btn]);

          // 2. Transmit to Host so Host's engine also moves P2!
          this.conn.send({
            type: 'input',
            player: 2,
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
      if (this.role === 'host') {
        // P1 gamepad input -> send to P2
        this.conn.send({
          type: 'input',
          player: 1,
          action: action,
          btn: btn
        });
      } else if (this.role === 'guest') {
        // P2 gamepad input -> inject locally for P2 + send to Host
        injectDOMKey(action, P2_HOST_KEYS[btn]);
        this.conn.send({
          type: 'input',
          player: 2,
          action: action,
          btn: btn
        });
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
      navigator.clipboard.writeText(url).then(() => {
        const originalText = this.btnCopyLink.textContent;
        this.btnCopyLink.textContent = 'COPIED!';
        setTimeout(() => {
          this.btnCopyLink.textContent = originalText;
        }, 2000);
      }).catch(() => {
        prompt('Copy room link:', url);
      });
    }

    updateHud(roleText, roomCode) {
      if (this.multiplayerHud) {
        this.multiplayerHud.classList.add('active');
        if (this.hudRole) this.hudRole.textContent = roleText;
        if (this.hudRoom) this.hudRoom.textContent = `ROOM: ${roomCode}`;
      }
    }

    disconnect() {
      if (this.pingInterval) clearInterval(this.pingInterval);
      if (this.gamepadPollInterval) clearInterval(this.gamepadPollInterval);

      if (this.conn) {
        try { this.conn.close(); } catch (e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }

      if (this.multiplayerHud) {
        this.multiplayerHud.classList.remove('active');
      }

      this.role = null;
      this.connected = false;
      this.prevGamepadState = {};

      if (this.hostStatus) this.hostStatus.textContent = 'Standby';
      if (this.joinStatus) this.joinStatus.textContent = 'Standby';
      if (this.btnCreateRoom) this.btnCreateRoom.disabled = false;
      if (this.btnJoinRoom) this.btnJoinRoom.disabled = false;
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
