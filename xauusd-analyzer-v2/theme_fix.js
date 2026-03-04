const fs = require('fs');
const cssPath = './src/index.css';
let css = fs.readFileSync(cssPath, 'utf8');

// The new three-theme system: Light (Default :root), Dark, Cyber
const newThemes = `:root {
    --bg-main: #f8fafc;
    --bg-secondary: #ffffff;
    --bg-tertiary: #f1f5f9;
    --bg-contrast: #e2e8f0;
    --text-main: #0f172a;
    --text-secondary: #475569;
    --text-dim: #94a3b8;
    
    --gold: #b48608;
    --gold-glow: rgba(180, 134, 8, 0.15);
    
    --buy: #059669;
    --buy-bg: rgba(5, 150, 105, 0.12);
    --sell: #dc2626;
    --sell-bg: rgba(220, 38, 38, 0.12);
    
    --accent: #2563eb;
    --accent-soft: rgba(37, 99, 235, 0.12);
    
    --border: rgba(15, 23, 42, 0.1);
    --border-strong: rgba(15, 23, 42, 0.2);
    
    --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    --card-shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px inset rgba(0,0,0,0.02);
    
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    
    --font-main: 'Inter', system-ui, -apple-system, sans-serif;
    --font-display: 'Space Grotesk', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    
    --chat-header-meta: rgba(15, 23, 42, 0.9);
    --chat-message-name: #111827;
    --chat-message-time: #6b7280;

    color-scheme: light;
}

:root[data-theme='dark'] {
    --bg-main: #06080a;
    --bg-secondary: rgba(14, 18, 24, 0.7);
    --bg-tertiary: rgba(22, 28, 36, 0.65);
    --bg-contrast: rgba(30, 38, 48, 0.8);
    --text-main: #f3f4f6;
    --text-secondary: #9ca3af;
    --text-dim: #6b7280;
    
    --gold: #d4af37;
    --gold-glow: rgba(212, 175, 55, 0.25);
    
    --buy: #00e676;
    --buy-bg: rgba(0, 230, 118, 0.12);
    --sell: #ff1744;
    --sell-bg: rgba(255, 23, 68, 0.12);
    
    --accent: #2979ff;
    --accent-soft: rgba(41, 121, 255, 0.15);
    
    --border: rgba(45, 55, 72, 0.6);
    --border-strong: rgba(74, 85, 104, 0.8);
    
    --card-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    --card-shadow-hover: 0 12px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px inset rgba(255,255,255,0.05);

    --chat-header-meta: rgba(255, 255, 255, 0.9);
    --chat-message-name: #f3f4f6;
    --chat-message-time: #9ca3af;

    color-scheme: dark;
}

:root[data-theme='cyber'] {
    --bg-main: #05030b;
    --bg-secondary: rgba(17, 11, 31, 0.82);
    --bg-tertiary: rgba(27, 16, 47, 0.72);
    --bg-contrast: rgba(48, 31, 75, 0.74);
    --text-main: #eef1ff;
    --text-secondary: #a7b1dd;
    --text-dim: #7e88b8;
    --gold: #ffd44d;
    --gold-glow: rgba(255, 212, 77, 0.25);
    --buy: #00ffb0;
    --buy-bg: rgba(0, 255, 176, 0.16);
    --sell: #ff3bd4;
    --sell-bg: rgba(255, 59, 212, 0.16);
    --accent: #9d6bff;
    --accent-soft: rgba(157, 107, 255, 0.2);
    --border: rgba(91, 69, 131, 0.64);
    --border-strong: rgba(136, 104, 197, 0.82);
    --card-shadow: 0 12px 30px rgba(3, 0, 14, 0.56);
    --card-shadow-hover: 0 22px 44px rgba(6, 0, 20, 0.64), 0 0 0 1px inset rgba(157,107,255,0.15);

    --chat-header-meta: rgba(255, 220, 247, 0.94);
    --chat-message-name: #eef1ff;
    --chat-message-time: #b9c3f1;
    color-scheme: dark;
}

* {`;

css = css.replace(/:root \{[\s\S]*?(?=\* \{)/m, newThemes);

// Fix hardcoded body background. Instead of forcing #06080a, scope backgrounds to themes
const bodyStyle = `body {
    background: var(--bg-main);
    color: var(--text-main);
    font-family: var(--font-main);
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    overflow-y: auto;
    position: relative;
}

:root[data-theme='dark'] body {
    background-image: 
        radial-gradient(circle at 15% 50%, rgba(212, 175, 55, 0.04), transparent 40%),
        radial-gradient(circle at 85% 30%, rgba(41, 121, 255, 0.04), transparent 40%),
        radial-gradient(circle at 50% 100%, rgba(0, 230, 118, 0.02), transparent 50%);
    background-attachment: fixed;
}

:root[data-theme='dark'] body::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: 
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 40px 40px;
    opacity: 0.3;
    z-index: 0;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
}

`;
css = css.replace(/body \{\s*background:[\s\S]*?(?=\.price-data)/m, bodyStyle);

// Fix Cards Glassmorphism
const cardStyle = `.card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--card-shadow);
    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    position: relative;
}

:root[data-theme='dark'] .card {
    background: linear-gradient(145deg, rgba(22, 28, 36, 0.7), rgba(14, 18, 24, 0.8));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

:root[data-theme='dark'] .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.3), transparent);
    opacity: 0;
    transition: opacity 0.3s ease;
}

.card:hover {
    box-shadow: var(--card-shadow-hover);
    border-color: var(--border-strong);
    transform: translateY(-2px);
}

:root[data-theme='dark'] .card:hover::before {
    opacity: 1;
}

`;
// The regex finds the `.card { ... }` block but we don't want to replace `.card-title`.
// Wait, my previous broken card style looks like this:
// .card { background: linear-gradient(...); backdrop-filter: blur(16px); ... .card:hover::before { opacity: 1; }
css = css.replace(/\.card \{\s*background:[\s\S]*?(?=\.top-bar \{)/m, cardStyle);


// Fix Top Bar
const topBarStyle = `.top-bar {
    flex: 0 0 auto;
    min-height: 70px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 24px;
    gap: 16px;
    flex-wrap: wrap;
    z-index: 30;
}

:root[data-theme='dark'] .top-bar {
    background: rgba(10, 14, 20, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
}

`;
css = css.replace(/\.top-bar \{\s*flex: 0 0 auto;[\s\S]*?(?=\.card-title \{)/m, topBarStyle);

fs.writeFileSync(cssPath, css);
console.log('Restored three-theme support with scoping!');
