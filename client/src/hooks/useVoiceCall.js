import { useState, useCallback, useRef, useEffect } from 'react'
import SimplePeer from 'simple-peer'

const VOICE_STATUS = {
  idle: 'idle',           // 未开始
  requesting: 'requesting', // 请求麦克风
  connecting: 'connecting', // 连接中
  connected: 'connected',   // 已连接
  error: 'error',
}

export function useVoiceCall(socket, roomId, otherInRoom) {
  const [status, setStatus] = useState(VOICE_STATUS.idle)
  const [errorMsg, setErrorMsg] = useState('')
  const [muted, setMuted] = useState(false)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)

  const cleanup = useCallback(() => {
    if (peerRef.current) {
      try { peerRef.current.destroy() } catch (_) {}
      peerRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    const audio = remoteAudioRef.current
    if (audio) {
      audio.srcObject = null
      audio.remove()
      remoteAudioRef.current = null
    }
  }, [])

  const startCall = useCallback(async () => {
    if (!socket || !roomId || !otherInRoom) {
      setErrorMsg('请等待对方加入房间')
      setStatus(VOICE_STATUS.error)
      return
    }
    setErrorMsg('')
    setStatus(VOICE_STATUS.requesting)
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('UNSUPPORTED')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
      setStatus(VOICE_STATUS.connecting)

      const peer = new SimplePeer({
        initiator: true,
        trickle: true,
        stream,
      })

      peer.on('signal', (data) => {
        socket?.emit('voice-signal', { signal: data })
      })
        peer.on('stream', (remoteStream) => {
          const audio = document.createElement('audio')
          audio.autoplay = true
          audio.playsInline = true
          audio.srcObject = remoteStream
          audio.style.display = 'none'
          document.body.appendChild(audio)
          remoteAudioRef.current = audio
        })
      peer.on('connect', () => setStatus(VOICE_STATUS.connected))
      peer.on('error', (err) => {
        setErrorMsg(err.message || '连接失败')
        setStatus(VOICE_STATUS.error)
      })
      peer.on('close', () => {
        setStatus(VOICE_STATUS.idle)
        cleanup()
      })

      peerRef.current = peer
    } catch (err) {
      let msg = '无法获取麦克风权限'
      if (err?.message === 'UNSUPPORTED') {
        msg = '当前环境不支持语音通话，请使用 HTTPS 或 localhost 访问'
      } else if (err?.name === 'NotAllowedError' || /permission denied/i.test(err?.message || '')) {
        msg = '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风后重试'
      } else if (err?.message) {
        msg = err.message
      }
      setErrorMsg(msg)
      setStatus(VOICE_STATUS.error)
    }
  }, [socket, roomId, otherInRoom, cleanup])

  const endCall = useCallback(() => {
    cleanup()
    setStatus(VOICE_STATUS.idle)
    setErrorMsg('')
  }, [cleanup])

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return
    const currentlyEnabled = localStreamRef.current.getAudioTracks()[0]?.enabled ?? true
    const newEnabled = !currentlyEnabled
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = newEnabled })
    setMuted(!newEnabled)
  }, [])

  // 接收对方发来的信令（作为被呼叫方创建 peer，或转发 ICE/answer 给已有 peer）
  useEffect(() => {
    if (!socket) return
    const onSignal = async ({ signal }) => {
      if (peerRef.current) {
        peerRef.current.signal(signal)
        return
      }
      setStatus(VOICE_STATUS.requesting)
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          throw new Error('UNSUPPORTED')
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        localStreamRef.current = stream
        setStatus(VOICE_STATUS.connecting)

        const peer = new SimplePeer({
          initiator: false,
          trickle: true,
          stream,
        })

        peer.on('signal', (data) => {
          socket.emit('voice-signal', { signal: data })
        })
        peer.on('stream', (remoteStream) => {
          const audio = document.createElement('audio')
          audio.autoplay = true
          audio.playsInline = true
          audio.srcObject = remoteStream
          audio.style.display = 'none'
          document.body.appendChild(audio)
          remoteAudioRef.current = audio
        })
        peer.on('connect', () => setStatus(VOICE_STATUS.connected))
        peer.on('error', (err) => {
          setErrorMsg(err.message || '连接失败')
          setStatus(VOICE_STATUS.error)
        })
        peer.on('close', () => {
          setStatus(VOICE_STATUS.idle)
          cleanup()
        })

        peer.signal(signal)
        peerRef.current = peer
      } catch (err) {
        let msg = '无法获取麦克风权限'
        if (err?.message === 'UNSUPPORTED') {
          msg = '当前环境不支持语音通话，请使用 HTTPS 或 localhost 访问'
        } else if (err?.name === 'NotAllowedError' || /permission denied/i.test(err?.message || '')) {
          msg = '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风后重试'
        } else if (err?.message) {
          msg = err.message
        }
        setErrorMsg(msg)
        setStatus(VOICE_STATUS.error)
      }
    }
    socket.on('voice-signal', onSignal)
    return () => socket.off('voice-signal', onSignal)
  }, [socket, cleanup])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    status,
    errorMsg,
    muted,
    startCall,
    endCall,
    toggleMute,
    VOICE_STATUS,
  }
}
