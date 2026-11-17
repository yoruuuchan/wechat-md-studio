import { describe, expect, it } from 'vitest'
import {
  dropUserFontPicks, fontStack, loadTemplateCustomStore, normalizeTemplateCustomStore, resetTemplateCustom,
  resolveTemplateCustom, saveTemplateCustomStore, setCustomColor, setCustomFont, templateCustom,
  TEMPLATE_CUSTOM_KEY, type TemplateCustomStore,
} from './template-custom'

const slots = {
  colors: [{ var: '--accent', name: '主色' }, { var: '--paper', name: '底色' }],
  fonts: [{ var: '--display', name: '标题' }, { var: '--body-font', name: '正文' }],
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    map,
  }
}

describe('template colour and font picks', () => {
  it('keeps colours per variant and fonts per template', () => {
    let store: TemplateCustomStore = {}
    store = setCustomColor(store, 'public.aurora', 'dawn', '--accent', '#ff0000')
    store = setCustomColor(store, 'public.aurora', 'dusk', '--accent', '#00ff00')
    store = setCustomFont(store, 'public.aurora', '--display', { source: 'builtin', family: 'LXGW WenKai' })
    const entry = templateCustom(store, 'public.aurora')
    expect(entry.colors).toEqual({ dawn: { '--accent': '#ff0000' }, dusk: { '--accent': '#00ff00' } })
    expect(entry.fonts['--display']).toEqual({ source: 'builtin', family: 'LXGW WenKai' })
    expect(templateCustom(store, 'reed')).toEqual({ colors: {}, fonts: {} })
  })

  it('refuses colours that are not plain colour values', () => {
    const store = setCustomColor({}, 't', 'v', '--accent', 'url(https://example.test/x.png)')
    expect(store).toEqual({})
  })

  it('drops a template entry once every pick is cleared', () => {
    let store = setCustomColor({}, 't', 'v', '--accent', '#123456')
    store = setCustomColor(store, 't', 'v', '--accent', null)
    expect(store).toEqual({})
  })

  it('resets one variant’s colours and all fonts, keeping other variants', () => {
    let store = setCustomColor({}, 't', 'a', '--accent', '#111111')
    store = setCustomColor(store, 't', 'b', '--accent', '#222222')
    store = setCustomFont(store, 't', '--display', { source: 'builtin', family: 'Smiley Sans' })
    store = resetTemplateCustom(store, 't', 'a')
    expect(templateCustom(store, 't')).toEqual({ colors: { b: { '--accent': '#222222' } }, fonts: {} })
  })

  it('forgets a deleted user font everywhere', () => {
    let store = setCustomFont({}, 'x', '--display', { source: 'user', id: 'abc' })
    store = setCustomFont(store, 'y', '--body-font', { source: 'user', id: 'abc' })
    store = setCustomFont(store, 'y', '--display', { source: 'user', id: 'keep' })
    store = dropUserFontPicks(store, 'abc')
    expect(store).toEqual({ y: { colors: {}, fonts: { '--display': { source: 'user', id: 'keep' } } } })
  })

  it('resolves only declared slots and known fonts', () => {
    let store = setCustomColor({}, 't', 'v', '--accent', '#abcdef')
    store = setCustomColor(store, 't', 'v', '--gone', '#000000')
    store = setCustomFont(store, 't', '--display', { source: 'builtin', family: 'LXGW WenKai' })
    store = setCustomFont(store, 't', '--body-font', { source: 'user', id: 'missing' })
    const resolved = resolveTemplateCustom(templateCustom(store, 't'), 'v', slots, () => undefined)
    expect(resolved.vars).toEqual({ '--accent': '#abcdef', '--display': fontStack('LXGW WenKai') })
    expect(resolved.faces).toEqual([{ family: 'LXGW WenKai', weights: [400] }])
    expect(resolved.userFonts).toEqual([])
  })

  it('resolves a user font to its registered family', () => {
    const store = setCustomFont({}, 't', '--body-font', { source: 'user', id: 'f1' })
    const resolved = resolveTemplateCustom(templateCustom(store, 't'), 'v', slots, (id) => `Reed User Font ${id}`)
    expect(resolved.vars['--body-font']).toBe(fontStack('Reed User Font f1'))
    expect(resolved.userFonts).toEqual(['f1'])
    expect(resolved.faces).toEqual([])
  })

  it('ignores a catalog family that is not offered', () => {
    const store = setCustomFont({}, 't', '--display', { source: 'builtin', family: 'Comic Sans MS' })
    expect(resolveTemplateCustom(templateCustom(store, 't'), 'v', slots, () => undefined).vars).toEqual({})
  })

  it('quotes a family without letting it break out of the declaration', () => {
    expect(fontStack('Evil"; color: red')).toBe('"Evil; color: red", "Noto Sans SC", sans-serif')
  })

  it('round-trips through storage and survives garbage', () => {
    const storage = memoryStorage()
    const store = setCustomColor({}, 't', 'v', '--accent', 'rgba(1, 2, 3, 0.5)')
    saveTemplateCustomStore(store, storage)
    expect(loadTemplateCustomStore(storage)).toEqual(store)
    storage.map.set(TEMPLATE_CUSTOM_KEY, '{not json')
    expect(loadTemplateCustomStore(storage)).toEqual({})
    expect(normalizeTemplateCustomStore({
      t: { colors: { v: { '--a': '#fff', '--b': 'expression(x)', '--c': 4 } }, fonts: { '--d': { source: 'web' } } },
      u: 'nope',
    })).toEqual({ t: { colors: { v: { '--a': '#fff' } }, fonts: {} } })
  })
})
