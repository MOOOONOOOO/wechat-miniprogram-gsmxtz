const { getCreatorInbox } = require("./api");
const {
  getCreatedChallengeIdsMissingFriendAvatars,
  getCreatedChallengeIds,
  saveReceivedResult
} = require("./history");

let syncing = false;
let lastSyncAt = 0;
let syncPromise = null;
const SYNC_CURSOR_KEY = "creatorInboxSyncCursor:v5";
const SYNC_OVERLAP_MS = 30 * 60 * 1000;

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

function readSyncCursor() {
  try {
    return Number(wx.getStorageSync(SYNC_CURSOR_KEY) || 0);
  } catch (error) {
    return 0;
  }
}

function writeSyncCursor(cursor) {
  try {
    wx.setStorageSync(SYNC_CURSOR_KEY, Number(cursor) || Date.now());
    return true;
  } catch (error) {
    console.warn("save inbox sync cursor failed", error);
    return false;
  }
}

function saveInboxEntries(entries) {
  let savedCount = 0;
  let failedCount = 0;
  (entries || []).forEach((entry) => {
    const saved = saveReceivedResult({
      resultId: entry.resultId,
      shareToken: entry.shareToken,
      inboxId: entry.inboxId,
      challenge: entry.challenge,
      challengeId: entry.challengeId,
      friendOpenId: entry.friendOpenId,
      friendProfile: entry.friendProfile,
      friendChoices: entry.friendChoices,
      friendTopSongs: entry.friendTopSongs,
      result: entry.result,
      createdAt: entry.createdAt,
      receivedAt: Date.now()
    });
    if (saved) savedCount += 1;
    else failedCount += 1;
  });
  return { savedCount, failedCount };
}

function syncCreatorInbox(options = {}) {
  const minInterval = Number(options.minInterval || 0);
  const now = Date.now();
  const challengeId = String(options.challengeId || "").trim();
  const challengeOnly = Boolean(challengeId || options.challengeOnly);
  if (syncing) return syncPromise || Promise.resolve({ synced: false, reason: "syncing" });
  if (minInterval && now - lastSyncAt < minInterval) {
    return Promise.resolve({ synced: false, reason: "throttled" });
  }

  syncing = true;
  const cursor = readSyncCursor();
  const since = cursor > SYNC_OVERLAP_MS ? cursor - SYNC_OVERLAP_MS : 0;
  syncPromise = getCreatorInbox({
    challengeIds: challengeId ? [challengeId] : getCreatedChallengeIds(),
    since: challengeOnly ? 0 : since,
    challengeOnly
  })
    .then((res) => {
      lastSyncAt = Date.now();
      const entries = res.entries || [];
      const saveResult = saveInboxEntries(entries);
      const missingAvatarChallengeIds = challengeOnly ? [] : getCreatedChallengeIdsMissingFriendAvatars();
      const repairPromise = missingAvatarChallengeIds.length
        ? getCreatorInbox({
            challengeIds: missingAvatarChallengeIds,
            challengeOnly: true
          }).then((repairRes) => ({
            res: repairRes,
            saveResult: saveInboxEntries(repairRes.entries || [])
          }))
        : Promise.resolve({
            res: { warnings: [] },
            saveResult: { savedCount: 0, failedCount: 0 }
          });

      return repairPromise.then((repair) => {
        const warnings = [
          ...(res.warnings || []),
          ...((repair.res || {}).warnings || []),
          ...(saveResult.failedCount ? [`local: ${saveResult.failedCount} 条结果未能保存到本机`] : []),
          ...(repair.saveResult.failedCount ? [`avatarRepair: ${repair.saveResult.failedCount} 条结果未能保存到本机`] : [])
        ];
        if (!challengeOnly && !warnings.length && res.cursor) {
          writeSyncCursor(res.cursor);
        } else if (!challengeOnly && !warnings.length && entries.length) {
          const entryCursor = entries.reduce((max, entry) => Math.max(max, normalizeTime(entry.createdAt)), cursor);
          if (entryCursor > cursor) writeSyncCursor(entryCursor);
        }
        return {
          synced: true,
          count: saveResult.savedCount + repair.saveResult.savedCount,
          warnings
        };
      });
    })
    .catch((error) => {
      if (options.throwOnError) throw error;
      return {
        synced: false,
        error
      };
    })
    .finally(() => {
      syncing = false;
      syncPromise = null;
    });
  return syncPromise;
}

module.exports = {
  syncCreatorInbox
};
