"use strict";

const canvas = document.getElementById("background");
const ctx = canvas.getContext("2d");

let width = 0;
let height = 0;
let dpr = 1;
let time = 0;
let particles = [];
let stars = [];
let bestScore = Number(localStorage.getItem("neonBestScore") || 0);

const menu = document.getElementById("menu");
const gameScreen = document.getElementById("gameScreen");
const settingsModal = document.getElementById("settingsModal");
const toast = document.getElementById("toast");

document.getElementById("bestScore").textContent =
  String(bestScore).padStart(6, "0");

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  createStars();
}

function createStars() {
  stars = [];

  for (let i = 0; i < Math.min(180, width * height / 7000); i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.7 + .2,
      alpha: Math.random() * .7 + .1,
      speed: Math.random() * .25 + .05
    });
  }
}

function createParticle(x, y, color) {
  particles.push({
    x,
    y,
    color,
    size: Math.random() * 2 + .5,
    speed: Math.random() * 1.8 + .4,
    angle: Math.random() * Math.PI * 2,
    life: Math.random() * 100 + 70
  });
}

function drawBackground() {
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createRadialGradient(
    width * .55,
    height * .45,
    0,
    width * .55,
    height * .45,
    Math.max(width, height) * .8
  );

  gradient.addColorStop(0, "#0a1723");
  gradient.addColorStop(.45, "#060d18");
  gradient.addColorStop(1, "#020308");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawStars();
  drawHorizonGlow();
  drawGrid();
  drawLightTrails();
  updateParticles();
}

function drawStars() {
  for (const star of stars) {
    star.y += star.speed;

    if (star.y > height) {
      star.y = -3;
      star.x = Math.random() * width;
    }

    ctx.globalAlpha = star.alpha * (.6 + Math.sin(time * .002 + star.x) * .4);
    ctx.fillStyle = "#8adff5";
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  ctx.globalAlpha = 1;
}

function drawHorizonGlow() {
  const horizon = height * .62;

  const glow = ctx.createLinearGradient(0, horizon - 150, 0, horizon + 100);
  glow.addColorStop(0, "transparent");
  glow.addColorStop(.5, "rgba(255, 102, 25, .12)");
  glow.addColorStop(1, "transparent");

  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - 150, width, 250);

  ctx.strokeStyle = "rgba(255, 117, 35, .75)";
  ctx.shadowColor = "#ff681e";
  ctx.shadowBlur = 18;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(width, horizon);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function drawGrid() {
  const horizon = height * .62;
  const bottom = height * 1.25;
  const lines = 18;

  ctx.save();
  ctx.lineWidth = 1;

  for (let i = 0; i <= lines; i++) {
    const progress = i / lines;
    const y = horizon + Math.pow(progress, 2) * (bottom - horizon);
    const alpha = .06 + progress * .14;

    ctx.strokeStyle = `rgba(25, 217, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const vertical = 24;

  for (let i = -vertical; i <= vertical; i++) {
    const bottomX = width / 2 + i * width / 16;
    const topX = width / 2 + i * 7;

    ctx.strokeStyle = "rgba(25, 217, 255, .13)";
    ctx.beginPath();
    ctx.moveTo(topX, horizon);
    ctx.lineTo(bottomX, bottom);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLightTrails() {
  const centerY = height * .63;

  for (let i = 0; i < 8; i++) {
    const y = centerY + i * 22 + Math.sin(time * .001 + i) * 4;
    const x = ((time * (.08 + i * .012)) % (width + 500)) - 500;

    const trail = ctx.createLinearGradient(x, 0, x + 400, 0);
    trail.addColorStop(0, "transparent");
    trail.addColorStop(.7, i % 2 ? "rgba(25,217,255,.2)" : "rgba(255,123,33,.25)");
    trail.addColorStop(1, "transparent");

    ctx.fillStyle = trail;
    ctx.fillRect(x, y, 420, 2);
  }
}

function updateParticles() {
  if (Math.random() < .35) {
    createParticle(
      Math.random() * width,
      height * (.56 + Math.random() * .3),
      Math.random() > .65 ? "#ff7b21" : "#19d9ff"
    );
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed - .3;
    p.life--;

    ctx.globalAlpha = Math.max(0, p.life / 100);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.fillRect(p.x, p.y, p.size, p.size);

    if (p.life <= 0) particles.splice(i, 1);
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function loop(now) {
  time = now;
  drawBackground();
  requestAnimationFrame(loop);
}

function showScreen(screen) {
  menu.classList.remove("active");
  gameScreen.classList.remove("active");
  screen.classList.add("active");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

document.getElementById("startButton").addEventListener("click", () => {
  showScreen(gameScreen);
  showToast("СЕКТОР 01 // ОЖИДАНИЕ ПИЛОТА");
});

document.getElementById("survivalButton").addEventListener("click", () => {
  showScreen(gameScreen);
  showToast("РЕЖИМ ВЫЖИВАНИЯ // ПРОТОКОЛ ЗАГРУЖЕН");
});

document.getElementById("backButton").addEventListener("click", () => {
  showScreen(menu);
});

document.getElementById("settingsButton").addEventListener("click", () => {
  settingsModal.classList.add("open");
});

document.getElementById("closeSettings").addEventListener("click", () => {
  settingsModal.classList.remove("open");
});

document.getElementById("saveSettings").addEventListener("click", () => {
  const glow = document.getElementById("glowToggle").checked;
  const scan = document.getElementById("scanToggle").checked;
  const motion = document.getElementById("motionToggle").checked;

  document.body.classList.toggle("no-glow", !glow);
  document.body.classList.toggle("no-scanlines", !scan);
  document.body.classList.toggle("low-motion", motion);

  localStorage.setItem("neonGlow", glow);
  localStorage.setItem("neonScan", scan);
  localStorage.setItem("neonMotion", motion);

  settingsModal.classList.remove("open");
  showToast("НАСТРОЙКИ СОХРАНЕНЫ");
});

function loadSettings() {
  const glow = localStorage.getItem("neonGlow");
  const scan = localStorage.getItem("neonScan");
  const motion = localStorage.getItem("neonMotion");

  if (glow !== null) {
    document.getElementById("glowToggle").checked = glow === "true";
    document.body.classList.toggle("no-glow", glow !== "true");
  }

  if (scan !== null) {
    document.getElementById("scanToggle").checked = scan === "true";
    document.body.classList.toggle("no-scanlines", scan !== "true");
  }

  if (motion !== null) {
    document.getElementById("motionToggle").checked = motion === "true";
    document.body.classList.toggle("low-motion", motion === "true");
  }
}

window.addEventListener("resize", resize);
loadSettings();
resize();
requestAnimationFrame(loop);
