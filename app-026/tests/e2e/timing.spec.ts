import { expect, test } from '@playwright/test'
import { createScriptViaUI, setInputValue } from './helpers'

const SCRIPT = `## 第一场 坐宫
生：杨延辉坐宫院自思自叹【过门5】
生：想起了当年事好不惨然
旦：夫妻们打坐在皇宫院【锣鼓】
旦：尊一声驸马爷细听咱言【停顿3】

## 第二场 惊变
生：听罢言来吃一惊
生：老娘亲来到白马关【过门:6】
旦：倘若还娘娘把命断
生：拼却乌纱不做脱袍赴黄泉

## 第三场 尾声
生：一别两茫茫`

test('计划表：按设定速度估算，列齐段序/段名/句数/用时/累计', async ({ page }) => {
  const id = await createScriptViaUI(page, 'E2E时长', SCRIPT)
  await page.goto(`/plan/${id}`)

  await expect(page.getByTestId('plan-table')).toBeVisible()
  const rows = page.getByTestId('plan-row')
  await expect(rows).toHaveCount(3)

  // 表头列存在
  await expect(page.getByRole('columnheader', { name: '段序' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '累计用时' })).toBeVisible()

  // 第一段 4 句；句数列
  await expect(rows.nth(0)).toContainText('第一场 坐宫')
  await expect(rows.nth(0)).toContainText('4')
  await expect(rows.nth(2)).toContainText('第三场 尾声')

  // 总时长为 mm:ss 形式
  await expect(page.getByTestId('total-time').locator('strong')).toContainText(/^\d+:\d{2}$/)
})

test('改念白速度 → 段用时与总时长重算；逐句明细可展开', async ({ page }) => {
  const id = await createScriptViaUI(page, 'E2E速度', SCRIPT)
  await page.goto(`/plan/${id}`)

  const totalEl = page.getByTestId('total-time').locator('strong')
  const before = await totalEl.textContent()

  // 速度翻倍 → 念字部分减半，总时长变小
  await setInputValue(page, 'input-wpm', '360')
  await expect.poll(async () => totalEl.textContent()).not.toBe(before)
  const afterSecs = toSecs((await totalEl.textContent())!)
  const beforeSecs = toSecs(before!)
  expect(afterSecs).toBeLessThan(beforeSecs)

  // 展开第一段逐句明细：含角色、字数、停顿 5+2（锣鼓默认2s）= 首行停顿 5s
  await page.getByTestId('plan-row').nth(0).getByTestId('seg-toggle').click()
  const detail = page.getByTestId('seg-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('杨延辉坐宫院自思自叹')
  await expect(detail).toContainText('5s')
})

test('手工改写段用时 → 总时长、标记与切分联动；可恢复估算', async ({ page }) => {
  const id = await createScriptViaUI(page, 'E2E改写', SCRIPT)
  await page.goto(`/plan/${id}`)

  const totalEl = page.getByTestId('total-time').locator('strong')
  const original = toSecs((await totalEl.textContent())!)
  const firstRow = page.getByTestId('plan-row').nth(0)
  const firstEstimate = toSecs((await firstRow.getByTestId('seg-duration').textContent())!)

  // 进入改写：第一段改成 10 分 0 秒
  await firstRow.getByTestId('btn-edit-seg').click()
  await setInputValue(page, 'edit-min', '10')
  await setInputValue(page, 'edit-sec', '0')
  await page.getByTestId('edit-ok').click()

  // 行内出现「手工改写」徽标，段用时变为 10:00
  await expect(firstRow).toContainText('手工改写')
  await expect(firstRow.getByTestId('seg-duration')).toHaveText('10:00')
  const rewritten = toSecs((await totalEl.textContent())!)
  expect(rewritten).toBe(original - firstEstimate + 600)

  // 改排练上限为 1 分钟：第一段 600s 必须被拆成多次（按句摊分后每次能装若干句）
  await setInputValue(page, 'input-session', '1')
  const sessionRows = page.getByTestId('session-row')
  const countBefore = await sessionRows.count()
  expect(countBefore).toBeGreaterThan(1)
  // 第一行起点应是第1段第1句
  await expect(sessionRows.nth(0)).toContainText('第1段《第一场 坐宫》第1句')

  // 恢复估算 → 徽标消失、总时长回到原值
  await firstRow.getByTestId('btn-reset-seg').click()
  await expect(firstRow).not.toContainText('手工改写')
  await expect.poll(async () => toSecs((await totalEl.textContent())!)).toBe(original)
})

test('切分表标出每次练到哪、下次从哪句起', async ({ page }) => {
  const id = await createScriptViaUI(page, 'E2E切分', SCRIPT)
  await page.goto(`/plan/${id}`)
  // 很小的上限 → 多次排练
  await setInputValue(page, 'input-session', '1')

  const rows = page.getByTestId('session-row')
  await expect(rows.first()).toContainText('第 1 次')
  // 第 1 次的「下次从哪起」列应是「第N段《…》第M句起」（第 2 次的起点）
  await expect(rows.nth(0)).toContainText(/第\d+段《.+》第\d+句/)
  // 最后一次的下一列为排练完毕
  const last = rows.last()
  await expect(last).toContainText('全剧排练完毕')
})

test('导出 TXT 计划表会下载文件', async ({ page }) => {
  const id = await createScriptViaUI(page, 'E2E导出', SCRIPT)
  await page.goto(`/plan/${id}`)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-export-plan-txt').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/时长计划表\.txt$/)
  const stream = await download.createReadStream()
  const content = await new Promise<string>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    stream.on('data', (c: Uint8Array) => {
      chunks.push(c)
      total += c.length
    })
    stream.on('end', () => {
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of chunks) {
        merged.set(c, off)
        off += c.length
      }
      resolve(new TextDecoder('utf-8').decode(merged))
    })
    stream.on('error', reject)
  })
  expect(content).toContain('排戏时长计划表')
  expect(content).toContain('念白速度：180 字/分钟')
  expect(content).toContain('第一场 坐宫')
})

test('从首页/编辑页可进入排戏计划页，刷新后速度设置仍在', async ({ page }) => {
  await createScriptViaUI(page, 'E2E入口', SCRIPT)

  // 首页卡片有入口
  await page.goto('/')
  await page.getByRole('link', { name: /排戏计划/ }).first().click()
  await page.waitForURL(/\/plan\//)
  await expect(page.getByTestId('plan-table')).toBeVisible()

  // 改成 220 字/分并刷新
  await setInputValue(page, 'input-wpm', '220')
  await page.reload()
  await expect(page.getByTestId('input-wpm')).toHaveValue('220')
})

function toSecs(clock: string): number {
  const parts = clock.trim().split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return parts[0] * 60 + parts[1]
}
