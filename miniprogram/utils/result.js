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
  const creatorSongs = Array.isArray(creatorTopSongs) ? creatorTopSongs.slice(0, 9) : [];
  const friendSongs = Array.isArray(friendTopSongs) ? friendTopSongs.slice(0, 9) : [];
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
    score: Math.round((matchedSongs.length / 9) * 100)
  };
}

module.exports = {
  compareByArtist: compareByItems,
  compareByItems,
  compareQaAnswers,
  compareTopSongs
};
