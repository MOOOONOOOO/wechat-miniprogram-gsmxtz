const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

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

async function resolveProfileAvatar(profile = {}) {
  const avatarUrl = profile.avatarUrl || "";
  if (!isCloudFileUrl(avatarUrl)) return profile;

  try {
    const urls = await cloud.getTempFileURL({
      fileList: [avatarUrl]
    });
    const tempFileURL = ((urls.fileList || [])[0] || {}).tempFileURL || "";
    return {
      ...profile,
      avatarUrl: tempFileURL || avatarUrl
    };
  } catch (error) {
    return profile;
  }
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
  const comparisons = safePrompts.map((subject) => {
    const creator = (creatorChoices || {})[subject.id];
    const friend = (friendChoices || {})[subject.id];
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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const challengeId = event.challengeId;
  const now = new Date();

  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  await cleanupExpiredSubmissions(now);

  const persistentResults = await db.collection("challengeResults")
    .where({
      challengeId,
      friendOpenId: wxContext.OPENID,
      expiresAt: _.gt(now)
    })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }));

  let submission = (persistentResults.data || [])
    .sort((a, b) => normalizeTime(b.createdAt || b.updatedAt) - normalizeTime(a.createdAt || a.updatedAt))[0];

  const submissions = submission ? { data: [] } : await db.collection("submissions")
    .where({
      challengeId,
      friendOpenId: wxContext.OPENID,
      expiresAt: _.gt(now)
    })
    .limit(20)
    .get();

  if (!submission) {
    submission = (submissions.data || [])
      .sort((a, b) => normalizeTime(b.createdAt) - normalizeTime(a.createdAt))[0];
  }
  if (!submission) {
    return {
      ok: true,
      submission: null
    };
  }

  const challengeRes = await db.collection("challenges").doc(challengeId).get();
  const creatorProfile = await resolveProfileAvatar(challengeRes.data.creatorProfile || {});
  const friendProfile = await resolveProfileAvatar(submission.friendProfile || {});
  const challenge = {
    challengeId,
    mode: challengeRes.data.mode || "artist",
    targetCount: challengeRes.data.targetCount || 9,
    artists: challengeRes.data.artists || [],
    albums: challengeRes.data.albums || [],
    colors: challengeRes.data.colors || [],
    qaPrompts: challengeRes.data.qaPrompts || [],
    topArtist: challengeRes.data.topArtist || null,
    creatorChoices: challengeRes.data.creatorChoices || {},
    creatorTopSongs: challengeRes.data.creatorTopSongs || [],
    creatorProfile,
    creatorOpenId: challengeRes.data.creatorOpenId
  };
  const items = challenge.mode === "album"
    ? challenge.albums
    : (challenge.mode === "color" ? challenge.colors : (challenge.mode === "qa" ? challenge.qaPrompts : challenge.artists));
  const result = challenge.mode === "top9"
    ? compareTopSongs(challenge.topArtist, challenge.creatorTopSongs, submission.friendTopSongs || [])
    : (challenge.mode === "qa" ? compareQaAnswers(items, challenge.creatorChoices, submission.friendChoices || {})
    : compareByItems(items, challenge.creatorChoices, submission.friendChoices || {}));

  return {
    ok: true,
    shareToken: submission.shareToken || "",
    submission: {
      submissionId: submission.resultId || submission._id,
      resultId: submission.resultId || submission._id,
      shareToken: submission.shareToken || "",
      challengeId,
      friendChoices: submission.friendChoices || {},
      friendTopSongs: submission.friendTopSongs || [],
      friendProfile,
      expiresAt: submission.expiresAt || null,
      createdAt: submission.createdAt || null
    },
    challenge,
    result
  };
};
