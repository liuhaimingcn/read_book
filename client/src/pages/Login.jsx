import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { safeJson } from '../utils/api'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading: authLoading, refreshUser } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [highlightColor, setHighlightColor] = useState('')
  const [colors, setColors] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/highlight-colors', { credentials: 'include' })
      .then((r) => r.json())
      .then((list) => {
        setColors(Array.isArray(list) ? list : [])
        if (list?.length && !highlightColor) setHighlightColor(list[0].value)
      })
      .catch(() => setColors([]))
  }, [])

  useEffect(() => {
    if (!authLoading && user) navigate('/', { replace: true })
  }, [user, authLoading, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, highlightColor }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || '登录失败')
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <div className="login-page">加载中...</div>

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>📖 两人共读</h1>
        <p className="login-subtitle">请登录后使用</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="字母+数字组合，长度≥9"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="form-group">
            <label>选择划线颜色</label>
            <div className="color-options">
              {colors.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`color-option ${highlightColor === c.value ? 'selected' : ''}`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                  onClick={() => setHighlightColor(c.value)}
                />
              ))}
            </div>
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>
        <p className="login-footer">
          没有账户？<Link to="/register">去注册</Link>
        </p>
      </div>
    </div>
  )
}
