import source from '../../skills/wechat-typesetter/SKILL.md?raw'

// Vite and the server build embed the same tracked source. No generated copy.
export const writingSkill = source.replace(/\r\n/g, '\n')
