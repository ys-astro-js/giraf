/**
 * Korean particles that depend on how a word ends: `파일이`/`숫자가`,
 * `datapars를`/`param을`. Hangul is read from its last syllable; digits and
 * Latin letters as they are read aloud in Korean.
 */

// 영 일 이 삼 사 오 육 칠 팔 구: a digit read with a final consonant.
const DIGIT_FINAL = "0136780"

function hasFinalConsonant(word: string): boolean {
  const text = word.trim()
  const last = text.at(-1) ?? ""
  const code = last.charCodeAt(0) - 0xac00
  if (code >= 0 && code <= 11171) return code % 28 !== 0
  if (/[0-9]/.test(last)) return DIGIT_FINAL.includes(last)
  // 엘, 엠, 엔, and -ng as in 링: other letters end in a vowel when read.
  return /([lmn]|ng)$/i.test(text)
}

/** `파일이`, `숫자가`. */
export const withSubject = (word: string) => word + (hasFinalConsonant(word) ? "이" : "가")

/** `datapars를`, `param을`. */
export const withObject = (word: string) => word + (hasFinalConsonant(word) ? "을" : "를")
