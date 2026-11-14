// Functions that assert-fast.test.mjs runs in the Worker of assert-fast.mjs (PMK-312). Not named *.test.mjs.
export const quadratic = (s) => /a+b/.test(s)
export const linear = (s) => /a/.test(s)
export const asyncQuadratic = async (s) => /a+b/.test(s)
export const asyncLinear = async (s) => /a/.test(s)
export const busy60s = () => { const end = Date.now() + 60000; while (Date.now() < end); }
export const throws = () => { throw new Error('boom') }
export const neverImported = null
export const exits = () => process.exit(3)
export const lengths = (list) => { if (!Array.isArray(list)) throw new Error('not an array'); if (list.length !== 3) throw new Error(`length ${list.length}`) }
export const recurse = (n) => (n === 0 ? 0 : 1 + recurse(n - 1))
