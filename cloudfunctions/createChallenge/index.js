const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DEFAULT_TARGET_COUNT = 9;
const MIN_TARGET_COUNT = 3;
const MAX_TARGET_COUNT = 18;
const TARGET_COUNT_STEP = 3;

function isValidTargetCount(count) {
  const value = Number(count || 0);
  return Number.isInteger(value)
    && value >= MIN_TARGET_COUNT
    && value <= MAX_TARGET_COUNT
    && value % TARGET_COUNT_STEP === 0;
}

function normalizeTargetCount(count, fallback = DEFAULT_TARGET_COUNT) {
  const value = Number(count || 0);
  if (isValidTargetCount(value)) return value;
  return isValidTargetCount(fallback) ? Number(fallback) : DEFAULT_TARGET_COUNT;
}

function normalizeTopArtist(artist = {}) {
  const artistId = String(artist.artistId || artist.itunesArtistId || "").trim();
  return {
    ...artist,
    id: artist.id || artistId || artist.name || "",
    artistId: String(artist.artistId || artistId || "").trim(),
    itunesArtistId: artist.itunesArtistId || artistId || ""
  };
}

function normalizeSong(song = {}, index) {
  const cover = song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || "";
  return {
    trackId: String(song.trackId || "").trim(),
    name: song.name || song.trackName || "",
    trackName: song.trackName || song.name || "",
    artistId: String(song.artistId || "").trim(),
    artistName: song.artistName || "",
    collectionId: String(song.collectionId || "").trim(),
    collectionName: song.collectionName || song.album || "",
    album: song.album || song.collectionName || "",
    cover,
    coverUrl: cover,
    artworkUrl100: song.artworkUrl100 || "",
    artworkUrl600: song.artworkUrl600 || cover,
    previewUrl: song.previewUrl || "",
    rank: index + 1
  };
}

function normalizeColor(color = {}) {
  const id = String(color.id || "").trim();
  return {
    id,
    name: color.name || "",
    color: color.color || "",
    textColor: color.textColor || "",
    borderColor: color.borderColor || ""
  };
}

function normalizePrompt(prompt = {}, index) {
  const id = String(prompt.id || `qa-${index + 1}`).trim();
  const promptText = String(prompt.prompt || prompt.title || "").trim();
  const title = String(prompt.title || promptText || `题目 ${index + 1}`).trim();
  return {
    id,
    title,
    prompt: promptText || title
  };
}

function hasCompleteChoices(subjects, choices) {
  return Array.isArray(subjects) && subjects.length === 9 && subjects.every((item) => {
    const song = choices[item.id];
    return song && song.trackId && (song.name || song.trackName);
  });
}

function countCompleteChoices(subjects, choices) {
  return (subjects || []).filter((item) => {
    const song = choices[item.id];
    return song && song.trackId && (song.name || song.trackName);
  }).length;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const rawMode = String(event.mode || "").trim();
  const hasQaPrompts = Array.isArray(event.qaPrompts) && event.qaPrompts.length > 0;
  const qaOnly = event.qaOnly === true;
  const mode = rawMode === "album"
    ? "album"
    : (rawMode === "top9"
        ? "top9"
        : (rawMode === "color" ? "color" : (rawMode === "qa" || qaOnly || hasQaPrompts ? "qa" : "artist")));
  const artists = Array.isArray(event.artists) ? event.artists.slice(0, MAX_TARGET_COUNT) : [];
  const albums = Array.isArray(event.albums) ? event.albums.slice(0, MAX_TARGET_COUNT) : [];
  const colors = Array.isArray(event.colors) ? event.colors.slice(0, 9).map(normalizeColor).filter((item) => item.id && item.name) : [];
  const qaPrompts = Array.isArray(event.qaPrompts) ? event.qaPrompts.slice(0, 9).map(normalizePrompt).filter((item) => item.id && item.prompt) : [];
  const qaSolo = event.qaSolo === true;
  const topArtist = normalizeTopArtist(event.topArtist || {});
  const creatorChoices = event.creatorChoices || {};
  const creatorTopSongs = Array.isArray(event.creatorTopSongs)
    ? event.creatorTopSongs.slice(0, MAX_TARGET_COUNT).map(normalizeSong).filter((song) => song.trackId && song.name)
    : [];
  const creatorProfile = event.creatorProfile || {};
  const topArtistKey = topArtist.id || topArtist.artistId || topArtist.itunesArtistId || topArtist.name;
  const targetCount = mode === "artist"
    ? normalizeTargetCount(event.targetCount, artists.length)
    : (mode === "album"
        ? normalizeTargetCount(event.targetCount, albums.length)
        : (mode === "top9" ? normalizeTargetCount(event.targetCount, creatorTopSongs.length) : DEFAULT_TARGET_COUNT));

  if (mode === "artist" && (!isValidTargetCount(targetCount) || artists.length !== targetCount)) {
    console.warn("createChallenge rejected as artist", {
      rawMode,
      hasQaPrompts,
      qaOnly,
      qaPromptCount: Array.isArray(event.qaPrompts) ? event.qaPrompts.length : 0,
      artistCount: artists.length,
      targetCount
    });
    return { ok: false, message: "需要选择 3 的倍数位歌手" };
  }
  if (mode === "artist" && countCompleteChoices(artists, creatorChoices) !== targetCount) {
    return { ok: false, message: `需要为 ${targetCount} 位歌手各选 1 首歌` };
  }
  if (mode === "album" && (!isValidTargetCount(targetCount) || albums.length !== targetCount)) {
    return { ok: false, message: "需要选择 3 的倍数张专辑" };
  }
  if (mode === "album" && countCompleteChoices(albums, creatorChoices) !== targetCount) {
    return { ok: false, message: `需要为 ${targetCount} 张专辑各选 1 首歌` };
  }
  if (mode === "top9" && (!topArtistKey || !isValidTargetCount(targetCount) || creatorTopSongs.length !== targetCount)) {
    return { ok: false, message: "需要选择 1 位歌手和 3 的倍数首歌曲" };
  }
  if (mode === "color" && !hasCompleteChoices(colors, creatorChoices)) {
    return {
      ok: false,
      message: `需要填满 9 个颜色格，目前 ${countCompleteChoices(colors, creatorChoices)}/9`
    };
  }
  if (mode === "qa" && qaPrompts.length !== 9) {
    return { ok: false, message: "需要选择 9 个问题" };
  }

  const record = {
    creatorOpenId: wxContext.OPENID,
    mode,
    targetCount,
    artists,
    albums,
    colors,
    qaPrompts,
    qaSolo,
    topArtist,
    creatorChoices,
    creatorTopSongs,
    creatorProfile: {
      nickName: creatorProfile.nickName || "",
      avatarUrl: creatorProfile.avatarUrl || ""
    },
    createdAt: db.serverDate()
  };

  if (creatorProfile.nickName || creatorProfile.avatarUrl) {
    await db.collection("userProfiles").doc(wxContext.OPENID).set({
      data: {
        openId: wxContext.OPENID,
        profile: {
          nickName: creatorProfile.nickName || "",
          avatarUrl: creatorProfile.avatarUrl || ""
        },
        updatedAt: db.serverDate()
      }
    }).catch((error) => {
      console.warn("save user profile failed", error);
    });
  }

  const res = await db.collection("challenges").add({ data: record });
  return {
    ok: true,
    challengeId: res._id
  };
};
