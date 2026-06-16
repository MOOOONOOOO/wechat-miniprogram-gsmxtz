const ARTIST_COVER_COLLECTION = "artistCoverCache";
const COVER_ASSET_COLLECTION = "coverAssetCache";
const ARTIST_SONG_LIST_COLLECTION = "artistSongListCache";
const ALBUM_SONG_LIST_COLLECTION = "albumSongListCache";
const LOCAL_ARTIST_COVER_KEY = "artistCoverCacheLocal:v1";
const LOCAL_ARTIST_COVER_MISS_KEY = "artistCoverMissLocal:v1";
const LOCAL_COVER_ASSET_KEY = "coverAssetCacheLocal:v1";
const LOCAL_ARTIST_SONG_LIST_KEY = "artistSongListCacheLocal:v1";
const LOCAL_ALBUM_SONG_LIST_KEY = "albumSongListCacheLocal:v1";
const BATCH_SIZE = 20;
const DEFAULT_SONG_LIST_TIMEOUT_MS = 250;
const SONG_LIST_CACHE_VERSION = 2;
const LOCAL_MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const LOCAL_MISS_CACHE_MAX = 600;

function safeGetStorage(key) {
  try {
    return wx.getStorageSync(key) || {};
  } catch (error) {
    return {};
  }
}

function safeSetStorage(key, value) {
  try {
    wx.setStorageSync(key, value || {});
  } catch (error) {}
}

function unique(values) {
  const seen = {};
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function chunk(values, size = BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getDb() {
  if (!wx.cloud || !wx.cloud.database) return null;
  try {
    return wx.cloud.database();
  } catch (error) {
    return null;
  }
}

function artwork600(url) {
  return url ? String(url).replace("100x100bb", "600x600bb") : "";
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：]+/g, "");
}

function splitNames(value) {
  return String(value || "")
    .split(/[\/／,，&＆|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const EQUIVALENT_ARTIST_GROUPS = [
  {
    ids: ["1297155868", "300117902"],
    names: ["安溥", "张悬", "張懸", "焦安溥"]
  }
];

function isSameArtistName(name, targets) {
  const normalizedName = normalizeName(name);
  const normalizedTargets = (targets || []).map(normalizeName).filter(Boolean);
  return Boolean(normalizedName && normalizedTargets.some((target) => normalizedName === target));
}

function findEquivalentArtistGroupById(id) {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return EQUIVALENT_ARTIST_GROUPS.find((group) => group.ids.indexOf(safeId) >= 0) || null;
}

function findEquivalentArtistGroupByName(name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  return EQUIVALENT_ARTIST_GROUPS.find((group) => (
    group.names.some((alias) => normalizeName(alias) === normalizedName)
  )) || null;
}

function getRawArtistNames(artist) {
  return unique([
    artist && artist.artistName,
    artist && artist.name,
    artist && artist.searchTerm,
    artist && artist.resolvedArtistName,
    artist && artist.itunesArtistName,
    artist && artist.displayArtistName
  ].reduce((list, value) => list.concat(splitNames(value), value), []));
}

function getArtistIds(artist) {
  const ids = unique([
    artist && artist.artistId,
    artist && artist.itunesArtistId
  ]);
  const equivalentIds = ids.concat(getRawArtistNames(artist)).reduce((list, value) => {
    const idGroup = findEquivalentArtistGroupById(value);
    const nameGroup = findEquivalentArtistGroupByName(value);
    const group = idGroup || nameGroup;
    return group ? list.concat(group.ids) : list;
  }, []);
  return unique(ids.concat(equivalentIds));
}

function getArtistNames(artist) {
  const names = getRawArtistNames(artist);
  const ids = unique([
    artist && artist.artistId,
    artist && artist.itunesArtistId
  ]);
  const equivalentNames = ids.concat(names).reduce((list, value) => {
    const idGroup = findEquivalentArtistGroupById(value);
    const nameGroup = findEquivalentArtistGroupByName(value);
    const group = idGroup || nameGroup;
    return group ? list.concat(group.names) : list;
  }, []);
  return unique(names.concat(equivalentNames));
}

function getArtistCoverCacheKeys(artist) {
  return unique(
    getArtistIds(artist).map((id) => `artistId:${id}`)
      .concat(getArtistNames(artist).map((name) => `artistName:${name}`))
  );
}

function getEquivalentArtistGroupForTarget(artist) {
  const ids = unique([
    artist && artist.artistId,
    artist && artist.itunesArtistId
  ]);
  const names = getRawArtistNames(artist);
  return (
    ids.map(findEquivalentArtistGroupById).find(Boolean) ||
    names.map(findEquivalentArtistGroupByName).find(Boolean) ||
    null
  );
}

function hasCompleteEquivalentArtistSongs(songs, group) {
  if (!group) return true;
  const songArtistIds = unique((songs || []).map((song) => song && song.artistId));
  return group.ids.every((id) => songArtistIds.indexOf(id) >= 0);
}

function interleaveByArtist(items, artistIds) {
  const ids = unique(artistIds);
  if (ids.length < 2) return items;

  const buckets = ids.map(() => []);
  const rest = [];
  const idIndex = ids.reduce((map, id, index) => {
    map[id] = index;
    return map;
  }, {});

  items.forEach((item) => {
    const artistId = String((item && item.artistId) || "").trim();
    const bucketIndex = idIndex[artistId];
    if (bucketIndex === undefined) rest.push(item);
    else buckets[bucketIndex].push(item);
  });

  const mixed = [];
  while (buckets.some((bucket) => bucket.length)) {
    buckets.forEach((bucket) => {
      if (bucket.length) mixed.push(bucket.shift());
    });
  }
  return mixed.concat(rest);
}

function pruneMissCache(cache) {
  const now = Date.now();
  const entries = Object.keys(cache || {})
    .map((key) => ({ key, record: cache[key] || {} }))
    .filter((item) => Number(item.record.expiresAt || 0) > now)
    .sort((a, b) => Number(b.record.updatedAt || 0) - Number(a.record.updatedAt || 0));
  return entries.slice(0, LOCAL_MISS_CACHE_MAX).reduce((map, item) => {
    map[item.key] = item.record;
    return map;
  }, {});
}

function hasRecentArtistCoverMiss(artist) {
  const keys = getArtistCoverCacheKeys(artist);
  if (!keys.length) return false;
  const cache = safeGetStorage(LOCAL_ARTIST_COVER_MISS_KEY);
  const now = Date.now();
  return keys.some((key) => Number((cache[key] || {}).expiresAt || 0) > now);
}

function rememberArtistCoverMiss(artist) {
  const keys = getArtistCoverCacheKeys(artist);
  if (!keys.length) return;
  const now = Date.now();
  const cache = pruneMissCache(safeGetStorage(LOCAL_ARTIST_COVER_MISS_KEY));
  keys.forEach((key) => {
    cache[key] = {
      updatedAt: now,
      expiresAt: now + LOCAL_MISS_TTL_MS
    };
  });
  safeSetStorage(LOCAL_ARTIST_COVER_MISS_KEY, pruneMissCache(cache));
}

function clearArtistCoverMiss(artist) {
  const keys = getArtistCoverCacheKeys(artist);
  if (!keys.length) return;
  const cache = safeGetStorage(LOCAL_ARTIST_COVER_MISS_KEY);
  let changed = false;
  keys.forEach((key) => {
    if (cache[key]) {
      delete cache[key];
      changed = true;
    }
  });
  if (changed) safeSetStorage(LOCAL_ARTIST_COVER_MISS_KEY, cache);
}

function hasArtistTarget(context) {
  return Boolean(getArtistIds(context).length || getArtistNames(context).length);
}

function hasTrustedArtistId(context) {
  if (!getArtistIds(context).length) return false;
  const localId = String((context && context.id) || "");
  return (
    Boolean(context && context.trustedArtistId) ||
    localId.indexOf("itunes-") === 0 ||
    Boolean(context && (context.resolvedArtistName || context.itunesArtistName || context.sourceArtistName)) ||
    !getArtistNames(context).length
  );
}

function matchesArtistTarget(item, context) {
  if (!hasArtistTarget(context)) return true;

  const ids = getArtistIds(context);
  const itemIds = getArtistIds(item);
  if (ids.length && hasTrustedArtistId(context)) {
    return ids.some((id) => itemIds.indexOf(id) >= 0);
  }

  return isSameArtistName((item && (item.artistName || item.name)) || "", getArtistNames(context));
}

function filterSongsForArtistContext(songs, context) {
  const safeSongs = Array.isArray(songs) ? songs : [];
  if (!hasArtistTarget(context)) return safeSongs;
  return safeSongs.filter((song) => matchesArtistTarget(song, context));
}

function filterAlbumsForArtistContext(albums, context) {
  const safeAlbums = Array.isArray(albums) ? albums : [];
  if (!hasArtistTarget(context)) return safeAlbums;
  return safeAlbums.filter((album) => matchesArtistTarget(album, context));
}

function getLocalArtistCover(artist) {
  const cache = safeGetStorage(LOCAL_ARTIST_COVER_KEY);
  const ids = getArtistIds(artist);
  const names = getArtistNames(artist);
  const hitById = ids.map((id) => cache[`artistId:${id}`]).find(Boolean);
  if (hitById && isTrustedArtistCover(artist, hitById)) return hitById;
  return names.map((name) => cache[`artistName:${name}`]).find((hit) => isTrustedArtistCover(artist, hit)) || null;
}

function rememberArtistCover(record) {
  if (!record || !record.coverUrl) return;
  const cache = safeGetStorage(LOCAL_ARTIST_COVER_KEY);
  getArtistCoverCacheKeys(record).forEach((key) => {
    cache[key] = record;
  });
  safeSetStorage(LOCAL_ARTIST_COVER_KEY, cache);
  clearArtistCoverMiss(record);
}

function rememberCoverAssets(records) {
  if (!records || !records.length) return;
  const cache = safeGetStorage(LOCAL_COVER_ASSET_KEY);
  records.forEach((record) => {
    if (record && record.collectionId) cache[String(record.collectionId)] = record;
  });
  safeSetStorage(LOCAL_COVER_ASSET_KEY, cache);
}

function getLocalSongList(mode, id) {
  const key = mode === "album" ? LOCAL_ALBUM_SONG_LIST_KEY : LOCAL_ARTIST_SONG_LIST_KEY;
  const cache = safeGetStorage(key);
  return cache[String(id || "")] || null;
}

function rememberSongList(mode, record) {
  if (!record || !record._id || !Array.isArray(record.songs)) return;
  const key = mode === "album" ? LOCAL_ALBUM_SONG_LIST_KEY : LOCAL_ARTIST_SONG_LIST_KEY;
  const cache = safeGetStorage(key);
  cache[String(record._id)] = record;
  safeSetStorage(key, cache);
}

function matchArtistRecord(artist, record) {
  const ids = getArtistIds(artist);
  const names = getArtistNames(artist);
  const recordIds = getArtistIds(record);
  const recordNames = getArtistNames(record);
  if (ids.some((id) => recordIds.indexOf(id) >= 0)) return true;
  return names.some((name) => recordNames.indexOf(name) >= 0);
}

function isTrustedArtistCover(artist, cover) {
  if (!cover) return false;

  const ids = getArtistIds(artist);
  const coverIds = getArtistIds(cover);
  if (ids.length && hasTrustedArtistId(artist)) {
    return ids.some((id) => coverIds.indexOf(id) >= 0);
  }

  const names = getArtistNames(artist);
  if (!names.length) return true;

  const coverNames = getArtistNames(cover);
  const hasVerifiedSourceName = Boolean(cover.sourceArtistName || cover.resolvedArtistName || cover.itunesArtistName);
  if (coverIds.length && !hasVerifiedSourceName) return false;

  return names.some((name) => (
    coverNames.indexOf(name) >= 0 ||
    isSameArtistName(cover.sourceArtistName, [name]) ||
    isSameArtistName(cover.resolvedArtistName, [name]) ||
    isSameArtistName(cover.itunesArtistName, [name])
  ));
}

async function queryByIn(collection, field, values) {
  const db = getDb();
  if (!db || !values.length) return [];
  const _ = db.command;
  const results = [];
  for (const part of chunk(values)) {
    try {
      const res = await db.collection(collection).where({
        [field]: _.in(part)
      }).get();
      results.push(...(res.data || []));
    } catch (error) {}
  }
  return results;
}

async function getExistingIds(collection, ids) {
  const rows = await queryByIn(collection, "_id", unique(ids));
  return rows.reduce((map, row) => {
    if (row && row._id) map[String(row._id)] = true;
    return map;
  }, {});
}

async function addMissing(collectionName, records) {
  const db = getDb();
  const safeRecords = (records || []).filter((record) => record && record._id);
  if (!db || !safeRecords.length) return;

  const existing = await getExistingIds(collectionName, safeRecords.map((record) => record._id));
  const missing = safeRecords.filter((record) => !existing[String(record._id)]);
  await Promise.all(missing.map((record) => (
    db.collection(collectionName).add({ data: record }).catch(() => {})
  )));
}

function isFallbackSong(song) {
  if (!song) return false;
  const trackId = String(song.trackId || "");
  const album = String(song.album || song.collectionName || "");
  const cover = song.cover || song.artworkUrl600 || song.artworkUrl100 || "";
  return (
    trackId.indexOf("fallback-") === 0 ||
    album.indexOf("云端兜底曲库") >= 0 ||
    (!cover && /^代表作[一二三四五六七八九十]/.test(String(song.name || song.trackName || "")))
  );
}

function normalizeSongForList(song) {
  if (!song || !song.trackId) return null;
  if (isFallbackSong(song)) return null;
  const duration = Number(song.duration || 0) || (song.trackTimeMillis ? Math.round(Number(song.trackTimeMillis) / 1000) : 0);
  return {
    trackId: String(song.trackId),
    name: song.name || song.trackName || "",
    trackName: song.trackName || song.name || "",
    artistId: String(song.artistId || "").trim(),
    artistName: song.artistName || "",
    collectionId: String(song.collectionId || "").trim(),
    collectionName: song.collectionName || song.album || "",
    album: song.album || song.collectionName || "",
    cover: artwork600(song.cover || song.artworkUrl600 || song.artworkUrl100 || ""),
    trackNumber: song.trackNumber || 0,
    trackTimeMillis: song.trackTimeMillis || (duration ? duration * 1000 : 0),
    duration
  };
}

function normalizeSongsForList(songs) {
  return (Array.isArray(songs) ? songs : [])
    .map(normalizeSongForList)
    .filter((song) => song && song.trackId && song.name);
}

function getSongListSubjectId(subject, mode) {
  if (mode === "album") return String((subject && subject.collectionId) || "").trim();
  return String((subject && (subject.artistId || subject.itunesArtistId)) || "").trim();
}

async function resolveArtistSongListId(subject) {
  const existing = getSongListSubjectId(subject, "artist");
  if (existing && hasTrustedArtistId(subject)) return existing;

  const localCover = getLocalArtistCover(subject);
  const localId = localCover && getSongListSubjectId(localCover, "artist");
  if (localId) return localId;

  const cloudHits = await readArtistCovers([subject]);
  const cloudCover = cloudHits && subject && cloudHits[subject.id];
  return getSongListSubjectId(cloudCover, "artist");
}

async function readSongListRecord(collectionName, id) {
  const db = getDb();
  if (!db || !id) return null;
  try {
    const res = await db.collection(collectionName).doc(String(id)).get();
    return res.data || null;
  } catch (error) {
    return null;
  }
}

function withTimeout(promise, timeout = DEFAULT_SONG_LIST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeout);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value || null);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function readDefaultSongList(subject, mode = "artist") {
  const safeMode = mode === "album" ? "album" : "artist";
  const id = safeMode === "album" ? getSongListSubjectId(subject, safeMode) : await resolveArtistSongListId(subject);
  if (!id) return null;

  const local = getLocalSongList(safeMode, id);
  const safeLocal = sanitizeSongListRecord(subject, safeMode, local);
  if (safeLocal && safeLocal.songs.length) return safeLocal;

  const collection = safeMode === "album" ? ALBUM_SONG_LIST_COLLECTION : ARTIST_SONG_LIST_COLLECTION;
  const cloudRecord = await readSongListRecord(collection, id);
  const safeCloudRecord = sanitizeSongListRecord(subject, safeMode, cloudRecord);
  if (safeCloudRecord && safeCloudRecord.songs.length) {
    rememberSongList(safeMode, safeCloudRecord);
    return safeCloudRecord;
  }
  return null;
}

function readDefaultSongListWithTimeout(subject, mode = "artist", timeout = DEFAULT_SONG_LIST_TIMEOUT_MS) {
  return withTimeout(readDefaultSongList(subject, mode), timeout);
}

function makeSongListValidationContext(subject, record) {
  if (hasTrustedArtistId(subject)) return subject || {};
  return {
    name: subject && subject.name,
    artistName: subject && subject.artistName,
    searchTerm: subject && subject.searchTerm,
    resolvedArtistName: record && (record.resolvedArtistName || record.itunesArtistName),
    itunesArtistName: record && record.itunesArtistName,
    displayArtistName: subject && subject.displayArtistName
  };
}

function sanitizeSongListRecord(subject, mode, record) {
  if (!record || !Array.isArray(record.songs)) return null;

  const safeMode = mode === "album" ? "album" : "artist";
  const normalizedSongs = normalizeSongsForList(record.songs);
  if (!normalizedSongs.length) return null;

  if (safeMode === "album") {
    const collectionId = getSongListSubjectId(subject, "album") || String(record.collectionId || record._id || "").trim();
    const songs = collectionId
      ? normalizedSongs.filter((song) => String(song.collectionId || "").trim() === collectionId)
      : normalizedSongs;
    return songs.length ? { ...record, songs } : null;
  }

  const subjectIds = hasTrustedArtistId(subject) ? getArtistIds(subject) : [];
  const recordIds = getArtistIds(record);
  if (subjectIds.length && recordIds.length && !subjectIds.some((id) => recordIds.indexOf(id) >= 0)) {
    return null;
  }

  const validationContext = makeSongListValidationContext(subject, record);
  const songs = interleaveByArtist(
    filterSongsForArtistContext(normalizedSongs, validationContext),
    getArtistIds(validationContext)
  );
  if (!songs.length) return null;
  if (!hasCompleteEquivalentArtistSongs(songs, getEquivalentArtistGroupForTarget(subject))) return null;

  const firstWithArtist = songs.find((song) => song.artistId) || {};
  const artistId = subjectIds[0] || firstWithArtist.artistId || record.artistId || record.itunesArtistId || "";
  return {
    ...record,
    _id: String(record._id || artistId || "").trim(),
    artistId: String(artistId || "").trim(),
    itunesArtistId: String(artistId || "").trim(),
    trustedArtistId: Boolean(artistId),
    songs
  };
}

function makeSongListRecord(subject, mode, songs) {
  const safeMode = mode === "album" ? "album" : "artist";
  const collectionId = getSongListSubjectId(subject, "album");
  let normalizedSongs = safeMode === "album"
    ? normalizeSongsForList(songs).filter((song) => !collectionId || String(song.collectionId || "").trim() === collectionId)
    : filterSongsForArtistContext(normalizeSongsForList(songs), subject);
  if (safeMode === "artist") normalizedSongs = interleaveByArtist(normalizedSongs, getArtistIds(subject));
  if (!normalizedSongs.length) return null;
  if (safeMode === "artist" && !hasCompleteEquivalentArtistSongs(normalizedSongs, getEquivalentArtistGroupForTarget(subject))) return null;

  const firstWithArtist = normalizedSongs.find((song) => song.artistId) || {};
  const firstWithCollection = normalizedSongs.find((song) => song.collectionId) || {};
  const trustedSubjectArtistId = hasTrustedArtistId(subject)
    ? String((subject && (subject.artistId || subject.itunesArtistId)) || "").trim()
    : "";
  const id = safeMode === "album"
    ? String((subject && subject.collectionId) || firstWithCollection.collectionId || "").trim()
    : String(trustedSubjectArtistId || firstWithArtist.artistId || "").trim();

  if (!id) return null;

  return safeMode === "album"
    ? {
        _id: id,
        listVersion: SONG_LIST_CACHE_VERSION,
        collectionId: id,
        collectionName: (subject && subject.name) || firstWithCollection.collectionName || "",
        artistId: String((subject && subject.artistId) || firstWithArtist.artistId || "").trim(),
        artistName: (subject && subject.artistName) || firstWithArtist.artistName || "",
        songs: normalizedSongs,
        updatedAt: Date.now()
      }
    : {
        _id: id,
        listVersion: SONG_LIST_CACHE_VERSION,
        artistId: id,
        trustedArtistId: true,
        artistName: (subject && (subject.name || subject.artistName)) || firstWithArtist.artistName || "",
        resolvedArtistName: (subject && subject.resolvedArtistName) || firstWithArtist.artistName || "",
        itunesArtistName: (subject && subject.itunesArtistName) || (subject && subject.resolvedArtistName) || firstWithArtist.artistName || "",
        searchTerm: (subject && subject.searchTerm) || "",
        songs: normalizedSongs,
        updatedAt: Date.now()
      };
}

function cacheDefaultSongList(subject, mode, songs) {
  const safeMode = mode === "album" ? "album" : "artist";
  const record = makeSongListRecord(subject, safeMode, songs);
  if (!record) return null;

  rememberSongList(safeMode, record);
  addMissing(
    safeMode === "album" ? ALBUM_SONG_LIST_COLLECTION : ARTIST_SONG_LIST_COLLECTION,
    [record]
  ).catch(() => {});
  return record;
}

function makeCoverAssetFromSong(song) {
  const collectionId = String((song && song.collectionId) || "").trim();
  const coverUrl = artwork600((song && (song.cover || song.artworkUrl600 || song.artworkUrl100)) || "");
  if (!collectionId || !coverUrl) return null;

  return {
    _id: collectionId,
    collectionId,
    collectionName: (song && (song.collectionName || song.album)) || "",
    artistId: String((song && song.artistId) || "").trim(),
    artistName: (song && song.artistName) || "",
    artworkUrl100: (song && song.artworkUrl100) || "",
    coverUrl,
    source: "song",
    updatedAt: Date.now()
  };
}

function makeCoverAssetFromAlbum(album) {
  const collectionId = String((album && album.collectionId) || "").trim();
  const coverUrl = artwork600((album && (album.cover || album.artworkUrl600 || album.artworkUrl100)) || "");
  if (!collectionId || !coverUrl) return null;

  return {
    _id: collectionId,
    collectionId,
    collectionName: (album && (album.collectionName || album.name)) || "",
    artistId: String((album && album.artistId) || "").trim(),
    artistName: (album && album.artistName) || "",
    artworkUrl100: (album && album.artworkUrl100) || "",
    coverUrl,
    releaseDate: (album && album.releaseDate) || "",
    year: (album && album.year) || "",
    trackCount: (album && album.trackCount) || 0,
    source: "album",
    updatedAt: Date.now()
  };
}

function makeArtistCoverFromSong(song, context = {}) {
  const artistId = String((song && song.artistId) || context.artistId || context.itunesArtistId || "").trim();
  const coverUrl = artwork600((song && (song.cover || song.artworkUrl600 || song.artworkUrl100)) || "");
  if (!artistId || !coverUrl) return null;
  if (!matchesArtistTarget(song, context)) return null;

  return {
    _id: artistId,
    artistId,
    trustedArtistId: true,
    artistName: context.artistName || (song && song.artistName) || "",
    name: context.artistName || (song && song.artistName) || "",
    resolvedArtistName: context.resolvedArtistName || (song && song.artistName) || "",
    itunesArtistName: context.itunesArtistName || context.resolvedArtistName || (song && song.artistName) || "",
    searchTerm: context.searchTerm || context.artistName || "",
    sourceCollectionId: String((song && song.collectionId) || "").trim(),
    sourceCollectionName: (song && (song.collectionName || song.album)) || "",
    sourceTrackId: String((song && song.trackId) || "").trim(),
    sourceTrackName: (song && (song.trackName || song.name)) || "",
    sourceArtistName: (song && song.artistName) || "",
    coverUrl,
    avatarUrl: coverUrl,
    source: "song",
    updatedAt: Date.now()
  };
}

function makeArtistCoverFromAlbum(album, context = {}) {
  const artistId = String((album && album.artistId) || context.artistId || context.itunesArtistId || "").trim();
  const coverUrl = artwork600((album && (album.cover || album.artworkUrl600 || album.artworkUrl100)) || "");
  if (!artistId || !coverUrl) return null;
  if (!matchesArtistTarget(album, context)) return null;

  return {
    _id: artistId,
    artistId,
    trustedArtistId: true,
    artistName: context.artistName || (album && album.artistName) || "",
    name: context.artistName || (album && album.artistName) || "",
    resolvedArtistName: context.resolvedArtistName || (album && album.artistName) || "",
    itunesArtistName: context.itunesArtistName || context.resolvedArtistName || (album && album.artistName) || "",
    searchTerm: context.searchTerm || context.artistName || "",
    sourceCollectionId: String((album && album.collectionId) || "").trim(),
    sourceCollectionName: (album && (album.collectionName || album.name)) || "",
    sourceArtistName: (album && album.artistName) || "",
    coverUrl,
    avatarUrl: coverUrl,
    source: "album",
    updatedAt: Date.now()
  };
}

async function readArtistCovers(artists) {
  const safeArtists = (artists || []).filter(Boolean);
  const localHits = {};
  const missing = [];

  safeArtists.forEach((artist) => {
    const hit = getLocalArtistCover(artist);
    if (hit) localHits[artist.id] = hit;
    else if (hasRecentArtistCoverMiss(artist)) localHits[artist.id] = { _miss: true };
    else missing.push(artist);
  });

  if (!missing.length) return localHits;

  const ids = unique(missing.reduce((list, artist) => list.concat(getArtistIds(artist)), []));
  const names = unique(missing.reduce((list, artist) => list.concat(getArtistNames(artist)), []));
  const byId = await queryByIn(ARTIST_COVER_COLLECTION, "artistId", ids);
  const byArtistName = await queryByIn(ARTIST_COVER_COLLECTION, "artistName", names);
  const byName = await queryByIn(ARTIST_COVER_COLLECTION, "name", names);
  const bySearchTerm = await queryByIn(ARTIST_COVER_COLLECTION, "searchTerm", names);
  const cloudRows = [...byId, ...byArtistName, ...byName, ...bySearchTerm];
  const cloudHits = {};

  missing.forEach((artist) => {
    const hit = cloudRows.find((row) => matchArtistRecord(artist, row) && isTrustedArtistCover(artist, row));
    if (!hit) {
      rememberArtistCoverMiss(artist);
      return;
    }
    const cover = {
      ...hit,
      coverUrl: hit.coverUrl || hit.avatarUrl || "",
      avatarUrl: hit.avatarUrl || hit.coverUrl || ""
    };
    cloudHits[artist.id] = cover;
    rememberArtistCover(cover);
  });

  return {
    ...localHits,
    ...cloudHits
  };
}

function cacheSongsFromSearch(songs, context = {}) {
  const safeSongs = filterSongsForArtistContext(songs, context);
  const coverAssets = [];
  const seenCollections = {};
  safeSongs.forEach((song) => {
    const record = makeCoverAssetFromSong(song);
    if (!record || seenCollections[record.collectionId]) return;
    seenCollections[record.collectionId] = true;
    coverAssets.push(record);
  });
  rememberCoverAssets(coverAssets);

  const representativeSong = safeSongs.find((song) => song && song.cover && song.collectionId && song.artistId);
  const artistCover = makeArtistCoverFromSong(representativeSong, context);
  if (artistCover) rememberArtistCover(artistCover);

  addMissing(COVER_ASSET_COLLECTION, coverAssets).catch(() => {});
  if (artistCover) addMissing(ARTIST_COVER_COLLECTION, [artistCover]).catch(() => {});
}

function cacheAlbumsFromSearch(albums, context = {}) {
  const safeAlbums = filterAlbumsForArtistContext(albums, context);
  const coverAssets = [];
  const artistCovers = [];
  const seenCollections = {};
  const seenArtists = {};

  safeAlbums.forEach((album) => {
    const coverAsset = makeCoverAssetFromAlbum(album);
    if (coverAsset && !seenCollections[coverAsset.collectionId]) {
      seenCollections[coverAsset.collectionId] = true;
      coverAssets.push(coverAsset);
    }

    const artistCover = makeArtistCoverFromAlbum(album, context);
    if (artistCover && !seenArtists[artistCover.artistId]) {
      seenArtists[artistCover.artistId] = true;
      artistCovers.push(artistCover);
      rememberArtistCover(artistCover);
    }
  });

  rememberCoverAssets(coverAssets);
  addMissing(COVER_ASSET_COLLECTION, coverAssets).catch(() => {});
  addMissing(ARTIST_COVER_COLLECTION, artistCovers).catch(() => {});
}

module.exports = {
  artwork600,
  cacheDefaultSongList,
  cacheAlbumsFromSearch,
  cacheSongsFromSearch,
  getLocalArtistCover,
  readArtistCovers,
  readDefaultSongListWithTimeout
};
