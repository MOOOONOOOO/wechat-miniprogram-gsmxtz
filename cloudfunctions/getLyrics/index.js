const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const CACHE_COLLECTION = "lyricsCache";
const SUCCESS_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_READ_TIMEOUT_MS = 300;
const EXACT_REQUEST_TIMEOUT_MS = 12000;
const SEARCH_REQUEST_TIMEOUT_MS = 12000;
const REQUEST_TIMEOUT_MS = 12000;
const FUNCTION_SOFT_TIMEOUT_MS = 16500;
const MIN_REQUEST_TIMEOUT_MS = 800;
const LRCLIB_HOST = "lrclib.net";
const CLIENT_NAME = "wechat-miniprogram-gsmxtz lyrics share";
const ARTIST_ALIASES = [
  {
    test: /蔡依林|jolin/i,
    names: ["Jolin Tsai", "蔡依林"]
  }
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, " ")
    .replace(/[·・.。'’`"“”\-_/\\[\]【】:：]+/g, "");
}

function cleanSongName(value) {
  return String(value || "")
    .replace(/\s*\((official|audio|mv|live|伴奏|纯音乐|remaster(ed)?|explicit|clean)[^)]+\)\s*/ig, " ")
    .replace(/\s*\[(official|audio|mv|live|伴奏|纯音乐|remaster(ed)?|explicit|clean)[^\]]+\]\s*/ig, " ")
    .trim();
}

function uniqueList(values) {
  const seen = {};
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function artistNameVariants(value) {
  const raw = String(value || "").trim();
  const aliases = [];
  ARTIST_ALIASES.forEach((item) => {
    if (item.test.test(raw)) aliases.push(...item.names);
  });
  const variants = aliases.length ? aliases.concat(raw) : [raw];
  const cjk = raw.match(/[\u3400-\u9fff][\u3400-\u9fff\s·・]*/g);
  const latin = raw.match(/[A-Za-z][A-Za-z\s.'-]*/g);
  if (cjk) variants.push(...cjk.map((item) => item.trim()));
  if (latin) variants.push(...latin.map((item) => item.trim()));
  return uniqueList(variants).slice(0, 4);
}

function normalizeDuration(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num > 1000 ? num / 1000 : num);
}

function hashKey(key) {
  return crypto.createHash("md5").update(key).digest("hex");
}

function normalizedCacheKey(input) {
  return [
    "meta",
    normalizeText(input.artistName),
    normalizeText(input.trackName),
    normalizeText(input.albumName),
    normalizeDuration(input.duration)
  ].join("|");
}

function cacheKeys(input) {
  const keys = [];
  const trackId = String(input.trackId || input.songId || "").trim();
  if (trackId && trackId.indexOf("fallback-") !== 0) keys.push(`track|${trackId}`);
  keys.push(normalizedCacheKey(input));
  return keys
    .filter(Boolean)
    .filter((key, index, list) => list.indexOf(key) === index)
    .map((key) => hashKey(key));
}

function withTimeout(promise, timeout, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeout);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function createDebug(input) {
  return {
    function: "getLyrics",
    startedAt: new Date().toISOString(),
    input: {
      hasTrackId: Boolean(input.trackId),
      trackName: input.trackName,
      artistName: input.artistName,
      albumName: input.albumName,
      duration: input.duration
    },
    timeouts: {
      cacheRead: CACHE_READ_TIMEOUT_MS,
      exact: EXACT_REQUEST_TIMEOUT_MS,
      search: SEARCH_REQUEST_TIMEOUT_MS
    },
    steps: []
  };
}

function addDebugStep(debug, name, startedAt, extra = {}) {
  if (!debug || !Array.isArray(debug.steps)) return;
  debug.steps.push({
    name,
    ms: Date.now() - startedAt,
    ...extra
  });
}

function finishDebug(debug, result) {
  if (!debug) return null;
  const started = Date.parse(debug.startedAt);
  return {
    ...debug,
    finishedAt: new Date().toISOString(),
    totalMs: Number.isFinite(started) ? Date.now() - started : 0,
    result: {
      ok: Boolean(result && result.ok),
      reason: (result && result.reason) || "",
      matchSource: (result && result.matchSource) || "",
      lineCount: Array.isArray(result && result.lines) ? result.lines.length : 0
    }
  };
}

function attachDebug(payload, debug) {
  if (!payload || !debug) return payload;
  return {
    ...payload,
    debug: finishDebug(debug, payload)
  };
}

function remainingTimeout(deadline, desired) {
  const remaining = deadline - Date.now() - 500;
  if (remaining < MIN_REQUEST_TIMEOUT_MS) return 0;
  return Math.min(desired, remaining);
}

function requestJson(path, params = {}, timeout = REQUEST_TIMEOUT_MS) {
  const query = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const requestPath = `${path}?${query.toString()}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      callback(value);
    };
    const req = https.request({
      hostname: LRCLIB_HOST,
      path: requestPath,
      method: "GET",
      timeout,
      headers: {
        "Accept": "application/json",
        "User-Agent": CLIENT_NAME,
        "X-User-Agent": CLIENT_NAME,
        "Lrclib-Client": CLIENT_NAME
      }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 404) {
          finish(resolve, null);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          finish(reject, new Error(`LRCLIB ${res.statusCode}`));
          return;
        }
        try {
          finish(resolve, JSON.parse(body));
        } catch (error) {
          finish(reject, error);
        }
      });
    });

    const hardTimer = setTimeout(() => {
      if (!settled) req.destroy(new Error("LRCLIB request timeout"));
    }, timeout);
    req.on("timeout", () => {
      req.destroy(new Error("LRCLIB request timeout"));
    });
    req.on("error", (error) => finish(reject, error));
    req.end();
  });
}

function parseSyncedLyrics(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => {
      const matched = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!matched) return null;
      const minute = Number(matched[1]) || 0;
      const second = Number(matched[2]) || 0;
      const textValue = String(matched[3] || "").trim();
      if (!textValue) return null;
      return {
        time: Math.round((minute * 60 + second) * 100) / 100,
        text: textValue
      };
    })
    .filter(Boolean);
}

function parsePlainLyrics(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter((line) => line && line.length <= 80)
    .map((line, index) => ({
      time: 0,
      index,
      text: line
    }));
}

function normalizeLines(record) {
  const synced = parseSyncedLyrics(record && record.syncedLyrics);
  const plain = parsePlainLyrics(record && record.plainLyrics);
  const lines = synced.length ? synced : plain;
  const seen = {};
  return lines
    .filter((line) => {
      const key = `${line.time}:${line.text}`;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .slice(0, 180)
    .map((line, index) => ({
      ...line,
      index
    }));
}

function scoreRecord(record, input) {
  if (!record) return 0;
  let score = 0;
  const trackInput = normalizeText(cleanSongName(input.trackName));
  const artistInputs = artistNameVariants(input.artistName).map(normalizeText).filter(Boolean);
  const albumInput = normalizeText(input.albumName);
  const recordTrack = normalizeText(cleanSongName(record.trackName));
  const recordArtist = normalizeText(record.artistName);
  const recordAlbum = normalizeText(record.albumName);
  const duration = normalizeDuration(input.duration);
  const recordDuration = normalizeDuration(record.duration);

  if (trackInput && recordTrack === trackInput) score += 42;
  else if (trackInput && recordTrack.indexOf(trackInput) >= 0) score += 24;
  if (artistInputs.some((artistInput) => recordArtist === artistInput)) score += 34;
  else if (artistInputs.some((artistInput) => recordArtist.indexOf(artistInput) >= 0 || artistInput.indexOf(recordArtist) >= 0)) score += 18;
  if (albumInput && recordAlbum === albumInput) score += 8;
  if (duration && recordDuration) {
    const diff = Math.abs(duration - recordDuration);
    if (diff <= 2) score += 24;
    else if (diff <= 5) score += 12;
  }
  if (record.syncedLyrics) score += 5;
  if (record.plainLyrics) score += 3;
  return score;
}

function buildResponse(record, input, source) {
  const lines = normalizeLines(record);
  if (!record || !lines.length) {
    return {
      ok: false,
      reason: record && record.instrumental ? "instrumental" : "not_found",
      message: record && record.instrumental ? "这首歌可能是纯音乐" : "暂时没有找到这首歌的歌词"
    };
  }
  const score = scoreRecord(record, input);
  return {
    ok: true,
    source: "lrclib",
    matchSource: source,
    confidence: Math.max(0.3, Math.min(0.99, Math.round(score) / 100)),
    lrclibId: record.id || "",
    trackName: record.trackName || input.trackName || "",
    artistName: record.artistName || input.artistName || "",
    albumName: record.albumName || input.albumName || "",
    duration: normalizeDuration(record.duration || input.duration),
    instrumental: Boolean(record.instrumental),
    plainLyrics: record.plainLyrics || "",
    syncedLyrics: record.syncedLyrics || "",
    lines
  };
}

async function readCache(id) {
  try {
    const res = await db.collection(CACHE_COLLECTION).doc(id).get();
    const data = res.data || {};
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
    const payload = data.payload || null;
    if (payload && payload.ok === false) return null;
    if (expiresAt && expiresAt > Date.now()) return payload;
  } catch (error) {}
  return null;
}

async function writeCache(id, payload) {
  if (!payload || payload.ok !== true) return;
  const ttl = SUCCESS_CACHE_MS;
  try {
    await db.collection(CACHE_COLLECTION).doc(id).set({
      data: {
        payload,
        updatedAt: db.serverDate(),
        expiresAt: new Date(Date.now() + ttl)
      }
    });
  } catch (error) {
    console.warn("write lyrics cache failed", error);
  }
}

async function fetchLyrics(input, debug, deadline) {
  const duration = normalizeDuration(input.duration);
  const artists = artistNameVariants(input.artistName);
  const primaryArtistName = artists[0] || input.artistName;
  const params = {
    track_name: cleanSongName(input.trackName),
    artist_name: primaryArtistName,
    duration
  };
  if (duration > 0) {
    const exactTimeout = remainingTimeout(deadline, EXACT_REQUEST_TIMEOUT_MS);
    const exactStartedAt = Date.now();
    if (exactTimeout) {
      const exactRecord = await requestJson("/api/get", params, exactTimeout)
        .then((record) => {
          addDebugStep(debug, "lrclib.get", exactStartedAt, {
            ok: Boolean(record),
            timeoutMs: exactTimeout,
            status: record ? "hit" : "miss"
          });
          return record;
        })
        .catch((error) => {
          addDebugStep(debug, "lrclib.get", exactStartedAt, {
            ok: false,
            timeoutMs: exactTimeout,
            status: "error",
            error: String((error && error.message) || error || "")
          });
          return null;
        });
      const exactResponse = buildResponse(exactRecord, input, "get");
      if (exactResponse.ok) return exactResponse;
    } else {
      addDebugStep(debug, "lrclib.get", exactStartedAt, {
        ok: false,
        status: "skipped",
        reason: "soft_timeout"
      });
    }
  } else {
    addDebugStep(debug, "lrclib.get", Date.now(), {
      ok: false,
      status: "skipped",
      reason: "duration_missing"
    });
  }

  const searchTimeout = remainingTimeout(deadline, SEARCH_REQUEST_TIMEOUT_MS);
  const searchStartedAt = Date.now();
  if (!searchTimeout) {
    addDebugStep(debug, "lrclib.search", searchStartedAt, {
      ok: false,
      status: "skipped",
      reason: "soft_timeout"
    });
    return {
      ok: false,
      reason: "request_timeout",
      message: "歌词查询超时，请稍后再试"
    };
  }

  let searchRows = [];
  let usedArtistName = "";
  let searchError = "";
  for (let index = 0; index < artists.length; index += 1) {
    const artistName = artists[index];
    const attemptTimeout = remainingTimeout(deadline, searchTimeout);
    if (!attemptTimeout) break;
    const rows = await requestJson("/api/search", {
      track_name: cleanSongName(input.trackName),
      artist_name: artistName
    }, attemptTimeout)
      .catch((error) => {
        searchError = String((error && error.message) || error || "");
        return [];
      });
    if (Array.isArray(rows) && rows.length) {
      searchRows = rows;
      usedArtistName = artistName;
      break;
    }
  }
  addDebugStep(debug, "lrclib.search", searchStartedAt, {
    ok: Boolean(searchRows.length),
    timeoutMs: searchTimeout,
    artistVariants: artists.join(" / "),
    usedArtistName,
    candidateCount: Array.isArray(searchRows) ? searchRows.length : 0,
    error: searchError
  });
  const candidates = Array.isArray(searchRows) ? searchRows : [];
  const best = candidates
    .map((record) => ({ record, score: scoreRecord(record, input) }))
    .sort((a, b) => b.score - a.score)[0];
  addDebugStep(debug, "score", Date.now(), {
    ok: Boolean(best),
    bestScore: best ? best.score : 0,
    accepted: Boolean(best && best.score >= 58)
  });
  if (best && best.score >= 58) {
    const searchResponse = buildResponse(best.record, input, "search");
    if (searchResponse.ok) return searchResponse;
  }

  return buildResponse(null, input, "search");
}

exports.main = async (event = {}) => {
  const input = {
    trackId: String(event.trackId || event.songId || "").trim(),
    songId: String(event.songId || event.trackId || "").trim(),
    collectionId: String(event.collectionId || "").trim(),
    trackName: String(event.trackName || event.name || "").trim(),
    artistName: String(event.artistName || "").trim(),
    albumName: String(event.albumName || event.collectionName || event.album || "").trim(),
    duration: normalizeDuration(event.duration || event.trackTimeMillis)
  };

  if (!input.trackName || !input.artistName) {
    return {
      ok: false,
      reason: "bad_request",
      message: "歌曲信息不完整"
    };
  }

  const debug = createDebug(input);
  const deadline = Date.now() + FUNCTION_SOFT_TIMEOUT_MS;
  const ids = cacheKeys(input);
  const cacheStartedAt = Date.now();
  const cached = await withTimeout(Promise.all(ids.map(readCache)).then((records) => records.find(Boolean) || null), CACHE_READ_TIMEOUT_MS, null);
  addDebugStep(debug, "cache.read", cacheStartedAt, {
    ok: Boolean(cached),
    timeoutMs: CACHE_READ_TIMEOUT_MS,
    keyCount: ids.length
  });
  if (cached) return attachDebug(cached, debug);

  const payload = await fetchLyrics(input, debug, deadline).catch((error) => {
    console.warn("fetch lyrics failed", error);
    addDebugStep(debug, "fetch", Date.now(), {
      ok: false,
      error: String((error && error.message) || error || "")
    });
    return {
      ok: false,
      reason: "request_failed",
      message: "歌词服务暂时不可用"
    };
  });
  writeCache(ids[0], payload).catch(() => {});
  return attachDebug(payload, debug);
};
