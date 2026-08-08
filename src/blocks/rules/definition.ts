import type { BlockRule } from '../../core/types.js'

const DEFINITION = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*(?:\n+|$)/

/** Link reference definition (`[label]: destination`). */
export const definition: BlockRule = {
  name: 'definition',
  priority: 875,
  starts: (src) => DEFINITION.test(src),
  tokenize(src) {
    const match = DEFINITION.exec(src)
    if (!match) return null
    const raw = match[0]
    return {
      token: {
        type: 'definition',
        raw,
        label: match[1],
        href: match[2] ?? match[3],
        title: match[4] ?? match[5] ?? match[6] ?? undefined,
      },
      raw,
    }
  },
}
