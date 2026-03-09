import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { safeJson } from '../utils/api'

const PAGE_SIZE = 10

export default function HighlightsAll() {
  const navigate = useNavigate()
  const [words, setWords] = useState([])
  const [sentences, setSentences] = useState([])
  const [wordsPage, setWordsPage] = useState(1)
  const [sentencesPage, setSentencesPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/highlights')
      if (!res.ok) throw new Error('获取失败')
      const data = await safeJson(res)
      setWords(data.words || [])
      setSentences(data.sentences || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const wordsTotal = words.length
  const wordsTotalPages = Math.max(1, Math.ceil(wordsTotal / PAGE_SIZE))
  const wordsSlice = words.slice((wordsPage - 1) * PAGE_SIZE, wordsPage * PAGE_SIZE)

  const sentencesTotal = sentences.length
  const sentencesTotalPages = Math.max(1, Math.ceil(sentencesTotal / PAGE_SIZE))
  const sentencesSlice = sentences.slice((sentencesPage - 1) * PAGE_SIZE, sentencesPage * PAGE_SIZE)

  const goToPage = (h) => {
    if (h.roomId) {
      navigate(`/room/${h.roomId}`, { state: { jumpToPage: h.pageIndex + 1 } })
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
        <button className="back" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <h1>好词好句</h1>
        <p className="subtitle">独立存储，书删了也不会丢</p>
      </header>

      <main className="highlights-main">
        <section className="highlights-section">
          <h2>好词 <span className="count">共 {wordsTotal} 条</span></h2>
          {wordsTotal === 0 ? (
            <p className="hint">暂无好词</p>
          ) : (
            <>
              <ul className="highlights-list">
                {wordsSlice.map((h, i) => (
                  <li key={h.id || i}>
                    <span className="book-name">{h.bookName}</span>
                    <span className="text">{h.text}</span>
                    {h.roomId ? (
                      <button type="button" className="page-link" onClick={() => goToPage(h)}>
                        第 {h.pageIndex + 1} 页
                      </button>
                    ) : (
                      <span className="page-info">第 {h.pageIndex + 1} 页（书已删）</span>
                    )}
                  </li>
                ))}
              </ul>
              {wordsTotalPages > 1 && (
                <div className="pagination">
                  <button disabled={wordsPage <= 1} onClick={() => setWordsPage((p) => Math.max(1, p - 1))}>
                    上一页
                  </button>
                  <span>{wordsPage} / {wordsTotalPages}</span>
                  <button disabled={wordsPage >= wordsTotalPages} onClick={() => setWordsPage((p) => Math.min(wordsTotalPages, p + 1))}>
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
                {sentencesSlice.map((h, i) => (
                  <li key={h.id || i}>
                    <span className="book-name">{h.bookName}</span>
                    <span className="text">{h.text}</span>
                    {h.roomId ? (
                      <button type="button" className="page-link" onClick={() => goToPage(h)}>
                        第 {h.pageIndex + 1} 页
                      </button>
                    ) : (
                      <span className="page-info">第 {h.pageIndex + 1} 页（书已删）</span>
                    )}
                  </li>
                ))}
              </ul>
              {sentencesTotalPages > 1 && (
                <div className="pagination">
                  <button disabled={sentencesPage <= 1} onClick={() => setSentencesPage((p) => Math.max(1, p - 1))}>
                    上一页
                  </button>
                  <span>{sentencesPage} / {sentencesTotalPages}</span>
                  <button disabled={sentencesPage >= sentencesTotalPages} onClick={() => setSentencesPage((p) => Math.min(sentencesTotalPages, p + 1))}>
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
