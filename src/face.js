import * as faceapi from '@vladmandic/face-api'

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/'
export const MATCH_THRESHOLD = 0.5

let ready
export function loadModels() {
  if (!ready) {
    ready = Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
  }
  return ready
}

const opts = () => new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })

export const detectAll = (input) =>
  faceapi.detectAllFaces(input, opts()).withFaceLandmarks().withFaceDescriptors()

export const detectOne = (input) =>
  faceapi.detectSingleFace(input, opts()).withFaceLandmarks().withFaceDescriptor()

export const distance = (a, b) => faceapi.euclideanDistance(a, b)

// about 0.5 = looking straight. >0.62 = user turned to THEIR left, <0.38 = THEIR right
export function yawRatio(landmarks) {
  const jaw = landmarks.getJawOutline()
  const nose = landmarks.getNose()
  const tip = nose[3]
  const left = jaw[0].x
  const right = jaw[16].x
  return (tip.x - left) / (right - left)
}

// Try several ways to open a photo, because phones are picky
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch (e) {}
  try { return await createImageBitmap(file) } catch (e) {}
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch (e) {
    const mb = (file.size / 1048576).toFixed(1)
    throw new Error('Cannot read this photo (type: ' + (file.type || 'unknown') + ', ' + mb + ' MB). Try a normal JPG or PNG.')
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}

// Downscale a phone photo to max `max` px, return a JPEG blob + the canvas
export async function resizeImage(file, max = 1600, quality = 0.82) {
  const src = await decodeImage(file)
  const w0 = src.naturalWidth || src.width
  const h0 = src.naturalHeight || src.height
  if (!w0 || !h0) throw new Error('Photo has no size')
  const scale = Math.min(1, max / Math.max(w0, h0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w0 * scale)
  canvas.height = Math.round(h0 * scale)
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height)
  if (src.close) src.close()
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not compress this photo')
  return { blob, canvas }
}
