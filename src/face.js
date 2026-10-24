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

// ~0.5 = looking straight. >0.62 = user turned to THEIR left, <0.38 = THEIR right
export function yawRatio(landmarks) {
  const jaw = landmarks.getJawOutline()
  const nose = landmarks.getNose()
  const tip = nose[3]
  const left = jaw[0].x
  const right = jaw[16].x
  return (tip.x - left) / (right - left)
}

// Downscale a phone photo to max `max` px, return a JPEG blob + the canvas
export async function resizeImage(file, max = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
  return { blob, canvas }
}
