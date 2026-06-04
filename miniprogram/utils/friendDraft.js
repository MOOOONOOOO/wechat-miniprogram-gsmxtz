function draftKey(challengeId) {
  return challengeId ? `friendAnswerDraft:${challengeId}` : "";
}

function readFriendDraft(challengeId) {
  const key = draftKey(challengeId);
  if (!key) return {};
  try {
    return wx.getStorageSync(key) || {};
  } catch (error) {
    return {};
  }
}

function saveFriendDraft(challengeId, patch = {}) {
  const key = draftKey(challengeId);
  if (!key) return;
  try {
    wx.setStorageSync(key, {
      ...readFriendDraft(challengeId),
      ...patch,
      challengeId,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.warn("save friend draft failed", error);
  }
}

function resetFriendDraft(challengeId, profile = {}) {
  const key = draftKey(challengeId);
  if (!key) return;
  try {
    wx.setStorageSync(key, {
      challengeId,
      friendChoices: {},
      friendTopSongs: [],
      friendProfile: profile || {},
      updatedAt: Date.now()
    });
  } catch (error) {
    console.warn("reset friend draft failed", error);
  }
}

module.exports = {
  readFriendDraft,
  resetFriendDraft,
  saveFriendDraft
};
