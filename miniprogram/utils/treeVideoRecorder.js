const BACKGROUND_COLOR = [237 / 255, 237 / 255, 237 / 255, 1];
const STAR_COLOR = [244 / 255, 191 / 255, 55 / 255, 1];
const TWO_PI = Math.PI * 2;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform float u_pointSize;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  gl_PointSize = u_pointSize;
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_color;
uniform float u_useTexture;
uniform float u_opacity;
uniform float u_roundPoint;
varying vec2 v_texCoord;

void main() {
  if (u_roundPoint > 0.5) {
    vec2 offset = gl_PointCoord - vec2(0.5);
    if (dot(offset, offset) > 0.25) discard;
  }
  vec4 sourceColor = u_useTexture > 0.5
    ? texture2D(u_texture, v_texCoord)
    : u_color;
  gl_FragColor = vec4(sourceColor.rgb, sourceColor.a * u_opacity);
}
`;

function canRecordTreeVideo() {
  let version = "0.0.0";
  try {
    version = (
      typeof wx !== "undefined"
      && wx.getSystemInfoSync
      && (wx.getSystemInfoSync() || {}).SDKVersion
    ) || version;
  } catch (error) {}
  return Boolean(
    typeof wx !== "undefined"
    && wx.createMediaRecorder
    && wx.createOffscreenCanvas
    && compareVersion(version, "2.16.1") >= 0
  );
}

function compareVersion(left, right) {
  const leftParts = String(left || "0").split(".").map(Number);
  const rightParts = String(right || "0").split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = Number(leftParts[index] || 0) - Number(rightParts[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeRect(rawRect, width, height) {
  const rect = rawRect || {};
  const x = Math.floor(clamp(rect.x, 0, width));
  const y = Math.floor(clamp(rect.y, 0, height));
  const right = Math.ceil(clamp(x + Number(rect.width || 0), x, width));
  const bottom = Math.ceil(clamp(y + Number(rect.height || 0), y, height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function createSnowflakes(width, height, count = 54) {
  return Array.from({ length: count }, (_, index) => ({
    x: (index * 137 + 29) % width,
    y: (index * 211 + 43) % height,
    radius: 1.4 + (index * 7) % 4,
    speed: 1.7 + ((index * 13) % 19) / 10,
    drift: 7 + (index * 5) % 13,
    phase: (index * 0.73) % TWO_PI
  }));
}

function buildTreeVideoFrames(regions, requestedFrameRate) {
  const frameRate = Math.round(clamp(requestedFrameRate || 12, 10, 15));
  const completed = [];
  const frames = [];
  const pushFrame = (transition = null, star = null) => {
    frames.push({
      completed: completed.slice(),
      transition,
      star
    });
  };
  const hold = (count, starFactory) => {
    for (let index = 0; index < count; index += 1) {
      pushFrame(null, starFactory ? starFactory(index) : null);
    }
  };
  const reveal = (rect, transitionFrames) => {
    if (!rect || !rect.width || !rect.height) return;
    for (let step = 1; step <= transitionFrames; step += 1) {
      pushFrame({ rect, opacity: step / transitionFrames });
    }
    completed.push(rect);
  };

  hold(3);
  reveal(regions.people, 7);
  hold(2);
  (regions.rows || []).forEach((rect) => reveal(rect, 2));
  reveal(regions.footer, 4);

  const starFrames = frameRate * 2;
  hold(starFrames, (index) => ({
    ...regions.star,
    opacity: Math.min(1, (index + 1) / 5),
    rotation: index / starFrames * TWO_PI
  }));
  hold(frameRate * 6, (index) => ({
    ...regions.star,
    opacity: 1,
    rotation: (starFrames + index) / starFrames * TWO_PI
  }));

  return { frames, frameRate };
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "WebGL 着色器编译失败";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "WebGL 程序链接失败";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function loadCanvasImage(canvas, sourcePath) {
  return new Promise((resolve, reject) => {
    if (!canvas || !canvas.createImage) {
      reject(new Error("当前设备无法读取视频画面"));
      return;
    }
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("视频画面读取失败"));
    image.src = sourcePath;
  });
}

function toClipX(x, width) {
  return x / width * 2 - 1;
}

function toClipY(y, height) {
  return 1 - y / height * 2;
}

function makeVertex(x, y, u, v, width, height) {
  return [toClipX(x, width), toClipY(y, height), u, v];
}

function createRenderer(canvas, sourceImage, width, height) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true
  });
  if (!gl) throw new Error("当前设备无法创建视频画布");

  const program = createProgram(gl);
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  const textureLocation = gl.getUniformLocation(program, "u_texture");
  const colorLocation = gl.getUniformLocation(program, "u_color");
  const useTextureLocation = gl.getUniformLocation(program, "u_useTexture");
  const opacityLocation = gl.getUniformLocation(program, "u_opacity");
  const pointSizeLocation = gl.getUniformLocation(program, "u_pointSize");
  const roundPointLocation = gl.getUniformLocation(program, "u_roundPoint");

  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);
  gl.uniform1i(textureLocation, 0);
  gl.uniform1f(pointSizeLocation, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    sourceImage
  );

  const uploadVertices = (vertices) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  };

  const useSolidColor = (color, opacity = 1, roundPoint = false) => {
    gl.uniform1f(useTextureLocation, 0);
    gl.uniform4fv(colorLocation, color);
    gl.uniform1f(opacityLocation, opacity);
    gl.uniform1f(roundPointLocation, roundPoint ? 1 : 0);
  };

  const drawTextureRect = (rawRect, opacity = 1) => {
    const rect = normalizeRect(rawRect, width, height);
    if (!rect.width || !rect.height) return;
    const left = rect.x;
    const top = rect.y;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const u0 = left / width;
    const v0 = top / height;
    const u1 = right / width;
    const v1 = bottom / height;
    uploadVertices([
      ...makeVertex(left, top, u0, v0, width, height),
      ...makeVertex(right, top, u1, v0, width, height),
      ...makeVertex(left, bottom, u0, v1, width, height),
      ...makeVertex(left, bottom, u0, v1, width, height),
      ...makeVertex(right, top, u1, v0, width, height),
      ...makeVertex(right, bottom, u1, v1, width, height)
    ]);
    gl.uniform1f(useTextureLocation, 1);
    gl.uniform1f(opacityLocation, opacity);
    gl.uniform1f(roundPointLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const drawSolidRect = (x, y, rectWidth, rectHeight, color) => {
    const right = x + rectWidth;
    const bottom = y + rectHeight;
    uploadVertices([
      ...makeVertex(x, y, 0, 0, width, height),
      ...makeVertex(right, y, 0, 0, width, height),
      ...makeVertex(x, bottom, 0, 0, width, height),
      ...makeVertex(x, bottom, 0, 0, width, height),
      ...makeVertex(right, y, 0, 0, width, height),
      ...makeVertex(right, bottom, 0, 0, width, height)
    ]);
    useSolidColor(color, 1, false);
    gl.uniform1f(pointSizeLocation, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const drawSnow = (snowflakes, frameIndex) => {
    const groups = {};
    snowflakes.forEach((flake) => {
      const y = (flake.y + frameIndex * flake.speed) % (height + 20) - 10;
      const x = flake.x + Math.sin(frameIndex * 0.11 + flake.phase) * flake.drift;
      const size = Math.max(3, Math.round(flake.radius * 2));
      groups[size] = groups[size] || [];
      groups[size].push(
        toClipX(x, width),
        toClipY(y, height),
        0,
        0
      );
    });
    Object.keys(groups).forEach((rawSize) => {
      const vertices = groups[rawSize];
      uploadVertices(vertices);
      useSolidColor([1, 1, 1, 1], 0.72, true);
      gl.uniform1f(pointSizeLocation, Number(rawSize));
      gl.drawArrays(gl.POINTS, 0, vertices.length / 4);
    });
  };

  const drawStar = (star) => {
    if (!star) return;
    const centerX = Number(star.centerX || width / 2);
    const centerY = Number(star.centerY || 38);
    const outerRadius = Number(star.outerRadius || 28);
    const innerRadius = Number(star.innerRadius || 13);
    const rotation = Number(star.rotation || 0);
    const points = Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      const angle = rotation - Math.PI / 2 + index * Math.PI / 5;
      return {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      };
    });
    const vertices = [];
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      vertices.push(
        ...makeVertex(centerX, centerY, 0, 0, width, height),
        ...makeVertex(point.x, point.y, 0, 0, width, height),
        ...makeVertex(next.x, next.y, 0, 0, width, height)
      );
    });
    uploadVertices(vertices);
    useSolidColor(STAR_COLOR, Number(star.opacity || 0), false);
    gl.uniform1f(pointSizeLocation, 1);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
  };

  const render = (frame, snowflakes, frameIndex) => {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSolidRect(0, 0, width, height, BACKGROUND_COLOR);
    (frame.completed || []).forEach((rect) => drawTextureRect(rect, 1));
    if (frame.transition) {
      drawTextureRect(frame.transition.rect, frame.transition.opacity);
    }
    drawSnow(snowflakes, frameIndex);
    drawStar(frame.star);
    gl.flush();
  };

  const destroy = () => {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };

  return { render, destroy };
}

function invokeRecorder(recorder, method, eventName) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String((error || {}).errMsg || "视频录制失败")));
    };
    if (eventName && recorder.on) recorder.on(eventName, finish);
    try {
      const result = recorder[method]();
      if (result && typeof result.then === "function") result.then(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function requestRecorderFrame(recorder) {
  try {
    const result = recorder.requestFrame();
    if (result && typeof result.then === "function") return result;
    return Promise.reject(new Error("当前基础库不支持逐帧视频录制"));
  } catch (error) {
    return Promise.reject(error);
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function recordTreeVideo(options = {}) {
  if (!canRecordTreeVideo()) throw new Error("当前微信版本不支持本地视频生成");
  const width = Math.max(2, Math.floor(Number(options.width || 0) / 2) * 2);
  const height = Math.max(2, Math.floor(Number(options.height || 0) / 2) * 2);
  const sourcePath = String(options.sourcePath || "");
  if (!sourcePath || !width || !height) throw new Error("本地视频参数不完整");

  const rawRegions = options.regions || {};
  const regions = {
    people: normalizeRect(rawRegions.people, width, height),
    rows: (rawRegions.rows || []).map((rect) => normalizeRect(rect, width, height)),
    footer: normalizeRect(rawRegions.footer, width, height),
    star: rawRegions.star || {}
  };
  if (regions.rows.length !== 14) throw new Error("本地视频布局不完整");

  const canvas = wx.createOffscreenCanvas({
    type: "webgl",
    width,
    height
  });
  canvas.width = width;
  canvas.height = height;
  const sourceImage = await withTimeout(
    loadCanvasImage(canvas, sourcePath),
    10000,
    "本地视频画面读取超时"
  );
  const renderer = createRenderer(canvas, sourceImage, width, height);
  const { frames, frameRate } = buildTreeVideoFrames(regions, options.frameRate);
  const snowflakes = createSnowflakes(width, height);
  const recorder = wx.createMediaRecorder(canvas, {
    fps: frameRate,
    gop: frameRate,
    videoBitsPerSecond: 1600,
    width,
    height
  });
  if (!recorder) {
    renderer.destroy();
    throw new Error("本地视频录制器创建失败");
  }

  try {
    await withTimeout(
      invokeRecorder(recorder, "start", "start"),
      10000,
      "本地视频录制启动超时"
    );
    for (let index = 0; index < frames.length; index += 1) {
      await withTimeout(
        requestRecorderFrame(recorder),
        8000,
        "本地视频帧录制超时"
      );
      renderer.render(frames[index], snowflakes, index);
      if (typeof options.onProgress === "function") {
        options.onProgress({
          current: index + 1,
          total: frames.length,
          percent: Math.round((index + 1) / frames.length * 100)
        });
      }
    }
    const result = await withTimeout(
      invokeRecorder(recorder, "stop", "stop"),
      20000,
      "本地视频导出超时"
    );
    const tempFilePath = String((result || {}).tempFilePath || "");
    if (!tempFilePath) throw new Error("本地视频导出失败");
    return {
      tempFilePath,
      duration: Number((result || {}).duration || frames.length / frameRate),
      fileSize: Number((result || {}).fileSize || 0),
      frameCount: frames.length,
      frameRate
    };
  } finally {
    if (recorder.destroy) {
      try {
        const result = recorder.destroy();
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch (error) {}
    }
    renderer.destroy();
  }
}

module.exports = {
  buildTreeVideoFrames,
  canRecordTreeVideo,
  recordTreeVideo
};
