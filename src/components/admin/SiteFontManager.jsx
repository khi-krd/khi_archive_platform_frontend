import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw, Trash2, Type, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormErrorBox } from '@/components/ui/form-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { formatApiError } from '@/lib/get-error-message'
import {
  clearActiveSiteFont,
  refreshActiveSiteFont,
  setActiveSiteFont,
} from '@/lib/site-font'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_FONT_ACCEPT,
  activateSiteFont,
  deactivateSiteFont,
  deleteSiteFont,
  fontFormatHint,
  listSiteFonts,
  siteFontFileUrl,
  uploadSiteFont,
  validateFontFile,
} from '@/services/site-font'

const PREVIEW_STYLE_ID = 'khi-site-font-previews'

// One @font-face per library row so each name renders in its own typeface.
// The file endpoint is public (/api/guest/**) so a plain CSS url() loads it.
function FontPreviewStyles({ fonts }) {
  useEffect(() => {
    let style = document.getElementById(PREVIEW_STYLE_ID)
    if (!fonts.length) {
      style?.remove()
      return
    }
    if (!style) {
      style = document.createElement('style')
      style.id = PREVIEW_STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = fonts
      .map((f) => {
        const src = siteFontFileUrl(f.id, f.updatedAt)
        return `@font-face{font-family:"khi-site-font-preview-${f.id}";src:url("${src}")${fontFormatHint(src)};font-weight:100 900;font-display:swap}`
      })
      .join('\n')
  }, [fonts])

  // Styles for fonts this admin can still see are left in place on unmount —
  // they are harmless and let a remount skip a refetch.
  return null
}

// Admin → Settings → Site font.
//
// The typeface library: upload font files, activate ONE — it becomes the app
// font on every page (public catalogue, auth screens, staff workspaces) via
// the shared `lib/site-font` store. Deactivating or deleting the active row
// returns the app to the bundled Geist stack.
function SiteFontManager() {
  const toast = useToast()
  const inputRef = useRef(null)

  const [fonts, setFonts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [actionError, setActionError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      setFonts(await listSiteFonts())
    } catch (error) {
      setLoadError(formatApiError(error, 'Could not load the font library.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        const rows = await listSiteFonts()
        if (!cancelled) setFonts(rows)
      } catch (error) {
        if (!cancelled) setLoadError(formatApiError(error, 'Could not load the font library.'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadInitial()

    return () => {
      cancelled = true
    }
  }, [])

  // Picked = committed: a valid file uploads immediately, no second click.
  const chooseFile = (picked) => {
    if (!picked || isSaving) return
    const message = validateFontFile(picked)
    if (message) {
      setFileError(message)
      return
    }
    setFileError('')
    setActionError(null)
    setFile(picked) // its name labels the drop zone while it uploads
    handleUpload(picked)
  }

  const handleInputChange = (event) => {
    chooseFile(event.target.files?.[0])
    event.target.value = ''
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragging(false)
    chooseFile(event.dataTransfer?.files?.[0])
  }

  const handleUpload = async (picked) => {
    const upload = picked ?? file
    if (!upload) return

    setIsSaving(true)
    setActionError(null)
    setProgress(0)

    // No separate name field — the library label comes from the file itself.
    const name = upload.name.replace(/\.[^.]+$/, '')

    try {
      const saved = await uploadSiteFont(upload, name, {
        onUploadProgress: (event) => {
          if (!event.total) return
          setProgress(Math.round((event.loaded / event.total) * 100))
        },
      })

      setFonts((prev) => [saved, ...prev])
      // The backend auto-activates the first font — mirror that immediately
      // so this session paints with it without a reload.
      if (saved?.active) setActiveSiteFont(saved)
      toast.success('Font uploaded', saved?.active ? 'It is now the active site font.' : 'Activate it when you are ready.')
    } catch (error) {
      setActionError(formatApiError(error, 'Could not upload the font.'))
      toast.apiError(error, 'Could not upload the font')
    } finally {
      setIsSaving(false)
      setProgress(0)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleToggleActive = async (font) => {
    setBusyId(font.id)
    setActionError(null)
    try {
      const saved = font.active
        ? await deactivateSiteFont(font.id)
        : await activateSiteFont(font.id)

      setFonts((prev) =>
        prev.map((f) => (f.id === saved.id ? saved : saved.active ? { ...f, active: false } : f)),
      )
      if (saved.active) setActiveSiteFont(saved)
      else clearActiveSiteFont()
      toast.success(
        saved.active ? 'Font activated' : 'Font deactivated',
        saved.active ? 'Every page now uses this typeface.' : 'The app uses the bundled font again.',
      )
    } catch (error) {
      setActionError(formatApiError(error, 'Could not update the font.'))
      toast.apiError(error, 'Could not update the font')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (deleteTarget?.id == null) return

    setIsDeleting(true)
    try {
      await deleteSiteFont(deleteTarget.id)
      const wasActive = deleteTarget.active
      setFonts((prev) => prev.filter((f) => f.id !== deleteTarget.id))
      setDeleteTarget(null)
      // Deleting the active row leaves nothing live — resync the store.
      if (wasActive) refreshActiveSiteFont().catch(() => {})
      toast.success('Font deleted', 'The row and its stored file were removed.')
    } catch (error) {
      setActionError(formatApiError(error, 'Could not delete the font.'))
      toast.apiError(error, 'Could not delete the font')
      setDeleteTarget(null)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Card className="border-border bg-card shadow-sm shadow-black/5">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Type className="size-4 text-primary" />
          Site font
        </CardTitle>
        <CardDescription>
          Upload a typeface and activate it — every page (public catalogue, sign-in screens and
          staff workspaces) paints with it. Deactivating returns the app to the bundled font.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : (
          <>
            {loadError ? <FormErrorBox error={loadError} /> : null}

            <FontPreviewStyles fonts={fonts} />

            {fonts.length ? (
              <ul className="space-y-2.5">
                {fonts.map((font) => (
                  <li
                    key={font.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-2xl border p-4',
                      font.active
                        ? 'border-primary/50 bg-primary/[0.05]'
                        : 'border-border bg-muted/20',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        {font.name || `Font #${font.id}`}
                        {font.active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                            <Check className="size-3" />
                            Active
                          </span>
                        ) : null}
                      </p>
                      <p
                        className="mt-1 truncate text-lg leading-snug text-foreground/80"
                        style={{ fontFamily: `"khi-site-font-preview-${font.id}", sans-serif` }}
                        dir="auto"
                      >
                        ئەرشیفی KHI — Archive AaGg 123
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant={font.active ? 'outline' : 'default'}
                        size="sm"
                        disabled={busyId === font.id || isDeleting}
                        onClick={() => handleToggleActive(font)}
                      >
                        {busyId === font.id ? <Loader2 className="size-4 animate-spin" /> : null}
                        {font.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${font.name || 'font'}`}
                        disabled={busyId === font.id || isDeleting}
                        onClick={() => setDeleteTarget(font)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-muted/20 p-5 text-center text-sm text-muted-foreground">
                No fonts uploaded yet — the app uses the bundled font.
              </p>
            )}

            <button
              type="button"
              disabled={isSaving}
              className={cn(
                'flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-colors disabled:cursor-wait',
                isDragging
                  ? 'border-primary bg-primary/[0.06]'
                  : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-primary/[0.03] disabled:hover:border-border disabled:hover:bg-muted/20',
              )}
              onClick={() => inputRef.current?.click()}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => {
                event.preventDefault()
                if (!isSaving) setIsDragging(true)
              }}
              onDrop={handleDrop}
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-background text-primary shadow-sm ring-1 ring-border">
                {isSaving ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {isSaving ? `Uploading ${file?.name ?? 'font'}…` : 'Choose a font file'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isSaving
                    ? `Saving${progress ? ` ${progress}%` : ''} — it joins the library below`
                    : 'Drag a file here or click to browse — it uploads straight away'}
                </p>
                {!isSaving ? (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    WOFF2, WOFF, TTF, or OTF · up to 20 MB · a variable font covers every weight
                  </p>
                ) : null}
              </div>
            </button>

            {fileError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {fileError}
              </p>
            ) : null}

            {actionError ? <FormErrorBox error={actionError} /> : null}

            {isSaving && progress > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={isLoading || isSaving} onClick={load}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_FONT_ACCEPT}
              className="sr-only"
              onChange={handleInputChange}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteTarget != null}
        title={`Delete ${deleteTarget?.name || 'this font'}?`}
        description={
          deleteTarget?.active
            ? 'This font is currently active — deleting it returns every page to the bundled font. The stored file is removed for good.'
            : 'The library row and its stored font file are removed for good.'
        }
        confirmLabel="Delete font"
        isProcessing={isDeleting}
        onConfirm={handleDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </Card>
  )
}

export { SiteFontManager }
