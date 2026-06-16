const { getChallenge } = require("./api");

function hydrateChallenge(challenge, options = {}) {
  if (!challenge || !challenge.challengeId) return null;
  const app = getApp();
  const mode = challenge.mode || "artist";

  app.globalData.challenge = challenge;
  app.globalData.draftMode = mode;
  app.globalData.draftTargetCount = challenge.targetCount || 9;
  app.globalData.draftArtists = mode === "album"
    ? []
    : (mode === "top9"
        ? [challenge.topArtist].filter(Boolean)
        : (mode === "color"
            ? (challenge.colors || [])
            : (mode === "qa" ? (challenge.qaPrompts || []) : (challenge.artists || []))));
  app.globalData.draftAlbums = challenge.albums || [];
  app.globalData.draftColors = challenge.colors || [];
  app.globalData.draftQaPrompts = challenge.qaPrompts || [];
  app.globalData.draftTopArtist = challenge.topArtist || null;
  app.globalData.creatorChoices = challenge.creatorChoices || {};
  app.globalData.creatorTopSongs = challenge.creatorTopSongs || [];
  app.globalData.creatorProfile = challenge.creatorProfile || {};
  app.globalData.qaSolo = challenge.qaSolo === true;

  if (options.resetFriendAnswers) {
    app.globalData.friendChoices = {};
    app.globalData.friendTopSongs = [];
    app.globalData.draftColorArtists = {};
    app.globalData.currentColorId = "";
    app.globalData.currentColorArtist = null;
    app.globalData.draftQaArtists = {};
    app.globalData.currentQaSlotId = "";
    app.globalData.currentQaSlotArtist = null;
  } else {
    app.globalData.friendChoices = app.globalData.friendChoices || {};
    app.globalData.friendTopSongs = app.globalData.friendTopSongs || [];
    app.globalData.draftColorArtists = app.globalData.draftColorArtists || {};
    app.globalData.draftQaArtists = app.globalData.draftQaArtists || {};
  }

  return challenge;
}

function needsChallenge(challengeId) {
  if (!challengeId) return false;
  const current = (getApp().globalData || {}).challenge || {};
  return current.challengeId !== challengeId;
}

function ensureChallenge(challengeId, options = {}) {
  const id = String(challengeId || "").trim();
  if (!id) return Promise.reject(new Error("缺少 challengeId"));
  if (!needsChallenge(id)) {
    return Promise.resolve((getApp().globalData || {}).challenge || {});
  }
  return getChallenge(id).then((res) => hydrateChallenge(res.challenge || {}, options));
}

module.exports = {
  ensureChallenge,
  hydrateChallenge,
  needsChallenge
};
