import React, { useEffect, useRef, useState } from 'react'
import { detectOne, yawRatio, loadModels } from './face.js'

// Live camera only (no uploads). Asks for a random head turn so a held-up photo fails.
// Calls onDone(descriptors[]) with 2-3 frontal descriptors once the user passes.
export default function LiveCheck({ onDone, onCancel }) {
  const videoRef = useRef(null)
  const [msg, setMsg] = useState('Starting camera…')
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    let stream
    const challenge = Math.random() < 0.5 ? 'left' : 'right'

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

        const frontal = []
        let turned = false
        const started = Date.now()

        while (!stop) {
          if (Date.now() - started > 45000) throw new Error('Timed out. Please try again.')
          const det = await detectOne(v)
          if (!det) { setMsg('Show your face to the camera'); continue }
          const r = yawRatio(det.landmarks)

          if (frontal.length < 2) {
            if (r > 0.42 && r < 0.58) {
              frontal.push(Array.from(det.descriptor))
              setMsg('Hold still…')
              await new Promise((s) => setTimeout(s, 400))
            } else setMsg('Look straight at the camera')
          } else if (!turned) {
            setMsg(`Now slowly turn your head to your ${challenge.toUpperCase()}`)
            if (challenge === 'left' ? r > 0.62 : r < 0.38) turned = true
          } else {
            setMsg('Look straight again')
            if (r > 0.42 && r < 0.58) {
              frontal.push(Array.from(det.descriptor))
              stream.getTracks().forEach((t) => t.stop())
              onDone(frontal)
              return
            }
          }
        }
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
      {error && <button onClick={() => window.location.reload()}>Retry</button>}
      <button className="ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}
