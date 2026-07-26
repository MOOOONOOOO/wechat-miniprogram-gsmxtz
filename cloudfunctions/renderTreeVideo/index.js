const cloud = require("wx-server-sdk");
const HME = require("h264-mp4-encoder");
const jpeg = require("jpeg-js");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BACKGROUND = [237, 237, 237, 255];
const STAR_COLOR = [244, 191, 55, 255];
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 720;
const MAX_HEIGHT = 1400;

function includesCloudPath(fileID, path) {
  return String(fileID || "").replace(/\\/g, "/").includes(path);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeRect(rect, width, height) {
  const x = Math.floor(clamp((rect || {}).x, 0, width));
  const y = Math.floor(clamp((rect || {}).y, 0, height));
  const right = Math.ceil(clamp(x + Number((rect || {}).width || 0), x, width));
  const bottom = Math.ceil(clamp(y + Number((rect || {}).height || 0), y, height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function createBackground(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = BACKGROUND[0];
    data[index + 1] = BACKGROUND[1];
    data[index + 2] = BACKGROUND[2];
    data[index + 3] = BACKGROUND[3];
  }
  return data;
}

function copyRegion(target, source, rect, width) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const start = (y * width + rect.x) * 4;
    const end = start + rect.width * 4;
    target.set(source.subarray(start, end), start);
  }
}

function blendRegion(target, source, rect, width, alpha) {
  const inverse = 1 - alpha;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    let offset = (y * width + rect.x) * 4;
    const end = offset + rect.width * 4;
    for (; offset < end; offset += 4) {
      target[offset] = Math.round(target[offset] * inverse + source[offset] * alpha);
      target[offset + 1] = Math.round(target[offset + 1] * inverse + source[offset + 1] * alpha);
      target[offset + 2] = Math.round(target[offset + 2] * inverse + source[offset + 2] * alpha);
      target[offset + 3] = 255;
    }
  }
}

function blendPixel(frame, width, height, x, y, color, alpha) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const inverse = 1 - alpha;
  frame[offset] = Math.round(frame[offset] * inverse + color[0] * alpha);
  frame[offset + 1] = Math.round(frame[offset + 1] * inverse + color[1] * alpha);
  frame[offset + 2] = Math.round(frame[offset + 2] * inverse + color[2] * alpha);
  frame[offset + 3] = 255;
}

function drawCircle(frame, width, height, centerX, centerY, radius, color, alpha) {
  const minX = Math.floor(centerX - radius);
  const maxX = Math.ceil(centerX + radius);
  const minY = Math.floor(centerY - radius);
  const maxY = Math.ceil(centerY + radius);
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        blendPixel(frame, width, height, x, y, color, alpha);
      }
    }
  }
}

function createSnowflakes(width, height, count = 54) {
  return Array.from({ length: count }, (_, index) => ({
    x: (index * 137 + 29) % width,
    y: (index * 211 + 43) % height,
    radius: 1.4 + (index * 7) % 4,
    speed: 1.7 + ((index * 13) % 19) / 10,
    drift: 7 + (index * 5) % 13,
    phase: (index * 0.73) % (Math.PI * 2),
    opacity: 0.48 + ((index * 11) % 34) / 100
  }));
}

function drawSnow(frame, width, height, snowflakes, frameIndex) {
  snowflakes.forEach((flake) => {
    const y = (flake.y + frameIndex * flake.speed) % (height + 20) - 10;
    const x = flake.x + Math.sin(frameIndex * 0.11 + flake.phase) * flake.drift;
    drawCircle(frame, width, height, x, y, flake.radius, [255, 255, 255, 255], flake.opacity);
  });
}

function getStarPoints(centerX, centerY, outerRadius, innerRadius, rotation) {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation - Math.PI / 2 + index * Math.PI / 5;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  });
}

function isPointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects = (
      (currentPoint.y > y) !== (previousPoint.y > y)
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y)
        / ((previousPoint.y - currentPoint.y) || 1) + currentPoint.x
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

function drawStar(frame, width, height, star, rotation, opacity) {
  const points = getStarPoints(
    Number(star.centerX || width / 2),
    Number(star.centerY || 38),
    Number(star.outerRadius || 28),
    Number(star.innerRadius || 13),
    rotation
  );
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isPointInPolygon(x + 0.5, y + 0.5, points)) {
        blendPixel(frame, width, height, x, y, STAR_COLOR, opacity);
      }
    }
  }
}

function addDecoratedFrame(encoder, baseFrame, width, height, snowflakes, frameIndex, starState = null) {
  const frame = new Uint8Array(baseFrame);
  drawSnow(frame, width, height, snowflakes, frameIndex);
  if (starState) {
    drawStar(
      frame,
      width,
      height,
      starState.star,
      starState.rotation,
      starState.opacity
    );
  }
  encoder.addFrameRgba(frame);
}

async function encodeTreeVideo(source, regions, requestedFrameRate) {
  const decoded = jpeg.decode(source, { useTArray: true, formatAsRGBA: true });
  const width = decoded.width - decoded.width % 2;
  const height = decoded.height - decoded.height % 2;
  if (!width || !height || width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new Error("动画母版尺寸不符合要求");
  }

  const sourceFrame = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * decoded.width * 4;
    sourceFrame.set(decoded.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }

  const frameRate = Math.round(clamp(requestedFrameRate || 12, 10, 15));
  const encoder = await HME.createH264MP4Encoder();
  encoder.width = width;
  encoder.height = height;
  encoder.frameRate = frameRate;
  encoder.quantizationParameter = 24;
  encoder.outputFilename = "tree-result.mp4";
  encoder.initialize();

  const current = createBackground(width, height);
  const snowflakes = createSnowflakes(width, height);
  let frameIndex = 0;
  const addFrame = (frame, starState) => {
    addDecoratedFrame(encoder, frame, width, height, snowflakes, frameIndex, starState);
    frameIndex += 1;
  };
  const hold = (count, starStateFactory) => {
    for (let index = 0; index < count; index += 1) {
      addFrame(current, starStateFactory ? starStateFactory(index) : null);
    }
  };
  const reveal = (rawRect, transitionFrames) => {
    const rect = normalizeRect(rawRect, width, height);
    if (!rect.width || !rect.height) return;
    for (let step = 1; step <= transitionFrames; step += 1) {
      const frame = new Uint8Array(current);
      blendRegion(frame, sourceFrame, rect, width, step / transitionFrames);
      addFrame(frame);
    }
    copyRegion(current, sourceFrame, rect, width);
  };

  try {
    hold(3);
    reveal(regions.people, 7);
    hold(2);
    (regions.rows || []).forEach((rect) => reveal(rect, 2));
    reveal(regions.footer, 4);

    const star = regions.star || {};
    const starFrames = frameRate * 2;
    hold(starFrames, (index) => ({
      star,
      opacity: Math.min(1, (index + 1) / 5),
      rotation: index / starFrames * Math.PI * 2
    }));
    hold(frameRate, (index) => ({
      star,
      opacity: 1,
      rotation: (starFrames + index) / starFrames * Math.PI * 2
    }));

    encoder.finalize();
    return {
      fileContent: Buffer.from(encoder.FS.readFile(encoder.outputFilename)),
      width,
      height,
      frameRate
    };
  } finally {
    encoder.delete();
  }
}

async function cleanupVideo(fileID, openId) {
  if (!includesCloudPath(fileID, `/tree-videos/${openId}/`)
    && !includesCloudPath(fileID, `tree-videos/${openId}/`)) {
    return { ok: false, message: "无权清理该视频" };
  }
  await cloud.deleteFile({ fileList: [fileID] });
  return { ok: true };
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID || "anonymous";
  if (event.action === "cleanup") {
    return cleanupVideo(String(event.fileID || ""), openId);
  }

  const sourceFileID = String(event.sourceFileID || "");
  if (!sourceFileID || (
    !includesCloudPath(sourceFileID, "/tree-video-sources/")
    && !includesCloudPath(sourceFileID, "tree-video-sources/")
  )) {
    return { ok: false, message: "动画母版无效" };
  }

  const download = await cloud.downloadFile({ fileID: sourceFileID });
  const source = download.fileContent;
  if (!source || source.length > MAX_SOURCE_BYTES) {
    return { ok: false, message: "动画母版过大" };
  }

  const regions = event.regions || {};
  if (!regions.people || !Array.isArray(regions.rows) || regions.rows.length !== 14) {
    return { ok: false, message: "动画布局不完整" };
  }

  const video = await encodeTreeVideo(source, regions, event.frameRate);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const cloudPath = `tree-videos/${openId}/${suffix}.mp4`;
  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: video.fileContent
  });
  return {
    ok: true,
    fileID: upload.fileID,
    width: video.width,
    height: video.height,
    frameRate: video.frameRate
  };
};
