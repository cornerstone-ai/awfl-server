import express from 'express'
import workflowsRoutes from './workflows/index.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

const logging = (req, _res, next) => {
  const { method, url } = req
  if (!url.includes('healthz')) {
    console.log(`[API] ${method} ${url}`)
  }
  next()
}
app.use(logging)

// Health checks
app.get('/healthz', (_req, res) => res.status(200).send('OK'))
app.get('/api/healthz', (_req, res) => res.status(200).send('OK'))

// Workflows (primary mount)
app.use('/workflows', workflowsRoutes)
// Back-compat for local/dev prefix
app.use('/api/workflows', workflowsRoutes)

// 404 fallback
app.use((req, res) => {
  res.status(404).send('Not Found')
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`API service listening on port ${PORT}`)
})
