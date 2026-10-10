// 富文本复制：优先 ClipboardItem(text/html)，降级 textarea + execCommand
import { currentLang, t } from './i18n'

export async function copyRichText(html: string, plainText: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return true
    }
  } catch {
    // fallthrough
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = '' // 占位，实际用 selection 复制富文本
    const holder = document.createElement('div')
    holder.innerHTML = html
    holder.style.position = 'fixed'
    holder.style.left = '-9999px'
    document.body.appendChild(holder)
    const range = document.createRange()
    range.selectNodeContents(holder)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    const ok = document.execCommand('copy')
    sel?.removeAllRanges()
    document.body.removeChild(holder)
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function copyPlain(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false)
}

export function downloadFile(filename: string, content: string, mime = 'text/html') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 干净正文：只有根 section，可直接粘贴/留存
export function cleanHtml(bodyHtml: string): string {
  return bodyHtml
}

/**
 * Escape a string for an HTML text sink.
 *
 * A document title is whatever the author typed, so it can contain `</title>`,
 * `<script>`, quotes - anything. Inside `<title>` (an RCDATA element) and text
 * nodes only `&` and `<` can change how the markup is read; the quotes are
 * escaped too so the same helper stays correct if a caller ever drops the value
 * into an attribute. Unicode, CJK and emoji pass through untouched.
 *
 * This is the HTML half of the job and has nothing to do with file names -
 * `safeFilename` handles those, because a name that is legal in HTML (`<`) is
 * illegal on disk and the other way round (`·`).
 */
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 完整预览页：正文之外包复制按钮，方便离线校对
export function previewPage(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtmlText(title)
  const copied = JSON.stringify(t('io.exportPreview.copied'))
  return `<!DOCTYPE html>
<html lang="${currentLang() === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  body{margin:0;background:#f3f6fa;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
  .bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #e6edf6;}
  .bar .hint{font-size:13px;color:#8a94a6;}
  .bar button{border:none;background:#1677FF;color:#fff;font-size:14px;padding:8px 18px;border-radius:8px;cursor:pointer;}
  .stage{padding:24px 0 64px;}
  .stage>section{background:#fff;}
</style>
</head>
<body>
<div class="bar"><div class="hint">${safeTitle} · ${escapeHtmlText(t('io.exportPreview.suffix'))}</div><button onclick="copyToWechat()">${escapeHtmlText(t('io.exportPreview.copy'))}</button></div>
<div class="stage" id="gzh-shell">
${bodyHtml}
</div>
<script>
function copyToWechat(){
  const root=document.querySelector('#gzh-shell > section');
  const html=root.outerHTML, text=root.innerText;
  if(navigator.clipboard&&window.ClipboardItem){
    const item=new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})});
    navigator.clipboard.write([item]).then(()=>alert(${copied}));
    return;
  }
  const range=document.createRange();range.selectNodeContents(root);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  document.execCommand('copy');sel.removeAllRanges();alert(${copied});
}
</script>
</body>
</html>`
}
