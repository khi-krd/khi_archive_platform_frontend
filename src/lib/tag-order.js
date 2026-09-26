// Shared ordering for the هاوتاگ ("same tag") catalogue sort — used by both
// the guest fan-out path and the staff bulk-filter path so both render the
// exact same sequence.
//
// Order contract (what the admin asked for):
//   1. Items sharing the SAME tag group together. A tag only forms a group
//      when at least two items carry it ("same tag" implies shared). An
//      item with several shared tags sits under the one carried by the most
//      items — never duplicated.
//   2. Tag groups sort A→Z by tag text using a Sorani-aware collation
//      (ک before گ, ڕ/ژ/ڤ/ڵ/ۆ/ۇ/ێ in their real alphabet slots — a plain
//      code-point sort would scatter them to the end).
//   3. Inside a group: media kind order image → audio → video → text, then
//      title A→Z.
//   4. Everything that couldn't join a group (unique tags or no tags) lands
//      after the groups, sorted A→Z by person name — items with no person
//      go last, then media kind order and title break ties.

import { pickMediaTitle, extractPersonFromItem } from '@/components/public/public-helpers'

// Sorani (Central Kurdish) alphabet order.
const SORANI_ALPHABET = 'ابپتجچحخدرڕزژسشعغفڤقکگلڵمنهەوۆۇیێ'
const SORANI_RANK = new Map([...SORANI_ALPHABET].map((ch, i) => [ch, i]))

// Variant forms folded onto the canonical letter so "کورد" written with the
// Arabic ك or ی still lands where a Kurdish writer expects it.
const LETTER_FOLD = {
  ك: 'ک', ي: 'ی', ة: 'ە', ى: 'ی', أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا',
  ؤ: 'و', ئ: 'ی', ۊ: 'و', ﯼ: 'ی',
}

// Combining marks + tatweel are stripped before ranking — they carry no
// alphabet position and would otherwise shadow the letter under them. Kept
// as a code-point set because a regex class over combining marks trips
// eslint's no-misleading-character-class.
const STRIP_CODEPOINTS = new Set([0x0640, 0x0670])
for (let cp = 0x064b; cp <= 0x0652; cp++) STRIP_CODEPOINTS.add(cp)
for (let cp = 0x06d6; cp <= 0x06ed; cp++) STRIP_CODEPOINTS.add(cp)

function stripMarks(text) {
  let out = ''
  for (const ch of text) {
    if (!STRIP_CODEPOINTS.has(ch.codePointAt(0))) out += ch
  }
  return out
}

function foldChar(ch) {
  return LETTER_FOLD[ch] ?? ch
}

function charRank(ch) {
  const folded = foldChar(ch)
  if (SORANI_RANK.has(folded)) return SORANI_RANK.get(folded)
  const lower = folded.toLowerCase()
  if (lower >= 'a' && lower <= 'z') return 100 + lower.charCodeAt(0) - 97
  if (folded >= '0' && folded <= '9') return 140 + folded.charCodeAt(0) - 48
  if (folded >= '٠' && folded <= '٩') return 140 + folded.charCodeAt(0) - 1632
  return 200 + folded.codePointAt(0) / 1000
}

// Kurdish-aware A→Z comparison: Sorani letters first in proper alphabet
// order, then Latin, digits, anything else. Exported for reuse anywhere a
// Kurdish string list needs real alphabetical order.
export function compareSorani(a, b) {
  const as = [...stripMarks(String(a ?? '').trim())]
  const bs = [...stripMarks(String(b ?? '').trim())]
  const n = Math.min(as.length, bs.length)
  for (let i = 0; i < n; i++) {
    const d = charRank(as[i]) - charRank(bs[i])
    if (d) return d
  }
  return as.length - bs.length
}

// Normalize a tag for grouping: fold Arabic-variant letters, strip marks,
// lowercase — so "کورد" spelled كورد still shares one group.
function tagKey(value) {
  const folded = [...stripMarks(String(value ?? '').trim())]
    .map(foldChar)
    .join('')
    .toLocaleLowerCase()
  return folded || null
}

// Tags on a media DTO — a proper list on the guest DTOs, occasionally a
// comma/، separated string on slimmer rows.
export function tagsOfItem(item) {
  const t = item?.tags
  if (Array.isArray(t)) return t.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (typeof t === 'string') return t.split(/[,،;]/).map((x) => x.trim()).filter(Boolean)
  return []
}

function personNameOf(item) {
  const person = extractPersonFromItem(item)
  return person?.fullName || person?.name || item?.personName || null
}

function titleOfRow(item) {
  return (
    pickMediaTitle(item) ||
    item?.title ||
    item?.name ||
    item?.code ||
    ''
  )
}

const KIND_ORDER = { image: 0, audio: 1, video: 2, text: 3 }

// Round-robin classifier for the mixed "all" grid: every round contributes
// `chunk` items per kind in kind order — 10 images, 10 audio, 10 video,
// 10 text, then the next round repeats. Each kind's own list arrives
// already sorted (server-side for guests, sortRows for staff), so the
// interleave preserves the chosen ordering inside every 10-item run. A
// kind that runs dry simply stops contributing while the rest continue.
export function orderInterleavedByKind(
  rowsByKind,
  { chunk = 10, kindOrder = ['image', 'audio', 'video', 'text'] } = {},
) {
  const out = []
  const cursor = {}
  for (const kind of kindOrder) cursor[kind] = 0
  for (;;) {
    let added = 0
    for (const kind of kindOrder) {
      const list = rowsByKind[kind] || []
      const start = cursor[kind]
      const take = Math.min(chunk, list.length - start)
      if (take <= 0) continue
      for (let i = start; i < start + take; i++) out.push(list[i])
      cursor[kind] = start + take
      added += take
    }
    if (!added) break
  }
  return out
}

// Orders a mixed media list by the هاوتاگ contract. `kindOf` lets a caller
// override how each row's media kind is read (defaults to row.kind).
export function orderBySharedTag(rows, { kindOf = (row) => row?.kind } = {}) {
  const list = Array.isArray(rows) ? rows : []

  // Count how many items carry each (normalized) tag — a tag only becomes a
  // group when shared by at least two items.
  const counts = new Map()
  const tagKeysPerRow = list.map((row) => {
    const keys = new Set()
    for (const tag of tagsOfItem(row)) {
      const key = tagKey(tag)
      if (key) keys.add(key)
    }
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1)
    return keys
  })

  const entries = list.map((row, i) => {
    // The item's group = the shared tag carried by the most items; ties go
    // to the alphabetically smaller tag so the pick is deterministic.
    let group = null
    for (const key of tagKeysPerRow[i]) {
      if ((counts.get(key) || 0) < 2) continue
      if (
        group == null ||
        counts.get(key) > counts.get(group) ||
        (counts.get(key) === counts.get(group) && compareSorani(key, group) < 0)
      ) {
        group = key
      }
    }
    return {
      row,
      group,
      person: personNameOf(row),
      kind: KIND_ORDER[kindOf(row)] ?? 9,
      title: titleOfRow(row),
    }
  })

  entries.sort((a, b) => {
    // Tag groups first, ordered by tag text.
    if (a.group && b.group) {
      const g = compareSorani(a.group, b.group)
      if (g) return g
    } else if (a.group) {
      return -1
    } else if (b.group) {
      return 1
    } else {
      // Ungrouped remainder: person name A→Z, non-person items last.
      if (a.person && b.person) {
        const p = compareSorani(a.person, b.person)
        if (p) return p
      } else if (a.person) {
        return -1
      } else if (b.person) {
        return 1
      }
    }
    const k = a.kind - b.kind
    if (k) return k
    return compareSorani(a.title, b.title)
  })

  return entries.map((e) => e.row)
}
