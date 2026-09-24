import { useEffect, useRef, useState } from 'react'
import { Check, ImageIcon, Loader2, RefreshCw, Trash2, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormErrorBox } from '@/components/ui/form-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { formatApiError } from '@/lib/get-error-message'
import {
  clearActiveAuthImage,
  refreshActiveAuthImage,
  resolveAuthImageSrc,
  setActiveAuthImage,
} from '@/lib/auth-image'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_IMAGE_ACCEPT,
  deleteAuthImage,
  replaceAuthImage,
  uploadAuthImage,
  validateAuthImageFile,
} from '@/services/auth-image'

function formatTimestamp(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    parsed,
  )
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Renders the candidate the way the sign-in page will: just the photo,
// full-bleed — no text or effects are drawn over it.
function PanelPreview({ src }) {
  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/5] max-h-72 overflow-hidden rounded-2xl border border-border bg-[#0e211a]">
        {src ? (
          <img alt="" className="absolute inset-0 size-full object-cover" src={src} draggable="false" />
        ) : (
          <div className="grid size-full place-items-center p-6 text-center text-xs text-[#f3ead4]/60">
            No image uploaded — the built-in mountain scene is shown.
          </div>
        )}
      </div>
      <p className="text-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Brand panel preview
      </p>
    </div>
  )
}

// Admin → Settings → Auth page image.
//
// The panel image is a database record, never a file in the repo: upload once
// here and the sign-in / register brand panel picks it up through the shared
// `lib/auth-image` store. Deleting it restores the built-in animated scene.
function AuthImageManager() {
  const toast = useToast()
  const inputRef = useRef(null)
  const previewUrlRef = useRef('')

  const [record, setRecord] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState('')
  const [fileError, setFileError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [saveError, setSaveError] = useState(null)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const current = await refreshActiveAuthImage()
      setRecord(current ?? null)
    } catch (error) {
      setLoadError(formatApiError(error, 'Could not load the current image.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        const current = await refreshActiveAuthImage()
        if (!cancelled) setRecord(current ?? null)
      } catch (error) {
        if (!cancelled) setLoadError(formatApiError(error, 'Could not load the current image.'))
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
  }

  const chooseFile = (picked) => {
    if (!picked) return
    const message = validateAuthImageFile(picked)
    if (message) {
      setPendingFile(null)
      setFileError(message)
      return
    }
    setFileError('')
    setSaveError(null)
    setPendingFile(picked)
  }

  const clearFile = () => {
    setPendingFile(null)
    setFileError('')
    setSaveError(null)
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

  const handleSave = async () => {
    if (!file) return

    setIsSaving(true)
    setSaveError(null)
    setProgress(0)

    const uploadOptions = {
      onUploadProgress: (event) => {
        if (!event.total) return
        setProgress(Math.round((event.loaded / event.total) * 100))
      },
    }

    try {
      const saved = record?.id != null
        ? await replaceAuthImage(record.id, file, uploadOptions)
        : await uploadAuthImage(file, uploadOptions)

      setRecord(saved)
      setActiveAuthImage(saved)
      clearFile()
      toast.success(
        record?.id != null ? 'Panel image replaced' : 'Panel image uploaded',
        'The sign-in and register pages now show the new image.',
      )
    } catch (error) {
      setSaveError(formatApiError(error, 'Could not save the image.'))
      toast.apiError(error, 'Could not save the image')
    } finally {
      setIsSaving(false)
      setProgress(0)
    }
  }

  const handleDelete = async () => {
    if (record?.id == null) return

    setIsDeleting(true)
    try {
      await deleteAuthImage(record.id)
      setRecord(null)
      clearActiveAuthImage()
      setConfirmDeleteOpen(false)
      toast.success('Panel image deleted', 'The auth pages show the built-in scene again.')
    } catch (error) {
      setSaveError(formatApiError(error, 'Could not delete the image.'))
      toast.apiError(error, 'Could not delete the image')
      setConfirmDeleteOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const currentSrc = record ? resolveAuthImageSrc(record) : null
  const previewSrc = filePreview || currentSrc
  const hasUploadedImage = Boolean(record?.imageUrl)

  return (
    <Card className="border-border bg-card shadow-sm shadow-black/5">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ImageIcon className="size-4 text-primary" />
          Auth page image
        </CardTitle>
        <CardDescription>
          The large panel beside the sign-in and register forms. Upload an image here and it
          replaces the built-in mountain scene on both pages — delete it to bring the scene back.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-72 max-w-xs rounded-2xl" />
        ) : (
          <>
            {loadError ? <FormErrorBox error={loadError} /> : null}

            <div className="max-w-xs">
              <PanelPreview src={previewSrc} />
            </div>

            <div className="grid gap-3 rounded-2xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-3">
              <div className="space-y-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Source
                </p>
                <p className="font-medium text-foreground">
                  {hasUploadedImage ? `Database record #${record.id ?? '—'}` : 'Built-in scene'}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Last updated
                </p>
                <p className="font-medium text-foreground">
                  {hasUploadedImage ? formatTimestamp(record.updatedAt) : '—'}
                </p>
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  File
                </p>
                {hasUploadedImage ? (
                  <a
                    className="block truncate font-mono text-xs text-primary hover:underline"
                    href={record.imageUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={record.imageUrl}
                  >
                    {record.imageUrl}
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
            </div>

            {file ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                  <Check className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)} · shown in the preview above, not saved yet
                  </p>
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
                  <p className="text-sm font-semibold text-foreground">
                    {hasUploadedImage ? 'Choose a replacement image' : 'Choose the panel image'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drag a file here or click to browse
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    PNG, JPG, WEBP, AVIF, or SVG · up to 15 MB · a tall photo looks best
                  </p>
                </div>
              </button>
            )}

            {fileError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {fileError}
              </p>
            ) : null}

            {saveError ? <FormErrorBox error={saveError} /> : null}

            {isSaving && progress > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!file || isSaving} onClick={handleSave}>
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {isSaving
                  ? `Uploading${progress ? ` ${progress}%` : ''}…`
                  : hasUploadedImage
                    ? 'Replace image'
                    : 'Upload image'}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={isLoading || isSaving}
                onClick={load}
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>

              {hasUploadedImage ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="ml-auto"
                  disabled={isSaving || isDeleting}
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 className="size-4" />
                  Delete image
                </Button>
              ) : null}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_IMAGE_ACCEPT}
              className="sr-only"
              onChange={handleInputChange}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete the auth page image?"
        description="The record and its stored image file are removed for good. The sign-in and register pages go back to the built-in mountain scene until a new image is uploaded."
        confirmLabel="Delete image"
        isProcessing={isDeleting}
        onConfirm={handleDelete}
        onOpenChange={setConfirmDeleteOpen}
      />
    </Card>
  )
}

export { AuthImageManager }
