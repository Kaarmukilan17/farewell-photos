import React, { useEffect, useRef, useState } from 'react'
import { detectOne, yawRatio, loadModels } from './face.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Live camera only (no uploads). A head turn is required so a held-up photo fails.
// mode "enroll": first registration, takes several different looks (straight, smile, both sides)
// mode "verify": quick check before a search
export default function LiveCheck({ mode, onDone, onCancel }) {
  const videoRef = useRef(null)
  const [msg, setMsg] = useState('Starting camera...')
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    let stream
    const enroll = mode === 'enroll'
    const side = Math.random() < 0.5 ? 'left' : 'right'
    const other = side === 'left' ? 'right' : 'left'
    const deadline = Date.now() + 100000

    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = 24
    const brightness = (v) => {
      const c = probe.getContext('2d')
      c.drawImage(v, 0, 0, 32, 24)
      const d = c.getImageData(0, 0, 32, 24).data
      let s = 0
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      return s / (d.length / 4)
    }

    // about 0.5 = straight, bigger = turned to your left, smaller = turned to your right
    const poseOk = (pose, r) =>
      pose === 'straight' ? r > 0.4 && r < 0.6 : pose === 'left' ? r > 0.6 : r < 0.4

    // Waits for a good frame in the wanted pose. Quality checks are gentle:
    // after `timeout` the best frame seen is accepted instead of blocking the person.
    async function capture(v, { prompt, pose, wait = 0, timeout = 9000, required = false }) {
      setMsg(prompt)
      setHint('')
      const start = Date.now()
      let fallback = null
      while (!stop) {
        if (Date.now() > deadline) throw new Error('Timed out. Please try again in better light.')
        const det = await detectOne(v)
        if (!det) {
          setHint('Show your face to the camera')
        } else {
          const r = yawRatio(det.landmarks)
          if (poseOk(pose, r)) {
            const big = det.detection.box.width / v.videoWidth >= 0.15
            const lit = brightness(v) >= 35
            setHint(!big ? 'Move a little closer' : !lit ? 'Find a bit more light' : '')
            if (big && lit) {
              if (!wait) return det
              await sleep(wait)
              const d2 = await detectOne(v)
              if (d2 && poseOk(pose, yawRatio(d2.landmarks))) return d2
              continue
            }
            fallback = det
          } else {
            setHint(pose === 'straight' ? 'Look straight at the camera' : 'Turn your head a little more')
          }
        }
        if (Date.now() - start > timeout) {
          if (fallback) return fallback
          if (!required) return null
        }
        await sleep(60)
      }
      return null
    }

    async function run() {
      try {
        await loadModels()
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        })
        const v = videoRef.current
        v.srcObject = stream
        await v.play()

        const frames = []
        const add = (d) => { if (d) frames.push(Array.from(d.descriptor)) }
        const total = enroll ? 5 : 3
        let n = 0
        const say = (t) => 'Step ' + ++n + ' of ' + total + ': ' + t

        add(await capture(v, { prompt: say('Look straight at the camera'), pose: 'straight', required: true }))
        if (enroll) add(await capture(v, { prompt: say('Smile!'), pose: 'straight', wait: 1200, timeout: 7000 }))
        const turned = await capture(v, {
          prompt: say('Slowly turn your head a little to your ' + side.toUpperCase()),
          pose: side,
          required: true,
          timeout: 15000,
        })
        if (enroll) add(turned)
        add(await capture(v, { prompt: say('Look straight again'), pose: 'straight', required: true }))
        if (enroll) {
          add(await capture(v, {
            prompt: say('Now turn a little to your ' + other.toUpperCase()),
            pose: other,
            timeout: 8000,
          }))
        }

        if (stop) return
        stream.getTracks().forEach((t) => t.stop())
        if (!frames.length) throw new Error('Could not capture your face. Please try again.')
        onDone(frames)
      } catch (e) {
        if (!stop) setError(e.message || 'Camera error')
      }
    }
    run()
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="card center">
      <video ref={videoRef} playsInline muted className="mirror" />
      <p className="big">{error || msg}</p>
      {!error && hint && <p className="warn">{hint}</p>}
      {error && <button onClick={() => window.location.reload()}>Retry</button>}
      <button className="ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}
