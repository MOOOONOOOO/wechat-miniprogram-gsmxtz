const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function makeShareToken() {
  return crypto.randomBytes(16).toString("hex");
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID || "";
  const resultId = cleanText(event.resultId, 120);
  const channel = cleanText(event.channel || "timeline", 40);

  if (!resultId) return { ok: false, message: "缺少 resultId" };

  const resultRes = await db.collection("challengeResults").doc(resultId).get();
  const record = resultRes.data || {};
  const canPublish = openId && (record.friendOpenId === openId || record.creatorOpenId === openId);
  if (!canPublish) return { ok: false, message: "无权分享这个结果" };
  const sharedByRole = record.creatorOpenId === openId ? "creator" : "friend";

  const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return { ok: false, message: "结果已过期" };
  }

  const shareToken = record.shareToken || makeShareToken();
  await db.collection("challengeResults").doc(resultId).update({
    data: {
      visibility: "public",
      shareToken,
      shareChannel: channel,
      sharedByOpenId: openId,
      sharedByRole,
      sharedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });

  return {
    ok: true,
    resultId,
    shareToken
  };
};
