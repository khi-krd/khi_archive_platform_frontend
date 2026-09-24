import { apiClient } from '@/lib/api-client'
import { multipartUploadConfig } from '@/lib/multipart-upload'

// AuthImage — the uploaded brand-panel image for the sign-in / register
// pages. Mirrors services/khi-logo.js: simple CRUD over /api/auth-image,
// and the record only holds the public S3 `imageUrl`, so once we know that
// URL any <img> can render it without a token.
//
// Wire shape: { id, imageUrl, createdAt, updatedAt }

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/avif']
const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

function normalizeAuthImage(payload) {
  if (!payload) return null

  if (Array.isArray(payload)) {
    return normalizeAuthImage(payload[payload.length - 1])
  }

  if (Array.isArray(payload.content)) {
    return normalizeAuthImage(payload.content[payload.content.length - 1])
  }

  if (payload.data && typeof payload.data === 'object') {
    return normalizeAuthImage(payload.data)
  }

  const imageUrl = payload.imageUrl ?? payload.imageURL ?? payload.url ?? ''
  if (!imageUrl) return null

  return {
    id: payload.id ?? null,
    imageUrl: String(imageUrl),
    createdAt: payload.createdAt ?? null,
    updatedAt: payload.updatedAt ?? payload.createdAt ?? null,
  }
}

function validateAuthImageFile(file) {
  if (!file) return 'Choose an image file first.'
  if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Unsupported format. Use PNG, JPG, WEBP, AVIF, or SVG.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB.`
  }
  return ''
}

// The current panel image. Reads go through the public guest endpoint —
// the auth pages are shown to anonymous visitors, and apiClient still
// attaches the token when one exists, so this single path serves admins,
// staff and guests alike. 404 ("nothing uploaded") returns null; every
// other failure rethrows so callers keep a cached record instead of
// flashing the bundled scene on a flaky network.
async function fetchCurrentAuthImage({ signal } = {}) {
  try {
    const { data } = await apiClient.get('/guest/auth-image', { signal })
    return normalizeAuthImage(data)
  } catch (error) {
    if (error?.response?.status === 404) return null
    throw error
  }
}

async function uploadAuthImage(file, uploadOptions) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post('/auth-image', formData, multipartUploadConfig(uploadOptions))
  return normalizeAuthImage(data)
}

// PATCH replaces the image on an existing record and drops the old S3 object.
async function replaceAuthImage(id, file, uploadOptions) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.patch(
    `/auth-image/${id}`,
    formData,
    multipartUploadConfig(uploadOptions),
  )
  return normalizeAuthImage(data)
}

// Deletes the row AND the S3 file — the auth pages fall back to the
// built-in animated scene.
async function deleteAuthImage(id) {
  const { data } = await apiClient.delete(`/auth-image/${id}`)
  return data
}

export {
  ACCEPTED_IMAGE_ACCEPT,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  deleteAuthImage,
  fetchCurrentAuthImage,
  normalizeAuthImage,
  replaceAuthImage,
  uploadAuthImage,
  validateAuthImageFile,
}
