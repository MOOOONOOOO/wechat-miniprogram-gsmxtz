const { getLyrics } = require("./api");

const CACHE_KEY = "rainLetterLyricsCache:v1";
const FALLBACK_LINE_COUNT = 3;
const MAX_CACHE_ENTRIES = 40;

function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String((line && line.text) || line || "").trim())
    .filter(Boolean)
    .slice(0, FALLBACK_LINE_COUNT);
}

function songIdentity(song = {}) {
  return String(
    song.trackId
    || song.songId
    || `${song.artistName || ""}:${song.name || song.trackName || ""}`
  ).trim();
}

function readCache() {
  try {
    const cache = wx.getStorageSync(CACHE_KEY);
    return cache && typeof cache === "object" ? cache : {};
  } catch (error) {
    return {};
  }
}

function writeCache(identity, lyrics) {
  if (!identity || !lyrics.length) return;
  try {
    const cache = readCache();
    cache[identity] = {
      lyrics,
      savedAtMs: Date.now()
    };
    const entries = Object.keys(cache)
      .map((key) => ({ key, value: cache[key] }))
      .sort((left, right) => (
        Number((right.value || {}).savedAtMs || 0)
        - Number((left.value || {}).savedAtMs || 0)
      ))
      .slice(0, MAX_CACHE_ENTRIES);
    const next = entries.reduce((result, entry) => {
      result[entry.key] = entry.value;
      return result;
    }, {});
    wx.setStorageSync(CACHE_KEY, next);
  } catch (error) {}
}

function hydrateRainLetterSong(song = {}) {
  const normalized = {
    ...song,
    name: song.name || song.trackName || "",
    trackName: song.trackName || song.name || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    collectionName: song.collectionName || song.album || "",
    lyrics: cleanLines(song.lyrics)
  };
  if (normalized.lyrics.length || !normalized.name || !normalized.artistName) {
    return Promise.resolve(normalized);
  }

  const identity = songIdentity(normalized);
  const cachedLyrics = cleanLines((readCache()[identity] || {}).lyrics);
  if (cachedLyrics.length) {
    return Promise.resolve({
      ...normalized,
      lyrics: cachedLyrics
    });
  }

  return getLyrics({
    trackId: normalized.trackId || normalized.songId || "",
    collectionId: normalized.collectionId || "",
    trackName: normalized.trackName,
    artistName: normalized.artistName,
    albumName: normalized.collectionName,
    duration: normalized.duration || normalized.trackTimeMillis || 0
  }).then((result) => {
    const lyrics = cleanLines((result && result.lines) || []);
    if (!lyrics.length) return normalized;
    writeCache(identity, lyrics);
    return {
      ...normalized,
      lyrics
    };
  }).catch((error) => {
    console.warn("hydrate rain letter lyrics failed", error);
    return normalized;
  });
}

module.exports = {
  hydrateRainLetterSong
};
