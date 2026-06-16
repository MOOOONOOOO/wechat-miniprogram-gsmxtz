const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_PARTICIPANTS = 99;
const SUPPORTED_MODES = ["artist", "album", "top9"];

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

function normalizeProfile(profile = {}, fallbackName = "匿名朋友") {
  const nickName = String(profile.nickName || fallbackName).trim() || fallbackName;
  return {
    nickName,
    avatarUrl: profile.avatarUrl || "",
    initial: nickName.slice(0, 1)
  };
}

function isUnexpired(item, now) {
  const expiresAt = normalizeTime(item && item.expiresAt);
  return !expiresAt || expiresAt > now.getTime();
}

function songCover(song) {
  return (song && (song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || song.picUrl || song.albumCover || song.imageUrl || song.avatarUrl)) || "";
}

function songName(song) {
  return (song && (song.name || song.trackName)) || "";
}

function compareChoices(items, leftChoices, rightChoices) {
  const safeItems = Array.isArray(items) ? items : [];
  const left = leftChoices || {};
  const right = rightChoices || {};
  const comparisons = safeItems.map((subject) => {
    const leftSong = left[subject.id];
    const rightSong = right[subject.id];
    const matched = Boolean(leftSong && rightSong && leftSong.trackId && leftSong.trackId === rightSong.trackId);
    return {
      artist: subject,
      subject,
      creator: leftSong,
      friend: rightSong,
      matched,
      badgeText: matched ? "✓ 契合" : "× 不同",
      badgeClass: matched ? "" : "no",
      cover: songCover(rightSong) || songCover(leftSong),
      songName: songName(rightSong) || songName(leftSong)
    };
  });
  const matchCount = comparisons.filter((item) => item.matched).length;
  const totalCount = safeItems.length || 0;
  return {
    comparisons,
    matchCount,
    totalCount,
    score: totalCount ? Math.round((matchCount / totalCount) * 100) : 0
  };
}

function normalizeTopSongs(songs) {
  return (Array.isArray(songs) ? songs : [])
    .filter((song) => song && song.trackId)
    .map((song, index) => ({
      ...song,
      rank: song.rank || index + 1,
      cover: songCover(song),
      coverUrl: songCover(song),
      name: song.name || song.trackName || ""
    }));
}

function compareTopSongs(topArtist, leftSongs, rightSongs) {
  const leftList = normalizeTopSongs(leftSongs);
  const rightList = normalizeTopSongs(rightSongs);
  const leftRankMap = leftList.reduce((map, song, index) => {
    map[song.trackId] = index + 1;
    return map;
  }, {});
  const rightRankMap = rightList.reduce((map, song, index) => {
    map[song.trackId] = index + 1;
    return map;
  }, {});
  const matchedSongs = leftList
    .map((song, index) => ({
      ...song,
      creatorRank: index + 1,
      friendRank: rightRankMap[song.trackId] || 0,
      matched: Boolean(rightRankMap[song.trackId])
    }))
    .filter((song) => song.matched);
  const topRankMatches = matchedSongs.filter((song) => song.creatorRank <= 3 && song.creatorRank === song.friendRank);
  const totalCount = Math.max(leftList.length, rightList.length, 1);
  return {
    mode: "top9",
    topArtist: topArtist || {},
    creatorTopSongs: leftList.map((song, index) => ({
      ...song,
      rank: index + 1,
      matched: Boolean(rightRankMap[song.trackId])
    })),
    friendTopSongs: rightList.map((song, index) => ({
      ...song,
      rank: index + 1,
      matched: Boolean(leftRankMap[song.trackId])
    })),
    matchedSongs,
    topRankMatches,
    matchCount: matchedSongs.length,
    totalCount,
    score: Math.round((matchedSongs.length / totalCount) * 100)
  };
}

function slimChallenge(challengeId, data) {
  return {
    challengeId,
    mode: data.mode || "artist",
    targetCount: data.targetCount || 9,
    artists: data.artists || [],
    albums: data.albums || [],
    colors: data.colors || [],
    qaPrompts: data.qaPrompts || [],
    qaSolo: data.qaSolo === true,
    topArtist: data.topArtist || null,
    creatorChoices: data.creatorChoices || {},
    creatorTopSongs: data.creatorTopSongs || [],
    creatorProfile: data.creatorProfile || {},
    creatorOpenId: data.creatorOpenId || ""
  };
}

function makeCreatorParticipant(challenge) {
  return {
    participantId: "creator",
    role: "creator",
    resultId: "",
    friendOpenId: "",
    profile: normalizeProfile(challenge.creatorProfile || {}, "发起人"),
    choices: challenge.creatorChoices || {},
    topSongs: challenge.creatorTopSongs || [],
    createdAt: normalizeTime(challenge.createdAt)
  };
}

function makeFriendParticipant(item) {
  return {
    participantId: item.resultId || item._id || "",
    role: "friend",
    resultId: item.resultId || item._id || "",
    friendOpenId: item.friendOpenId || "",
    profile: normalizeProfile(item.friendProfile || {}, "匿名朋友"),
    choices: item.friendChoices || {},
    topSongs: item.friendTopSongs || [],
    createdAt: normalizeTime(item.createdAt)
  };
}

function participantName(participant) {
  return (participant && participant.profile && participant.profile.nickName) || "匿名朋友";
}

function participantAvatar(participant) {
  return (participant && participant.profile && participant.profile.avatarUrl) || "";
}

function compareParticipants(challenge, left, right) {
  const mode = challenge.mode || "artist";
  const result = mode === "top9"
    ? compareTopSongs(challenge.topArtist, left.topSongs, right.topSongs)
    : compareChoices(mode === "album" ? challenge.albums : challenge.artists, left.choices, right.choices);
  return {
    score: result.score,
    matchCount: result.matchCount || 0,
    totalCount: result.totalCount || 0,
    result
  };
}

function buildPairSummary(challenge, left, right) {
  const compared = compareParticipants(challenge, left, right);
  return {
    pairId: `${left.participantId}__${right.participantId}`,
    leftParticipantId: left.participantId,
    rightParticipantId: right.participantId,
    leftName: participantName(left),
    rightName: participantName(right),
    leftAvatarUrl: participantAvatar(left),
    rightAvatarUrl: participantAvatar(right),
    leftInitial: (participantName(left) || "友").slice(0, 1),
    rightInitial: (participantName(right) || "友").slice(0, 1),
    score: compared.score,
    matchCount: compared.matchCount,
    totalCount: compared.totalCount,
    matchText: `${compared.matchCount}/${compared.totalCount || 0} 契合`
  };
}

function sortPairs(pairs) {
  return pairs.sort((a, b) => (
    b.score - a.score ||
    b.matchCount - a.matchCount ||
    String(a.leftName).localeCompare(String(b.leftName), "zh-Hans-CN")
  ));
}

async function readChallenge(challengeId) {
  const res = await db.collection("challenges").doc(challengeId).get();
  return slimChallenge(challengeId, res.data || {});
}

async function readFriendResults(challengeId, now) {
  const res = await db.collection("challengeResults")
    .where({ challengeId })
    .limit(MAX_PARTICIPANTS)
    .get();
  return (res.data || [])
    .filter((item) => isUnexpired(item, now))
    .sort((a, b) => normalizeTime(b.createdAt) - normalizeTime(a.createdAt));
}

function findParticipant(participants, participantId, openId) {
  if (participantId) {
    return participants.find((item) => item.participantId === participantId || item.resultId === participantId) || null;
  }
  if (openId) {
    return participants.find((item) => item.friendOpenId === openId) || null;
  }
  return null;
}

function canRead(challenge, participants, openId) {
  if (!openId) return false;
  return challenge.creatorOpenId === openId || participants.some((item) => item.friendOpenId === openId);
}

function canReadPair(challenge, left, right, openId) {
  if (!openId) return false;
  if (challenge.creatorOpenId === openId) return true;
  return left.friendOpenId === openId || right.friendOpenId === openId;
}

function buildSummary(challenge, participants, openId, viewerParticipantId) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < participants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < participants.length; rightIndex += 1) {
      pairs.push(buildPairSummary(challenge, participants[leftIndex], participants[rightIndex]));
    }
  }
  const rankedPairs = sortPairs(pairs);
  const creator = participants.find((item) => item.role === "creator");
  const creatorLeaderboard = creator
    ? sortPairs(participants
        .filter((item) => item.role === "friend")
        .map((item) => buildPairSummary(challenge, creator, item)))
    : [];
  const viewer = findParticipant(participants, viewerParticipantId, openId);
  const viewerRanking = viewer
    ? sortPairs(participants
        .filter((item) => item.participantId !== viewer.participantId)
        .map((item) => buildPairSummary(challenge, viewer, item)))
    : [];

  return {
    supported: true,
    mode: challenge.mode,
    participantCount: Math.max(0, participants.length - 1),
    viewerParticipantId: viewer ? viewer.participantId : "",
    bestPair: rankedPairs[0] || null,
    pairLeaderboard: rankedPairs.slice(0, 6),
    creatorLeaderboard: creatorLeaderboard.slice(0, 12),
    viewerRanking: viewerRanking.slice(0, 12)
  };
}

function buildPairResult(challenge, left, right) {
  const compared = compareParticipants(challenge, left, right);
  const pairChallenge = {
    ...challenge,
    creatorProfile: left.profile,
    creatorChoices: left.choices,
    creatorTopSongs: left.topSongs
  };
  return {
    pair: buildPairSummary(challenge, left, right),
    challenge: pairChallenge,
    friendProfile: right.profile,
    friendChoices: right.choices,
    friendTopSongs: right.topSongs,
    result: compared.result
  };
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID || "";
  const challengeId = String((event || {}).challengeId || "").trim();
  const now = new Date();

  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  const challenge = await readChallenge(challengeId);
  if (SUPPORTED_MODES.indexOf(challenge.mode) < 0) {
    return {
      ok: true,
      supported: false,
      mode: challenge.mode,
      message: "当前模式暂不支持多人同频"
    };
  }

  const friendItems = await readFriendResults(challengeId, now);
  const participants = [makeCreatorParticipant(challenge)].concat(friendItems.map(makeFriendParticipant));
  if (!canRead(challenge, participants, openId)) {
    return { ok: false, message: "暂无权限查看这场音乐局" };
  }

  if (event.action === "pair") {
    const left = findParticipant(participants, event.leftParticipantId || event.leftResultId || "", "");
    const right = findParticipant(participants, event.rightParticipantId || event.rightResultId || "", "");
    if (!left || !right) return { ok: false, message: "参与者不存在" };
    if (!canReadPair(challenge, left, right, openId)) {
      return { ok: false, message: "暂无权限查看这组对比" };
    }
    return {
      ok: true,
      supported: true,
      mode: challenge.mode,
      ...buildPairResult(challenge, left, right)
    };
  }

  return {
    ok: true,
    ...buildSummary(challenge, participants, openId, event.viewerParticipantId || event.viewerResultId || "")
  };
};
