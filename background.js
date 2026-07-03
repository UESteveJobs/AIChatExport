chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadMarkdown') {
        console.log('[AIHistory BG] 收到下载请求', message.filename)

        chrome.downloads.download({
            url: message.dataUrl,
            filename: message.filename || `ai-history-${message.title || ''}-${Date.now()}.md`,
            saveAs: true,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            console.log('[AIHistory BG] 下载结果:', downloadId, chrome.runtime.lastError?.message)
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message })
            } else {
                sendResponse({ success: true, downloadId })
            }
        })
        return true
    }
})

