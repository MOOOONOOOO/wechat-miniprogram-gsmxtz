const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isCloudFileUrl(url) {
  return String(url || "").indexOf("cloud://") === 0;
}

function normalizeAnnouncement(item = {}) {
  const time = item.publishedAt || item.createdAt || item.updatedAt || "";
  return {
    id: item._id || "",
    popupId: cleanText(item.popupId || item._id || "", 80),
    title: cleanText(item.title || "更新公告", 80),
    content: cleanText(item.content || item.body || "", 1200),
    buttonText: cleanText(item.buttonText || "知道了", 20),
    version: cleanText(item.version || "", 40),
    time
  };
}

async function listAnnouncements() {
  try {
    const res = await db.collection("announcements")
      .where({
        hidden: _.neq(true),
        popup: _.neq(true)
      })
      .orderBy("priority", "desc")
      .orderBy("publishedAt", "desc")
      .limit(20)
      .get();
    return {
      ok: true,
      announcements: (res.data || [])
        .map(normalizeAnnouncement)
        .filter((item) => item.title || item.content)
    };
  } catch (error) {
    console.warn("list announcements failed", error);
    return { ok: true, announcements: [] };
  }
}

async function getPopupAnnouncement() {
  try {
    const res = await db.collection("announcements")
      .where({
        popup: true,
        hidden: _.neq(true)
      })
      .orderBy("priority", "desc")
      .orderBy("publishedAt", "desc")
      .limit(1)
      .get();
    const popup = (res.data || [])[0] || null;
    return {
      ok: true,
      popup: popup ? normalizeAnnouncement(popup) : null
    };
  } catch (error) {
    console.warn("get popup announcement failed", error);
    return { ok: true, popup: null };
  }
}

async function submitFeedback(event, openId) {
  const content = cleanText(event.content, 1000);
  const contact = cleanText(event.contact, 120);
  const profile = event.profile || {};

  if (!content) return { ok: false, message: "先写一点想公告的内容" };

  try {
    await db.collection("feedbacks").add({
      data: {
        openId,
        content,
        contact,
        profile: {
          nickName: cleanText(profile.nickName, 80),
          avatarUrl: profile.avatarUrl || ""
        },
        status: "new",
        createdAt: db.serverDate()
      }
    });
    return { ok: true };
  } catch (error) {
    console.warn("submit feedback failed", error);
    return { ok: false, message: "反馈通道暂未开启" };
  }
}

async function listThemeCovers() {
  try {
    const res = await db.collection("themeCovers").limit(20).get();
    const rawCovers = (res.data || []).reduce((map, item) => {
      const id = cleanText(item.id || item.templateId || item._id || "", 40);
      const coverImage = item.coverImage || item.coverUrl || item.imageUrl || item.fileID || "";
      if (id && coverImage && item.hidden !== true) map[id] = coverImage;
      return map;
    }, {});

    const cloudFileList = Object.keys(rawCovers)
      .map((key) => rawCovers[key])
      .filter(isCloudFileUrl);
    if (!cloudFileList.length) return { ok: true, covers: rawCovers };

    const tempRes = await cloud.getTempFileURL({
      fileList: cloudFileList
    }).catch((error) => {
      console.warn("resolve theme cover urls failed", error);
      return { fileList: [] };
    });
    const tempMap = (tempRes.fileList || []).reduce((map, item) => {
      if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
      return map;
    }, {});
    const covers = Object.keys(rawCovers).reduce((map, key) => {
      map[key] = isCloudFileUrl(rawCovers[key]) ? (tempMap[rawCovers[key]] || "") : rawCovers[key];
      return map;
    }, {});
    return { ok: true, covers };
  } catch (error) {
    console.warn("list theme covers failed", error);
    return { ok: true, covers: {} };
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const action = event.action === "submitFeedback"
    ? "submitFeedback"
    : (event.action === "listThemeCovers"
        ? "listThemeCovers"
        : (event.action === "getPopupAnnouncement" ? "getPopupAnnouncement" : "listAnnouncements"));

  if (action === "submitFeedback") {
    return submitFeedback(event, wxContext.OPENID || "");
  }

  if (action === "listThemeCovers") {
    return listThemeCovers();
  }

  if (action === "getPopupAnnouncement") {
    return getPopupAnnouncement();
  }

  return listAnnouncements();
};
