const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const RESULT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CHALLENGE_PARTICIPANTS = 99;
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

function makeResultId(challengeId, openId) {
  return `${challengeId}_${openId}`.replace(/[^\w-]/g, "_");
}

function makeShareToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function checkParticipantCapacity(challengeId, openId) {
  const resultId = makeResultId(challengeId, openId);
  const existingResult = await db.collection("challengeResults").doc(resultId).get()
    .then(() => true)
    .catch(() => false);
  if (existingResult) return { ok: true };

  const countRes = await db.collection("challengeResults").where({
    challengeId
  }).count();
  const participantCount = Number(countRes.total || 0);
  if (participantCount >= MAX_CHALLENGE_PARTICIPANTS) {
    return {
      ok: false,
      message: `本挑战最多支持 ${MAX_CHALLENGE_PARTICIPANTS} 位朋友参与`
    };
  }
  return { ok: true };
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function isLocalDevUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(String(url || ""));
}

function isTemporaryAvatarUrl(url) {
  const value = String(url || "");
  return value.indexOf("wxfile://") === 0
    || value.indexOf("http://tmp/") === 0
    || value.indexOf("https://tmp/") === 0
    || isLocalDevUrl(value)
    || value.indexOf("tmp/") === 0
    || value.indexOf("/tmp/") >= 0;
}

function normalizeProfile(profile = {}) {
  return {
    nickName: String(profile.nickName || "").trim(),
    avatarUrl: profile.avatarUrl || ""
  };
}

function pickProfileAvatar(incomingAvatar, savedAvatar) {
  if (isCloudFileUrl(incomingAvatar)) return incomingAvatar;
  if (isCloudFileUrl(savedAvatar)) return savedAvatar;
  if (incomingAvatar && !isTemporaryAvatarUrl(incomingAvatar)) return incomingAvatar;
  if (savedAvatar && !isTemporaryAvatarUrl(savedAvatar)) return savedAvatar;
  return "";
}

function avatarType(url) {
  if (!url) return "empty";
  if (isCloudFileUrl(url)) return "cloud";
  if (isTemporaryAvatarUrl(url)) return "temporary";
  return "remote";
}

function buildAvatarStatus(incomingProfile, savedProfile, finalProfile) {
  const incomingType = avatarType((incomingProfile || {}).avatarUrl || "");
  const savedType = avatarType((savedProfile || {}).avatarUrl || "");
  const finalType = avatarType((finalProfile || {}).avatarUrl || "");
  return {
    incomingType,
    savedType,
    finalType,
    usedStableAvatar: finalType === "cloud" || finalType === "remote"
  };
}

async function readUserProfile(openId) {
  if (!openId) return normalizeProfile();
  try {
    const res = await db.collection("userProfiles").doc(openId).get();
    return normalizeProfile((res.data || {}).profile || res.data || {});
  } catch (error) {
    return normalizeProfile();
  }
}

function mergeFriendProfile(incomingProfile, savedProfile) {
  const incoming = normalizeProfile(incomingProfile);
  const saved = normalizeProfile(savedProfile);
  return {
    nickName: incoming.nickName || saved.nickName || "",
    avatarUrl: pickProfileAvatar(incoming.avatarUrl, saved.avatarUrl)
  };
}

function normalizeTopSong(song = {}, index) {
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

function getSongCover(song) {
  return (song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || song.picUrl || song.albumCover || song.imageUrl)) || "";
}

function getSongName(song) {
  return (song && (song.name || song.trackName)) || "";
}

async function cleanupExpiredSubmissions(now) {
  try {
    await db.collection("submissions").where({
      expiresAt: _.lte(now)
    }).remove();
    await db.collection("creatorInboxes").where({
      expiresAt: _.lte(now)
    }).remove();
    await db.collection("challengeResults").where({
      expiresAt: _.lte(now)
    }).remove();
  } catch (error) {
    console.warn("cleanup expired records failed", error);
  }
}

function compareByItems(items, creatorChoices, friendChoices) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeCreatorChoices = creatorChoices || {};
  const safeFriendChoices = friendChoices || {};
  const comparisons = safeItems.map((subject) => {
    const creator = safeCreatorChoices[subject.id];
    const friend = safeFriendChoices[subject.id];
    const matched = Boolean(creator && friend && creator.trackId === friend.trackId);
    return {
      artist: subject,
      subject,
      creator,
      friend,
      matched,
      badgeText: matched ? "✓ 契合" : "× 不同",
      badgeClass: matched ? "" : "no",
      cover: getSongCover(friend) || getSongCover(creator),
      songName: getSongName(friend) || getSongName(creator)
    };
  });
  const matchCount = comparisons.filter((item) => item.matched).length;
  return {
    comparisons,
    matchCount,
    score: safeItems.length ? Math.round((matchCount / safeItems.length) * 100) : 0
  };
}

function compareQaAnswers(prompts, creatorChoices, friendChoices) {
  const safePrompts = Array.isArray(prompts) ? prompts : [];
  const safeCreatorChoices = creatorChoices || {};
  const safeFriendChoices = friendChoices || {};
  const comparisons = safePrompts.map((subject) => {
    const creator = safeCreatorChoices[subject.id];
    const friend = safeFriendChoices[subject.id];
    return {
      artist: subject,
      subject,
      creator,
      friend,
      matched: false,
      badgeText: "",
      badgeClass: "",
      cover: getSongCover(friend) || getSongCover(creator),
      songName: getSongName(friend) || getSongName(creator)
    };
  });
  const answeredCount = comparisons.filter((item) => item.friend && item.friend.trackId).length;
  return {
    mode: "qa",
    comparisons,
    matchCount: answeredCount,
    score: 0
  };
}

function compareTopSongs(topArtist, creatorTopSongs, friendTopSongs) {
  const creatorSongs = Array.isArray(creatorTopSongs) ? creatorTopSongs.slice(0, 18) : [];
  const friendSongs = Array.isArray(friendTopSongs) ? friendTopSongs.slice(0, 18) : [];
  const friendRankMap = friendSongs.reduce((map, song, index) => {
    if (song && song.trackId) map[song.trackId] = index + 1;
    return map;
  }, {});
  const creatorRankMap = creatorSongs.reduce((map, song, index) => {
    if (song && song.trackId) map[song.trackId] = index + 1;
    return map;
  }, {});
  const matchedSongs = creatorSongs
    .map((song, index) => ({
      ...song,
      creatorRank: index + 1,
      friendRank: friendRankMap[song.trackId] || 0,
      matched: Boolean(song && song.trackId && friendRankMap[song.trackId])
    }))
    .filter((song) => song.matched);
  const topRankMatches = matchedSongs.filter((song) => song.creatorRank <= 3 && song.creatorRank === song.friendRank);
  const totalCount = Math.max(creatorSongs.length, friendSongs.length, 1);
  return {
    mode: "top9",
    topArtist: topArtist || {},
    creatorTopSongs: creatorSongs.map((song, index) => ({
      ...song,
      rank: index + 1,
      matched: Boolean(song && song.trackId && friendRankMap[song.trackId])
    })),
    friendTopSongs: friendSongs.map((song, index) => ({
      ...song,
      rank: index + 1,
      matched: Boolean(song && song.trackId && creatorRankMap[song.trackId])
    })),
    matchedSongs,
    topRankMatches,
    matchCount: matchedSongs.length,
    totalCount,
    score: Math.round((matchedSongs.length / totalCount) * 100)
  };
}

function countCompleteChoices(subjects, choices) {
  const safeChoices = choices || {};
  return (subjects || []).filter((item) => {
    const song = safeChoices[item.id];
    return song && song.trackId && (song.name || song.trackName);
  }).length;
}

function getSongTitleUnits(value) {
  return Array.from(String(value || "").trim()).reduce((total, char) => {
    const codePoint = char.codePointAt(0);
    return total + (codePoint <= 0x7f || (codePoint >= 0xff61 && codePoint <= 0xff9f) ? 0.5 : 1);
  }, 0);
}

function matchesSongTitleCount(value, targetCount) {
  const actualCount = getSongTitleUnits(value);
  const expectedCount = Number(targetCount || 0);
  if (expectedCount === 9) return actualCount === 9;
  if (expectedCount === 10 || expectedCount === 11) {
    return actualCount >= 9 && actualCount <= 11;
  }
  return actualCount === expectedCount;
}

function getSongKey(song = {}) {
  const trackId = String(song.trackId || "").trim();
  if (trackId) return `id:${trackId}`;
  const text = `${song.artistName || ""}:${song.name || song.trackName || ""}`
    .trim()
    .toLowerCase()
    .replace(/[\s·・.。'’`"“”\-_/\\()（）[\]【】:：,，]+/g, "");
  return text ? `name:${text}` : "";
}

function hasValidTreeChoices(prompts, choices) {
  const keys = [];
  const valid = (prompts || []).every((prompt) => {
    const song = (choices || {})[prompt.id];
    if (!song || !song.trackId || !(song.name || song.trackName)) return false;
    if (!matchesSongTitleCount(song.name || song.trackName, prompt.count)) return false;
    const key = getSongKey(song);
    if (!key || keys.indexOf(key) >= 0) return false;
    keys.push(key);
    return true;
  });
  return valid && keys.length === (prompts || []).length;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const challengeId = event.challengeId;
  const friendChoices = event.friendChoices || {};
  const friendTopSongs = Array.isArray(event.friendTopSongs)
    ? event.friendTopSongs.slice(0, 18).map(normalizeTopSong).filter((song) => song.trackId && song.name)
    : [];
  const rawFriendProfile = event.friendProfile || {};
  const now = new Date();

  if (!challengeId) return { ok: false, message: "缺少 challengeId" };
  if (!wxContext.OPENID) return { ok: false, message: "缺少 openid" };

  await cleanupExpiredSubmissions(now);

  const challenge = await db.collection("challenges").doc(challengeId).get();
  const capacity = await checkParticipantCapacity(challengeId, wxContext.OPENID);
  if (!capacity.ok) return capacity;

  const mode = challenge.data.mode || "artist";
  const items = mode === "album"
    ? (challenge.data.albums || [])
    : (mode === "color" ? (challenge.data.colors || []) : (mode === "qa" ? (challenge.data.qaPrompts || []) : (mode === "tree" ? (challenge.data.treePrompts || []) : (challenge.data.artists || []))));
  const targetCount = mode === "top9"
    ? normalizeTargetCount(challenge.data.targetCount, (challenge.data.creatorTopSongs || []).length)
    : (mode === "artist" || mode === "album" ? normalizeTargetCount(challenge.data.targetCount, items.length) : (mode === "tree" ? items.length : DEFAULT_TARGET_COUNT));
  if ((mode === "artist" || mode === "album" || mode === "tree") && countCompleteChoices(items, friendChoices) !== targetCount) {
    return { ok: false, message: `需要填满 ${targetCount} 个选择` };
  }
  if (mode === "tree" && !hasValidTreeChoices(items, friendChoices)) {
    return { ok: false, message: "右边歌名字数不符合要求，或选择了重复歌曲" };
  }
  if (mode === "top9" && friendTopSongs.length !== targetCount) {
    return { ok: false, message: `需要选择 ${targetCount} 首歌曲` };
  }
  const result = mode === "top9"
    ? compareTopSongs(challenge.data.topArtist, challenge.data.creatorTopSongs, friendTopSongs)
    : (mode === "qa" ? compareQaAnswers(items, challenge.data.creatorChoices || {}, friendChoices)
    : compareByItems(items, challenge.data.creatorChoices, friendChoices));

  const resultSummary = {
    score: result.score,
    matchCount: result.matchCount,
    totalCount: result.totalCount || (items || []).length || 0,
    targetCount
  };
  const savedFriendProfile = await readUserProfile(wxContext.OPENID);
  const friendProfile = mergeFriendProfile(rawFriendProfile, savedFriendProfile);
  const avatarStatus = buildAvatarStatus(rawFriendProfile, savedFriendProfile, friendProfile);
  const resultId = makeResultId(challengeId, wxContext.OPENID);
  const shareToken = makeShareToken();
  const submission = {
    resultId,
    shareToken,
    challengeId,
    creatorOpenId: challenge.data.creatorOpenId,
    friendOpenId: wxContext.OPENID,
    friendChoices,
    friendTopSongs,
    friendProfile,
    result: resultSummary,
    expiresAt: new Date(now.getTime() + RESULT_TTL_MS),
    createdAt: db.serverDate()
  };

  if (friendProfile.nickName || friendProfile.avatarUrl) {
    await db.collection("userProfiles").doc(wxContext.OPENID).set({
      data: {
        openId: wxContext.OPENID,
        profile: {
          nickName: friendProfile.nickName || "",
          avatarUrl: friendProfile.avatarUrl || ""
        },
        updatedAt: db.serverDate()
      }
    }).catch((error) => {
      console.warn("save user profile failed", error);
    });
  }

  let persistentSaved = false;
  let inboxSaved = false;
  let saveError = null;
  const saveWarnings = [];
  if (avatarStatus.incomingType === "temporary" && avatarStatus.finalType === "empty") {
    saveWarnings.push("friendAvatar");
  }
  await db.collection("challengeResults").doc(resultId).set({
    data: {
      resultId,
      shareToken,
      challengeId,
      creatorOpenId: challenge.data.creatorOpenId,
      friendOpenId: wxContext.OPENID,
      friendChoices,
      friendTopSongs,
      friendProfile: submission.friendProfile,
      result: resultSummary,
      visibility: "private",
      createdAt: now,
      updatedAt: db.serverDate(),
      expiresAt: new Date(now.getTime() + RESULT_TTL_MS)
    }
  }).then(() => {
    persistentSaved = true;
  }).catch((error) => {
    saveError = error;
    saveWarnings.push("challengeResults");
    console.warn("save persistent challenge result failed", error);
  });

  const res = await db.collection("submissions").add({ data: submission }).catch((error) => {
    if (!saveError) saveError = error;
    saveWarnings.push("submissions");
    console.warn("save legacy submission failed", error);
    return null;
  });
  if (!persistentSaved && !res) throw saveError || new Error("结果保存失败");

  await db.collection("creatorInboxes").add({
    data: {
      resultId,
      shareToken,
      challengeId,
      creatorOpenId: challenge.data.creatorOpenId,
      friendOpenId: wxContext.OPENID,
      friendChoices,
      friendTopSongs,
      friendProfile: submission.friendProfile,
      result: {
        score: result.score,
        matchCount: result.matchCount,
        totalCount: resultSummary.totalCount,
        targetCount
      },
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESULT_TTL_MS)
    }
  }).then(() => {
    inboxSaved = true;
  }).catch((error) => {
    saveWarnings.push("creatorInboxes");
    console.warn("save legacy creator inbox failed", error);
  });

  return {
    ok: true,
    resultId,
    shareToken,
    submissionId: (res && res._id) || resultId,
    savedStores: {
      challengeResults: persistentSaved,
      submissions: Boolean(res),
      creatorInboxes: inboxSaved
    },
    saveWarnings,
    avatarStatus,
    result
  };
};
