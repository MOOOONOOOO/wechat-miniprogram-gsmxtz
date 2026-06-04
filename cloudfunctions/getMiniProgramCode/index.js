const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function toTempFileURL(fileID) {
  const urls = await cloud.getTempFileURL({
    fileList: [fileID]
  });
  return (urls.fileList[0] || {}).tempFileURL || "";
}

async function createAndUploadCode({ scene, page, cloudPath }) {
  const code = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page,
    checkPath: false,
    width: 430
  });

  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: code.buffer
  });

  return upload.fileID;
}

async function getHomeMiniProgramCode() {
  const cacheId = "__home_mini_program_code__";
  try {
    const cached = await db.collection("challenges").doc(cacheId).get();
    if (cached.data && cached.data.qrCodeFileID) {
      return {
        ok: true,
        fileID: cached.data.qrCodeFileID,
        tempFileURL: await toTempFileURL(cached.data.qrCodeFileID),
        cached: true
      };
    }
  } catch (error) {
    // The cache doc may not exist yet.
  }

  const fileID = await createAndUploadCode({
    scene: "home",
    page: "pages/home/home",
    cloudPath: `qrcodes/home-${Date.now()}.png`
  });

  try {
    await db.collection("challenges").doc(cacheId).set({
      data: {
        type: "asset",
        qrCodeFileID: fileID,
        updatedAt: db.serverDate()
      }
    });
  } catch (error) {
    console.warn("cache home mini program code failed", error);
  }

  return {
    ok: true,
    fileID,
    tempFileURL: await toTempFileURL(fileID)
  };
}

exports.main = async (event) => {
  if (event.page === "pages/home/home") {
    return getHomeMiniProgramCode();
  }

  const challengeId = String(event.challengeId || "").trim();
  if (!challengeId) return { ok: false, message: "缺少 challengeId" };

  const challenge = await db.collection("challenges").doc(challengeId).get();
  if (challenge.data.qrCodeFileID) {
    return {
      ok: true,
      fileID: challenge.data.qrCodeFileID,
      tempFileURL: await toTempFileURL(challenge.data.qrCodeFileID),
      cached: true
    };
  }

  const fileID = await createAndUploadCode({
    scene: encodeURIComponent(challengeId),
    page: "pages/friend/friend",
    cloudPath: `qrcodes/${challengeId}.png`
  });

  await db.collection("challenges").doc(challengeId).update({
    data: {
      qrCodeFileID: fileID
    }
  });

  return {
    ok: true,
    fileID,
    tempFileURL: await toTempFileURL(fileID)
  };
};
