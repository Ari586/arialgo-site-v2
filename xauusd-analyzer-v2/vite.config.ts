import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ACCESS_REALM = 'Ari Trading Bot'

function createAccessCodeGuard(env: Record<string, string>): Plugin {
    const accessCode = env.SITE_ACCESS_CODE || process.env.SITE_ACCESS_CODE || ''
    const accessUser = env.SITE_ACCESS_USER || process.env.SITE_ACCESS_USER || 'ari'

    const isAuthorized = (authorizationHeader?: string) => {
        if (!accessCode) return true
        if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return false

        try {
            const encoded = authorizationHeader.slice(6).trim()
            const decoded = Buffer.from(encoded, 'base64').toString('utf8')
            const sepIndex = decoded.indexOf(':')
            if (sepIndex < 0) return false
            const username = decoded.slice(0, sepIndex)
            const password = decoded.slice(sepIndex + 1)
            const userOk = accessUser === '*' || username === accessUser
            return userOk && password === accessCode
        } catch {
            return false
        }
    }

    const deny = (res: any) => {
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', `Basic realm="${ACCESS_REALM}", charset="UTF-8"`)
        res.end('Access code required')
    }

    const guard = (req: any, res: any, next: any) => {
        if (isAuthorized(req.headers?.authorization)) return next()
        return deny(res)
    }

    return {
        name: 'access-code-guard',
        configureServer(server) {
            if (!accessCode) return
            server.middlewares.use(guard)
            server.config.logger.info(`\n🔒 Access code enabled for Vite (user: ${accessUser})`)
        },
        configurePreviewServer(server) {
            if (!accessCode) return
            server.middlewares.use(guard)
        }
    }
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')

    return {
        plugins: [react(), createAccessCodeGuard(env)],
        server: {
            host: true,
            port: 5174,
            strictPort: true,
            allowedHosts: true,
            proxy: {
                '/api': { target: 'http://localhost:8080', changeOrigin: true },
                '/ws': { target: 'ws://localhost:8080', ws: true }
            }
        }
    }
})
