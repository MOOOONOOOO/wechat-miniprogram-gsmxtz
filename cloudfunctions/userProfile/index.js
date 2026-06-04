const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizeProfile(profile = {}) {
  return {
    nickName: String(profile.nickName || "").trim(),
    avatarUrl: profile.avatarUrl || ""
  };
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function isLocalDevUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(String(url || ""));
}

function isTemporaryAvatarUrl(url) {
  const value = String(url || "");
  return value.indexOf("wxfile://") === 0
    || value.indexOf("http://tmp/") === 0
    || value.indexOf("https://tmp/") === 0
    || isLocalDevUrl(value)
    || value.indexOf("tmp/") === 0
    || value.indexOf("/tmp/") >= 0;
}

function pickProfileAvatar(incomingAvatar, savedAvatar) {
  if (isCloudFileUrl(incomingAvatar)) return incomingAvatar;
  if (isCloudFileUrl(savedAvatar)) return savedAvatar;
  if (incomingAvatar && !isTemporaryAvatarUrl(incomingAvatar)) return incomingAvatar;
  if (savedAvatar && !isTemporaryAvatarUrl(savedAvatar)) return savedAvatar;
  return "";
}

function mergeProfile(incomingProfile, savedProfile) {
  const incoming = normalizeProfile(incomingProfile);
  const saved = normalizeProfile(savedProfile);
  return {
    nickName: incoming.nickName || saved.nickName || "",
    avatarUrl: pickProfileAvatar(incoming.avatarUrl, saved.avatarUrl)
  };
}

async function readProfile(openId) {
  try {
    const res = await db.collection("userProfiles").doc(openId).get();
    return normalizeProfile(res.data.profile || res.data || {});
  } catch (error) {
    return normalizeProfile();
  }
}

async function saveProfile(openId, profile) {
  const savedProfile = mergeProfile(profile, await readProfile(openId));
  await db.collection("userProfiles").doc(openId).set({
    data: {
      openId,
      profile: savedProfile,
      updatedAt: db.serverDate()
    }
  }).catch((error) => {
    console.warn("save user profile failed", error);
  });
  return savedProfile;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const action = event.action === "save" ? "save" : "get";

  if (!openId) return { ok: false, message: "缺少 openid" };

  if (action === "save") {
    return {
      ok: true,
      profile: await saveProfile(openId, event.profile || {})
    };
  }

  return {
    ok: true,
    profile: await readProfile(openId)
  };
};
