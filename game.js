/* Snart Pong — the classic 1972 arcade game, faithful to the original.
 *
 * Rules of the original, kept:
 *  - monochrome play: white on black, square ball, square paddles
 *  - first to 11 points wins a game, then sides swap
 *  - after each point the ball is served toward the player who just lost,
 *    so the loser gets the first touch
 *  - the ball leaves the paddle at an angle set by where it hit (edge hits
 *    go sharper), and gets a little faster on every paddle hit
 *  - paddle is faster than the ball, as in the cabinet
 *
 * The physics core (PongCore) is pure — no DOM, no audio — so it runs under
 * plain Node in test/pong.js and in the browser.
 */
'use strict';

const PongCore = (() => {
  // ---- dimensions & physics -------------------------------------------
  const W = 800;
  const H = 600;
  const PADDLE_W = 10;
  const PADDLE_H = 80;
  const PADDLE_MARGIN = 28;           // paddle face inset from the screen edge
  const BALL_SIZE = 10;
  const BASE_SPEED = 340;             // serve speed, px/s
  const SPEED_GAIN = 1.06;            // per paddle hit, like the cabinet
  const MAX_SPEED = 640;
  const MAX_BOUNCE = (58 * Math.PI) / 180; // max angle off the vertical axis
  const HUMAN_SPEED = 560;            // human paddle is faster than the ball
  const WIN_SCORE = 11;
  const SERVE_ANGLE = (35 * Math.PI) / 180;

  // CPU difficulty — max paddle speed (px/s), aim error (px). Level 1 is the
  // 1972 single-player CPU: a slow paddle that tracks imperfectly.
  const AI = [
    { maxSpeed: 280, error: 24 },
    { maxSpeed: 380, error: 14 },
    { maxSpeed: 480, error: 7 },
    { maxSpeed: 580, error: 3 },
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function paddleX(side) {
    return side === 0 ? PADDLE_MARGIN : W - PADDLE_MARGIN - PADDLE_W;
  }

  // ---- state ----------------------------------------------------------
  function createState(playerSide) {
    return {
      w: W,
      h: H,
      playerSide: playerSide,          // 0 = left, 1 = right
      paddle: [
        { y: (H - PADDLE_H) / 2, score: 0 },
        { y: (H - PADDLE_H) / 2, score: 0 },
      ],
      ball: { x: 0, y: 0, vx: 0, vy: 0, speed: 0 },
      serveDir: 1,                     // 1 = ball travels toward the right paddle
      winner: null,                   // side number that reached 11, or null
      aiError: 0,                     // per-rally aim error for the CPU
    };
  }

  // Place the ball at centre and give it velocity toward `side` (0 or 1).
  // The random angle only varies the steepness; the horizontal direction is
  // always toward `side`, and the total speed is exactly BASE_SPEED.
  function serve(state, side, rnd) {
    rnd = rnd || Math.random;
    const dirSign = side === 1 ? 1 : -1;
    const a = rnd() * SERVE_ANGLE; // 0..SERVE_ANGLE, positive
    state.serveDir = side;
    state.ball.x = (W - BALL_SIZE) / 2;
    state.ball.y = (H - BALL_SIZE) / 2;
    state.ball.speed = BASE_SPEED;
    state.ball.vx = Math.sin(a) * BASE_SPEED * dirSign;
    state.ball.vy = Math.cos(a) * BASE_SPEED * (rnd() < 0.5 ? 1 : -1);
  }

  // Reset scores; the CPU side gets the opening serve (ball to the CPU, so
  // the human returns it first — the human "serves" by hitting it back).
  function newGame(state, playerSide) {
    state.paddle[0].score = 0;
    state.paddle[1].score = 0;
    state.paddle[0].y = (H - PADDLE_H) / 2;
    state.paddle[1].y = (H - PADDLE_H) / 2;
    state.playerSide = playerSide;
    state.winner = null;
    serve(state, playerSide === 0 ? 1 : 0);
  }

  // ---- one simulation step ---------------------------------------------
  // humanTargetY: where the human wants their paddle's top to be.
  // Returns the list of events that happened this step:
  //   { type: 'wall' } | { type: 'paddle', side } |
  //   { type: 'point', scorer } | { type: 'game', winner }
  function step(state, dt, humanTargetY, aiLevel, rnd) {
    rnd = rnd || Math.random;
    const events = [];
    const cpuSide = state.playerSide === 0 ? 1 : 0;
    const b = state.ball;

    // -- paddles move to their targets ------------------------------------
    const human = state.paddle[state.playerSide];
    const hTarget = clamp(humanTargetY, 0, H - PADDLE_H);
    const hdy = hTarget - human.y;
    const hMax = HUMAN_SPEED * dt;
    human.y = Math.abs(hdy) <= hMax ? hTarget : human.y + Math.sign(hdy) * hMax;
    human.y = clamp(human.y, 0, H - PADDLE_H);

    // CPU: track the ball's predicted crossing y when it's coming, else drift
    // home to centre. The aim error is re-rolled once per rally segment.
    const cpu = state.paddle[cpuSide];
    const ai = AI[clamp(aiLevel, 0, AI.length - 1)];
    let aim = (H - PADDLE_H) / 2;
    const comingToCpu = cpuSide === 1 ? b.vx > 0 : b.vx < 0;
    if (b.vx !== 0 && comingToCpu) {
      const face = cpuSide === 1 ? paddleX(1) : W - PADDLE_MARGIN;
      const t = Math.max(0, (face - (b.x + BALL_SIZE)) / Math.max(Math.abs(b.vx), 0.001));
      let by = b.y + b.vy * t;
      const range = H - BALL_SIZE;
      const period = 2 * range;
      let m = ((by % period) + period) % period;   // mirror-fold = wall bounces
      let py = m <= range ? m : period - m;
      aim = py + (BALL_SIZE - PADDLE_H) / 2 + state.aiError;
    }
    aim = clamp(aim, 0, H - PADDLE_H);
    const cdy = aim - cpu.y;
    const cMax = ai.maxSpeed * dt;
    cpu.y = Math.abs(cdy) <= cMax ? aim : cpu.y + Math.sign(cdy) * cMax;
    cpu.y = clamp(cpu.y, 0, H - PADDLE_H);

    // -- ball -------------------------------------------------------------
    const px = b.x;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // top / bottom walls
    if (b.y <= 0) { b.y = 0; b.vy = Math.abs(b.vy); events.push({ type: 'wall' }); }
    else if (b.y >= H - BALL_SIZE) {
      b.y = H - BALL_SIZE; b.vy = -Math.abs(b.vy); events.push({ type: 'wall' });
    }

    // paddles: the ball only meets the paddle it is heading for. We test the
    // step in which the ball's leading edge crosses the paddle face, so even a
    // fast ball can't tunnel through a thin paddle.
    if (b.vx !== 0) {
      const heading = b.vx < 0 ? 0 : 1;
      const p = state.paddle[heading];
      let face, before, now;
      if (heading === 0) { // moving left into the left paddle's right face
        face = paddleX(0) + PADDLE_W;
        before = px > face;
        now = b.x <= face;
      } else { // moving right into the right paddle's left face
        face = paddleX(1);
        before = px + BALL_SIZE < face;
        now = b.x + BALL_SIZE >= face;
      }
      const withinY = b.y + BALL_SIZE >= p.y - 4 && b.y <= p.y + PADDLE_H + 4;
      if (before && now && withinY) {
        const speed = Math.min(b.speed * SPEED_GAIN, MAX_SPEED);
        b.speed = speed;
        // Bounce angle from the horizontal: a centred hit returns the ball
        // straight back (max horizontal), an edge hit sends it steep. Measuring
        // from horizontal guarantees a horizontal component, so the ball can
        // never be sent dead-up-and-down and stuck between the walls.
        const e = clamp((b.y + BALL_SIZE / 2 - (p.y + PADDLE_H / 2)) / (PADDLE_H / 2), -1, 1);
        const angle = e * MAX_BOUNCE;
        const vySign = b.vy === 0 ? (rnd() < 0.5 ? 1 : -1) : Math.sign(b.vy);
        b.vx = Math.cos(angle) * speed * (heading === 0 ? 1 : -1);
        b.vy = Math.sin(angle) * speed * vySign;
        // seat the ball on the face so it can't stick or tunnel
        b.x = heading === 0 ? face : face - BALL_SIZE;
        state.aiError = (rnd() * 2 - 1) * ai.error;
        events.push({ type: 'paddle', side: heading });
      }
    }

    // out of bounds: the opposite side scores
    if (b.x + BALL_SIZE < -24) {
      events.push({ type: 'point', scorer: 1 });
      afterPoint(state, 1);
    } else if (b.x > W + 24) {
      events.push({ type: 'point', scorer: 0 });
      afterPoint(state, 0);
    }
    return events;
  }

  function afterPoint(state, scorer) {
    state.paddle[scorer].score += 1;
    if (state.paddle[scorer].score >= WIN_SCORE) state.winner = scorer;
    // the loser serves: the ball goes toward them
    serve(state, scorer === 0 ? 1 : 0);
  }

  return {
    W, H, PADDLE_W, PADDLE_H, PADDLE_MARGIN, BALL_SIZE,
    BASE_SPEED, SPEED_GAIN, MAX_SPEED, MAX_BOUNCE, HUMAN_SPEED, WIN_SCORE,
    AI, createState, serve, newGame, step, paddleX,
  };
})();

/* Browser wrapper: canvas rendering, input, audio, app flow. */
(function () {
  if (!globalThis.document) return; // under Node: core only

  const canvas = document.getElementById('game');
  // desynchronized: ask the GPU for a low-latency back buffer (helps on mobile)
  const ctx = canvas.getContext('2d', { desynchronized: true });
  ctx.imageSmoothingEnabled = false;

  // ---- block digits, the look of the cabinet --------------------------
  const FONT = {
    '0': ['1111', '1001', '1001', '1001', '1111'],
    '1': ['0110', '0110', '0110', '0110', '0110'],
    '2': ['1111', '0001', '0111', '1000', '1111'],
    '3': ['1111', '0001', '0111', '0001', '1111'],
    '4': ['1001', '1001', '1111', '0001', '0001'],
    '5': ['1111', '1000', '0111', '0001', '1111'],
    '6': ['1111', '1000', '0111', '1001', '1111'],
    '7': ['1111', '0001', '0010', '0100', '1000'],
    '8': ['1111', '1001', '0111', '1001', '1111'],
    '9': ['1111', '1001', '0111', '0001', '1111'],
    'P': ['1111', '1001', '1111', '1000', '1000'],
    'O': ['1111', '1001', '1001', '1001', '1111'],
    'N': ['1001', '1101', '1011', '1001', '1001'],
    'G': ['1111', '1001', '1000', '1011', '1111'],
    'W': ['10001', '10001', '10101', '10101', '01010'],
    'E': ['1111', '1000', '1111', '1000', '1111'],
    'S': ['1111', '1000', '0111', '0001', '1111'],
    'T': ['1111', '0110', '0110', '0110', '0110'],
    'A': ['1111', '1001', '1111', '1001', '1001'],
    'R': ['1111', '1001', '1111', '1000', '1000'],
    'L': ['1000', '1000', '1000', '1000', '1111'],
    'M': ['10001', '11011', '10101', '10001', '10001'],
    'I': ['1110', '0110', '0110', '0110', '1110'],
    'U': ['1001', '1001', '1001', '1001', '1111'],
    'D': ['1111', '1001', '1001', '1001', '1111'],
    'K': ['1001', '1010', '1100', '1010', '1001'],
    ' ': ['0000', '0000', '0000', '0000', '0000'],
    // full A-Z so any word renders (B,C,F,H,J,Q,V,X,Y,Z were missing, which
    // turned "SPACE" into "SPA E" and would break "TAP NEXT GAME").
    'B': ['1111', '1001', '1110', '1001', '1111'],
    'C': ['1111', '1000', '1000', '1000', '1111'],
    'F': ['1111', '1000', '1111', '1000', '1000'],
    'H': ['1001', '1001', '1111', '1001', '1001'],
    'J': ['0111', '0010', '0010', '0010', '1110'],
    'Q': ['1111', '1001', '1001', '1101', '0010'],
    'V': ['1001', '1001', '1001', '1001', '0110'],
    'X': ['1001', '0110', '0110', '0110', '1001'],
    'Y': ['1001', '1001', '0110', '0010', '0010'],
    'Z': ['1111', '0001', '0011', '0100', '1111'],
    '<': ['0001', '0010', '0100', '0010', '0001'],
    '>': ['1000', '0100', '0010', '0100', '1000'],
  };

  function drawText(text, cx, top, px, color) {
    text = String(text).toUpperCase();
    let width = 0;
    const cols = text.split('').map((ch) => (FONT[ch] ? FONT[ch][0].length : 4));
    cols.forEach((c, i) => { width += c * px + (i < cols.length - 1 ? 2 * px : 0); });
    let x = cx - width / 2;
    ctx.fillStyle = color;
    for (let i = 0; i < text.length; i++) {
      const glyph = FONT[text[i]] || FONT[' '];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < glyph[r].length; c++) {
          if (glyph[r][c] === '1') {
            ctx.fillRect(Math.round(x + c * px), Math.round(top + r * px),
                         Math.ceil(px * 0.92), Math.ceil(px * 0.92));
          }
        }
      }
      x += cols[i] * px + 2 * px;
    }
  }

  // ---- audio: square-wave beeps, as in the cabinet ----------------------
  const audio = (() => {
    let actx = null;
    let on = true;
    try { on = localStorage.getItem('pong.sound') !== 'off'; } catch (e) {}
    function ensure() {
      if (!actx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (AC) actx = new AC();
      }
      if (actx && actx.state === 'suspended') actx.resume();
      return actx;
    }
    function beep(freq, dur, gain) {
      if (!on) return;
      const ac = ensure();
      if (!ac) return;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const t0 = ac.currentTime;
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    }
    return {
      paddle: () => beep(220, 0.09, 0.25),
      wall: () => beep(330, 0.07, 0.22),
      point: () => beep(110, 0.28, 0.3),
      toggle: () => {
        on = !on;
        try { localStorage.setItem('pong.sound', on ? 'on' : 'off'); } catch (e) {}
        return on;
      },
      isOn: () => on,
      unlock: ensure,
    };
  })();

  // ---- app state --------------------------------------------------------
  const DIFF = ['EASY', 'NORMAL', 'HARD', 'EXPERT'];
  const app = {
    screen: 'title',        // title | serve | play | point | game | paused
    aiLevel: 1,             // index into AI; 1 = the original single-player
    humanSide: 0,
    serveTimer: 0,
    pointTimer: 0,
    humanTargetY: (PongCore.H - PongCore.PADDLE_H) / 2,
    state: PongCore.createState(0),
  };
  // Read-only test hook: let a headless test watch the live app state without
  // reaching into the render loop.
  globalThis.__pong = { get app() { return app; } };

  function startGame() {
    app.state = PongCore.createState(app.humanSide);
    PongCore.newGame(app.state, app.humanSide);
    app.screen = 'serve';
    app.serveTimer = 0.8;
  }

  function nextGame() {
    // sides swap, scores reset — as in the cabinet
    app.humanSide = app.humanSide === 0 ? 1 : 0;
    app.state = PongCore.createState(app.humanSide);
    PongCore.newGame(app.state, app.humanSide);
    app.screen = 'serve';
    app.serveTimer = 0.8;
  }

  // ---- input ------------------------------------------------------------
  const keys = new Set();
  document.addEventListener('keydown', (ev) => {
    if (['ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyS', 'KeyP', 'KeyM', 'Enter'].includes(ev.code)) {
      ev.preventDefault();
    }
    audio.unlock();
    if (ev.repeat) { keys.add(ev.code); return; }
    keys.add(ev.code);
    if (ev.code === 'Space' || ev.code === 'Enter') {
      if (app.screen === 'title') startGame();
      else if (app.screen === 'game') nextGame();
      else if (app.screen === 'paused') app.screen = 'play';
    }
    if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') {
      if (app.screen === 'title') app.aiLevel = (app.aiLevel + 3) % 4;
    }
    if (ev.code === 'ArrowRight' || ev.code === 'KeyD') {
      if (app.screen === 'title') app.aiLevel = (app.aiLevel + 1) % 4;
    }
    if (ev.code === 'KeyP' && (app.screen === 'play' || app.screen === 'paused')) {
      app.screen = app.screen === 'play' ? 'paused' : 'play';
    }
    if (ev.code === 'KeyM') audio.toggle();
  });
  document.addEventListener('keyup', (ev) => keys.delete(ev.code));

  // ---- touch & mouse: drag to steer, quick tap to advance ----------------
  // Steering: while a finger/mouse is down, the paddle tracks the pointer 1:1
  // (no speed cap, so touch never lags behind the finger). A quick, still
  // press is a TAP: it advances the flow (title→serve, game→next,
  // play↔pause), so the whole game is playable without a keyboard.
  function pointerY(clientY) {
    const rect = syncRect();
    return ((clientY - rect.top) / rect.height) * PongCore.H - PongCore.PADDLE_H / 2;
  }
  // Cache the canvas rect instead of calling getBoundingClientRect() on
  // every touchmove: the layout read is what made touch steering stutter
  // on phones. It only changes on resize/rotate, so refresh it there.
  let cachedRect = null;
  function syncRect() {
    if (!cachedRect) cachedRect = canvas.getBoundingClientRect();
    return cachedRect;
  }
  window.addEventListener('resize', () => { cachedRect = null; });
  window.addEventListener('orientationchange', () => { cachedRect = null; });
  let dragging = false;
  let pressAt = null;   // { x, y, t } of the current press, for tap detection

  function advance() {
    audio.unlock();
    if (app.screen === 'title') startGame();
    else if (app.screen === 'game') nextGame();
    else if (app.screen === 'play') app.screen = 'paused';
    else if (app.screen === 'paused') app.screen = 'play';
  }

  function pressStart(clientX, clientY) {
    dragging = true;
    pressAt = { x: clientX, y: clientY, t: performance.now() };
    // On the title screen the left/right thirds of the screen change
    // difficulty, so the game is fully playable without a keyboard.
    if (app.screen === 'title') {
      const rect = syncRect();
      const rel = (clientX - rect.left) / rect.width;
      if (rel < 0.25) {
        app.aiLevel = (app.aiLevel + 3) % 4;
        pressAt.consumed = true;
        return;
      }
      if (rel > 0.75) {
        app.aiLevel = (app.aiLevel + 1) % 4;
        pressAt.consumed = true;
        return;
      }
    }
    app.humanTargetY = pointerY(clientY);
  }
  function pressMove(clientY) {
    if (dragging) app.humanTargetY = pointerY(clientY);
  }
  function pressEnd(clientX, clientY) {
    dragging = false;
    const p = pressAt;
    pressAt = null;
    if (!p || p.consumed) return;
    const still = performance.now() - p.t < 300 &&
      Math.hypot(clientX - p.x, clientY - p.y) < 12;
    if (still) advance();
  }

  canvas.addEventListener('touchstart', (ev) => {
    ev.preventDefault();
    audio.unlock();
    const t = ev.touches[0];
    pressStart(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', (ev) => {
    ev.preventDefault();
    pressMove(ev.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', (ev) => {
    ev.preventDefault();
    const t = ev.changedTouches[0];
    pressEnd(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchcancel', (ev) => {
    const t = ev.changedTouches[0];
    pressEnd(t.clientX, t.clientY);
  });
  canvas.addEventListener('mousedown', (ev) => {
    audio.unlock();
    pressStart(ev.clientX, ev.clientY);
  });
  window.addEventListener('mousemove', (ev) => pressMove(ev.clientY));
  window.addEventListener('mouseup', (ev) => pressEnd(ev.clientX, ev.clientY));

  // ---- render -----------------------------------------------------------
  function render() {
    const s = app.state;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PongCore.W, PongCore.H);
    ctx.fillStyle = '#fff';

    // centre dashed line, 8 dashes like the original
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(PongCore.W / 2 - 4, 40 * i + 40, 8, 40);
    }

    // paddles
    for (const side of [0, 1]) {
      const p = s.paddle[side];
      ctx.fillRect(PongCore.paddleX(side), Math.round(p.y), PongCore.PADDLE_W, PongCore.PADDLE_H);
    }

    // ball (hidden during the serve delay so it appears, like the original)
    if (app.screen !== 'serve' || app.serveTimer <= 0) {
      ctx.fillRect(Math.round(s.ball.x), Math.round(s.ball.y), PongCore.BALL_SIZE, PongCore.BALL_SIZE);
    }

    // scores: block digits above the centre line
    drawText(String(s.paddle[0].score), PongCore.W / 2 - 56, 40, 9, '#fff');
    drawText(String(s.paddle[1].score), PongCore.W / 2 + 56, 40, 9, '#fff');

    // ---- overlays ------------------------------------------------------
    if (app.screen === 'title') {
      drawText('PONG', PongCore.W / 2, 150, 26, '#fff');
      drawText('FIRST TO 11 WINS', PongCore.W / 2, 270, 8, '#fff');
      drawText(DIFF[app.aiLevel], PongCore.W / 2, 330, 12, '#fff');
      drawText('<', 120, 332, 10, '#fff');
      drawText('>', 680, 332, 10, '#fff');
      drawText('TAP SIDE TO CHANGE', PongCore.W / 2, 390, 6, '#fff');
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        drawText('TAP TO START', PongCore.W / 2, 450, 9, '#fff');
      }
      drawText(audio.isOn() ? 'SOUND ON' : 'SOUND OFF', PongCore.W / 2, 510, 5, '#fff');
    } else if (app.screen === 'paused') {
      drawText('PAUSED', PongCore.W / 2, 260, 14, '#fff');
      drawText('TAP TO RESUME', PongCore.W / 2, 340, 7, '#fff');
    } else if (app.screen === 'game') {
      const humanWon = s.winner === app.humanSide;
      drawText(humanWon ? 'YOU WIN' : 'CPU WINS', PongCore.W / 2, 220, 18, '#fff');
      drawText('SIDE SWAPS', PongCore.W / 2, 330, 8, '#fff');
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        drawText('TAP NEXT GAME', PongCore.W / 2, 400, 8, '#fff');
      }
    } else if (app.screen === 'serve' && app.serveTimer > 0) {
      drawText('READY', PongCore.W / 2, 280, 9, '#fff');
    }
  }

  // ---- main loop --------------------------------------------------------
  // Fixed-timestep physics: the simulation always advances in 1/120 s slices
  // no matter how long a frame took, so the ball moves at constant velocity
  // on every screen — no choppy jumps when a frame hiccups (common on
  // phones). Rendering happens once per display frame.
  const PHYS_STEP = 1 / 120;
  const MAX_FRAME = 0.25;        // after a long hitch, don't simulate a minute
  let acc = 0;
  let last = performance.now();

  function physicsStep(dt) {
    if (app.screen === 'serve') {
      app.serveTimer -= dt;
      if (app.serveTimer <= 0) app.screen = 'play';
    } else if (app.screen === 'point') {
      app.pointTimer -= dt;
      if (app.pointTimer <= 0) {
        app.screen = 'serve';
        app.serveTimer = 0.7;
      }
    } else if (app.screen !== 'play') {
      return;
    }

    let ty = app.humanTargetY;
    if (app.screen === 'play' && !dragging) {
      if (keys.has('ArrowUp') || keys.has('KeyW')) ty = app.humanTargetY - PongCore.HUMAN_SPEED * dt;
      if (keys.has('ArrowDown') || keys.has('KeyS')) ty = app.humanTargetY + PongCore.HUMAN_SPEED * dt;
    }
    if (app.screen === 'play') {
      const events = PongCore.step(app.state, dt, ty, app.aiLevel);
      for (const ev of events) {
        if (ev.type === 'wall') audio.wall();
        else if (ev.type === 'paddle') audio.paddle();
        else if (ev.type === 'point') {
          audio.point();
          app.screen = app.state.winner !== null ? 'game' : 'point';
          if (app.screen === 'point') app.pointTimer = 0.9;
        }
      }
    }
    if (dragging) {
      // 1:1 finger/mouse follow: overwrite the speed-capped chase with the
      // exact pointer position, so touch steering never lags behind — even
      // during the serve countdown, when PongCore.step isn't running.
      const p = app.state.paddle[app.humanSide];
      p.y = Math.max(0, Math.min(PongCore.H - PongCore.PADDLE_H, ty));
    }
  }

  function frame(now) {
    // Clamp the frame delta: too big (a hitch) would simulate a minute of
    // play at once; negative (clock skew) would drain the accumulator.
    let frameTime = (now - last) / 1000;
    if (frameTime < 0) frameTime = 0;
    if (frameTime > MAX_FRAME) frameTime = MAX_FRAME;
    last = now;
    acc += frameTime;
    while (acc >= PHYS_STEP) {
      physicsStep(PHYS_STEP);
      acc -= PHYS_STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  // The clock reset on return from the background prevents a big jump after
  // the phone app-switches or the tab is hidden (rAF pauses while hidden).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { last = performance.now(); acc = 0; }
  });

  requestAnimationFrame((now) => { last = now; requestAnimationFrame(frame); });
})();

// Expose the core for tests (Node) and console poking.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PongCore;
}
globalThis.PongCore = PongCore;
