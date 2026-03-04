#!/usr/bin/env node

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

async function resolveFetch() {
    if (typeof fetch === 'function') return fetch;
    const mod = await import('node-fetch');
    return mod.default;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(start = 18080, end = 18120) {
    let sawPermissionDenied = false;
    for (let port = start; port <= end; port++) {
        // eslint-disable-next-line no-await-in-loop
        const free = await new Promise((resolve) => {
            const tester = net.createServer();
            tester.once('error', (error) => {
                if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                    sawPermissionDenied = true;
                }
                resolve(false);
            });
            tester.once('listening', () => {
                tester.close(() => resolve(true));
            });
            tester.listen(port, '127.0.0.1');
        });
        if (free) return port;
    }
    if (sawPermissionDenied) {
        throw new Error(
            'Port binding is denied (EPERM/EACCES). This environment blocks localhost listeners. ' +
            'Run this command outside sandbox or with elevated permissions.'
        );
    }
    throw new Error(`No free port found in range ${start}-${end}`);
}

function basicAuthHeader(user, pass) {
    const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    return `Basic ${token}`;
}

async function waitForHealth(fetchFn, url, headers, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
            const res = await fetchFn(url, { headers, signal: controller.signal });
            if (res.ok) {
                clearTimeout(timer);
                return;
            }
        } catch {
            // Keep retrying until timeout.
        } finally {
            clearTimeout(timer);
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
    }
    throw new Error(`Timeout waiting for server health at ${url}`);
}

async function runJsonCheck(fetchFn, baseUrl, headers, check) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), check.timeoutMs || 8000);
    let res;
    let bodyText = '';
    let json = null;
    try {
        res = await fetchFn(`${baseUrl}${check.path}`, {
            method: 'GET',
            headers,
            signal: controller.signal
        });
        bodyText = await res.text();
        try {
            json = JSON.parse(bodyText);
        } catch {
            json = null;
        }
    } finally {
        clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
        throw new Error(`${check.name}: HTTP ${res.status} ${res.statusText}`);
    }
    if (!json || typeof json !== 'object') {
        throw new Error(`${check.name}: response is not valid JSON`);
    }
    if (typeof check.validate === 'function') {
        const maybeError = check.validate(json);
        if (typeof maybeError === 'string' && maybeError) {
            throw new Error(`${check.name}: ${maybeError}`);
        }
    }

    return {
        name: check.name,
        path: check.path,
        durationMs,
    };
}

async function runPostJsonCheck(fetchFn, baseUrl, headers, check) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), check.timeoutMs || 8000);
    let res;
    let bodyText = '';
    let json = null;
    try {
        res = await fetchFn(`${baseUrl}${check.path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(check.body || {}),
            signal: controller.signal
        });
        bodyText = await res.text();
        try {
            json = JSON.parse(bodyText);
        } catch {
            json = null;
        }
    } finally {
        clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
        throw new Error(`${check.name}: HTTP ${res.status} ${res.statusText}`);
    }
    if (!json || typeof json !== 'object') {
        throw new Error(`${check.name}: response is not valid JSON`);
    }
    if (typeof check.validate === 'function') {
        const maybeError = check.validate(json);
        if (typeof maybeError === 'string' && maybeError) {
            throw new Error(`${check.name}: ${maybeError}`);
        }
    }

    return {
        name: check.name,
        path: check.path,
        durationMs,
    };
}

async function runTextCheck(fetchFn, baseUrl, headers, check) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), check.timeoutMs || 8000);
    let res;
    let bodyText = '';
    try {
        res = await fetchFn(`${baseUrl}${check.path}`, {
            method: 'GET',
            headers,
            signal: controller.signal
        });
        bodyText = await res.text();
    } finally {
        clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
        throw new Error(`${check.name}: HTTP ${res.status} ${res.statusText}`);
    }
    if (typeof check.validate === 'function') {
        const maybeError = check.validate(bodyText, res);
        if (typeof maybeError === 'string' && maybeError) {
            throw new Error(`${check.name}: ${maybeError}`);
        }
    }

    return {
        name: check.name,
        path: check.path,
        durationMs,
    };
}

async function stopServer(serverProc) {
    if (!serverProc || serverProc.exitCode !== null) return;
    serverProc.kill('SIGTERM');
    const timeout = setTimeout(() => {
        if (serverProc.exitCode === null) {
            serverProc.kill('SIGKILL');
        }
    }, 3500);
    try {
        await once(serverProc, 'exit');
    } finally {
        clearTimeout(timeout);
    }
}

async function main() {
    const fetchFn = await resolveFetch();
    const serverRoot = path.resolve(__dirname, '..');
    const port = await findFreePort();
    const user = process.env.SMOKE_AUTH_USER || process.env.SITE_ACCESS_USER || 'ari';
    const pass = process.env.SMOKE_AUTH_PASS || process.env.SITE_ACCESS_CODE || '';

    const childEnv = {
        ...process.env,
        PORT: String(port),
        // Keep auth by default when configured in env, but allow explicit override
        SITE_ACCESS_USER: process.env.SITE_ACCESS_USER || user,
        SITE_ACCESS_CODE: process.env.SITE_ACCESS_CODE || pass,
        // Speed up startup checks and avoid noisy integrations during smoke tests.
        CHAT_REDIS_URL: process.env.CHAT_REDIS_URL || '',
        MARKET_BUS_ENABLED: process.env.MARKET_BUS_ENABLED || 'false',
        ENABLE_PRIMARY_EXCHANGE_FEEDS: process.env.ENABLE_PRIMARY_EXCHANGE_FEEDS || 'false',
        TRADING_AGENTS_ENABLED: process.env.TRADING_AGENTS_ENABLED || 'false'
    };

    const serverProc = spawn(process.execPath, ['server.js'], {
        cwd: serverRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrTail = '';
    serverProc.stdout.on('data', (chunk) => {
        const text = String(chunk || '');
        process.stdout.write(`[server] ${text}`);
    });
    serverProc.stderr.on('data', (chunk) => {
        const text = String(chunk || '');
        stderrTail = `${stderrTail}${text}`.slice(-2000);
        process.stderr.write(`[server:err] ${text}`);
    });

    const headers = {};
    if (childEnv.SITE_ACCESS_CODE) {
        headers.Authorization = basicAuthHeader(childEnv.SITE_ACCESS_USER || user, childEnv.SITE_ACCESS_CODE);
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const checks = [
        {
            name: 'health',
            path: '/api/health',
            validate: (json) => (json.status === 'ok' ? '' : 'status is not ok')
        },
        {
            name: 'instruments',
            path: '/api/instruments',
            validate: (json) => (Array.isArray(json.instruments) && json.instruments.length > 0 ? '' : 'instruments missing')
        },
        {
            name: 'price',
            path: '/api/price?symbol=XAU%2FUSD',
            timeoutMs: 10000,
            validate: (json) => (json.success ? '' : 'success=false')
        },
        {
            name: 'history',
            path: '/api/history?symbol=XAU%2FUSD&interval=1min&outputsize=60',
            timeoutMs: 10000,
            validate: (json) => (Array.isArray(json.data) ? '' : 'history data missing')
        },
        {
            name: 'multi-tf',
            path: '/api/multi-tf?symbol=XAU%2FUSD',
            timeoutMs: 10000,
            validate: (json) => (json && typeof json === 'object' ? '' : 'invalid payload')
        },
        {
            name: 'realtime-status',
            path: '/api/realtime/status',
            validate: (json) => (json.success ? '' : 'success=false')
        },
        {
            name: 'macro-calendar',
            path: '/api/macro-calendar?symbol=XAU%2FUSD',
            validate: (json) => (json.success ? '' : 'success=false')
        },
        {
            name: 'mt5-live-guard',
            path: '/api/mt5/live-guard',
            validate: (json) => (json.success && json.liveGuard && typeof json.liveGuard.armed === 'boolean' ? '' : 'liveGuard missing')
        }
    ];
    const postChecks = [
        {
            name: 'mt5-live-guard-arm',
            path: '/api/mt5/live-guard',
            body: {
                armed: true,
                reason: 'smoke_test_force_armed',
                changedBy: 'smoke-test'
            },
            validate: (json) => (json.success && json.liveGuard && json.liveGuard.armed === true ? '' : 'unable to arm liveGuard')
        },
        {
            name: 'mt5-manual-order-dryrun',
            path: '/api/mt5/manual-order',
            body: {
                symbol: 'XAU/USD',
                side: 'BUY',
                volume: 0.01,
                entryPrice: 3000.00,
                stopLoss: 2999.75,
                takeProfit: 3000.40,
                confidence: 70,
                dryRun: true
            },
            validate: (json) => (json.success && json.dryRun ? '' : 'dryRun flow failed')
        }
    ];
    const textChecks = [
        {
            name: 'mt5-executor-source',
            path: '/api/mt5/executor/source?download=0',
            validate: (text) => {
                if (!text || typeof text !== 'string') return 'empty source';
                if (text.includes('{{API_BASE_URL}}') || text.includes('{{SITE_USER}}') || text.includes('{{SITE_CODE}}') || text.includes('{{BRIDGE_TOKEN}}')) {
                    return 'placeholders_not_replaced';
                }
                if (!text.includes('input string ApiBaseUrl')) return 'missing_api_base_line';
                if (!text.includes('input string SiteUser')) return 'missing_site_user_line';
                return '';
            }
        },
        {
            name: 'mt5-executor-python',
            path: '/api/mt5/executor/python?download=0',
            validate: (text) => {
                if (!text || typeof text !== 'string') return 'empty source';
                if (text.includes('{{API_BASE_URL}}') || text.includes('{{SITE_USER}}') || text.includes('{{SITE_CODE}}') || text.includes('{{BRIDGE_TOKEN}}')) {
                    return 'placeholders_not_replaced';
                }
                if (!text.includes('Ari_MT5_PythonExecutor')) return 'missing_python_executor_label';
                if (!text.includes('MetaTrader5')) return 'missing_mt5_import';
                return '';
            }
        }
    ];

    try {
        await waitForHealth(fetchFn, `${baseUrl}/api/health`, headers, 35000);
        const results = [];
        for (const check of checks) {
            // eslint-disable-next-line no-await-in-loop
            const res = await runJsonCheck(fetchFn, baseUrl, headers, check);
            results.push(res);
        }
        for (const check of postChecks) {
            // eslint-disable-next-line no-await-in-loop
            const res = await runPostJsonCheck(fetchFn, baseUrl, headers, check);
            results.push(res);
        }
        for (const check of textChecks) {
            // eslint-disable-next-line no-await-in-loop
            const res = await runTextCheck(fetchFn, baseUrl, headers, check);
            results.push(res);
        }

        console.log('\n✅ Local endpoint smoke test: OK');
        for (const row of results) {
            console.log(`  - ${row.name.padEnd(16)} ${String(row.durationMs).padStart(4)} ms  ${row.path}`);
        }
        console.log(`\nBase URL: ${baseUrl}`);
        if (childEnv.SITE_ACCESS_CODE) {
            console.log(`Auth: Basic (${childEnv.SITE_ACCESS_USER})`);
        } else {
            console.log('Auth: disabled');
        }
    } catch (error) {
        console.error('\n❌ Local endpoint smoke test FAILED');
        console.error(String(error && error.message ? error.message : error));
        if (stderrTail) {
            console.error('\n--- server stderr (tail) ---');
            console.error(stderrTail);
        }
        process.exitCode = 1;
    } finally {
        await stopServer(serverProc);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
