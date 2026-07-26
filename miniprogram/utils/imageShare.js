function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject
    });
  });
}

function shareOrSaveImage(filePath) {
  this.usedImageShareMenu = false;
  if (!wx.showShareImageMenu) return this.saveImageToAlbum(filePath);
  return new Promise((resolve, reject) => {
    wx.showShareImageMenu({
      path: filePath,
      success: () => {
        this.usedImageShareMenu = true;
        resolve();
      },
      fail: (error) => {
        const errMsg = String((error && error.errMsg) || "");
        if (errMsg.indexOf("cancel") >= 0) {
          this.usedImageShareMenu = true;
          resolve();
          return;
        }
        reject(error);
      }
    });
  }).catch(() => this.saveImageToAlbum(filePath));
}

module.exports = {
  imageShareMethods: {
    shareOrSaveImage,
    saveImageToAlbum
  }
};
