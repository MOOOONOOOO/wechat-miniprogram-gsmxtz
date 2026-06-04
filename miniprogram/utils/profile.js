const ACCOUNT_PROFILE_KEY = "accountProfile";
const CREATOR_PROFILE_KEY = "creatorProfile";
const FRIEND_PROFILE_KEY = "friendProfile";

function emptyProfile() {
  return {
    nickName: "",
    avatarUrl: ""
  };
}

function normalizeProfile(profile) {
  const safeProfile = profile || {};
  return {
    nickName: String(safeProfile.nickName || "").trim(),
    avatarUrl: safeProfile.avatarUrl || ""
  };
}

function isCompleteProfile(profile) {
  const safeProfile = normalizeProfile(profile);
  return Boolean(safeProfile.avatarUrl && safeProfile.nickName);
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
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

function avatarStatus(profile = {}) {
  const avatarUrl = (profile || {}).avatarUrl || "";
  if (!avatarUrl) return "empty";
  if (isCloudFileUrl(avatarUrl)) return "cloud";
  if (isTemporaryAvatarUrl(avatarUrl)) return "temporary";
  return "remote";
}

function isStableAvatarUrl(url) {
  const status = avatarStatus({ avatarUrl: url });
  return status === "cloud" || status === "remote";
}

function readCachedProfile() {
  let candidates = [];
  try {
    candidates = [
      wx.getStorageSync(ACCOUNT_PROFILE_KEY),
      wx.getStorageSync(CREATOR_PROFILE_KEY),
      wx.getStorageSync(FRIEND_PROFILE_KEY)
    ].map(normalizeProfile);
  } catch (error) {
    candidates = [];
  }

  return candidates.find(isCompleteProfile) || candidates.find((profile) => profile.avatarUrl || profile.nickName) || emptyProfile();
}

function cacheAccountProfile(profile) {
  const savedProfile = normalizeProfile(profile);
  try {
    wx.setStorageSync(ACCOUNT_PROFILE_KEY, savedProfile);
    wx.setStorageSync(CREATOR_PROFILE_KEY, savedProfile);
    wx.setStorageSync(FRIEND_PROFILE_KEY, savedProfile);
  } catch (error) {
    console.warn("cache account profile failed", error);
  }

  const app = getApp();
  if (app && app.globalData) {
    app.globalData.creatorProfile = savedProfile;
    app.globalData.friendProfile = savedProfile;
  }

  return savedProfile;
}

function fileExtensionFromPath(filePath) {
  const cleanPath = String(filePath || "").split("?")[0];
  const suffix = cleanPath.match(/\.(jpg|jpeg|png|webp)$/i);
  return suffix ? suffix[0].toLowerCase() : ".png";
}

function downloadAvatar(filePath) {
  if (!isHttpUrl(filePath) || !wx.downloadFile) return Promise.resolve(filePath);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: filePath,
      success: (res) => {
        if ((res.statusCode || 200) >= 400 || !res.tempFilePath) {
          reject(new Error(`download avatar failed: ${res.statusCode || 0}`));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail: reject
    });
  });
}

function uploadAvatar(filePath) {
  if (!filePath || isCloudFileUrl(filePath) || !wx.cloud) {
    return Promise.resolve(filePath || "");
  }

  const ext = fileExtensionFromPath(filePath);
  const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  const upload = (uploadPath) => wx.cloud.uploadFile({
    cloudPath,
    filePath: uploadPath
  }).then((res) => res.fileID || "");

  const uploadWithRetry = (uploadPath) => upload(uploadPath).catch(() => upload(uploadPath));

  return uploadWithRetry(filePath)
    .catch(() => downloadAvatar(filePath).then(uploadWithRetry))
    .catch(() => (isTemporaryAvatarUrl(filePath) ? "" : filePath));
}

function callUserProfile(action, profile) {
  if (!wx.cloud) return Promise.reject(new Error("请在微信云开发环境中运行"));
  return wx.cloud.callFunction({
    name: "userProfile",
    data: {
      action,
      profile
    }
  }).then((res) => {
    const result = res.result || {};
    if (result.ok === false) {
      return Promise.reject(new Error(result.message || "用户资料同步失败"));
    }
    return result;
  });
}

function getAccountProfile() {
  const cachedProfile = readCachedProfile();
  return callUserProfile("get")
    .then((res) => {
      const cloudProfile = normalizeProfile(res.profile);
      if (isCompleteProfile(cloudProfile)) {
        return cacheAccountProfile(cloudProfile);
      }
      return isCompleteProfile(cachedProfile) ? cachedProfile : (cloudProfile.avatarUrl || cloudProfile.nickName ? cloudProfile : cachedProfile);
    })
    .catch(() => cachedProfile);
}

function saveAccountProfile(profile) {
  const safeProfile = normalizeProfile(profile);
  const cachedProfile = readCachedProfile();
  return uploadAvatar(safeProfile.avatarUrl)
    .then((avatarUrl) => {
      const fallbackAvatar = isStableAvatarUrl(cachedProfile.avatarUrl) ? cachedProfile.avatarUrl : "";
      const savedProfile = cacheAccountProfile({
        ...safeProfile,
        avatarUrl: avatarUrl || (isTemporaryAvatarUrl(safeProfile.avatarUrl) ? fallbackAvatar : safeProfile.avatarUrl)
      });
      return callUserProfile("save", savedProfile)
        .then((res) => cacheAccountProfile(res.profile || savedProfile))
        .catch(() => savedProfile);
    });
}

function ensureStableAccountProfile(profile) {
  const before = normalizeProfile(profile);
  return saveAccountProfile(before)
    .then((savedProfile) => {
      const after = normalizeProfile(savedProfile);
      return {
        profile: after,
        avatarStatus: {
          before: avatarStatus(before),
          after: avatarStatus(after),
          stable: avatarStatus(after) === "cloud" || avatarStatus(after) === "remote",
          uploaded: avatarStatus(before) === "temporary" && avatarStatus(after) === "cloud",
          hadInputAvatar: Boolean(before.avatarUrl)
        }
      };
    })
    .catch((error) => ({
      profile: {
        ...before,
        avatarUrl: isTemporaryAvatarUrl(before.avatarUrl) ? "" : before.avatarUrl
      },
      avatarStatus: {
        before: avatarStatus(before),
        after: isTemporaryAvatarUrl(before.avatarUrl) ? "empty" : avatarStatus(before),
        stable: !isTemporaryAvatarUrl(before.avatarUrl) && Boolean(before.avatarUrl),
        uploaded: false,
        hadInputAvatar: Boolean(before.avatarUrl),
        error: (error && error.message) || "avatar save failed"
      }
    }));
}

function resolveCloudFileUrl(fileID) {
  if (!isCloudFileUrl(fileID) || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(fileID || "");
  }

  return wx.cloud.getTempFileURL({
    fileList: [fileID]
  }).then((res) => {
    const item = (res.fileList || [])[0] || {};
    return item.tempFileURL || fileID;
  }).catch(() => fileID);
}

module.exports = {
  emptyProfile,
  normalizeProfile,
  isCompleteProfile,
  readCachedProfile,
  cacheAccountProfile,
  getAccountProfile,
  saveAccountProfile,
  ensureStableAccountProfile,
  uploadAvatar,
  isCloudFileUrl,
  isTemporaryAvatarUrl,
  avatarStatus,
  resolveCloudFileUrl
};
