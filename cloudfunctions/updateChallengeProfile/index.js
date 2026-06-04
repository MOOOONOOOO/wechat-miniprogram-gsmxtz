const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const challengeId = event.challengeId;
  const creatorProfile = event.creatorProfile || {};

  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  const challenge = await db.collection("challenges").doc(challengeId).get();
  if (challenge.data.creatorOpenId !== wxContext.OPENID) {
    return { ok: false, message: "只能更新自己创建的挑战" };
  }

  await db.collection("challenges").doc(challengeId).update({
    data: {
      creatorProfile: {
        nickName: creatorProfile.nickName || "",
        avatarUrl: creatorProfile.avatarUrl || ""
      }
    }
  });

  await db.collection("userProfiles").doc(wxContext.OPENID).set({
    data: {
      openId: wxContext.OPENID,
      profile: {
        nickName: creatorProfile.nickName || "",
        avatarUrl: creatorProfile.avatarUrl || ""
      },
      updatedAt: db.serverDate()
    }
  }).catch((error) => {
    console.warn("save user profile failed", error);
  });

  return { ok: true };
};
