const { getSongKey, getSongName } = require("./songIdentity");

const POSTER_WIDTH = 750;
const POSTER_HEIGHT = 1180;
const ROUTE_TOP = 226;
const ROUTE_BOTTOM = 928;
const CENTER_X = POSTER_WIDTH / 2;
const CENTER_Y = 570;
const CENTER_SIZE = 147;

function getCoverSource(song, size = 300) {
  const url = (song && (
    song.cover
    || song.coverUrl
    || song.artworkUrl600
    || song.artworkUrl100
    || song.artworkUrl60
  )) || "";
  return String(url).replace(/\d+x\d+bb/i, `${size}x${size}bb`);
}

function getAlbumName(song) {
  return (song && (song.album || song.collectionName)) || "未知专辑";
}

function getFallbackText(song) {
  return getSongName(song).slice(0, 1) || "音";
}

function buildTournamentStages(record, derived) {
  const rounds = (derived && derived.rounds) || [];
  const firstRound = rounds[0] || {};
  const stages = [(record && record.pool) || []];
  const firstWinners = (firstRound.groups || []).reduce(
    (songs, group) => songs.concat(group.winners || []),
    []
  );
  if (firstWinners.length) stages.push(firstWinners);
  rounds.slice(1).forEach((round) => {
    const winners = (round.matches || []).map((match) => match.winner).filter(Boolean);
    if (winners.length) stages.push(winners);
  });
  return stages;
}

function evenlySpacedY(count) {
  const span = ROUTE_BOTTOM - ROUTE_TOP;
  return Array.from({ length: count }, (_, index) => (
    ROUTE_TOP + span * (index + 0.5) / count
  ));
}

function stageNodeDimensions(stageIndex, stageCount, tournamentSize) {
  const outerWidth = tournamentSize === 32 ? 100 : 108;
  const outerHeight = tournamentSize === 32 ? 18 : 26;
  const innerHeight = tournamentSize === 32 ? 30 : 36;
  const ratio = stageCount <= 1 ? 1 : stageIndex / (stageCount - 1);
  const width = Math.round(outerWidth + (126 - outerWidth) * ratio);
  const height = Math.round(outerHeight + (innerHeight - outerHeight) * ratio);
  const fontSize = stageIndex <= 1 ? 10 : Math.round(9 + 2 * ratio);
  return {
    width,
    height,
    thumbSize: Math.max(14, height - 6),
    fontSize
  };
}

function stageX(stageIndex, stageCount) {
  const outerX = stageCount === 5 ? 64 : 70;
  const innerX = 217;
  if (stageCount <= 1) return innerX;
  return outerX + (innerX - outerX) * stageIndex / (stageCount - 1);
}

function roundNumber(value) {
  return Math.round(value * 10) / 10;
}

function makeLine(from, to, highlighted, key) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const width = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return {
    key,
    x1: roundNumber(from.x),
    y1: roundNumber(from.y),
    x2: roundNumber(to.x),
    y2: roundNumber(to.y),
    highlighted,
    className: highlighted ? "winner-edge" : "",
    style: [
      `left:${roundNumber(from.x)}rpx`,
      `top:${roundNumber(from.y)}rpx`,
      `width:${roundNumber(width)}rpx`,
      `transform:rotate(${roundNumber(angle)}deg)`
    ].join(";")
  };
}

function makeOrthogonalLines(from, to, highlighted, key) {
  const middleX = roundNumber((from.x + to.x) / 2);
  const points = [
    { x: from.x, y: from.y },
    { x: middleX, y: from.y },
    { x: middleX, y: to.y },
    { x: to.x, y: to.y }
  ];
  return points.slice(0, -1).reduce((segments, point, index) => {
    const target = points[index + 1];
    if (point.x === target.x && point.y === target.y) return segments;
    segments.push(makeLine(point, target, highlighted, `${key}-segment-${index}`));
    return segments;
  }, []);
}

function makeNode(song, side, stageIndex, itemIndex, x, y, dimensions, championKey) {
  const key = getSongKey(song);
  const highlighted = Boolean(championKey && key === championKey);
  const { width, height, thumbSize, fontSize } = dimensions;
  return {
    id: `${side}-${stageIndex}-${itemIndex}`,
    songKey: key,
    song,
    name: getSongName(song),
    cover: getCoverSource(song),
    fallbackText: getFallbackText(song),
    x: roundNumber(x),
    y: roundNumber(y),
    size: thumbSize,
    width,
    height,
    thumbSize,
    fontSize,
    highlighted,
    className: highlighted ? "winner-node" : "",
    style: [
      `left:${roundNumber(x - width / 2)}rpx`,
      `top:${roundNumber(y - height / 2)}rpx`,
      `width:${width}rpx`,
      `height:${height}rpx`,
      `font-size:${fontSize}rpx`
    ].join(";"),
    thumbStyle: `width:${thumbSize}rpx;height:${thumbSize}rpx`
  };
}

function buildSide(side, stageSongs, tournamentSize, champion, championKey) {
  const mirrored = side === "right";
  const stageCount = stageSongs.length;
  const stages = stageSongs.map((songs, stageIndex) => {
    const xBase = stageX(stageIndex, stageCount);
    const x = mirrored ? POSTER_WIDTH - xBase : xBase;
    const dimensions = stageNodeDimensions(stageIndex, stageCount, tournamentSize);
    const positions = evenlySpacedY(songs.length);
    return songs.map((song, itemIndex) => makeNode(
      song,
      side,
      stageIndex,
      itemIndex,
      x,
      positions[itemIndex],
      dimensions,
      championKey
    ));
  });
  const edges = [];
  stages.slice(0, -1).forEach((nodes, stageIndex) => {
    const nextNodes = stages[stageIndex + 1] || [];
    nodes.forEach((node, itemIndex) => {
      const target = nextNodes[Math.floor(itemIndex / 2)];
      if (!target) return;
      edges.push(...makeOrthogonalLines(
        node,
        target,
        node.songKey === championKey && target.songKey === championKey,
        `${side}-edge-${stageIndex}-${itemIndex}`
      ));
    });
  });
  const finalist = (stages[stages.length - 1] || [])[0];
  if (finalist) {
    edges.push(makeLine(
      finalist,
      { x: CENTER_X, y: finalist.y },
      finalist.songKey === championKey,
      `${side}-edge-champion`
    ));
  }
  return {
    nodes: stages.reduce((items, stage) => items.concat(stage), []),
    edges,
    finalist
  };
}

function buildPosterGraph(record, derived) {
  const allStages = buildTournamentStages(record, derived);
  const champion = derived && derived.champion;
  const championKey = getSongKey(champion);
  const routeStages = allStages.slice(0, -1);
  const leftStages = routeStages.map((songs) => songs.slice(0, songs.length / 2));
  const rightStages = routeStages.map((songs) => songs.slice(songs.length / 2));
  const left = buildSide("left", leftStages, Number(record.size), champion, championKey);
  const right = buildSide("right", rightStages, Number(record.size), champion, championKey);
  const nodes = left.nodes.concat(right.nodes);
  const edges = left.edges.concat(right.edges);
  const finalSongs = [left.finalist, right.finalist].filter(Boolean).map((node) => ({
    ...node,
    label: "决赛"
  }));
  return {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    nodes,
    edges,
    finalSongs,
    champion: {
      song: champion,
      songKey: championKey,
      name: getSongName(champion),
      album: getAlbumName(champion),
      cover: getCoverSource(champion),
      fallbackText: getFallbackText(champion),
      x: CENTER_X,
      y: CENTER_Y,
      size: CENTER_SIZE
    }
  };
}

module.exports = {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  buildPosterGraph,
  buildTournamentStages,
  getAlbumName,
  getCoverSource,
  getFallbackText
};
