// Line diff for showing what a file replacement would change. Lines in both texts
// start with two spaces, removed lines with "-", added lines with "+".

const lines = (text) => {
  if (text === '') return []
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

export function lineDiff(before, after) {
  const a = lines(before)
  const b = lines(after)
  // common[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(`  ${a[i++]}`)
      j++
    } else if (i < a.length && (j === b.length || common[i + 1][j] >= common[i][j + 1])) {
      out.push(`-${a[i++]}`)
    } else {
      out.push(`+${b[j++]}`)
    }
  }
  return out.map((line) => `${line}\n`).join('')
}
