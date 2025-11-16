import express from 'express'
import workflowsRoutes from './workflows/index.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

// --- CORS for prod (api.awfl.us) ---
const ALLOWED_ORIGIN = process.env.CORS_ALLOW_ORIGIN || 'https://awfl.us'
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = 'Authorization, Content-Type, x-project-id, x-consumer-id'
const MAX_AGE = process.env.CORS_MAX_AGE || '600'
const ALLOW_CREDENTIALS = process.env.CORS_ALLOW_CREDENTIALS === 'true'

const cors = (req, res, next) => {
  const origin = req.headers.origin
  // Ensure caching layers vary on Origin
  res.setHeader('Vary', 'Origin')

  // Only allow the configured origin (default https://awfl.us)
  if (origin && (ALLOWED_ORIGIN === '*' ? true : origin === ALLOWED_ORIGIN)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  if (ALLOW_CREDENTIALS) {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  if (req.method === 'OPTIONS') {
    // Preflight response
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    res.setHeader('Access-Control-Max-Age', MAX_AGE)
    return res.status(204).end()
  }

  return next()
}
app.use(cors)

const logging = (req, _res, next) => {
  const { method, url } = req
  if (!url.includes('health')) {
    console.log(`[API] ${method} ${url}`)
  }
  next()
}
app.use(logging)

// Health checks (support both /health and /api/health for compatibility)
app.get('/health', (_req, res) => res.status(200).send('OK'))

// Workflows (primary mount)
app.use('/workflows', workflowsRoutes)
// Back-compat for local/dev prefix
// app.use('/api/workflows', workflowsRoutes)

// 404 fallback
app.use((req, res) => {
  res.status(404).send('Not Found')
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`API service listening on port ${PORT}`)
})
