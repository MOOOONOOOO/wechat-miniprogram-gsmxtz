const { getLyrics } = require("../../utils/api");

const MAX_SELECTED_LINES = 6;

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
    trackTimeMillis: song.trackTimeMillis || (duration ? duration * 1000 : 0)
  };
}

function normalizeDuration(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num > 1000 ? num / 1000 : num);
}

function formatTime(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "";
  const minute = Math.floor(value / 60);
  const second = Math.floor(value % 60);
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function hasUsableLyrics(res) {
  return Boolean(res && Array.isArray(res.lines) && res.lines.some((line) => line && line.text));
}

function formatDebugValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatLyricsDebug(error, payload, elapsedMs) {
  const debug = (error && error.debug) || (error && error.result && error.result.debug) || null;
  const message = (error && error.message) || "未知错误";
  const lines = [
    "诊断信息",
    `前端等待：${elapsedMs}ms`,
    `歌曲：${formatDebugValue(payload.artistName)} - ${formatDebugValue(payload.trackName)}`,
    `专辑：${formatDebugValue(payload.albumName)}`,
    `时长：${formatDebugValue(payload.duration)}s`
  ];

  if (!debug) {
    lines.push("阶段：wx.cloud.callFunction 未拿到云函数返回");
    lines.push(`错误：${message}`);
    return lines.join("\n");
  }

  lines.push(`云函数总耗时：${formatDebugValue(debug.totalMs)}ms`);
  if (debug.result) {
    lines.push(`结果：${debug.result.ok ? "ok" : "fail"} ${formatDebugValue(debug.result.reason || debug.result.matchSource)}`);
    lines.push(`歌词行数：${formatDebugValue(debug.result.lineCount)}`);
  }

  (debug.steps || []).forEach((step) => {
    const parts = [
      `${step.name} ${step.ms}ms`,
      step.status ? `状态=${step.status}` : "",
      step.timeoutMs ? `上限=${step.timeoutMs}ms` : "",
      step.candidateCount !== undefined ? `候选=${step.candidateCount}` : "",
      step.bestScore !== undefined ? `分数=${step.bestScore}` : "",
      step.error ? `错误=${step.error}` : ""
    ].filter(Boolean);
    lines.push(parts.join(" / "));
  });

  return lines.join("\n");
}

function getLyricsResilient(payload) {
  return getLyrics(payload)
    .then((res) => {
      if (hasUsableLyrics(res)) return res;
      const error = new Error((res && res.message) || "暂时没有找到这首歌的歌词");
      error.result = res || null;
      error.debug = res && res.debug;
      throw error;
    });
}

function decorateLines(lines, selectedKeys) {
  const selectedMap = (selectedKeys || []).reduce((map, key) => {
    map[key] = true;
    return map;
  }, {});
  return (lines || []).map((line, index) => {
    const key = line.key || `line-${index}`;
    return {
      ...line,
      key,
      index,
      timeText: line.timeText || formatTime(line.time),
      selected: Boolean(selectedMap[key]),
      selectedClass: selectedMap[key] ? "selected" : "",
      paperStyle: `transform:rotate(${((index % 5) - 2) * 1.3}deg);`
    };
  });
}

function selectedLineText(lines, selectedKeys) {
  const selectedMap = (selectedKeys || []).reduce((map, key) => {
    map[key] = true;
    return map;
  }, {});
  return (lines || [])
    .filter((line) => selectedMap[line.key])
    .map((line) => line.text);
}

function selectedLineItems(lines, selectedKeys) {
  const selectedMap = (selectedKeys || []).reduce((map, key) => {
    map[key] = true;
    return map;
  }, {});
  return (lines || [])
    .filter((line) => selectedMap[line.key])
    .map((line) => ({
      key: line.key,
      index: line.index,
      text: line.text,
      time: line.time || 0,
      timeText: line.timeText || ""
    }));
}

Page({
  data: {
    song: null,
    loading: false,
    error: "",
    debugText: "",
    lyricLines: [],
    selectedKeys: [],
    selectedLyrics: [],
    selectedCountText: `0/${MAX_SELECTED_LINES}`,
    canNext: false
  },

  onLoad() {
    const app = getApp();
    const song = normalizeSong(app.globalData.lyricsShareSong || {});
    if (!song.name || !song.artistName) {
      wx.showToast({ title: "先选择歌曲", icon: "none" });
      wx.redirectTo({ url: "/pages/artists/artists?mode=lyrics" });
      return;
    }

    this.setData({ song }, () => this.fetchLyrics(song));
  },

  fetchLyrics(song) {
    const requestId = (this.lyricsRequestId || 0) + 1;
    this.lyricsRequestId = requestId;
    this.setData({
      loading: true,
      error: "",
      debugText: "",
      lyricLines: [],
      selectedKeys: [],
      selectedLyrics: [],
      selectedCountText: `0/${MAX_SELECTED_LINES}`,
      canNext: false
    });

    const payload = {
      trackId: song.trackId || song.songId || "",
      collectionId: song.collectionId || "",
      trackName: song.trackName || song.name,
      artistName: song.artistName,
      albumName: song.collectionName || song.album,
      duration: song.duration || song.trackTimeMillis
    };
    const startedAt = Date.now();

    getLyricsResilient(payload).then((res) => {
      if (this.lyricsRequestId !== requestId) return;
      const lines = (res.lines || [])
        .map((line, index) => ({
          ...line,
          key: `lyric-${index}`,
          text: String(line.text || "").trim()
        }))
        .filter((line) => line.text);

      if (!lines.length) {
        const error = new Error(res.message || "暂时没有找到这首歌的歌词");
        error.result = res;
        error.debug = res.debug || null;
        this.setData({
          error: error.message,
          debugText: formatLyricsDebug(error, payload, Date.now() - startedAt)
        });
        return;
      }

      this.setData({
        lyricLines: decorateLines(lines, []),
        error: "",
        debugText: ""
      });
    }).catch((error) => {
      if (this.lyricsRequestId !== requestId) return;
      this.setData({
        error: (error && error.message) || "歌词读取失败",
        debugText: formatLyricsDebug(error, payload, Date.now() - startedAt)
      });
    }).finally(() => {
      if (this.lyricsRequestId === requestId) this.setData({ loading: false });
    });
  },

  toggleLine(event) {
    const key = String((event.currentTarget || {}).dataset.key || "");
    if (!key) return;

    const selectedKeys = this.data.selectedKeys || [];
    const exists = selectedKeys.indexOf(key) >= 0;
    const nextKeys = exists
      ? selectedKeys.filter((item) => item !== key)
      : selectedKeys.concat(key);

    if (!exists && nextKeys.length > MAX_SELECTED_LINES) {
      wx.showToast({ title: `最多选择 ${MAX_SELECTED_LINES} 行`, icon: "none" });
      return;
    }

    this.applySelectedKeys(nextKeys);
  },

  applySelectedKeys(selectedKeys) {
    const lyricLines = decorateLines(this.data.lyricLines || [], selectedKeys);
    const selectedLyrics = selectedLineText(lyricLines, selectedKeys);
    this.setData({
      selectedKeys,
      lyricLines,
      selectedLyrics,
      selectedCountText: `${selectedLyrics.length}/${MAX_SELECTED_LINES}`,
      canNext: Boolean(selectedLyrics.length)
    });
  },

  chooseAnotherSong() {
    wx.navigateBack();
  },

  continueToShare() {
    if (!this.data.selectedLyrics.length) {
      wx.showToast({ title: "先选几句歌词", icon: "none" });
      return;
    }
    const app = getApp();
    const lyricLines = this.data.lyricLines || [];
    app.globalData.lyricsShareSelectedLyrics = this.data.selectedLyrics;
    app.globalData.lyricsShareSelectedLyricItems = selectedLineItems(lyricLines, this.data.selectedKeys);
    app.globalData.lyricsShareLyricLines = lyricLines.map((line) => ({
      key: line.key,
      index: line.index,
      text: line.text,
      time: line.time || 0,
      timeText: line.timeText || ""
    }));
    wx.navigateTo({ url: "/pages/lyrics-share/lyrics-share?from=lyrics" });
  }
});
