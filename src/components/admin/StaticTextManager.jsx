import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { formatApiError } from '@/lib/get-error-message'
import { invalidateStaticTextCache } from '@/lib/static-text'
import {
  deleteTextBlock,
  getTextBlocks,
  saveTextBlocks,
} from '@/services/static-text'

const LOCALES = ['ckb', 'ku']
const LOCALE_LABELS = { ckb: 'سۆرانی', ku: 'کورمانجی' }

/**
 * Pages → the message sections that feed them. A key lands on the first page
 * whose section list contains its top-level segment; anything unmatched
 * (including admin-added custom keys) falls into "other".
 */
const PAGES = [
  { id: 'home', label: 'سەرەکی', sections: ['Home', 'Hero', 'LatestUpdates'] },
  { id: 'news', label: 'هەواڵ', sections: ['News'] },
  { id: 'projects', label: 'پڕۆژە', sections: ['Projects', 'ProjectsPage'] },
  { id: 'gallery', label: 'گەلەری', sections: ['Gallery', 'ImageCollection'] },
  { id: 'sound', label: 'دەنگ', sections: ['Sound', 'Audio'] },
  { id: 'writings', label: 'نووسین', sections: ['Writings'] },
  { id: 'video', label: 'ڤیدیۆ', sections: ['Video'] },
  { id: 'about', label: 'دەربارە', sections: ['About'] },
  { id: 'services', label: 'خزمەتگوزاری', sections: ['Services'] },
  { id: 'contact', label: 'پەیوەندی', sections: ['Contact'] },
  { id: 'donate', label: 'بەخشین', sections: ['Donate'] },
  { id: 'search', label: 'گەڕان', sections: ['Search'] },
  { id: 'archive', label: 'ئەرشیڤ', sections: ['Archive'] },
  { id: 'auth', label: 'چوونەژوورەوە', sections: ['auth', 'Auth', 'Login'] },
  { id: 'layout', label: 'مێنیو و فوتەر', sections: ['Nav', 'Footer', 'LanguageSwitcher'] },
  { id: 'other', label: 'ئاخر', sections: ['Ui', 'Common', 'ErrorBoundary', 'NotFound'] },
]

const SECTION_TO_PAGE = new Map()
for (const page of PAGES) for (const s of page.sections) SECTION_TO_PAGE.set(s, page.id)

const pageOf = (row) =>
  SECTION_TO_PAGE.get(row.section ?? row.key.split('.')[0]) ?? 'other'

/**
 * Editable static text blocks — every (key, locale) pair from the
 * static_texts table, organized by page, with two textareas per row and a
 * single save that upserts only the edited cells.
 */
function StaticTextManager() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState(null) // key -> {ckb, ku}
  const [search, setSearch] = useState('')
  const [page, setPage] = useState('home')
  const [newKey, setNewKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const data = await getTextBlocks()
      setRows(data)
      const next = {}
      for (const row of data) {
        next[row.key] = {
          ckb: row.values?.ckb?.value ?? '',
          ku: row.values?.ku?.value ?? '',
        }
      }
      setDrafts(next)
      setError('')
    } catch (err) {
      setError(formatApiError(err).title)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const dirtyKeys = useMemo(() => {
    if (!drafts) return []
    const orig = {}
    for (const row of rows) {
      orig[row.key] = {
        ckb: row.values?.ckb?.value ?? '',
        ku: row.values?.ku?.value ?? '',
      }
    }
    return Object.keys(drafts).filter(
      (k) => drafts[k].ckb !== (orig[k]?.ckb ?? '') || drafts[k].ku !== (orig[k]?.ku ?? ''),
    )
  }, [drafts, rows])

  const pageCounts = useMemo(() => {
    const counts = new Map()
    for (const row of rows) {
      const p = pageOf(row)
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return counts
  }, [rows])

  /**
   * Search across the key AND both locales' text. The query may be a single
   * word, a sentence, or any combination of words — every word must appear
   * somewhere in the row, in any order. Arabic-script lookalikes are
   * normalized so ي/ی and ك/ک match either way.
   */
  const normalize = useCallback(
    (s) => s.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' '),
    [],
  )
  const searching = search.trim().length > 0
  const visibleRows = useMemo(() => {
    const words = normalize(search).split(' ').filter(Boolean)
    return rows.filter((r) => {
      if (words.length) {
        const haystack = normalize(
          `${r.key} ${drafts?.[r.key]?.ckb ?? ''} ${drafts?.[r.key]?.ku ?? ''}`,
        )
        return words.every((w) => haystack.includes(w))
      }
      return pageOf(r) === page
    })
  }, [rows, drafts, search, page, normalize])

  const grouped = useMemo(() => {
    const bySection = new Map()
    for (const r of visibleRows) {
      const section = r.section ?? r.key.split('.')[0]
      const list = bySection.get(section) ?? []
      list.push(r)
      bySection.set(section, list)
    }
    return [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visibleRows])

  const setValue = useCallback(
    (key, locale, value) => {
      setDrafts({ ...(drafts ?? {}), [key]: { ...(drafts?.[key] ?? { ckb: '', ku: '' }), [locale]: value } })
    },
    [drafts],
  )

  const handleSave = useCallback(async () => {
    if (!dirtyKeys.length) return
    const entries = dirtyKeys.flatMap((key) =>
      LOCALES.map((locale) => ({ key, locale, value: drafts[key]?.[locale] ?? '' })),
    )
    setSaving(true)
    try {
      await saveTextBlocks(entries)
      invalidateStaticTextCache()
      await refresh()
      toast.success('Saved', `${entries.length} text block(s) updated.`)
    } catch (err) {
      toast.apiError(err, 'Could not save the texts')
    } finally {
      setSaving(false)
    }
  }, [dirtyKeys, drafts, refresh, toast])

  const handleAddKey = useCallback(async () => {
    const key = newKey.trim()
    if (!key) return
    setSaving(true)
    try {
      await saveTextBlocks([
        { key, locale: 'ckb', value: '' },
        { key, locale: 'ku', value: '' },
      ])
      setNewKey('')
      await refresh()
      toast.success('Key added', key)
    } catch (err) {
      toast.apiError(err, 'Could not add the key')
    } finally {
      setSaving(false)
    }
  }, [newKey, refresh, toast])

  const handleDelete = useCallback(async () => {
    const row = pendingDelete
    if (!row) return
    setSaving(true)
    try {
      for (const locale of LOCALES) {
        const id = row.values?.[locale]?.id
        if (id) await deleteTextBlock(id)
      }
      setPendingDelete(null)
      await refresh()
      toast.success('Deleted', row.key)
    } catch (err) {
      toast.apiError(err, 'Could not delete the key')
    } finally {
      setSaving(false)
    }
  }, [pendingDelete, refresh, toast])

  const activePage = PAGES.find((p) => p.id === page) ?? PAGES[0]

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle>دەقە ستاتیکەکان</CardTitle>
        <CardDescription>
          Editable interface strings organized by page — the public pages read
          them live; missing keys fall back to the bundled defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="گەڕان بە وشە یان ڕستە لە هەموو دەقەکان…"
              className="w-64 ps-8"
            />
          </div>
          <div className="ms-auto">
            <Button onClick={handleSave} disabled={saving || dirtyKeys.length === 0}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              پاشەکەوت ({dirtyKeys.length})
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b pb-3">
          {PAGES.map((p) => {
            const count = pageCounts.get(p.id) ?? 0
            const active = !searching && p.id === page
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPage(p.id)
                  setSearch('')
                }}
                className={
                  'rounded-full border px-4 py-1.5 text-sm transition-colors ' +
                  (active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted/40 text-foreground hover:bg-muted')
                }
              >
                {p.label}
                <span
                  className={
                    'ms-2 rounded-full px-1.5 text-xs ' +
                    (active ? 'bg-primary-foreground/20' : 'bg-muted')
                  }
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={`کلیلی نوێ — بۆ نموونە ${activePage.sections[0]}.fieldName`}
            className="w-72 font-mono"
            dir="ltr"
          />
          <Button variant="outline" onClick={handleAddKey} disabled={saving || !newKey.trim()}>
            <Plus className="me-1 h-4 w-4" /> کلیل زیاد بکە
          </Button>
        </div>

        {searching && (
          <p className="text-sm text-muted-foreground">
            {visibleRows.length} دەق دۆزرایەوە — دەستکارییەکانی ئێرە پاشەکەوت دەکرێن.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <Skeleton className="h-40 w-full" />}

        {!loading &&
          grouped.map(([section, sectionRows]) => (
            <div key={section} className="space-y-2">
              <h3 className="text-sm font-semibold text-primary" dir="ltr">
                {section}
              </h3>
              <div className="rounded-lg border">
                {sectionRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(160px,240px)_1fr_1fr_auto] items-start gap-3 border-b p-3 last:border-b-0"
                  >
                    <div className="break-all pt-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {row.key}
                    </div>
                    {LOCALES.map((locale) => (
                      <div key={locale} className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {LOCALE_LABELS[locale]}
                        </span>
                        <textarea
                          value={drafts?.[row.key]?.[locale] ?? ''}
                          onChange={(e) => setValue(row.key, locale, e.target.value)}
                          rows={2}
                          dir={locale === 'ku' ? 'ltr' : 'rtl'}
                          className="flex min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-6 text-destructive"
                      onClick={() => setPendingDelete(row)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

        {!loading && grouped.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {searching
              ? 'هیچ دەقێک بۆ ئەم گەڕانە نەدۆزرایەوە.'
              : 'هیچ دەقێک لەم لاپەڕەدا نییە — کلیلێک زیاد بکە.'}
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete text block?"
        description={`"${pendingDelete?.key ?? ''}" will be removed for both locales. The bundled default will be used again.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </Card>
  )
}

export { StaticTextManager }
