const fs = require('fs');
const cssPath = './src/index.css';
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Force dark premium theme as default :root
css = css.replace(/:root \{[\s\S]*?(?=:root\[data-theme='dark'\])/m, `:root {
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
    
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    
    --font-main: 'Inter', system-ui, -apple-system, sans-serif;
    --font-display: 'Space Grotesk', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    
    --chat-header-meta: rgba(255, 255, 255, 0.9);
    --chat-message-name: #f3f4f6;
    --chat-message-time: #9ca3af;

    color-scheme: dark;
}

`);

// 2. Premium body background
css = css.replace(/body \{\s*background:[\s\S]*?(?=color: var)/m, `body {
    background: #06080a;
    background-image: 
        radial-gradient(circle at 15% 50%, rgba(212, 175, 55, 0.04), transparent 40%),
        radial-gradient(circle at 85% 30%, rgba(41, 121, 255, 0.04), transparent 40%),
        radial-gradient(circle at 50% 100%, rgba(0, 230, 118, 0.02), transparent 50%);
    background-attachment: fixed;
    `);

css = css.replace(/body::before \{\s*content: '';\s*position: fixed;[\s\S]*?(?=z-index: 0;\s*\})/m, `body::before {
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
`);

// 3. Premium Cards (Glassmorphism)
css = css.replace(/\.card \{\s*background:[^;]+;\s*border:[^;]+;[\s\S]*?(?=\.card:hover)/m, `.card {
    background: linear-gradient(145deg, rgba(22, 28, 36, 0.7), rgba(14, 18, 24, 0.8));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--card-shadow);
    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    position: relative;
}

.card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.3), transparent);
    opacity: 0;
    transition: opacity 0.3s ease;
}

`);

css = css.replace(/\.card:hover \{[\s\S]*?(?=:root\[data-theme='cyber'\] \.card)/m, `.card:hover {
    box-shadow: var(--card-shadow-hover);
    border-color: rgba(255, 255, 255, 0.12);
    transform: translateY(-2px);
}
.card:hover::before {
    opacity: 1;
}

`);

// 4. Premium Top Bar
css = css.replace(/\.top-bar \{[\s\S]*?(?=:root\[data-theme='cyber'\] \.top-bar)/m, `.top-bar {
    flex: 0 0 auto;
    min-height: 70px;
    background: rgba(10, 14, 20, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 24px;
    gap: 16px;
    flex-wrap: wrap;
    z-index: 30;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
}

`);

// 5. Card Titles
css = css.replace(/\.card-title \{[\s\S]*?(?=:root\[data-theme='cyber'\] \.card-title)/m, `.card-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-family: var(--font-display);
    display: flex;
    align-items: center;
    gap: 8px;
}

.card-title::before {
    content: '';
    display: block;
    width: 4px;
    height: 12px;
    background: var(--gold);
    border-radius: 2px;
    box-shadow: 0 0 8px var(--gold-glow);
}

`);

fs.writeFileSync(cssPath, css);
console.log('Premium theme injected successfully!');
