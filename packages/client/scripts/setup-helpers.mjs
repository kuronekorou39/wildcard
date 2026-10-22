export async function chooseRule(page, id) {
  await page.locator('.rule-select-trigger').click();
  const options = page.getByRole('option');
  for (let i = 0; i < await options.count(); i++) {
    const option = options.nth(i);
    if (await option.getAttribute('data-variant') === id || await option.locator('strong').innerText() === id) {
      await option.click();
      return;
    }
  }
  throw new Error(`Rule not found: ${id}`);
}

export async function editValue(page, label, value) {
  await page.getByRole('button', { name: `${label}を編集`, exact: true }).click();
  await page.locator('.editable-input:visible').fill(String(value));
  await page.keyboard.press('Enter');
}
