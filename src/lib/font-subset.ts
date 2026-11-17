/**
 * Cut a TrueType / OpenType font down to the code points of some text, with
 * HarfBuzz's own subsetter (harfbuzzjs ships it as a standalone WebAssembly
 * module with C exports and no imports). Loaded lazily: only an export that
 * uses a font from the reader's computer pays for the ~700 KB module.
 */
import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url'

interface SubsetExports {
  memory: WebAssembly.Memory
  malloc: (size: number) => number
  free: (ptr: number) => void
  hb_blob_create: (data: number, length: number, mode: number, user: number, destroy: number) => number
  hb_blob_destroy: (blob: number) => void
  hb_blob_get_data: (blob: number, length: number) => number
  hb_blob_get_length: (blob: number) => number
  hb_face_create: (blob: number, index: number) => number
  hb_face_destroy: (face: number) => void
  hb_face_reference_blob: (face: number) => number
  hb_set_add: (set: number, codepoint: number) => void
  hb_subset_input_create_or_fail: () => number
  hb_subset_input_destroy: (input: number) => void
  hb_subset_input_unicode_set: (input: number) => number
  hb_subset_or_fail: (face: number, input: number) => number
}

/** HB_MEMORY_MODE_WRITABLE: HarfBuzz may use the buffer in place. */
const MEMORY_MODE_WRITABLE = 2

let module: Promise<SubsetExports> | null = null

function load(): Promise<SubsetExports> {
  if (!module) {
    module = (async () => {
      const response = await fetch(subsetWasmUrl)
      if (!response.ok) throw new Error(`hb-subset: HTTP ${response.status}`)
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {})
      return instance.exports as unknown as SubsetExports
    })()
    module.catch(() => { module = null })
  }
  return module
}

/** Glyphs for `text` plus the space and the replacement character. */
export async function subsetFont(font: Uint8Array, text: string): Promise<Uint8Array> {
  const hb = await load()
  const fontPtr = hb.malloc(font.byteLength)
  if (!fontPtr) throw new Error('hb-subset: out of memory')
  new Uint8Array(hb.memory.buffer).set(font, fontPtr)
  const blob = hb.hb_blob_create(fontPtr, font.byteLength, MEMORY_MODE_WRITABLE, 0, 0)
  const face = hb.hb_face_create(blob, 0)
  hb.hb_blob_destroy(blob)
  const input = hb.hb_subset_input_create_or_fail()
  if (!input) {
    hb.hb_face_destroy(face)
    hb.free(fontPtr)
    throw new Error('hb-subset: no input')
  }
  const unicodes = hb.hb_subset_input_unicode_set(input)
  for (const codepoint of new Set([...text].map((char) => char.codePointAt(0)!).concat([0x20, 0xfffd]))) {
    hb.hb_set_add(unicodes, codepoint)
  }
  const subset = hb.hb_subset_or_fail(face, input)
  hb.hb_subset_input_destroy(input)
  try {
    if (!subset) throw new Error('hb-subset: failed')
    const result = hb.hb_face_reference_blob(subset)
    const length = hb.hb_blob_get_length(result)
    const offset = hb.hb_blob_get_data(result, 0)
    // Copy out before freeing: the view aliases WebAssembly memory.
    const bytes = new Uint8Array(hb.memory.buffer, offset, length).slice()
    hb.hb_blob_destroy(result)
    if (!length) throw new Error('hb-subset: empty result')
    return bytes
  } finally {
    if (subset) hb.hb_face_destroy(subset)
    hb.hb_face_destroy(face)
    hb.free(fontPtr)
  }
}
