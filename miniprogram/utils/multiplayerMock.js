const FRIENDS = [
  { participantId: "mock-r-001", friendOpenId: "mock-friend-001", nickName: "阿满" },
  { participantId: "mock-r-002", friendOpenId: "mock-friend-002", nickName: "小夏" },
  { participantId: "mock-r-003", friendOpenId: "mock-friend-003", nickName: "边边" },
  { participantId: "mock-r-004", friendOpenId: "mock-friend-004", nickName: "栗子" },
  { participantId: "mock-r-005", friendOpenId: "mock-friend-005", nickName: "一口" }
];

function normalizeMode(mode) {
  return ["artist", "album", "top9"].indexOf(mode) >= 0 ? mode : "artist";
}

function song(id, name, artistName, rank) {
  return {
    trackId: id,
    name,
    trackName: name,
    artistName,
    album: "多人演示专辑",
    cover: "",
    coverUrl: "",
    artworkUrl100: "",
    artworkUrl600: "",
    rank: rank || 0
  };
}

function profile(name) {
  return {
    nickName: name,
    avatarUrl: ""
  };
}

function subjects(prefix, names) {
  return names.map((name, index) => ({
    id: `${prefix}-${index + 1}`,
    name,
    title: name,
    cover: "",
    coverUrl: "",
    avatarUrl: ""
  }));
}

function choiceMap(items, pattern, mode) {
  return (items || []).reduce((map, item, index) => {
    const token = pattern[index] || "x";
    const name = item.name || `题目 ${index + 1}`;
    const sameName = mode === "album" ? `${name} 主打歌` : `${name} 代表作`;
    map[item.id] = song(
      `mock-${mode}-${index + 1}-${token}`,
      token === "a" ? sameName : `${name} 私藏 ${token.toUpperCase()}`,
      mode === "album" ? "演示歌手" : name,
      index + 1
    );
    return map;
  }, {});
}

function compareChoices(items, leftChoices, rightChoices) {
  const comparisons = (items || []).map((item) => {
    const creator = (leftChoices || {})[item.id];
    const friend = (rightChoices || {})[item.id];
    const matched = Boolean(creator && friend && creator.trackId === friend.trackId);
    return {
      artist: item,
      subject: item,
      creator,
      friend,
      matched,
      badgeText: matched ? "✓ 契合" : "× 不同",
      badgeClass: matched ? "" : "no",
      cover: "",
      songName: ((friend || {}).name) || ((creator || {}).name) || ""
    };
  });
  const matchCount = comparisons.filter((item) => item.matched).length;
  const totalCount = comparisons.length;
  return {
    comparisons,
    matched: comparisons.filter((item) => item.matched),
    missed: comparisons.filter((item) => !item.matched),
    matchCount,
    totalCount,
    score: totalCount ? Math.round((matchCount / totalCount) * 100) : 0
  };
}

function topSongs(ids) {
  return ids.map((id, index) => song(
    `mock-top9-${id}`,
    id.indexOf("c") === 0 ? `共同歌曲 ${id.slice(1)}` : `私藏歌曲 ${id.slice(1)}`,
    "演示歌手",
    index + 1
  ));
}

function compareTopSongs(topArtist, leftSongs, rightSongs) {
  const rightRankMap = (rightSongs || []).reduce((map, item, index) => {
    if (item && item.trackId) map[item.trackId] = index + 1;
    return map;
  }, {});
  const leftRankMap = (leftSongs || []).reduce((map, item, index) => {
    if (item && item.trackId) map[item.trackId] = index + 1;
    return map;
  }, {});
  const matchedSongs = (leftSongs || [])
    .map((item, index) => ({
      ...item,
      creatorRank: index + 1,
      friendRank: rightRankMap[item.trackId] || 0,
      matched: Boolean(rightRankMap[item.trackId])
    }))
    .filter((item) => item.matched);
  const totalCount = Math.max((leftSongs || []).length, (rightSongs || []).length, 1);
  return {
    mode: "top9",
    topArtist,
    creatorTopSongs: (leftSongs || []).map((item, index) => ({
      ...item,
      rank: index + 1,
      matched: Boolean(rightRankMap[item.trackId])
    })),
    friendTopSongs: (rightSongs || []).map((item, index) => ({
      ...item,
      rank: index + 1,
      matched: Boolean(leftRankMap[item.trackId])
    })),
    matchedSongs,
    topRankMatches: matchedSongs.filter((item) => item.creatorRank <= 3 && item.creatorRank === item.friendRank),
    matchCount: matchedSongs.length,
    totalCount,
    score: Math.round((matchedSongs.length / totalCount) * 100)
  };
}

function challengeSeed(mode) {
  const safeMode = normalizeMode(mode);
  const creatorProfile = profile("周同学");
  if (safeMode === "album") {
    const albums = subjects("mock-album", [
      "夜航船", "春日回声", "雨季电台", "城市漫游", "慢速行星",
      "玻璃花园", "昨日磁带", "海边电影院", "温柔噪音"
    ]);
    return {
      challenge: {
        challengeId: "mock-multiplayer-album",
        mode: "album",
        albums,
        artists: [],
        colors: [],
        qaPrompts: [],
        topArtist: null,
        creatorChoices: choiceMap(albums, ["a", "a", "a", "a", "a", "a", "a", "a", "a"], "album"),
        creatorTopSongs: [],
        creatorProfile,
        creatorOpenId: "mock-creator",
        createdAt: Date.now() - 60 * 60 * 1000
      },
      items: albums
    };
  }
  if (safeMode === "top9") {
    return {
      challenge: {
        challengeId: "mock-multiplayer-top9",
        mode: "top9",
        artists: [],
        albums: [],
        colors: [],
        qaPrompts: [],
        topArtist: {
          id: "mock-top-artist",
          name: "演示歌手",
          avatarUrl: "",
          cover: ""
        },
        creatorChoices: {},
        creatorTopSongs: topSongs(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"]),
        creatorProfile,
        creatorOpenId: "mock-creator",
        createdAt: Date.now() - 60 * 60 * 1000
      },
      items: []
    };
  }
  const artists = subjects("mock-artist", [
    "陈奕迅", "孙燕姿", "王菲", "林宥嘉", "张悬",
    "五月天", "陶喆", "蔡健雅", "周杰伦"
  ]);
  return {
    challenge: {
      challengeId: "mock-multiplayer-artist",
      mode: "artist",
      artists,
      albums: [],
      colors: [],
      qaPrompts: [],
      topArtist: null,
      creatorChoices: choiceMap(artists, ["a", "a", "a", "a", "a", "a", "a", "a", "a"], "artist"),
      creatorTopSongs: [],
      creatorProfile,
      creatorOpenId: "mock-creator",
      createdAt: Date.now() - 60 * 60 * 1000
    },
    items: artists
  };
}

function friendAnswer(mode, friendIndex, seed) {
  const choicePatterns = [
    ["a", "a", "a", "a", "a", "a", "a", "a", "b"],
    ["a", "a", "a", "a", "a", "a", "c", "c", "c"],
    ["a", "a", "a", "d", "d", "d", "d", "d", "d"],
    ["b", "b", "b", "b", "a", "a", "a", "a", "a"],
    ["a", "b", "c", "a", "b", "c", "a", "b", "c"]
  ];
  const topPatterns = [
    ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "x1"],
    ["c1", "c2", "c3", "c4", "c5", "c6", "x2", "x3", "x4"],
    ["c1", "c2", "c3", "x5", "x6", "x7", "x8", "x9", "x10"],
    ["c5", "c6", "c7", "c8", "c9", "x11", "x12", "x13", "x14"],
    ["c1", "c4", "c7", "x15", "x16", "x17", "x18", "x19", "x20"]
  ];
  const friend = FRIENDS[friendIndex];
  if (mode === "top9") {
    const friendTopSongs = topSongs(topPatterns[friendIndex]);
    return {
      friend,
      friendChoices: {},
      friendTopSongs,
      result: compareTopSongs(seed.challenge.topArtist, seed.challenge.creatorTopSongs, friendTopSongs)
    };
  }
  const friendChoices = choiceMap(seed.items, choicePatterns[friendIndex], mode);
  return {
    friend,
    friendChoices,
    friendTopSongs: [],
    result: compareChoices(seed.items, seed.challenge.creatorChoices, friendChoices)
  };
}

function participantsFor(mode) {
  const safeMode = normalizeMode(mode);
  const seed = challengeSeed(safeMode);
  const creator = {
    participantId: "creator",
    role: "creator",
    profile: seed.challenge.creatorProfile,
    choices: seed.challenge.creatorChoices || {},
    topSongs: seed.challenge.creatorTopSongs || [],
    createdAt: seed.challenge.createdAt
  };
  const friends = FRIENDS.map((friend, index) => {
    const answer = friendAnswer(safeMode, index, seed);
    return {
      participantId: friend.participantId,
      resultId: friend.participantId,
      role: "friend",
      friendOpenId: friend.friendOpenId,
      profile: profile(friend.nickName),
      choices: answer.friendChoices,
      topSongs: answer.friendTopSongs,
      result: answer.result,
      createdAt: Date.now() - index * 8 * 60 * 1000
    };
  });
  return {
    mode: safeMode,
    challenge: seed.challenge,
    items: seed.items,
    participants: [creator].concat(friends)
  };
}

function compareParticipants(seed, left, right) {
  if (seed.mode === "top9") {
    return compareTopSongs(seed.challenge.topArtist, left.topSongs, right.topSongs);
  }
  return compareChoices(seed.items, left.choices, right.choices);
}

function pairSummary(seed, left, right) {
  const result = compareParticipants(seed, left, right);
  const leftName = left.profile.nickName || "TA";
  const rightName = right.profile.nickName || "TA";
  return {
    pairId: `${left.participantId}__${right.participantId}`,
    leftParticipantId: left.participantId,
    rightParticipantId: right.participantId,
    leftName,
    rightName,
    leftAvatarUrl: "",
    rightAvatarUrl: "",
    leftInitial: leftName.slice(0, 1),
    rightInitial: rightName.slice(0, 1),
    score: result.score,
    matchCount: result.matchCount,
    totalCount: result.totalCount,
    matchText: `${result.matchCount}/${result.totalCount} 契合`
  };
}

function sortPairs(pairs) {
  return pairs.sort((a, b) => (
    b.score - a.score ||
    b.matchCount - a.matchCount ||
    String(a.leftName).localeCompare(String(b.leftName), "zh-Hans-CN")
  ));
}

function getMockSummary(mode, viewerParticipantId) {
  const seed = participantsFor(mode);
  const pairs = [];
  for (let leftIndex = 0; leftIndex < seed.participants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < seed.participants.length; rightIndex += 1) {
      pairs.push(pairSummary(seed, seed.participants[leftIndex], seed.participants[rightIndex]));
    }
  }
  const rankedPairs = sortPairs(pairs);
  const viewer = seed.participants.find((item) => item.participantId === viewerParticipantId) || seed.participants[1];
  return {
    ok: true,
    supported: true,
    mode: seed.mode,
    participantCount: seed.participants.length - 1,
    viewerParticipantId: viewer.participantId,
    bestPair: rankedPairs[0] || null,
    pairLeaderboard: rankedPairs.slice(0, 6),
    creatorLeaderboard: sortPairs(seed.participants.slice(1).map((item) => pairSummary(seed, seed.participants[0], item))),
    viewerRanking: sortPairs(seed.participants
      .filter((item) => item.participantId !== viewer.participantId)
      .map((item) => pairSummary(seed, viewer, item)))
  };
}

function getMockPair(mode, leftParticipantId, rightParticipantId) {
  const seed = participantsFor(mode);
  const left = seed.participants.find((item) => item.participantId === leftParticipantId) || seed.participants[1];
  const right = seed.participants.find((item) => item.participantId === rightParticipantId) || seed.participants[0];
  const result = compareParticipants(seed, left, right);
  return {
    ok: true,
    supported: true,
    mode: seed.mode,
    pair: pairSummary(seed, left, right),
    challenge: {
      ...seed.challenge,
      creatorProfile: left.profile,
      creatorChoices: left.choices,
      creatorTopSongs: left.topSongs
    },
    friendProfile: right.profile,
    friendChoices: right.choices,
    friendTopSongs: right.topSongs,
    result
  };
}

function getMockRecord(mode) {
  const seed = participantsFor(mode);
  const results = seed.participants
    .filter((item) => item.role === "friend")
    .map((item) => ({
      resultId: item.participantId,
      challengeId: seed.challenge.challengeId,
      friendOpenId: item.friendOpenId,
      friendProfile: item.profile,
      friendChoices: item.choices,
      friendTopSongs: item.topSongs,
      result: item.result,
      score: item.result.score,
      matchCount: item.result.matchCount,
      totalCount: item.result.totalCount,
      createdAt: item.createdAt
    }));
  return {
    challengeId: seed.challenge.challengeId,
    mode: seed.mode,
    challenge: seed.challenge,
    creatorProfile: seed.challenge.creatorProfile,
    results
  };
}

function getMockCurrentResult(mode, viewerParticipantId) {
  const seed = participantsFor(mode);
  const viewer = seed.participants.find((item) => item.participantId === viewerParticipantId) || seed.participants[1];
  const pair = getMockPair(seed.mode, "creator", viewer.participantId);
  return {
    ...pair,
    viewerParticipantId: viewer.participantId
  };
}

module.exports = {
  getMockCurrentResult,
  getMockPair,
  getMockRecord,
  getMockSummary,
  normalizeMode
};
