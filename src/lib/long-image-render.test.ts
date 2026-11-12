// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { layoutLongPhotoGroups, leadItems, paragraphKind } from './long-image-render'

const metrics = { padX: 24, contentWidth: 492, photoGap: 6, photoInset: 0 }

function group(captions: (string | null)[]): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = `<div class="reed-long-photos"><div class="reed-long-photo-frame"><div class="reed-long-photo-row">${captions.map((caption) =>
    `<figure class="reed-long-photo"><img data-natural-width="400" data-natural-height="300">${
      caption === null ? '' : `<figcaption class="reed-long-photo-caption" hidden>${caption}</figcaption>`}</figure>`,
  ).join('')}</div></div></div>`
  document.body.append(root)
  return root
}

afterEach(() => { document.body.replaceChildren() })

describe('photo captions', () => {
  it('keeps the fixed photo box when the template leaves captions hidden', () => {
    const root = group(['签到处', null])
    layoutLongPhotoGroups(root, metrics)
    const figures = [...root.querySelectorAll<HTMLElement>('.reed-long-photo')]
    for (const figure of figures) {
      expect(figure.style.height).toMatch(/px$/)
      expect(figure.querySelector('img')!.style.height).toBe('100%')
    }
  })

  it('lets a shown caption hang under a photo that keeps the row height', () => {
    // In Chrome a template's `display: block` beats the UA's [hidden] rule;
    // jsdom always reports [hidden] as none, so model "shown" by dropping it.
    const root = group(['签到处', null])
    root.querySelector('.reed-long-photo-caption')!.removeAttribute('hidden')
    layoutLongPhotoGroups(root, metrics)
    const [withCaption, without] = [...root.querySelectorAll<HTMLElement>('.reed-long-photo')]
    expect(withCaption.style.height).toBe('auto')
    expect(withCaption.querySelector('img')!.style.height).toMatch(/^\d+(\.\d+)?px$/)
    // A photo without a caption in the same template keeps its fixed box.
    expect(without.style.height).toBe(withCaption.querySelector('img')!.style.height)
  })
})

describe('paragraph shapes', () => {
  it('reads a bold opening run as a lead-in label', () => {
    expect(paragraphKind([{ text: '导语', bold: true }, { text: ' 近日，大会顺利举行。' }])).toBe('lead')
  })

  it('reads a short all-bold paragraph as a label line', () => {
    expect(paragraphKind([{ text: '大会要点', bold: true }])).toBe('label')
    expect(paragraphKind([{ text: '要点', bold: true }, { text: ' ' }])).toBe('label')
  })

  it('leaves ordinary and long bold paragraphs alone', () => {
    expect(paragraphKind([{ text: '我们' }, { text: '很', bold: true }, { text: '好' }])).toBeNull()
    expect(paragraphKind([{ text: '这是一整段加粗而且相当长的句子，不应该被当成标签' , bold: true }])).toBeNull()
    expect(paragraphKind([{ text: '只有加粗', bold: true }, { text: '加粗', bold: true }])).toBe('label')
    expect(paragraphKind([])).toBeNull()
  })
})

describe('lists of figures and named steps', () => {
  const list = (items: { text: string; bold?: boolean }[][]) => ({
    type: 'list' as const, ordered: false, start: 1, line: 0, endLine: 0,
    items: items.map((segs, id) => ({ id, parts: [{ type: 'paragraph' as const, segs }] })),
  }) as unknown as Parameters<typeof leadItems>[0]

  it('marks a list whose every item opens with a bold run', () => {
    expect(leadItems(list([[{ text: '10倍', bold: true }, { text: ' 推理速度' }], [{ text: '60%', bold: true }, { text: ' 成本下降' }]]))).toBe(true)
  })

  it('leaves a list alone when any item does not', () => {
    expect(leadItems(list([[{ text: '10倍', bold: true }, { text: ' 推理速度' }], [{ text: '普通一项' }]]))).toBe(false)
    expect(leadItems(list([]))).toBe(false)
  })
})
