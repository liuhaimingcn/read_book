import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { safeJson } from '../utils/api'

const PAGE_SIZE = 10

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

async function toggleUsed(id) {
  const res = await fetch(`/api/highlights/${id}/used`, { method: 'PATCH', credentials: 'include' })
  return res.ok ? (await res.json()).used : null
}

async function deleteHighlight(id) {
  const res = await fetch(`/api/highlights/${id}`, { method: 'DELETE', credentials: 'include' })
  return res.ok
}


export default function Highlights() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [book, setBook] = useState(null)
  const [words, setWords] = useState([])
  const [sentences, setSentences] = useState([])
  const [wordsPage, setWordsPage] = useState(1)
  const [sentencesPage, setSentencesPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [roomRes, highlightsRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}`, { credentials: 'include' }),
        fetch(`/api/rooms/${roomId}/highlights-all`, { credentials: 'include' }),
      ])
      if (!roomRes.ok) throw new Error('房间不存在')
      const roomData = await safeJson(roomRes)
      setBook(roomData.book)
      if (highlightsRes.ok) {
        const hlData = await safeJson(highlightsRes)
        setWords(hlData.words || [])
        setSentences(hlData.sentences || [])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const wordsTotal = words.length
  const wordsTotalPages = Math.max(1, Math.ceil(wordsTotal / PAGE_SIZE))
  const wordsStart = (wordsPage - 1) * PAGE_SIZE
  const wordsSlice = words.slice(wordsStart, wordsStart + PAGE_SIZE)

  const sentencesTotal = sentences.length
  const sentencesTotalPages = Math.max(1, Math.ceil(sentencesTotal / PAGE_SIZE))
  const sentencesStart = (sentencesPage - 1) * PAGE_SIZE
  const sentencesSlice = sentences.slice(sentencesStart, sentencesStart + PAGE_SIZE)

  const goToPage = (pageIndex) => {
    navigate(`/room/${roomId}`, { state: { jumpToPage: pageIndex + 1 } })
  }

  const handleToggleUsed = async (id) => {
    const used = await toggleUsed(id)
    if (used !== null) {
      setWords((prev) => prev.map((h) => (h.id === id ? { ...h, used } : h)))
      setSentences((prev) => prev.map((h) => (h.id === id ? { ...h, used } : h)))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除这条好词好句？')) return
    setDeleteError('')
    const ok = await deleteHighlight(id)
    if (ok) {
      setWords((prev) => prev.filter((h) => h.id !== id))
      setSentences((prev) => prev.filter((h) => h.id !== id))
    } else {
      setDeleteError('删除失败，请刷新后重试')
    }
  }

  if (loading) return <div className="highlights-page loading">加载中...</div>
  if (error) {
    return (
      <div className="highlights-page error">
        <p>{error}</p>
        <button onClick={() => navigate('/')}>返回首页</button>
      </div>
    )
  }

  return (
    <div className="highlights-page">
      <header className="highlights-header">
        <button className="back" onClick={() => navigate(`/room/${roomId}`)}>
          ← 返回阅读
        </button>
        <h1>{book?.name}</h1>
        <p className="subtitle">好词好句管理</p>
        {deleteError && <p className="login-error">{deleteError}</p>}
      </header>

      <main className="highlights-main">
        <section className="highlights-section">
          <h2>好词 <span className="count">共 {wordsTotal} 条</span></h2>
          {wordsTotal === 0 ? (
            <p className="hint">暂无好词</p>
          ) : (
            <>
              <ul className="highlights-list">
                {wordsSlice.map((h) => (
                  <li key={h.id || h.text}>
                    <div className="highlight-meta">
                      <span className="highlight-date">{formatDate(h.createdAt)}</span>
                      <span className={`highlight-used ${h.used ? 'used' : ''}`}>{h.used ? '已使用' : '未使用'}</span>
                      {h.id && (
                        <button type="button" className="used-toggle" onClick={() => handleToggleUsed(h.id)}>
                          {h.used ? '标为未使用' : '标为已使用'}
                        </button>
                      )}
                      {h.id && (
                        <button type="button" className="delete-highlight-btn" onClick={() => handleDelete(h.id)}>
                          删除
                        </button>
                      )}
                    </div>
                    <span className="text">{h.text}</span>
                    <button type="button" className="page-link" onClick={() => goToPage(h.pageIndex)}>
                      第 {h.pageIndex + 1} 页
                    </button>
                  </li>
                ))}
              </ul>
              {wordsTotalPages > 1 && (
                <div className="pagination">
                  <button
                    disabled={wordsPage <= 1}
                    onClick={() => setWordsPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span>
                    {wordsPage} / {wordsTotalPages}
                  </span>
                  <button
                    disabled={wordsPage >= wordsTotalPages}
                    onClick={() => setWordsPage((p) => Math.min(wordsTotalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="highlights-section">
          <h2>好句 <span className="count">共 {sentencesTotal} 条</span></h2>
          {sentencesTotal === 0 ? (
            <p className="hint">暂无好句</p>
          ) : (
            <>
              <ul className="highlights-list">
                {sentencesSlice.map((h) => (
                  <li key={h.id || h.text}>
                    <div className="highlight-meta">
                      <span className="highlight-date">{formatDate(h.createdAt)}</span>
                      <span className={`highlight-used ${h.used ? 'used' : ''}`}>{h.used ? '已使用' : '未使用'}</span>
                      {h.id && (
                        <button type="button" className="used-toggle" onClick={() => handleToggleUsed(h.id)}>
                          {h.used ? '标为未使用' : '标为已使用'}
                        </button>
                      )}
                      {h.id && (
                        <button type="button" className="delete-highlight-btn" onClick={() => handleDelete(h.id)}>
                          删除
                        </button>
                      )}
                    </div>
                    <span className="text">{h.text}</span>
                    <button type="button" className="page-link" onClick={() => goToPage(h.pageIndex)}>
                      第 {h.pageIndex + 1} 页
                    </button>
                  </li>
                ))}
              </ul>
              {sentencesTotalPages > 1 && (
                <div className="pagination">
                  <button
                    disabled={sentencesPage <= 1}
                    onClick={() => setSentencesPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span>
                    {sentencesPage} / {sentencesTotalPages}
                  </span>
                  <button
                    disabled={sentencesPage >= sentencesTotalPages}
                    onClick={() => setSentencesPage((p) => Math.min(sentencesTotalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
