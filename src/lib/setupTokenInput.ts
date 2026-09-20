// SETUP_TOKEN 通过 HTTP 头 X-Setup-Token 传输。HTTP 头值只能是 ISO-8859-1（≤ U+00FF），
// 浏览器构造 Headers 遇到更高码点会抛 TypeError，请求根本发不出去。这里在提交前用可见
// ASCII（0x20–0x7E）做前端校验，比 ISO-8859-1 更严格但更好解释，也与「令牌请用随机 ASCII」
// 的部署建议一致。命中时给友好提示，避免把原始 TypeError 文案暴露给用户。

const ASCII_PRINTABLE = /^[\x20-\x7e]+$/

export const SETUP_TOKEN_ASCII_ERROR =
  '部署密钥只能包含可见的 ASCII 字符（字母、数字和常见符号），请勿使用全角字符或中文标点。'

export function isAsciiPrintableToken(value: string): boolean {
  return ASCII_PRINTABLE.test(value)
}
