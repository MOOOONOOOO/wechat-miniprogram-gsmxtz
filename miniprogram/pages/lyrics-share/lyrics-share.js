const STYLE_TABS = [
  { id: "poem", name: "诗句" },
  { id: "apple", name: "毛玻璃" },
  { id: "liquid", name: "液态玻璃" },
  { id: "netease", name: "一般样式" },
  { id: "mla", name: "明信片" },
];

const DEFAULT_PALETTE = {
  dark: { r: 123, g: 93, b: 79 },
  mid: { r: 80, g: 96, b: 139 },
  light: { r: 115, g: 174, b: 188 }
};

function pickCover(song) {
  return (song && (song.cover || song.artworkUrl600 || song.artworkUrl100 || song.albumCover || song.imageUrl)) || "";
}

function normalizeSong(song = {}) {
  const duration = Number(song.duration || 0) || (song.trackTimeMillis ? Math.round(Number(song.trackTimeMillis) / 1000) : 0);
  return {
    ...song,
    trackName: song.trackName || song.name || "",
    name: song.name || song.trackName || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    collectionName: song.collectionName || song.album || "",
    cover: pickCover(song),
    duration,
    durationText: duration ? `${duration}s` : ""
  };
}

function clampText(text, fallback) {
  const value = String(text || "").trim();
  return value || fallback;
}

function textVisualWidthRpx(text, fontSize = 38) {
  return String(text || "").split("").reduce((sum, char) => {
    if (/\s/.test(char)) return sum + fontSize * 0.35;
    if (/[\x00-\xff]/.test(char)) return sum + fontSize * 0.55;
    return sum + fontSize;
  }, 0);
}

function appleCardWidthRpx(lines) {
  const firstLine = String((lines || [])[0] || "");
  const measuredLine = firstLine.length > 12 ? firstLine.slice(0, 12) : firstLine;
  const targetWidth = Math.ceil(textVisualWidthRpx(measuredLine, 38) + 92);
  return Math.max(478, Math.min(620, targetWidth));
}

function buildAppleCardStyle(lines) {
  return `width:${appleCardWidthRpx(lines)}rpx;`;
}

function splitLyricLine(text, limit = 12) {
  const chars = String(text || "").split("");
  const lines = [];
  for (let i = 0; i < chars.length; i += limit) {
    lines.push(chars.slice(i, i + limit).join(""));
  }
  return lines.length ? lines : [""];
}

function buildAppleLyricsLines(lines) {
  return (lines || [])
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .reduce((result, line) => result.concat(line.length > 12 ? splitLyricLine(line, 12) : [line]), []);
}

function normalizeLineItem(line, index) {
  if (typeof line === "string") {
    return {
      key: `line-${index}`,
      index,
      text: line
    };
  }
  return {
    key: line.key || `line-${index}`,
    index: Number.isFinite(Number(line.index)) ? Number(line.index) : index,
    text: String(line.text || "").trim(),
    time: line.time || 0,
    timeText: line.timeText || ""
  };
}

function buildPoemSegments(allLines, selectedItems, selectedLyrics) {
  const normalizedSelected = (selectedItems || [])
    .map(normalizeLineItem)
    .filter((line) => line.text);
  const selectedIndexMap = normalizedSelected.reduce((map, line) => {
    map[line.index] = true;
    return map;
  }, {});
  const normalizedLines = (allLines || [])
    .map(normalizeLineItem)
    .filter((line) => line.text);

  if (normalizedLines.length && normalizedSelected.length) {
    const indexes = normalizedSelected.map((line) => line.index).sort((a, b) => a - b);
    const start = Math.max(0, indexes[0] - 1);
    const end = Math.min(normalizedLines.length - 1, indexes[indexes.length - 1] + 1);
    return normalizedLines
      .filter((line) => line.index >= start && line.index <= end)
      .map((line) => ({
        text: line.text,
        highlighted: Boolean(selectedIndexMap[line.index]),
        highlightClass: selectedIndexMap[line.index] ? "highlight" : ""
      }));
  }

  return (selectedLyrics || [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      highlighted: true,
      highlightClass: "highlight"
    }));
}

function toRgbVar(color) {
  return `${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}`;
}

function mix(a, b, amount) {
  return {
    r: Math.round(a.r * (1 - amount) + b.r * amount),
    g: Math.round(a.g * (1 - amount) + b.g * amount),
    b: Math.round(a.b * (1 - amount) + b.b * amount)
  };
}

function getBrightness(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getSaturation(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function extractPaletteFromPixels(pixels) {
  const colors = [];
  for (let i = 0; i < pixels.length; i += 24) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a < 180) continue;
    const brightness = getBrightness(r, g, b);
    const saturation = getSaturation(r, g, b);
    if (saturation > 14) colors.push({ r, g, b, brightness, saturation });
  }
  if (!colors.length) return DEFAULT_PALETTE;
  colors.sort((a, b) => a.brightness - b.brightness);
  return {
    dark: colors[Math.floor(colors.length * 0.16)] || DEFAULT_PALETTE.dark,
    mid: colors[Math.floor(colors.length * 0.55)] || DEFAULT_PALETTE.mid,
    light: colors[Math.floor(colors.length * 0.82)] || DEFAULT_PALETTE.light
  };
}

function paletteStyle(palette) {
  const safePalette = palette || DEFAULT_PALETTE;
  const cardA = mix(safePalette.light, { r: 255, g: 255, b: 255 }, 0.82);
  const cardB = mix(safePalette.mid, { r: 255, g: 255, b: 255 }, 0.84);
  const cardC = mix(safePalette.dark, { r: 255, g: 255, b: 255 }, 0.90);
  return [
    `--lyrics-bg-a:${toRgbVar(safePalette.dark)}`,
    `--lyrics-bg-b:${toRgbVar(safePalette.light)}`,
    `--lyrics-bg-c:${toRgbVar(safePalette.mid)}`,
    `--lyrics-card-a:${toRgbVar(cardA)}`,
    `--lyrics-card-b:${toRgbVar(cardB)}`,
    `--lyrics-card-c:${toRgbVar(cardC)}`
  ].join(";");
}

function drawRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function clipRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.clip();
}

function drawShadowRoundRect(ctx, x, y, width, height, radius, fillStyle, shadow = {}) {
  ctx.save();
  ctx.shadowColor = shadow.color || "rgba(30,38,56,.16)";
  ctx.shadowBlur = shadow.blur || 28;
  ctx.shadowOffsetX = shadow.offsetX || 0;
  ctx.shadowOffsetY = shadow.offsetY || 16;
  drawRoundRect(ctx, x, y, width, height, radius, fillStyle);
  ctx.restore();
}

function drawCover(ctx, image, x, y, size) {
  drawRoundRect(ctx, x, y, size, size, 10, "#d8d2c8");
  if (!image) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
}

function setCanvasFont(ctx, fontSize, weight = "normal") {
  ctx.font = `${weight} ${fontSize}px sans-serif`;
  ctx.textBaseline = "alphabetic";
}

function fitText(ctx, text, x, y, maxWidth, fontSize, minSize) {
  let size = fontSize;
  const value = String(text || "");
  setCanvasFont(ctx, size);
  while (size > minSize && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    setCanvasFont(ctx, size);
  }
  ctx.fillText(value, x, y);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
  const lines = String(text || "").split("\n").filter(Boolean);
  const maxLines = options.maxLines || 8;
  let currentY = y;
  let drawn = 0;
  lines.forEach((sourceLine) => {
    let current = "";
    String(sourceLine).split("").forEach((char) => {
      const next = `${current}${char}`;
      if (ctx.measureText(next).width > maxWidth && current) {
        if (drawn < maxLines) {
          ctx.fillText(current, x, currentY);
          currentY += lineHeight;
          drawn += 1;
        }
        current = char;
      } else {
        current = next;
      }
    });
    if (current && drawn < maxLines) {
      ctx.fillText(current, x, currentY);
      currentY += lineHeight;
      drawn += 1;
    }
  });
  return currentY;
}

function drawInlineSegments(ctx, segments, x, y, maxWidth, lineHeight, options = {}) {
  const maxLines = options.maxLines || Number.MAX_SAFE_INTEGER;
  let currentX = x;
  let currentY = y;
  let lineCount = 1;
  let stopped = false;
  (segments || []).forEach((segment, segmentIndex) => {
    if (stopped) return;
    const text = `${segment.text}${segmentIndex < segments.length - 1 ? " / " : ""}`;
    String(text).split("").forEach((char) => {
      if (stopped) return;
      setCanvasFont(ctx, options.fontSize || 34, segment.highlighted ? "900" : "700");
      const charWidth = ctx.measureText(char).width;
      if (currentX > x && currentX + charWidth > x + maxWidth) {
        if (lineCount >= maxLines) {
          stopped = true;
          return;
        }
        currentX = x;
        currentY += lineHeight;
        lineCount += 1;
      }
      if (lineCount > maxLines) {
        stopped = true;
        return;
      }
      ctx.fillStyle = segment.highlighted ? "#111111" : "rgba(0,0,0,.42)";
      ctx.fillText(char, currentX, currentY);
      currentX += charWidth;
    });
  });
}

function estimateCanvasLineCount(text, maxWidth, fontSize) {
  const lines = String(text || "").split("\n").filter(Boolean);
  if (!lines.length) return 1;
  return lines.reduce((total, line) => {
    const width = textVisualWidthRpx(line, fontSize);
    return total + Math.max(1, Math.ceil(width / maxWidth));
  }, 0);
}

function estimateInlineSegmentLineCount(segments, maxWidth, fontSize) {
  const text = (segments || [])
    .map((segment) => String(segment && segment.text || ""))
    .filter(Boolean)
    .join(" / ");
  if (!text) return 1;
  return Math.max(1, Math.ceil(textVisualWidthRpx(text, fontSize) / maxWidth));
}

function pickInlineLayout(segments, maxWidth, maxHeight) {
  const candidates = [
    { fontSize: 34, lineHeight: 58 },
    { fontSize: 32, lineHeight: 54 },
    { fontSize: 30, lineHeight: 50 },
    { fontSize: 28, lineHeight: 47 },
    { fontSize: 26, lineHeight: 44 }
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    const lineCount = estimateInlineSegmentLineCount(segments, maxWidth, item.fontSize);
    const cardHeight = 250 + lineCount * item.lineHeight;
    if (cardHeight <= maxHeight) {
      return {
        ...item,
        lineCount,
        cardHeight
      };
    }
  }
  const fallback = candidates[candidates.length - 1];
  const lineCount = estimateInlineSegmentLineCount(segments, maxWidth, fallback.fontSize);
  return {
    ...fallback,
    lineCount,
    cardHeight: Math.min(maxHeight, 250 + lineCount * fallback.lineHeight)
  };
}

function pickBlockTextLayout(text, maxWidth, maxHeight, sizes) {
  const candidates = sizes || [
    { fontSize: 44, lineHeight: 58 },
    { fontSize: 41, lineHeight: 54 },
    { fontSize: 38, lineHeight: 50 },
    { fontSize: 35, lineHeight: 46 },
    { fontSize: 32, lineHeight: 42 }
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    const lineCount = estimateCanvasLineCount(text, maxWidth, item.fontSize);
    const cardHeight = 214 + lineCount * item.lineHeight;
    if (cardHeight <= maxHeight) {
      return {
        ...item,
        lineCount,
        cardHeight
      };
    }
  }
  const fallback = candidates[candidates.length - 1];
  const lineCount = estimateCanvasLineCount(text, maxWidth, fallback.fontSize);
  return {
    ...fallback,
    lineCount,
    cardHeight: Math.min(maxHeight, 214 + lineCount * fallback.lineHeight)
  };
}

function squareCardLayout(width) {
  return {
    x: 92,
    y: 188,
    size: width - 184,
    radius: 32
  };
}

function compactCardLayout(width, height, contentHeight) {
  const size = width - 184;
  const cardHeight = Math.min(size, contentHeight);
  return {
    x: 92,
    y: Math.round((height - cardHeight) / 2),
    width: size,
    height: cardHeight,
    radius: 32
  };
}

function getImageInfo(src) {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve(res),
      fail: () => resolve(null)
    });
  });
}

function loadCanvasImage(canvas, src) {
  if (!src || !canvas || !canvas.createImage) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function getCanvasCover(canvas, src) {
  if (!src) return Promise.resolve(null);
  return getImageInfo(src)
    .then((imageInfo) => loadCanvasImage(canvas, (imageInfo && imageInfo.path) || src))
    .catch(() => null);
}

function canvasConfig(style) {
  if (style === "apple") return { width: 750, height: 1000 };
  if (style === "liquid") return { width: 750, height: 1000 };
  if (style === "netease") return { width: 750, height: 1000 };
  if (style === "mla") return { width: 1000, height: 667 };
  return { width: 900, height: 900 };
}

Page({
  data: {
    query: "",
    songs: [],
    searchLoading: false,
    searchEmpty: false,
    selectedSong: null,
    lyricsLoading: false,
    lyricsError: "",
    lyricLines: [],
    selectedKeys: [],
    selectedLyrics: [],
    selectedLyricsText: "",
    selectedLyricsInline: "",
    manualText: "",
    showManualInput: false,
    appleCardStyle: buildAppleCardStyle([]),
    appleLyricsLines: [],
    coverPalette: DEFAULT_PALETTE,
    previewPaletteStyle: paletteStyle(DEFAULT_PALETTE),
    poemLyricSegments: [],
    styles: STYLE_TABS.map((item, index) => ({ ...item, activeClass: index === 0 ? "active" : "" })),
    activeStyle: "poem",
    canSave: false,
    canvasStyle: "width:900px;height:900px;"
  },

  onLoad() {
    this.updateCanvasStyle("poem");
    this.hydrateFromGlobal();
  },

  onReady() {
    this.canvasReady = true;
    this.refreshCoverPalette();
  },

  onShow() {
    if (!this.data.selectedSong) this.hydrateFromGlobal(true);
  },

  hydrateFromGlobal(silent = false) {
    const app = getApp();
    const selectedSong = normalizeSong(app.globalData.lyricsShareSong || {});
    const selectedLyrics = (app.globalData.lyricsShareSelectedLyrics || [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    const selectedLyricItems = (app.globalData.lyricsShareSelectedLyricItems || [])
      .map(normalizeLineItem)
      .filter((line) => line.text);
    const lyricLines = (app.globalData.lyricsShareLyricLines || [])
      .map(normalizeLineItem)
      .filter((line) => line.text);

    if (!selectedSong.name || !selectedSong.artistName || !selectedLyrics.length) {
      if (!silent) {
        wx.showToast({ title: "先选择歌曲和歌词", icon: "none" });
        wx.redirectTo({ url: "/pages/artists/artists?mode=lyrics" });
      }
      return;
    }

    this.setData({
      query: "",
      songs: [],
      searchLoading: false,
      searchEmpty: false,
      selectedSong,
      lyricsLoading: false,
      lyricsError: "",
      lyricLines: [],
      selectedKeys: [],
      selectedLyrics,
      selectedLyricsText: selectedLyrics.join("\n"),
      selectedLyricsInline: selectedLyrics.join(" / "),
      appleCardStyle: buildAppleCardStyle(selectedLyrics),
      appleLyricsLines: buildAppleLyricsLines(selectedLyrics),
      poemLyricSegments: buildPoemSegments(lyricLines, selectedLyricItems, selectedLyrics),
      manualText: "",
      showManualInput: false,
      canSave: true
    }, () => this.refreshCoverPalette());
  },

  reselectLyrics() {
    wx.navigateBack();
  },

  setStyle(event) {
    const style = String((event.currentTarget || {}).dataset.style || "apple");
    this.setData({
      activeStyle: style,
      styles: STYLE_TABS.map((item) => ({
        ...item,
        activeClass: item.id === style ? "active" : ""
      }))
    });
    this.updateCanvasStyle(style);
  },

  updateCanvasStyle(style) {
    const config = canvasConfig(style);
    this.setData({
      canvasStyle: `width:${config.width}px;height:${config.height}px;`
    });
  },

  refreshCoverPalette() {
    const song = this.data.selectedSong || {};
    const cover = pickCover(song);
    if (!cover || !this.canvasReady) return;
    const requestId = (this.paletteRequestId || 0) + 1;
    this.paletteRequestId = requestId;
    this.getPosterCanvas({ width: 80, height: 80 })
      .then(({ canvas, ctx }) => (
        getCanvasCover(canvas, cover).then((image) => {
          if (this.paletteRequestId !== requestId) return;
          if (!image) {
            this.setData({
              coverPalette: DEFAULT_PALETTE,
              previewPaletteStyle: paletteStyle(DEFAULT_PALETTE)
            });
            return;
          }
          ctx.clearRect(0, 0, 80, 80);
          ctx.drawImage(image, 0, 0, 80, 80);
          const imageData = ctx.getImageData(0, 0, 80, 80);
          const palette = extractPaletteFromPixels(imageData.data);
          this.setData({
            coverPalette: palette,
            previewPaletteStyle: paletteStyle(palette)
          });
        })
      ))
      .catch(() => {
        if (this.paletteRequestId === requestId) {
          this.setData({
            coverPalette: DEFAULT_PALETTE,
            previewPaletteStyle: paletteStyle(DEFAULT_PALETTE)
          });
        }
      });
  },

  saveImage() {
    if (!this.data.canSave) {
      wx.showToast({ title: "先选几句歌词", icon: "none" });
      return;
    }
    wx.showLoading({ title: "生成中" });
    this.drawPoster()
      .then((filePath) => new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject
        });
      }))
      .then(() => {
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => {
        wx.showToast({ title: "保存失败，请检查权限", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  drawPoster() {
    const style = this.data.activeStyle || "apple";
    const config = canvasConfig(style);
    const song = this.data.selectedSong || {};
    const lyrics = (this.data.selectedLyrics || []).join("\n");
    return this.getPosterCanvas(config).then(({ canvas, ctx }) => (
      getCanvasCover(canvas, pickCover(song)).then((coverImage) => (
        new Promise((resolve, reject) => {
          ctx.clearRect(0, 0, config.width, config.height);
          this.drawPosterByStyle(ctx, style, config, song, lyrics, coverImage);
          wx.canvasToTempFilePath({
            canvas,
            width: config.width,
            height: config.height,
            destWidth: config.width,
            destHeight: config.height,
            success: (res) => resolve(res.tempFilePath),
            fail: reject
          }, this);
        })
      ))
    ));
  },

  getPosterCanvas(config) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select("#lyricsPosterCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error("canvas not found"));
            return;
          }
          canvas.width = config.width;
          canvas.height = config.height;
          const ctx = canvas.getContext("2d");
          resolve({ canvas, ctx });
        });
    });
  },

  drawPosterByStyle(ctx, style, config, song, lyrics, coverImage) {
    const title = clampText(song.trackName || song.name, "未命名歌曲");
    const artist = clampText(song.artistName, "未知歌手");
    const lyricText = clampText(lyrics, "在歌里截住这一刻");
    const width = config.width;
    const height = config.height;

    if (style === "apple") {
      const palette = this.data.coverPalette || DEFAULT_PALETTE;
      const appleLyricText = (this.data.appleLyricsLines && this.data.appleLyricsLines.length
        ? this.data.appleLyricsLines
        : this.data.selectedLyrics || []
      ).join("\n");
      setCanvasFont(ctx, 48, "700");
      const measuredLine = String((appleLyricText.split("\n") || [])[0] || "").slice(0, 12);
      const appleCardWidth = Math.max(520, Math.min(width - 104, Math.ceil(ctx.measureText(measuredLine).width + 112)));
      const appleTextLayout = pickBlockTextLayout(
        clampText(appleLyricText, lyricText),
        appleCardWidth - 76,
        height - 180,
        [
          { fontSize: 48, lineHeight: 62 },
          { fontSize: 44, lineHeight: 58 },
          { fontSize: 40, lineHeight: 53 },
          { fontSize: 36, lineHeight: 48 },
          { fontSize: 32, lineHeight: 43 },
          { fontSize: 29, lineHeight: 39 }
        ]
      );
      const appleCardHeight = Math.min(height - 180, Math.max(420, appleTextLayout.cardHeight + 38));
      const appleCardX = Math.round((width - appleCardWidth) / 2);
      const appleCardY = Math.round((height - appleCardHeight) / 2);
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, `rgb(${toRgbVar(palette.dark)})`);
      bg.addColorStop(0.42, `rgb(${toRgbVar(mix(palette.dark, palette.light, 0.34))})`);
      bg.addColorStop(1, `rgb(${toRgbVar(palette.mid)})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const glowA = ctx.createRadialGradient(width * 0.78, height * 0.16, 0, width * 0.78, height * 0.16, width * 0.72);
      glowA.addColorStop(0, `rgba(${toRgbVar(palette.light)}, .42)`);
      glowA.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glowA;
      ctx.fillRect(0, 0, width, height);
      const glowB = ctx.createRadialGradient(width * 0.2, height * 0.86, 0, width * 0.2, height * 0.86, width * 0.78);
      glowB.addColorStop(0, `rgba(${toRgbVar(palette.mid)}, .52)`);
      glowB.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glowB;
      ctx.fillRect(0, 0, width, height);
      drawShadowRoundRect(ctx, appleCardX, appleCardY, appleCardWidth, appleCardHeight, 34, "rgba(34,38,48,.66)", {
        color: "rgba(0,0,0,.18)",
        blur: 34,
        offsetY: 18
      });
      ctx.save();
      clipRoundRect(ctx, appleCardX, appleCardY, appleCardWidth, appleCardHeight, 34);
      ctx.fillStyle = "#fffdfa";
      setCanvasFont(ctx, appleTextLayout.fontSize, "700");
      const appleSongY = appleCardY + appleCardHeight - 140;
      wrapText(ctx, clampText(appleLyricText, lyricText), appleCardX + 38, appleCardY + 64, appleCardWidth - 76, appleTextLayout.lineHeight, { maxLines: appleTextLayout.lineCount + 2 });
      ctx.fillStyle = "rgba(20,38,54,.36)";
      ctx.fillRect(appleCardX, appleSongY, appleCardWidth, 140);
      drawCover(ctx, coverImage, appleCardX + 38, appleSongY + 40, 78);
      ctx.fillStyle = "#fffdfa";
      setCanvasFont(ctx, 34, "700");
      fitText(ctx, title, appleCardX + 134, appleSongY + 72, appleCardWidth - 190, 34, 24);
      setCanvasFont(ctx, 30, "700");
      fitText(ctx, artist, appleCardX + 134, appleSongY + 114, appleCardWidth - 190, 30, 22);
      ctx.restore();
      return;
    }

    if (style === "liquid") {
      const palette = this.data.coverPalette || DEFAULT_PALETTE;
      const cardWidth = width - 184;
      const innerWidth = cardWidth - 96;
      const textLayout = pickBlockTextLayout(lyricText, innerWidth, height - 172);
      const cardHeight = Math.min(height - 172, Math.max(390, textLayout.cardHeight));
      const card = {
        x: Math.round((width - cardWidth) / 2),
        y: Math.round((height - cardHeight) / 2),
        width: cardWidth,
        height: cardHeight,
        radius: 42
      };
      const innerX = card.x + 48;
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, `rgba(${toRgbVar(palette.light)}, .34)`);
      bg.addColorStop(0.48, "#fffdfa");
      bg.addColorStop(1, `rgba(${toRgbVar(palette.mid)}, .30)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const glowA = ctx.createRadialGradient(width * 0.18, height * 0.18, 0, width * 0.18, height * 0.18, width * 0.55);
      glowA.addColorStop(0, "rgba(255,255,255,.72)");
      glowA.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glowA;
      ctx.fillRect(0, 0, width, height);
      const glowB = ctx.createRadialGradient(width * 0.84, height * 0.84, 0, width * 0.84, height * 0.84, width * 0.62);
      glowB.addColorStop(0, `rgba(${toRgbVar(palette.mid)}, .30)`);
      glowB.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glowB;
      ctx.fillRect(0, 0, width, height);

      drawShadowRoundRect(ctx, card.x, card.y, card.width, card.height, card.radius, "rgba(255,255,255,.72)", {
        color: "rgba(30,38,56,.18)",
        blur: 42,
        offsetY: 20
      });

      drawCover(ctx, coverImage, innerX, card.y + 50, 64);
      ctx.fillStyle = "rgba(17,17,17,.88)";
      setCanvasFont(ctx, 30, "900");
      fitText(ctx, title, innerX + 88, card.y + 76, innerWidth - 88, 30, 22);
      ctx.fillStyle = "rgba(17,17,17,.48)";
      setCanvasFont(ctx, 25, "800");
      fitText(ctx, artist, innerX + 88, card.y + 112, innerWidth - 88, 25, 18);
      ctx.fillStyle = "rgba(17,17,17,.86)";
      setCanvasFont(ctx, textLayout.fontSize, "900");
      wrapText(ctx, lyricText, innerX, card.y + 184, innerWidth, textLayout.lineHeight, { maxLines: textLayout.lineCount + 2 });
      return;
    }

    if (style === "netease") {
      const estimatedLines = estimateCanvasLineCount(lyricText, width - 276, 35);
      const card = compactCardLayout(width, height, 190 + Math.min(estimatedLines, 6) * 45);
      const innerX = card.x + 46;
      const innerWidth = card.width - 92;
      ctx.fillStyle = "#777777";
      ctx.fillRect(0, 0, width, height);
      drawShadowRoundRect(ctx, card.x, card.y, card.width, card.height, card.radius, "#c7c7c7", {
        color: "rgba(0,0,0,.18)",
        blur: 28,
        offsetY: 14
      });
      drawCover(ctx, coverImage, innerX, card.y + 42, 58);
      ctx.fillStyle = "#222222";
      setCanvasFont(ctx, 30, "700");
      fitText(ctx, title, innerX + 78, card.y + 68, innerWidth - 78, 30, 22);
      ctx.fillStyle = "rgba(0,0,0,.48)";
      setCanvasFont(ctx, 25);
      fitText(ctx, artist, innerX + 78, card.y + 102, innerWidth - 78, 25, 20);
      ctx.strokeStyle = "rgba(0,0,0,.12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(innerX, card.y + 140);
      ctx.lineTo(card.x + card.width - 46, card.y + 140);
      ctx.stroke();
      ctx.fillStyle = "#111111";
      setCanvasFont(ctx, 35, "700");
      wrapText(ctx, lyricText, innerX, card.y + 196, innerWidth, 45, { maxLines: 6 });
      return;
    }

    if (style === "mla") {
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#050505";
      setCanvasFont(ctx, 72, "900");
      fitText(ctx, title, 46, 110, width - 92, 72, 42);
      setCanvasFont(ctx, 42);
      wrapText(ctx, lyricText, 46, 230, width - 92, 68, { maxLines: 4 });
      drawCover(ctx, coverImage, 46, height - 166, 112);
      ctx.fillStyle = "#050505";
      setCanvasFont(ctx, 34);
      fitText(ctx, title, 184, height - 118, 420, 34, 24);
      ctx.fillStyle = "#050505";
      setCanvasFont(ctx, 30);
      fitText(ctx, artist, 184, height - 72, 420, 30, 22);
      return;
    }

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#dfeee3");
    bg.addColorStop(0.55, "#fffdfa");
    bg.addColorStop(1, "#e7e0d6");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const poemInnerWidth = width - 240;
    const poemLayout = pickInlineLayout(this.data.poemLyricSegments, poemInnerWidth, height - 156);
    const poemCardHeight = Math.min(height - 156, Math.max(424, poemLayout.cardHeight));
    const poemCard = {
      x: 78,
      y: Math.round((height - poemCardHeight) / 2),
      width: width - 156,
      height: poemCardHeight,
      radius: 34
    };
    const cardGlow = ctx.createRadialGradient(width * 0.28, height * 0.18, 0, width * 0.28, height * 0.18, width * 0.52);
    cardGlow.addColorStop(0, "rgba(61,127,90,.16)");
    cardGlow.addColorStop(1, "rgba(61,127,90,0)");
    ctx.fillStyle = cardGlow;
    ctx.fillRect(0, 0, width, height);
    drawShadowRoundRect(ctx, poemCard.x, poemCard.y, poemCard.width, poemCard.height, poemCard.radius, "rgba(255,255,255,.86)", {
      color: "rgba(30,38,56,.16)",
      blur: 42,
      offsetY: 18
    });
    ctx.save();
    clipRoundRect(ctx, poemCard.x, poemCard.y, poemCard.width, poemCard.height, poemCard.radius);
    drawCover(ctx, coverImage, poemCard.x + 42, poemCard.y + 56, 76);
    ctx.fillStyle = "#111111";
    setCanvasFont(ctx, 34, "700");
    fitText(ctx, `${artist} - ${title}`, poemCard.x + 138, poemCard.y + 105, poemCard.width - 184, 34, 22);
    drawInlineSegments(ctx, this.data.poemLyricSegments, poemCard.x + 42, poemCard.y + 205, poemCard.width - 84, poemLayout.lineHeight, {
      maxLines: poemLayout.lineCount + 2,
      fontSize: poemLayout.fontSize
    });
    ctx.restore();
  },

  onShareAppMessage() {
    return {
      title: "把一句歌词做成卡片",
      path: "/pages/home/home"
    };
  }
});
