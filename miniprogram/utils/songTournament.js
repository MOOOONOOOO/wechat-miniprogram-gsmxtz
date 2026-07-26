const ACTIVE_KEY = "songTournament:active:v2";
const HISTORY_KEY = "songTournament:history:v2";
const HISTORY_LIMIT = 30;
const { getSongKey, getSongName } = require("./songIdentity");

function now() {
  return Date.now();
}

function makeId() {
  return `tournament-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slimSong(song = {}) {
  const cover = song.cover || song.coverUrl || song.artworkUrl600 || song.artworkUrl100 || "";
  return {
    trackId: String(song.trackId || "").trim(),
    name: getSongName(song),
    trackName: getSongName(song),
    artistId: String(song.artistId || "").trim(),
    artistName: song.artistName || "",
    collectionId: String(song.collectionId || "").trim(),
    collectionName: song.collectionName || song.album || "",
    album: song.album || song.collectionName || "",
    cover,
    coverUrl: cover,
    artworkUrl100: song.artworkUrl100 || "",
    artworkUrl600: song.artworkUrl600 || cover
  };
}

function slimArtist(artist = {}) {
  return {
    id: artist.id || artist.artistId || artist.name || "",
    artistId: String(artist.artistId || artist.itunesArtistId || "").trim(),
    itunesArtistId: String(artist.itunesArtistId || artist.artistId || "").trim(),
    name: artist.name || artist.artistName || "",
    artistName: artist.artistName || artist.name || "",
    searchTerm: artist.searchTerm || artist.name || artist.artistName || "",
    avatarUrl: artist.avatarUrl || artist.cover || "",
    cover: artist.cover || artist.avatarUrl || "",
    trustedArtistId: artist.trustedArtistId === true,
    resolvedArtistName: artist.resolvedArtistName || ""
  };
}

function uniqueSongs(songs) {
  const seen = {};
  return (songs || []).map(slimSong).filter((song) => {
    const key = getSongKey(song);
    if (!key || !song.name || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function shuffle(items, random = Math.random) {
  const next = (items || []).slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const picked = Math.floor(random() * (index + 1));
    const temp = next[index];
    next[index] = next[picked];
    next[picked] = temp;
  }
  return next;
}

function samplePool(sourceSongs, size, random = Math.random) {
  const count = Number(size || 0);
  if (count !== 16 && count !== 32) return [];
  const unique = uniqueSongs(sourceSongs);
  if (unique.length < count) return [];
  return shuffle(unique, random).slice(0, count);
}

function replacePoolSong(pool, index, song) {
  const next = uniqueSongs(pool);
  const replacement = slimSong(song);
  const replacementKey = getSongKey(replacement);
  const targetIndex = Number(index);
  if (!replacementKey || targetIndex < 0 || targetIndex >= next.length) return null;
  const duplicate = next.some((item, itemIndex) => itemIndex !== targetIndex && getSongKey(item) === replacementKey);
  if (duplicate) return null;
  next[targetIndex] = replacement;
  return next;
}

function makeSetupDraft({ artist, sourceSongs, size = 16, pool, id } = {}) {
  const songs = uniqueSongs(sourceSongs);
  const normalizedSize = Number(size) === 32 ? 32 : 16;
  const selectedPool = Array.isArray(pool) && pool.length === normalizedSize
    ? uniqueSongs(pool)
    : songs.slice(0, normalizedSize);
  return {
    version: 2,
    id: id || makeId(),
    status: "setup",
    artist: slimArtist(artist),
    size: normalizedSize,
    sourceSongs: songs,
    pool: selectedPool,
    poolStrategy: Array.isArray(pool) && pool.length === normalizedSize ? "custom" : "ranked",
    createdAt: now(),
    updatedAt: now()
  };
}

function createTournament(setup, random = Math.random) {
  const size = Number((setup || {}).size || 0);
  const pool = uniqueSongs((setup || {}).pool || []);
  if ((size !== 16 && size !== 32) || pool.length !== size) return null;
  return {
    version: 2,
    id: setup.id || makeId(),
    status: "playing",
    artist: slimArtist(setup.artist || {}),
    size,
    pool: shuffle(pool, random),
    decisions: [],
    createdAt: setup.createdAt || now(),
    startedAt: now(),
    updatedAt: now()
  };
}

function pairStageMeta(entrantCount) {
  if (entrantCount === 16) return { key: "round16", label: "16 进 8" };
  if (entrantCount === 8) return { key: "quarterfinal", label: "8 进 4" };
  if (entrantCount === 4) return { key: "semifinal", label: "4 进 2" };
  if (entrantCount === 2) return { key: "final", label: "最终决选" };
  return { key: `round${entrantCount}`, label: `${entrantCount} 进 ${entrantCount / 2}` };
}

function makeGroup(id, songs, decision) {
  const allowed = songs.map(getSongKey);
  const winnerKeys = decision && decision.type === "group4" && Array.isArray(decision.winners)
    ? decision.winners.map(String)
    : [];
  const uniqueKeys = [...new Set(winnerKeys)];
  const valid = !decision || (
    decision.type === "group4"
    && uniqueKeys.length === 2
    && uniqueKeys.every((key) => allowed.indexOf(key) >= 0)
  );
  const winners = valid && decision
    ? songs.filter((song) => uniqueKeys.indexOf(getSongKey(song)) >= 0)
    : [];
  return { id, songs, winners, valid, complete: winners.length === 2 };
}

function makeMatch(id, left, right, decision) {
  const leftKey = getSongKey(left);
  const rightKey = getSongKey(right);
  const choice = decision && decision.type === "match" ? String(decision.winner || "") : "";
  let winner = null;
  let loser = null;
  let valid = !decision || decision.type === "match";
  if (valid && choice) {
    if (choice === leftKey) {
      winner = left;
      loser = right;
    } else if (choice === rightKey) {
      winner = right;
      loser = left;
    } else {
      valid = false;
    }
  } else if (decision) {
    valid = false;
  }
  return { id, left, right, winner, loser, valid };
}

function deriveTournament(tournament = {}) {
  const size = Number(tournament.size || 0);
  const pool = uniqueSongs(tournament.pool || []);
  const decisions = Array.isArray(tournament.decisions) ? tournament.decisions : [];
  const totalDecisions = size / 4 + size / 2 - 1;
  const totalSelections = size - 1;
  if ((size !== 16 && size !== 32) || pool.length !== size || tournament.version !== 2) {
    return { valid: false, reason: "参赛名单损坏" };
  }

  let cursor = 0;
  const groups = [];
  const firstWinners = [];
  let currentGroup = null;
  let currentGroupIndex = -1;
  for (let groupIndex = 0; groupIndex < size / 4; groupIndex += 1) {
    const songs = pool.slice(groupIndex * 4, groupIndex * 4 + 4);
    const decision = currentGroup ? null : decisions[cursor];
    const group = makeGroup(`group-${groupIndex}`, songs, decision);
    if (!group.valid) return { valid: false, reason: "4 选 2记录损坏" };
    groups.push(group);
    if (!group.complete) {
      if (!currentGroup) {
        currentGroup = group;
        currentGroupIndex = groupIndex;
      }
      continue;
    }
    firstWinners.push(...group.winners);
    cursor += 1;
  }

  const firstRound = {
    key: "group4",
    label: `${size} 进 ${size / 2} · 4 选 2`,
    entrantCount: size,
    groups
  };
  if (currentGroup) {
    if (cursor !== decisions.length) return { valid: false, reason: "存在多余选择记录" };
    return {
      valid: true,
      complete: false,
      phase: "group4",
      rounds: [firstRound],
      currentRound: firstRound,
      currentGroup,
      currentGroupIndex,
      decisionCount: cursor,
      selectionCount: cursor * 2,
      totalDecisions,
      totalSelections
    };
  }

  const rounds = [firstRound];
  let contestants = firstWinners;
  let pairRoundIndex = 0;
  while (contestants.length > 1) {
    const meta = pairStageMeta(contestants.length);
    const matches = [];
    const winners = [];
    let currentMatch = null;
    let currentMatchIndex = -1;
    for (let matchIndex = 0; matchIndex < contestants.length / 2; matchIndex += 1) {
      const decision = currentMatch ? null : decisions[cursor];
      const match = makeMatch(
        `pair-${pairRoundIndex}-match-${matchIndex}`,
        contestants[matchIndex * 2],
        contestants[matchIndex * 2 + 1],
        decision
      );
      if (!match.valid) return { valid: false, reason: "两两选择记录损坏" };
      matches.push(match);
      if (!match.winner) {
        if (!currentMatch) {
          currentMatch = match;
          currentMatchIndex = matchIndex;
        }
        continue;
      }
      winners.push(match.winner);
      cursor += 1;
    }
    const round = { ...meta, entrantCount: contestants.length, matches };
    rounds.push(round);
    if (currentMatch) {
      if (cursor !== decisions.length) return { valid: false, reason: "存在多余选择记录" };
      return {
        valid: true,
        complete: false,
        phase: "pair",
        rounds,
        currentRound: round,
        currentMatch,
        currentMatchIndex,
        decisionCount: cursor,
        selectionCount: size / 2 + (cursor - size / 4),
        totalDecisions,
        totalSelections
      };
    }
    contestants = winners;
    pairRoundIndex += 1;
  }

  if (cursor !== decisions.length) return { valid: false, reason: "存在多余选择记录" };
  return {
    valid: true,
    complete: true,
    phase: "complete",
    rounds,
    champion: contestants[0],
    decisionCount: cursor,
    selectionCount: totalSelections,
    totalDecisions,
    totalSelections
  };
}

function selectGroupWinners(tournament, songs) {
  const derived = deriveTournament(tournament);
  if (!derived.valid || derived.complete || derived.phase !== "group4") return null;
  const winnerKeys = [...new Set((songs || []).map((song) => typeof song === "string" ? song : getSongKey(song)))];
  const allowed = derived.currentGroup.songs.map(getSongKey);
  if (winnerKeys.length !== 2 || !winnerKeys.every((key) => allowed.indexOf(key) >= 0)) return null;
  return {
    ...tournament,
    status: "playing",
    decisions: [...(tournament.decisions || []), { type: "group4", winners: winnerKeys }],
    updatedAt: now()
  };
}

function selectWinner(tournament, song) {
  const derived = deriveTournament(tournament);
  if (!derived.valid || derived.complete || derived.phase !== "pair" || !derived.currentMatch) return null;
  const songKey = typeof song === "string" ? song : getSongKey(song);
  const allowed = [getSongKey(derived.currentMatch.left), getSongKey(derived.currentMatch.right)];
  if (!songKey || allowed.indexOf(songKey) < 0) return null;
  return {
    ...tournament,
    status: "playing",
    decisions: [...(tournament.decisions || []), { type: "match", winner: songKey }],
    updatedAt: now()
  };
}

function undoLastChoice(tournament) {
  const decisions = Array.isArray((tournament || {}).decisions) ? tournament.decisions : [];
  if (!decisions.length || tournament.status === "complete") return null;
  return {
    ...tournament,
    decisions: decisions.slice(0, -1),
    updatedAt: now()
  };
}

function buildTournamentColumns(tournament, derived = deriveTournament(tournament)) {
  if (!derived || !derived.valid) return [];
  const size = Number(tournament.size || 0);
  const columns = [{
    key: "entries",
    label: `${size} 首歌曲`,
    colorClass: "column-blue",
    cells: (tournament.pool || []).map((song) => ({ song, span: 1 }))
  }];
  const firstRound = derived.rounds[0];
  const firstCells = [];
  (firstRound.groups || []).forEach((group) => {
    const winners = group.winners || [];
    firstCells.push({ song: winners[0] || null, span: 2 });
    firstCells.push({ song: winners[1] || null, span: 2 });
  });
  columns.push({
    key: "group4",
    label: `${size} 进 ${size / 2} · 4 选 2`,
    colorClass: "column-lilac",
    cells: firstCells
  });
  const palette = ["column-pink", "column-yellow", "column-green", "column-cyan", "column-rose"];
  (derived.rounds || []).slice(1).forEach((round, index) => {
    columns.push({
      key: round.key,
      label: round.label,
      colorClass: palette[index % palette.length],
      cells: (round.matches || []).map((match) => ({
        song: match.winner || null,
        span: size / (round.matches || []).length
      }))
    });
  });
  return columns;
}

function readStorage(key, fallback) {
  try {
    return wx.getStorageSync(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function getActiveTournament() {
  const active = readStorage(ACTIVE_KEY, null);
  if (!active || !active.id || active.version !== 2 || ["setup", "playing"].indexOf(active.status) < 0) return null;
  return active;
}

function saveActiveTournament(tournament) {
  if (!tournament || !tournament.id) return false;
  return writeStorage(ACTIVE_KEY, { ...tournament, updatedAt: now() });
}

function clearActiveTournament() {
  try {
    wx.removeStorageSync(ACTIVE_KEY);
  } catch (error) {}
}

function listTournamentHistory() {
  const history = readStorage(HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function saveCompletedTournament(tournament) {
  const derived = deriveTournament(tournament);
  if (!derived.valid || !derived.complete) return null;
  const record = {
    ...tournament,
    status: "complete",
    completedAt: now(),
    result: { champion: derived.champion }
  };
  const history = listTournamentHistory().filter((item) => item.id !== record.id);
  history.unshift(record);
  if (!writeStorage(HISTORY_KEY, history.slice(0, HISTORY_LIMIT))) return null;
  clearActiveTournament();
  return record;
}

function getTournamentRecord(id) {
  return listTournamentHistory().find((item) => item.id === id) || null;
}

function deleteTournamentRecord(id) {
  const history = listTournamentHistory().filter((item) => item.id !== id);
  return writeStorage(HISTORY_KEY, history);
}

module.exports = {
  ACTIVE_KEY,
  HISTORY_KEY,
  buildTournamentColumns,
  clearActiveTournament,
  createTournament,
  deleteTournamentRecord,
  deriveTournament,
  getActiveTournament,
  getSongKey,
  getSongName,
  getTournamentRecord,
  listTournamentHistory,
  makeSetupDraft,
  replacePoolSong,
  samplePool,
  saveActiveTournament,
  saveCompletedTournament,
  selectGroupWinners,
  selectWinner,
  slimArtist,
  slimSong,
  undoLastChoice,
  uniqueSongs
};
