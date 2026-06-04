const { readCachedProfile } = require("../../utils/profile");

function callNoticeHub(data) {
  if (!wx.cloud) return Promise.reject(new Error("请在微信云开发环境中运行"));
  return wx.cloud.callFunction({
    name: "noticeHub",
    data
  }).then((res) => {
    const result = res.result || {};
    if (result.ok === false) {
      return Promise.reject(new Error(result.message || "公告服务暂不可用"));
    }
    return result;
  });
}

function formatTime(value) {
  if (!value) return "";
  const raw = value && value.$date ? value.$date : value;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

function splitContentLines(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .split("\n");
}

Page({
  data: {
    activeTab: "announcements",
    content: "",
    submitting: false,
    loading: false,
    announcements: []
  },

  onLoad() {
    this.loadAnnouncements();
  },

  onShow() {
    if (this.data.activeTab === "announcements") this.loadAnnouncements();
  },

  setTab(event) {
    const activeTab = event.currentTarget.dataset.tab || "announcements";
    this.setData({ activeTab }, () => {
      if (activeTab === "announcements") this.loadAnnouncements();
    });
  },

  onContentInput(event) {
    this.setData({ content: event.detail.value || "" });
  },

  submitFeedback() {
    const content = String(this.data.content || "").trim();
    if (!content) {
      wx.showToast({ title: "先写一点内容", icon: "none" });
      return;
    }
    if (this.data.submitting) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    callNoticeHub({
      action: "submitFeedback",
      content,
      profile: readCachedProfile()
    }).then(() => {
      wx.showToast({ title: "已收到", icon: "success" });
      this.setData({ content: "" });
    }).catch((error) => {
      wx.showToast({ title: (error && error.message) || "提交失败", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ submitting: false });
    });
  },

  loadAnnouncements() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    callNoticeHub({ action: "listAnnouncements" })
      .then((res) => {
        this.setData({
          announcements: (res.announcements || []).map((item) => ({
            ...item,
            contentLines: splitContentLines(item.content),
            timeText: formatTime(item.time)
          }))
        });
      })
      .catch(() => {
        this.setData({ announcements: [] });
      })
      .finally(() => this.setData({ loading: false }));
  }
});
