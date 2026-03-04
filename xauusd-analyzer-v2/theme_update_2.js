const fs = require('fs');
const cssPath = './src/index.css';
let css = fs.readFileSync(cssPath, 'utf8');

// Custom Scrollbar
if (!css.includes('::-webkit-scrollbar')) {
    css += `

/* Premium Custom Scrollbars */
::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
::-webkit-scrollbar-track {
    background: transparent;
}
::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}

/* Base Adjustments */
* {
    selection-background: var(--accent-soft);
    selection-color: var(--accent);
}
::selection {
    background: var(--accent-soft);
    color: var(--text-main);
}
`;
}

// Enhance Badges
css = css.replace(/\.nt-badge-green \{[^}]+\}/g, `.nt-badge-green {
    background: linear-gradient(135deg, rgba(0, 230, 118, 0.15), rgba(0, 230, 118, 0.05));
    color: var(--buy);
    border: 1px solid rgba(0, 230, 118, 0.25);
    box-shadow: 0 0 10px rgba(0, 230, 118, 0.1);
}`);

css = css.replace(/\.nt-badge-red \{[^}]+\}/g, `.nt-badge-red {
    background: linear-gradient(135deg, rgba(255, 23, 68, 0.15), rgba(255, 23, 68, 0.05));
    color: var(--sell);
    border: 1px solid rgba(255, 23, 68, 0.25);
    box-shadow: 0 0 10px rgba(255, 23, 68, 0.1);
}`);

css = css.replace(/\.nt-badge-yellow \{[^}]+\}/g, `.nt-badge-yellow {
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.15), rgba(212, 175, 55, 0.05));
    color: var(--gold);
    border: 1px solid rgba(212, 175, 55, 0.25);
    box-shadow: 0 0 10px rgba(212, 175, 55, 0.1);
}`);

css = css.replace(/\.nt-badge-blue \{[^}]+\}/g, `.nt-badge-blue {
    background: linear-gradient(135deg, rgba(41, 121, 255, 0.15), rgba(41, 121, 255, 0.05));
    color: var(--accent);
    border: 1px solid rgba(41, 121, 255, 0.25);
    box-shadow: 0 0 10px rgba(41, 121, 255, 0.1);
}`);

// Enhance Buttons
css = css.replace(/\.inst-btn \{[\s\S]*?(?=\.inst-btn:hover)/m, `.inst-btn {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
    padding: 7px 16px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
`);

css = css.replace(/\.inst-btn:hover \{[\s\S]*?(?=\.inst-btn\.active)/m, `.inst-btn:hover {
    border-color: rgba(255, 255, 255, 0.2);
    color: var(--text-main);
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.06);
}
`);

css = css.replace(/\.inst-btn\.active \{[\s\S]*?(?=:root\[data-theme='cyber'\] \.inst-btn)/m, `.inst-btn.active {
    background: linear-gradient(90deg, rgba(212, 175, 55, 0.15), rgba(212, 175, 55, 0.05));
    border-color: rgba(212, 175, 55, 0.4);
    color: var(--gold);
    box-shadow: 0 0 16px rgba(212, 175, 55, 0.15), inset 0 0 8px rgba(212, 175, 55, 0.1);
}
`);

fs.writeFileSync(cssPath, css);
console.log('Scrollbars & Buttons enhanced');
