const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const now = new Date();
  const submissions = await db.collection("submissions").where({
    expiresAt: _.lte(now)
  }).remove();
  const creatorInboxes = await db.collection("creatorInboxes").where({
    expiresAt: _.lte(now)
  }).remove();
  const challengeResults = await db.collection("challengeResults").where({
    expiresAt: _.lte(now)
  }).remove();

  return {
    ok: true,
    removed: {
      submissions: submissions.stats ? submissions.stats.removed : 0,
      creatorInboxes: creatorInboxes.stats ? creatorInboxes.stats.removed : 0,
      challengeResults: challengeResults.stats ? challengeResults.stats.removed : 0
    }
  };
};
