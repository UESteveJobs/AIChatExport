let isSelectMode = false
let baseWindow = null
let inputBox = null
let rootWindow = null
let newMsgObserver = null
let title = ''
let messageOrder = []
let messageStore = {}

const STORE_KEY = 'ai-history-store'
const STORE_TTL = 15 * 60 * 1000

function loadStore() {
    return new Promise(resolve => {
        chrome.storage.local.get(STORE_KEY, result => {
            let data = result[STORE_KEY]
            if (data && data.timestamp && Date.now() - data.timestamp < STORE_TTL) {
                messageOrder = data.order || []
                messageStore = data.store || {}
            } else {
                if (data) chrome.storage.local.remove(STORE_KEY)
                messageOrder = []
                messageStore = {}
            }
            resolve()
        })
    })
}

function saveStore() {
    return new Promise(resolve => {
        chrome.storage.local.set({
            [STORE_KEY]: { order: messageOrder, store: messageStore, timestamp: Date.now() }
        }, resolve)
    })
}

function clearStore() {
    return new Promise(resolve => {
        try { chrome.storage.local.remove(STORE_KEY, resolve) } catch (e) { resolve() }
    })
}

function updateSelectBar() {
    let total = Object.keys(messageStore).length
    let checked = Object.values(messageStore).filter(r => r.checked).length
    let selectAll = document.getElementById('ai-history-select-all')
    if (selectAll) {
        selectAll.checked = checked > 0 && checked === total
        selectAll.indeterminate = checked > 0 && checked < total
    }
    let exportBtn = document.getElementById('ai-history-export-btn')
    if (exportBtn) {
        exportBtn.textContent = checked > 0 ? `导出为 .md(${checked})` : '导出为 .md'
        exportBtn.disabled = checked === 0
    }
}

function detectRole(msg){
    let conversationContent = msg.nextElementSibling.matches('.ds-flex')
    let s = conversationContent ? 'AI' : 'User'
    return s
}

function renderNode(node) {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return ''
    let tag = node.tagName, cls = node.className
    if (tag === 'SVG' || tag === 'IMG' || tag === 'MATH') return ''
    if (tag === 'SPAN' && typeof cls === 'string' && cls.includes('katex')) {
        let ann = node.querySelector('annotation[encoding="application/x-tex"]')
        if (ann) {
            let tex = ann.textContent.trim()
            return cls.includes('katex-display')
                ? '\n$$\n' + tex + '\n$$\n\n' : '$' + tex + '$'
        }
    }
    if (tag === 'P') {
        let t = '';
        for (let c of node.childNodes) t += renderNode(c);return t.trim() + '\n\n' 
    }
    if (tag === 'SPAN') {
        let t = '';
        for (let c of node.childNodes) t += renderNode(c);return t
    }
    if (tag === 'STRONG' || tag === 'B') { 
        let t = ''; for (let c of node.childNodes) t += renderNode(c); return '**' + t.trim() + '**' 
    }
    if (tag === 'EM' || tag === 'I') { 
        let t = ''; for (let c of node.childNodes) t += renderNode(c); return '*' + t.trim() + '*' 
    }
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return '~~' + (node.innerText || '').trim() + '~~'
    if (tag === 'U') return node.innerText || ''
    if (tag === 'CODE') return '`' + (node.textContent || '').trim() + '`'
    if (tag === 'A') { 
        let t = ''; 
        for (let c of node.childNodes) t += renderNode(c); return '[' + (t.trim() || node.href) + '](' + (node.href || '') + ')' 
    }
    if (tag === 'BR') return '\n'
    if (tag === 'PRE') return '\n```\n' + (node.innerText || '').trim() + '\n```\n\n'
    if (/^H[1-6]$/.test(tag)) return '\n' + '#'.repeat(parseInt(tag[1])) + ' ' + (node.innerText || '').trim() + '\n\n'
    if (tag === 'HR') return '\n---\n\n'
    if (tag === 'LI') {
        let cb = node.querySelector('input[type="checkbox"]')
        let prefix = cb ? (cb.checked ? '[x] ' : '[ ] ') : ''
        let t = ''
        for (let c of node.childNodes) {
            if (c.nodeType === 3) t += c.textContent
            else if (c.nodeType === 1 && !['UL', 'OL'].includes(c.tagName)) t += renderNode(c)
        }
        let n = ''
        for (let c of node.childNodes) {
            if (c.nodeType === 1 && ['UL', 'OL'].includes(c.tagName))
                n += '  ' + renderNode(c).trim().replace(/\n/g, '\n  ') + '\n'
        }
        return prefix + t.trim() + (n ? '\n' + n : '')
    }
    if (tag === 'UL') return '\n' + Array.from(node.children).map(li => '- ' + renderNode(li).trim()).join('\n') + '\n\n'
    if (tag === 'OL') return '\n' + Array.from(node.children).map((li, i) => (i + 1) + '. ' + renderNode(li).trim()).join('\n') + '\n\n'
    if (tag === 'BLOCKQUOTE') {
        let c = Array.from(node.childNodes).map(n => renderNode(n)).join('').trim()
        return '\n> ' + c.replace(/\n/g, '\n> ') + '\n\n'
    }
    if (tag === 'TABLE') {
        let md = '\n'
        let rows = node.querySelectorAll('tr')
        rows.forEach((tr, i) => {
            let cells = tr.querySelectorAll('th, td')
            md += '| ' + Array.from(cells).map(c => c.innerText.trim()).join(' | ') + ' |\n'
            if (i === 0 && tr.querySelector('th'))
                md += '|' + Array.from(cells).map(() => ' --- ').join('|') + '|\n'
        })
        return md + '\n'
    }
    if (tag === 'DIV' && typeof cls === 'string' && cls.includes('md-code-block')) {
        if (cls.includes('md-code-block-banner-wrap')) return ''
        let lang = ''
        let banner = node.querySelector('.md-code-block-banner')
        if (banner) {
            let langEl = banner.querySelector('.d813de27') || banner.querySelector('[class*="lang"]')
            if (langEl) lang = langEl.innerText.trim()
        }
        let pre = node.querySelector('pre')
        if (!pre) return ''
        return '\n```' + lang + '\n' + (pre.innerText || '').trim() + '\n```\n\n'
    }
    let text = ''
    for (let child of node.childNodes) text += renderNode(child)
    return text
}

function translateToMarkdown(msg, role) {
    if (role === 'User') return msg.innerText.trim()
    let cont = msg.parentElement.querySelector('.ds-assistant-message-main-content')
        || msg.parentElement.children[1] || msg
    return Array.from(cont.childNodes).map(n => renderNode(n)).join('').trim()
}

function addCheckboxToMsg(msg) {
    let wrapper = msg.parentElement
    if (wrapper.querySelector('.ai-history-cb')) return
    let key = wrapper.getAttribute('data-virtual-list-item-key')
    if (!key) return
    if (!messageStore[key]) {
        messageStore[key] = {
            key, checked: false,
            role: detectRole(msg),
            content: translateToMarkdown(msg, detectRole(msg))
        }
        messageOrder.push(key)
        messageOrder.sort((a, b) => Number(a) - Number(b))
        saveStore()
    }
    wrapper.classList.add('ai-history-card')
    let cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'ai-history-cb'
    cb.dataset.key = key
    cb.checked = messageStore[key].checked
    wrapper.prepend(cb)
    if (cb.checked) wrapper.classList.add('ai-history-card--checked')
    cb.addEventListener('change', () => {
        messageStore[key].checked = cb.checked
        wrapper.classList.toggle('ai-history-card--checked', cb.checked)
        saveStore()
        updateSelectBar()
    })
}

function createSelectBar() {
    if (baseWindow.querySelector('.ai-history-select-bar')) return
    let target = inputBox
    let bar = document.createElement('div')
    bar.className = 'ai-history-select-bar'
    bar.innerHTML = `
        <label><input type="checkbox" id="ai-history-select-all"/>全选</label>
        <button id="ai-history-export-btn">导出为 .md</button>
        <button id="ai-history-cancel-btn">取消</button>`
    target.parentElement.insertBefore(bar, target)

    document.getElementById('ai-history-select-all').addEventListener('change', e => {
        let checked = e.target.checked
        for (let k in messageStore) messageStore[k].checked = checked
        baseWindow.querySelectorAll('.ai-history-cb').forEach(cb => {
            cb.checked = checked
            let card = cb.closest('.ai-history-card')
            if (card) card.classList.toggle('ai-history-card--checked', checked)
        })
        saveStore()
        updateSelectBar()
    })
    document.getElementById('ai-history-export-btn').addEventListener('click', exportToMarkdown)
    document.getElementById('ai-history-cancel-btn').addEventListener('click', exitSelectMode)
    updateSelectBar()
}

function watchNewMessages() {
    if (newMsgObserver) newMsgObserver.disconnect()
    newMsgObserver = new MutationObserver(mutations => {
        for (let m of mutations) {
            if (m.type !== 'childList' || m.addedNodes.length === 0) continue
            for (let node of m.addedNodes) {
                if (node.nodeType !== 1) continue
                let msgs = node.matches?.('.ds-message') ? [node] : [...node.querySelectorAll?.('.ds-message') || []]
                msgs.forEach(msg => {
                    if (!msg.parentNode.querySelector('.ai-history-cb')) addCheckboxToMsg(msg)
                })
                if (msgs.length) updateSelectBar()
            }
        }
    })
    newMsgObserver.observe(baseWindow, { childList: true, subtree: true })
}

function exitSelectMode() {
    isSelectMode = false
    if (newMsgObserver) { newMsgObserver.disconnect(); newMsgObserver = null }
    baseWindow.querySelectorAll('.ai-history-cb').forEach(el => el.remove())
    baseWindow.querySelectorAll('.ai-history-card').forEach(el => {
        el.classList.remove('ai-history-card', 'ai-history-card--checked')
        el.style.border = ''; el.style.borderRadius = ''; el.style.padding = ''
        el.style.margin = ''; el.style.background = ''
    })
    let bar = baseWindow.querySelector('.ai-history-select-bar')
    if (bar) bar.remove()
    if (inputBox) inputBox.style.display = ''
    clearStore()
    messageOrder = []; messageStore = {}
}

function enterSelectMode() {
    if (!baseWindow) return
    isSelectMode = true
    loadStore().then(() => {
        let vis = baseWindow.querySelector('.ds-virtual-list-visible-items')
        if (!vis) return
        vis.querySelectorAll('.ds-message').forEach(msg => addCheckboxToMsg(msg))
        inputBox = baseWindow.lastChild.children[1]
        if (inputBox) inputBox.style.display = 'none'
        createSelectBar()
        watchNewMessages()
    })
}

function toggleSelectMode() {
    isSelectMode ? exitSelectMode() : enterSelectMode()
}

function findBaseWindow() {
    baseWindow = document.querySelector('.ds-virtual-list')
    if (!baseWindow) return
    rootWindow = baseWindow.parentNode
    let titleRoot = rootWindow.children[0] || rootWindow
    title = titleRoot.innerText.replace(/[📥]+/g, '').trim()
    let btn = titleRoot.querySelector('.ai-history-download-btn')
    if (!btn) {
        btn = document.createElement('button')
        btn.textContent = '📥'
        btn.className = 'ai-history-download-btn'
        btn.addEventListener('click', toggleSelectMode)
    }
    titleRoot.appendChild(btn)
}

function watchPageSwitch() {
    setInterval(() => {
        let bw = document.querySelector('.ds-virtual-list')
        if (bw) {
            if (bw !== baseWindow) { baseWindow = bw; findBaseWindow() }
        } else if (baseWindow) {
            baseWindow = null
            if (isSelectMode) exitSelectMode()
        }
    }, 1000)
}

function exportToMarkdown() {
    let keys = messageOrder.filter(k => messageStore[k]?.checked)
    if (!keys.length) return
    let md = `# AI 对话导出\n> 导出时间: ${new Date().toLocaleString()}\n> 来源: ${window.location.hostname}\n\n---\n\n`
    keys.forEach(k => {
        let r = messageStore[k]
        let icon = r.role === 'User' ? '👤' : '🤖'
        md += `## ${icon} ${r.role}\n\n${r.content.trim()}\n\n---\n\n`
    })
    let fn = `ai-history-${(title || '').replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.md`
    let blob = new Blob([md], { type: 'text/markdown' })
    let url = URL.createObjectURL(blob)
    let a = document.createElement('a')
    a.href = url; a.download = fn; a.click()
    URL.revokeObjectURL(url)
    exitSelectMode()
}

function injectStyles() {
    let s = document.createElement('style')
    s.textContent = `

    .ai-history-download-btn{
        background:none!important;
        border:none!important;
        font-size:18px!important;
        cursor:pointer!important;
        padding:4px 8px!important;
        border-radius:6px!important;
        transition:background .2s!important;
        line-height:1!important
    }

    .ai-history-download-btn:hover{
        background:rgba(128,128,128,.15)!important  
    }

    .ai-history-card{
        border:1.5px solid #4f6ef762!important;
        border-radius:10px!important;
        padding:14px 14px 14px 44px!important;
        margin:6px 0!important;
        transition:border-color .25s,background .25s!important;
        position:relative!important
    }

    .ai-history-card--checked{
        border-color:#4f6ef7!important;
        background:rgba(79,110,247,.07)!important
    }

    .ai-history-cb{
        -webkit-appearance:none!important;
        appearance:none!important;
        position:absolute!important;
        left:14px!important;top:16px!important;
        width:18px!important;
        height:18px!important;
        margin:0!important;
        padding:0!important;
        cursor:pointer!important;
        z-index:100!important;
        border:2px solid #999!important;
        border-radius:4px!important;
        background:transparent!important;
        transition:all .2s!important;
        display:flex!important;
        align-items:center!important;
        justify-content:center!important
    }

    .ai-history-cb:checked{
        border-color:#4f6ef7!important;
        background:#4f6ef7!important
    }

    .ai-history-cb:checked::after{
        content:''!important;
        display:block!important;
        width:5px!important;
        height:9px!important;
        border:solid #fff!important;
        border-width:0 2px 2px 0!important;
        transform:rotate(45deg)!important;
        margin-top:-1px!important
    }

    .ai-history-cb:hover{
        border-color:#4f6ef7!important
    }

    .ai-history-select-bar{
        display:flex!important;
        align-items:center!important;
        gap:12px!important;
        padding:10px 16px!important;
        background:rgba(30,30,30,.92)!important;
        backdrop-filter:blur(8px)!important;
        border-top:1px solid rgba(255,255,255,.08)!important;
        font-size:14px!important;color:#e0e0e0!important
    }

    .ai-history-select-bar label{
        display:flex!important;
        align-items:center!important;
        gap:6px!important;
        cursor:pointer!important;
        user-select:none!important
    }

    .ai-history-select-bar input[type="checkbox"]{
        accent-color:#4f6ef7!important;
        width:15px!important;
        height:15px!important;
        cursor:pointer!important
    }

    .ai-history-select-bar button{
        padding:6px 14px!important;
        border:none!important;
        border-radius:6px!important;
        font-size:13px!important;
        cursor:pointer!important;
        transition:opacity .2s!important
    }
        
    #ai-history-export-btn{
        background:#4f6ef7!important;
        color:#fff!important;
        margin-left:auto!important
    }

    #ai-history-export-btn:disabled{
        opacity:.4!important;
        cursor:not-allowed!important
    }

    #ai-history-export-btn:not(:disabled):hover{
        opacity:.85!important
    }

    #ai-history-cancel-btn{
        background:rgba(255,255,255,.08)!important;
        color:#ccc!important
    }

    #ai-history-cancel-btn:hover{
        background:rgba(255,255,255,.15)!important
    }
    `
    document.head.appendChild(s)
}

injectStyles()
findBaseWindow()
watchPageSwitch()

chrome.storage.local.get(STORE_KEY, r => {
    let d = r[STORE_KEY]
    if (d && d.timestamp && Date.now() - d.timestamp >= STORE_TTL) chrome.storage.local.remove(STORE_KEY)
})
window.addEventListener('beforeunload', () => {
    if (isSelectMode) {
        try { chrome.storage.local.remove(STORE_KEY) } catch (e) {}
    }
})