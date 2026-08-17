// Bid Frenzy — catch falling bid tokens to auction the electric supercar for a record price!
// Inspired by: Ferrari's first electric car sold for record $40m (BBC, Aug 2026)

kaboom({
  width: 480,
  height: 560,
  background: [10, 10, 20],
  canvas: (() => { const c = document.createElement("canvas"); document.body.appendChild(c); return c; })(),
});

// ─── constants ───────────────────────────────────────────────────────────────
const TARGET_PRICE   = 40_000_000;
const BID_VALUE      = 500_000;
const DEBID_VALUE    = 1_000_000;
const PADDLE_W       = 90;
const PADDLE_H       = 14;
const PADDLE_Y       = 500;
const PADDLE_SPEED   = 320;
const TOKEN_SPEED_START = 100;
const TOKEN_SPEED_MAX   = 280;
const SPAWN_START    = 1.3;
const SPAWN_MIN      = 0.45;
const DEBID_CHANCE   = 0.28; // fraction of tokens that are "lowball" debids

// ─── colour palette ──────────────────────────────────────────────────────────
const COL_GOLD   = [255, 210, 50];
const COL_RED    = [220, 60, 60];
const COL_PADDLE = [200, 200, 255];
const COL_CAR    = [255, 50, 50];
const COL_BG2    = [20, 20, 40];
const COL_TEXT   = [255, 240, 200];

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  return "$" + (n / 1000).toFixed(0) + "K";
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ─── sprite definitions ──────────────────────────────────────────────────────
loadSpriteAtlas(null, {}); // keep kaboom happy; we draw everything manually

// ─── GAME SCENE ──────────────────────────────────────────────────────────────
scene("game", () => {
  let price     = 0;
  let gameOver  = false;
  let elapsed   = 0;
  let spawnTimer = 0;
  let spawnInterval = SPAWN_START;

  // ── draw static car silhouette ──
  function drawCar() {
    // body
    drawRect({ pos: vec2(160, 70), width: 160, height: 50, color: rgb(...COL_CAR), fixed: true });
    // roof
    drawRect({ pos: vec2(195, 40), width: 90, height: 35, color: rgb(230, 40, 40), fixed: true });
    // wheels
    drawCircle({ pos: vec2(195, 120), radius: 20, color: rgb(30, 30, 30), fixed: true });
    drawCircle({ pos: vec2(285, 120), radius: 20, color: rgb(30, 30, 30), fixed: true });
    drawCircle({ pos: vec2(195, 120), radius: 10, color: rgb(160, 160, 180), fixed: true });
    drawCircle({ pos: vec2(285, 120), radius: 10, color: rgb(160, 160, 180), fixed: true });
    // headlight
    drawRect({ pos: vec2(316, 80), width: 10, height: 8, color: rgb(255, 255, 180), fixed: true });
    // lightning bolt (electric)
    drawLine({
      p1: vec2(236, 52), p2: vec2(244, 66),
      width: 3, color: rgb(255, 230, 0), fixed: true,
    });
    drawLine({
      p1: vec2(244, 66), p2: vec2(238, 66),
      width: 3, color: rgb(255, 230, 0), fixed: true,
    });
    drawLine({
      p1: vec2(238, 66), p2: vec2(246, 82),
      width: 3, color: rgb(255, 230, 0), fixed: true,
    });
  }

  // ── paddle ──
  const paddle = add([
    rect(PADDLE_W, PADDLE_H, { radius: 4 }),
    pos(240 - PADDLE_W / 2, PADDLE_Y),
    color(rgb(...COL_PADDLE)),
    area(),
    "paddle",
  ]);

  // ── price bar background ──
  const BAR_X = 20, BAR_Y = 155, BAR_W = 440, BAR_H = 16;
  const barBg = add([
    rect(BAR_W, BAR_H, { radius: 3 }),
    pos(BAR_X, BAR_Y),
    color(rgb(40, 40, 60)),
    fixed(),
    z(5),
  ]);

  const barFill = add([
    rect(1, BAR_H, { radius: 3 }),
    pos(BAR_X, BAR_Y),
    color(rgb(...COL_GOLD)),
    fixed(),
    z(6),
  ]);

  // ── score label ──
  const priceLbl = add([
    text("$0", { size: 20 }),
    pos(240, 178),
    anchor("center"),
    color(rgb(...COL_TEXT)),
    fixed(),
    z(7),
  ]);

  const targetLbl = add([
    text("Target: " + fmtMoney(TARGET_PRICE), { size: 14 }),
    pos(240, 196),
    anchor("center"),
    color(rgb(160, 160, 200)),
    fixed(),
    z(7),
  ]);

  // ── tokens ──
  const tokens = [];

  function spawnToken() {
    const isDebid = Math.random() < DEBID_CHANCE;
    const x = rand(30, 450);
    const t = add([
      rect(36, 22, { radius: 5 }),
      pos(x, -30),
      color(isDebid ? rgb(...COL_RED) : rgb(...COL_GOLD)),
      area(),
      { isDebid, vel: lerp(TOKEN_SPEED_START, TOKEN_SPEED_MAX, Math.min(elapsed / 45, 1)) },
      "token",
    ]);
    // label
    const lbl = add([
      text(isDebid ? "-" + fmtMoney(DEBID_VALUE) : "+" + fmtMoney(BID_VALUE), { size: 10 }),
      pos(x + 18, -30 + 11),
      anchor("center"),
      color(rgb(10, 10, 10)),
      z(10),
      "tokenlbl",
    ]);
    lbl._parent = t;
    tokens.push({ body: t, lbl });
  }

  // ── on collision with paddle ──
  onCollide("token", "paddle", (token) => {
    if (token.isDebid) {
      price = Math.max(0, price - DEBID_VALUE);
    } else {
      price += BID_VALUE;
    }
    // pop effect
    const px = token.pos.x + 18;
    const py = token.pos.y + 11;
    const popup = add([
      text(token.isDebid ? "-" + fmtMoney(DEBID_VALUE) : "+" + fmtMoney(BID_VALUE), { size: 14 }),
      pos(px, py),
      color(token.isDebid ? rgb(...COL_RED) : rgb(80, 255, 120)),
      anchor("center"),
      lifespan(0.7, { fade: 0.4 }),
      move(vec2(0, -60)),
      z(20),
    ]);
    // remove token and label
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i].body === token) {
        tokens[i].lbl.destroy();
        tokens.splice(i, 1);
        break;
      }
    }
    token.destroy();

    if (price >= TARGET_PRICE) {
      go("win");
    }
  });

  // ── update loop ──
  onUpdate(() => {
    if (gameOver) return;
    elapsed += dt();

    // paddle movement
    if (isKeyDown("left") || isKeyDown("a")) {
      paddle.pos.x = Math.max(0, paddle.pos.x - PADDLE_SPEED * dt());
    }
    if (isKeyDown("right") || isKeyDown("d")) {
      paddle.pos.x = Math.min(480 - PADDLE_W, paddle.pos.x + PADDLE_SPEED * dt());
    }

    // spawn
    spawnTimer += dt();
    spawnInterval = Math.max(SPAWN_MIN, SPAWN_START - elapsed * 0.018);
    if (spawnTimer >= spawnInterval) {
      spawnToken();
      spawnTimer = 0;
    }

    // move tokens and labels
    for (let i = tokens.length - 1; i >= 0; i--) {
      const { body, lbl } = tokens[i];
      body.pos.y += body.vel * dt();
      lbl.pos.x = body.pos.x + 18;
      lbl.pos.y = body.pos.y + 11;

      if (body.pos.y > 560) {
        // missed bid: missed gold costs nothing; missed debid also does nothing
        lbl.destroy();
        body.destroy();
        tokens.splice(i, 1);
      }
    }

    // update bar
    const frac = Math.min(price / TARGET_PRICE, 1);
    barFill.width = Math.max(1, frac * BAR_W);

    // update label
    priceLbl.text = fmtMoney(price);
  });

  // ── draw (static elements) ──
  onDraw(() => {
    drawCar();
    // divider line
    drawLine({ p1: vec2(0, 210), p2: vec2(480, 210), width: 1, color: rgb(50, 50, 80) });
  });

  // ── touch/click: move paddle to tap X ──
  onMouseMove((p) => {
    paddle.pos.x = Math.max(0, Math.min(480 - PADDLE_W, p.x - PADDLE_W / 2));
  });
  onTouchMove((t) => {
    paddle.pos.x = Math.max(0, Math.min(480 - PADDLE_W, t.pos.x - PADDLE_W / 2));
  });
});

// ─── WIN SCENE ───────────────────────────────────────────────────────────────
scene("win", () => {
  add([rect(480, 560), pos(0, 0), color(rgb(10, 10, 20))]);
  add([text("SOLD!", { size: 56 }), pos(240, 160), anchor("center"), color(rgb(...COL_GOLD))]);
  add([text("$40M — Record Broken!", { size: 22 }), pos(240, 230), anchor("center"), color(rgb(...COL_TEXT))]);
  add([text("The electric supercar\nfinds its buyer.", { size: 18 }), pos(240, 295), anchor("center"), color(rgb(180, 180, 210))]);
  add([text("Press SPACE or tap to play again", { size: 14 }), pos(240, 400), anchor("center"), color(rgb(120, 120, 160))]);

  onKeyPress("space", () => go("game"));
  onMousePress(() => go("game"));
  onTouchStart(() => go("game"));
});

// ─── START ───────────────────────────────────────────────────────────────────
go("game");
