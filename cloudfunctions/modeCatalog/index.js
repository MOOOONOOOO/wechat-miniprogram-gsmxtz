const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MODE_CONTENT_COLLECTION = "modeContent";
const KNOWN_MODE_KEYS = new Set([
  "artist",
  "album",
  "top9",
  "songTournament",
  "tree",
  "theme",
  "rainBox",
  "lyrics"
]);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeModeContent(item = {}) {
  const modeKey = cleanText(item.modeKey || item._id, 40);
  if (!KNOWN_MODE_KEYS.has(modeKey)) return null;
  return {
    modeKey,
    title: cleanText(item.title, 40),
    description: cleanText(item.description, 120),
    updatedAt: item.updatedAt || null
  };
}

exports.main = async () => {
  try {
    const res = await db.collection(MODE_CONTENT_COLLECTION).limit(50).get();
    return {
      ok: true,
      modes: (res.data || []).map(normalizeModeContent).filter(Boolean)
    };
  } catch (error) {
    console.warn("load mode content failed", error);
    return {
      ok: true,
      modes: []
    };
  }
};
