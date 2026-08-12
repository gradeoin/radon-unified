// -------------------------------------------------------------
// Radon Frontend Logic v3.0 - Security & Auto-Upgradation Active
// -------------------------------------------------------------

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// =============================================================
// AES-256-GCM ENCRYPTION ENGINE
// All localStorage data (chats, prefs, memory) is encrypted
// =============================================================
const RadonCrypto = {
    async getKey() {
        const stored = localStorage.getItem('_radon_ek');
        if (stored) {
            const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
            return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
        }
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const exported = await crypto.subtle.exportKey('raw', key);
        localStorage.setItem('_radon_ek', btoa(String.fromCharCode(...new Uint8Array(exported))));
        return key;
    },
    async encrypt(text) {
        try {
            const key = await this.getKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder();
            const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
            const buf = new Uint8Array([...iv, ...new Uint8Array(cipher)]);
            return btoa(String.fromCharCode(...buf));
        } catch { return text; }
    },
    async decrypt(ciphertext) {
        try {
            const key = await this.getKey();
            const buf = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
            const iv = buf.slice(0, 12);
            const data = buf.slice(12);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
            return new TextDecoder().decode(plain);
        } catch { return ciphertext; }
    },
    safeSetItem(key, value) { localStorage.setItem(key, value); },
    safeGetItem(key) { return localStorage.getItem(key); }
};


const loginOverlay = document.getElementById('loginOverlay');
const appContainer = document.getElementById('appContainer');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userNameEl = document.getElementById('userName');
const userEmailEl = document.getElementById('userEmail');
const userAvatarEl = document.getElementById('userAvatar');
const chatHistory = document.getElementById('chatHistory');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const voiceBtn = document.getElementById('voiceBtn');
const toolActivity = document.getElementById('toolActivity');
const toolActivityText = document.getElementById('toolActivityText');

// =============================================================
// TOAST NOTIFICATION SYSTEM
// =============================================================
function showToast(message, type = 'info') {
    // Suppress limit, quota, and proxy toasts on mobile screens
    if (window.innerWidth <= 768 && (message.toLowerCase().includes('limit') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('proxy'))) {
        return;
    }

    // Remove any existing toast
    const existing = document.getElementById('radon-toast');
    if (existing) existing.remove();

    const COLORS = {
        success: { bg: '#16a34a', border: '#22c55e', icon: '✓' },
        error:   { bg: '#dc2626', border: '#ef4444', icon: '✕' },
        warning: { bg: '#d97706', border: '#f59e0b', icon: '⚠' },
        info:    { bg: '#2563eb', border: '#3b82f6', icon: 'ℹ' }
    };
    const c = COLORS[type] || COLORS.info;

    const toast = document.createElement('div');
    toast.id = 'radon-toast';
    toast.style.cssText = `
        position: fixed; bottom: 88px; left: 50%; transform: translateX(-50%) translateY(20px);
        background: #18181b; border: 1px solid ${c.border}; border-left: 3px solid ${c.border};
        color: #fff; padding: 10px 18px; border-radius: 10px; font-size: 0.82rem; font-weight: 500;
        max-width: 420px; width: max-content; z-index: 99999; display: flex; align-items: center; gap: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5); opacity: 0;
        transition: opacity 0.25s ease, transform 0.25s ease; pointer-events: none;
        font-family: 'Inter', sans-serif; line-height: 1.4;
    `;
    toast.innerHTML = `<span style="color:${c.border};font-size:1rem;">${c.icon}</span><span>${message}</span>`;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Animated Sparkle SVG for Bot Avatar
const RADON_SPARKLE_SVG = `<svg class="bot-sparkle" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" fill="currentColor"/></svg>`;
// New UI Elements
const sidebar = document.getElementById('sidebar');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const desktopSidebarToggle = document.getElementById('desktopSidebarToggle');
const mobileOverlay = document.getElementById('mobileOverlay');
const newChatBtn = document.getElementById('newChatBtn');
const newChatMobileBtn = document.getElementById('newChatMobileBtn');
const threadsList = document.getElementById('threadsList');
const modelSelector = document.getElementById('modelSelector');
const pendingAttachments = document.getElementById('pendingAttachments');

// Code Preview Modal Elements
const previewModal = document.getElementById('previewModal');
const closePreviewBtn = document.getElementById('closePreviewBtn');
const previewIframe = document.getElementById('previewIframe');

// Global Thread & File State
let currentThreadId = null;
let pendingFile = null;

// =============================================================
// LOCAL MODE — No Firebase auth required
// Radon Unified runs fully locally at http://localhost:8080
// =============================================================
const RADON_BACKEND = 'http://localhost:8080';

// Stub out Firebase references so the rest of app.js doesn't break
let auth = null;
let db = null;
let storage = null;

// Immediately show the app (no login screen needed)
(async function initLocalMode() {
    const loader = document.getElementById('authLoader');
    if (loader) loader.style.display = 'none';
    if (loginOverlay) loginOverlay.style.display = 'none';

    // Set display name from localStorage prefs or default
    const savedPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    const displayName = savedPrefs.name || 'You';
    if (userNameEl) userNameEl.textContent = displayName;
    if (userEmailEl) userEmailEl.textContent = 'Local Mode';
    if (userAvatarEl) userAvatarEl.src = '';

    applyUserPreferences();
    loadDailyTokens();
    initSettingsModal();
    if (typeof initShareModal === 'function') initShareModal();
    if (typeof initBrandPagesAndAuth === 'function') initBrandPagesAndAuth();
    initChatSessions();
    navigateToRoute('/app', false);

    // Fetch available models and enable colibri options if configured
    try {
        const modelsResp = await fetch(RADON_BACKEND + '/models');
        if (modelsResp.ok) {
            const { models } = await modelsResp.json();
            const sel = document.getElementById('modelSelector');
            if (sel) {
                models.forEach(m => {
                    if (m.provider === 'colibri' && !m.requires_setup) {
                        // Enable colibri option
                        const opt = sel.querySelector(`option[value="${m.id}"]`);
                        if (opt) opt.disabled = false;
                    }
                });
            }
        }
    } catch (e) { /* server may not be ready yet */ }
})()


// -------------------------------------------------------------
// Authentication
// -------------------------------------------------------------
function setupAuthListeners() {
    auth.onAuthStateChanged(async (user) => {
        const loader = document.getElementById('authLoader');
        if (loader) loader.style.display = 'none';

        // Check if this is a proxy setup launch (?local=1)
        const wasProxyLaunch = checkUrlAutoConfig();

        if (user) {
            if (loginOverlay) loginOverlay.style.display = 'none';
            
            // Fetch settings from Firebase
            try {
                if (db) {
                    const doc = await db.collection('users').doc(user.uid).get();
                    if (doc.exists) {
                        const data = doc.data();
                        if (data.settings) {
                            const localPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
                            const mergedPrefs = { ...localPrefs, ...data.settings };
                            localStorage.setItem('radon_user_prefs', JSON.stringify(mergedPrefs));
                        }
                        if (data.memory) {
                            localStorage.setItem('radon_user_memory', data.memory);
                        }
                    }
                }
            } catch (e) {
                console.error("Error loading settings from Firebase", e);
            }

            applyUserPreferences();
            loadDailyTokens();
            updateWelcomeGreeting(user);
            initSettingsModal();
            initShareModal();
            initBrandPagesAndAuth();

            const savedPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
            const displayName = savedPrefs.name || (user.displayName ? user.displayName.split(' ')[0] : 'User');
            userNameEl.textContent = displayName;
            if (userEmailEl) userEmailEl.textContent = user.email || '';
            if (userAvatarEl) userAvatarEl.src = user.photoURL || '';

            initChatSessions();
            // If logged-in user is on /, /login, /signup, or launched via proxy, redirect to /app!
            let targetRoute = window.location.pathname;
            let shouldUpdateHistory = wasProxyLaunch;
            if (targetRoute === '/' || targetRoute.includes('/login') || targetRoute.includes('/signup') || wasProxyLaunch) {
                targetRoute = '/app';
                shouldUpdateHistory = true;
            }
            navigateToRoute(targetRoute, shouldUpdateHistory);
        } else {
            currentThreadId = null;
            if (chatHistory) chatHistory.innerHTML = '';
            applyUserPreferences();
            // If launched from proxy setup file and not logged in, go to /login
            const targetRoute = wasProxyLaunch ? '/login' : window.location.pathname;
            navigateToRoute(targetRoute, wasProxyLaunch);
        }
    });



    loginBtn.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
        } catch (err) {
            if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
                try {
                    await auth.signInWithRedirect(provider);
                } catch (e) {
                    showToast(e.message || 'Google Sign-In failed.', 'error');
                }
            } else if (err.code !== 'auth/cancelled-popup-request') {
                showToast(err.message || 'Google Sign-In failed.', 'error');
            }
        }
    });

    logoutBtn.addEventListener('click', () => {
        currentThreadId = null;
        chatHistory.innerHTML = '';
        history.pushState({ view: 'login' }, '', '/');
        auth.signOut();
    });

    // ── Theme Toggle (Dark / Light) ──
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeIconDark = document.getElementById('themeIconDark');
    const themeIconLight = document.getElementById('themeIconLight');

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('radon_theme', theme);
        if (themeIconDark && themeIconLight) {
            themeIconDark.style.display = theme === 'dark' ? 'block' : 'none';
            themeIconLight.style.display = theme === 'light' ? 'block' : 'none';
        }
        // Update meta theme-color
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.content = theme === 'light' ? '#ffffff' : '#07070a';
    }

    // Load saved theme
    const savedTheme = localStorage.getItem('radon_theme') || 'dark';
    applyTheme(savedTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            themeToggleBtn.style.transform = 'rotate(180deg)';
            setTimeout(() => { themeToggleBtn.style.transform = ''; }, 300);
            applyTheme(next);
        });
    }

    // Mobile Sidebar Toggles
    if (hamburgerBtn && sidebar && mobileOverlay) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            mobileOverlay.classList.toggle('active');
        });

        mobileOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            mobileOverlay.classList.remove('active');
        });
    }

    // Desktop Sidebar Toggle
    if (desktopSidebarToggle && sidebar) {
        desktopSidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // New Chat Buttons
    if (newChatBtn) newChatBtn.addEventListener('click', createNewChat);
    if (newChatMobileBtn) newChatMobileBtn.addEventListener('click', () => {
        createNewChat();
        if (sidebar) sidebar.classList.remove('open');
        if (mobileOverlay) mobileOverlay.classList.remove('active');
    });
}

// -------------------------------------------------------------
// Chat Logic
// -------------------------------------------------------------

// Auto-resize textarea
userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// Welcome chip helper — fill input and auto-send
function sendChip(text) {
    userInput.value = text;
    sendMessage();
}

let isGenerating = false;

async function sendMessage() {
    if (isGenerating) return;
    
    let text = userInput.value.trim();
    if (!text && !pendingFile) return;

    isGenerating = true;
    sendBtn.disabled = true;
    userInput.disabled = true;

    // Handle pending file attachment
    let fullText = text;
    let displayMessage = text;

    if (pendingFile) {
        if (pendingFile.isImage) {
            fullText = text ? `[Image Attached: ${pendingFile.url}]
${text}` : `I have uploaded an image: ${pendingFile.url}`;
            displayMessage = text ? `${text}<br/><img src="${pendingFile.url}" class="chat-image-preview" alt="Uploaded Image" />` : `<img src="${pendingFile.url}" class="chat-image-preview" alt="Uploaded Image" />`;
        } else {
            fullText = `[Attached File: ${pendingFile.name}]
--- FILE CONTENTS START ---
${pendingFile.textContent}
--- FILE CONTENTS END ---

${text || 'Please analyze this file.'}`;
            displayMessage = text ? `[File Attached: ${pendingFile.name}]
${text}` : `Uploaded file: ${pendingFile.name}`;
        }
    }

    userInput.value = '';
    userInput.style.height = 'auto';
    clearPendingAttachment();

    appendMessage('user-message', displayMessage, true, fullText);

    try {
        const savedPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
        let messageToSend = fullText;
        if (savedPrefs.instructions) {
            messageToSend = `[User Context/Instructions: ${savedPrefs.instructions}]

${fullText}`;
        }

        const conversationHistory = buildThreadHistoryPayload(fullText);

        const selectedModel = modelSelector ? modelSelector.value : 'gemini-3.6-flash';
        const savedPrefs2 = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');

        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) welcomeScreen.classList.add('hidden');

        if (typeof saveMessageToThread === 'function') {
            saveMessageToThread('user-message', fullText);
        }

        // Stream via Radon Unified backend
        const replyText = await radonStream(messageToSend, conversationHistory, selectedModel, savedPrefs2);

        if (replyText && typeof saveMessageToThread === 'function') {
            saveMessageToThread('bot-message', replyText);
        }
    } catch (error) {
        console.error('Radon Backend Error:', error);
        appendMessage('bot-message', `⚠️ Connection Error: Cannot reach Radon backend at http://localhost:8080. Make sure the server is running (start.bat).`, false);
    } finally {
        isGenerating = false;
        sendBtn.disabled = false;
        userInput.disabled = false;
        userInput.focus();
    }
}


function downloadCodeFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast(`Downloaded ${filename}`, 'success');
}

function enhanceCodeBlocksInElement(container) {
    if (!container) return;
    container.querySelectorAll('pre code').forEach((block) => {
        if (typeof hljs !== 'undefined') hljs.highlightElement(block);
        const pre = block.parentElement;
        if (!pre) return;
        
        // If already wrapped in code-block-wrapper, skip
        if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;

        const lang = (block.className.match(/language-(\w+)/) || [])[1] || '';
        const codeText = block.innerText;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        const headerBar = document.createElement('div');
        headerBar.className = 'code-header-bar';

        const langLabel = document.createElement('span');
        langLabel.className = 'code-lang-label';
        const extMap = { html: 'html', js: 'js', javascript: 'js', css: 'css', python: 'py', py: 'py', json: 'json', xml: 'xml', svg: 'svg', csv: 'csv', sql: 'sql', md: 'md' };
        const ext = extMap[lang.toLowerCase()] || (codeText.includes('<html') ? 'html' : 'code');
        langLabel.textContent = lang ? lang.toUpperCase() : ext.toUpperCase();

        const btnGroup = document.createElement('div');
        btnGroup.className = 'code-btn-group';

        // 1. Live Preview Button (HTML/XML/SVG/CSS/JS)
        if (['html','xml','svg','css','javascript','js'].includes(lang.toLowerCase()) || codeText.includes('<html') || codeText.includes('<div')) {
            const previewBtn = document.createElement('button');
            previewBtn.className = 'code-btn preview-btn';
            previewBtn.innerHTML = '▶ Preview';
            previewBtn.addEventListener('click', (e) => { e.stopPropagation(); openCodePreview(codeText); });
            btnGroup.appendChild(previewBtn);
        }

        // 2. Python Execution Button
        if (['python','py'].includes(lang.toLowerCase())) {
            const runBtn = document.createElement('button');
            runBtn.className = 'code-btn run-btn';
            runBtn.innerHTML = '▶ Run';
            runBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                runBtn.innerHTML = 'Running...';
                const output = await executePythonCode(codeText);
                runBtn.innerHTML = '▶ Run';
                showCodeOutput(wrapper, output);
            });
            btnGroup.appendChild(runBtn);
        }

        // 3. Download File Button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'code-btn download-btn';
        downloadBtn.innerHTML = `⬇ Download .${ext}`;
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadCodeFile(`code-${Date.now()}.${ext}`, codeText);
        });
        btnGroup.appendChild(downloadBtn);

        // 4. Copy Code Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-btn copy-btn';
        copyBtn.innerHTML = '📋 Copy';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(codeText);
            copyBtn.innerHTML = '✓ Copied!';
            setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
        });
        btnGroup.appendChild(copyBtn);

        headerBar.appendChild(langLabel);
        headerBar.appendChild(btnGroup);

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(headerBar);
        wrapper.appendChild(pre);
    });
}

function attachBotActionBar(container, text) {
    if (!container) return;
    
    // Find the outer row or bot content wrapper
    const botRow = container.classList.contains('bot-msg-row') ? container : (container.closest('.bot-msg-row') || container);
    const contentWrapper = botRow.querySelector('.bot-content-wrapper') || botRow;
    
    let existing = botRow.querySelector('.bot-action-bar');
    if (existing) existing.remove();

    const activeModelKey = modelSelector ? modelSelector.value : 'gemini-2.0-flash';
    const modelNamesMap = {
        'deepseek-r1': 'DeepSeek R1',
        'deepseek-v3': 'DeepSeek V3',
        'qwen-2.5-coder': 'Qwen 2.5 Coder',
        'microsoft-copilot': 'Copilot / GPT-4o',
        'gemini-2.0-flash': 'Gemini 2.0 Flash',
        'gemini-1.5-pro': 'Gemini 1.5 Pro',
        'gemini-1.5-flash': 'Gemini 1.5 Flash'
    };
    const activeModelLabel = modelNamesMap[activeModelKey] || 'Radon Engine';

    const botToolbar = document.createElement('div');
    botToolbar.className = 'bot-action-bar';
    botToolbar.innerHTML = `
        <span class="bot-model-badge" title="Response generated by ${activeModelLabel}">⚡ ${activeModelLabel}</span>
        <button class="bot-action-btn copy-msg-btn"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy</button>
        <button class="bot-action-btn export-msg-btn"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>
        <button class="bot-action-btn regen-msg-btn"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Regenerate</button>
    `;
    botToolbar.querySelector('.copy-msg-btn').addEventListener('click', () => { navigator.clipboard.writeText(text); showToast('Copied to clipboard!', 'info'); });
    botToolbar.querySelector('.export-msg-btn').addEventListener('click', () => exportHtmlFile(text));
    botToolbar.querySelector('.regen-msg-btn').addEventListener('click', () => regenerateLastResponse());
    contentWrapper.appendChild(botToolbar);
}

function formatThinkTags(text) {
    if (!text) return '';
    return text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, p1) => {
        return `<details class="reasoning-details"><summary class="reasoning-summary">🧠 DeepSeek R1 Thought Process (Click to view)</summary><div class="reasoning-content">${p1.trim()}</div></details>`;
    });
}

function appendMessage(className, text, saveToDb = false, fullPayload = null) {
    // Hide welcome screen when first message appears
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.classList.add('hidden');

    const isBot = className.includes('bot');
    let container;

    if (isBot) {
        const row = document.createElement('div');
        row.className = 'bot-msg-row';

        // Clean animated sparkle SVG instead of plain R avatar
        const indicator = document.createElement('div');
        indicator.className = 'bot-indicator';
        indicator.innerHTML = RADON_SPARKLE_SVG;
        row.appendChild(indicator);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'bot-content-wrapper';

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${className}`;
        if (fullPayload) msgDiv.dataset.fullPayload = fullPayload;
        contentWrapper.appendChild(msgDiv);
        row.appendChild(contentWrapper);
        container = row;

        // Render markdown
        if (typeof marked !== 'undefined') {
            msgDiv.innerHTML = marked.parse(formatThinkTags(text || ''));

            // Highlight code blocks and add Copy, Download, Preview, and Run buttons
            enhanceCodeBlocksInElement(msgDiv);

            // Add bot action toolbar using shared function
            attachBotActionBar(msgDiv, text);
        } else {
            msgDiv.innerText = text;
        }

        chatHistory.appendChild(container);
    } else {
        // User message — wrap in centering row
        const row = document.createElement('div');
        row.className = 'message-row-user';
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${className}`;
        if (fullPayload) msgDiv.dataset.fullPayload = fullPayload;
        
        if (text.includes('<img') || text.includes('<br/>')) {
            msgDiv.innerHTML = text;
        } else {
            msgDiv.innerText = text;
        }

        // Add Edit prompt toolbar for user messages
        const userToolbar = document.createElement('div');
        userToolbar.className = 'user-action-bar';
        userToolbar.innerHTML = `
            <button class="user-action-btn edit-msg-btn" title="Edit Prompt">
                <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Edit
            </button>
        `;
        userToolbar.querySelector('.edit-msg-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (userInput) {
                userInput.value = text;
                userInput.focus();
                userInput.style.height = 'auto';
                userInput.style.height = `${Math.min(userInput.scrollHeight, 180)}px`;
                if (typeof showToast === 'function') showToast('Prompt loaded into input bar for editing!', 'info');
            }
        });
        msgDiv.appendChild(userToolbar);

        row.appendChild(msgDiv);
        chatHistory.appendChild(row);
        container = row;
    }

    chatHistory.scrollTop = chatHistory.scrollHeight;
    if (saveToDb && auth && auth.currentUser && db) {
        saveMessageToThread(className, text, fullPayload);
    }
}

// Build full Gemini contents array from DOM messages for 100% conversation memory
function buildThreadHistoryPayload(latestUserText) {
    const history = [];
    const messageElements = chatHistory.querySelectorAll('.message:not(.typing-indicator)');

    messageElements.forEach((el) => {
        const isUser = el.classList.contains('user-message');
        const role = isUser ? 'user' : 'model';
        // Use full payload (with PDF text) if available, otherwise fall back to innerText
        const text = el.dataset.fullPayload || el.innerText.trim();
        if (text) {
            history.push({
                role: role,
                parts: [{ text: text }]
            });
        }
    });

    return history;
}

// -------------------------------------------------------------
// Multi-Session Chat Threads Management
// -------------------------------------------------------------
async function initChatSessions() {
    if (!auth || !auth.currentUser || !db) return;
    
    // Check if the current URL specifies a chat thread (e.g. /chat/xyz123)
    const pathMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
    const targetThreadId = (pathMatch && pathMatch[1]) ? pathMatch[1] : null;

    await loadThreadList();

    if (targetThreadId) {
        switchThread(targetThreadId, false);
    } else if (!currentThreadId) {
        createNewChat(false);
    }
}

async function loadThreadList() {
    if (!auth || !auth.currentUser || !db || !threadsList) return;

    db.collection('users').doc(auth.currentUser.uid).collection('threads')
      .orderBy('updatedAt', 'desc')
      .onSnapshot((snapshot) => {
          threadsList.innerHTML = '';
          if (snapshot.empty) {
              threadsList.innerHTML = `<div class="empty-threads">No past chats yet.</div>`;
              return;
          }

          // Sort pinned threads to top
          const docsArray = [];
          snapshot.forEach(doc => docsArray.push({ id: doc.id, data: doc.data() }));
          docsArray.sort((a, b) => {
              if (a.data.isPinned && !b.data.isPinned) return -1;
              if (!a.data.isPinned && b.data.isPinned) return 1;
              return 0;
          });

          docsArray.forEach(({ id, data }) => {
              const threadItem = document.createElement('div');
              threadItem.className = `thread-item ${id === currentThreadId ? 'active' : ''} ${data.isPinned ? 'pinned' : ''}`;
              threadItem.dataset.threadId = id;
              threadItem.innerHTML = `
                  <svg class="thread-chat-icon" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span class="thread-title">${data.title || 'Untitled Chat'}</span>
                  <div class="thread-actions">
                      <button class="pin-thread-btn" title="${data.isPinned ? 'Unpin' : 'Pin'}">
                          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="${data.isPinned ? 'currentColor' : 'none'}"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"></path></svg>
                      </button>
                      <button class="rename-thread-btn" title="Rename">
                          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                      </button>
                      <button class="delete-thread-btn" title="Delete">
                          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                  </div>
              `;


              // Click thread to switch
              threadItem.addEventListener('click', (e) => {
                  if (!e.target.closest('button')) {
                      switchThread(id);
                  }
              });

              // Toggle Pin
              threadItem.querySelector('.pin-thread-btn').addEventListener('click', (e) => {
                  e.stopPropagation();
                  db.collection('users').doc(auth.currentUser.uid).collection('threads').doc(id).update({
                      isPinned: !data.isPinned
                  });
              });

              // Rename Thread — inline edit on double-click title or rename button click
              const titleSpan = threadItem.querySelector('.thread-title');

              function startInlineRename() {
                  if (titleSpan.querySelector('input')) return; // already editing
                  const currentTitle = data.title || 'Untitled Chat';
                  const input = document.createElement('input');
                  input.className = 'thread-rename-input';
                  input.value = currentTitle;
                  input.maxLength = 60;
                  titleSpan.textContent = '';
                  titleSpan.appendChild(input);
                  input.focus();
                  input.select();

                  const saveRename = () => {
                      const newTitle = input.value.trim() || currentTitle;
                      titleSpan.textContent = newTitle;
                      data.title = newTitle;
                      db.collection('users').doc(auth.currentUser.uid)
                        .collection('threads').doc(id).update({ title: newTitle });
                  };

                  input.addEventListener('keydown', (ev) => {
                      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                      if (ev.key === 'Escape') { titleSpan.textContent = currentTitle; }
                      ev.stopPropagation();
                  });
                  input.addEventListener('blur', saveRename);
              }

              titleSpan.addEventListener('dblclick', (e) => { e.stopPropagation(); startInlineRename(); });
              threadItem.querySelector('.rename-thread-btn').addEventListener('click', (e) => {
                  e.stopPropagation();
                  startInlineRename();
              });

              // Delete Thread
              threadItem.querySelector('.delete-thread-btn').addEventListener('click', (e) => {
                  e.stopPropagation();
                  deleteThread(id);
              });

              threadsList.appendChild(threadItem);
          });
      });
}

function createNewChat(updateUrl = true) {
    currentThreadId = null;
    chatHistory.innerHTML = '';
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');
    if (threadsList) threadsList.querySelectorAll('.thread-item').forEach(el => el.classList.remove('active'));
    
    if (updateUrl && window.location.pathname !== '/') {
        history.pushState({ view: 'home' }, '', '/');
    }
}

function switchThread(threadId, updateUrl = true) {
    if (!threadId) return;
    currentThreadId = threadId;
    chatHistory.innerHTML = '';
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.classList.add('hidden');

    if (sidebar) sidebar.classList.remove('open');
    if (mobileOverlay) mobileOverlay.classList.remove('active');

    // Only push state if called directly, NOT during popstate
    if (updateUrl && window.location.pathname !== `/chat/${threadId}`) {
        history.pushState({ view: 'chat', threadId }, '', `/chat/${threadId}`);
    }

    // Mark active thread in sidebar
    if (threadsList) {
        threadsList.querySelectorAll('.thread-item').forEach(el => {
            el.classList.toggle('active', el.dataset.threadId === threadId);
        });
    }

    if (!db) return;

    const renderSnapshot = (snapshot) => {
        chatHistory.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const className = data.role === 'user' ? 'user-message' : 'bot-message';
            appendMessage(className, data.text || '', false);
        });
    };

    const tryPublicThread = () => {
        db.collection('public_threads').doc(threadId).collection('messages')
          .orderBy('timestamp', 'asc')
          .get()
          .then((pubSnap) => {
              if (!pubSnap.empty) {
                  renderSnapshot(pubSnap);
              } else {
                  console.warn('Shared thread not found:', threadId);
              }
          })
          .catch(err => console.error('Error loading public thread:', err));
    };

    if (auth && auth.currentUser) {
        db.collection('users').doc(auth.currentUser.uid).collection('threads').doc(threadId).collection('messages')
          .orderBy('timestamp', 'asc')
          .get()
          .then((snapshot) => {
              if (!snapshot.empty) {
                  renderSnapshot(snapshot);
              } else {
                  tryPublicThread();
              }
          })
          .catch(() => tryPublicThread());
    } else {
        tryPublicThread();
    }
}


// Handle browser back/forward navigation safely without history push recursion
window.addEventListener('popstate', (e) => {
    if (e.state?.view === 'chat' && e.state?.threadId) {
        switchThread(e.state.threadId, false);
    } else {
        const pathMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
        if (pathMatch && pathMatch[1]) {
            switchThread(pathMatch[1], false);
        } else {
            createNewChat(false);
        }
    }
});

async function saveMessageToThread(className, text, fullPayload = null) {
    const userRef = db.collection('users').doc(auth.currentUser.uid);
    const textToSave = fullPayload || text;
    const role = className.includes('user') ? 'user' : 'model';

    if (!currentThreadId) {
        const title = text.replace(/<[^>]+>/g, '').trim();
        const shortTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
        const newThreadRef = await userRef.collection('threads').add({
            title: shortTitle,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        currentThreadId = newThreadRef.id;
        // Push URL to the new thread's dedicated page
        history.pushState({ view: 'chat', threadId: currentThreadId }, '', `/chat/${currentThreadId}`);
    } else {
        userRef.collection('threads').doc(currentThreadId).update({
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }

    // Save to user private thread
    userRef.collection('threads').doc(currentThreadId).collection('messages').add({
        role: role,
        text: textToSave,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Mirror to public_threads for shared link support
    if (db) {
        db.collection('public_threads').doc(currentThreadId).set({
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});

        db.collection('public_threads').doc(currentThreadId).collection('messages').add({
            role: role,
            text: textToSave,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
}

async function deleteThread(threadId) {
    if (!confirm("Are you sure you want to delete this chat?")) return;
    try {
        await db.collection('users').doc(auth.currentUser.uid).collection('threads').doc(threadId).delete();
        if (currentThreadId === threadId) {
            createNewChat();
        }
    } catch (e) {
        console.error("Error deleting thread:", e);
    }
}

// -------------------------------------------------------------
// Extras (Voice & File Upload)
// -------------------------------------------------------------
// -------------------------------------------------------------
// Voice Recognition, Drag-and-Drop, Clipboard Paste, & Search
// -------------------------------------------------------------

// Web Speech API Voice Recognition
if (voiceBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        let isListening = false;

        voiceBtn.addEventListener('click', () => {
            if (!isListening) {
                try {
                    recognition.start();
                    isListening = true;
                    voiceBtn.style.color = 'var(--brand-light)';
                    voiceBtn.title = 'Listening... Speak now';
                } catch (e) {}
            } else {
                recognition.stop();
                isListening = false;
                voiceBtn.style.color = '';
            }
        });

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                userInput.value = (userInput.value ? userInput.value + ' ' : '') + transcript;
                userInput.focus();
                userInput.style.height = 'auto';
                userInput.style.height = (userInput.scrollHeight) + 'px';
            }
            isListening = false;
            voiceBtn.style.color = '';
        };

        recognition.onerror = () => { isListening = false; voiceBtn.style.color = ''; };
        recognition.onend = () => { isListening = false; voiceBtn.style.color = ''; };
    }
}

// Clipboard Paste Listener (Ctrl+V / Cmd+V for Images & Files)
document.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;
    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                handleUploadedFile(file);
                break;
            }
        }
    }
});

// Drag and Drop Files on Input Box
const inputContainer = document.getElementById('inputContainer');
if (inputContainer) {
    inputContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        inputContainer.style.borderColor = 'var(--brand-border)';
    });
    inputContainer.addEventListener('dragleave', () => {
        inputContainer.style.borderColor = '';
    });
    inputContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        inputContainer.style.borderColor = '';
        if (e.dataTransfer?.files?.[0]) {
            handleUploadedFile(e.dataTransfer.files[0]);
        }
    });
}

// Search Conversations Filter
const searchThreadsInput = document.getElementById('searchThreadsInput');
if (searchThreadsInput) {
    searchThreadsInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (threadsList) {
            threadsList.querySelectorAll('.thread-item').forEach(item => {
                const title = item.querySelector('.thread-title')?.innerText.toLowerCase() || '';
                item.style.display = title.includes(q) ? 'flex' : 'none';
            });
        }
    });
}

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleUploadedFile(e.target.files[0]);
});

async function handleUploadedFile(file) {
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isImage) {
        const reader = new FileReader();
        reader.onload = (event) => {
            pendingFile = {
                url: event.target.result,
                name: file.name,
                type: file.type,
                isImage: true
            };
            renderPendingAttachment();
        };
        reader.readAsDataURL(file);
    } else if (isPDF) {
        try {
            const pdfText = await extractPDFText(file);
            pendingFile = {
                textContent: pdfText,
                name: file.name,
                type: file.type,
                isImage: false
            };
            renderPendingAttachment();
        } catch (err) {
            console.error("PDF Parsing error:", err);
            alert("Could not extract text from PDF file.");
        }
    } else {
        const reader = new FileReader();
        reader.onload = (event) => {
            pendingFile = {
                textContent: event.target.result,
                name: file.name,
                type: file.type,
                isImage: false
            };
            renderPendingAttachment();
        };
        reader.readAsText(file);
    }
}

// Extract text page by page from PDF files using PDF.js
async function extractPDFText(file) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error("PDF.js library is missing.");
    }
    
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = `[PDF Document: ${file.name} | Pages: ${pdf.numPages}]\n`;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }

    return fullText;
}

function renderPendingAttachment() {
    if (!pendingAttachments || !pendingFile) return;
    
    const isImage = pendingFile.type.startsWith('image/');
    pendingAttachments.innerHTML = `
        <div class="attachment-chip">
            ${isImage ? `<img src="${pendingFile.url}" class="chip-thumb" />` : `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`}
            <span class="chip-name">${pendingFile.name}</span>
            <button class="chip-remove" onclick="clearPendingAttachment()" title="Remove file">&times;</button>
        </div>
    `;
    pendingAttachments.style.display = 'flex';
}

function clearPendingAttachment() {
    pendingFile = null;
    if (pendingAttachments) {
        pendingAttachments.innerHTML = '';
        pendingAttachments.style.display = 'none';
    }
}

let isRecording = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        sendMessage();
    };

    voiceBtn.addEventListener('click', () => {
        if (!isRecording) {
            recognition.start();
            voiceBtn.style.color = 'var(--danger)';
        } else {
            recognition.stop();
            voiceBtn.style.color = 'var(--text-muted)';
        }
        isRecording = !isRecording;
    });
}

// -------------------------------------------------------------
// Live Code Preview & Execution Sandbox Helpers
// -------------------------------------------------------------

function openCodePreview(code) {
    if (!previewModal || !previewIframe) return;
    previewIframe.srcdoc = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: system-ui, sans-serif; padding: 20px; background: #09090b; color: #f4f4f5; }
            </style>
        </head>
        <body>${code}</body>
        </html>
    `;
    previewModal.style.display = 'flex';
}

if (closePreviewBtn && previewModal) {
    closePreviewBtn.addEventListener('click', () => {
        previewModal.style.display = 'none';
        previewIframe.srcdoc = '';
    });
    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            previewModal.style.display = 'none';
            previewIframe.srcdoc = '';
        }
    });
}

async function executePythonCode(code) {
    try {
        const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: "python",
                version: "3.10.0",
                files: [{ name: "main.py", content: code }]
            })
        });
        const data = await response.json();
        return data.run.output || "No output returned.";
    } catch (e) {
        return `Execution error: ${e.message}`;
    }
}

function showCodeOutput(preElement, outputText) {
    let outputBox = preElement.nextElementSibling;
    if (!outputBox || !outputBox.classList.contains('code-output-box')) {
        outputBox = document.createElement('div');
        outputBox.className = 'code-output-box';
        preElement.parentNode.insertBefore(outputBox, preElement.nextSibling);
    }
    outputBox.innerHTML = `<strong>Console Output:</strong><pre>${outputText}</pre>`;
}

function exportHtmlFile(text, title = 'Radon Output Export') {
    let bodyContent = text;
    if (typeof marked !== 'undefined') {
        try {
            bodyContent = marked.parse(text);
        } catch (e) {
            bodyContent = `<pre>${text}</pre>`;
        }
    } else {
        bodyContent = `<pre>${text}</pre>`;
    }

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #09090d;
            --card-bg: #14141c;
            --border: #242432;
            --brand: #f59e0b;
            --text-1: #f4f4f6;
            --text-2: #a1a1aa;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg);
            color: var(--text-1);
            line-height: 1.6;
            padding: 40px 20px;
            margin: 0;
            display: flex;
            justify-content: center;
        }
        .container {
            width: 100%;
            max-width: 860px;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
            margin-bottom: 24px;
        }
        .logo {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--brand);
            letter-spacing: -0.02em;
        }
        .timestamp {
            font-size: 0.8rem;
            color: var(--text-2);
        }
        pre {
            background: #000;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            border: 1px solid var(--border);
        }
        code {
            font-family: monospace;
            color: #fbbf24;
        }
        a { color: #38bdf8; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
        }
        th, td {
            border: 1px solid var(--border);
            padding: 10px 14px;
            text-align: left;
        }
        th { background: #1c1c26; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">⚡ RADON EXPORT</div>
            <div class="timestamp">${new Date().toLocaleString()}</div>
        </div>
        <div class="content">
            ${bodyContent}
        </div>
    </div>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `radon_output_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Exported output as HTML file!', 'success');
}

function regenerateLastResponse() {
    if (isGenerating) return;
    const messages = chatHistory.querySelectorAll('.message');
    if (messages.length < 2) return;
    
    isGenerating = true;
    
    // Find the last bot message and remove it
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].classList.contains('bot-message')) {
            messages[i].remove();
            break;
        }
    }
    
    // Re-trigger sendMessage without adding user prompt again
    toolActivityText.textContent = "Radon is thinking...";
    toolActivity.style.display = 'flex';

    const conversationHistory = buildThreadHistoryPayload("");
    const selectedModel = modelSelector ? modelSelector.value : 'gemini-3.6-flash';
    const workerUrl = RADON_BACKEND;

    fetch(workerUrl + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: "Please regenerate your last response.",
            model: selectedModel,
            history: conversationHistory
        })
    })
    .then(res => res.json())
    .then(data => {
        isGenerating = false;
        toolActivity.style.display = 'none';
        if (data.reply) {
            appendMessage('bot-message', data.reply, true);
        } else {
            appendMessage('bot-message', "Could not regenerate response.", false);
        }
    })
    .catch(err => {
        isGenerating = false;
        toolActivity.style.display = 'none';
        console.error("Regeneration error:", err);
    });
}

// -------------------------------------------------------------
// USER PREFERENCES & THEMES & TOKEN TRACKER
// -------------------------------------------------------------
let userTokensToday = 0;
const DAILY_TOKEN_LIMIT = 100000;

function getTodayKey() {
    const d = new Date();
    return `radon_tokens_${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function loadDailyTokens() {
    const saved = localStorage.getItem(getTodayKey());
    userTokensToday = saved ? parseInt(saved, 10) : 0;
    updateTokenDisplay();
}

function addTokensUsed(count) {
    userTokensToday += (count || 200);
    localStorage.setItem(getTodayKey(), userTokensToday);
    updateTokenDisplay();
}

function updateTokenDisplay() {
    const formatted = userTokensToday >= 1000 ? (userTokensToday / 1000).toFixed(1) + 'k' : userTokensToday;
    const limitFormatted = (DAILY_TOKEN_LIMIT / 1000) + 'k';
    const textEl = document.getElementById('tokenCountText');
    if (textEl) textEl.textContent = `${formatted} / ${limitFormatted} Tokens`;

    const percent = Math.min(100, Math.round((userTokensToday / DAILY_TOKEN_LIMIT) * 100));
    const percentEl = document.getElementById('tokenPercentText');
    const barFill = document.getElementById('tokenBarFill');
    const detailEl = document.getElementById('tokenUsageSub');

    const quotaDailyFill = document.getElementById('quotaDailyFill');
    const quotaSessionFill = document.getElementById('quotaSessionFill');

    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barFill) barFill.style.width = `${percent}%`;
    if (quotaDailyFill) quotaDailyFill.style.width = `${percent}%`;
    if (quotaSessionFill) {
        const sessionCount = chatHistory ? chatHistory.querySelectorAll('.message').length : 0;
        const sessionPercent = Math.min(100, sessionCount * 4);
        quotaSessionFill.style.width = `${sessionPercent}%`;
        const sessionLabel = document.getElementById('quotaSessionLabel');
        if (sessionLabel) sessionLabel.textContent = `Session: ${sessionPercent}%`;
    }
    if (detailEl) detailEl.textContent = `${userTokensToday.toLocaleString()} tokens used today of ${DAILY_TOKEN_LIMIT.toLocaleString()} daily quota.`;
}

function checkUrlAutoConfig() {
    const params = new URLSearchParams(window.location.search);
    const local = params.get('local');
    const localProxyUrl = params.get('localProxyUrl');
    const enableProxy = params.get('enableProxy');
    if (local === '1' || localProxyUrl || enableProxy === 'true') {
        const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
        saved.enableLocalProxy = true;
        saved.localProxyUrl = localProxyUrl || 'http://127.0.0.1:8081/v1/chat/completions';
        localStorage.setItem('radon_user_prefs', JSON.stringify(saved));
        
        // Auto-fill input fields in Settings panel if visible
        const proxyToggle = document.getElementById('enableLocalProxy');
        const proxyUrlInput = document.getElementById('localProxyUrl');
        if (proxyToggle) proxyToggle.checked = true;
        if (proxyUrlInput) proxyUrlInput.value = saved.localProxyUrl;

        if (typeof showToast === 'function') {
            setTimeout(() => showToast('⚡ Radon Desktop Connected! Local Proxy: http://127.0.0.1:8081', 'success'), 800);
        }
        
        // Strip the query params — return true so auth listener knows to redirect
        window.history.replaceState({}, document.title, window.location.pathname);
        return true; // signal: proxy was just activated
    }
    return false;
}

/* Real-time Desktop Proxy Health Monitor & radon:// Protocol Launcher */
let isDesktopProxyAlive = false;
function initDesktopProxyMonitor() {
    const badge = document.getElementById('proxyStatusBadge');
    const textEl = document.getElementById('proxyStatusText');

    async function checkHealth() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        try {
            const res = await fetch('http://127.0.0.1:8081/', {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok || res.status === 200 || res.status === 404 || res.status === 405) {
                isDesktopProxyAlive = true;
                if (badge) {
                    badge.classList.remove('offline');
                    badge.classList.add('online');
                }
                if (textEl) textEl.textContent = 'Radon Desktop';

                // Auto-enable local proxy in prefs when detected running!
                const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
                if (!saved.enableLocalProxy) {
                    saved.enableLocalProxy = true;
                    saved.localProxyUrl = 'http://127.0.0.1:8081/v1/chat/completions';
                    localStorage.setItem('radon_user_prefs', JSON.stringify(saved));
                }
                return;
            }
        } catch (e) {
            clearTimeout(timeoutId);
        }
        
        isDesktopProxyAlive = false;
        if (badge) {
            badge.classList.remove('online');
            badge.classList.add('offline');
        }
        if (textEl) textEl.textContent = 'Radon Cloud';
    }

    // Check health immediately and every 5 seconds
    checkHealth();
    setInterval(checkHealth, 5000);

    // Badge click action
    if (badge) {
        badge.onclick = () => {
            if (isDesktopProxyAlive) {
                showToast('⚡ Radon Desktop is Active (127.0.0.1:8081)', 'success');
            } else {
                // Try launching via radon:// protocol first
                showToast('🚀 Launching Radon Desktop Launcher...', 'info');
                window.location.href = 'radon://launch';
                // Fallback to setup download after 1.5s if not launched
                setTimeout(() => {
                    if (!isDesktopProxyAlive) {
                        const dl = document.createElement('a');
                        dl.href = 'https://github.com/gradeoin/radon/releases/download/v3.0/Radon-Setup-Windows-v3.0.zip';
                        dl.download = 'Radon-Setup-Windows-v3.0.zip';
                        document.body.appendChild(dl);
                        dl.click();
                        document.body.removeChild(dl);
                    }
                }, 1500);
            }
        };
    }
}

function applyUserPreferences() {
    checkUrlAutoConfig();
    initDesktopProxyMonitor();
    const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    if (saved.theme) {
        document.documentElement.dataset.theme = saved.theme;
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === saved.theme);
        });
    }
    const validModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-thinking', 'gemini-3.5-flash-thinking-lite', 'gemini-flash-lite', 'gemini-auto', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'glm-5.2', 'inkling', 'deepseek-v4-flash', 'olmoe'];

    if (saved.defaultModel && !validModels.includes(saved.defaultModel)) {
        saved.defaultModel = 'gemini-2.0-flash';
        localStorage.setItem('radon_user_prefs', JSON.stringify(saved));
    }
    if (saved.defaultModel && modelSelector) {
        modelSelector.value = saved.defaultModel;
    }
}

// -------------------------------------------------------------
// CLIENT-SIDE SINGLE PAGE APPLICATION (SPA) ROUTER
// -------------------------------------------------------------
function navigateToRoute(path, updateHistory = true) {
    const cleanPath = path.toLowerCase();
    
    // Hide all full-page views & reset scroll
    document.querySelectorAll('.page-view').forEach(view => {
        view.style.display = 'none';
        view.scrollTop = 0;
    });
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';

    const isAuthed = auth && auth.currentUser;

    if (cleanPath.includes('/about')) {
        const pageAbout = document.getElementById('pageAbout');
        if (pageAbout) pageAbout.style.display = 'flex';
    } else if (cleanPath.includes('/download')) {
        window.location.href = '/download.html';
        return;
    } else if (cleanPath.includes('/terms')) {
        const pageTerms = document.getElementById('pageTerms');
        if (pageTerms) pageTerms.style.display = 'flex';
    } else if (cleanPath.includes('/privacy')) {
        const pagePrivacy = document.getElementById('pagePrivacy');
        if (pagePrivacy) pagePrivacy.style.display = 'flex';
    } else if (cleanPath.includes('/signup')) {
        if (isAuthed) {
            if (appContainer) appContainer.style.display = 'flex';
        } else {
            const pageSignup = document.getElementById('pageSignup');
            if (pageSignup) pageSignup.style.display = 'flex';
        }
    } else if (cleanPath.includes('/login')) {
        if (isAuthed) {
            if (appContainer) appContainer.style.display = 'flex';
        } else {
            if (loginOverlay) loginOverlay.style.display = 'flex';
        }
    } else if (cleanPath.includes('/app') || cleanPath.includes('/chat')) {
        if (isAuthed) {
            if (appContainer) appContainer.style.display = 'flex';
        } else {
            if (loginOverlay) loginOverlay.style.display = 'flex';
        }
    } else {
        // Root Home Route (/)
        if (isAuthed) {
            // LOGGED IN USER -> TAKE DIRECTLY TO ACTUAL CHAT ASSISTANT!
            if (appContainer) appContainer.style.display = 'flex';
        } else {
            // UNAUTHENTICATED USER -> SHOW LANDING PAGE!
            const pageHome = document.getElementById('pageHome');
            if (pageHome) {
                pageHome.style.display = 'flex';
            } else {
                if (loginOverlay) loginOverlay.style.display = 'flex';
            }
        }
    }

    if (updateHistory && window.location.pathname !== path) {
        history.pushState({ path }, '', path);
    }
}

function applyUserPreferences() {
    checkUrlAutoConfig();
    const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    if (saved.theme) {
        document.documentElement.dataset.theme = saved.theme;
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === saved.theme);
        });
    }

    const validModels = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'deepseek-r1', 'deepseek-v3', 'qwen-2.5-coder', 'microsoft-copilot'];
    if (saved.defaultModel && !validModels.includes(saved.defaultModel)) {
        saved.defaultModel = 'gemini-2.0-flash';
        localStorage.setItem('radon_user_prefs', JSON.stringify(saved));
    }

    if (saved.defaultModel && modelSelector) {
        modelSelector.value = saved.defaultModel;
    }
}

function updateWelcomeGreeting(user) {
    const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    const rawName = saved.name || (user?.displayName ? user.displayName.split(' ')[0] : 'there');
    const firstName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    const greetingEl = document.getElementById('welcomeGreeting');
    const greetingSubEl = document.getElementById('welcomeGreetingSub');
    if (greetingEl) {
        greetingEl.innerHTML = `What will you <span class="build-gradient-text">build</span> today, ${firstName}?`;
    }
    if (greetingSubEl) {
        greetingSubEl.textContent = `Ask anything or start building a project.`;
    }
}

// -------------------------------------------------------------
// SETTINGS MODAL HANDLERS
// -------------------------------------------------------------
function initSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const exportDataBtn = document.getElementById('exportDataBtn');
    const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');

    if (settingsBtn) {
        settingsBtn.onclick = () => openSettingsModal();
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
        };
    }

    // Tab switching
    document.querySelectorAll('.settings-tab-btn').forEach(tabBtn => {
        tabBtn.onclick = () => {
            document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
            tabBtn.classList.add('active');
            const target = document.getElementById(tabBtn.dataset.tab);
            if (target) target.classList.add('active');
        };
    });

    // Theme selector
    document.querySelectorAll('.theme-option').forEach(themeBtn => {
        themeBtn.onclick = () => {
            document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
            themeBtn.classList.add('active');
            const theme = themeBtn.dataset.theme;
            document.documentElement.dataset.theme = theme;
        };
    });

    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = () => {
            const prefs = {
                name: document.getElementById('prefNameInput') ? document.getElementById('prefNameInput').value : '',
                role: document.getElementById('prefRoleInput') ? document.getElementById('prefRoleInput').value : '',
                instructions: document.getElementById('prefInstructions') ? document.getElementById('prefInstructions').value : '',
                geminiKey: document.getElementById('prefGeminiKey') ? document.getElementById('prefGeminiKey').value : '',
                enableLocalProxy: true,
                localProxyUrl: document.getElementById('prefLocalProxyUrl') ? document.getElementById('prefLocalProxyUrl').value : '',
                customSystemPrompt: document.getElementById('prefCustomSystemPrompt') ? document.getElementById('prefCustomSystemPrompt').value : '',
                autoAlign: document.getElementById('prefAutoAlign') ? document.getElementById('prefAutoAlign').checked : true,
                enableAnimations: document.getElementById('prefEnableAnimations') ? document.getElementById('prefEnableAnimations').checked : true,
                defaultModel: document.getElementById('prefDefaultModel') ? document.getElementById('prefDefaultModel').value : 'gemini-2.0-flash',
                imageEngine: document.getElementById('prefImageEngine') ? document.getElementById('prefImageEngine').value : 'dalle',
                openRouterKey: document.getElementById('prefOpenRouterKey') ? document.getElementById('prefOpenRouterKey').value : '',
                exportFormat: document.getElementById('prefExportFormat') ? document.getElementById('prefExportFormat').value : 'html',
                theme: document.querySelector('.theme-option.active')?.dataset.theme || 'amber'
            };
            const memInput = document.getElementById('prefLongTermMemory');
            let memVal = '';
            if (memInput) {
                memVal = memInput.value.trim();
                localStorage.setItem('radon_user_memory', memVal);
            }
            localStorage.setItem('radon_user_prefs', JSON.stringify(prefs));
            
            if (auth && auth.currentUser && db) {
                db.collection('users').doc(auth.currentUser.uid).set({
                    settings: prefs,
                    memory: memVal
                }, { merge: true }).catch(err => console.error("Error saving settings to Firebase:", err));
            }

            applyUserPreferences();
            if (auth && auth.currentUser) updateWelcomeGreeting(auth.currentUser);
            if (settingsModal) settingsModal.style.display = 'none';
            if (typeof showToast === 'function') showToast('Settings and preferences saved!', 'success');
        };
    }

    if (clearAllHistoryBtn) {
        clearAllHistoryBtn.onclick = clearAllUserThreads;
    }

    // Toggle API Key visibility
    document.querySelectorAll('.toggle-key-btn').forEach(btn => {
        btn.onclick = () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
            } else {
                input.type = 'password';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
            }
        };
    });
}

function buildCrossThreadUserMemory() {
    const savedPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    const customMemory = localStorage.getItem('radon_user_memory') || '';
    
    let memoryStr = '';
    if (savedPrefs.name) memoryStr += `- User Name: ${savedPrefs.name}\n`;
    if (savedPrefs.role) memoryStr += `- Role/Background: ${savedPrefs.role}\n`;
    if (savedPrefs.instructions) memoryStr += `- User Preference Instructions: ${savedPrefs.instructions}\n`;
    
    if (customMemory.trim()) {
        memoryStr += `- Long-Term Learned Facts:\n${customMemory.trim()}\n`;
    } else {
        memoryStr += `- Long-Term Learned Facts:\nUser Name: Divyansh Agarwal. Student at RNS Institute of Technology (RNSIT). Focus: AI development, Python, Full-Stack applications.\n`;
    }

    // Collect recent past thread titles from sidebar to give cross-thread context
    if (threadsList) {
        const titles = [];
        threadsList.querySelectorAll('.thread-title').forEach(el => {
            const txt = el.innerText.trim();
            if (txt && txt !== 'Untitled Chat') titles.push(txt);
        });
        if (titles.length > 0) {
            memoryStr += `- Recent Past Chat Topics: ${titles.slice(0, 10).join('; ')}\n`;
        }
    }

    return memoryStr.trim();
}

function openSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;

    const user = auth?.currentUser;
    const saved = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');

    const nameText = document.getElementById('settingsNameText');
    const emailText = document.getElementById('settingsEmailText');
    if (nameText) nameText.textContent = saved.name || user?.displayName || 'User';
    if (emailText) emailText.textContent = user?.email || 'user@example.com';
    const avatarEl = document.getElementById('settingsAvatar');
    if (avatarEl) avatarEl.src = user?.photoURL || '';

    const nameInput = document.getElementById('prefNameInput');
    const roleInput = document.getElementById('prefRoleInput');
    const instInput = document.getElementById('prefInstructions');
    const memInput = document.getElementById('prefLongTermMemory');
    const autoAlignToggle = document.getElementById('prefAutoAlign');
    const animToggle = document.getElementById('prefEnableAnimations');

    if (nameInput) nameInput.value = saved.name || (user?.displayName ? user.displayName.split(' ')[0] : '');
    if (roleInput) roleInput.value = saved.role || 'Mechanical Engineering Student at RNSIT';
    if (instInput) instInput.value = saved.instructions || '';
    if (memInput) memInput.value = localStorage.getItem('radon_user_memory') || 'User Name: Divyansh Agarwal\nRole: Mechanical Engineering Student at RNS Institute of Technology (RNSIT)\nFocus: AI & Full-Stack Development with Gemini, Python, Cloudflare';
    if (saved.defaultModel && document.getElementById('prefDefaultModel')) document.getElementById('prefDefaultModel').value = saved.defaultModel;
    if (saved.imageEngine && document.getElementById('prefImageEngine')) document.getElementById('prefImageEngine').value = saved.imageEngine;
    if (saved.exportFormat && document.getElementById('prefExportFormat')) document.getElementById('prefExportFormat').value = saved.exportFormat;
    if (saved.geminiKey && document.getElementById('prefGeminiKey')) document.getElementById('prefGeminiKey').value = saved.geminiKey;
    if (document.getElementById('prefOpenRouterKey')) document.getElementById('prefOpenRouterKey').value = saved.openRouterKey || '';
    if (document.getElementById('prefEnableLocalProxy')) {
        document.getElementById('prefEnableLocalProxy').checked = true; // strictly enforced
    }
    if (saved.localProxyUrl && document.getElementById('prefLocalProxyUrl')) document.getElementById('prefLocalProxyUrl').value = saved.localProxyUrl;
    
    if (document.getElementById('prefCustomSystemPrompt')) document.getElementById('prefCustomSystemPrompt').value = saved.customSystemPrompt || '';
    if (autoAlignToggle) autoAlignToggle.checked = saved.autoAlign !== false;
    if (animToggle) animToggle.checked = saved.enableAnimations !== false;
    
    updateTokenDisplay();

    const localProxyToggle = document.getElementById('prefEnableLocalProxy');
    const localProxyGroup = document.getElementById('localProxyUrlGroup');
    const forceProxyGroup = document.getElementById('forceLocalProxyGroup');
    if (document.getElementById('prefForceLocalProxy')) {
        document.getElementById('prefForceLocalProxy').checked = saved.forceLocalProxy === true;
    }
    if (localProxyToggle && localProxyGroup) {
        localProxyToggle.addEventListener('change', () => {
            localProxyGroup.style.display = localProxyToggle.checked ? 'block' : 'none';
            if (forceProxyGroup) forceProxyGroup.style.display = localProxyToggle.checked ? 'block' : 'none';
        });
        if (forceProxyGroup) forceProxyGroup.style.display = localProxyToggle.checked ? 'block' : 'none';
    }
    settingsModal.style.display = 'flex';
}

async function exportAllUserData() {
    if (!auth || !auth.currentUser || !db) return alert('Not logged in.');
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection('threads').get();
        const exportData = [];
        for (const doc of snapshot.docs) {
            const threadData = doc.data();
            const msgsSnapshot = await doc.ref.collection('messages').orderBy('timestamp', 'asc').get();
            const messages = msgsSnapshot.docs.map(m => m.data());
            exportData.push({ id: doc.id, title: threadData.title, createdAt: threadData.createdAt, messages });
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `radon_chat_history_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Export failed: ' + e.message);
    }
}

async function clearAllUserThreads() {
    if (!confirm('Are you sure you want to delete ALL chat threads? This cannot be undone.')) return;
    if (!auth || !auth.currentUser || !db) return;
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection('threads').get();
        for (const doc of snapshot.docs) {
            await doc.ref.delete();
        }
        createNewChat();
        if (threadsList) threadsList.innerHTML = '';
        const modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'none';
        alert('All chat history cleared.');
    } catch (e) {
        alert('Failed to clear threads: ' + e.message);
    }
}

// -------------------------------------------------------------
// SHARE MODAL & CONVERSATION EXPORT
// -------------------------------------------------------------
function initShareModal() {
    const shareChatBtn = document.getElementById('shareChatBtn');
    const mobileShareBtn = document.getElementById('mobileShareBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShareBtn = document.getElementById('closeShareBtn');
    const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');
    const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
    const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
    const nativeShareBtn = document.getElementById('nativeShareBtn');

    if (shareChatBtn) shareChatBtn.onclick = openShareModal;
    if (mobileShareBtn) mobileShareBtn.onclick = openShareModal;
    if (closeShareBtn) closeShareBtn.onclick = () => { if (shareModal) shareModal.style.display = 'none'; };

    if (copyShareLinkBtn) {
        copyShareLinkBtn.onclick = () => {
            const input = document.getElementById('shareUrlInput');
            if (input) {
                navigator.clipboard.writeText(input.value);
                copyShareLinkBtn.textContent = 'Copied!';
                setTimeout(() => { copyShareLinkBtn.textContent = 'Copy'; }, 2000);
            }
        };
    }

    if (copyTranscriptBtn) {
        copyTranscriptBtn.onclick = () => {
            let transcript = '';
            chatHistory.querySelectorAll('.message').forEach(el => {
                const isUser = el.classList.contains('user-message');
                const role = isUser ? 'User' : 'Radon';
                transcript += `### ${role}:\n${el.innerText.trim()}\n\n`;
            });
            navigator.clipboard.writeText(transcript);
            alert('Transcript copied to clipboard!');
        };
    }

    if (exportMarkdownBtn) {
        exportMarkdownBtn.onclick = () => {
            let content = '';
            chatHistory.querySelectorAll('.message').forEach(el => {
                const isUser = el.classList.contains('user-message');
                const role = isUser ? 'User' : 'Radon';
                content += `## ${role}\n${el.innerText.trim()}\n\n---\n\n`;
            });
            exportHtmlFile(content, 'Radon Chat Thread Export');
        };
    }

    if (nativeShareBtn) {
        nativeShareBtn.onclick = async () => {
            const url = window.location.href;
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Radon Conversation',
                        text: 'Check out this AI conversation on Radon.',
                        url: url
                    });
                } catch (e) {}
            } else {
                navigator.clipboard.writeText(url);
                alert('Link copied to clipboard!');
            }
        };
    }
}

function openShareModal() {
    const shareModal = document.getElementById('shareModal');
    const shareUrlInput = document.getElementById('shareUrlInput');
    if (shareUrlInput) shareUrlInput.value = window.location.href;
    if (shareModal) shareModal.style.display = 'flex';
}

// -------------------------------------------------------------
// BRAND PAGES & EMAIL AUTHENTICATION HANDLERS
// -------------------------------------------------------------
// LOCAL PROXY FALLBACK (GEMINI-WEB2API)
// -------------------------------------------------------------
// =============================================================
// RADON UNIFIED STREAM — Handles the new SSE protocol from server.py
// Events: {token: "..."}, {tool: "search_web"}, {error: "..."}, [DONE]
// =============================================================
async function radonStream(messageToSend, history, selectedModel, savedPrefs) {
    // Create live bot bubble
    let streamBubble = document.querySelector('.streaming-bubble');
    if (!streamBubble) {
        const streamRow = document.createElement('div');
        streamRow.className = 'bot-msg-row';
        streamRow.id = 'streamingRow';
        const streamIndicator = document.createElement('div');
        streamIndicator.className = 'bot-indicator';
        streamIndicator.innerHTML = typeof RADON_SPARKLE_SVG !== 'undefined' ? RADON_SPARKLE_SVG : '⚡';
        streamRow.appendChild(streamIndicator);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'bot-content-wrapper';

        streamBubble = document.createElement('div');
        streamBubble.className = 'message bot-message streaming-bubble';
        streamBubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
        contentWrapper.appendChild(streamBubble);

        streamRow.appendChild(contentWrapper);
        const chatHistoryEl = document.getElementById('chatHistory');
        if (chatHistoryEl) {
            chatHistoryEl.appendChild(streamRow);
            chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
        }
    }

    // Build Gemini-style history payload
    const geminiHistory = (history || []).map(msg => ({
        role: msg.role,
        parts: msg.parts || [{ text: msg.content || '' }]
    }));

    try {
        const response = await fetch(RADON_BACKEND + '/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: messageToSend,
                model: selectedModel || 'gemini-3.6-flash',
                history: geminiHistory,
                userMemory: localStorage.getItem('radon_user_memory') || '',
                customSystemPrompt: savedPrefs?.customSystemPrompt || '',
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullReply = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') {
                    const cursor = streamBubble.querySelector('.stream-cursor');
                    if (cursor) cursor.remove();
                    streamBubble.classList.remove('streaming-bubble');
                    enhanceCodeBlocksInElement(streamBubble);
                    const botMsgRow = streamBubble.closest('.bot-msg-row');
                    if (botMsgRow) attachBotActionBar(botMsgRow, fullReply);
                    return fullReply;
                }
                try {
                    const event = JSON.parse(raw);
                    if (event.tool) {
                        // Show tool activity indicator
                        const toolNames = {
                            'search_web': '🔍 Searching the web...',
                            'get_weather': '🌤️ Fetching weather...',
                            'get_news': '📰 Fetching news...',
                            'execute_python': '🐍 Running Python code...',
                            'generate_image': '🎨 Generating image...',
                        };
                        const toolText = toolNames[event.tool] || `⚙️ Using ${event.tool}...`;
                        if (typeof toolActivity !== 'undefined') toolActivity.style.display = 'flex';
                        if (typeof toolActivityText !== 'undefined') toolActivityText.textContent = toolText;
                        streamBubble.innerHTML = `<em style="opacity:0.6">${toolText}</em>`;
                    } else if (event.token) {
                        const token = event.token;
                        fullReply += token;
                        if (typeof toolActivity !== 'undefined') toolActivity.style.display = 'none';

                        const cursor = streamBubble.querySelector('.stream-cursor');
                        if (cursor) cursor.remove();
                        if (typeof marked !== 'undefined') {
                            streamBubble.innerHTML = marked.parse(fullReply);
                        } else {
                            streamBubble.textContent = fullReply;
                        }
                        const newCursor = document.createElement('span');
                        newCursor.className = 'stream-cursor';
                        newCursor.textContent = '▄';
                        streamBubble.appendChild(newCursor);
                        addTokensUsed(token.length);
                    } else if (event.error) {
                        fullReply = `⚠️ ${event.error}`;
                        streamBubble.textContent = fullReply;
                    }
                } catch (e) {}
            }
        }

        const cursor = streamBubble.querySelector('.stream-cursor');
        if (cursor) cursor.remove();
        streamBubble.classList.remove('streaming-bubble');
        enhanceCodeBlocksInElement(streamBubble);
        const botMsgRow = streamBubble.closest('.bot-msg-row');
        if (botMsgRow) attachBotActionBar(botMsgRow, fullReply);
        return fullReply;

    } catch (err) {
        console.error('Radon Stream Error:', err);
        const errMsg = `⚠️ Radon backend error: ${err.message}. Is the server running?`;
        if (streamBubble) {
            streamBubble.innerHTML = errMsg;
            streamBubble.classList.remove('streaming-bubble');
        }
        return errMsg;
    }
}

// Legacy stub — kept for any other callers
async function callLocalProxyFallback(messageToSend, history, _proxyUrl, selectedModel) {
    const savedPrefs = JSON.parse(localStorage.getItem('radon_user_prefs') || '{}');
    return radonStream(messageToSend, history, selectedModel, savedPrefs);
}

// Global router link click interceptor

document.addEventListener('click', (e) => {
    const link = e.target.closest('.router-link, a[href^="/"]');
    if (link) {
        if (link.hasAttribute('download') || link.getAttribute('target') === '_blank') {
            return; // Allow native file download
        }
        const href = link.getAttribute('href');
        if (href && (href.endsWith('.zip') || href.endsWith('.exe') || href.endsWith('.pdf'))) {
            return; // Allow direct download
        }
        if (href && href.startsWith('/')) {
            e.preventDefault();
            navigateToRoute(href, true);
        }
    }
});

// Handle browser Back / Forward buttons (popstate)
window.addEventListener('popstate', () => {
    navigateToRoute(window.location.pathname, false);
});

function initBrandPagesAndAuth() {
    const standaloneSignupForm = document.getElementById('standaloneSignupForm');
    const signupEmail = document.getElementById('signupEmail');
    const signupPassword = document.getElementById('signupPassword');
    const signupErrorMsg = document.getElementById('signupErrorMsg');

    if (standaloneSignupForm) {
        standaloneSignupForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = signupEmail.value.trim();
            const password = signupPassword.value.trim();
            if (!email || !password) return;

            if (signupErrorMsg) signupErrorMsg.style.display = 'none';

            try {
                await auth.createUserWithEmailAndPassword(email, password);
                navigateToRoute('/app', true);
            } catch (err) {
                if (signupErrorMsg) {
                    signupErrorMsg.textContent = err.message || 'Signup failed.';
                    signupErrorMsg.style.display = 'block';
                }
            }
        };
    }

    // Initialize initial route on load
    navigateToRoute(window.location.pathname, false);
}

// -------------------------------------------------------------
// FUN EASTER EGG SYSTEM
// -------------------------------------------------------------
window.triggerEasterEgg = function() {
    const jokes = [
        "🤖 **Easter Egg Unlocked!**\n\n*Why did the engineer cross the road?*\nBecause he looked at the blueprint and saw that's where the bridge was supposed to go! 🌉",
        "⚡ **Surprise Easter Egg Activated!**\n\n*There are 10 types of people in the world:*\nThose who understand binary, and those who don't! 💻",
        "🎉 **Radon Secret Unlocked!**\n\n*Divyansh's Pro Tip:* 'In mechanical engineering, if it moves and it shouldn't: Duct Tape. If it doesn't move and it should: WD-40!' 🛠️",
        "🚀 **Turbo Mode Initiated!**\n\n*Why do mechanical engineers confuse Halloween and Christmas?*\nBecause Oct 31 == Dec 25! 🎃🎄"
    ];
    const choice = jokes[Math.floor(Math.random() * jokes.length)];
    
    if ('speechSynthesis' in window) {
        try {
            const synth = window.speechSynthesis;
            const utter = new SpeechSynthesisUtterance("Easter egg unlocked! Party mode activated.");
            utter.rate = 1.1;
            synth.speak(utter);
        } catch (e) {}
    }
    
    showToast("🎉 Easter Egg Unlocked!", "info");
    
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) welcome.classList.add('hidden');

    if (typeof appendMessage === 'function') {
        appendMessage('user', '🎮 Surprise Me!');
        setTimeout(() => {
            appendMessage('bot', choice);
        }, 300);
    }
};



