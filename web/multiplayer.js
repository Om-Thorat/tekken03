/**
 * Tekken 3 Web Edition - WebRTC P2P Multiplayer (Remote Play Together)
 * Allows two players across the internet to play Tekken 3 without server setup:
 * - Host (Player 1) runs the game engine and streams 60fps canvas + stereo audio.
 * - Guest (Player 2) connects via room code/link, receives stream, and sends inputs.
 */

(() => {
  'use strict';

  // Audio interception: clone audio directed to speakers into WebRTC stream
  if (typeof AudioNode !== 'undefined') {
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...args) {
      try {
        if (target && this.context && target === this.context.destination) {
          if (!this.context.__tekkenStreamDest) {
            this.context.__tekkenStreamDest = this.context.createMediaStreamDestination();
          }
          origConnect.call(this, this.context.__tekkenStreamDest);
        }
      } catch (e) {}
      return origConnect.call(this, target, ...args);
    };
  }

  // Player 2 Key Bindings Translation Table for Host Emscripten
  // These are the exact scan codes expected by PSXRecomp's default player2 keybinds:
  const P2_HOST_KEYS = {
    UP:     { code: 'KeyI', key: 'i', keyCode: 73 },
    DOWN:   { code: 'KeyK', key: 'k', keyCode: 75 },
    LEFT:   { code: 'KeyJ', key: 'j', keyCode: 74 },
    RIGHT:  { code: 'KeyL', key: 'l', keyCode: 76 },
    LP:     { code: 'Numpad4', key: '4', keyCode: 100 }, // Left Punch (Square)
    RP:     { code: 'Numpad5', key: '5', keyCode: 101 }, // Right Punch (Triangle)
    LK:     { code: 'Numpad1', key: '1', keyCode: 97 },  // Left Kick (Cross)
    RK:     { code: 'Numpad2', key: '2', keyCode: 98 },  // Right Kick (Circle)
    L1:     { code: 'KeyU', key: 'u', keyCode: 85 },
    L2:     { code: 'Numpad7', key: '7', keyCode: 103 },
    R1:     { code: 'KeyO', key: 'o', keyCode: 79 },
    R2:     { code: 'Numpad9', key: '9', keyCode: 105 },
    START:  { code: 'NumpadEnter', key: 'Enter', keyCode: 13 },
    SELECT: { code: 'Backspace', key: 'Backspace', keyCode: 8 }
  };

  // Keyboard Mapping on Guest side (supports standard WASD or Arrows + Attack layout)
  const GUEST_KEY_MAP = {
    // Movement (WASD or Arrows)
    'ArrowUp': 'UP',
    'KeyW': 'UP',
    'ArrowDown': 'DOWN',
    'KeyS': 'DOWN',
    'ArrowLeft': 'LEFT',
    'KeyA': 'LEFT',
    'ArrowRight': 'RIGHT',
    'KeyD': 'RIGHT',

    // Attacks (Right hand layout: J/K/M/, or Z/X/A/S or Numpad 4/5/1/2)
    'KeyZ': 'LP',
    'Numpad4': 'LP',
    'KeyJ': 'LP',

    'KeyA': 'RP',
    'Numpad5': 'RP',
    'KeyI': 'RP',
    'KeyK': 'RP',

    'KeyX': 'LK',
    'Numpad1': 'LK',
    'KeyM': 'LK',
    'KeyN': 'LK',

    'KeyS': 'RK',
    'Numpad2': 'RK',
    'Comma': 'RK',
    'Period': 'RK',

    // Triggers
    'KeyQ': 'L1',
    'KeyU': 'L1',
    'KeyE': 'L2',
    'Numpad7': 'L2',
    'KeyR': 'R1',
    'KeyO': 'R1',
    'KeyT': 'R2',
    'Numpad9': 'R2',

    // Menu
    'Enter': 'START',
    'NumpadEnter': 'START',
    'ShiftRight': 'SELECT',
    'ShiftLeft': 'SELECT',
    'Backspace': 'SELECT'
  };

  // Standard Gamepad to P2 Virtual Button Map
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

  class TekkenMultiplayer {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.call = null;
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

      this.remoteVideo = document.getElementById('remoteVideo');
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
      if (this.hostStartBtn) this.hostStartBtn.addEventListener('click', () => {
        this.closeModal();
        if (typeof window.bootTekken === 'function') window.bootTekken();
      });

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

      // Keyboard listener on window for guest
      window.addEventListener('keydown', (e) => this.handleGuestKeyEvent(e));
      window.addEventListener('keyup', (e) => this.handleGuestKeyEvent(e));
    }

    initHashListener() {
      // Check if opened with #room=TK3-XXXX
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
      return 'tekken3-web-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /* =========================================================================
       HOST FLOW
       ========================================================================= */

    createRoom() {
      if (this.peer) this.peer.destroy();
      this.disconnect();

      const code = this.generateCode();
      const peerId = this.normalizePeerId(code);
      this.role = 'host';
      this.roomId = code;

      this.hostStatus.textContent = 'Initializing P2P Room...';
      this.btnCreateRoom.disabled = true;

      // Connect to PeerJS cloud server
      this.peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.hostStatus.textContent = '🟡 Waiting for Player 2 to join...';
        this.hostRoomBox.style.display = 'block';
        this.hostRoomCode.textContent = code;
        this.btnCreateRoom.disabled = false;
        this.btnCreateRoom.textContent = 'Regenerate Room';
        this.hostStartBtn.style.display = 'inline-flex';
      });

      this.peer.on('error', (err) => {
        console.warn('[P2P Host Error]', err);
        if (err.type === 'unavailable-id') {
          // Retry with new code
          setTimeout(() => this.createRoom(), 500);
        } else {
          this.hostStatus.textContent = `❌ Connection Error: ${err.type || err.message}`;
          this.btnCreateRoom.disabled = false;
        }
      });

      // When Guest connects DataChannel
      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.setupHostDataChannel();
      });
    }

    setupHostDataChannel() {
      this.conn.on('open', () => {
        console.log('[P2P Host] Player 2 DataChannel connected!');
        this.connected = true;
        this.hostStatus.innerHTML = '<span style="color:#00e5ff">🟢 Player 2 Connected! Streaming match...</span>';
        this.updateHud('HOST (P1)', this.roomId, 'Connected');

        // Capture video + audio stream from canvas and audio context
        const stream = this.captureHostStream();
        if (stream) {
          console.log('[P2P Host] Calling Player 2 with media stream...');
          this.call = this.peer.call(this.conn.peer, stream);
          this.call.on('error', (e) => console.warn('[P2P Call Error]', e));
        }

        // Auto-boot game if host hasn't started yet
        if (typeof window.bootTekken === 'function') {
          window.bootTekken();
        }
      });

      this.conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'ping') {
          this.conn.send({ type: 'pong', t: data.t });
        } else if (data.type === 'p2_input') {
          this.injectHostInput(data);
        }
      });

      this.conn.on('close', () => {
        console.log('[P2P Host] Player 2 disconnected');
        this.connected = false;
        this.hostStatus.textContent = '🟡 Player 2 left. Waiting for challenger...';
        this.updateHud('HOST (P1)', this.roomId, 'Waiting...');
      });
    }

    captureHostStream() {
      const displayCanvas = document.getElementById('displayCanvas') || document.getElementById('canvas');
      if (!displayCanvas) return null;

      let stream = null;
      try {
        stream = displayCanvas.captureStream(60);
      } catch (e) {
        console.warn('[P2P] captureStream failed:', e);
        return null;
      }

      // Add audio track if available
      try {
        const audioCtx = window.__tekkenAudioCtx || (window.Module?.SDL2?.audioContext);
        if (audioCtx && audioCtx.__tekkenStreamDest) {
          const audioTrack = audioCtx.__tekkenStreamDest.stream.getAudioTracks()[0];
          if (audioTrack) {
            stream.addTrack(audioTrack);
            console.log('[P2P Host] Attached stereo audio track to WebRTC stream');
          }
        }
      } catch (e) {
        console.warn('[P2P Host] Audio track attachment warning:', e);
      }

      return stream;
    }

    injectHostInput(data) {
      const { action, code, key, keyCode } = data;
      const target = document.getElementById('displayCanvas') || document.getElementById('canvas') || window;

      const eventInit = {
        code: code,
        key: key,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true
      };

      try {
        const evt = new KeyboardEvent(action, eventInit);
        target.dispatchEvent(evt);
        if (target !== window) window.dispatchEvent(evt);
      } catch (e) {
        console.warn('[P2P Host] Input injection error:', e);
      }
    }

    /* =========================================================================
       GUEST FLOW
       ========================================================================= */

    joinRoom(rawCode) {
      if (this.peer) this.peer.destroy();
      this.disconnect();

      // Clean input: extract room code if full URL was pasted
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

      this.peer.on('open', (id) => {
        this.joinStatus.textContent = '🟡 Establishing P2P link with Host...';
        this.conn = this.peer.connect(hostPeerId, {
          reliable: false // low-latency UDP mode for fighting game input
        });

        this.setupGuestDataChannel();
      });

      // When Host calls with video/audio stream
      this.peer.on('call', (call) => {
        console.log('[P2P Guest] Incoming media stream from Host!');
        this.call = call;
        call.answer(); // Answer without sending local stream

        call.on('stream', (remoteStream) => {
          console.log('[P2P Guest] Received remote media stream!');
          this.remoteVideo.srcObject = remoteStream;
          this.remoteVideo.classList.add('active');
          this.remoteVideo.play().catch(console.warn);

          // Hide local boot overlay and standby text
          const bootOverlay = document.getElementById('bootOverlay');
          if (bootOverlay) bootOverlay.classList.add('hidden');

          this.closeModal();
          this.updateHud('GUEST (P2)', this.roomId, 'Match Active');
        });

        call.on('error', (err) => console.warn('[P2P Guest Call Error]', err));
      });

      this.peer.on('error', (err) => {
        console.warn('[P2P Guest Error]', err);
        this.joinStatus.textContent = `❌ Failed to connect: ${err.type || err.message}`;
        this.btnJoinRoom.disabled = false;
      });
    }

    setupGuestDataChannel() {
      this.conn.on('open', () => {
        console.log('[P2P Guest] Connected to Host DataChannel!');
        this.connected = true;
        this.btnJoinRoom.disabled = false;
        this.joinStatus.innerHTML = '<span style="color:#00e5ff">🟢 Connected! Receiving game stream...</span>';
        this.updateHud('GUEST (P2)', this.roomId, 'Connected');

        // Start measuring Ping
        this.startPingLoop();

        // Start Gamepad polling
        this.startGamepadLoop();
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
        }
      });

      this.conn.on('close', () => {
        console.log('[P2P Guest] Host disconnected');
        this.disconnect();
        alert('Host ended the match or disconnected.');
      });
    }

    startPingLoop() {
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.conn && this.conn.open) {
          this.conn.send({ type: 'ping', t: Date.now() });
        }
      }, 1000);
    }

    startGamepadLoop() {
      if (this.gamepadPollInterval) clearInterval(this.gamepadPollInterval);

      this.gamepadPollInterval = setInterval(() => {
        if (this.role !== 'guest' || !this.connected) return;

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        if (!gamepads || !gamepads[0]) return;
        const gp = gamepads[0];

        // Check Buttons
        for (let bIndex = 0; bIndex < gp.buttons.length; bIndex++) {
          const pressed = gp.buttons[bIndex].pressed;
          const wasPressed = !!this.prevGamepadState[`b_${bIndex}`];

          if (pressed !== wasPressed) {
            this.prevGamepadState[`b_${bIndex}`] = pressed;
            const virtualBtn = GAMEPAD_BUTTON_MAP[bIndex];
            if (virtualBtn) {
              this.sendVirtualP2Key(virtualBtn, pressed ? 'keydown' : 'keyup');
            }
          }
        }

        // Check D-Pad Analog Stick (Axes 0 & 1)
        const axX = gp.axes[0] || 0;
        const axY = gp.axes[1] || 0;
        const DEADZONE = 0.4;

        const up = axY < -DEADZONE;
        const down = axY > DEADZONE;
        const left = axX < -DEADZONE;
        const right = axX > DEADZONE;

        this.checkAxisState('axis_up', up, 'UP');
        this.checkAxisState('axis_down', down, 'DOWN');
        this.checkAxisState('axis_left', left, 'LEFT');
        this.checkAxisState('axis_right', right, 'RIGHT');

      }, 1000 / 60); // 60Hz input polling
    }

    checkAxisState(key, active, virtualBtn) {
      const wasActive = !!this.prevGamepadState[key];
      if (active !== wasActive) {
        this.prevGamepadState[key] = active;
        this.sendVirtualP2Key(virtualBtn, active ? 'keydown' : 'keyup');
      }
    }

    handleGuestKeyEvent(e) {
      if (this.role !== 'guest' || !this.connected) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const virtualBtn = GUEST_KEY_MAP[e.code];
      if (virtualBtn) {
        e.preventDefault();
        this.sendVirtualP2Key(virtualBtn, e.type);
      }
    }

    sendVirtualP2Key(virtualBtn, action) {
      const hostKey = P2_HOST_KEYS[virtualBtn];
      if (!hostKey || !this.conn || !this.conn.open) return;

      this.conn.send({
        type: 'p2_input',
        action: action,
        code: hostKey.code,
        key: hostKey.key,
        keyCode: hostKey.keyCode
      });
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

    updateHud(roleText, roomCode, statusText) {
      if (this.multiplayerHud) {
        this.multiplayerHud.classList.add('active');
        if (this.hudRole) this.hudRole.textContent = roleText;
        if (this.hudRoom) this.hudRoom.textContent = `ROOM: ${roomCode}`;
      }
    }

    disconnect() {
      if (this.pingInterval) clearInterval(this.pingInterval);
      if (this.gamepadPollInterval) clearInterval(this.gamepadPollInterval);

      if (this.call) {
        try { this.call.close(); } catch (e) {}
        this.call = null;
      }
      if (this.conn) {
        try { this.conn.close(); } catch (e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }

      if (this.remoteVideo) {
        this.remoteVideo.srcObject = null;
        this.remoteVideo.classList.remove('active');
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
