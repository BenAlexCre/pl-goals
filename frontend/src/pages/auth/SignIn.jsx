import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function SignIn() {
  const navigate = useNavigate()

  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        navigate('/dashboard', { replace: true })
      }
    }

    checkSession()
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (!email.trim()) {
        throw new Error('Email is required')
      }

      if (!password.trim()) {
        throw new Error('Password is required')
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })

        if (error) throw error

        if (data?.user && !data?.session) {
          setMessage('Account created. Check your confirmation email before signing in.')
        } else {
          setMessage('Account created and signed in.')
          navigate('/dashboard', { replace: true })
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (error) throw error

        navigate('/dashboard', { replace: true })
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (!email.trim()) {
        throw new Error('Enter your email first to reset your password')
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'http://localhost:5173/reset-password',
      })

      if (error) throw error

      setMessage('Password reset email sent.')
    } catch (err) {
      setError(err.message || 'Could not send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <div style={styles.logoBadge}>PL</div>
          <div>
            <div style={styles.eyebrow}>Premier League Goals</div>
            <h1 style={styles.title}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h1>
          </div>
        </div>

        <p style={styles.subtitle}>
          {mode === 'signin'
            ? 'Sign in to view your pots, picks, and live scores.'
            : 'Create your account to join private pots and submit picks.'}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={styles.input}
              required
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={styles.input}
              required
            />
          </div>

          {error ? (
            <div style={styles.errorBox}>{error}</div>
          ) : null}

          {message ? (
            <div style={styles.successBox}>{message}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.primaryButton,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? 'Please wait...'
              : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
          </button>
        </form>

        <div style={styles.footerActions}>
          {mode === 'signin' && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              style={styles.linkButton}
            >
              Forgot password?
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError('')
              setMessage('')
            }}
            disabled={loading}
            style={styles.secondaryButton}
          >
            {mode === 'signin'
              ? 'Need an account? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(135deg, #0a0f0d 0%, #0f1713 50%, #0b100d 100%)',
    color: '#f3f5f4',
    padding: '24px',
    fontFamily: 'Inter, Arial, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '440px',
    background: '#121916',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    padding: '24px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  },
  logoRow: {
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
    marginBottom: '12px',
  },
  logoBadge: {
    width: '44px',
    height: '44px',
    borderRadius: '14px',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 800,
    background: '#00e676',
    color: '#08110c',
  },
  eyebrow: {
    fontSize: '12px',
    color: '#8ca49a',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '4px',
  },
  title: {
    fontSize: '28px',
    margin: 0,
    lineHeight: 1.1,
  },
  subtitle: {
    color: '#a8b7b0',
    fontSize: '14px',
    lineHeight: 1.5,
    marginBottom: '20px',
  },
  form: {
    display: 'grid',
    gap: '14px',
  },
  field: {
    display: 'grid',
    gap: '8px',
  },
  label: {
    fontSize: '13px',
    color: '#d7dedb',
  },
  input: {
    width: '100%',
    minHeight: '46px',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#0d1210',
    color: '#fff',
    outline: 'none',
  },
  errorBox: {
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'rgba(194, 59, 59, 0.12)',
    border: '1px solid rgba(194, 59, 59, 0.35)',
    color: '#ffb3b3',
    fontSize: '14px',
  },
  successBox: {
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'rgba(0, 230, 118, 0.12)',
    border: '1px solid rgba(0, 230, 118, 0.28)',
    color: '#b9ffd6',
    fontSize: '14px',
  },
  primaryButton: {
    minHeight: '48px',
    border: 'none',
    borderRadius: '14px',
    background: '#00e676',
    color: '#08110c',
    fontWeight: 700,
    fontSize: '15px',
  },
  footerActions: {
    marginTop: '16px',
    display: 'grid',
    gap: '10px',
  },
  linkButton: {
    background: 'transparent',
    border: 'none',
    color: '#9fc9b1',
    textAlign: 'left',
    cursor: 'pointer',
    padding: 0,
    fontSize: '14px',
  },
  secondaryButton: {
    minHeight: '46px',
    borderRadius: '14px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#171f1b',
    color: '#eef2f0',
    fontWeight: 600,
    cursor: 'pointer',
  },
}