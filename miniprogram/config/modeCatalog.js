const MODE_DEFINITIONS = [
  {
    modeKey: "artist",
    title: "歌手默契挑战",
    description: "选几位歌手，每位 1 首最爱"
  },
  {
    modeKey: "album",
    title: "专辑默契挑战",
    description: "选几张专辑，每位 1 首最爱"
  },
  {
    modeKey: "top9",
    title: "同担 Top 挑战",
    description: "选 1 位歌手，排出自己的最爱"
  },
  {
    modeKey: "songTournament",
    title: "决战歌曲之巅",
    description: "首轮每 4 首留下 2 首，再两两选出最后一首"
  },
  {
    modeKey: "introQuiz",
    title: "前奏听歌挑战",
    description: "两位好友同时听 15 秒，四选一抢认歌曲"
  },
  {
    modeKey: "tree",
    title: "圣诞树推歌",
    description: "两个人，用歌名一起拼一棵圣诞树"
  },
  {
    modeKey: "theme",
    title: "主题推歌",
    description: "颜色、心形专辑、人生九专、歌单问答"
  },
  {
    modeKey: "rainBox",
    title: "雨水一盒",
    description: "那些下午决定要走，一无所有"
  },
  {
    modeKey: "lyrics",
    title: "歌词分享",
    description: "选一首歌，截几句歌词做成卡片（实验功能）"
  }
];

function cleanCopy(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function buildModeCatalog(remoteModes = []) {
  const remoteByKey = (Array.isArray(remoteModes) ? remoteModes : [])
    .reduce((map, item) => {
      const modeKey = cleanCopy(item && (item.modeKey || item._id), 40);
      if (modeKey) map[modeKey] = item;
      return map;
    }, {});

  return MODE_DEFINITIONS.map((definition) => {
    const remote = remoteByKey[definition.modeKey] || {};
    return {
      modeKey: definition.modeKey,
      title: cleanCopy(remote.title, 40) || definition.title,
      description: cleanCopy(remote.description, 120) || definition.description
    };
  });
}

module.exports = {
  MODE_DEFINITIONS,
  buildModeCatalog
};
