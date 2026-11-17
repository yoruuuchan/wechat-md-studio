/**
 * Load the public template packages.
 *
 * The network half runs for every package at once: nine packages awaited one
 * after another made a waterfall where the last request started about2.2 s
 * after the first. The CPU half - unzip, parse, CSS sanitizing, font
 * registration - still runs one package at a time in catalog order, because
 * decompressing all nine at once is the CPU / memory spike this avoids.
 *
 * One package failing must not hide the eight that worked: the failure is
 * reported once (the first in catalog order), and the successful results come
 * back in catalog order.
 */
import { CardTemplateError } from './card-template-format'

export interface PublicTemplatePackage {
  id: string
  /** Static path of the .reedcard archive. */
  pack: string
}

export interface PublicTemplateLoadDeps<T> {
  catalog: readonly PublicTemplatePackage[]
  /** Network half; may run concurrently. */
  fetchPack: (pack: string) => Promise<ArrayBuffer>
  /** CPU half; always called in catalog order, one at a time. */
  install: (item: PublicTemplatePackage, raw: ArrayBuffer) => Promise<T>
}

export interface PublicTemplateLoadResult<T> {
  templates: T[]
  /** The first package failure in catalog order, if any. */
  error: CardTemplateError | null
}

type FetchedPackage =
  | { item: PublicTemplatePackage; raw: ArrayBuffer; error?: never }
  | { item: PublicTemplatePackage; raw?: never; error: CardTemplateError }

function asTemplateError(item: unknown): CardTemplateError {
  if (item instanceof CardTemplateError) return item
  return new CardTemplateError('unknown', item instanceof Error ? item.message : String(item))
}

export async function loadPublicTemplatePackages<T>(
  deps: PublicTemplateLoadDeps<T>,
): Promise<PublicTemplateLoadResult<T>> {
  const fetched = await Promise.all(
    deps.catalog.map(async (item): Promise<FetchedPackage> => {
      try {
        return { item, raw: await deps.fetchPack(item.pack) }
      } catch (error) {
        return { item, error: asTemplateError(error) }
      }
    }),
  )
  const templates: T[] = []
  let error: CardTemplateError | null = null
  for (const entry of fetched) {
    if (entry.error) {
      error ??= entry.error
      continue
    }
    try {
      templates.push(await deps.install(entry.item, entry.raw))
    } catch (installError) {
      error ??= asTemplateError(installError)
    }
  }
  return { templates, error }
}
