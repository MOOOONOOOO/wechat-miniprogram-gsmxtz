const DEFAULT_FRAME_MS = 1000 / 60;

function between(min, max, random) {
  return min + (max - min) * random();
}

function makeFlake(width, height, random, startInside) {
  const depth = between(0.5, 1, random);
  return {
    x: between(-20, width + 20, random),
    y: startInside ? between(-20, height, random) : between(-height * 0.18, -12, random),
    radius: between(1.8, 4.6, random) * depth,
    speed: between(34, 92, random) * depth,
    wind: between(-8, 16, random),
    swing: between(8, 28, random) * depth,
    frequency: between(0.0008, 0.0022, random),
    phase: between(0, Math.PI * 2, random),
    alpha: between(0.35, 0.9, random) * depth
  };
}

function createSnowSketch({
  canvas,
  context,
  width,
  height,
  random = Math.random,
  particleCount,
  onComplete
} = {}) {
  const ctx = context;
  const count = particleCount || Math.max(150, Math.min(210, Math.round(width / 2.2)));
  let flakes = [];
  let running = false;
  let frameHandle = null;
  let lastFrameTime = null;
  let elapsed = 0;
  let duration = 0;

  function requestFrame(callback) {
    if (canvas && typeof canvas.requestAnimationFrame === "function") {
      return canvas.requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(Date.now()), DEFAULT_FRAME_MS);
  }

  function cancelFrame(handle) {
    if (handle === null || handle === undefined) return;
    if (canvas && typeof canvas.cancelAnimationFrame === "function") {
      canvas.cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  function resetFlakes() {
    flakes = Array.from({ length: count }, () => makeFlake(width, height, random, true));
  }

  function recycleFlake(flake) {
    const next = makeFlake(width, height, random, false);
    Object.keys(next).forEach((key) => {
      flake[key] = next[key];
    });
  }

  function renderFrame(timestamp) {
    if (!running) return;
    const safeTimestamp = Number(timestamp || Date.now());
    const delta = lastFrameTime === null
      ? DEFAULT_FRAME_MS
      : Math.max(8, Math.min(40, safeTimestamp - lastFrameTime));
    lastFrameTime = safeTimestamp;
    elapsed += delta;
    const fadeStart = Math.max(0, duration - 900);
    const sceneAlpha = elapsed <= fadeStart
      ? 1
      : Math.max(0, 1 - (elapsed - fadeStart) / Math.max(1, duration - fadeStart));

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    flakes.forEach((flake) => {
      flake.y += flake.speed * delta / 1000;
      flake.x += flake.wind * delta / 1000;
      const waveX = Math.sin(elapsed * flake.frequency + flake.phase) * flake.swing;
      if (flake.y > height + 18 || flake.x + waveX > width + 44 || flake.x + waveX < -44) {
        recycleFlake(flake);
      }
      ctx.globalAlpha = flake.alpha * sceneAlpha * 0.58;
      ctx.fillStyle = "#6f8998";
      ctx.beginPath();
      ctx.arc(flake.x + waveX, flake.y, flake.radius * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = flake.alpha * sceneAlpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(flake.x + waveX, flake.y, flake.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    if (elapsed >= duration) {
      running = false;
      frameHandle = null;
      ctx.clearRect(0, 0, width, height);
      if (typeof onComplete === "function") onComplete();
      return;
    }
    frameHandle = requestFrame(renderFrame);
  }

  function stop(clear = true) {
    running = false;
    cancelFrame(frameHandle);
    frameHandle = null;
    lastFrameTime = null;
    if (clear && ctx) ctx.clearRect(0, 0, width, height);
  }

  function play(durationMs = 3600) {
    stop();
    duration = Math.max(1200, Number(durationMs || 0));
    elapsed = 0;
    resetFlakes();
    running = true;
    frameHandle = requestFrame(renderFrame);
  }

  return {
    play,
    stop
  };
}

module.exports = {
  createSnowSketch
};
