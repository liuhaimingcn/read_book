import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { io } from 'socket.io-client'
import { safeJson } from '../utils/api'
import { useVoiceCall } from '../hooks/useVoiceCall'

function renderWithHighlights(content, highlights) {
  if (!content) return []
  if (!highlights?.length) return [{ type: 'text', text: content }]
  const sorted = [...highlights].sort((a, b) => a.start - b.start)
  const parts = []
  let lastEnd = 0
  for (const h of sorted) {
    if (h.start > lastEnd) {
      parts.push({ type: 'text', text: content.slice(lastEnd, h.start) })
    }
    if (h.end > h.start) {
      parts.push({ type: h.type, text: content.slice(h.start, h.end) })
    }
    lastEnd = Math.max(lastEnd, h.end)
  }
  if (lastEnd < content.length) {
    parts.push({ type: 'text', text: content.slice(lastEnd) })
  }
  return parts
}

export default function Room() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [book, setBook] = useState(null)
  const [content, setContent] = useState('')
  const [highlights, setHighlights] = useState([])
  const [selectionPopover, setSelectionPopover] = useState(null)
  const contentRef = useRef(null)
  const contentTextRef = useRef(null)
  const [currentPage, setCurrentPage] = useState(1)
  const currentPageRef = useRef(1)
  currentPageRef.current = currentPage
  const [totalPages, setTotalPages] = useState(0)
  const [readerStates, setReaderStates] = useState({})
  const [myReady, setMyReady] = useState(false)
  const [socket, setSocket] = useState(null)
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const {
    status: voiceStatus,
    errorMsg: voiceError,
    muted,
    startCall,
    endCall,
    toggleMute,
    VOICE_STATUS,
  } = useVoiceCall(socket, roomId, peerCount >= 2)

  const fetchPage = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/page`)
      if (!res.ok) throw new Error('获取失败')
      const data = await safeJson(res)
      setContent(data.content)
      setHighlights(data.highlights || [])
      setCurrentPage(data.currentPage)
      setTotalPages(data.totalPages)
      setReaderStates(data.readerStates || {})
    } catch (err) {
      setError(err.message)
    }
  }, [roomId])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}`)
        if (!res.ok) throw new Error('房间不存在')
        const data = await safeJson(res)
        setBook(data.book)
        setCurrentPage(data.currentPage)
        setTotalPages(data.book.totalPages)
      } catch (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      await fetchPage()
      setLoading(false)
    }
    load()
  }, [roomId, fetchPage])

  useEffect(() => {
    const jumpTo = location.state?.jumpToPage
    if (jumpTo && !loading && totalPages > 0 && jumpTo >= 1 && jumpTo <= totalPages) {
      setCurrentPage(jumpTo)
      navigate(`/room/${roomId}`, { replace: true, state: {} })
    }
  }, [location.state?.jumpToPage, loading, totalPages, roomId, navigate])

  useEffect(() => {
    const s = io({ path: '/socket.io' })
    setSocket(s)
    return () => s.disconnect()
  }, [])

  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    const text = sel?.toString()?.trim()
    const container = contentTextRef.current || contentRef.current
    if (!container) return
    if (!text) {
      setSelectionPopover(null)
      return
    }
    try {
      const range = sel.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) {
        setSelectionPopover(null)
        return
      }
      const pre = document.createRange()
      pre.setStart(container, 0)
      pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const end = start + text.length
      const rect = range.getBoundingClientRect()
      const parentRect = container.getBoundingClientRect()
      setSelectionPopover({
        start,
        end,
        text,
        x: rect.left - parentRect.left + rect.width / 2,
        y: rect.top - parentRect.top - 56,
        rectTop: rect.top,
        rectBottom: rect.bottom,
      })
    } catch {
      setSelectionPopover(null)
    }
  }, [])

  useEffect(() => {
    if (!socket || !roomId) return
    socket.emit('join-room', roomId)
    socket.on('room-joined', (data) => {
      setCurrentPage(data.currentPage)
      setReaderStates(data.readerStates || {})
      if (typeof data.peerCount === 'number') setPeerCount(data.peerCount)
    })
    socket.on('room-peer-update', (data) => {
      if (typeof data.count === 'number') setPeerCount(data.count)
    })
    socket.on('sync-state', (data) => {
      setCurrentPage(data.currentPage)
      setReaderStates(data.readerStates || {})
      setMyReady(!!data.readerStates?.[socket.id])
    })
    socket.on('page-turn', async (data) => {
      setCurrentPage(data.currentPage)
      setReaderStates(data.readerStates || {})
      setMyReady(false)
      await fetchPage()
    })
    socket.on('error', (data) => setError(data.message))
    socket.on('highlights-updated', (data) => {
      if (data.pageIndex === currentPageRef.current - 1) setHighlights(data.highlights || [])
    })
    return () => {
      socket.off('room-joined')
      socket.off('room-peer-update')
      socket.off('sync-state')
      socket.off('page-turn')
      socket.off('error')
      socket.off('highlights-updated')
    }
  }, [socket, roomId, fetchPage])

  useEffect(() => {
    let timer
    const onSelectionChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
          checkSelection()
        }
      }, 200)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [checkSelection])

  useEffect(() => {
    const closePopover = (e) => {
      if (!e.target.closest('.highlight-popover')) setSelectionPopover(null)
    }
    const closeOnTouch = (e) => {
      if (!e.target.closest('.highlight-popover')) setSelectionPopover(null)
    }
    if (selectionPopover) {
      setTimeout(() => {
        document.addEventListener('click', closePopover)
        document.addEventListener('touchend', closeOnTouch, { passive: true })
      }, 0)
      return () => {
        document.removeEventListener('click', closePopover)
        document.removeEventListener('touchend', closeOnTouch)
      }
    }
  }, [selectionPopover])

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [currentPage])

  useEffect(() => {
    if (currentPage && totalPages) {
      fetch(`/api/rooms/${roomId}/page?page=${currentPage}`)
        .then((r) => safeJson(r))
        .then((d) => {
          setContent(d?.content ?? '')
          setHighlights(d?.highlights ?? [])
        })
        .catch(() => {})
    }
  }, [currentPage, totalPages, roomId])

  const releaseRoom = async () => {
    if (!confirm('确定释放房间？释放后房间将永久删除，其他人将无法继续阅读。')) return
    try {
      await fetch(`/api/rooms/${roomId}/release`, { method: 'POST' })
      navigate('/')
    } catch (_) {
      navigate('/')
    }
  }

  const handleContentMouseUp = () => {
    checkSelection()
  }

  const handleContentTouchEnd = () => {
    setTimeout(checkSelection, 400)
  }

  const addHighlight = async (type) => {
    if (!selectionPopover) return
    const { start, end } = selectionPopover
    setSelectionPopover(null)
    window.getSelection()?.removeAllRanges()
    try {
      const res = await fetch(`/api/rooms/${roomId}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          pageIndex: currentPage - 1,
          start,
          end,
        }),
      })
      if (res.ok) {
        const data = await safeJson(res)
        setHighlights(data.highlights || [])
      }
    } catch (_) {}
  }

  const handleReady = () => {
    if (!socket || myReady) return
    socket.emit('reader-ready')
    setMyReady(true)
  }

  const otherReadyCount = Object.keys(readerStates).filter(
    (id) => id !== socket?.id
  ).length
  const allReady = myReady && otherReadyCount >= 1
  const isLastPage = currentPage >= totalPages && totalPages > 0

  if (loading) return <div className="room loading">加载中...</div>
  if (error) {
    return (
      <div className="room error">
        <p>{error}</p>
        <button onClick={() => navigate('/')}>返回首页</button>
      </div>
    )
  }

  return (
    <div className="room">
      <header className="room-header">
        <button className="back" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <div className="title-row">
          <h1>{book?.name}</h1>
          <span className="page-info">
            第 {currentPage} / {totalPages} 页
          </span>
        </div>
        <div className="room-id-row">
          <span>房间 ID: {roomId}</span>
          <button
            className="copy-btn"
            onClick={() => {
              navigator.clipboard.writeText(
                `${window.location.origin}/room/${roomId}`
              )
            }}
          >
            复制链接
          </button>
          <button className="release-btn" onClick={releaseRoom} title="释放后房间将永久删除">
            释放房间
          </button>
          <button className="copy-btn" onClick={() => navigate(`/room/${roomId}/highlights`)}>
            划线管理
          </button>
        </div>
      </header>

      <main className="content-area" ref={contentRef}>
        <div
          ref={contentTextRef}
          className="content"
          style={{ whiteSpace: 'pre-wrap' }}
          tabIndex={/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 0 : undefined}
          onMouseUp={handleContentMouseUp}
          onTouchEnd={handleContentTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {content ? (
            renderWithHighlights(content, highlights).map((p, i) =>
              p.type === 'text' ? (
                <span key={i}>{p.text}</span>
              ) : (
                <mark
                  key={i}
                  className={p.type === 'word' ? 'highlight-word' : 'highlight-sentence'}
                >
                  {p.text}
                </mark>
              )
            )
          ) : (
            '（本页无内容）'
          )}
        </div>
        {selectionPopover && (
          <div
            className="highlight-popover"
            style={
              /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                ? {
                    position: 'fixed',
                    top: Math.max(60, selectionPopover.rectTop - 80),
                    left: '50%',
                    transform: 'translateX(-50%)',
                  }
                : {
                    position: 'absolute',
                    left: Math.max(0, selectionPopover.x - 60),
                    top: Math.max(0, selectionPopover.y),
                  }
            }
          >
            <button type="button" onClick={(e) => { e.stopPropagation(); addHighlight('word'); }}>
              好词
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); addHighlight('sentence'); }}>
              好句
            </button>
          </div>
        )}
      </main>

      <footer className="room-footer">
        {/* 语音通话 */}
        <div className="voice-call">
          {voiceError && <span className="voice-error">{voiceError}</span>}
          {voiceStatus === VOICE_STATUS.idle && (
            <>
              <button
                className="btn voice-btn"
                onClick={startCall}
                title={peerCount < 2 ? '等待对方加入房间' : '开始语音通话'}
              >
                🎤 开始语音
              </button>
              {peerCount < 2 && (
                <span className="voice-hint">需 2 人在房间（当前 {peerCount}/2）</span>
              )}
            </>
          )}
          {(voiceStatus === VOICE_STATUS.requesting || voiceStatus === VOICE_STATUS.connecting) && (
            <span className="voice-status">正在连接...</span>
          )}
          {voiceStatus === VOICE_STATUS.connected && (
            <div className="voice-controls">
              <button
                className={`btn voice-btn ${muted ? 'muted' : ''}`}
                onClick={toggleMute}
                title={muted ? '取消静音' : '静音'}
              >
                {muted ? '🔇 已静音' : '🔊 静音'}
              </button>
              <button className="btn voice-btn end" onClick={endCall} title="结束通话">
                📞 结束
              </button>
            </div>
          )}
          {voiceStatus === VOICE_STATUS.error && (
            <button className="btn voice-btn" onClick={startCall}>
              重试
            </button>
          )}
        </div>

        {isLastPage ? (
          <p className="done">🎉 恭喜，你们已经读完这本书！</p>
        ) : (
          <>
            <div className="status">
              {myReady ? '✅ 你已读完' : '⏳ 等待你点击读完了'}
              {otherReadyCount >= 1 ? ' · 对方已读完' : ' · 等待对方...'}
            </div>
            <button
              className="btn ready-btn"
              onClick={handleReady}
              disabled={myReady}
            >
              {myReady ? '已读完' : '读完了'}
            </button>
          </>
        )}
      </footer>
    </div>
  )
}
