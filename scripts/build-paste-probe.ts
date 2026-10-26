// Throwaway: build one HTML page whose copied fragment answers the two questions
// only a real paste into the WeChat backend can settle. The list markup comes
// from our own themes rather than being hand-written, so the test is of the
// shipping output and not of an approximation of it.
import { parseMarkdown } from '../src/lib/parse'
import { renderDoc } from '../src/lib/render'
import { THEMES } from '../src/lib/themes'
import fs from 'node:fs'

const sig = { layout: '排版', proof: '校对', review: '审核' }

// The trigger MDInline documents is an <li> whose content carries inline-styled
// runs, so the fixture puts bold and ==mark== inside list items on purpose.
const LIST_DOC = `- 第一项带 **加粗** 和 ==重点== 标记
- 第二项是纯文字，没有任何行内样式
- 第三项带 \`行内代码\` 和 [一个链接](https://example.com/a)
`

// Structural twin of what MathJax tex2svg emits with fontCache:'none': glyph
// outlines as <path>, dimensions moved into the style attribute, and no class,
// id, <style> or <script> anywhere. Hand-built so the test does not need the
// MathJax dependency installed to answer the platform question.
const SVG_PROBE = `<section style="margin:24px 0;text-align:center;text-indent:0;"><svg xmlns="http://www.w3.org/2000/svg" width="120" height="46" viewBox="0 -9 3.5 12.5" style="width:120px;height:46px;max-width:100%;vertical-align:-0.906ex;" fill="currentColor" stroke="currentColor" stroke-width="0"><g stroke-width="0" fill="currentColor"><path d="M42.3 679.2L54.5 480.3 71.2 433.8 88.1 433.9 130.1 434.2 172 434.6 189.6 392.2 207.2 349.8 189.6 307.4 172 265 130.1 265.3 88.1 265.6 71.2 265.6 54.5 219.2 42.3 20.2 30.1 -178.8 240 -178.4 449.9 -178 466.6 -135.6 483.3 -93.2 466.7 -50.8 450.1 -8.4 240.2 -8.5 30.3 -8.7ZM240 263.9L274.1 263.9 308.2 263.9 293.4 301.9 278.6 340 293.4 378 308.2 416 274.1 416 240 416 205.9 416 171.8 416 186.6 378 201.4 340 186.6 301.9 171.8 263.9 205.9 263.9Z"/></g></svg><p style="margin:8px 0 0;font-size:12px;color:#888888;text-align:center;text-indent:0;"><span leaf="">↑ 探针 C：内联 SVG（MathJax 公式的结构等价物）</span></p></section>`

// A second SVG variant: everything as presentation attributes instead of a
// style attribute, and a <text> node instead of pure paths. If C survives and C2
// does not (or the reverse), that tells us which construct is the problem rather
// than leaving a bare yes/no.
const SVG_PROBE_ATTRS = `<section style="margin:24px 0;text-align:center;text-indent:0;"><svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40" fill="none"><rect x="1" y="1" width="198" height="38" rx="6" fill="#EAF3FF" stroke="#1677FF" stroke-width="2"/><text x="100" y="26" font-size="16" fill="#17365D" text-anchor="middle">SVG-ATTRS-OK</text></svg><p style="margin:8px 0 0;font-size:12px;color:#888888;text-align:center;text-indent:0;"><span leaf="">↑ 探针 C2：内联 SVG，全部用属性、不用 style</span></p></section>`

const liThemes = ['golden', 'minimal', 'steady', 'zen', 'olive']
const sectionTheme = THEMES.find((t) => !liThemes.includes(t.id))!

const parsed = parseMarkdown(LIST_DOC)

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function section(label: string, what: string, inner: string): string {
  // label and what are prose that names tags like <li> literally; only inner is
  // real markup, so only it goes in unescaped.
  return `<section style="margin:0 0 28px;padding:16px 18px;border:1px dashed #B9DAFF;background:#F8FBFF;">
<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#17365D;text-indent:0;"><span leaf="">${escText(label)}</span></p>
<p style="margin:0 0 12px;font-size:12px;color:#6B7793;text-indent:0;"><span leaf="">看什么：${escText(what)}</span></p>
${inner}
</section>`
}

const probes: string[] = []

probes.push(
  section(
    '探针 A · 裸 <li> + 行内样式（我们 5 套主题现在就是这样）',
    '每一条是不是都只占一行？如果「第一项」被拆成了两行（圆点和文字分开、或加粗部分单独换行），就说明 WeChat 会拆 <li>。',
    liThemes
      .map((id) => {
        const theme = THEMES.find((t) => t.id === id)!
        const html = renderDoc(parsed, theme, sig).html
        // Pull just the list out of the theme's full render so all five sit in one
        // copied fragment.
        return `<p style="margin:12px 0 4px;font-size:12px;color:#1677FF;text-indent:0;"><span leaf="">主题 ${id}（${theme.name}）</span></p>${html.replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '')}`
      })
      .join('\n'),
  ),
)

probes.push(
  section(
    '探针 B · 对照组：用 <section> 包住列表项（我们另外 4 套主题这样）',
    '这一组应该正常。如果 A 拆行而 B 不拆，解法就是把 A 改成 B 的写法。',
    renderDoc(parsed, sectionTheme, sig).html.replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '') +
      `<p style="margin:8px 0 0;font-size:12px;color:#6B7793;text-indent:0;"><span leaf="">↑ 主题 ${sectionTheme.id}（${sectionTheme.name}）</span></p>`,
  ),
)

probes.push(
  section(
    '探针 C · 内联 SVG（数学公式 / Mermaid 图表要走这条路）',
    '下面那个 ✕ 形的矢量图形还在不在？如果变成空白、裂图或一串代码，说明 WeChat 会剥掉 SVG，公式就必须改成「渲染成 PNG 再上传」。',
    SVG_PROBE,
  ),
)

probes.push(
  section(
    '探针 C2 · 内联 SVG，但全部用属性、不用 style',
    '那个蓝框和里面的 SVG-ATTRS-OK 字样还在不在？和探针 C 对比着看：如果只有一个活下来，就知道 WeChat 到底是整体剥 SVG，还是只剥某一种写法。',
    SVG_PROBE_ATTRS,
  ),
)

probes.push(
  section(
    '探针 D · 对照组：纯 CSS 画的色块（不用 SVG、不用图片）',
    '这一条**必须**正常显示。如果连它都不对，说明问题出在粘贴或登录环节，而不是 SVG——那前面 C 和 C2 的结果就不能作数。',
    `<section style="margin:0;height:56px;background:#EAF3FF;border:2px solid #1677FF;border-radius:8px;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:14px;font-weight:700;color:#17365D;text-indent:0;text-align:center;"><span leaf="">CSS-BLOCK-OK · 这个蓝框应该正常显示</span></p></section>`,
  ),
)

const fragment = `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;padding:0 10px;box-sizing:border-box;">
<p style="margin:24px 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-indent:0;"><span leaf="">公众号粘贴验证页</span></p>
<p style="margin:0 0 24px;font-size:13px;color:#6B7793;text-indent:0;"><span leaf="">点右上角「复制到公众号」，去公众号后台正文里粘贴，然后对照下面四条读答案。这一页不是文章，是探针。</span></p>
${probes.join('\n')}
</section>`

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>公众号粘贴验证</title>
<style>
  body{margin:0;background:#E8ECF3;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
  .bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid #d7deea;}
  .bar .hint{font-size:13px;color:#5c6a85;line-height:1.6;}
  .bar button{border:none;background:#4F6CE8;color:#fff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:10px;cursor:pointer;white-space:nowrap;}
  .bar button:active{transform:scale(.98);}
  .stage{padding:24px 16px 80px;display:flex;justify-content:center;}
  .paper{background:#fff;border-radius:6px;box-shadow:0 10px 30px -12px rgba(20,30,60,.28);width:677px;max-width:100%;}
  #result{font-size:13px;color:#1F7E58;font-weight:600;}
</style>
</head>
<body>
<div class="bar">
  <div class="hint">
    <strong>用法：</strong>点右边按钮 → 打开公众号后台新建图文 → 在正文里 Ctrl+V → 对照页面上四条探针读答案。<br>
    <span id="result"></span>
  </div>
  <button onclick="copyIt()">复制到公众号</button>
</div>
<div class="stage"><div class="paper" id="shell">
${fragment}
</div></div>
<script>
function copyIt(){
  const root=document.querySelector('#shell > section');
  const html=root.outerHTML, text=root.innerText;
  const done=(m)=>{document.getElementById('result').textContent=m;};
  if(navigator.clipboard&&window.ClipboardItem){
    const item=new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})});
    navigator.clipboard.write([item]).then(()=>done('已复制 '+html.length+' 字节，去公众号后台粘贴吧')).catch(e=>done('复制失败：'+e.message));
    return;
  }
  const range=document.createRange();range.selectNodeContents(root);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  document.execCommand('copy');sel.removeAllRanges();done('已用兼容方式复制');
}
</script>
</body>
</html>`

const OUT = process.argv[2] || './粘贴验证.html'
fs.writeFileSync(OUT, page, 'utf8')
const forbidden = fragment.match(/\s(class|id)=|<script|<style|<div|position:\s*(fixed|absolute|sticky)|display:\s*grid|@media/gi) || []
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes')
console.log('fragment bytes:', fragment.length)
console.log('themes probed with bare <li>:', liThemes.join(', '))
console.log('control theme (<section> list):', sectionTheme.id)
console.log('forbidden tokens in the copied fragment:', forbidden.length ? forbidden.join(' | ') : 'NONE')
console.log('svg probes:', (fragment.match(/<svg/g) || []).length, '| li count:', (fragment.match(/<li/g) || []).length)
