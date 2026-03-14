import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { safeJson } from '../utils/api'

const fetchOpts = { credentials: 'include' }

export default function Home() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedBook, setSelectedBook] = useState('')
  const [rooms, setRooms] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [backendOk, setBackendOk] = useState(null)

  const fetchBooks = useCallback(async () => {
    try {
      const res = await fetch('/api/books', fetchOpts)
      const data = await safeJson(res)
      setBooks(Array.isArray(data) ? data : [])
    } catch (_) {
      setBooks([])
    }
  }, [])

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms', fetchOpts)
      const data = await safeJson(res)
      setRooms(Array.isArray(data) ? data : [])
    } catch (_) {
      setRooms([])
    }
  }, [])

  useEffect(() => {
    fetchBooks()
    fetchRooms()
  }, [fetchBooks, fetchRooms])

  useEffect(() => {
    fetch('/api/health', fetchOpts)
      .then((r) => r.ok && setBackendOk(true))
      .catch(() => setBackendOk(false))
  }, [])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || '上传失败')
      await fetchBooks()
      await fetchRooms()
      setSelectedBook(data.id)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (!file?.name.toLowerCase().endsWith('.txt') && !file?.name.toLowerCase().endsWith('.pdf')) {
        setUploadError('只支持 txt、pdf 文件')
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      input.files = e.dataTransfer.files
      input.onchange = (ev) => handleFileChange(ev)
      input.dispatchEvent(new Event('change'))
    },
    [handleFileChange]
  )

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const createRoom = async () => {
    if (!selectedBook) return
    setLoading(true)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bookId: selectedBook }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || '创建失败')
      await fetchRooms()
      navigate(`/room/${data.roomId}`)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const deleteBook = async (e, bookId) => {
    e.stopPropagation()
    if (!confirm('确定删除这本书吗？')) return
    setUploadError('')
    try {
      const res = await fetch('/api/books/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: bookId }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || `删除失败 (${res.status})`)
      await fetchBooks()
      await fetchRooms()
      if (selectedBook === bookId) setSelectedBook('')
    } catch (err) {
      setUploadError(err.message)
    }
  }

  return (
    <div className="home">
      <header>
        <h1>📖 两人共读</h1>
        <p>上传书籍，创建房间，邀请好友一起阅读</p>
        <div className="header-actions">
          <button className="highlights-link" onClick={() => navigate('/highlights')}>
            好词好句
          </button>
          <span className="user-info">
            {user?.username}
            {user?.isAdmin && <span className="admin-badge">管理员</span>}
          </span>
          <button className="logout-btn" onClick={logout}>退出</button>
        </div>
        {backendOk === false && (
          <p className="backend-warn">⚠️ 后端未连接，请确保已运行 npm run dev（或分别启动 server 和 client）</p>
        )}
      </header>

      {user?.isAdmin && (
        <section className="upload-section">
          <h2>上传书籍</h2>
          <div
            className="dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => document.getElementById('file-input').click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".txt,.pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {loading ? '上传中...' : '点击或拖拽 txt、pdf 文件到此处'}
          </div>
          {uploadError && <p className="error">{uploadError}</p>}
        </section>
      )}

      <section className="books-section">
        <h2>已上传书籍</h2>
        {books.length === 0 ? (
          <p className="hint">暂无书籍，请先上传</p>
        ) : (
          <ul className="book-list">
            {books.map((b) => (
              <li
                key={b.id}
                className={selectedBook === b.id ? 'selected' : ''}
                onClick={() => setSelectedBook(b.id)}
              >
                <span className="book-name">{b.name}</span>
                <span className="book-pages">({b.totalPages} 页)</span>
                <button
                  type="button"
                  className="delete-btn"
                  onClick={(e) => deleteBook(e, b.id)}
                  title="删除"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="create-section">
        <h2>创建房间</h2>
        <button
          className="btn primary"
          onClick={createRoom}
          disabled={!selectedBook || loading}
        >
          创建房间并开始阅读
        </button>
      </section>

      <section className="rooms-section">
        <h2>房间列表</h2>
        {rooms.length === 0 ? (
          <p className="hint">暂无房间，请先创建或上传书籍</p>
        ) : (
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.roomId} onClick={() => navigate(`/room/${r.roomId}`)}>
                <span className="room-book">{r.bookName}</span>
                <span className="room-progress">
                  第 {r.currentPage}/{r.totalPages} 页
                </span>
                <span className="room-id">ID: {r.roomId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
