import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { io } from 'socket.io-client'
import { Document, Page, pdfjs } from 'react-pdf'
import { safeJson } from '../utils/api'

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

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
  const [isPdf, setIsPdf] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfPages, setPdfPages] = useState(false)
  const [pageImageUrl, setPageImageUrl] = useState('')
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchPage = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/page`)
      if (!res.ok) throw new Error('获取失败')
      const data = await safeJson(res)
      setContent(data.content || '')
      setHighlights(data.highlights || [])
      setCurrentPage(data.currentPage)
      setTotalPages(data.totalPages)
      setReaderStates(data.readerStates || {})
      setIsPdf(data.type === 'pdf')
      setPdfUrl(data.pdfUrl ? `${window.location.origin}${data.pdfUrl}` : '')
      setPdfPages(!!data.pdfPages)
      setPageImageUrl(data.pageImageUrl ? `${window.location.origin}${data.pageImageUrl}` : '')
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
        y: rect.top - parentRect.top - 36,
        rectTop: rect.top,
        rectBottom: rect.bottom,
      })
    } catch {
      setSelectionPopover(null)
    }
  }, [])

  useEffect(() => {
    if (!socket || !roomId) return
    const doJoin = () => {
      socket.emit('join-room', roomId)
    }
    if (socket.connected) {
      doJoin()
    } else {
      socket.once('connect', doJoin)
    }
    socket.on('room-joined', (data) => {
      setCurrentPage(data.currentPage)
      setReaderStates(data.readerStates || {})
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
      socket.off('connect', doJoin)
      socket.off('room-joined')
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
    const el = contentRef.current
    if (el) el.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [currentPage, content, isPdf])

  useEffect(() => {
    if (currentPage && totalPages) {
      fetch(`/api/rooms/${roomId}/page?page=${currentPage}`)
        .then((r) => safeJson(r))
        .then((d) => {
          setContent(d?.content ?? '')
          setHighlights(d?.highlights ?? [])
          setIsPdf(d?.type === 'pdf')
          setPdfUrl(d?.pdfUrl ? `${window.location.origin}${d.pdfUrl}` : '')
          setPdfPages(!!d?.pdfPages)
          setPageImageUrl(d?.pageImageUrl ? `${window.location.origin}${d.pageImageUrl}` : '')
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
            onClick={async () => {
              try {
                const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80')
                const res = await fetch(`/api/share-base?clientPort=${port}`)
                const data = await safeJson(res)
                const base = data?.url || window.location.origin
                await navigator.clipboard.writeText(`${base.replace(/\/$/, '')}/room/${roomId}`)
              } catch {
                await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`)
              }
            }}
          >
            复制链接
          </button>
          <button className="release-btn" onClick={releaseRoom} title="释放后房间将永久删除">
            释放房间
          </button>
          {!isPdf && (
            <button className="copy-btn" onClick={() => navigate(`/room/${roomId}/highlights`)}>
              划线管理
            </button>
          )}
        </div>
      </header>

      <main className="content-area" ref={contentRef}>
        {isPdf ? (
          <div className="content pdf-viewer">
            {currentPage >= 1 && totalPages >= 1 ? (
              pdfPages && pageImageUrl ? (
                <img
                  src={pageImageUrl}
                  alt={`第 ${currentPage} 页`}
                  style={{ display: 'block' }}
                />
              ) : pdfUrl ? (
                <Document file={pdfUrl} loading={<div className="pdf-loading">加载中...</div>}>
                  <Page
                    pageNumber={Math.max(1, Math.min(currentPage, totalPages))}
                    width={Math.min(720, Math.max(280, window.innerWidth - 32))}
                    renderTextLayer={false}
                  />
                </Document>
              ) : (
                <div className="pdf-loading">加载中...</div>
              )
            ) : (
              <div className="pdf-loading">加载中...</div>
            )}
          </div>
        ) : (
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
        )}
        {!isPdf && selectionPopover && (
          <div
            className="highlight-popover"
            style={
              /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                ? {
                    position: 'fixed',
                    top: Math.max(60, selectionPopover.rectTop - 50),
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
