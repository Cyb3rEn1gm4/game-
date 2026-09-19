"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const BLUE = "#19d9ff";
  const ORANGE = "#ff7b21";
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const NX = 100, NY = 64, CELL = 10;
  const AW = NX * CELL, AH = NY * CELL;
  const coarse = matchMedia("(pointer: coarse)");

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const random = (a, b) => a + Math.random() * (b - a);
  const cellIndex = (x, y) => y * NX + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < NX && y < NY;

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  const storedSettings = read("nc-settings", {});
  const settings = {
    glow: true,
    scan: true,
    motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    sound: true,
    ...(storedSettings && typeof storedSettings === "object" ? storedSettings : {})
  };

  let best = Number(read("nc-best", 0)) || 0;
  let state = "menu";
  let mode = "campaign";
  let stage = 1;
  let score = 0;
  let elapsed = 0;
  let countdown = 3;
  let spawnClock = 0;
  let noticeClock = 0;
  let finishClock = 0;
  let shake = 0;
  let mobileBoost = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let hudClock = 0;
  let audio = null;
  let audioGain = null;
  let engine = null;
  let engineGain = null;

  const keys = new Set();
  const board = new Int16Array(NX * NY);
  let riders = [];
  let bonuses = [];
  let particles = [];
  let obstacles = [];

  const ARENAS = [
    { name: "ORANGE HORIZON", subtitle: "Периферия цифрового города", tint: "#071b2a" },
    { name: "BINARY DOCKS", subtitle: "Скоростной контур киберпорта", tint: "#101326" },
    { name: "REACTOR CORE", subtitle: "Последний рубеж системы", tint: "#21120c" }
  ];

  const BONUS = {
    nitro: {
      name: "НИТРО", symbol: "N", color: BLUE,
      description: "Запас ускорения восстановлен"
    },
    shield: {
      name: "ЩИТ", symbol: "S", color: "#9deaff", duration: 12,
      description: "Защита от одного столкновения со следом"
    },
    phase: {
      name: "ФАЗА", symbol: "P", color: "#b1a0ff", duration: 4,
      description: "Прохождение сквозь световые стены"
    },
    overdrive: {
      name: "OVERDRIVE", symbol: "O", color: ORANGE, duration: 6,
      description: "Скорость увеличена на 30%"
    },
    emp: {
      name: "EMP", symbol: "E", color: "#ffffff", duration: 5,
      description: "Все противники замедлены"
    }
  };

  const background = $("background");
  const bg = background.getContext("2d", { alpha: false });

  const raceCanvas = document.createElement("canvas");
  raceCanvas.id = "raceCanvas";
  raceCanvas.setAttribute("aria-label", "Арена световых мотоциклов");
  document.body.insertBefore(raceCanvas, document.body.firstChild);
  const ctx = raceCanvas.getContext("2d", { alpha: false });

  const trails = document.createElement("canvas");
  trails.width = AW;
  trails.height = AH;
  const trailCtx = trails.getContext("2d");

  let W = 0, H = 0, DPR = 1, scale = 1, offsetX = 0, offsetY = 0;

  $("gameScreen").innerHTML = `
    <div class="race-hud">
      <div class="race-brand">NEON CIRCUIT<small id="arenaName"></small></div>
      <div class="race-stats">
        <div><small>СЕКТОР</small><b id="sectorValue">01</b></div>
        <div><small>ОЧКИ</small><b id="scoreValue">0</b></div>
        <div><small>В ЖИВЫХ</small><b id="aliveValue">4</b></div>
      </div>
      <div class="race-controls">
        <button id="soundButton" aria-label="Переключить звук">♪</button>
        <button id="pauseButton" aria-label="Пауза">Ⅱ</button>
      </div>
    </div>
    <div id="raceNotice" role="status"></div>
    <div id="raceCenter"></div>
    <div class="race-bottom">
      <div class="energy-panel">
        <div class="energy-label"><span>НИТРО</span><span id="nitroValue">100%</span></div>
        <div class="energy-track"><div id="nitroFill"></div></div>
        <div class="race-help">
          WASD / стрелки — поворот<br>
          Shift / пробел — нитро · Esc / P — пауза
        </div>
      </div>
      <div id="effects"></div>
    </div>
    <div id="mobileControls">
      <div class="direction-pad">
        <button data-dir="3" aria-label="Вверх">↑</button>
        <button data-dir="2" aria-label="Влево">←</button>
        <button data-dir="0" aria-label="Вправо">→</button>
        <button data-dir="1" aria-label="Вниз">↓</button>
      </div>
      <button id="mobileNitro">НИТРО</button>
    </div>
  `;

  function resize() {
    W = innerWidth;
    H = innerHeight;
    DPR = Math.min(devicePixelRatio || 1, 2);

    for (const canvas of [background, raceCanvas]) {
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
    }

    const top = 116;
    const bottom = coarse.matches ? 220 : 110;
    scale = Math.max(.08, Math.min((W - 32) / AW, (H - top - bottom) / AH));
    offsetX = (W - AW * scale) / 2;
    offsetY = top + Math.max(0, (H - top - bottom - AH * scale) / 2);
  }

  addEventListener("resize", resize);
  resize();

  function applySettings() {
    document.body.classList.toggle("no-glow", !settings.glow);
    document.body.classList.toggle("no-scanlines", !settings.scan);
    document.body.classList.toggle("low-motion", settings.motion);
    $("glowToggle").checked = settings.glow;
    $("scanToggle").checked = settings.scan;
    $("motionToggle").checked = settings.motion;
    $("soundButton").textContent = settings.sound ? "♪" : "×♪";
    if (audioGain) audioGain.gain.value = settings.sound ? .24 : 0;
  }

  applySettings();
  $("bestScore").textContent = String(best).padStart(6, "0");

  // Все звуки синтезируются локально: никаких аудиофайлов.
  function unlockAudio() {
    try {
      if (!audio) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audio = new AudioContextClass();
        audioGain = audio.createGain();
        audioGain.gain.value = settings.sound ? .24 : 0;
        audioGain.connect(audio.destination);

        engine = audio.createOscillator();
        engine.type = "sawtooth";

        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 300;

        engineGain = audio.createGain();
        engineGain.gain.value = 0;
        engine.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(audioGain);
        engine.start();
      }
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {}
  }

  function tone(frequency, duration = .12, type = "sine", end = frequency, volume = .2) {
    if (!audio || !settings.sound) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t = audio.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain);
    gain.connect(audioGain);
    osc.start(t);
    osc.stop(t + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  function showToast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => $("toast").classList.remove("show"), 2200);
  }

  function announce(title, description = "", duration = 3) {
    $("raceNotice").replaceChildren();
    const main = document.createElement("div");
    main.textContent = title;
    $("raceNotice").append(main);
    if (description) {
      const sub = document.createElement("small");
      sub.textContent = description;
      $("raceNotice").append(sub);
    }
    noticeClock = duration;
  }

  function getCell(x, y) {
    return inside(x, y) ? board[cellIndex(x, y)] : -1;
  }

  function addObstacle(x, y, w, h) {
    obstacles.push({ x, y, w, h });
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        board[cellIndex(xx, yy)] = -1;
  }

  function buildArena() {
    board.fill(0);
    obstacles = [];
    trailCtx.clearRect(0, 0, AW, AH);
    const variant = (stage - 1) % ARENAS.length;

    if (variant === 0) {
      addObstacle(35, 24, 3, 16);
      addObstacle(62, 24, 3, 16);
    } else if (variant === 1) {
      addObstacle(25, 18, 16, 3);
      addObstacle(59, 43, 16, 3);
      addObstacle(48, 27, 4, 10);
    } else {
      addObstacle(43, 25, 14, 14);
      addObstacle(20, 18, 3, 12);
      addObstacle(77, 34, 3, 12);
    }
  }

  function createRider(id, x, y, dir, color, human) {
    return {
      id, x, y, dir, color, human,
      alive: true,
      progress: 0,
      speed: 0,
      energy: 100,
      nitroLocked: false,
      boosting: false,
      turns: [],
      effects: {},
      grace: 0,
      aiClock: 0
    };
  }

  function startRun(selectedMode) {
    unlockAudio();
    mode = selectedMode;
    stage = 1;
    score = 0;
    startRound();
  }

  function startRound() {
    state = "countdown";
    elapsed = 0;
    countdown = 3;
    spawnClock = 2;
    finishClock = 0;
    accumulator = 0;
    shake = 0;
    bonuses = [];
    particles = [];
    keys.clear();
    mobileBoost = false;

    buildArena();

    riders = [
      createRider(1, 12, 12, 0, BLUE, true),
      createRider(2, 87, 51, 2, ORANGE, false),
      createRider(3, 87, 12, 1, "#ffb35c", false),
      createRider(4, 12, 51, 3, "#5e8dff", false)
    ];

    document.body.classList.add("racing");
    $("menu").classList.remove("active");
    $("gameScreen").classList.add("active");

    const arena = ARENAS[(stage - 1) % ARENAS.length];
    $("arenaName").textContent = arena.name;
    $("sectorValue").textContent = mode === "survival"
      ? String(stage).padStart(2, "0")
      : `${stage} / 3`;

    announce(arena.name, arena.subtitle, 3);

    for (let i = 0; i < 5; i++) spawnBonus();
    updateHud();
    tone(180, .25, "sine", 450);
  }

  function markTrail(rider) {
    const i = cellIndex(rider.x, rider.y);
    if (board[i] !== 0) return;
    board[i] = rider.id;

    const x = rider.x * CELL;
    const y = rider.y * CELL;

    trailCtx.fillStyle = rider.color;
    trailCtx.globalAlpha = .2;
    trailCtx.fillRect(x, y, CELL, CELL);
    trailCtx.globalAlpha = .9;
    trailCtx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    trailCtx.globalAlpha = 1;
    trailCtx.fillStyle = "#e6fbff";
    trailCtx.fillRect(x + 4, y + 4, 2, 2);
  }

  function queueTurn(direction) {
    if (state !== "running" && state !== "countdown") return;
    const rider = riders[0];
    if (!rider || !rider.alive || rider.turns.length >= 2) return;

    const previous = rider.turns.length
      ? rider.turns[rider.turns.length - 1]
      : rider.dir;

    if (direction === previous || direction === (previous + 2) % 4) return;
    rider.turns.push(direction);
  }

  function burst(x, y, color, count = 30) {
    const amount = settings.motion ? Math.min(count, 10) : count;
    for (let i = 0; i < amount; i++) {
      if (particles.length > 700) break;
      const angle = Math.random() * TAU;
      const speed = random(25, 170);
      const life = random(.3, .9);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life, maxLife: life, color
      });
    }
  }

  function kill(rider) {
    if (!rider.alive) return;
    rider.alive = false;
    burst(rider.x * CELL + 5, rider.y * CELL + 5, rider.color, 65);
    shake = settings.motion ? 0 : rider.human ? 12 : 5;
    tone(140, .45, "sawtooth", 25, .3);

    if (!rider.human && riders[0].alive) {
      score += 250;
      announce("СОПЕРНИК УНИЧТОЖЕН", "+250 очков", 1.8);
    }
  }

  function safeCell(rider, x, y) {
    const v = getCell(x, y);
    return v !== -1 && (v === 0 || rider.effects.phase > 0 || rider.grace > 0);
  }

  // Оценка пространства ограниченным поиском:
  // бот предпочитает свободные области, а не только ближайшую клетку.
  const visited = new Int32Array(NX * NY);
  const searchQueue = new Int32Array(NX * NY);
  let visitToken = 0;

  function reachableSpace(rider, x, y) {
    if (!safeCell(rider, x, y)) return 0;
    visitToken++;
    let head = 0, tail = 1;
    searchQueue[0] = cellIndex(x, y);
    visited[searchQueue[0]] = visitToken;

    while (head < tail && tail < 320) {
      const pos = searchQueue[head++];
      const px = pos % NX;
      const py = Math.floor(pos / NX);
      for (let d = 0; d < 4; d++) {
        const xx = px + DX[d], yy = py + DY[d];
        if (!inside(xx, yy)) continue;
        const id = cellIndex(xx, yy);
        if (visited[id] === visitToken || !safeCell(rider, xx, yy)) continue;
        visited[id] = visitToken;
        searchQueue[tail++] = id;
      }
    }
    return tail;
  }

  function chooseBotDirection(rider) {
    let bestDirection = rider.dir;
    let bestValue = -Infinity;

    for (const d of [rider.dir, (rider.dir + 1) % 4, (rider.dir + 3) % 4]) {
      const nx = rider.x + DX[d], ny = rider.y + DY[d];
      if (!safeCell(rider, nx, ny)) continue;

      let runway = 0;
      for (let k = 1; k <= 22; k++) {
        if (!safeCell(rider, rider.x + DX[d] * k, rider.y + DY[d] * k)) break;
        runway++;
      }

      const space = reachableSpace(rider, nx, ny);
      let rating = space * .18 + runway * 1.3 + Math.random() * 3;
      if (d === rider.dir) rating += 4;

      for (const other of riders) {
        if (other === rider || !other.alive) continue;
        const distance = Math.abs(nx - other.x) + Math.abs(ny - other.y);
        if (distance < 5) rating -= (5 - distance) * 13;
      }

      for (const bonus of bonuses) {
        const distance = Math.abs(nx - bonus.x) + Math.abs(ny - bonus.y);
        if (distance < 16) rating += (16 - distance) * .4;
      }

      if (rating > bestValue) {
        bestValue = rating;
        bestDirection = d;
      }
    }
    return bestDirection;
  }

  function spawnBonus() {
    if (bonuses.length >= 7) return;
    const types = Object.keys(BONUS);

    for (let attempt = 0; attempt < 150; attempt++) {
      const x = Math.floor(random(5, NX - 5));
      const y = Math.floor(random(5, NY - 5));
      if (getCell(x, y) !== 0) continue;
      if (bonuses.some(b => Math.abs(b.x - x) + Math.abs(b.y - y) < 7)) continue;
      if (riders.some(r => r.alive && Math.abs(r.x - x) + Math.abs(r.y - y) < 5)) continue;

      bonuses.push({
        x, y,
        type: types[Math.floor(Math.random() * types.length)],
        ttl: 18
      });
      return;
    }
  }

  function takeBonus(rider, bonus) {
    const info = BONUS[bonus.type];

    if (bonus.type === "nitro") {
      rider.energy = 100;
      rider.nitroLocked = false;
    } else if (bonus.type === "emp") {
      for (const other of riders)
        if (other !== rider && other.alive) other.effects.slow = info.duration;
      rider.effects.emp = info.duration;
    } else {
      rider.effects[bonus.type] = info.duration;
    }

    burst(bonus.x * CELL + 5, bonus.y * CELL + 5, info.color, 20);

    if (rider.human) {
      score += 75;
      announce(
        `ПОЛУЧЕНО: ${info.name}${info.duration ? ` · ${info.duration} СЕК` : ""}`,
        `${info.description} · +75 очков`
      );
      tone(500, .18, "sine", 1300);
    }
  }

  function stepRiders(dt) {
    const plans = [];

    for (const rider of riders) {
      if (!rider.alive) continue;

      for (const key of Object.keys(rider.effects)) {
        rider.effects[key] -= dt;
        if (rider.effects[key] <= 0) {
          delete rider.effects[key];
          if (rider.human) {
            const label = key === "slow" ? "ЗАМЕДЛЕНИЕ" : BONUS[key]?.name;
            if (label) announce(`${label}: ДЕЙСТВИЕ ЗАВЕРШЕНО`, "", 1.4);
          }
        }
      }

      rider.grace = Math.max(0, rider.grace - dt);

      const requested = rider.human
        ? keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("Space") || mobileBoost
        : getCell(rider.x + DX[rider.dir] * 9, rider.y + DY[rider.dir] * 9) === 0
          && elapsed % 9 < 1.2;

      if (rider.energy <= 1) rider.nitroLocked = true;
      if (!requested && rider.energy > 18) rider.nitroLocked = false;

      rider.boosting = requested && !rider.nitroLocked && rider.energy > 0;
      rider.energy = clamp(rider.energy + (rider.boosting ? -36 : 14) * dt, 0, 100);

      const base = rider.human ? 12 : 10.3 + Math.min(stage, 8) * .55;
      let target = base * (rider.boosting ? 1.72 : 1);
      if (rider.effects.overdrive) target *= 1.3;
      if (rider.effects.slow) target *= .57;

      rider.speed += (target - rider.speed) * Math.min(1, dt * 5);
      rider.progress += rider.speed * dt;

      if (rider.progress >= 1) {
        rider.progress -= 1;
        plans.push({ rider, nx: 0, ny: 0, dead: false });
      }
    }

    // Сначала все участники оставляют след.
    for (const plan of plans) markTrail(plan.rider);

    // Затем выбираются направления — это предотвращает
    // преимущество первого участника при одновременном ходе.
    for (const plan of plans) {
      const rider = plan.rider;
      if (rider.human) {
        if (rider.turns.length) rider.dir = rider.turns.shift();
      } else {
        rider.dir = chooseBotDirection(rider);
      }

      plan.nx = rider.x + DX[rider.dir];
      plan.ny = rider.y + DY[rider.dir];

      const target = getCell(plan.nx, plan.ny);
      if (target === -1) {
        plan.dead = true;
      } else if (target > 0 && !rider.effects.phase && rider.grace <= 0) {
        if (rider.effects.shield) {
          delete rider.effects.shield;
          rider.grace = .65;
          burst(rider.x * CELL + 5, rider.y * CELL + 5, "#ffffff", 24);
          if (rider.human) announce("ЩИТ ПОГЛОТИЛ УДАР", "Защитный заряд израсходован");
          tone(220, .2, "triangle", 700);
        } else {
          plan.dead = true;
        }
      }
    }

    // Лобовые столкновения, включая обмен соседними клетками.
    for (const plan of plans) {
      for (const other of riders) {
        if (!other.alive || other === plan.rider) continue;
        const otherPlan = plans.find(p => p.rider === other);
        const sameDestination = otherPlan
          && plan.nx === otherPlan.nx && plan.ny === otherPlan.ny;
        const entersHead = plan.nx === other.x && plan.ny === other.y;
        if (sameDestination || entersHead) {
          plan.dead = true;
          if (otherPlan) otherPlan.dead = true;
          else kill(other);
        }
      }
    }

    for (const plan of plans) {
      const rider = plan.rider;
      if (plan.dead) {
        kill(rider);
        continue;
      }

      rider.x = plan.nx;
      rider.y = plan.ny;

      for (let i = bonuses.length - 1; i >= 0; i--) {
        const bonus = bonuses[i];
        if (Math.abs(bonus.x - rider.x) <= 1 && Math.abs(bonus.y - rider.y) <= 1) {
          takeBonus(rider, bonus);
          bonuses.splice(i, 1);
        }
      }
    }
  }

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= .98;
      p.vy *= .98;
      if (p.life <= 0) particles.splice(i, 1);
    }

    shake *= Math.exp(-dt * 9);

    if (state === "countdown") {
      const previous = Math.ceil(countdown);
      countdown -= dt;
      if (Math.ceil(countdown) !== previous) tone(400, .12, "sine", 600);
      $("raceCenter").innerHTML = `
        <div class="countdown">${Math.max(1, Math.ceil(countdown))}
        <small>ПОДГОТОВКА К ЗАЕЗДУ</small></div>`;
      if (countdown <= 0) {
        state = "running";
        $("raceCenter").innerHTML = "";
        announce("СИСТЕМА СИНХРОНИЗИРОВАНА", "Не касайся стен и световых следов");
        tone(600, .25, "triangle", 1400);
      }
      return;
    }

    if (state === "finishing") {
      finishClock -= dt;
      if (finishClock <= 0) finishRound();
      return;
    }

    if (state !== "running") return;

    elapsed += dt;
    score += dt * 5;

    if (noticeClock > 0) {
      noticeClock -= dt;
      if (noticeClock <= 0) $("raceNotice").textContent = "";
    }

    for (let i = bonuses.length - 1; i >= 0; i--) {
      bonuses[i].ttl -= dt;
      if (bonuses[i].ttl <= 0) bonuses.splice(i, 1);
    }

    spawnClock -= dt;
    if (spawnClock <= 0) {
      spawnClock = 3.3;
      spawnBonus();
    }

    stepRiders(dt);

    if (!riders[0].alive || riders.filter(r => r.alive).length <= 1) {
      state = "finishing";
      finishClock = .9;
      keys.clear();
      mobileBoost = false;
    }
  }

  function updateHud() {
    const player = riders[0];
    if (!player) return;

    $("scoreValue").textContent = String(Math.floor(score)).padStart(6, "0");
    $("aliveValue").textContent = riders.filter(r => r.alive).length;
    $("nitroValue").textContent = `${Math.round(player.energy)}%`;
    $("nitroFill").style.width = `${player.energy}%`;
    $("nitroFill").style.background = player.nitroLocked ? ORANGE : BLUE;

    $("effects").innerHTML = Object.entries(player.effects).map(([key, time]) => {
      const info = BONUS[key] || { name: "ЗАМЕДЛЕНИЕ", duration: 5 };
      const width = clamp(time / info.duration * 100, 0, 100);
      return `
        <div class="effect">
          <strong>${info.name}</strong>
          <span>${time.toFixed(1)}s</span>
          <div class="effect-track"><i style="width:${width}%"></i></div>
        </div>`;
    }).join("");
  }

  function dialog(title, description, mainText, mainAction) {
    $("raceCenter").innerHTML = `
      <section class="race-dialog" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="overline">NEON CIRCUIT // SYSTEM</div>
        <h2>${title}</h2>
        <p>${description}</p>
        <div class="dialog-actions">
          <button class="button primary" id="dialogMain">${mainText}</button>
          <button class="button" id="dialogMenu">В МЕНЮ</button>
        </div>
      </section>`;
    $("dialogMain").onclick = mainAction;
    $("dialogMenu").onclick = returnToMenu;
    $("dialogMain").focus();
  }

  function saveBest() {
    if (Math.floor(score) > best) {
      best = Math.floor(score);
      write("nc-best", best);
    }
    $("bestScore").textContent = String(best).padStart(6, "0");
  }

  function finishRound() {
    state = "result";
    const won = riders[0].alive;

    if (won) score += 1000 + Math.max(0, 500 - Math.floor(elapsed * 5));
    saveBest();
    updateHud();

    const stats = `Очки: ${Math.floor(score)} · Время сектора: ${Math.floor(elapsed)} сек<br>Рекорд: ${best}`;

    if (won && (mode === "survival" || stage < 3)) {
      tone(500, .35, "triangle", 1000);
      dialog("СЕКТОР ЗАЧИЩЕН", stats, "СЛЕДУЮЩИЙ", () => {
        stage++;
        startRound();
      });
    } else {
      dialog(
        won ? "СИСТЕМА ПОКОРЕНА" : "СВЯЗЬ ПОТЕРЯНА",
        stats,
        "НОВЫЙ ЗАЕЗД",
        () => startRun(mode)
      );
    }
  }

  function togglePause() {
    if (state === "running" || state === "countdown") {
      togglePause.previous = state;
      state = "paused";
      keys.clear();
      mobileBoost = false;
      dialog(
        "ПАУЗА",
        "Время остановлено. Эффекты и запас нитро сохранены.",
        "ПРОДОЛЖИТЬ",
        resume
      );
    } else if (state === "paused") {
      resume();
    }
  }

  function resume() {
    unlockAudio();
    state = togglePause.previous || "running";
    $("raceCenter").innerHTML = "";
    accumulator = 0;
  }

  function returnToMenu() {
    saveBest();
    state = "menu";
    keys.clear();
    mobileBoost = false;
    $("raceCenter").innerHTML = "";
    $("gameScreen").classList.remove("active");
    $("menu").classList.add("active");
    document.body.classList.remove("racing");
    $("startButton").focus();
  }

  // Процедурный фон: город, горизонт и движущаяся сетка.
  function drawBackground(time) {
    const t = settings.motion ? 0 : time;
    bg.setTransform(DPR, 0, 0, DPR, 0, 0);
    const gradient = bg.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#02050c");
    gradient.addColorStop(.55, "#071321");
    gradient.addColorStop(1, "#02060c");
    bg.fillStyle = gradient;
    bg.fillRect(0, 0, W, H);

    const horizon = H * .55;

    const haze = bg.createRadialGradient(W * .73, horizon, 0, W * .73, horizon, W * .6);
    haze.addColorStop(0, "#ff7b2124");
    haze.addColorStop(.4, "#19d9ff0c");
    haze.addColorStop(1, "#00000000");
    bg.fillStyle = haze;
    bg.fillRect(0, 0, W, H);

    for (let i = 0; i < 44; i++) {
      const x = (i / 44) * W;
      const width = W / 50;
      const height = 25 + ((i * 71) % 180);
      bg.fillStyle = "#060b13";
      bg.fillRect(x, horizon - height, width, height);
      bg.strokeStyle = i % 4 === 0 ? "#ff7b2140" : "#19d9ff26";
      bg.strokeRect(x, horizon - height, width, height);
      bg.fillStyle = i % 4 === 0 ? "#ff7b2190" : "#19d9ff50";
      for (let j = 12; j < height - 6; j += 19) {
        bg.fillRect(x + width * .25, horizon - height + j, 2, 5);
      }
    }

    bg.strokeStyle = "#19d9ff23";
    bg.lineWidth = 1;
    for (let i = -18; i <= 18; i++) {
      bg.beginPath();
      bg.moveTo(W * .5 + i * 20, horizon);
      bg.lineTo(W * .5 + i * W * .14, H);
      bg.stroke();
    }

    for (let i = 0; i < 18; i++) {
      const z = ((i / 18 + t * .07) % 1);
      const y = horizon + z * z * (H - horizon);
      bg.strokeStyle = `rgba(25,217,255,${.04 + z * .19})`;
      bg.beginPath();
      bg.moveTo(0, y);
      bg.lineTo(W, y);
      bg.stroke();
    }

    bg.strokeStyle = "#ff7b2180";
    bg.beginPath();
    bg.moveTo(0, horizon);
    bg.lineTo(W, horizon);
    bg.stroke();

    for (let i = 0; i < 45; i++) {
      const x = ((i * 139.3 + t * (4 + i % 7)) % (W + 20)) - 10;
      const y = (i * 97.7) % H;
      bg.fillStyle = i % 3 ? "#19d9ff55" : "#ff7b2177";
      bg.fillRect(x, y, 2, 2);
    }
  }

  function drawArena(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#030811";
    ctx.fillRect(0, 0, W, H);

    const arena = ARENAS[(stage - 1) % ARENAS.length];
    const haze = ctx.createRadialGradient(W * .5, H * .45, 0, W * .5, H * .45, W * .7);
    haze.addColorStop(0, arena.tint);
    haze.addColorStop(1, "#030811");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);

    const sx = settings.motion ? 0 : random(-shake, shake);
    const sy = settings.motion ? 0 : random(-shake, shake);

    ctx.save();
    ctx.translate(offsetX + sx, offsetY + sy);
    ctx.scale(scale, scale);

    ctx.fillStyle = "#050e18";
    ctx.fillRect(0, 0, AW, AH);

    ctx.lineWidth = .6;
    for (let x = 0; x <= AW; x += CELL) {
      ctx.strokeStyle = x % 100 === 0 ? "#19d9ff25" : "#19d9ff09";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, AH);
      ctx.stroke();
    }
    for (let y = 0; y <= AH; y += CELL) {
      ctx.strokeStyle = y % 100 === 0 ? "#19d9ff25" : "#19d9ff09";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(AW, y);
      ctx.stroke();
    }

    // Декоративные концентрические контуры.
    ctx.save();
    ctx.translate(AW / 2, AH / 2);
    ctx.strokeStyle = "#ff7b2117";
    ctx.lineWidth = 2;
    for (let r = 100; r <= 260; r += 80) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(settings.motion ? 0 : time * .08);
    ctx.strokeStyle = "#ff7b2140";
    ctx.beginPath();
    ctx.arc(0, 0, 260, 0, .5);
    ctx.arc(0, 0, 260, Math.PI, Math.PI + .5);
    ctx.stroke();
    ctx.restore();

    for (const block of obstacles) {
      const x = block.x * CELL, y = block.y * CELL;
      const w = block.w * CELL, h = block.h * CELL;
      ctx.fillStyle = "#0c1826";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#172537";
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 1.7;
      ctx.shadowColor = ORANGE;
      ctx.shadowBlur = settings.glow ? 12 : 0;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff7b2180";
      for (let yy = y + 9; yy < y + h - 5; yy += 15)
        ctx.fillRect(x + 6, yy, Math.max(2, w - 12), 2);
    }

    if (settings.glow) {
      ctx.save();
      ctx.globalAlpha = .6;
      ctx.shadowColor = BLUE;
      ctx.shadowBlur = 11;
      ctx.drawImage(trails, 0, 0);
      ctx.restore();
    }
    ctx.drawImage(trails, 0, 0);

    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 2;
    ctx.shadowColor = BLUE;
    ctx.shadowBlur = settings.glow ? 16 : 0;
    ctx.strokeRect(-2, -2, AW + 4, AH + 4);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ff7b2160";
    ctx.strokeRect(-9, -9, AW + 18, AH + 18);

    for (const bonus of bonuses) {
      const info = BONUS[bonus.type];
      const x = bonus.x * CELL + 5, y = bonus.y * CELL + 5;
      const pulse = settings.motion ? 1 : 1 + Math.sin(time * 4) * .12;

      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = bonus.ttl < 4 && Math.sin(time * 12) < 0 ? .4 : 1;
      ctx.shadowBlur = settings.glow ? 15 : 0;
      ctx.shadowColor = info.color;
      ctx.strokeStyle = info.color;
      ctx.fillStyle = "#07111f";
      ctx.lineWidth = 1.5;

      ctx.save();
      ctx.scale(pulse, pulse);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + TAU * bonus.ttl / 18);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.textAlign = "center";
      ctx.fillStyle = info.color;
      ctx.font = "bold 11px Arial";
      ctx.fillText(info.symbol, 0, 4);
      ctx.font = "9px Arial";
      ctx.fillStyle = "#b6ccd9";
      ctx.fillText(`${Math.ceil(bonus.ttl)}s`, 0, 31);
      ctx.restore();
    }

    for (const rider of riders) {
      if (!rider.alive) continue;

      // Сглаживание между клетками без влияния на точность коллизий.
      const shift = rider.speed > 0 ? rider.progress - 1 : 0;
      const x = (rider.x + DX[rider.dir] * shift) * CELL + 5;
      const y = (rider.y + DY[rider.dir] * shift) * CELL + 5;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rider.dir * Math.PI / 2);

      const flame = rider.boosting ? 24 : 12;
      const exhaust = ctx.createLinearGradient(-10 - flame, 0, -7, 0);
      exhaust.addColorStop(0, "#00000000");
      exhaust.addColorStop(1, rider.color);
      ctx.fillStyle = exhaust;
      ctx.beginPath();
      ctx.moveTo(-10 - flame, 0);
      ctx.lineTo(-7, -3);
      ctx.lineTo(-7, 3);
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = rider.color;
      ctx.shadowBlur = settings.glow ? 12 : 0;
      ctx.fillStyle = "#07111a";
      ctx.strokeStyle = rider.color;
      ctx.lineWidth = 2;

      for (const wheel of [-6, 7]) {
        ctx.beginPath();
        ctx.ellipse(wheel, 0, 4.5, 5, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = rider.color;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(3, -4);
      ctx.lineTo(-8, -3);
      ctx.lineTo(-8, 3);
      ctx.lineTo(3, 4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#e5faff";
      ctx.fillRect(-1, -1.5, 6, 3);

      if (rider.effects.shield || rider.effects.phase || rider.grace > 0) {
        ctx.strokeStyle = rider.effects.phase ? "#b1a0ff" : "#c3f4ff";
        ctx.globalAlpha = .65;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 18, 13, 0, 0, TAU);
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // Скоростные штрихи по краям экрана при ускорении.
    const player = riders[0];
    if (!settings.motion && player?.alive && player.boosting && state === "running") {
      ctx.strokeStyle = "#19d9ff35";
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const x = i % 2 ? W - 10 - i * 3 : 10 + i * 3;
        const y = ((time * 850 + i * 97) % (H + 150)) - 100;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 45 + i * 2);
        ctx.stroke();
      }
    }
  }

  const directionKeys = {
    ArrowRight: 0, KeyD: 0,
    ArrowDown: 1, KeyS: 1,
    ArrowLeft: 2, KeyA: 2,
    ArrowUp: 3, KeyW: 3
  };

  addEventListener("keydown", event => {
    if (state === "menu") {
      if (event.code === "Escape") closeSettings();
      return;
    }

    const managed = event.code in directionKeys
      || ["Space", "ShiftLeft", "ShiftRight", "Escape", "KeyP"].includes(event.code);

    if (managed) event.preventDefault();

    if (!event.repeat && (event.code === "Escape" || event.code === "KeyP")) {
      togglePause();
      return;
    }

    keys.add(event.code);
    if (!event.repeat && event.code in directionKeys)
      queueTurn(directionKeys[event.code]);
  });

  addEventListener("keyup", event => keys.delete(event.code));

  function autoPause() {
    keys.clear();
    mobileBoost = false;
    if (state === "running" || state === "countdown") togglePause();
  }

  addEventListener("blur", autoPause);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) autoPause();
  });

  document.querySelectorAll("[data-dir]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      queueTurn(Number(button.dataset.dir));
    });
  });

  $("mobileNitro").addEventListener("pointerdown", event => {
    event.preventDefault();
    mobileBoost = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  });

  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    $("mobileNitro").addEventListener(event, () => { mobileBoost = false; });
  }

  $("startButton").onclick = () => startRun("campaign");
  $("survivalButton").onclick = () => startRun("survival");
  $("pauseButton").onclick = togglePause;

  $("soundButton").onclick = () => {
    unlockAudio();
    settings.sound = !settings.sound;
    applySettings();
    write("nc-settings", settings);
  };

  function closeSettings() {
    $("settingsModal").classList.remove("open");
    $("settingsButton").focus();
  }

  $("settingsModal").setAttribute("role", "dialog");
  $("settingsModal").setAttribute("aria-modal", "true");
  $("settingsModal").setAttribute("aria-label", "Настройки");

  $("settingsButton").onclick = () => {
    applySettings();
    $("settingsModal").classList.add("open");
    $("closeSettings").focus();
  };

  $("closeSettings").onclick = closeSettings;
  $("settingsModal").onclick = event => {
    if (event.target === $("settingsModal")) closeSettings();
  };

  $("settingsModal").addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const elements = [...$("settingsModal").querySelectorAll("button,input")];
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  $("saveSettings").onclick = () => {
    settings.glow = $("glowToggle").checked;
    settings.scan = $("scanToggle").checked;
    settings.motion = $("motionToggle").checked;
    applySettings();
    write("nc-settings", settings);
    closeSettings();
    showToast("НАСТРОЙКИ СОХРАНЕНЫ");
  };

  // Фиксированный шаг физики: одинаковая скорость на разных мониторах.
  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, .05);
    lastTime = now;

    if (!document.hidden) {
      accumulator += dt;
      while (accumulator >= 1 / 120) {
        update(1 / 120);
        accumulator -= 1 / 120;
      }

      if (state === "menu") {
        drawBackground(now / 1000);
      } else {
        drawArena(now / 1000);
        hudClock += dt;
        if (hudClock >= .08) {
          hudClock = 0;
          updateHud();
        }
      }

      if (audio && engineGain) {
        const player = riders[0];
        const active = state === "running" && player?.alive;
        engineGain.gain.setTargetAtTime(active ? .075 : 0, audio.currentTime, .08);
        engine.frequency.setTargetAtTime(
          active ? 45 + player.speed * 4 : 45,
          audio.currentTime,
          .08
        );
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
