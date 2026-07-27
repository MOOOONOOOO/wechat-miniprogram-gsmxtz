const {
  MEDIA_VERSION,
  RAIN_BOX_MEDIA
} = require("../config/rainBoxMedia");

const CACHE_PREFIX = "rain-box-media-";
const inFlightAssets = {};

function getFileSystemManager() {
  if (!wx.getFileSystemManager) return null;
  return wx.getFileSystemManager();
}

function safeVersion() {
  return String(MEDIA_VERSION || "v1").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function cachedFileName(asset) {
  return `${CACHE_PREFIX}${safeVersion()}-${asset.id}.mp4`;
}

function cachedFilePath(asset) {
  return `${wx.env.USER_DATA_PATH}/${cachedFileName(asset)}`;
}

function isValidCachedFile(asset, filePath) {
  const fs = getFileSystemManager();
  if (!fs || !filePath) return false;
  try {
    const stat = fs.statSync(filePath);
    const expectedBytes = Number(asset && asset.bytes) || 0;
    return Boolean(stat && stat.size > 0 && (!expectedBytes || stat.size === expectedBytes));
  } catch (error) {
    return false;
  }
}

function getCachedMediaSources() {
  return RAIN_BOX_MEDIA.reduce((result, asset) => {
    const filePath = cachedFilePath(asset);
    if (isValidCachedFile(asset, filePath)) result[asset.id] = filePath;
    return result;
  }, {});
}

function createConfigurationError(asset) {
  const error = new Error(`请先配置 ${asset.id} 的云存储 fileID 或 HTTPS 地址`);
  error.code = "RAIN_BOX_MEDIA_NOT_CONFIGURED";
  error.assetId = asset.id;
  return error;
}

function bindDownloadProgress(task, onProgress) {
  if (!task || !task.onProgressUpdate || typeof onProgress !== "function") return;
  task.onProgressUpdate((event) => {
    onProgress({
      progress: Math.max(0, Math.min(100, Number(event.progress) || 0)),
      totalBytesWritten: Number(event.totalBytesWritten) || 0,
      totalBytesExpectedToWrite: Number(event.totalBytesExpectedToWrite) || 0
    });
  });
}

function downloadHttpsToTemp(url, onProgress) {
  return new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url,
      success: (res) => {
      if (!res || !res.tempFilePath) {
          reject(new Error("视频下载完成但没有返回临时文件"));
        return;
      }
      if (res.statusCode && Number(res.statusCode) !== 200) {
          reject(new Error(`视频下载失败：HTTP ${res.statusCode}`));
        return;
      }
      resolve(res.tempFilePath);
      },
      fail: (error) => reject(error || new Error("视频下载失败"))
    });
    bindDownloadProgress(task, onProgress);
  });
}

function resolveCloudTempUrl(fileID) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      reject(new Error("当前环境不支持获取云文件临时地址"));
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const item = res && res.fileList && res.fileList[0];
        const tempFileURL = item && item.tempFileURL;
        if (tempFileURL) {
          resolve(tempFileURL);
          return;
        }

        const detail = item && (
          item.errMsg ||
          item.message ||
          item.code ||
          item.status
        );
        reject(new Error(
          detail
            ? `云文件没有可用下载地址：${detail}`
            : "云文件不存在或当前小程序没有读取权限"
        ));
      },
      fail: (error) => reject(error || new Error("无法获取云文件临时地址"))
    });
  });
}

function downloadCloudToTemp(fileID, onProgress) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.downloadFile) {
      reject(new Error("当前环境不支持云存储下载"));
      return;
    }

    const task = wx.cloud.downloadFile({
      fileID,
      success: (res) => {
        if (!res || !res.tempFilePath) {
          reject(new Error("云视频下载完成但没有返回临时文件"));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail: reject
    });
    bindDownloadProgress(task, onProgress);
  });
}

function downloadAssetToTemp(asset, onProgress) {
  const source = String(asset.source || "").trim();
  if (!source) return Promise.reject(createConfigurationError(asset));

  if (source.indexOf("cloud://") !== 0) {
    return downloadHttpsToTemp(source, onProgress);
  }

  return downloadCloudToTemp(source, onProgress).catch((directError) => {
    console.warn(`${asset.id} 直接下载失败，改用临时 HTTPS 地址`, directError);
    return resolveCloudTempUrl(source)
      .then((tempFileURL) => {
        return downloadHttpsToTemp(tempFileURL, onProgress).catch((downloadError) => {
          console.warn(
            `${asset.id} 临时地址无法缓存，改为直接播放云端地址`,
            downloadError
          );
          return tempFileURL;
        });
      })
      .catch((fallbackError) => {
        const error = new Error(
          `${asset.id} 云文件无法读取：${
            (fallbackError && (fallbackError.errMsg || fallbackError.message)) ||
            (directError && (directError.errMsg || directError.message)) ||
            "未知错误"
          }`
        );
        error.code = "RAIN_BOX_CLOUD_DOWNLOAD_FAILED";
        error.cause = fallbackError || directError;
        throw error;
      });
  });
}

function persistTempFile(asset, tempFilePath) {
  if (/^https?:\/\//i.test(String(tempFilePath || ""))) {
    return Promise.resolve(tempFilePath);
  }

  const fs = getFileSystemManager();
  const targetPath = cachedFilePath(asset);
  if (!fs || !fs.saveFile) return Promise.resolve(tempFilePath);

  return new Promise((resolve, reject) => {
    fs.saveFile({
      tempFilePath,
      filePath: targetPath,
      success: (res) => {
        const savedPath = (res && res.savedFilePath) || targetPath;
        if (!isValidCachedFile(asset, savedPath)) {
          reject(new Error(`${asset.id} 缓存文件校验失败`));
          return;
        }
        resolve(savedPath);
      },
      fail: (error) => {
        if (isValidCachedFile(asset, targetPath)) {
          resolve(targetPath);
          return;
        }
        reject(error || new Error(`${asset.id} 无法写入本地缓存`));
      }
    });
  });
}

function cacheAsset(asset, onProgress) {
  const targetPath = cachedFilePath(asset);
  if (isValidCachedFile(asset, targetPath)) {
    return Promise.resolve(targetPath);
  }

  if (inFlightAssets[asset.id]) return inFlightAssets[asset.id];

  const request = downloadAssetToTemp(asset, onProgress)
    .then((tempFilePath) => persistTempFile(asset, tempFilePath))
    .finally(() => {
      delete inFlightAssets[asset.id];
    });

  inFlightAssets[asset.id] = request;
  return request;
}

function cleanStaleMediaFiles() {
  const fs = getFileSystemManager();
  if (!fs || !fs.readdirSync || !fs.unlinkSync) return;
  const keep = {};
  RAIN_BOX_MEDIA.forEach((asset) => {
    keep[cachedFileName(asset)] = true;
  });

  try {
    fs.readdirSync(wx.env.USER_DATA_PATH)
      .filter((name) => name.indexOf(CACHE_PREFIX) === 0 && !keep[name])
      .forEach((name) => {
        try {
          fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`);
        } catch (error) {}
      });
  } catch (error) {}
}

function prepareRainBoxMedia(options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const onAssetReady = typeof options.onAssetReady === "function" ? options.onAssetReady : () => {};
  const hasCompleteByteData = RAIN_BOX_MEDIA.every((asset) => Number(asset.bytes) > 0);
  const totalUnits = hasCompleteByteData
    ? RAIN_BOX_MEDIA.reduce((sum, asset) => sum + Number(asset.bytes), 0)
    : RAIN_BOX_MEDIA.length;
  const sources = {};
  let completedUnits = 0;

  return RAIN_BOX_MEDIA.reduce((sequence, asset) => {
    return sequence.then(() => {
      const assetUnits = hasCompleteByteData ? Number(asset.bytes) : 1;
      const targetPath = cachedFilePath(asset);
      if (isValidCachedFile(asset, targetPath)) {
        sources[asset.id] = targetPath;
        completedUnits += assetUnits;
        onAssetReady({ id: asset.id, path: targetPath, cached: true });
        onProgress({
          assetId: asset.id,
          percent: totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 100,
          cached: true
        });
        return null;
      }

      return cacheAsset(asset, (event) => {
        const activeUnits = assetUnits * (event.progress / 100);
        const percent = totalUnits
          ? Math.round(((completedUnits + activeUnits) / totalUnits) * 100)
          : event.progress;
        onProgress({
          assetId: asset.id,
          percent: Math.max(0, Math.min(99, percent)),
          cached: false
        });
      }).then((filePath) => {
        sources[asset.id] = filePath;
        completedUnits += assetUnits;
        onAssetReady({ id: asset.id, path: filePath, cached: false });
      });
    });
  }, Promise.resolve()).then(() => {
    cleanStaleMediaFiles();
    onProgress({ assetId: "", percent: 100, cached: true });
    return sources;
  });
}

function getRainBoxMediaSummary() {
  const totalBytes = RAIN_BOX_MEDIA.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0);
  return {
    version: MEDIA_VERSION,
    count: RAIN_BOX_MEDIA.length,
    totalBytes,
    totalMegabytes: Math.max(1, Math.round(totalBytes / 1024 / 1024))
  };
}

module.exports = {
  getCachedMediaSources,
  getRainBoxMediaSummary,
  prepareRainBoxMedia
};
