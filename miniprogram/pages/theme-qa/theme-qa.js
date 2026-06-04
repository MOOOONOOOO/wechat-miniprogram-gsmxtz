const { getThemeTemplate } = require("../../data/themeTemplates");

const CUSTOM_QA_STORAGE_KEY = "qaCustomPrompts";

function normalizePrompt(prompt = {}, index = 0) {
  const promptText = String(prompt.prompt || prompt.title || "").trim();
  const title = String(prompt.title || promptText).trim();
  return {
    id: String(prompt.id || `qa-${index + 1}`).trim(),
    title: title || `题目 ${index + 1}`,
    prompt: promptText || title || `题目 ${index + 1}`
  };
}

function clonePrompts(prompts) {
  return (Array.isArray(prompts) ? prompts : []).map(normalizePrompt);
}

function readCustomPrompts() {
  try {
    return clonePrompts(wx.getStorageSync(CUSTOM_QA_STORAGE_KEY) || []);
  } catch (error) {
    return [];
  }
}

function saveCustomPrompts(prompts) {
  try {
    wx.setStorageSync(CUSTOM_QA_STORAGE_KEY, clonePrompts(prompts));
  } catch (error) {}
}

Page({
  data: {
    questions: [],
    selectedPrompts: [],
    selectedCount: 0,
    customQuestion: ""
  },

  onLoad() {
    const template = getThemeTemplate("qa") || {};
    const app = getApp();
    app.globalData.draftMode = "qa";
    app.globalData.draftThemeTemplate = "qa";
    app.globalData.draftQaPrompts = [];
    app.globalData.draftQaArtists = {};
    app.globalData.creatorChoices = {};
    app.globalData.friendChoices = {};
    const customPrompts = readCustomPrompts();
    const libraryPrompts = clonePrompts(template.prompts || []);
    this.setData({
      questions: [...customPrompts, ...libraryPrompts].map((item) => ({
        ...item,
        selectedClass: ""
      }))
    });
  },

  renderQuestions() {
    const selectedMap = this.data.selectedPrompts.reduce((map, item) => {
      map[item.id] = true;
      return map;
    }, {});
    this.setData({
      selectedCount: this.data.selectedPrompts.length,
      questions: this.data.questions.map((item) => ({
        ...item,
        selectedClass: selectedMap[item.id] ? "selected" : ""
      }))
    });
  },

  toggleQuestion(event) {
    const id = event.currentTarget.dataset.id;
    const question = this.data.questions.find((item) => item.id === id);
    if (!question) return;

    const exists = this.data.selectedPrompts.some((item) => item.id === id);
    let selectedPrompts = exists
      ? this.data.selectedPrompts.filter((item) => item.id !== id)
      : [...this.data.selectedPrompts, question];
    if (!exists && selectedPrompts.length > 9) {
      wx.showToast({ title: "最多选择 9 个问题", icon: "none" });
      return;
    }
    selectedPrompts = selectedPrompts.map(normalizePrompt);
    this.setData({
      selectedPrompts
    }, () => this.renderQuestions());
  },

  onCustomInput(event) {
    this.setData({ customQuestion: event.detail.value || "" });
  },

  addCustomQuestion() {
    const text = String(this.data.customQuestion || "").trim();
    if (!text) {
      wx.showToast({ title: "先写一个问题", icon: "none" });
      return;
    }
    if (this.data.questions.some((item) => item.prompt === text || item.title === text)) {
      wx.showToast({ title: "这个问题已经有了", icon: "none" });
      return;
    }
    if (this.data.selectedPrompts.length >= 9) {
      wx.showToast({ title: "已选满，先取消一个问题", icon: "none" });
      return;
    }
    const question = normalizePrompt({
      id: `qa-custom-${Date.now()}`,
      title: text,
      prompt: text
    }, this.data.questions.length);
    const customPrompts = [question, ...readCustomPrompts()];
    saveCustomPrompts(customPrompts);
    this.setData({
      questions: [
        {
          ...question,
          selectedClass: "selected"
        },
        ...this.data.questions
      ],
      selectedPrompts: [
        ...this.data.selectedPrompts,
        question
      ],
      customQuestion: ""
    }, () => this.renderQuestions());
  },

  prepareQuestionSheet() {
    if (this.data.selectedPrompts.length !== 9) {
      wx.showToast({ title: "请选择 9 个问题", icon: "none" });
      return null;
    }
    const prompts = clonePrompts(this.data.selectedPrompts).slice(0, 9);
    const app = getApp();
    app.globalData.draftMode = "qa";
    app.globalData.draftThemeTemplate = "qa";
    app.globalData.draftQaPrompts = prompts;
    app.globalData.draftQaArtists = {};
    app.globalData.currentQaSlotId = "";
    app.globalData.currentQaSlotArtist = null;
    app.globalData.creatorChoices = {};
    app.globalData.friendChoices = {};
    return prompts;
  },

  generateSheet() {
    const prompts = this.prepareQuestionSheet();
    if (!prompts) return;
    wx.navigateTo({ url: "/pages/theme-qa-sheet/theme-qa-sheet" });
  }
});
