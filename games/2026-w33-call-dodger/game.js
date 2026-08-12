// Call Dodger — dodge falling spam calls; press Space/tap to hang up nearby ones
// Inspired by: France bans unsolicited telemarketing calls (BBC, Aug 2026)

kaboom({
  width: 480,
  height: 560,
  background: [17, 17, 34],
  canvas: (() => { const c = document.createElement("canvas"); document.body.appendChild(c); return c; })(),
});

// ─── constants ───────────────────────────────────────────────────────────────
const PLAYER_SPEED = 220;
const CALL_INTERVAL_START = 1.4;
const CALL_INTERVAL_MIN = 0.35;
const CALL_SPEED_START = 90;
const CALL_SPEED_MAX = 260;
const HANGUP_RADIUS = 80;
const HANGUP_COOLDOWN = 0.7;

// ─── color palette ───────────────────────────────────────────────────────────
const COLORS = [
  [255, 80, 80],
  [255, 160, 40],
  [80, 200, 255],
  [200, 80, 255],
  [80, 255, 160],
];

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// ─── draw helpers ─────────────────────────────────────────────────────────────
function makePhoneSprite(color) {
  // Draws a tiny phone handset using rect + circle
  const [r, g, b] = color;
  return {
    draw() {
      drawRect({ width: 28, height: 44, color: rgb(r, g, b), anchor: "center", radius: 6 });
      drawRect({ width: 18, height: 10, color: rgb(20, 20, 40), pos: vec2(0, -10), anchor: "center", radius: 3 });
      drawCircle({ radius: 5, color: rgb(20, 20, 40), pos: vec2(0, 12) });
    },
  };
}

// ─── scenes ──────────────────────────────────────────────────────────────────
scene("game", () => {
  let score = 0;
  let hangupTimer = 0;
  let spawnTimer = 0;
  let callInterval = CALL_INTERVAL_START;
  let callSpeed = CALL_SPEED_START;
  let elapsed = 0;

  // ── player ──────────────────────────────────────────────────────────────────
  const player = add([
    pos(width() / 2, height() - 60),
    anchor("center"),
    area({ shape: new Rect(vec2(-16, -22), 32, 44) }),
    {
      draw() {
        // Body: dark green phone
        drawRect({ width: 32, height: 50, color: rgb(40, 200, 120), anchor: "center", radius: 7 });
        drawRect({ width: 20, height: 12, color: rgb(20, 80, 50), pos: vec2(0, -12), anchor: "center", radius: 3 });
        drawCircle({ radius: 6, color: rgb(20, 80, 50), pos: vec2(0, 14) });
        // "no" indicator
        drawRect({ width: 26, height: 4, color: rgb(255, 60, 60), pos: vec2(0, 0), anchor: "center", radius: 2 });
      },
      update() {
        let dx = 0;
        if (isKeyDown("left") || isKeyDown("a")) dx = -1;
        if (isKeyDown("right") || isKeyDown("d")) dx = 1;
        this.move(dx * PLAYER_SPEED, 0);
        this.pos.x = Math.max(20, Math.min(width() - 20, this.pos.x));
      },
    },
    "player",
  ]);

  // ── score / ui ──────────────────────────────────────────────────────────────
  const scoreLbl = add([
    text("0", { size: 22, font: "monospace" }),
    pos(12, 8),
    color(255, 255, 255),
    fixed(),
    "scoreLabel",
  ]);

  add([
    text("SCORE", { size: 11, font: "monospace" }),
    pos(12, 32),
    color(160, 160, 160),
    fixed(),
  ]);

  // Hangup indicator
  const hangupLbl = add([
    text("📵 READY", { size: 13, font: "monospace" }),
    pos(width() - 10, 8),
    anchor("topright"),
    color(80, 255, 160),
    fixed(),
    "hangupLabel",
  ]);

  // ── spawn calls ─────────────────────────────────────────────────────────────
  function spawnCall() {
    const color = randColor();
    const [r, g, b] = color;
    const x = rand(30, width() - 30);
    const spd = callSpeed + rand(-20, 20);

    add([
      pos(x, -30),
      anchor("center"),
      area({ shape: new Rect(vec2(-14, -22), 28, 44) }),
      move(DOWN, spd),
      {
        draw() {
          drawRect({ width: 28, height: 44, color: rgb(r, g, b), anchor: "center", radius: 6 });
          drawRect({ width: 18, height: 10, color: rgb(20, 20, 40), pos: vec2(0, -10), anchor: "center", radius: 3 });
          drawCircle({ radius: 5, color: rgb(20, 20, 40), pos: vec2(0, 12) });
          // vibration lines
          drawRect({ width: 6, height: 3, color: rgb(255, 255, 200), pos: vec2(-16, 0), anchor: "center", radius: 1 });
          drawRect({ width: 6, height: 3, color: rgb(255, 255, 200), pos: vec2(16, 0), anchor: "center", radius: 1 });
        },
      },
      offscreen({ destroy: true }),
      "call",
    ]);
  }

  // ── hangup action ────────────────────────────────────────────────────────────
  function doHangup() {
    if (hangupTimer > 0) return;
    hangupTimer = HANGUP_COOLDOWN;

    // destroy nearby calls and score them
    let popped = 0;
    for (const c of get("call")) {
      if (c.pos.dist(player.pos) <= HANGUP_RADIUS) {
        // flash ring
        add([
          pos(c.pos),
          anchor("center"),
          lifespan(0.25, { fade: 0.25 }),
          {
            draw() {
              drawCircle({ radius: HANGUP_RADIUS * 0.5, color: rgb(255, 255, 80), opacity: 0.35 });
            },
          },
        ]);
        destroy(c);
        popped++;
      }
    }
    score += popped * 5;
    scoreLbl.text = String(score);
  }

  onKeyPress("space", doHangup);

  // Touch / click hangup
  onMousePress(() => {
    // move player to tap x then hangup
    player.pos.x = Math.max(20, Math.min(width() - 20, mousePos().x));
    doHangup();
  });

  // ── collision: call hits player → game over ──────────────────────────────────
  player.onCollide("call", () => {
    go("gameover", score);
  });

  // ── main update ──────────────────────────────────────────────────────────────
  onUpdate(() => {
    elapsed += dt();

    // Ramp difficulty
    const ramp = Math.min(elapsed / 40, 1);
    callInterval = CALL_INTERVAL_START - ramp * (CALL_INTERVAL_START - CALL_INTERVAL_MIN);
    callSpeed = CALL_SPEED_START + ramp * (CALL_SPEED_MAX - CALL_SPEED_START);

    // Spawn timer
    spawnTimer -= dt();
    if (spawnTimer <= 0) {
      spawnCall();
      spawnTimer = callInterval * (0.7 + Math.random() * 0.6);
    }

    // Score +1 per second survived
    score += dt();
    scoreLbl.text = String(Math.floor(score));

    // Hangup cooldown
    if (hangupTimer > 0) {
      hangupTimer -= dt();
      hangupLbl.text = "📵 " + (hangupTimer > 0 ? Math.ceil(hangupTimer * 10) / 10 + "s" : "READY");
      hangupLbl.color = hangupTimer > 0 ? rgb(200, 100, 100) : rgb(80, 255, 160);
    }

    // Destroy calls that fall off bottom (missed — no penalty)
    for (const c of get("call")) {
      if (c.pos.y > height() + 40) destroy(c);
    }
  });
});

// ─── game over scene ──────────────────────────────────────────────────────────
scene("gameover", (score) => {
  add([
    text("CALL DODGER", { size: 32, font: "monospace" }),
    pos(width() / 2, 140),
    anchor("center"),
    color(255, 255, 80),
  ]);

  add([
    text("GAME OVER", { size: 24, font: "monospace" }),
    pos(width() / 2, 210),
    anchor("center"),
    color(255, 80, 80),
  ]);

  add([
    text("Score: " + Math.floor(score), { size: 20, font: "monospace" }),
    pos(width() / 2, 270),
    anchor("center"),
    color(255, 255, 255),
  ]);

  add([
    text("Press SPACE or tap to retry", { size: 14, font: "monospace" }),
    pos(width() / 2, 340),
    anchor("center"),
    color(160, 160, 160),
  ]);

  onKeyPress("space", () => go("game"));
  onMousePress(() => go("game"));
});

// ─── title scene ─────────────────────────────────────────────────────────────
scene("title", () => {
  add([
    text("📵 CALL DODGER", { size: 28, font: "monospace" }),
    pos(width() / 2, 160),
    anchor("center"),
    color(255, 255, 80),
  ]);

  add([
    text("Dodge falling spam calls.\nHang up nearby ones with SPACE.", { size: 14, font: "monospace" }),
    pos(width() / 2, 250),
    anchor("center"),
    color(200, 200, 200),
  ]);

  add([
    text("← → / A D to move", { size: 13, font: "monospace" }),
    pos(width() / 2, 320),
    anchor("center"),
    color(160, 160, 255),
  ]);

  add([
    text("Press SPACE or tap to start", { size: 14, font: "monospace" }),
    pos(width() / 2, 400),
    anchor("center"),
    color(80, 255, 160),
  ]);

  onKeyPress("space", () => go("game"));
  onMousePress(() => go("game"));
});

go("title");
