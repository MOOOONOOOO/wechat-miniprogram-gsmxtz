const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

async function resolveProfileAvatar(profile = {}) {
  const avatarUrl = profile.avatarUrl || "";
  if (!isCloudFileUrl(avatarUrl)) return profile;

  try {
    const urls = await cloud.getTempFileURL({
      fileList: [avatarUrl]
    });
    const tempFileURL = ((urls.fileList || [])[0] || {}).tempFileURL || "";
    return {
      ...profile,
      avatarUrl: tempFileURL || avatarUrl
    };
  } catch (error) {
    return profile;
  }
}

exports.main = async (event) => {
  const challengeId = event.challengeId;
  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  const res = await db.collection("challenges").doc(challengeId).get();
  const creatorProfile = await resolveProfileAvatar(res.data.creatorProfile || {});
  return {
    ok: true,
    challenge: {
      challengeId,
      mode: res.data.mode || "artist",
      targetCount: res.data.targetCount || 9,
      artists: res.data.artists,
      albums: res.data.albums || [],
      colors: res.data.colors || [],
      qaPrompts: res.data.qaPrompts || [],
      qaSolo: res.data.qaSolo === true,
      topArtist: res.data.topArtist || null,
      creatorChoices: res.data.creatorChoices,
      creatorTopSongs: res.data.creatorTopSongs || [],
      creatorProfile,
      creatorOpenId: res.data.creatorOpenId
    }
  };
};
