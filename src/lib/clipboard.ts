// Rich-text copying with explicit, inspectable fallbacks.
//
// The ClipboardItem path is preferred because it can write text/html and
// text/plain together. If that API is unavailable or refuses the write, a
// legacy DOM selection copy can still put the rendered article on the
// clipboard. Every path returns whether the clipboard was actually written;
// it never reports success merely because an event handler ran.
import { currentLang, t } from './i18n'

type ClipboardResult = boolean

/** True when the async Clipboard API can take a rich ClipboardItem. */
function canUseClipboardItem(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  )
}

/** True when the async Clipboard API can take plain text. */
function canWritePlain(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
}

/** Remember the current selection so a temporary one can be undone exactly. */
function saveSelection(): Range | null {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  return selection.getRangeAt(0).cloneRange()
}

function restoreSelection(previous: Range | null): void {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  if (previous) selection.addRange(previous)
}

async function writeRichClipboardItem(html: string, plainText: string): Promise<ClipboardResult> {
  const ClipboardItemCtor = window.ClipboardItem as typeof ClipboardItem
  const item = new ClipboardItemCtor({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plainText], { type: 'text/plain' }),
  })
  await navigator.clipboard.write([item])
  return true
}

/**
 * Copy rich HTML through a live DOM selection and `execCommand('copy')`.
 *
 * `container` must already be in the document: an unrendered node has no
 * selected content, which is exactly how the old fallback used to report
 * success while writing nothing. The previous selection is restored even when
 * the command throws.
 */
function execCommandRichCopy(container: HTMLElement): ClipboardResult {
  const previous = saveSelection()
  const range = document.createRange()
  range.selectNodeContents(container)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  try {
    return document.execCommand('copy')
  } finally {
    restoreSelection(previous)
  }
}

/** Copy plain text through an off-screen textarea and `execCommand('copy')`. */
function execCommandPlainCopy(text: string): ClipboardResult {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const active = typeof document.activeElement === 'object' ? (document.activeElement as HTMLElement | null) : null
  const previous = saveSelection()
  let area: HTMLTextAreaElement | null = null
  try {
    area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (area?.parentNode) area.parentNode.removeChild(area)
    restoreSelection(previous)
    active?.focus?.()
  }
}

/**
 * Copy rich text using ClipboardItem first, then a legacy DOM selection.
 *
 * The temporary holder is always detached, including when `execCommand`
 * throws. The caller receives `false` for a refused or missing clipboard
 * implementation, so UI success messages can remain truthful.
 */
export async function copyRichText(html: string, plainText: string): Promise<ClipboardResult> {
  if (canUseClipboardItem()) {
    try {
      return await writeRichClipboardItem(html, plainText)
    } catch {
      // Fall through to the legacy path: permission refusal and unsupported
      // rich MIME types should not make the whole action disappear.
    }
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  let holder: HTMLDivElement | null = null
  try {
    holder = document.createElement('div')
    holder.innerHTML = html
    holder.style.position = 'fixed'
    holder.style.left = '-9999px'
    holder.style.top = '0'
    document.body.appendChild(holder)
    return execCommandRichCopy(holder)
  } catch {
    return false
  } finally {
    if (holder?.parentNode) holder.parentNode.removeChild(holder)
  }
}

/**
 * Copy plain text and report the actual result.
 *
 * The async Clipboard API is tried first because it needs no DOM and keeps the
 * user's selection. When it is missing or refuses the write, the same legacy
 * textarea route is still available; both paths return what really happened so
 * callers never show a success toast for an empty clipboard.
 */
export async function copyPlain(text: string): Promise<ClipboardResult> {
  if (canWritePlain()) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through: a denial here does not rule out the legacy route.
    }
  }
  return execCommandPlainCopy(text)
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
  const copyFailed = JSON.stringify(t('io.exportPreview.copyFailed'))
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
  const done=(ok)=>alert(ok?${copied}:${copyFailed});
  if(navigator.clipboard&&window.ClipboardItem){
    const item=new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})});
    navigator.clipboard.write([item]).then(()=>done(true),()=>done(false));
    return;
  }
  const range=document.createRange();range.selectNodeContents(root);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  const ok=document.execCommand('copy');sel.removeAllRanges();done(ok);
}
</script>
</body>
</html>`
}
