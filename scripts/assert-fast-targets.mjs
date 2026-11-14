// Functions that assert-fast.test.mjs runs in the Worker of assert-fast.mjs (PMK-312). Not named *.test.mjs.
export const quadratic = (s) => /a+b/.test(s)
export const linear = (s) => /a/.test(s)
export const asyncQuadratic = async (s) => /a+b/.test(s)
export const asyncLinear = async (s) => /a/.test(s)
export const busy60s = () => { const end = Date.now() + 60000; while (Date.now() < end); }
export const throws = () => { throw new Error('boom') }
