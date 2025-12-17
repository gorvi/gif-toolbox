function chooseSingleVideo() {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: 60,
        success: (res) => {
          const file = (res.tempFiles && res.tempFiles[0]) || null
          if (!file) {
            reject(new Error('未选择视频'))
            return
          }
          resolve({
            tempFilePath: file.tempFilePath,
            duration: file.duration || 0,
            size: file.size || 0,
            width: file.width || 0,
            height: file.height || 0,
          })
        },
        fail: (err) => reject(err),
      })
      return
    }

    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      compressed: true,
      success: (res) => {
        resolve({
          tempFilePath: res.tempFilePath,
          duration: res.duration || 0,
          size: res.size || 0,
          width: res.width || 0,
          height: res.height || 0,
        })
      },
      fail: (err) => reject(err),
    })
  })
}

module.exports = {
  chooseSingleVideo,
}







