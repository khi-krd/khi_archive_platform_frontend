import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw, Trash2, Type, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormErrorBox } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
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

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Renders sample text in a not-yet-uploaded font file via a blob @font-face,
// so the admin can see the typeface before committing it.
function PendingFontPreview({ blobUrl }) {
  useEffect(() => {
    if (!blobUrl) return undefined
    const style = document.createElement('style')
    style.textContent = `@font-face{font-family:"khi-site-font-pending";src:url("${blobUrl}");font-weight:100 900;font-display:swap}`
    document.head.appendChild(style)
    return () => style.remove()
  }, [blobUrl])

  if (!blobUrl) return null
  return (
    <p
      className="truncate text-lg leading-snug text-foreground/80"
      style={{ fontFamily: '"khi-site-font-pending", sans-serif' }}
      dir="auto"
    >
      ئەرشیفی KHI — Archive AaGg 123
    </p>
  )
}

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
  const previewUrlRef = useRef('')

  const [fonts, setFonts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState('')
  const [fontName, setFontName] = useState('')
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
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const setPendingFile = (picked) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = picked ? URL.createObjectURL(picked) : ''
    setFile(picked)
    setFilePreview(previewUrlRef.current)
    if (picked && !fontName.trim()) {
      setFontName(picked.name.replace(/\.[^.]+$/, ''))
    }
  }

  const chooseFile = (picked) => {
    if (!picked) return
    const message = validateFontFile(picked)
    if (message) {
      setPendingFile(null)
      setFileError(message)
      return
    }
    setFileError('')
    setActionError(null)
    setPendingFile(picked)
  }

  const clearFile = () => {
    setPendingFile(null)
    setFileError('')
    if (inputRef.current) inputRef.current.value = ''
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

  const handleUpload = async () => {
    if (!file) return

    setIsSaving(true)
    setActionError(null)
    setProgress(0)

    try {
      const saved = await uploadSiteFont(file, fontName.trim(), {
        onUploadProgress: (event) => {
          if (!event.total) return
          setProgress(Math.round((event.loaded / event.total) * 100))
        },
      })

      setFonts((prev) => [saved, ...prev])
      // The backend auto-activates the first font — mirror that immediately
      // so this session paints with it without a reload.
      if (saved?.active) setActiveSiteFont(saved)
      setFontName('')
      clearFile()
      toast.success('Font uploaded', saved?.active ? 'It is now the active site font.' : 'Activate it when you are ready.')
    } catch (error) {
      setActionError(formatApiError(error, 'Could not upload the font.'))
      toast.apiError(error, 'Could not upload the font')
    } finally {
      setIsSaving(false)
      setProgress(0)
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

            {file ? (
              <div className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                    <Check className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                    <PendingFontPreview blobUrl={filePreview} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear the selected file"
                    disabled={isSaving}
                    onClick={clearFile}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="site-font-name" className="text-xs font-medium text-foreground">
                    Font name
                  </label>
                  <Input
                    id="site-font-name"
                    value={fontName}
                    onChange={(event) => setFontName(event.target.value)}
                    placeholder="e.g. Rabar, Vazirmatn"
                    disabled={isSaving}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={cn(
                  'flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-colors',
                  isDragging
                    ? 'border-primary bg-primary/[0.06]'
                    : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-primary/[0.03]',
                )}
                onClick={() => inputRef.current?.click()}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDrop={handleDrop}
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-background text-primary shadow-sm ring-1 ring-border">
                  <Upload className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Choose a font file</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drag a file here or click to browse
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    WOFF2, WOFF, TTF, or OTF · up to 20 MB · a variable font covers every weight
                  </p>
                </div>
              </button>
            )}

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
              <Button type="button" disabled={!file || isSaving} onClick={handleUpload}>
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {isSaving ? `Uploading${progress ? ` ${progress}%` : ''}…` : 'Upload font'}
              </Button>

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
