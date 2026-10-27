import schemaSql from '../../schema.sql'
import { ensureSchema } from './db/schema'

/**
 * 把 schema.sql 切成单条语句供 D1 batch 执行（D1 的 prepare 一次只接受一条语句）。
 * 跳过字符串 / 引号标识符内与 `--`、`/* *\/` 注释中的分号；`CREATE [TEMP] TRIGGER`
 * 的触发器体（BEGIN … END，含其中的 CASE … END）内的分号不切分，直到与 BEGIN 配对的
 * END 之后的分号才结束语句。关键字匹配不区分大小写，只认引号 / 注释之外的完整单词。
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let statement = ''
  let quote: "'" | '"' | '`' | ']' | null = null
  let inLineComment = false
  let inBlockComment = false
  let word = ''
  let headWords: string[] = []
  let isTrigger = false
  let sawBegin = false
  let blockDepth = 0

  const flushWord = () => {
    if (!word) return
    const upper = word.toUpperCase()
    word = ''
    if (headWords.length < 3) {
      headWords.push(upper)
      isTrigger = headWords[0] === 'CREATE' && (
        headWords[1] === 'TRIGGER'
        || ((headWords[1] === 'TEMP' || headWords[1] === 'TEMPORARY') && headWords[2] === 'TRIGGER')
      )
    }
    if (!isTrigger) return
    if (upper === 'BEGIN') {
      sawBegin = true
      blockDepth += 1
    } else if (upper === 'CASE' && sawBegin) {
      blockDepth += 1
    } else if (upper === 'END' && blockDepth > 0) {
      blockDepth -= 1
    }
  }

  const endStatement = () => {
    const trimmed = statement.trim()
    if (trimmed) statements.push(trimmed)
    statement = ''
    headWords = []
    isTrigger = false
    sawBegin = false
    blockDepth = 0
  }

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false
        statement += '\n'
      }
      continue
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false
        statement += ' '
        index += 1
      }
      continue
    }

    if (quote) {
      statement += character
      if (character === quote) {
        if (quote !== ']' && next === quote) {
          statement += next
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }

    if (/[A-Za-z0-9_$]/.test(character)) {
      word += character
      statement += character
      continue
    }
    flushWord()

    if (character === '-' && next === '-') {
      inLineComment = true
      statement += ' '
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      inBlockComment = true
      statement += ' '
      index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      statement += character
      continue
    }
    if (character === '[') {
      quote = ']'
      statement += character
      continue
    }
    if (character === ';') {
      if (isTrigger && (!sawBegin || blockDepth > 0)) {
        statement += character
        continue
      }
      endStatement()
      continue
    }

    statement += character
  }

  flushWord()
  endStatement()
  return statements
}

export async function initializeSchema(db: D1Database): Promise<void> {
  const statements = splitSqlStatements(schemaSql)
  if (statements.length === 0) throw new Error('installation schema is empty')

  const results = await db.batch(statements.map((statement) => db.prepare(statement)))
  const failed = results.find((result) => !result.success)
  if (failed) throw new Error(failed.error ?? 'installation schema statement failed')
  // 写入 schema_version。不直接在 schema.sql 里写最新版本：库里若残留旧表，
  // CREATE IF NOT EXISTS 不会补列，必须由迁移步骤按实际结构判断后再记版本。
  // 记版本失败不阻断安装：表已建好，下一个请求的 ensureSchema 会重试。
  try {
    await ensureSchema(db, true)
  } catch (error) {
    console.error('[install] recording schema version failed:', error)
  }
}
