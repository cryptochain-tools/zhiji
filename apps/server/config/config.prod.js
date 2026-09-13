'use strict'

// Egg loads this native production overlay after TypeScript defaults. Keep the
// session-signing key explicit so egg-security can run before application
// middleware handles a request.
module.exports = () => ({
  keys: process.env.SESSION_SECRET || 'development-only-change-before-deploy',
  // TLS terminates at the dedicated DCDN/Nginx reverse-proxy path.
  proxy: true,
  // The public listener is Nginx; keep the Egg origin reachable from loopback only.
  cluster: {
    listen: {
      hostname: '127.0.0.1',
    },
  },
})
