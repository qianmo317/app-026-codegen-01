import { test, expect } from '@playwright/test'
import { createScriptViaUI, setInputValue } from './helpers'

/**
 * 排戏计划：整场时长估算、计划表、排练切分、手工改写联动重算、导出。
 */
test.describe('排戏计划', () => {
  // 60 字/分下：段一 2 句 × 10s，段二 1 句 10s；另有过门 6s、停顿 4s
  const SCRIPT =
    '## 上京\n生：一二三四五六七八九十【过门:6】\n生：一二三四五六七八九十\n\n' +
    '## 见娘\n旦：一二三四五六七八九十【停顿4】'

  test('估算整场用时并按上限切分', async ({ page }) => {
    const id = await createScriptViaUI(page, '排戏计划E2E', SCRIPT)
    await page.goto(`/plan/${id}`)
    await page.getByTestId('plan-page').waitFor()

    // 速度改为 60 字/分钟
    await setInputValue(page, 'plan-cpm', '60')
    // 段一 = (10+6) + 10 = 26s；段二 = 10+4 = 14s；总 40s
    await expect(page.getByTestId('plan-summary')).toContainText('整场总时长')
    await expect(page.locator('[data-testid=plan-row] .strong').last()).toHaveText('0:40')

    // 上限 0.5 分钟 = 30s：第一次装段一 26s 后段二装不下
    await setInputValue(page, 'plan-session-min', '0.5')
    const cards = page.getByTestId('session-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('第 1 次')
    await expect(cards.nth(0)).toContainText('第 1 段 第 1 句 → 第 1 段 第 2 句')
    await expect(cards.nth(0)).toContainText('下次从第 2 段第 1 句起')
    await expect(cards.nth(0)).toContainText('0:26')
    await expect(cards.nth(1)).toContainText('整场排完')
    await expect(cards.nth(1)).toContainText('0:14')
  })

  test('手工改写段用时后总时长与切分立即重算，清空恢复', async ({ page }) => {
    const id = await createScriptViaUI(page, '排戏计划改写', SCRIPT)
    await page.goto(`/plan/${id}`)
    await setInputValue(page, 'plan-cpm', '60')
    await setInputValue(page, 'plan-session-min', '0.5')

    // 段一改写为 60 秒：超过 30s 上限 → 第一次只能带段一第 1 句（摊 30s）
    const rows = page.getByTestId('plan-row')
    await rows.first().getByTestId('plan-custom-input').fill('60')
    await expect(page.locator('[data-testid=plan-row][data-custom="1"]')).toHaveCount(1)
    await expect(page.locator('[data-testid=plan-row] .strong').last()).toHaveText('1:14') // 60 + 14
    const cards = page.getByTestId('session-card')
    await expect(cards.first()).toContainText('第 1 段 第 1 句')
    await expect(cards.first()).toContainText('段内拆分')
    await expect(cards.first()).toContainText('下次从第 1 段第 2 句起')

    // 点重置恢复估算
    await rows.first().getByTestId('plan-reset').click()
    await expect(page.locator('[data-testid=plan-row][data-custom="1"]')).toHaveCount(0)
    await expect(page.locator('[data-testid=plan-row] .strong').last()).toHaveText('0:40')
  })

  test('参数与改写随剧目持久化', async ({ page }) => {
    const id = await createScriptViaUI(page, '排戏计划持久化', SCRIPT)
    await page.goto(`/plan/${id}`)
    await setInputValue(page, 'plan-cpm', '60')
    await setInputValue(page, 'plan-session-min', '0.5')
    await page.getByTestId('plan-row').first().getByTestId('plan-custom-input').fill('60')
    await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 6000 })

    await page.reload()
    await page.getByTestId('plan-page').waitFor()
    await expect(page.getByTestId('plan-cpm')).toHaveValue('60')
    await expect(page.getByTestId('plan-session-min')).toHaveValue('0.5')
    await expect(page.locator('[data-testid=plan-row][data-custom="1"]')).toHaveCount(1)
    await expect(page.locator('[data-testid=plan-row] .strong').last()).toHaveText('1:14')
  })

  test('导出 TXT / CSV 触发下载', async ({ page }) => {
    const id = await createScriptViaUI(page, '排戏计划导出', SCRIPT)
    await page.goto(`/plan/${id}`)
    await setInputValue(page, 'plan-session-min', '0.5')

    const txtPromise = page.waitForEvent('download')
    await page.getByTestId('btn-export-txt').click()
    const txt = await txtPromise
    expect(txt.suggestedFilename()).toMatch(/排戏计划\.txt$/)
    const txtBody = await txt.createReadStream().then(async (stream) => {
      const chunks: Uint8Array[] = []
      let total = 0
      for await (const c of stream) {
        const u = c as Uint8Array
        chunks.push(u)
        total += u.length
      }
      const all = new Uint8Array(total)
      let off = 0
      for (const u of chunks) {
        all.set(u, off)
        off += u.length
      }
      return new TextDecoder('utf-8').decode(all)
    })
    expect(txtBody).toContain('排戏计划表')
    expect(txtBody).toContain('排练切分')

    const csvPromise = page.waitForEvent('download')
    await page.getByTestId('btn-export-csv').click()
    const csv = await csvPromise
    expect(csv.suggestedFilename()).toMatch(/排戏计划\.csv$/)
  })
})
