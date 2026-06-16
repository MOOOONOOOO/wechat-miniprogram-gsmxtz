const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function artwork(url) {
  return url ? url.replace("100x100bb", "600x600bb") : "";
}

function normalizeAlbum(item) {
  const collectionId = item.collectionId || item.collectionArtistId || item.artistId;
  const coverUrl = artwork(item.artworkUrl100 || item.artworkUrl60);
  return {
    id: `album-${collectionId}`,
    collectionId: String(collectionId),
    artistId: item.artistId ? String(item.artistId) : "",
    name: item.collectionName || item.trackName || "",
    collectionName: item.collectionName || item.trackName || "",
    artistName: item.artistName || "",
    cover: coverUrl,
    artworkUrl100: item.artworkUrl100 || item.artworkUrl60 || "",
    artworkUrl600: coverUrl,
    releaseDate: item.releaseDate || "",
    year: item.releaseDate ? String(item.releaseDate).slice(0, 4) : "",
    trackCount: item.trackCount || 0
  };
}

function normalizeSong(item) {
  const coverUrl = artwork(item.artworkUrl100 || item.artworkUrl60);
  const duration = item.trackTimeMillis
    ? Math.round(Number(item.trackTimeMillis) / 1000)
    : 0;
  return {
    trackId: String(item.trackId || ""),
    trackName: item.trackName || "",
    name: item.trackName || "",
    artistId: item.artistId ? String(item.artistId) : "",
    collectionId: item.collectionId ? String(item.collectionId) : "",
    collectionName: item.collectionName || "",
    album: item.collectionName || item.artistName || "",
    cover: coverUrl,
    artworkUrl100: item.artworkUrl100 || "",
    artworkUrl600: coverUrl,
    previewUrl: item.previewUrl || "",
    artistName: item.artistName || "",
    trackTimeMillis: item.trackTimeMillis || 0,
    duration
  };
}

function parseReleaseTime(item) {
  const releaseTime = Date.parse(item.releaseDate || "");
  return Number.isNaN(releaseTime) ? 0 : releaseTime;
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

function splitNames(value) {
  return String(value || "")
    .split(/[\/／,，&＆|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const EQUIVALENT_ARTIST_GROUPS = [
  {
    ids: ["1297155868", "300117902"],
    names: ["安溥", "张悬", "張懸", "焦安溥"],
    searchTerms: ["安溥", "张悬", "張懸"]
  }
];

function unique(values) {
  const seen = new Set();
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function flatten(values) {
  return (values || []).reduce((list, value) => (
    list.concat(Array.isArray(value) ? value : [value])
  ), []);
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

function getArtistNameTargets(...values) {
  const targets = unique(values.reduce((list, value) => list.concat(splitNames(value), value), []));
  const equivalentNames = targets.reduce((list, name) => {
    const group = findEquivalentArtistGroupByName(name);
    return group ? list.concat(group.names) : list;
  }, []);
  return unique(targets.concat(equivalentNames));
}

function getArtistIdTargets(...values) {
  const rawValues = flatten(values);
  const ids = unique(rawValues.filter((value) => /^\d+$/.test(String(value || "").trim())));
  const equivalentIds = rawValues.reduce((list, value) => {
    const idGroup = findEquivalentArtistGroupById(value);
    const nameGroup = findEquivalentArtistGroupByName(value);
    const group = idGroup || nameGroup;
    return group ? list.concat(group.ids) : list;
  }, []);
  return unique(ids.concat(equivalentIds));
}

function getEquivalentArtistGroupForTarget(...values) {
  const rawValues = flatten(values);
  return rawValues.reduce((found, value) => (
    found || findEquivalentArtistGroupById(value) || findEquivalentArtistGroupByName(value)
  ), null);
}

function getArtistSearchTerms(artistIds, artistNames, fallbackValues) {
  const group = getEquivalentArtistGroupForTarget(artistIds, artistNames);
  if (group) return unique(group.searchTerms || group.names);
  return unique((fallbackValues || []).reduce((list, value) => list.concat(splitNames(value), value), []));
}

function isSameArtistName(name, targets) {
  const normalizedName = normalizeName(name);
  const normalizedTargets = targets.map(normalizeName).filter(Boolean);
  return Boolean(normalizedName && normalizedTargets.some((target) => normalizedName === target));
}

function pickBestArtist(results, targets) {
  const artists = (results || []).filter((item) => item.wrapperType === "artist" && item.artistId);
  return artists.find((item) => isSameArtistName(item.artistName, targets)) || artists[0] || null;
}

async function lookupArtistById(artistId, country) {
  const id = String(artistId || "").trim();
  if (!id) return null;

  const params = new URLSearchParams({
    id,
    country
  });

  try {
    const data = await requestJson(`https://itunes.apple.com/lookup?${params.toString()}`);
    return (data.results || []).find((item) => item.wrapperType === "artist" && item.artistId) || null;
  } catch (error) {
    console.warn("iTunes artist id lookup failed", id, error);
    return null;
  }
}

async function lookupArtistIdentity({ artistName, searchTerm, artistId, itunesArtistId }, country) {
  const existingArtistId = String(artistId || itunesArtistId || "").trim();
  const targets = getArtistNameTargets(artistName, searchTerm);
  if (existingArtistId) {
    return {
      artistId: existingArtistId,
      artistName: "",
      targets
    };
  }

  const query = String(searchTerm || artistName || "").trim();
  if (!query) {
    return {
      artistId: "",
      artistName: "",
      targets
    };
  }

  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "musicArtist",
    country,
    limit: "5"
  });

  try {
    const data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    const artist = pickBestArtist(data.results || [], targets);
    return {
      artistId: artist && artist.artistId ? String(artist.artistId) : "",
      artistName: artist && artist.artistName ? artist.artistName : "",
      targets: getArtistNameTargets(artistName, searchTerm, artist && artist.artistName)
    };
  } catch (error) {
    console.warn("iTunes artist identity lookup failed", query, error);
    return {
      artistId: "",
      artistName: "",
      targets
    };
  }
}

async function resolveArtistIdentity({ artistName, searchTerm, artistId, itunesArtistId, trustedArtistId }, country) {
  const existingArtistId = String(artistId || itunesArtistId || "").trim();
  const targets = getArtistNameTargets(artistName, searchTerm);

  if (existingArtistId) {
    if (trustedArtistId) {
      return {
        artistId: existingArtistId,
        artistName: "",
        targets
      };
    }

    const artist = await lookupArtistById(existingArtistId, country);
    if (!targets.length || (artist && isSameArtistName(artist.artistName, targets))) {
      return {
        artistId: existingArtistId,
        artistName: artist && artist.artistName ? artist.artistName : "",
        targets: getArtistNameTargets(artistName, searchTerm, artist && artist.artistName)
      };
    }
  }

  return lookupArtistIdentity({
    artistName,
    searchTerm
  }, country);
}

function matchesSongArtist(item, artistIds, artistNames) {
  const ids = getArtistIdTargets(artistIds, artistNames);
  if (ids.length) return ids.indexOf(String(item.artistId || "").trim()) >= 0;
  return isSameArtistName(item.artistName, artistNames);
}

function matchesAlbumArtist(item, artistIds, artistNames) {
  const ids = getArtistIdTargets(artistIds, artistNames);
  if (ids.length) return ids.indexOf(String(item.artistId || "").trim()) >= 0;

  const targets = artistNames.map(normalizeName).filter(Boolean);
  if (!targets.length) return true;

  const names = [
    item.artistName,
    item.collectionArtistName
  ].map(normalizeName).filter(Boolean);

  return targets.some((target) => names.some((name) => name.indexOf(target) !== -1));
}

function uniqueQueries(queries) {
  const seen = new Set();
  return queries
    .map((query) => String(query || "").trim())
    .filter((query) => {
      const key = query.toLowerCase();
      if (!query || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function searchAlbumResults(query, country, limit) {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "album",
    country,
    limit: String(limit)
  });
  try {
    const data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    return data.results || [];
  } catch (error) {
    console.warn("iTunes album supplemental search failed", query, error);
    return [];
  }
}

async function lookupResultsById(id, entity, country, limit) {
  const safeId = String(id || "").trim();
  if (!safeId) return [];
  const params = new URLSearchParams({
    id: safeId,
    entity,
    country,
    limit: String(limit)
  });
  try {
    const data = await requestJson(`https://itunes.apple.com/lookup?${params.toString()}`);
    return data.results || [];
  } catch (error) {
    console.warn("iTunes lookup failed", entity, safeId, error);
    return [];
  }
}

async function searchSongResults(artistQuery, query, country, limit) {
  const params = new URLSearchParams({
    term: query ? `${artistQuery} ${query}` : artistQuery,
    media: "music",
    entity: "song",
    country,
    limit: String(limit)
  });
  if (!query) params.set("attribute", "artistTerm");
  try {
    const data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    return data.results || [];
  } catch (error) {
    console.warn("iTunes song search failed", artistQuery, error);
    return [];
  }
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

function filterSongsByQueryTitle(items, query) {
  const keyword = normalizeSearchText(query);
  if (!keyword) return items;

  const matched = items.filter((item) => (
    normalizeSearchText(item.trackName || item.name).indexOf(keyword) >= 0
  ));
  return matched.length ? matched : items;
}

function buildAlbumList(results, artistId, artistNames, limit) {
  const seen = new Set();
  const artistIds = getArtistIdTargets(artistId, artistNames);
  const albums = results
    .filter((item) => item.wrapperType === "collection" && item.collectionId)
    .filter((item) => matchesAlbumArtist(item, artistId, artistNames))
    .filter((item) => {
      if (seen.has(item.collectionId)) return false;
      seen.add(item.collectionId);
      return true;
    })
    .sort((a, b) => parseReleaseTime(b) - parseReleaseTime(a));
  return interleaveByArtist(albums, artistIds)
    .slice(0, limit)
    .map(normalizeAlbum);
}

exports.main = async (event) => {
  const country = event.country || "HK";
  const limit = Math.min(Number(event.limit || 6), 200);

  if (event.type === "artist") {
    const query = String(event.query || "").trim();
    if (!query) return { artists: [] };

    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "musicArtist",
      country,
      limit: String(limit)
    });
    let data = {};
    try {
      data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    } catch (error) {
      console.warn("iTunes artist search failed", error);
      return { artists: [] };
    }

    return {
      artists: (data.results || []).map((item) => ({
        id: `itunes-${item.artistId}`,
        itunesArtistId: item.artistId,
        name: item.artistName,
        avatarUrl: artwork(item.artworkUrl100 || item.artworkUrl60),
        initial: "iTunes",
        hint: `真实接口 · Artist ID ${item.artistId}`
      }))
    };
  }

  if (event.type === "album") {
    const artistName = String(event.artistName || "").trim();
    const searchTerm = String(event.searchTerm || "").trim();
    let artistId = String(event.artistId || event.itunesArtistId || "").trim();
    let resolvedArtistName = artistName;
    const requestedNames = getArtistNameTargets(artistName, searchTerm);
    if (!artistName && !artistId) return { albums: [] };

    if (artistId) {
      const lookupRows = await lookupResultsById(artistId, "album", country, limit);
      const lookupArtist = lookupRows.find((item) => item.wrapperType === "artist") || {};
      if (requestedNames.length && lookupArtist.artistName && !isSameArtistName(lookupArtist.artistName, requestedNames)) {
        artistId = "";
      } else {
        resolvedArtistName = lookupArtist.artistName || resolvedArtistName;
      }
    }

    if (!artistId) {
      const identity = await lookupArtistIdentity({
        artistName,
        searchTerm
      }, country);
      artistId = identity.artistId;
      resolvedArtistName = identity.artistName || resolvedArtistName;
    }

    if (!artistId) return { albums: [] };

    const targetArtistNames = getArtistNameTargets(artistName, searchTerm, resolvedArtistName);
    const targetArtistIds = getArtistIdTargets(artistId, targetArtistNames);
    const lookupIds = targetArtistIds.length ? targetArtistIds : [artistId];
    const lookupResults = (await Promise.all(
      lookupIds.map((id) => lookupResultsById(id, "album", country, limit))
    )).flat();
    const queryTerms = getArtistSearchTerms(targetArtistIds, targetArtistNames, [
      searchTerm || artistName,
      resolvedArtistName
    ]);
    const supplementalQueries = uniqueQueries([
      ...queryTerms
    ]);
    const supplementalResults = (await Promise.all(
      supplementalQueries.map((query) => searchAlbumResults(query, country, limit))
    )).flat();
    const albums = buildAlbumList(
      [...lookupResults, ...supplementalResults],
      targetArtistIds.length ? targetArtistIds : artistId,
      targetArtistNames,
      limit
    );

    return { albums, artistId: targetArtistIds[0] || artistId, artistName: resolvedArtistName };
  }

  if (event.type === "albumSearch") {
    const query = String(event.query || "").trim();
    if (!query) return { albums: [] };

    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "album",
      country,
      limit: String(limit)
    });
    let data = {};
    try {
      data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    } catch (error) {
      console.warn("iTunes album search failed", error);
      return { albums: [] };
    }

    const seen = new Set();
    const albums = (data.results || [])
      .filter((item) => item.wrapperType === "collection" && item.collectionId)
      .filter((item) => {
        if (seen.has(item.collectionId)) return false;
        seen.add(item.collectionId);
        return true;
      })
      .sort((a, b) => parseReleaseTime(b) - parseReleaseTime(a))
      .slice(0, limit)
      .map(normalizeAlbum);

    return { albums };
  }

  if (event.type === "albumSongs") {
    const collectionId = String(event.collectionId || "").trim();
    const query = String(event.query || "").trim();
    if (!collectionId) return { songs: [] };

    const params = new URLSearchParams({
      id: collectionId,
      entity: "song",
      country,
      limit: "200"
    });
    let data = {};
    try {
      data = await requestJson(`https://itunes.apple.com/lookup?${params.toString()}`);
    } catch (error) {
      console.warn("iTunes album song lookup failed", error);
      return { songs: [] };
    }

    const album = (data.results || []).find((item) => item.wrapperType === "collection") || {};
    const seen = new Set();
    const songs = (data.results || [])
      .filter((item) => item.wrapperType === "track" && item.kind === "song" && item.trackId && item.trackName)
      .filter((item) => {
        if (query && item.trackName.indexOf(query) === -1) return false;
        if (seen.has(item.trackId)) return false;
        seen.add(item.trackId);
        return true;
      })
      .map((item) => ({
        trackId: String(item.trackId),
        trackName: item.trackName,
        name: item.trackName,
        artistId: item.artistId ? String(item.artistId) : "",
        collectionId: item.collectionId ? String(item.collectionId) : collectionId,
        collectionName: item.collectionName || album.collectionName || "",
        album: item.collectionName || album.collectionName || "",
        cover: artwork(item.artworkUrl100 || album.artworkUrl100),
        artworkUrl100: item.artworkUrl100 || album.artworkUrl100 || "",
        artworkUrl600: artwork(item.artworkUrl100 || album.artworkUrl100),
        previewUrl: item.previewUrl || "",
        artistName: item.artistName || album.artistName || "",
        trackNumber: item.trackNumber || 0
      }));

    return { songs };
  }

  if (event.type === "songSearch") {
    const query = String(event.query || "").trim();
    if (!query) return { songs: [] };

    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "song",
      country,
      limit: String(limit)
    });
    let data = {};
    try {
      data = await requestJson(`https://itunes.apple.com/search?${params.toString()}`);
    } catch (error) {
      console.warn("iTunes general song search failed", error);
      return { songs: [] };
    }

    const seen = new Set();
    const songs = (data.results || [])
      .filter((item) => item.wrapperType === "track" && item.kind === "song" && item.trackId && item.trackName)
      .filter((item) => {
        if (seen.has(item.trackId)) return false;
        seen.add(item.trackId);
        return true;
      })
      .slice(0, limit)
      .map(normalizeSong);

    return { songs };
  }

  const artistName = String(event.artistName || event.displayArtistName || "").trim();
  const searchTerm = String(event.searchTerm || "").trim();
  const query = String(event.query || "").trim();
  const searchArtistName = searchTerm || artistName;
  if (!searchArtistName) return { songs: [] };

  const identity = await resolveArtistIdentity({
    artistName,
    searchTerm,
    artistId: event.artistId,
    itunesArtistId: event.itunesArtistId,
    trustedArtistId: event.trustedArtistId
  }, country);
  const targetArtistId = identity.artistId;
  const targetArtistNames = identity.targets || getArtistNameTargets(artistName, searchTerm, identity.artistName);

  const targetArtistIds = getArtistIdTargets(targetArtistId, targetArtistNames);
  const queryTerms = getArtistSearchTerms(targetArtistIds, targetArtistNames, [searchArtistName]);
  const results = (await Promise.all(
    queryTerms.map((term) => searchSongResults(term, query, country, limit))
  )).flat();

  const seen = new Set();
  const seenSongKeys = new Set();
  const songResults = results
    .filter((item) => item.wrapperType === "track" && item.kind === "song" && item.trackId && item.trackName)
    .filter((item) => matchesSongArtist(item, targetArtistIds.length ? targetArtistIds : targetArtistId, targetArtistNames))
    .filter((item) => {
      if (seen.has(item.trackId)) return false;
      seen.add(item.trackId);
      const songKey = `${normalizeName(item.artistName)}:${normalizeName(item.trackName)}`;
      if (songKey !== ":" && seenSongKeys.has(songKey)) return false;
      if (songKey !== ":") seenSongKeys.add(songKey);
      return true;
    });
  const titleMatchedSongResults = filterSongsByQueryTitle(songResults, query);
  const songs = interleaveByArtist(titleMatchedSongResults, targetArtistIds)
    .slice(0, limit)
    .map((item) => ({
      ...normalizeSong(item),
      artistName: item.artistName || identity.artistName || artistName || searchArtistName
    }));

  return {
    songs,
    artistId: targetArtistIds[0] || targetArtistId,
    artistName: identity.artistName || artistName || searchArtistName
  };
};
