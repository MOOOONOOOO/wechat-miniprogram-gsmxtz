const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
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

exports.main = async (event) => {
  const resultId = cleanText(event.resultId, 120);
  const shareToken = cleanText(event.shareToken, 80);
  if (!resultId) return { ok: false, message: "缺少 resultId" };

  const resultRes = await db.collection("challengeResults").doc(resultId).get();
  const sharedRecord = resultRes.data || {};
  const expiresAt = sharedRecord.expiresAt ? new Date(sharedRecord.expiresAt) : null;
  const tokenMatched = Boolean(shareToken && sharedRecord.shareToken && shareToken === sharedRecord.shareToken);
  if (sharedRecord.visibility !== "public" && !tokenMatched) return { ok: false, message: "这个结果暂时不可查看" };
  if (expiresAt && expiresAt.getTime() <= Date.now()) return { ok: false, message: "这个结果已过期" };

  const challengeRes = await db.collection("challenges").doc(sharedRecord.challengeId).get();
  const challengeData = challengeRes.data || {};
  const creatorProfile = await resolveProfileAvatar(challengeData.creatorProfile || {});
  const friendProfile = await resolveProfileAvatar(sharedRecord.friendProfile || {});
  const challenge = {
    challengeId: sharedRecord.challengeId,
    mode: challengeData.mode || "artist",
    targetCount: challengeData.targetCount || 9,
    artists: challengeData.artists || [],
    albums: challengeData.albums || [],
    colors: challengeData.colors || [],
    qaPrompts: challengeData.qaPrompts || [],
    qaSolo: challengeData.qaSolo === true,
    topArtist: challengeData.topArtist || null,
    creatorChoices: challengeData.creatorChoices || {},
    creatorTopSongs: challengeData.creatorTopSongs || [],
    creatorProfile,
    creatorOpenId: challengeData.creatorOpenId
  };
  const items = challenge.mode === "album"
    ? challenge.albums
    : (challenge.mode === "color" ? challenge.colors : (challenge.mode === "qa" ? challenge.qaPrompts : challenge.artists));
  const result = challenge.mode === "top9"
    ? compareTopSongs(challenge.topArtist, challenge.creatorTopSongs, sharedRecord.friendTopSongs || [])
    : (challenge.mode === "qa" ? compareQaAnswers(items, challenge.creatorChoices, sharedRecord.friendChoices || {})
    : compareByItems(items, challenge.creatorChoices, sharedRecord.friendChoices || {}));

  return {
    ok: true,
    resultId,
    shareToken: sharedRecord.shareToken || "",
    challenge,
    submission: {
      submissionId: resultId,
      resultId,
      challengeId: sharedRecord.challengeId,
      friendChoices: sharedRecord.friendChoices || {},
      friendTopSongs: sharedRecord.friendTopSongs || [],
      friendProfile,
      sharedByRole: sharedRecord.sharedByRole || "friend",
      createdAt: sharedRecord.createdAt || null,
      expiresAt: sharedRecord.expiresAt || null
    },
    result
  };
};
