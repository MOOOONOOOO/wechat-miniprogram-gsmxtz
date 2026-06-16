function resultSnapshotKey(challengeId) {
  return challengeId ? `resultSnapshot:${challengeId}` : "";
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
    rank: song.rank || 0,
    matched: song.matched === true
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

function slimChallenge(challenge = {}) {
  return {
    challengeId: challenge.challengeId || "",
    mode: challenge.mode || "artist",
    targetCount: challenge.targetCount || 9,
    artists: (challenge.artists || []).map(slimSubject),
    albums: (challenge.albums || []).map(slimSubject),
    colors: (challenge.colors || []).map(slimSubject),
    qaPrompts: (challenge.qaPrompts || []).map(slimSubject),
    qaSolo: challenge.qaSolo === true,
    topArtist: challenge.topArtist ? slimSubject(challenge.topArtist) : null,
    creatorChoices: slimChoices(challenge.creatorChoices || {}),
    creatorTopSongs: (challenge.creatorTopSongs || []).map(slimSong).filter(Boolean),
    creatorProfile: slimProfile(challenge.creatorProfile || {}),
    creatorOpenId: challenge.creatorOpenId || ""
  };
}

function slimComparison(item = {}) {
  return {
    ...item,
    artist: slimSubject(item.artist || item.subject || {}),
    subject: slimSubject(item.subject || item.artist || {}),
    creator: slimSong(item.creator),
    friend: slimSong(item.friend),
    topArtist: item.topArtist ? slimSubject(item.topArtist) : undefined
  };
}

function slimResult(result = {}) {
  return {
    ...result,
    topArtist: result.topArtist ? slimSubject(result.topArtist) : result.topArtist,
    creatorTopSongs: (result.creatorTopSongs || []).map(slimSong).filter(Boolean),
    friendTopSongs: (result.friendTopSongs || []).map(slimSong).filter(Boolean),
    top9LeftSongs: (result.top9LeftSongs || []).map(slimSong).filter(Boolean),
    top9RightSongs: (result.top9RightSongs || []).map(slimSong).filter(Boolean),
    matchedSongs: (result.matchedSongs || []).map(slimSong).filter(Boolean),
    comparisons: (result.comparisons || []).map(slimComparison),
    matched: (result.matched || []).map(slimComparison),
    missed: (result.missed || []).map(slimComparison),
    colorResults: (result.colorResults || []).map(slimComparison),
    qaResults: (result.qaResults || []).map(slimComparison)
  };
}

function slimSnapshot(snapshot) {
  return {
    ...snapshot,
    challenge: slimChallenge(snapshot.challenge || {}),
    friendChoices: slimChoices(snapshot.friendChoices || {}),
    friendTopSongs: (snapshot.friendTopSongs || []).map(slimSong).filter(Boolean),
    friendProfile: slimProfile(snapshot.friendProfile || {}),
    creatorProfile: slimProfile(snapshot.creatorProfile || {}),
    result: slimResult(snapshot.result || {})
  };
}

function getResultSnapshot(challengeId) {
  const key = resultSnapshotKey(challengeId);
  if (!key) return null;
  try {
    return wx.getStorageSync(key) || null;
  } catch (error) {
    return null;
  }
}

function saveResultSnapshot(challengeId, snapshot) {
  const key = resultSnapshotKey(challengeId);
  if (!key || !snapshot) return;
  const existing = getResultSnapshot(challengeId) || {};
  const value = {
    ...slimSnapshot(snapshot),
    challengeId,
    savedAt: Date.now()
  };
  value.friendProfile = mergeProfiles(value.friendProfile || {}, existing.friendProfile || {});
  value.creatorProfile = mergeProfiles(value.creatorProfile || {}, existing.creatorProfile || {});
  try {
    wx.setStorageSync(key, value);
    wx.setStorageSync("resultSnapshot:lastChallengeId", challengeId);
  } catch (error) {
    console.warn("save result snapshot failed", error);
  }
}

module.exports = {
  getResultSnapshot,
  saveResultSnapshot
};
