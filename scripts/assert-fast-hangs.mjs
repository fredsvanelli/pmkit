// Target of assert-fast.test.mjs whose import never ends, with a timer that keeps the Worker alive (PMK-312). Not named *.test.mjs.
setInterval(() => {}, 1000)
await new Promise(() => {})
export const never = () => {}
