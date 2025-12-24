const {
  MAX_IMAGE_COUNT,
  DEFAULT_FRAME_DELAY_MS,
  DEFAULT_GIF_LOOP,
  DEFAULT_GIF_MAX_SIDE_PX,
} = require('../../constants/config')

const { convertImagesToGif } = require('../../services/images-to-gif')

const MAX_SIDE_OPTIONS = [320, 480, 720]
const LOOP_OPTIONS = [
  { label: '无限循环', value: 0 },
  { label: '循环 1 次', value: 1 },
  { label: '循环 3 次', value: 3 },
]

const QUALITY_MODE = {
  STANDARD: 'STANDARD',
  HIGH: 'HIGH',
}

const ASPECT_OPTIONS = [
  { label: '自动', value: 0 },
  { label: '自由', value: -1 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

function chooseImages(count) {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        sourceType: ['album'],
        success: (res) => {
          const files = (res.tempFiles || []).map((f) => ({ path: f.tempFilePath, fitMode: 'contain', cropMode: 'contain' }))
          resolve(files)
        },
        fail: reject,
      })
      return
    }
    wx.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const files = (res.tempFilePaths || []).map((p) => ({ path: p, fitMode: 'contain', cropMode: 'contain' }))
        resolve(files)
      },
      fail: reject,
    })
  })
}

function chooseImagesFromChat(count) {
  return new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) {
      reject(new Error('当前微信版本不支持从聊天选择'))
      return
    }
    wx.chooseMessageFile({
      count: Math.max(1, Number(count) || 1),
      type: 'image',
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => ({ path: f.path, fitMode: 'contain', cropMode: 'contain' }))
        resolve(files)
      },
      fail: reject,
    })
  })
}

function isCancelError(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  return msg.includes('cancel') || msg.includes('fail cancel')
}

Page({
  data: {
    images: [],
    frameDelayMs: DEFAULT_FRAME_DELAY_MS,
    maxSideIndex: Math.max(0, MAX_SIDE_OPTIONS.indexOf(DEFAULT_GIF_MAX_SIDE_PX)),
    maxSideLabels: MAX_SIDE_OPTIONS.map((v) => `${v}px`),
    loopIndex: Math.max(0, LOOP_OPTIONS.findIndex((x) => x.value === DEFAULT_GIF_LOOP)),
    loopLabels: LOOP_OPTIONS.map((x) => x.label),
    qualityMode: QUALITY_MODE.HIGH,
    aspectIndex: 0,
    aspectLabels: ASPECT_OPTIONS.map((x) => x.label),
    badgeAspectText: '',
    activeImageIndex: 0,

    dragging: false,
    draggingIndex: -1,
    dragGhostX: 0,
    dragGhostY: 0,
    dragGhostSrc: '',
    dragItemW: 0,
    dragItemH: 0,

    cropModalVisible: false,
    cropTargetIndex: -1,
    cropImagePath: '',
    cropViewW: 0,
    cropViewH: 0,
    cropNaturalW: 0,
    cropNaturalH: 0,
    cropDispX: 0,
    cropDispY: 0,
    cropDispW: 0,
    cropDispH: 0,
    cropFitScale: 1,
    cropAspect: 1,
    cropBoxX: 0,
    cropBoxY: 0,
    cropBoxW: 0,
    cropBoxH: 0,
    cropIsFree: false,

    processing: false,
    progressText: '',
    outPath: '',
    exportSizeText: '',
  },

  setDataAsync(patch) {
    return new Promise((resolve) => this.setData(patch, resolve))
  },

  onLoad(options) {
    this.updateBadgeAspectText()

    const app = getApp()
    const incoming = app && app.globalData && app.globalData.selectedImages
    if (incoming && Array.isArray(incoming) && incoming.length) {
      app.globalData.selectedImages = null
      this.setData(
        {
          images: incoming.slice(0, MAX_IMAGE_COUNT),
          outPath: '',
          activeImageIndex: 0,
          cropModalVisible: false,
          cropTargetIndex: -1,
          cropImagePath: '',
        },
        () => this.updateExportSizeText()
      )
      return
    }

    const autoChoose = options && (options.autoChoose === '1' || options.autoChoose === 1)
    if (autoChoose) {
      setTimeout(() => {
        if (!this.data.images.length && !this.data.processing) {
          this.onChooseSource()
        }
      }, 0)
    }
  },

  onChooseSource() {
    if (this.data.processing) return
    const remain = MAX_IMAGE_COUNT - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: `最多选择${MAX_IMAGE_COUNT}张`, icon: 'none' })
      return
    }

    wx.showActionSheet({
      itemList: ['相册选择', '聊天图片'],
      success: async (res) => {
        const tapIndex = Number(res && res.tapIndex)
        try {
          const pickCount = Math.min(20, remain)
          const files = tapIndex === 1 ? await chooseImagesFromChat(pickCount) : await chooseImages(pickCount)
          if (!files.length) return
          this.setData(
            {
              images: this.data.images.concat(files).slice(0, MAX_IMAGE_COUNT),
              outPath: '',
              activeImageIndex: 0,
            },
            () => this.updateExportSizeText()
          )
        } catch (e) {
          if (isCancelError(e)) return
          wx.showToast({ title: '选择图片失败', icon: 'none' })
        }
      },
      fail: (e) => {
        if (isCancelError(e)) return
      },
    })
  },

  onReady() {
    const query = wx.createSelectorQuery()
    query.select('#workCanvas').fields({ node: true, size: true }).exec((res) => {
      const node = res && res[0] && res[0].node
      if (!node) return
      this.canvas = node
      this.ctx = node.getContext('2d')
    })
  },

  async onChooseImages() {
    if (this.data.processing) return
    const remain = MAX_IMAGE_COUNT - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: `最多选择${MAX_IMAGE_COUNT}张`, icon: 'none' })
      return
    }

    try {
      const files = await chooseImages(Math.min(20, remain))
      if (!files.length) {
        wx.showToast({ title: '未选择图片', icon: 'none' })
        return
      }
      this.setData(
        {
          images: this.data.images.concat(files).slice(0, MAX_IMAGE_COUNT),
          outPath: '',
          activeImageIndex: 0,
        },
        () => this.updateExportSizeText()
      )
    } catch (e) {
      wx.showToast({ title: '选择图片失败', icon: 'none' })
    }
  },

  onRemoveImage(e) {
    if (this.data.processing) return
    const index = Number(e.currentTarget.dataset.index || 0)
    const next = this.data.images.slice()
    next.splice(index, 1)
    const active = Math.max(0, Math.min(next.length - 1, Number(this.data.activeImageIndex || 0)))
    this.setData({ images: next, outPath: '', activeImageIndex: active }, () => this.updateExportSizeText())
  },

  onSelectImage(e) {
    if (this.data.processing) return
    if (this.data.dragging) return
    if (this._suppressTapUntil && Date.now() < this._suppressTapUntil) return
    const index = Number(e.currentTarget.dataset.index || 0)
    this.setData({ activeImageIndex: index })
    this.onOpenCropModalAtIndex(index)
  },

  async onThumbLongPress(e) {
    if (this.data.processing) return
    if (this.data.cropModalVisible) return
    const images = this.data.images || []
    if (!images.length) return
    const idx = Math.max(0, Math.min(images.length - 1, Number(e.currentTarget.dataset.index || 0)))

    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null
    const p = this.getTouchPoint(touch)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return

    const layout = await new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this)
      query.select('.grid').boundingClientRect()
      query.selectAll('.img-item').boundingClientRect()
      query.exec((res) => {
        const gridRect = res && res[0]
        const itemRects = (res && res[1]) || []
        resolve({ gridRect, itemRects })
      })
    })

    const gridRect = layout.gridRect
    const itemRects = layout.itemRects
    if (!gridRect || !itemRects || !itemRects.length) return

    const itemW = Number(itemRects[0].width) || 0
    const itemH = Number(itemRects[0].height) || 0
    if (!itemW || !itemH) return

    const top0 = Number(itemRects[0].top) || 0
    let cols = itemRects.filter((r) => Math.abs((Number(r.top) || 0) - top0) < 2).length
    if (!cols) cols = 3

    let gapX = 0
    if (itemRects.length > 1) {
      const r1 = itemRects[1]
      if (r1 && Math.abs((Number(r1.top) || 0) - top0) < 2) {
        gapX = (Number(r1.left) || 0) - (Number(itemRects[0].left) || 0) - itemW
      }
    }
    let gapY = gapX
    if (itemRects.length > cols) {
      const rDown = itemRects[cols]
      if (rDown) {
        gapY = (Number(rDown.top) || 0) - top0 - itemH
      }
    }
    if (!Number.isFinite(gapX)) gapX = 0
    if (!Number.isFinite(gapY)) gapY = gapX

    this._dragLayout = {
      gridLeft: Number(gridRect.left) || 0,
      gridTop: Number(gridRect.top) || 0,
      itemW,
      itemH,
      gapX: Math.max(0, gapX),
      gapY: Math.max(0, gapY),
      cols: Math.max(1, cols),
    }

    const item = images[idx]
    const src = (item && (item.previewPath || item.path)) || ''
    this._suppressTapUntil = Date.now() + 800
    this.setData({
      activeImageIndex: idx,
      dragging: true,
      draggingIndex: idx,
      dragGhostX: p.x - itemW / 2,
      dragGhostY: p.y - itemH / 2,
      dragGhostSrc: src,
      dragItemW: itemW,
      dragItemH: itemH,
    })
  },

  onThumbDragMove(e) {
    if (!this.data.dragging) return
    const images = this.data.images || []
    if (!images.length) return
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null
    const p = this.getTouchPoint(touch)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return

    const layout = this._dragLayout
    if (!layout) return

    const from = Number(this.data.draggingIndex)
    const cellW = layout.itemW + layout.gapX
    const cellH = layout.itemH + layout.gapY
    const relX = p.x - layout.gridLeft
    const relY = p.y - layout.gridTop
    let col = Math.floor(relX / cellW)
    let row = Math.floor(relY / cellH)
    col = Math.max(0, Math.min(layout.cols - 1, col))
    row = Math.max(0, row)
    let to = row * layout.cols + col
    to = Math.max(0, Math.min(images.length - 1, to))

    const patch = {
      dragGhostX: p.x - layout.itemW / 2,
      dragGhostY: p.y - layout.itemH / 2,
    }

    if (Number.isFinite(from) && from >= 0 && from < images.length && to !== from) {
      const next = images.slice()
      const moved = next.splice(from, 1)[0]
      next.splice(to, 0, moved)

      let active = Number(this.data.activeImageIndex) || 0
      if (active === from) active = to
      else if (from < active && active <= to) active -= 1
      else if (to <= active && active < from) active += 1

      patch.images = next
      patch.draggingIndex = to
      patch.activeImageIndex = Math.max(0, Math.min(next.length - 1, active))
    }

    this.setData(patch)
  },

  onThumbDragEnd() {
    if (!this.data.dragging) return
    this._dragLayout = null
    this._suppressTapUntil = Date.now() + 500
    this.setData({
      dragging: false,
      draggingIndex: -1,
      dragGhostSrc: '',
      dragItemW: 0,
      dragItemH: 0,
    })
  },

  onToggleFitMode(e) {
    if (this.data.processing) return
    const index = Number(e.currentTarget.dataset.index || 0)
    const next = this.data.images.slice()
    const target = next[index]
    if (!target) return
    const current = target.fitMode === 'cover' ? 'cover' : 'contain'
    const nextMode = current === 'cover' ? 'contain' : 'cover'
    const nextItem = { ...target, fitMode: nextMode, cropMode: nextMode === 'cover' ? 'cover' : 'contain' }
    if (nextItem.cropConfig) delete nextItem.cropConfig
    if (nextItem.cropRect) delete nextItem.cropRect
    if (nextItem.previewPath) delete nextItem.previewPath
    if (nextItem.thumbKey) delete nextItem.thumbKey
    next[index] = nextItem
    this.setData({ images: next, outPath: '', activeImageIndex: index })
  },

  onSetAllCover() {
    if (this.data.processing) return
    const images = this.data.images || []
    if (!images.length) return
    this.setData({
      images: images.map((x) => {
        const next = { ...x, fitMode: 'cover', cropMode: 'cover' }
        if (next.cropConfig) delete next.cropConfig
        if (next.cropRect) delete next.cropRect
        if (next.previewPath) delete next.previewPath
        if (next.thumbKey) delete next.thumbKey
        return next
      }),
      outPath: '',
    })
  },

  onSetAllContain() {
    if (this.data.processing) return
    const images = this.data.images || []
    if (!images.length) return
    this.setData({
      images: images.map((x) => ({ path: x.path, fitMode: 'contain', cropMode: 'contain' })),
      outPath: '',
    })
  },

  onClearImages() {
    if (this.data.processing) return
    this.setData({
      images: [],
      outPath: '',
      exportSizeText: '',
      activeImageIndex: 0,
      cropModalVisible: false,
      cropTargetIndex: -1,
      cropImagePath: '',
    })
  },

  onDelayChange(e) {
    this.setData({ frameDelayMs: Number(e.detail.value || DEFAULT_FRAME_DELAY_MS) })
  },

  onMaxSidePick(e) {
    this.setData({ maxSideIndex: Number(e.detail.value || 0) }, () => this.updateExportSizeText())
  },

  onAspectPick(e) {
    this.setData({ aspectIndex: Number(e.detail.value || 0) }, () => {
      this.updateExportSizeText()
      this.updateBadgeAspectText()
    })
  },

  noop() {},

  updateBadgeAspectText() {
    const selected = ASPECT_OPTIONS[this.data.aspectIndex]
    const v = selected ? selected.value : 0
    if (v && v > 0 && Number.isFinite(v)) {
      const label = this.data.aspectLabels && this.data.aspectLabels[this.data.aspectIndex]
      this.setData({ badgeAspectText: label ? ` ${label}` : '' })
      return
    }
    if (this.data.badgeAspectText) this.setData({ badgeAspectText: '' })
  },

  async onOpenCropModalAtIndex(idx) {
    if (this.data.processing) return
    const images = this.data.images || []
    if (!images.length) return
    const index = Math.max(0, Math.min(images.length - 1, Number(idx || 0)))

    if (!this._cropSessionBackup) {
      this._cropSessionBackup = images.map((x) => ({
        path: x.path,
        fitMode: x.fitMode,
        cropMode: x.cropMode,
        previewPath: x.previewPath,
        thumbKey: x.thumbKey,
        cropConfig: x.cropConfig ? { ...x.cropConfig } : undefined,
      }))
    }

    await this.openCropModalForIndex(index)
  },

  async onOpenCropModal() {
    const idx = Math.max(0, Math.min((this.data.images || []).length - 1, Number(this.data.activeImageIndex || 0)))
    await this.onOpenCropModalAtIndex(idx)
  },

  onCancelCropModal() {
    if (this._cropSessionBackup) {
      this.setData({ images: this._cropSessionBackup, outPath: '' })
    }
    this._cropSessionBackup = null
    this.setData({ cropModalVisible: false, cropTargetIndex: -1, cropImagePath: '' })
  },

  clamp(n, min, max) {
    const v = Number(n)
    if (!Number.isFinite(v)) return min
    if (v < min) return min
    if (v > max) return max
    return v
  },

  getSelectedAspectValue() {
    const selected = ASPECT_OPTIONS[this.data.aspectIndex]
    const v = selected ? selected.value : 0
    if (v && v > 0 && Number.isFinite(v)) return v
    return 0
  },

  clampCropBoxPosition(x, y, boxW, boxH, disp) {
    const dx = disp && Number.isFinite(Number(disp.x)) ? Number(disp.x) : Number(this.data.cropDispX) || 0
    const dy = disp && Number.isFinite(Number(disp.y)) ? Number(disp.y) : Number(this.data.cropDispY) || 0
    const dw = disp && Number.isFinite(Number(disp.w)) ? Number(disp.w) : Number(this.data.cropDispW) || 0
    const dh = disp && Number.isFinite(Number(disp.h)) ? Number(disp.h) : Number(this.data.cropDispH) || 0

    const minX = dx
    const minY = dy
    const maxX = Math.max(minX, dx + dw - boxW)
    const maxY = Math.max(minY, dy + dh - boxH)

    return {
      x: this.clamp(x, minX, maxX),
      y: this.clamp(y, minY, maxY),
    }
  },

  fitCropBoxSize(boxW, boxH, isFree, aspect, dispW, dispH, minSize) {
    const minW = Math.max(1, Number(minSize) || 1)
    const minH = Math.max(1, Number(minSize) || 1)
    const maxW = Math.max(1, Number(dispW) || 1)
    const maxH = Math.max(1, Number(dispH) || 1)
    const a = Math.max(0.0001, Number(aspect) || 1)

    let w = Math.max(minW, Number(boxW) || minW)
    let h = Math.max(minH, Number(boxH) || minH)

    if (isFree) {
      w = Math.min(maxW, w)
      h = Math.min(maxH, h)
      return { w, h }
    }

    w = Math.max(minW, w)
    h = Math.max(minH, h)

    if (w > maxW) {
      w = maxW
      h = w / a
    }
    if (h > maxH) {
      h = maxH
      w = h * a
    }

    if (w < minW) {
      w = minW
      h = w / a
    }
    if (h < minH) {
      h = minH
      w = h * a
    }

    if (w > maxW) {
      w = maxW
      h = w / a
    }
    if (h > maxH) {
      h = maxH
      w = h * a
    }

    return { w, h }
  },

  async openCropModalForIndex(idx) {
    const images = this.data.images || []
    const target = images[idx]
    if (!target || !target.path) return

    const info = await new Promise((resolve) => {
      wx.getImageInfo({
        src: target.path,
        success: resolve,
        fail: () => resolve({ width: 0, height: 0 }),
      })
    })
    const iw = Number(info && info.width) || 0
    const ih = Number(info && info.height) || 0
    if (!iw || !ih) {
      wx.showToast({ title: '读取图片失败', icon: 'none' })
      return
    }

    const sys = wx.getSystemInfoSync()
    const viewW = Math.max(260, Math.floor((sys.windowWidth || 375) - 48))
    const viewH = Math.max(320, Math.floor((sys.windowHeight || 667) * 0.56))

    const fitScale = Math.min(viewW / iw, viewH / ih)
    const dispW = Math.max(1, Math.round(iw * fitScale))
    const dispH = Math.max(1, Math.round(ih * fitScale))
    const dispX = Math.round((viewW - dispW) / 2)
    const dispY = Math.round((viewH - dispH) / 2)

    const selectedAspect = this.getSelectedAspectValue()
    const isFree = (ASPECT_OPTIONS[this.data.aspectIndex] && ASPECT_OPTIONS[this.data.aspectIndex].value) === -1
    const aspect = selectedAspect || (iw / ih)
    const minSize = 44

    let baseW = dispW
    let baseH = dispH
    if (!isFree) {
      baseW = Math.min(dispW, Math.round(dispH * aspect))
      baseH = Math.max(1, Math.round(baseW / aspect))
    }

    const normalizeCropConfig = (cc) => {
      if (!cc) return null
      const x = Number(cc.x)
      const y = Number(cc.y)
      const width = Number(cc.width)
      const height = Number(cc.height)
      if (![x, y, width, height].every(Number.isFinite)) return null
      if (width <= 0 || height <= 0) return null

      const clamp01 = (n) => Math.max(0, Math.min(1, n))
      const nx = clamp01(x)
      const ny = clamp01(y)
      let nw = clamp01(width)
      let nh = clamp01(height)
      nw = Math.min(nw, 1 - nx)
      nh = Math.min(nh, 1 - ny)
      if (nw <= 0 || nh <= 0) return null
      return { x: nx, y: ny, width: nw, height: nh }
    }

    const saved = normalizeCropConfig(target.cropConfig)
    const hasSaved = !!saved

    let boxW = 0
    let boxH = 0
    let boxX = 0
    let boxY = 0

    if (hasSaved) {
      boxX = dispX + Math.round(saved.x * dispW)
      boxY = dispY + Math.round(saved.y * dispH)
      boxW = Math.max(1, Math.round(saved.width * dispW))
      boxH = Math.max(1, Math.round(saved.height * dispH))
    } else {
      if (isFree) {
        boxW = Math.max(minSize, Math.round(baseW))
        boxH = Math.max(minSize, Math.round(baseH))
      } else {
        const dispAspect = dispW / dispH
        if (dispAspect >= aspect) {
          boxH = Math.max(minSize, Math.round(dispH))
          boxW = Math.max(minSize, Math.round(boxH * aspect))
        } else {
          boxW = Math.max(minSize, Math.round(dispW))
          boxH = Math.max(minSize, Math.round(boxW / aspect))
        }
      }
      boxX = dispX + Math.round((dispW - boxW) / 2)
      boxY = dispY + Math.round((dispH - boxH) / 2)
    }

    if (!isFree) {
      boxH = Math.max(minSize, Math.round(boxW / aspect))
      boxW = Math.max(minSize, Math.round(boxH * aspect))
    }

    const fitted = this.fitCropBoxSize(boxW, boxH, isFree, aspect, dispW, dispH, minSize)
    boxW = Math.round(fitted.w)
    boxH = Math.round(fitted.h)

    if (!hasSaved) {
      boxX = dispX + Math.round((dispW - boxW) / 2)
      boxY = dispY + Math.round((dispH - boxH) / 2)
    }

    const clamped = this.clampCropBoxPosition(boxX, boxY, boxW, boxH, { x: dispX, y: dispY, w: dispW, h: dispH })

    this.setData({
      cropModalVisible: true,
      cropTargetIndex: idx,
      cropImagePath: target.path,
      cropViewW: viewW,
      cropViewH: viewH,
      cropNaturalW: iw,
      cropNaturalH: ih,
      cropFitScale: fitScale,
      cropDispX: dispX,
      cropDispY: dispY,
      cropDispW: dispW,
      cropDispH: dispH,
      cropAspect: aspect,
      cropIsFree: isFree,
      cropBoxW: boxW,
      cropBoxH: boxH,
      cropBoxX: clamped.x,
      cropBoxY: clamped.y,
    })
  },

  onCropBoxMove(e) {
    if (!e || !e.detail) return
    const source = e.detail.source
    if (source !== 'touch' && source !== 'touch-out-of-bounds') return
    const x = Number(e.detail.x)
    const y = Number(e.detail.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const boxW = Number(this.data.cropBoxW) || 0
    const boxH = Number(this.data.cropBoxH) || 0
    const clamped = this.clampCropBoxPosition(x, y, boxW, boxH)
    this.setData({ cropBoxX: clamped.x, cropBoxY: clamped.y })
  },

  applyCropToIndex(idx) {
    const images = this.data.images || []
    if (idx < 0 || idx >= images.length) return null

    const fitScale = Number(this.data.cropFitScale) || 1
    const dispX = Number(this.data.cropDispX) || 0
    const dispY = Number(this.data.cropDispY) || 0
    const iw = Number(this.data.cropNaturalW) || 0
    const ih = Number(this.data.cropNaturalH) || 0
    if (!iw || !ih || !fitScale) return null

    const boxX = Number(this.data.cropBoxX) || 0
    const boxY = Number(this.data.cropBoxY) || 0
    const boxW = Number(this.data.cropBoxW) || 0
    const boxH = Number(this.data.cropBoxH) || 0
    if (!boxW || !boxH) return null

    const nx = this.clamp((boxX - dispX) / (iw * fitScale), 0, 1)
    const ny = this.clamp((boxY - dispY) / (ih * fitScale), 0, 1)
    const nw = this.clamp(boxW / (iw * fitScale), 0, 1)
    const nh = this.clamp(boxH / (ih * fitScale), 0, 1)

    const next = images.slice()
    const target = next[idx]
    next[idx] = {
      ...target,
      fitMode: 'cover',
      cropMode: 'custom',
      cropConfig: { x: nx, y: ny, width: nw, height: nh },
    }
    this.setData({ images: next, outPath: '' })
    return next[idx]
  },

  async ensurePreviewThumbForIndex(idx, item) {
    const images = this.data.images || []
    if (idx < 0 || idx >= images.length) return
    const target = item || images[idx]
    if (!target || !target.path) return

    const isCustom = (target.cropMode === 'custom' || !!target.cropConfig) && target.fitMode === 'cover'
    if (!isCustom || !target.cropConfig) {
      if (images[idx] && (images[idx].previewPath || images[idx].thumbKey)) {
        const next = images.slice()
        const nextItem = { ...next[idx] }
        if (nextItem.previewPath) delete nextItem.previewPath
        if (nextItem.thumbKey) delete nextItem.thumbKey
        next[idx] = nextItem
        await this.setDataAsync({ images: next })
      }
      return
    }

    const key = `${target.path}|${target.cropMode}|${target.fitMode}|${JSON.stringify(target.cropConfig)}`
    if (images[idx] && images[idx].thumbKey === key && images[idx].previewPath) return
    if (!this.canvas || !this.ctx) return

    const info = await new Promise((resolve) => {
      wx.getImageInfo({
        src: target.path,
        success: resolve,
        fail: () => resolve({ width: 0, height: 0 }),
      })
    })
    const iw = Number(info && info.width) || 0
    const ih = Number(info && info.height) || 0
    if (!iw || !ih) return

    const canvas = this.canvas
    const ctx = this.ctx
    const size = 240
    canvas.width = size
    canvas.height = size

    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)

    const img = canvas.createImage()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = target.path
    })

    const clamp01 = (n) => {
      const v = Number(n)
      if (!Number.isFinite(v)) return 0
      if (v < 0) return 0
      if (v > 1) return 1
      return v
    }
    const cc = target.cropConfig
    const x = clamp01(cc.x)
    const y = clamp01(cc.y)
    const w = clamp01(cc.width)
    const h = clamp01(cc.height)

    const sx = Math.max(0, Math.min(iw - 1, Math.round(x * iw)))
    const sy = Math.max(0, Math.min(ih - 1, Math.round(y * ih)))
    const sw = Math.max(1, Math.min(iw - sx, Math.round(Math.min(1 - x, w) * iw)))
    const sh = Math.max(1, Math.min(ih - sy, Math.round(Math.min(1 - y, h) * ih)))
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)

    const previewPath = await new Promise((resolve) => {
      wx.canvasToTempFilePath(
        {
          canvas,
          width: size,
          height: size,
          destWidth: size,
          destHeight: size,
          fileType: 'jpg',
          quality: 0.92,
          success: (res) => resolve(res.tempFilePath),
          fail: () => resolve(''),
        },
        this
      )
    })
    if (!previewPath) return

    const next = (this.data.images || []).slice()
    if (!next[idx]) return
    next[idx] = { ...next[idx], previewPath, thumbKey: key }
    await this.setDataAsync({ images: next })
  },

  async onCropPrev() {
    const idx = Number(this.data.cropTargetIndex)
    if (!Number.isFinite(idx) || idx <= 0) return
    const item = this.applyCropToIndex(idx)
    if (item) await this.ensurePreviewThumbForIndex(idx, item)
    await this.openCropModalForIndex(idx - 1)
  },

  async onCropNext() {
    const idx = Number(this.data.cropTargetIndex)
    const images = this.data.images || []
    if (!Number.isFinite(idx) || idx >= images.length - 1) return
    const item = this.applyCropToIndex(idx)
    if (item) await this.ensurePreviewThumbForIndex(idx, item)
    await this.openCropModalForIndex(idx + 1)
  },

  async onConfirmCropModal() {
    const idx = Number(this.data.cropTargetIndex)
    if (Number.isFinite(idx) && idx >= 0) {
      const item = this.applyCropToIndex(idx)
      if (item) await this.ensurePreviewThumbForIndex(idx, item)
      this.setData({ activeImageIndex: idx })
    }
    this._cropSessionBackup = null
    this.setData({ cropModalVisible: false, cropTargetIndex: -1, cropImagePath: '' })
  },

  getTouchPoint(touch) {
    const x = Number(touch && touch.clientX)
    const y = Number(touch && touch.clientY)
    return { x, y }
  },

  distance(a, b) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  },

  onCropTouchStart(e) {
    if (!e) return
    const touches = e.touches || []
    const handle = e.target && e.target.dataset ? e.target.dataset.handle : ''

    const boxX = Number(this.data.cropBoxX) || 0
    const boxY = Number(this.data.cropBoxY) || 0
    const boxW = Number(this.data.cropBoxW) || 0
    const boxH = Number(this.data.cropBoxH) || 0
    const isFree = !!this.data.cropIsFree
    const aspect = Number(this.data.cropAspect) || 1

    if (touches.length >= 2) {
      const p0 = this.getTouchPoint(touches[0])
      const p1 = this.getTouchPoint(touches[1])
      const center = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
      this._cropGesture = {
        type: 'pinch',
        startDist: this.distance(p0, p1),
        startBox: { x: boxX, y: boxY, w: boxW, h: boxH },
        center,
        isFree,
        aspect,
      }
      return
    }

    const p = this.getTouchPoint(touches[0])
    this._cropGesture = {
      type: handle ? 'resize' : 'move',
      handle: handle || '',
      startPt: p,
      startBox: { x: boxX, y: boxY, w: boxW, h: boxH },
      isFree,
      aspect,
    }
  },

  onCropTouchMove(e) {
    const g = this._cropGesture
    if (!g || !e) return
    const touches = e.touches || []
    if (!touches.length) return

    const dispX = Number(this.data.cropDispX) || 0
    const dispY = Number(this.data.cropDispY) || 0
    const dispW = Number(this.data.cropDispW) || 0
    const dispH = Number(this.data.cropDispH) || 0
    const minSize = 44

    let nextX = g.startBox.x
    let nextY = g.startBox.y
    let nextW = g.startBox.w
    let nextH = g.startBox.h

    if (g.type === 'pinch' && touches.length >= 2) {
      const p0 = this.getTouchPoint(touches[0])
      const p1 = this.getTouchPoint(touches[1])
      const dist = this.distance(p0, p1)
      if (!g.startDist) return
      const scale = Math.max(0.2, Math.min(6, dist / g.startDist))
      const cx = g.startBox.x + g.startBox.w / 2
      const cy = g.startBox.y + g.startBox.h / 2
      if (g.isFree) {
        nextW = Math.max(minSize, g.startBox.w * scale)
        nextH = Math.max(minSize, g.startBox.h * scale)
      } else {
        nextW = Math.max(minSize, g.startBox.w * scale)
        nextH = Math.max(minSize, nextW / g.aspect)
      }
      nextX = cx - nextW / 2
      nextY = cy - nextH / 2
    } else {
      const p = this.getTouchPoint(touches[0])
      const dx = p.x - g.startPt.x
      const dy = p.y - g.startPt.y

      if (g.type === 'move') {
        nextX = g.startBox.x + dx
        nextY = g.startBox.y + dy
      } else if (g.type === 'resize') {
        const right0 = g.startBox.x + g.startBox.w
        const bottom0 = g.startBox.y + g.startBox.h
        const center0 = { x: g.startBox.x + g.startBox.w / 2, y: g.startBox.y + g.startBox.h / 2 }

        const applyLockedCorner = (newLeft, newTop, fixedRight, fixedBottom) => {
          let w = fixedRight - newLeft
          let h = fixedBottom - newTop
          w = Math.max(minSize, w)
          h = Math.max(minSize, h)
          if (!g.isFree) {
            const hFromW = w / g.aspect
            const wFromH = h * g.aspect
            if (hFromW <= h) {
              h = Math.max(minSize, hFromW)
            } else {
              w = Math.max(minSize, wFromH)
            }
          }
          return { x: fixedRight - w, y: fixedBottom - h, w, h }
        }

        const applyLockedCornerFromRightTop = (fixedLeft, newTop, newRight, fixedBottom) => {
          let w = newRight - fixedLeft
          let h = fixedBottom - newTop
          w = Math.max(minSize, w)
          h = Math.max(minSize, h)
          if (!g.isFree) {
            const hFromW = w / g.aspect
            const wFromH = h * g.aspect
            if (hFromW <= h) {
              h = Math.max(minSize, hFromW)
            } else {
              w = Math.max(minSize, wFromH)
            }
          }
          return { x: fixedLeft, y: fixedBottom - h, w, h }
        }

        const applyLockedCornerFromLeftBottom = (newLeft, fixedTop, fixedRight, newBottom) => {
          let w = fixedRight - newLeft
          let h = newBottom - fixedTop
          w = Math.max(minSize, w)
          h = Math.max(minSize, h)
          if (!g.isFree) {
            const hFromW = w / g.aspect
            const wFromH = h * g.aspect
            if (hFromW <= h) {
              h = Math.max(minSize, hFromW)
            } else {
              w = Math.max(minSize, wFromH)
            }
          }
          return { x: fixedRight - w, y: fixedTop, w, h }
        }

        const applyLockedCornerFromLeftTop = (fixedLeft, fixedTop, newRight, newBottom) => {
          let w = newRight - fixedLeft
          let h = newBottom - fixedTop
          w = Math.max(minSize, w)
          h = Math.max(minSize, h)
          if (!g.isFree) {
            const hFromW = w / g.aspect
            const wFromH = h * g.aspect
            if (hFromW <= h) {
              h = Math.max(minSize, hFromW)
            } else {
              w = Math.max(minSize, wFromH)
            }
          }
          return { x: fixedLeft, y: fixedTop, w, h }
        }

        if (g.handle === 'tl') {
          const r = applyLockedCorner(g.startBox.x + dx, g.startBox.y + dy, right0, bottom0)
          nextX = r.x; nextY = r.y; nextW = r.w; nextH = r.h
        } else if (g.handle === 'tr') {
          const r = applyLockedCornerFromRightTop(g.startBox.x, g.startBox.y + dy, right0 + dx, bottom0)
          nextX = r.x; nextY = r.y; nextW = r.w; nextH = r.h
        } else if (g.handle === 'bl') {
          const r = applyLockedCornerFromLeftBottom(g.startBox.x + dx, g.startBox.y, right0, bottom0 + dy)
          nextX = r.x; nextY = r.y; nextW = r.w; nextH = r.h
        } else if (g.handle === 'br') {
          const r = applyLockedCornerFromLeftTop(g.startBox.x, g.startBox.y, right0 + dx, bottom0 + dy)
          nextX = r.x; nextY = r.y; nextW = r.w; nextH = r.h
        } else if (g.handle === 'tm') {
          if (g.isFree) {
            nextY = g.startBox.y + dy
            nextH = Math.max(minSize, bottom0 - nextY)
          } else {
            const newTop = g.startBox.y + dy
            let h = Math.max(minSize, bottom0 - newTop)
            let w = Math.max(minSize, h * g.aspect)
            w = Math.min(dispW, w)
            h = w / g.aspect
            nextW = w
            nextH = h
            nextX = center0.x - w / 2
            nextY = bottom0 - h
          }
        } else if (g.handle === 'bm') {
          if (g.isFree) {
            nextH = Math.max(minSize, g.startBox.h + dy)
          } else {
            let h = Math.max(minSize, g.startBox.h + dy)
            let w = Math.max(minSize, h * g.aspect)
            w = Math.min(dispW, w)
            h = w / g.aspect
            nextW = w
            nextH = h
            nextX = center0.x - w / 2
            nextY = g.startBox.y
          }
        } else if (g.handle === 'ml') {
          if (g.isFree) {
            nextX = g.startBox.x + dx
            nextW = Math.max(minSize, right0 - nextX)
          } else {
            const newLeft = g.startBox.x + dx
            let w = Math.max(minSize, right0 - newLeft)
            let h = Math.max(minSize, w / g.aspect)
            h = Math.min(dispH, h)
            w = h * g.aspect
            nextW = w
            nextH = h
            nextX = right0 - w
            nextY = center0.y - h / 2
          }
        } else if (g.handle === 'mr') {
          if (g.isFree) {
            nextW = Math.max(minSize, g.startBox.w + dx)
          } else {
            let w = Math.max(minSize, g.startBox.w + dx)
            let h = Math.max(minSize, w / g.aspect)
            h = Math.min(dispH, h)
            w = h * g.aspect
            nextW = w
            nextH = h
            nextX = g.startBox.x
            nextY = center0.y - h / 2
          }
        }
      }
    }

    if (nextW < minSize) nextW = minSize
    if (nextH < minSize) nextH = minSize

    {
      const fitted = this.fitCropBoxSize(nextW, nextH, !!this.data.cropIsFree, Number(this.data.cropAspect) || 1, dispW, dispH, minSize)
      nextW = fitted.w
      nextH = fitted.h
    }

    const clamped = this.clampCropBoxPosition(nextX, nextY, nextW, nextH)
    nextX = clamped.x
    nextY = clamped.y

    const maxW = dispX + dispW - nextX
    const maxH = dispY + dispH - nextY
    nextW = Math.min(nextW, maxW)
    nextH = Math.min(nextH, maxH)
    if (!this.data.cropIsFree) {
      const aspect = Number(this.data.cropAspect) || 1
      const hFromW = nextW / aspect
      const wFromH = nextH * aspect
      if (hFromW <= nextH) nextH = Math.max(minSize, hFromW)
      else nextW = Math.max(minSize, wFromH)
    }

    const clamped2 = this.clampCropBoxPosition(nextX, nextY, nextW, nextH)
    let finalX = clamped2.x
    let finalY = clamped2.y
    if (Math.abs(finalX - dispX) <= 1.5) finalX = dispX
    if (Math.abs(finalY - dispY) <= 1.5) finalY = dispY
    const bottom = dispY + dispH - nextH
    const right = dispX + dispW - nextW
    if (Math.abs(finalX - right) <= 1.5) finalX = right
    if (Math.abs(finalY - bottom) <= 1.5) finalY = bottom
    this.setData({ cropBoxX: finalX, cropBoxY: finalY, cropBoxW: nextW, cropBoxH: nextH })
  },

  onCropTouchEnd() {
    this._cropGesture = null
  },

  onLoopPick(e) {
    this.setData({ loopIndex: Number(e.detail.value || 0) })
  },

  onQualityChange(e) {
    const checked = !!(e && e.detail && e.detail.value)
    this.setData({ qualityMode: checked ? QUALITY_MODE.HIGH : QUALITY_MODE.STANDARD })
  },

  updateExportSizeText() {
    const images = this.data.images || []
    if (!images.length) {
      if (this.data.exportSizeText) this.setData({ exportSizeText: '' })
      return
    }

    const maxSidePx = MAX_SIDE_OPTIONS[this.data.maxSideIndex] || DEFAULT_GIF_MAX_SIDE_PX
    const src = images[0] && images[0].path
    if (!src) return

    wx.getImageInfo({
      src,
      success: (info) => {
        const w0 = Number(info && info.width) || 0
        const h0 = Number(info && info.height) || 0
        if (!w0 || !h0) return

        const maxDim0 = Math.max(w0, h0)
        const baseLongEdge = Math.min(maxSidePx, maxDim0)
        const aspect = (ASPECT_OPTIONS[this.data.aspectIndex] && ASPECT_OPTIONS[this.data.aspectIndex].value) || 0

        let outW = 0
        let outH = 0
        if (aspect && aspect > 0 && Number.isFinite(aspect)) {
          if (aspect >= 1) {
            outW = baseLongEdge
            outH = Math.max(1, Math.round(outW / aspect))
          } else {
            outH = baseLongEdge
            outW = Math.max(1, Math.round(outH * aspect))
          }
        } else {
          const scale = baseLongEdge / maxDim0
          outW = Math.max(1, Math.round(w0 * scale))
          outH = Math.max(1, Math.round(h0 * scale))
        }

        const note = maxDim0 <= maxSidePx ? '（原图较小不放大）' : ''
        const exportSizeText = `实际输出约：${outW}×${outH}px${note}`
        if (exportSizeText !== this.data.exportSizeText) {
          this.setData({ exportSizeText })
        }
      },
      fail: () => {},
    })
  },

  async onGenerate() {
    if (this.data.processing) return
    if (!this.data.images.length) {
      wx.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }
    if (!this.canvas || !this.ctx) {
      wx.showToast({ title: '画布未就绪，请稍后重试', icon: 'none' })
      return
    }

    const maxSidePx = MAX_SIDE_OPTIONS[this.data.maxSideIndex] || DEFAULT_GIF_MAX_SIDE_PX
    const loop = LOOP_OPTIONS[this.data.loopIndex] ? LOOP_OPTIONS[this.data.loopIndex].value : DEFAULT_GIF_LOOP
    const outAspect = (ASPECT_OPTIONS[this.data.aspectIndex] && ASPECT_OPTIONS[this.data.aspectIndex].value) || 0

    this.setData({ processing: true, progressText: '准备中…', outPath: '' })
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const dither = this.data.qualityMode === QUALITY_MODE.HIGH
      const { outPath } = await convertImagesToGif({
        images: this.data.images,
        canvas: this.canvas,
        ctx: this.ctx,
        maxSidePx,
        outAspect,
        frameDelayMs: this.data.frameDelayMs,
        loop,
        dither,
        onProgress: ({ step, index, total }) => {
          this.setData({ progressText: `${step} ${index}/${total}` })
        },
      })
      wx.hideLoading()
      this.setData({ outPath, processing: false, progressText: '' })
      wx.showToast({ title: '生成成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ processing: false, progressText: '' })
      wx.showModal({
        title: '生成失败',
        content: (e && e.message) ? e.message : '生成失败，请重试',
        showCancel: false,
      })
    }
  },

  async onSave() {
    const filePath = this.data.outPath
    if (!filePath) return
    try {
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject,
        })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      wx.showModal({
        title: '保存失败',
        content: '请检查相册权限后重试',
        showCancel: false,
      })
    }
  },
})
