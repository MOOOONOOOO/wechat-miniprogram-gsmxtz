const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function normalizeTime(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value.$date) return normalizeTime(value.$date);
  return 0;
}

function normalizeSince(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp);
}

function isUnexpired(item, now) {
  const expiresAt = normalizeTime(item && item.expiresAt);
  return !expiresAt || expiresAt > now.getTime();
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
  if (isCloudFileUrl(savedAvatar)) return savedAvatar;
  if (isCloudFileUrl(incomingAvatar)) return incomingAvatar;
  if (savedAvatar && !isTemporaryAvatarUrl(savedAvatar)) return savedAvatar;
  if (incomingAvatar && !isTemporaryAvatarUrl(incomingAvatar)) return incomingAvatar;
  return "";
}

async function readUserProfile(openId, cache) {
  if (!openId) return normalizeProfile();
  const key = `profile:${openId}`;
  if (cache[key]) return cache[key];
  try {
    const res = await db.collection("userProfiles").doc(openId).get();
    cache[key] = normalizeProfile((res.data || {}).profile || res.data || {});
  } catch (error) {
    cache[key] = normalizeProfile();
  }
  return cache[key];
}

async function mergeFriendProfile(item, cache) {
  const incoming = normalizeProfile((item || {}).friendProfile || {});
  const saved = await readUserProfile((item || {}).friendOpenId || "", cache);
  return {
    nickName: incoming.nickName || saved.nickName || "匿名朋友",
    avatarUrl: pickProfileAvatar(incoming.avatarUrl, saved.avatarUrl)
  };
}

function getSongCover(song) {
  return (song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || song.picUrl || song.albumCover || song.imageUrl)) || "";
}

function getSongName(song) {
  return (song && (song.name || song.trackName)) || "";
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

async function cleanupExpired(now) {
  try {
    await db.collection("creatorInboxes").where({
      expiresAt: _.lte(now)
    }).remove();
    await db.collection("submissions").where({
      expiresAt: _.lte(now)
    }).remove();
    await db.collection("challengeResults").where({
      expiresAt: _.lte(now)
    }).remove();
  } catch (error) {
    console.warn("cleanup expired records failed", error);
  }
}

function uniqueChallengeIds(value) {
  const seen = {};
  return (Array.isArray(value) ? value : [])
    .map((id) => String(id || "").trim())
    .filter((id) => {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    })
    .slice(0, 50);
}

function chunkList(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function pushWarning(warnings, label, error) {
  const message = error && error.message ? error.message : "查询失败";
  warnings.push(`${label}: ${message}`);
}

async function queryByCreator(collectionName, creatorOpenId, now, limit, warnings, sinceDate) {
  const where = {
    creatorOpenId
  };
  if (sinceDate) where.createdAt = _.gt(sinceDate);
  else where.expiresAt = _.gt(now);
  return db.collection(collectionName)
    .where(where)
    .limit(limit)
    .get()
    .then((res) => (res.data || []).filter((item) => isUnexpired(item, now)))
    .catch((error) => {
      console.warn(`query ${collectionName} by creator failed`, error);
      pushWarning(warnings, collectionName, error);
      return [];
    });
}

function makeChallengeRecord(challengeId, data = {}) {
  const challenge = {
    challengeId,
    mode: data.mode || "artist",
    targetCount: data.targetCount || 9,
    artists: data.artists || [],
    albums: data.albums || [],
    colors: data.colors || [],
    qaPrompts: data.qaPrompts || [],
    treePrompts: data.treePrompts || [],
    qaSolo: data.qaSolo === true,
    topArtist: data.topArtist || null,
    creatorChoices: data.creatorChoices || {},
    creatorTopSongs: data.creatorTopSongs || [],
    creatorProfile: data.creatorProfile || {},
    creatorOpenId: data.creatorOpenId
  };
  return {
    challenge,
    ownerOpenId: data.creatorOpenId || data._openid || ""
  };
}

async function readChallengeRecord(challengeId, cache) {
  if (cache[challengeId]) return cache[challengeId];
  const res = await db.collection("challenges").doc(challengeId).get();
  cache[challengeId] = makeChallengeRecord(challengeId, res.data || {});
  return cache[challengeId];
}

async function readChallenge(challengeId, cache) {
  const record = await readChallengeRecord(challengeId, cache);
  return record.challenge;
}

function isOwnedChallengeRecord(record, openId) {
  return Boolean(openId && record && record.ownerOpenId && record.ownerOpenId === openId);
}

async function readOwnedChallengeIds(challengeIds, cache, openId, warnings) {
  if (!challengeIds.length) return [];

  const ownedIds = [];
  for (const ids of chunkList(challengeIds, 20)) {
    await db.collection("challenges")
      .where({
        _id: _.in(ids)
      })
      .limit(ids.length)
      .get()
      .then(async (res) => {
        for (const data of (res.data || [])) {
          const challengeId = data._id || "";
          if (!challengeId) continue;
          const challengeRecord = makeChallengeRecord(challengeId, data);
          cache[challengeId] = challengeRecord;
          if (isOwnedChallengeRecord(challengeRecord, openId)) ownedIds.push(challengeId);
        }
      })
      .catch((error) => {
        console.warn("read owned challenges failed", ids, error);
        pushWarning(warnings, "challenges", error);
      });
  }

  return ownedIds;
}

async function queryByChallengeIds(collectionName, challengeIds, now, warnings, sinceDate) {
  const items = [];
  if (!challengeIds.length) return items;

  for (const ids of chunkList(challengeIds, 20)) {
    const where = {
      challengeId: _.in(ids)
    };
    if (sinceDate) where.createdAt = _.gt(sinceDate);
    else where.expiresAt = _.gt(now);
    await db.collection(collectionName)
      .where(where)
      .limit(100)
      .get()
      .then((res) => {
        items.push(...(res.data || []).filter((item) => isUnexpired(item, now)));
      })
      .catch((error) => {
        console.warn(`query ${collectionName} by challenges failed`, ids, error);
        pushWarning(warnings, collectionName, error);
      });
  }

  return items;
}

async function buildEntry(item, cache) {
  const challenge = await readChallenge(item.challengeId, cache);
  const friendProfile = await mergeFriendProfile(item, cache);
  const items = challenge.mode === "album"
    ? challenge.albums
    : (challenge.mode === "color" ? challenge.colors : (challenge.mode === "qa" ? challenge.qaPrompts : (challenge.mode === "tree" ? challenge.treePrompts : challenge.artists)));
  const result = challenge.mode === "top9"
    ? compareTopSongs(challenge.topArtist, challenge.creatorTopSongs, item.friendTopSongs || [])
    : (challenge.mode === "qa" ? compareQaAnswers(items, challenge.creatorChoices, item.friendChoices || {})
    : compareByItems(items, challenge.creatorChoices, item.friendChoices || {}));
  return {
    resultId: item.resultId || item._id || "",
    shareToken: item.shareToken || "",
    inboxId: item.inboxId || item._id || "",
    challenge,
    challengeId: item.challengeId,
    friendOpenId: item.friendOpenId || "",
    friendProfile,
    friendChoices: item.friendChoices || {},
    friendTopSongs: item.friendTopSongs || [],
    result,
    createdAt: item.createdAt || null,
    expiresAt: item.expiresAt || null
  };
}

exports.main = async (event = {}) => {
  event = event || {};
  const wxContext = cloud.getWXContext();
  const now = new Date();

  await cleanupExpired(now);

  const warnings = [];
  const cache = {};
  const challengeIds = uniqueChallengeIds(event.challengeIds);
  const challengeOnly = event.challengeOnly === true || event.scope === "challenge";
  const sinceDate = normalizeSince(event.since);
  if (challengeOnly && !challengeIds.length) {
    return {
      ok: true,
      entries: [],
      cursor: now.getTime(),
      warnings
    };
  }
  const resultItems = challengeOnly ? [] : await queryByCreator("challengeResults", wxContext.OPENID, now, 100, warnings, sinceDate);
  const inboxItems = challengeOnly ? [] : await queryByCreator("creatorInboxes", wxContext.OPENID, now, 50, warnings, sinceDate);
  const submissionItems = challengeOnly ? [] : await queryByCreator("submissions", wxContext.OPENID, now, 100, warnings, sinceDate);
  const ownedChallengeIds = await readOwnedChallengeIds(challengeIds, cache, wxContext.OPENID, warnings);
  const ownedResultItems = await queryByChallengeIds("challengeResults", ownedChallengeIds, now, warnings, sinceDate);
  const ownedInboxItems = await queryByChallengeIds("creatorInboxes", ownedChallengeIds, now, warnings, sinceDate);
  const ownedSubmissionItems = await queryByChallengeIds("submissions", ownedChallengeIds, now, warnings, sinceDate);
  const entries = [];
  const seen = {};
  const items = [
    ...resultItems,
    ...ownedResultItems,
    ...inboxItems.map((item) => ({ ...item, inboxId: item._id })),
    ...ownedInboxItems.map((item) => ({ ...item, inboxId: item._id })),
    ...submissionItems.map((item) => ({ ...item, inboxId: item._id })),
    ...ownedSubmissionItems.map((item) => ({ ...item, inboxId: item._id }))
  ]
    .sort((a, b) => normalizeTime(b.createdAt || b.updatedAt) - normalizeTime(a.createdAt || a.updatedAt))
    .filter((item) => {
      const key = `${item.challengeId || ""}:${item.friendOpenId || item._id || ""}`;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });

  for (const item of items) {
    try {
      entries.push(await buildEntry(item, cache));
    } catch (error) {
      console.warn("read creator result item failed", item._id, error);
      pushWarning(warnings, "entry", error);
    }
  }

  return {
    ok: true,
    entries,
    cursor: now.getTime(),
    warnings
  };
};
