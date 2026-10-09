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
const LOCALE_LABELS = { ckb: 'کوردی (سۆرانی)', ku: 'کوردی (کورمانجی)' }

/**
 * Editable static text blocks — every (key, locale) pair from the
 * static_texts table, grouped by section, with two textareas per row and a
 * single save that upserts only the edited cells.
 */
function StaticTextManager() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState(null) // key -> {ckb, ku}
  const [search, setSearch] = useState('')
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

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = rows.filter(
      (r) =>
        !q ||
        r.key.toLowerCase().includes(q) ||
        (drafts?.[r.key]?.ckb ?? '').toLowerCase().includes(q) ||
        (drafts?.[r.key]?.ku ?? '').toLowerCase().includes(q),
    )
    const bySection = new Map()
    for (const r of filtered) {
      const section = r.section ?? r.key.split('.')[0]
      const list = bySection.get(section) ?? []
      list.push(r)
      bySection.set(section, list)
    }
    return [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, drafts, search])

  const setValue = useCallback((key, locale, value) => {
    setDrafts((prev) => ({
      ...(prev ?? {}),
      [key]: { ...(prev?.[key] ?? { ckb: '', ku: '' }), [locale]: value },
    }))
  }, [])

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Static text blocks</CardTitle>
        <CardDescription>
          Editable interface strings keyed by message key and locale. Public pages
          read these live; missing keys fall back to the bundled defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys or text…"
              className="w-64 ps-8"
            />
          </div>
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="new.key.name"
            className="w-56 font-mono"
            dir="ltr"
          />
          <Button variant="outline" onClick={handleAddKey} disabled={saving || !newKey.trim()}>
            <Plus className="me-1 h-4 w-4" /> Add key
          </Button>
          <div className="ms-auto">
            <Button onClick={handleSave} disabled={saving || dirtyKeys.length === 0}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              Save ({dirtyKeys.length})
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <Skeleton className="h-40 w-full" />}

        {!loading &&
          grouped.map(([section, sectionRows]) => (
            <div key={section} className="space-y-2">
              <h3 className="text-sm font-semibold text-primary">{section}</h3>
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
                      className="text-destructive"
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
            No text blocks yet — add a key above.
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
