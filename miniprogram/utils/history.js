const HISTORY_KEY = "challengeHistory:v1";
const {
  deriveTournament,
  getSongName,
  listTournamentHistory
} = require("./songTournament");

function now() {
  return Date.now();
}

function readHistory() {
  let history = {};
  try {
    history = wx.getStorageSync(HISTORY_KEY) || {};
  } catch (error) {
    history = {};
  }
  return {
    created: Array.isArray(history.created) ? history.created : [],
    participated: Array.isArray(history.participated) ? history.participated : []
  };
}

function slimSong(song) {
  if (!song) return null;
  const cover = song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || song.artworkUrl60 || song.picUrl || song.albumCover || song.imageUrl || "";
  return {
    trackId: song.trackId || "",
    name: song.name || song.trackName || "",
    trackName: song.trackName || song.name || "",
    artistName: song.artistName || "",
    album: song.album || song.collectionName || "",
    cover,
    coverUrl: cover,
    artworkUrl100: song.artworkUrl100 || "",
    artworkUrl600: song.artworkUrl600 || cover,
    rank: song.rank || 0
  };
}

function slimChoices(choices = {}) {
  return Object.keys(choices || {}).reduce((map, key) => {
    const song = slimSong(choices[key]);
    if (song) map[key] = song;
    return map;
  }, {});
}

function isStableAvatarUrl(url) {
  const value = String(url || "").trim();
  if (!value) return false;
  if (value.indexOf("cloud://") === 0) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  return !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(value);
}

function slimProfile(profile = {}) {
  return {
    nickName: profile.nickName || "",
    avatarUrl: isStableAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : ""
  };
}

function mergeProfiles(incomingProfile = {}, savedProfile = {}) {
  const incoming = slimProfile(incomingProfile);
  const saved = slimProfile(savedProfile);
  return {
    nickName: incoming.nickName || saved.nickName || "",
    avatarUrl: incoming.avatarUrl || saved.avatarUrl || ""
  };
}

function slimSubject(item = {}) {
  const cover = item.cover || item.coverUrl || item.avatarUrl || item.artworkUrl600 || item.artworkUrl100 || item.artworkUrl60 || "";
  return {
    id: item.id || "",
    name: item.name || item.title || item.prompt || "",
    title: item.title || "",
    prompt: item.prompt || "",
    count: Number(item.count || 0),
    part: item.part || "",
    color: item.color || "",
    textColor: item.textColor || "",
    borderColor: item.borderColor || "",
    cover,
    coverUrl: cover,
    avatarUrl: item.avatarUrl || cover,
    artworkUrl100: item.artworkUrl100 || "",
    artworkUrl600: item.artworkUrl600 || cover
  };
}

function slimComparison(item = {}) {
  return {
    matched: item.matched === true,
    creatorRank: item.creatorRank || 0,
    friendRank: item.friendRank || 0,
    rankHitText: item.rankHitText || "",
    artist: slimSubject(item.artist || item.subject || {}),
    subject: slimSubject(item.subject || item.artist || {}),
    creator: slimSong(item.creator),
    friend: slimSong(item.friend)
  };
}

function slimResult(result = {}) {
  return {
    mode: result.mode || "",
    score: result.score || 0,
    matchCount: result.matchCount || 0,
    totalCount: result.totalCount || 0,
    resultCopy: result.resultCopy || "",
    topArtist: result.topArtist ? slimSubject(result.topArtist) : null,
    creatorTopSongs: (result.creatorTopSongs || []).map(slimSong).filter(Boolean),
    friendTopSongs: (result.friendTopSongs || []).map(slimSong).filter(Boolean),
    top9LeftSongs: (result.top9LeftSongs || []).map(slimSong).filter(Boolean),
    top9RightSongs: (result.top9RightSongs || []).map(slimSong).filter(Boolean),
    matchedSongs: (result.matchedSongs || []).map((item) => {
      const song = slimSong(item);
      return song ? {
        ...song,
        creatorRank: item.creatorRank || 0,
        friendRank: item.friendRank || 0
      } : null;
    }).filter(Boolean),
    topRankMatches: Array.isArray(result.topRankMatches) ? result.topRankMatches.slice(0, 9) : [],
    comparisons: (result.comparisons || []).map(slimComparison),
    matched: (result.matched || []).map(slimComparison),
    missed: (result.missed || []).map(slimComparison),
    colorResults: (result.colorResults || []).map(slimComparison),
    qaResults: (result.qaResults || []).map(slimComparison)
  };
}

function slimChallenge(challenge = {}) {
  const mode = challenge.mode || "artist";
  return {
    challengeId: challenge.challengeId || "",
    mode,
    targetCount: challenge.targetCount || 9,
    artists: (challenge.artists || []).map(slimSubject),
    albums: (challenge.albums || []).map(slimSubject),
    colors: (challenge.colors || []).map(slimSubject),
    qaPrompts: (challenge.qaPrompts || []).map(slimSubject),
    treePrompts: (challenge.treePrompts || []).map(slimSubject),
    qaSolo: challenge.qaSolo === true,
    topArtist: challenge.topArtist ? slimSubject(challenge.topArtist) : null,
    creatorChoices: slimChoices(challenge.creatorChoices || {}),
    creatorTopSongs: (challenge.creatorTopSongs || []).map(slimSong).filter(Boolean),
    creatorProfile: slimProfile(challenge.creatorProfile || {}),
    creatorOpenId: challenge.creatorOpenId || "",
    createdAt: challenge.createdAt || challenge.savedAt || now()
  };
}

function compactHistory(history, limits = {}) {
  const createdLimit = Number(limits.createdLimit || 30);
  const resultLimit = Number(limits.resultLimit || 99);
  const participatedLimit = Number(limits.participatedLimit || 30);
  return {
    created: (history.created || []).slice(0, createdLimit).map((record) => ({
      ...record,
      challenge: slimChallenge(record.challenge || {}),
      creatorProfile: slimProfile(record.creatorProfile || {}),
      results: (record.results || []).slice(0, resultLimit).map((result) => ({
        ...result,
        friendProfile: slimProfile(result.friendProfile || {}),
        friendChoices: slimChoices(result.friendChoices || {}),
        friendTopSongs: (result.friendTopSongs || []).map(slimSong).filter(Boolean),
        result: slimResult(result.result || {})
      }))
    })),
    participated: (history.participated || []).slice(0, participatedLimit).map((record) => ({
      ...record,
      challenge: slimChallenge(record.challenge || {}),
      creatorProfile: slimProfile(record.creatorProfile || {}),
      friendProfile: slimProfile(record.friendProfile || {}),
      friendChoices: slimChoices(record.friendChoices || {}),
      friendTopSongs: (record.friendTopSongs || []).map(slimSong).filter(Boolean),
      result: slimResult(record.result || {})
    }))
  };
}

function writeHistory(history) {
  const value = {
    created: Array.isArray(history.created) ? history.created : [],
    participated: Array.isArray(history.participated) ? history.participated : []
  };
  try {
    wx.setStorageSync(HISTORY_KEY, compactHistory(value));
    return true;
  } catch (error) {
    try {
      wx.setStorageSync(HISTORY_KEY, compactHistory(value, {
        createdLimit: 12,
        resultLimit: 50,
        participatedLimit: 12
      }));
      return true;
    } catch (retryError) {
      try {
        wx.setStorageSync(HISTORY_KEY, compactHistory(value, {
          createdLimit: 6,
          resultLimit: 20,
          participatedLimit: 6
        }));
        return true;
      } catch (finalError) {
        console.warn("save history failed", finalError);
        return false;
      }
    }
  }
}

function modeTitle(mode) {
  if (mode === "top9") return "同担 Top 挑战";
  if (mode === "color") return "颜色推歌挑战";
  if (mode === "qa") return "歌单问答";
  if (mode === "tree") return "圣诞树推歌";
  if (mode === "introQuiz") return "片段猜歌挑战";
  return mode === "album" ? "专辑默契挑战" : "歌手默契挑战";
}

function normalizeTime(value) {
  if (!value) return now();
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? now() : parsed;
  }
  if (value.$date) return normalizeTime(value.$date);
  return now();
}

function getChallengeItems(challenge) {
  const mode = (challenge || {}).mode || "artist";
  if (mode === "top9") return (challenge || {}).topArtist ? [(challenge || {}).topArtist] : [];
  if (mode === "color") return (challenge || {}).colors || [];
  if (mode === "qa") return (challenge || {}).qaPrompts || [];
  if (mode === "tree") return (challenge || {}).treePrompts || [];
  return mode === "album" ? ((challenge || {}).albums || []) : ((challenge || {}).artists || []);
}

function makeCreatedRecord(challenge) {
  const slimmedChallenge = slimChallenge(challenge);
  const createdAt = normalizeTime(challenge.createdAt || challenge.savedAt);
  return {
    type: "created",
    challengeId: slimmedChallenge.challengeId,
    mode: slimmedChallenge.mode || "artist",
    title: modeTitle(challenge.mode),
    challenge: slimmedChallenge,
    creatorProfile: slimmedChallenge.creatorProfile || {},
    itemCount: getChallengeItems(slimmedChallenge).length,
    results: [],
    createdAt,
    updatedAt: createdAt
  };
}

function saveCreatedChallenge(challenge) {
  if (!challenge || !challenge.challengeId) return false;
  const history = readHistory();
  const index = history.created.findIndex((item) => item.challengeId === challenge.challengeId);
  if (index >= 0) {
    history.created[index] = {
      ...history.created[index],
      mode: challenge.mode || history.created[index].mode,
      title: modeTitle(challenge.mode || history.created[index].mode),
      challenge: {
        ...history.created[index].challenge,
        ...slimChallenge(challenge)
      },
      creatorProfile: slimProfile(challenge.creatorProfile || history.created[index].creatorProfile || {}),
      itemCount: getChallengeItems(challenge).length || history.created[index].itemCount,
      updatedAt: now()
    };
  } else {
    history.created.unshift(makeCreatedRecord(challenge));
  }
  return writeHistory(history);
}

function saveParticipatedResult(snapshot) {
  if (!snapshot || !snapshot.challengeId || !snapshot.result) return false;
  const history = readHistory();
  const savedAt = normalizeTime(snapshot.savedAt);
  const existingIndex = history.participated.findIndex((item) => item.challengeId === snapshot.challengeId);
  const existingRecord = existingIndex >= 0 ? history.participated[existingIndex] : {};
  const record = {
    type: "participated",
    challengeId: snapshot.challengeId,
    mode: snapshot.mode || ((snapshot.challenge || {}).mode) || "artist",
    title: modeTitle(snapshot.mode || ((snapshot.challenge || {}).mode)),
    challenge: slimChallenge(snapshot.challenge || {}),
    creatorProfile: mergeProfiles(snapshot.creatorProfile || ((snapshot.challenge || {}).creatorProfile) || {}, existingRecord.creatorProfile || {}),
    friendProfile: mergeProfiles(snapshot.friendProfile || {}, existingRecord.friendProfile || {}),
    friendChoices: slimChoices(snapshot.friendChoices || {}),
    friendTopSongs: (snapshot.friendTopSongs || []).map(slimSong).filter(Boolean),
    resultId: snapshot.resultId || (snapshot.result || {}).resultId || "",
    shareToken: snapshot.shareToken || "",
    result: slimResult(snapshot.result || {}),
    resultCopy: snapshot.resultCopy || (snapshot.result || {}).resultCopy || "",
    savedAt,
    updatedAt: savedAt
  };
  if (existingIndex >= 0) history.participated[existingIndex] = { ...history.participated[existingIndex], ...record };
  else history.participated.unshift(record);
  return writeHistory(history);
}

function makeResultId(entry) {
  return entry.resultId || entry.inboxId || `${entry.challengeId}:${entry.friendOpenId || "friend"}:${normalizeTime(entry.createdAt)}`;
}

function saveReceivedResult(entry) {
  if (!entry || !entry.challenge || !entry.challenge.challengeId || !entry.result) return false;
  saveCreatedChallenge(entry.challenge);
  const history = readHistory();
  const challengeId = entry.challenge.challengeId;
  const index = history.created.findIndex((item) => item.challengeId === challengeId);
  if (index < 0) return false;

  const resultId = makeResultId(entry);
  const createdAt = normalizeTime(entry.createdAt);
  const existingResults = Array.isArray(history.created[index].results) ? history.created[index].results : [];
  const reusableProfile = existingResults.find((item) => (
    (entry.friendOpenId && item.friendOpenId === entry.friendOpenId)
      || ((item.friendProfile || {}).nickName && (item.friendProfile || {}).nickName === (entry.friendProfile || {}).nickName)
  )) || {};
  const resultRecord = {
    resultId,
    shareToken: entry.shareToken || "",
    inboxId: entry.inboxId || "",
    challengeId,
    friendOpenId: entry.friendOpenId || "",
    friendProfile: mergeProfiles(entry.friendProfile || {}, reusableProfile.friendProfile || {}),
    friendChoices: slimChoices(entry.friendChoices || {}),
    friendTopSongs: (entry.friendTopSongs || []).map(slimSong).filter(Boolean),
    result: slimResult(entry.result || {}),
    resultCopy: entry.resultCopy || (entry.result || {}).resultCopy || "",
    score: (entry.result || {}).score || 0,
    matchCount: (entry.result || {}).matchCount || 0,
    totalCount: (entry.result || {}).totalCount || 0,
    createdAt,
    receivedAt: normalizeTime(entry.receivedAt)
  };
  const resultIndex = existingResults.findIndex((item) => item.resultId === resultId || (item.inboxId && item.inboxId === resultRecord.inboxId));
  if (resultIndex >= 0) {
    existingResults[resultIndex] = {
      ...existingResults[resultIndex],
      ...resultRecord,
      friendProfile: mergeProfiles(resultRecord.friendProfile, existingResults[resultIndex].friendProfile || {})
    };
  }
  else existingResults.unshift(resultRecord);

  history.created[index] = {
    ...history.created[index],
    results: existingResults.sort((a, b) => normalizeTime(b.createdAt) - normalizeTime(a.createdAt)),
    updatedAt: Math.max(normalizeTime(history.created[index].updatedAt), createdAt)
  };
  return writeHistory(history);
}

function getCreatedChallenge(challengeId) {
  return readHistory().created.find((item) => item.challengeId === challengeId) || null;
}

function getCreatedChallengeIds() {
  return readHistory().created
    .map((item) => item.challengeId)
    .filter(Boolean);
}

function getCreatedChallengeIdsMissingFriendAvatars() {
  return readHistory().created
    .filter((record) => (record.results || []).some((item) => {
      const profile = item.friendProfile || {};
      return (item.friendOpenId || profile.nickName) && !isStableAvatarUrl(profile.avatarUrl);
    }))
    .map((item) => item.challengeId)
    .filter(Boolean)
    .slice(0, 20);
}

function getCreatedResult(challengeId, resultId) {
  const record = getCreatedChallenge(challengeId);
  if (!record) return null;
  const result = (record.results || []).find((item) => item.resultId === resultId);
  return result ? { challengeRecord: record, resultRecord: result } : null;
}

function getParticipatedResult(challengeId) {
  return readHistory().participated.find((item) => item.challengeId === challengeId) || null;
}

function deleteHistoryRecord(type, challengeId) {
  const history = readHistory();
  if (type === "created") {
    history.created = history.created.filter((item) => item.challengeId !== challengeId);
  } else if (type === "participated") {
    history.participated = history.participated.filter((item) => item.challengeId !== challengeId);
  }
  writeHistory(history);
}

function deleteCreatedResult(challengeId, resultId) {
  const history = readHistory();
  const index = history.created.findIndex((item) => item.challengeId === challengeId);
  if (index < 0) return;
  history.created[index] = {
    ...history.created[index],
    results: (history.created[index].results || []).filter((item) => item.resultId !== resultId),
    updatedAt: now()
  };
  writeHistory(history);
}

function formatTime(timestamp) {
  const date = new Date(normalizeTime(timestamp));
  const current = new Date();
  const sameDay = date.toDateString() === current.toDateString();
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1).toDateString() === date.toDateString();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  if (yesterday) return `昨天 ${hh}:${mm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

function summarizeCreated(record) {
  const results = Array.isArray(record.results) ? record.results : [];
  const isColorMode = record.mode === "color";
  const isQaMode = record.mode === "qa";
  const isTreeMode = record.mode === "tree";
  const highest = results.reduce((max, item) => Math.max(max, Number(item.score) || 0), 0);
  const latestTime = results[0] ? results[0].createdAt : record.createdAt;
  const creatorProfile = record.creatorProfile || ((record.challenge || {}).creatorProfile) || {};
  const canView = results.length > 0;
  const canShare = true;
  const actionCount = (canView ? 1 : 0) + (canShare ? 1 : 0) + 1;
  return {
    id: `created:${record.challengeId}`,
    type: "created",
    typeText: "我发起",
    challengeId: record.challengeId,
    title: modeTitle(record.mode),
    counterpartName: results.length ? `${results.length} 位朋友已作答` : "待朋友作答",
    avatarText: (creatorProfile.nickName || "我").slice(0, 1),
    avatarUrl: creatorProfile.avatarUrl || "",
    scoreText: (isColorMode || isQaMode || isTreeMode) ? (results.length ? "看结果" : "待作答") : (results.length ? `最高 ${highest}%` : "待作答"),
    timeText: formatTime(latestTime),
    rawTime: normalizeTime(latestTime),
    resultCount: results.length,
    canView,
    canShare,
    actionClass: `action-count-${actionCount}`
  };
}

function summarizeParticipated(record) {
  const creatorProfile = record.creatorProfile || {};
  const score = (record.result || {}).score || 0;
  const isColorMode = record.mode === "color";
  const isQaMode = record.mode === "qa";
  const isTreeMode = record.mode === "tree";
  const isIntroQuiz = record.mode === "introQuiz";
  const quizArtist = (((record.challenge || {}).artists || [])[0]) || {};
  if (isIntroQuiz) {
    return {
      id: `participated:${record.challengeId}`,
      type: "participated",
      recordKind: "introQuiz",
      typeText: "我参与",
      challengeId: record.challengeId,
      title: modeTitle(record.mode),
      counterpartName: quizArtist.name || "本场曲库",
      avatarText: (quizArtist.name || "音").slice(0, 1),
      avatarUrl: quizArtist.cover || quizArtist.coverUrl || quizArtist.avatarUrl || "",
      scoreText: `${score}%`,
      timeText: formatTime(record.savedAt || record.updatedAt),
      rawTime: normalizeTime(record.savedAt || record.updatedAt),
      resultCount: 1,
      canView: false,
      canShare: false,
      actionClass: "action-count-1"
    };
  }
  return {
    id: `participated:${record.challengeId}`,
    type: "participated",
    typeText: "我参与",
    challengeId: record.challengeId,
    title: modeTitle(record.mode),
    counterpartName: creatorProfile.nickName || "匿名挑战者",
    avatarText: (creatorProfile.nickName || "友").slice(0, 1),
    avatarUrl: creatorProfile.avatarUrl || "",
    scoreText: (isColorMode || isQaMode || isTreeMode) ? "看结果" : `${score}%`,
    timeText: formatTime(record.savedAt || record.updatedAt),
    rawTime: normalizeTime(record.savedAt || record.updatedAt),
    resultCount: 1,
    canView: true,
    canShare: false,
    actionClass: "action-count-2"
  };
}

function summarizeTournament(record) {
  const derived = deriveTournament(record);
  if (!derived.valid || !derived.complete) return null;
  const champion = derived.champion || {};
  const artist = record.artist || {};
  const completedAt = record.completedAt || record.updatedAt || record.createdAt;
  const championName = getSongName(champion) || "未命名歌曲";
  const cover = champion.cover || champion.coverUrl || champion.artworkUrl600 || champion.artworkUrl100 || "";
  return {
    id: `tournament:${record.id}`,
    type: "created",
    recordKind: "tournament",
    typeText: "我发起",
    challengeId: record.id,
    tournamentId: record.id,
    title: "决战歌曲之巅",
    counterpartName: artist.name || artist.artistName || "歌曲决选",
    avatarText: championName.slice(0, 1) || "音",
    avatarUrl: cover,
    scoreText: `冠军《${championName}》`,
    timeText: formatTime(completedAt),
    rawTime: normalizeTime(completedAt),
    resultCount: 1,
    canView: true,
    canShare: false,
    actionClass: "action-count-2"
  };
}

function listHistory(filter = "all") {
  const history = readHistory();
  const created = history.created.map(summarizeCreated);
  const participated = history.participated.map(summarizeParticipated);
  const tournaments = listTournamentHistory().map(summarizeTournament).filter(Boolean);
  return [...created, ...participated, ...tournaments]
    .filter((item) => filter === "all" || item.type === filter)
    .sort((a, b) => b.rawTime - a.rawTime);
}

module.exports = {
  deleteCreatedResult,
  deleteHistoryRecord,
  getCreatedChallenge,
  getCreatedChallengeIds,
  getCreatedChallengeIdsMissingFriendAvatars,
  getCreatedResult,
  getParticipatedResult,
  listHistory,
  saveCreatedChallenge,
  saveParticipatedResult,
  saveReceivedResult
};
