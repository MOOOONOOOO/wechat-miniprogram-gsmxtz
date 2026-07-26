const life9Prompts = [
  {
    id: "life9-01",
    title: "启程",
    prompt: "一首像你人生开场白的歌"
  },
  {
    id: "life9-02",
    title: "少年",
    prompt: "一首会把你拽回少年时代的歌"
  },
  {
    id: "life9-03",
    title: "出走",
    prompt: "一首适合离开熟悉地方时听的歌"
  },
  {
    id: "life9-04",
    title: "暗流",
    prompt: "一首安静但后劲很大的歌"
  },
  {
    id: "life9-05",
    title: "自画像",
    prompt: "一首最像你的歌"
  },
  {
    id: "life9-06",
    title: "重启",
    prompt: "一首把你从低处拉起来的歌"
  },
  {
    id: "life9-07",
    title: "黄昏",
    prompt: "一首适合傍晚独自播放的歌"
  },
  {
    id: "life9-08",
    title: "告别",
    prompt: "一首属于某次告别的歌"
  },
  {
    id: "life9-09",
    title: "留给以后",
    prompt: "一首你希望以后还会听的歌"
  }
];

const heartSlots = Array.from({ length: 15 }).map((_, index) => ({
  id: `heart-${String(index + 1).padStart(2, "0")}`,
  title: `封面 ${index + 1}`,
  prompt: "选一首放进心里的歌"
}));

const treeSongRows = [
  { id: "tree-01", count: 1 },
  { id: "tree-02", count: 2 },
  { id: "tree-03", count: 3 },
  { id: "tree-04", count: 4 },
  { id: "tree-05", count: 5 },
  { id: "tree-06", count: 6 },
  { id: "tree-07", count: 7 },
  { id: "tree-08", count: 8 },
  { id: "tree-09", count: 9 },
  { id: "tree-10", count: 10 },
  { id: "tree-11", count: 11 },
  { id: "tree-12", count: 3, part: "trunk" },
  { id: "tree-13", count: 2, part: "trunk" },
  { id: "tree-14", count: 2, part: "trunk" }
];

const qaPrompts = [
  { id: "qa-classic-01", title: "第一首歌", prompt: "人生第一首记住的歌" },
  { id: "qa-classic-02", title: "入坑曲", prompt: "让你入坑某位歌手的歌" },
  { id: "qa-classic-03", title: "最悲伤的", prompt: "你听过最悲伤的歌" },
  { id: "qa-classic-04", title: "最悔的", prompt: "会让你想起遗憾的歌" },
  { id: "qa-classic-05", title: "最耐听的", prompt: "永远听不腻的歌" },
  { id: "qa-classic-06", title: "近期最爱", prompt: "最近反复播放的歌" },
  { id: "qa-classic-07", title: "曾经最爱", prompt: "曾经非常喜欢的歌" },
  { id: "qa-classic-08", title: "最经典的", prompt: "你心里最经典的歌" },
  { id: "qa-classic-09", title: "别人不喜欢", prompt: "别人不喜欢但你喜欢的歌" },
  { id: "qa-classic-10", title: "你不喜欢", prompt: "别人喜欢但你不喜欢的歌" },
  { id: "qa-classic-11", title: "最好的专辑", prompt: "最好专辑里的一首歌" },
  { id: "qa-classic-12", title: "最伟大的", prompt: "你觉得最伟大的歌" },
  { id: "qa-classic-13", title: "最有意义", prompt: "对你最有意义的歌" },
  { id: "qa-classic-14", title: "想推荐的冷门", prompt: "最想推荐的冷门歌" },
  { id: "qa-classic-15", title: "爷青回", prompt: "让你青春回来的歌" },
  { id: "qa-classic-16", title: "最爱的现场", prompt: "最想在现场听到的歌" },
  { id: "qa-classic-17", title: "深夜专用", prompt: "适合深夜循环的歌" },
  { id: "qa-classic-18", title: "安利失败", prompt: "你安利过但别人没懂的歌" },
  { id: "qa-day-01", title: "Day 01", prompt: "歌名中带颜色的歌" },
  { id: "qa-day-02", title: "Day 02", prompt: "歌名中带数字的歌" },
  { id: "qa-day-03", title: "Day 03", prompt: "让你想起夏天的歌" },
  { id: "qa-day-04", title: "Day 04", prompt: "曾喜欢但已无感的歌" },
  { id: "qa-day-05", title: "Day 05", prompt: "需要调大音量的歌" },
  { id: "qa-day-06", title: "Day 06", prompt: "让你忍不住动起来的歌" },
  { id: "qa-day-07", title: "Day 07", prompt: "适合长途路上听的歌" },
  { id: "qa-day-08", title: "Day 08", prompt: "让你感觉诡异的歌" },
  { id: "qa-day-09", title: "Day 09", prompt: "听起来很明亮的歌" },
  { id: "qa-day-10", title: "Day 10", prompt: "听起来很阴暗的歌" },
  { id: "qa-day-11", title: "Day 11", prompt: "以后也不会厌倦的歌" },
  { id: "qa-day-12", title: "Day 12", prompt: "13岁以前听的歌" },
  { id: "qa-day-13", title: "Day 13", prompt: "至少半世纪历史的歌" },
  { id: "qa-day-14", title: "Day 14", prompt: "想在重要场合播的歌" },
  { id: "qa-day-15", title: "Day 15", prompt: "喜欢的翻唱或Remix" },
  { id: "qa-day-16", title: "Day 16", prompt: "喜欢但不火的歌" },
  { id: "qa-day-17", title: "Day 17", prompt: "KTV最想唱的歌" },
  { id: "qa-day-18", title: "Day 18", prompt: "和你同龄的歌" },
  { id: "qa-day-19", title: "Day 19", prompt: "让脑海浮现画面的歌" },
  { id: "qa-day-20", title: "Day 20", prompt: "对你有重要意义的歌" },
  { id: "qa-day-21", title: "Day 21", prompt: "让你静下来的歌" },
  { id: "qa-day-22", title: "Day 22", prompt: "让你燃起来的歌" },
  { id: "qa-day-23", title: "Day 23", prompt: "想推荐给所有人的歌" },
  { id: "qa-day-24", title: "Day 24", prompt: "来自已解散组合的歌" },
  { id: "qa-day-25", title: "Day 25", prompt: "来自已去世艺术家的歌" },
  { id: "qa-day-26", title: "Day 26", prompt: "名字和内容反差大的歌" },
  { id: "qa-day-27", title: "Day 27", prompt: "蓝色封面的歌" },
  { id: "qa-day-28", title: "Day 28", prompt: "很有故事感的歌" },
  { id: "qa-day-29", title: "Day 29", prompt: "童年记忆里的歌" },
  { id: "qa-day-30", title: "Day 30", prompt: "想起亲历某一年的歌" },
  { id: "qa-extra-01", title: "Day 01", prompt: "最近循环最多的歌" },
  { id: "qa-extra-02", title: "Day 02", prompt: "年少时常哼的歌" },
  { id: "qa-extra-03", title: "Day 03", prompt: "和曲库不搭但存在的歌" },
  { id: "qa-extra-04", title: "Day 04", prompt: "安静独处时的背景音乐" },
  { id: "qa-extra-05", title: "Day 05", prompt: "喜欢的季节会想起的歌" },
  { id: "qa-extra-06", title: "Day 06", prompt: "来自电影或游戏配乐的歌" },
  { id: "qa-extra-07", title: "Day 07", prompt: "歌手声线很特别的歌" },
  { id: "qa-extra-08", title: "Day 08", prompt: "喜欢的母语歌曲" },
  { id: "qa-extra-09", title: "Day 09", prompt: "喜欢曲风里最好的歌" },
  { id: "qa-extra-10", title: "Day 10", prompt: "会想起大海的歌" },
  { id: "qa-extra-11", title: "Day 11", prompt: "震撼过你的歌" },
  { id: "qa-extra-12", title: "Day 12", prompt: "甜甜的心情好歌" },
  { id: "qa-extra-13", title: "Day 13", prompt: "永远不舍得删的歌" },
  { id: "qa-extra-14", title: "Day 14", prompt: "好听到想当铃声的歌" },
  { id: "qa-extra-15", title: "Day 15", prompt: "对你最特别的歌" },
  { id: "qa-extra-16", title: "Day 16", prompt: "越听越好听的怪歌" },
  { id: "qa-extra-17", title: "Day 17", prompt: "最喜欢的乐器独奏" },
  { id: "qa-extra-18", title: "Day 18", prompt: "曾专门买过实体CD的歌" },
  { id: "qa-extra-19", title: "Day 19", prompt: "陌生语种却常听的歌" },
  { id: "qa-extra-20", title: "Day 20", prompt: "声音相性最好的合唱" },
  { id: "qa-extra-21", title: "Day 21", prompt: "听了会不自觉打拍子的歌" },
  { id: "qa-extra-22", title: "Day 22", prompt: "推荐给别人会变艺术品的歌" },
  { id: "qa-extra-23", title: "Day 23", prompt: "家里长辈也喜欢的歌" },
  { id: "qa-extra-24", title: "Day 24", prompt: "一定要看一次现场的歌手或乐队" },
  { id: "qa-extra-25", title: "Day 25", prompt: "很火但原唱少有人知道的歌" },
  { id: "qa-extra-26", title: "Day 26", prompt: "最想推荐的歌手的一首歌" },
  { id: "qa-extra-27", title: "Day 27", prompt: "会想起某个人的歌" },
  { id: "qa-extra-28", title: "Day 28", prompt: "最喜欢的非原曲改编" },
  { id: "qa-extra-29", title: "Day 29", prompt: "最近对方推荐里印象最深的歌" },
  { id: "qa-extra-30", title: "Day 30", prompt: "希望所有人都听到的歌" },
  { id: "qa-scene-01", prompt: "雪花" },
  { id: "qa-scene-02", prompt: "朝露" },
  { id: "qa-scene-03", prompt: "黑暗" },
  { id: "qa-scene-04", prompt: "曙光" },
  { id: "qa-scene-05", prompt: "遗忘" },
  { id: "qa-scene-06", prompt: "自由" },
  { id: "qa-scene-07", prompt: "纯净" },
  { id: "qa-scene-08", prompt: "尘埃" },
  { id: "qa-scene-09", prompt: "四季" },
  { id: "qa-scene-10", prompt: "乐园" },
  { id: "qa-scene-11", prompt: "乡村" },
  { id: "qa-scene-12", prompt: "纸醉金迷" },
  { id: "qa-scene-13", prompt: "邂逅" },
  { id: "qa-scene-14", prompt: "思念" },
  { id: "qa-scene-15", prompt: "世界末日" },
  { id: "qa-scene-16", prompt: "初听无感后来爱上" },
  { id: "qa-scene-17", prompt: "憔悴感" },
  { id: "qa-scene-18", prompt: "故事感" },
  { id: "qa-scene-19", prompt: "触不可及的感觉" },
  { id: "qa-scene-20", prompt: "刻骨铭心的感觉" },
  { id: "qa-scene-21", prompt: "失而复得的感觉" },
  { id: "qa-scene-22", prompt: "喜欢的动漫/电影的主题曲" },
  { id: "qa-scene-23", prompt: "讽刺意味" },
  { id: "qa-scene-24", prompt: "世界和平" },
  { id: "qa-scene-25", prompt: "产生食欲" },
  { id: "qa-scene-26", prompt: "让你想起某个特别时刻" },
  { id: "qa-scene-27", prompt: "最近删掉的歌" },
  { id: "qa-scene-28", prompt: "火得莫名其妙" },
  { id: "qa-scene-29", prompt: "前任的铃声" },
  { id: "qa-scene-30", prompt: "符合对方气质的歌" },
  { id: "qa-user-01", prompt: "一听就想到某座城市的歌" },
  { id: "qa-user-02", prompt: "适合在雨停之后听的歌" },
  { id: "qa-user-03", prompt: "会让你想起一个旧朋友的歌" },
  { id: "qa-user-04", prompt: "前奏一响就舍不得切的歌" },
  { id: "qa-user-05", prompt: "适合一个人坐车时听的歌" },
  { id: "qa-user-06", prompt: "听起来像告别的歌" },
  { id: "qa-user-07", prompt: "听起来像重新开始的歌" },
  { id: "qa-user-08", prompt: "让你觉得很温柔的歌" },
  { id: "qa-user-09", prompt: "明明很悲伤但你很爱听的歌" },
  { id: "qa-user-10", prompt: "适合在凌晨两点听的歌" },
  { id: "qa-user-11", prompt: "你想送给现在自己的歌" },
  { id: "qa-user-12", prompt: "你想送给十年前自己的歌" },
  { id: "qa-user-13", prompt: "歌词里有一句特别打动你的歌" },
  { id: "qa-user-14", prompt: "编曲让你印象很深的歌" },
  { id: "qa-user-15", prompt: "越长大越听懂的歌" },
  { id: "qa-user-16", prompt: "曾经听不懂后来很喜欢的歌" },
  { id: "qa-user-17", prompt: "很适合散步时听的歌" },
  { id: "qa-user-18", prompt: "让你想起某个夏夜的歌" },
  { id: "qa-user-19", prompt: "让你想起某个冬天的歌" },
  { id: "qa-user-20", prompt: "听完会想发呆的歌" },
  { id: "qa-user-21", prompt: "适合在海边听的歌" },
  { id: "qa-user-22", prompt: "适合在火车上听的歌" },
  { id: "qa-user-23", prompt: "你觉得最有电影感的歌" },
  { id: "qa-user-24", prompt: "你觉得最孤独的歌" },
  { id: "qa-user-25", prompt: "你觉得最自由的歌" },
  { id: "qa-user-26", prompt: "听起来像一封信的歌" },
  { id: "qa-user-27", prompt: "让你想起校园生活的歌" },
  { id: "qa-user-28", prompt: "很想让朋友认真听完的歌" },
  { id: "qa-user-29", prompt: "你最近突然重新喜欢上的歌" },
  { id: "qa-user-30", prompt: "你希望多年后还会记得的歌" }
];

const templates = [
  {
    id: "tree",
    name: "圣诞树推歌",
    typeText: "双人",
    description: "按 1—11 字拼一棵歌名树",
    status: "ready",
    prompts: treeSongRows
  },
  {
    id: "heart",
    name: "心形专辑挑战",
    typeText: "Solo",
    description: "用专辑封面拼出一颗心",
    status: "ready",
    prompts: heartSlots
  },
  {
    id: "life9",
    name: "人生九专",
    typeText: "Solo",
    description: "组成我人生的几分之几",
    status: "ready",
    prompts: life9Prompts
  },
  {
    id: "qa",
    name: "歌单问答",
    typeText: "Solo / 双人",
    description: "可以单推、激推，甚至互推",
    status: "ready",
    prompts: qaPrompts
  }
];

function getThemeTemplates() {
  return templates.map((item) => ({
    ...item,
    prompts: item.prompts ? item.prompts.map((prompt) => ({ ...prompt })) : []
  }));
}

function getThemeTemplate(id) {
  return getThemeTemplates().find((item) => item.id === id) || null;
}

module.exports = {
  getThemeTemplate,
  getThemeTemplates,
  heartSlots,
  life9Prompts,
  qaPrompts,
  treeSongRows
};
