const colorSubjects = [
  { id: "color-purple", name: "紫色", color: "#d9c3f4", textColor: "#4d2a70" },
  { id: "color-blue", name: "蓝色", color: "#b9d8f6", textColor: "#1f5f9f" },
  { id: "color-pink", name: "粉色", color: "#f5c3dd", textColor: "#8c3d65" },
  { id: "color-green", name: "绿色", color: "#b8eccd", textColor: "#236d42" },
  { id: "color-black", name: "黑色", color: "#3b3a38", textColor: "#ffffff" },
  { id: "color-orange", name: "橙色", color: "#f7d0a0", textColor: "#8a4f16" },
  { id: "color-yellow", name: "黄色", color: "#f8ec84", textColor: "#7a6410" },
  { id: "color-white", name: "白色", color: "#fffdf8", textColor: "#4d4841", borderColor: "#e7ded2" },
  { id: "color-red", name: "红色", color: "#f5bcbc", textColor: "#933333" }
];

function getColorSubjects() {
  return colorSubjects.map((item) => ({ ...item }));
}

function getColorById(id) {
  return getColorSubjects().find((item) => item.id === id) || null;
}

module.exports = {
  getColorById,
  getColorSubjects
};
