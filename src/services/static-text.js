import { apiClient } from '@/lib/api-client'

// Admin listing — one row per key, values keyed by locale.
export async function getTextBlocks() {
  const { data } = await apiClient.get('/text-blocks')
  return Array.isArray(data) ? data : []
}

// Bulk upsert: entries = [{ key, locale, value }]. Returns rows saved.
export async function saveTextBlocks(entries) {
  const { data } = await apiClient.put('/text-blocks', { entries })
  return data?.saved ?? entries.length
}

export async function deleteTextBlock(id) {
  const { data } = await apiClient.delete(`/text-blocks/${id}`)
  return data
}

// Public read — flat {key: value} map for one locale. No token needed.
export async function getPublicTextBlocks(locale = 'ckb') {
  const { data } = await apiClient.get('/guest/text-blocks', { params: { locale } })
  return data ?? {}
}
