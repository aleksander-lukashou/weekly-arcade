// Teleblock — block spam calls before they reach your phone!
// France bans unsolicited telemarketing calls (BBC, 2026)

kaboom({
  background: [17, 17, 17],
  canvas: document.querySelector("canvas") || (() => {
    const c = document.createElement("canvas");
    document.getElementById("gameContainer").appendChild(c);
    return c;
  })(),
  stretch: true,
  letterbox: false,
});

const PHONE_Y_FRAC = 0.12;
const SPAWN_INTERVAL_START = 1.4;
const SPAWN_INTERVAL_MIN = 0.45;
const CALL_SPEED_START = 80;
const CALL_SPEED_MAX = 220;
const LIVES = 3;

// Spam call labels
const LABELS = [
  "FREE CRUISE!",
  "CAR WARRANTY",
  "IRS ALERT",
  "PRIZE WINNER",
  "BANK ALERT",
  "CLAIM NOW!",
  "ROBO CALL",
  "SPAM #1",
  "UNKNOWN",
  "TOLL FREE",
  "DEAL ALERT",
  "DISCOUNT!",
];

function randomLabel() {
  return LABELS[Math.floor(Math.random() * LABELS.length)];
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(t, 1);
}

// ── scenes ──────────────────────────────────────────────────────────────────

scene("game", () => {
  let score = 0;
  let lives = LIVES;
  let elapsed = 0;
  let spawnTimer = 0;
  let gameOver = false;

  const W = width();
  const H = height();
  const phoneY = H * PHONE_Y_FRAC;

  // Draw static phone at top center
  function drawPhone() {
    const pw = 54, ph = 90;
    const px = W / 2 - pw / 2;
    const py = phoneY - ph / 2;
    drawRect({ pos: vec2(px, py), width: pw, height: ph, color: rgb(60, 60, 80), radius: 8 });
    drawRect({ pos: vec2(px + 10, py + 8), width: pw - 20, height: ph - 24, color: rgb(30, 200, 255), radius: 3 });
    drawCircle({ pos: vec2(W / 2, py + ph - 9), radius: 5, color: rgb(120, 120, 150) });
  }

  // Score and lives UI
  const scoreLbl = add([
    text("BLOCKED: 0", { size: 20 }),
    pos(10, 8),
    fixed(),
    color(0, 255, 120),
    { value: 0 },
  ]);

  const livesLbl = add([
    text("❤️ ❤️ ❤️", { size: 18 }),
    pos(W - 10, 8),
    anchor("topright"),
    fixed(),
  ]);

  function updateLivesLabel() {
    const hearts = Array(lives).fill("❤").join(" ");
    const empty  = Array(LIVES - lives).fill("🖤").join(" ");
    livesLbl.text = hearts + (empty ? " " + empty : "");
  }

  function getSpawnInterval() {
    return Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - elapsed * 0.015);
  }

  function getCallSpeed() {
    return Math.min(CALL_SPEED_MAX, CALL_SPEED_START + elapsed * 1.5);
  }

  function spawnCall() {
    const margin = 40;
    const x = margin + Math.random() * (W - margin * 2);
    const label = randomLabel();
    // Color cycles: red-orange tones
    const hue = Math.floor(Math.random() * 40);
    const col = hslToRgb(hue / 360, 0.85, 0.55);

    const call = add([
      rect(90, 36),
      pos(x, H + 20),
      anchor("center"),
      color(col[0], col[1], col[2]),
      area(),
      "call",
      { label, speed: getCallSpeed(), blocked: false },
    ]);

    // Label text child
    add([
      text(label, { size: 11, width: 84, align: "center" }),
      pos(0, 0),
      anchor("center"),
      color(255, 255, 255),
      follow(call),
      "calltext",
    ]);

    // Phone icon on call bubble
    add([
      text("📞", { size: 14 }),
      pos(0, -2),
      anchor("center"),
      follow(call, vec2(0, -13)),
      "calltext",
    ]);
  }

  // Click / tap to block
  function tryBlock(px, py) {
    if (gameOver) return;
    const calls = get("call");
    for (const c of calls) {
      if (c.blocked) continue;
      const dx = Math.abs(c.pos.x - px);
      const dy = Math.abs(c.pos.y - py);
      if (dx < 50 && dy < 22) {
        blockCall(c);
        return;
      }
    }
  }

  function blockCall(c) {
    c.blocked = true;
    score++;
    scoreLbl.text = "BLOCKED: " + score;

    // Burst effect
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const particle = add([
        rect(8, 8),
        pos(c.pos.x, c.pos.y),
        color(0, 255, 120),
        lifespan(0.4, { fade: true }),
        move(vec2(Math.cos(angle) * 120, Math.sin(angle) * 120)),
        "particle",
      ]);
    }

    // "BLOCKED!" popup
    const popup = add([
      text("BLOCKED!", { size: 16 }),
      pos(c.pos.x, c.pos.y - 20),
      anchor("center"),
      color(0, 255, 120),
      lifespan(0.5, { fade: true }),
      move(vec2(0, -60)),
    ]);

    destroy(c);
    // Destroy associated text
    const texts = get("calltext");
    for (const t of texts) {
      // follow targets are already destroyed; kaboom cleans orphans but let's help
      if (!t.exists || !t.follows || !t.follows.exists) {
        // They'll be cleaned next frame; skip
      }
    }
  }

  // Keyboard: space blocks the closest call to center
  onKeyPress("space", () => {
    if (gameOver) return;
    const calls = get("call").filter(c => !c.blocked);
    if (!calls.length) return;
    let closest = null;
    let closestDist = Infinity;
    for (const c of calls) {
      const d = Math.abs(c.pos.x - W / 2) + Math.abs(c.pos.y - H / 2);
      if (d < closestDist) { closestDist = d; closest = c; }
    }
    if (closest) blockCall(closest);
  });

  // Arrow keys: aim a cursor and block on space
  // Simpler: left/right moves a "blocker beam" x; space fires
  let beamX = W / 2;
  const BEAM_SPEED = 300;
  onKeyDown("left",  () => { if (!gameOver) beamX = Math.max(30, beamX - BEAM_SPEED * dt()); });
  onKeyDown("right", () => { if (!gameOver) beamX = Math.min(W - 30, beamX + BEAM_SPEED * dt()); });
  onKeyPress("space", () => {
    if (gameOver) return;
    // Block call closest to beamX
    const calls = get("call").filter(c => !c.blocked);
    let closest = null;
    let closestDist = Infinity;
    for (const c of calls) {
      const d = Math.abs(c.pos.x - beamX);
      if (d < closestDist) { closestDist = d; closest = c; }
    }
    if (closest && closestDist < 80) blockCall(closest);
  });

  onClick(() => {
    const mp = mousePos();
    tryBlock(mp.x, mp.y);
  });

  onTouchStart((touches) => {
    for (const t of touches) {
      tryBlock(t.pos.x, t.pos.y);
    }
  });

  // Game loop
  onDraw(() => {
    drawPhone();

    // Draw beam cursor
    if (!gameOver) {
      drawLine({
        p1: vec2(beamX, phoneY + 48),
        p2: vec2(beamX, H),
        width: 1,
        color: rgb(0, 255, 120),
        opacity: 0.25,
      });
      drawCircle({ pos: vec2(beamX, H - 20), radius: 8, color: rgb(0, 255, 120), opacity: 0.5 });
    }
  });

  onUpdate(() => {
    if (gameOver) return;
    elapsed += dt();
    spawnTimer += dt();
    if (spawnTimer >= getSpawnInterval()) {
      spawnTimer = 0;
      spawnCall();
    }

    const calls = get("call");
    for (const c of calls) {
      if (c.blocked) continue;
      c.pos.y -= c.speed * dt();
      if (c.pos.y < phoneY + 20) {
        // Reached phone
        destroy(c);
        lives--;
        updateLivesLabel();
        // Flash screen red
        const flash = add([
          rect(W, H),
          pos(0, 0),
          color(255, 0, 0),
          opacity(0.4),
          lifespan(0.3, { fade: true }),
          fixed(),
          z(100),
        ]);
        if (lives <= 0) {
          gameOver = true;
          wait(0.5, () => go("gameover", score));
        }
      }
    }
  });

  updateLivesLabel();
});

scene("gameover", (score) => {
  const W = width();
  const H = height();

  add([
    text("GAME OVER", { size: 48 }),
    pos(W / 2, H / 2 - 80),
    anchor("center"),
    color(255, 80, 80),
  ]);
  add([
    text("Calls blocked: " + score, { size: 28 }),
    pos(W / 2, H / 2 - 20),
    anchor("center"),
    color(255, 255, 255),
  ]);

  let medal = score >= 30 ? "🥇 Expert Regulator!" : score >= 15 ? "🥈 Deputy Inspector" : "🥉 Trainee Blocker";
  add([
    text(medal, { size: 22 }),
    pos(W / 2, H / 2 + 30),
    anchor("center"),
    color(255, 220, 80),
  ]);

  add([
    text("Click / tap / SPACE to play again", { size: 18 }),
    pos(W / 2, H / 2 + 90),
    anchor("center"),
    color(180, 180, 180),
  ]);

  function restart() { go("game"); }
  onClick(restart);
  onKeyPress("space", restart);
  onTouchStart(restart);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

go("game");
