const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX_PARTICIPANTS = 99;

function normalizeProfile(profile = {}) {
  const nickName = String(profile.nickName || "").trim();
  return {
    nickName,
    avatarUrl: profile.avatarUrl || "",
    initial: (nickName || "友").slice(0, 1)
  };
}

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

function isUnexpired(item, now) {
  const expiresAt = normalizeTime(item && item.expiresAt);
  return !expiresAt || expiresAt > now.getTime();
}

exports.main = async (event = {}) => {
  const challengeId = String((event || {}).challengeId || "").trim();
  const now = new Date();

  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  const where = {
    challengeId,
    expiresAt: _.gt(now)
  };

  const countRes = await db.collection("challengeResults").where(where).count()
    .catch(() => ({ total: 0 }));
  const res = await db.collection("challengeResults")
    .where(where)
    .orderBy("createdAt", "desc")
    .limit(MAX_PARTICIPANTS)
    .get();

  const participants = (res.data || [])
    .filter((item) => isUnexpired(item, now))
    .map((item) => ({
      resultId: item.resultId || item._id || "",
      friendOpenId: item.friendOpenId || "",
      profile: normalizeProfile(item.friendProfile || {}),
      createdAt: normalizeTime(item.createdAt)
    }));

  return {
    ok: true,
    total: Number(countRes.total || participants.length) || participants.length,
    participants
  };
};
