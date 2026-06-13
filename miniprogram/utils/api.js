const {
  cacheAlbumsFromSearch,
  cacheSongsFromSearch
} = require("./itunesCache");

const EQUIVALENT_ARTIST_GROUPS = [
  {
    ids: ["1297155868", "300117902"],
    names: ["安溥", "张悬", "張懸", "焦安溥"],
    searchTerms: ["安溥", "张悬", "張懸"]
  }
];

function call(name, data = {}) {
  if (!wx.cloud) {
    return Promise.reject(new Error("请在微信云开发环境中运行"));
  }

  return wx.cloud.callFunction({ name, data }).then((res) => {
    const result = res.result || {};
    if (result.ok === false) {
      return Promise.reject(new Error(result.message || "云函数调用失败"));
    }
    return result;
  });
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：]+/g, "");
}

function normalizeSearchText(value) {
  const expanded = String(value || "").replace(/[⭐🌟✨💫]/g, "星");
  const variants = {
    "關": "关",
    "於": "于",
    "愛": "爱",
    "張": "张",
    "懸": "悬",
    "說": "说",
    "時": "时",
    "這": "这",
    "無": "无",
    "狀": "状",
    "態": "态",
    "寶": "宝",
    "貝": "贝",
    "裡": "里",
    "裏": "里",
    "親": "亲",
    "還": "还",
    "妳": "你"
  };
  return normalizeName(expanded).replace(/[關於愛張懸說時這無狀態寶貝裡裏親還妳]/g, (char) => variants[char] || char);
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

function findEquivalentArtistGroup(artist) {
  const safeArtist = artist || {};
  const ids = [
    safeArtist.artistId,
    safeArtist.itunesArtistId
  ].map((id) => String(id || "").trim()).filter(Boolean);
  const names = [
    safeArtist.name,
    safeArtist.artistName,
    safeArtist.searchTerm,
    safeArtist.resolvedArtistName,
    safeArtist.itunesArtistName
  ].map(normalizeName).filter(Boolean);

  return EQUIVALENT_ARTIST_GROUPS.find((group) => (
    group.ids.some((id) => ids.indexOf(id) >= 0) ||
    group.names.some((name) => names.indexOf(normalizeName(name)) >= 0)
  )) || null;
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

function filterRealSongs(songs) {
  return (Array.isArray(songs) ? songs : []).filter((song) => !isFallbackSong(song));
}

function mergeSongs(results) {
  const seen = {};
  return filterRealSongs((results || []).reduce((list, res) => list.concat((res && res.songs) || []), []))
    .filter((song) => {
      const key = String(song.trackId || `${song.artistName || ""}:${song.name || song.trackName || ""}`);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function filterSongsByQueryTitle(songs, query) {
  const keyword = normalizeSearchText(query);
  if (!keyword) return songs;
  const matched = (songs || []).filter((song) => (
    normalizeSearchText(song.name || song.trackName).indexOf(keyword) >= 0
  ));
  return matched.length ? matched : songs;
}

function mergeAlbums(results) {
  const seen = {};
  return (results || []).reduce((list, res) => list.concat((res && res.albums) || []), [])
    .filter((album) => {
      const key = String(album.collectionId || album.id || `${album.artistName || ""}:${album.name || album.collectionName || ""}`);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
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

function searchArtists(query) {
  return call("itunesSearch", {
    type: "artist",
    query,
    limit: 6
  });
}

function normalizeArtistInput(artist) {
  if (typeof artist === "string") {
    const name = artist.trim();
    return {
      name,
      artistName: name,
      searchTerm: name,
      artistId: "",
      itunesArtistId: "",
      trustedArtistId: false
    };
  }

  const safeArtist = artist || {};
  const name = safeArtist.name || safeArtist.artistName || safeArtist.searchTerm || "";
  return {
    ...safeArtist,
    name,
    artistName: safeArtist.artistName || safeArtist.name || name,
    searchTerm: safeArtist.searchTerm || name,
    artistId: safeArtist.artistId || "",
    itunesArtistId: safeArtist.itunesArtistId || "",
    trustedArtistId: Boolean(
      safeArtist.trustedArtistId ||
      String(safeArtist.id || "").indexOf("itunes-") === 0 ||
      safeArtist.resolvedArtistName ||
      safeArtist.itunesArtistName
    )
  };
}

function searchSongs(artist, query = "") {
  const artistInfo = normalizeArtistInput(artist);
  const group = findEquivalentArtistGroup(artistInfo);
  const requests = group
    ? group.searchTerms.map((term, index) => call("itunesSearch", {
        type: "song",
        artistName: artistInfo.artistName || artistInfo.name || term,
        searchTerm: term,
        artistId: group.ids[index] || "",
        trustedArtistId: true,
        query,
        limit: 49
      }).catch(() => ({ songs: [] })))
    : [call("itunesSearch", {
    type: "song",
    artistName: artistInfo.artistName || artistInfo.name || artistInfo.searchTerm,
    searchTerm: artistInfo.searchTerm || artistInfo.artistName || artistInfo.name,
    artistId: artistInfo.itunesArtistId || artistInfo.artistId || "",
    trustedArtistId: artistInfo.trustedArtistId,
    query,
    limit: 49
  })];

  return Promise.all(requests).then((results) => {
    const primary = results.find((res) => res && res.artistId) || results[0] || {};
    const resolvedArtistId = (group && group.ids[0]) || primary.artistId || artistInfo.itunesArtistId || artistInfo.artistId || "";
    const songs = interleaveByArtist(filterSongsByQueryTitle(mergeSongs(results), query), group ? group.ids : []);
    cacheSongsFromSearch(songs, {
      ...artistInfo,
      artistId: resolvedArtistId,
      itunesArtistId: resolvedArtistId,
      trustedArtistId: Boolean(resolvedArtistId),
      resolvedArtistName: primary.artistName || "",
      searchTerm: artistInfo.searchTerm || artistInfo.artistName || artistInfo.name
    });
    return {
      ...primary,
      songs,
      artistId: resolvedArtistId,
      trustedArtistId: Boolean(resolvedArtistId),
      artistName: primary.artistName || artistInfo.artistName || artistInfo.name || ""
    };
  });
}

function searchAlbums(artist, limit = 200) {
  const artistInfo = normalizeArtistInput(artist);
  const group = findEquivalentArtistGroup(artistInfo);
  const requests = group
    ? group.searchTerms.map((term, index) => call("itunesSearch", {
        type: "album",
        artistName: term,
        searchTerm: term,
        artistId: group.ids[index] || "",
        limit
      }).catch(() => ({ albums: [] })))
    : [call("itunesSearch", {
        type: "album",
        artistName: artist.searchTerm || artist.name || artist.artistName || "",
        artistId: artist.itunesArtistId || artist.artistId || "",
        limit
      })];

  return Promise.all(requests).then((results) => {
    const primary = results.find((res) => res && res.artistId) || results[0] || {};
    const albums = interleaveByArtist(mergeAlbums(results), group ? group.ids : []);
    const resolvedArtistId = (group && group.ids[0]) || primary.artistId || artist.itunesArtistId || artist.artistId || "";
    cacheAlbumsFromSearch(albums, {
      artistName: artist.name || artist.artistName || "",
      searchTerm: artist.searchTerm || "",
      artistId: resolvedArtistId,
      itunesArtistId: resolvedArtistId,
      trustedArtistId: Boolean(resolvedArtistId),
      resolvedArtistName: primary.artistName || ""
    });
    return {
      ...primary,
      albums,
      artistId: resolvedArtistId,
      trustedArtistId: Boolean(resolvedArtistId),
      artistName: primary.artistName || artist.name || artist.artistName || ""
    };
  });
}

function searchAlbumsByQuery(query, limit = 49) {
  return call("itunesSearch", {
    type: "albumSearch",
    query,
    limit
  }).then((res) => {
    cacheAlbumsFromSearch(res.albums);
    return res;
  });
}

function searchAlbumSongs(collectionId, query = "") {
  return call("itunesSearch", {
    type: "albumSongs",
    collectionId,
    query
  }).then((res) => {
    const songs = filterRealSongs(res.songs);
    cacheSongsFromSearch(songs, {
      collectionId
    });
    return {
      ...res,
      songs
    };
  });
}

function createChallenge(payload) {
  return call("createChallenge", payload);
}

function getChallenge(challengeId) {
  return call("getChallenge", { challengeId });
}

function submitAnswer(payload) {
  return call("submitAnswer", payload);
}

function getRecentSubmission(challengeId) {
  return call("getRecentSubmission", { challengeId });
}

function getChallengeParticipants(challengeId) {
  return call("getChallengeParticipants", { challengeId });
}

function getCreatorInbox(payload = {}) {
  return call("getCreatorInbox", payload);
}

function updateChallengeProfile(payload) {
  return call("updateChallengeProfile", payload);
}

function getMiniProgramCode(payload) {
  return call("getMiniProgramCode", typeof payload === "object" ? payload : { challengeId: payload });
}

function publishSharedResult(payload) {
  return call("publishSharedResult", payload);
}

function getSharedResult(payload) {
  return call("getSharedResult", payload);
}

module.exports = {
  searchArtists,
  searchSongs,
  searchAlbums,
  searchAlbumsByQuery,
  searchAlbumSongs,
  createChallenge,
  getChallenge,
  submitAnswer,
  getRecentSubmission,
  getChallengeParticipants,
  getCreatorInbox,
  updateChallengeProfile,
  getMiniProgramCode,
  publishSharedResult,
  getSharedResult
};
